const settings = require("./settings");
const { getProvider, listProviders } = require("./ai/providers");
const groqProvider = require("./ai/providers/groq");
const { processMessageImages, buildContentParts } = require("./ai/images");

const safe = require("./safe");

const MAX_REPLY_LEN = 2000;

// Tracks which providers are currently handling a request.
// When multiple people talk to the bot at once, the load-balancer
// prefers non-busy providers so conversations are distributed across
// the fallback chain instead of queuing on the primary.
const busyProviders = new Set(); // providerId → true while request is in-flight
function getBusyProviders() {
  return [...busyProviders];
}

// Periodic cleanup: evict any providers that got stuck busy (defense against
// a missed finally block from a process crash or an unhandled rejection).
// In-flight requests have a 30s timeout; anything stuck >5min is dead.
setInterval(() => {
  if (busyProviders.size > 0) {
    console.warn(`[ai] Evicting ${busyProviders.size} stuck provider(s): ${[...busyProviders].join(", ")}`);
    busyProviders.clear();
  }
}, 300_000).unref();

// Per-channel cooldown for chatty mode — prevents the bot from responding
// too frequently in the same channel. Stale entries are cleaned up hourly.
const chattyCooldowns = new Map(); // channelId -> timestamp of last response
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [ch, ts] of chattyCooldowns) {
    if (ts < cutoff) chattyCooldowns.delete(ch);
  }
}, 600_000).unref();

// Conversation threading: short-term buffer of recent turns per channel.
// Each entry holds up to 3 user+assistant pairs; expires after 10min idle.
const threadBuffer = new Map(); // channelId -> { lastUpdate, turns: [{role,content}] }
setInterval(() => {
  const cutoff = Date.now() - 600_000;
  for (const [ch, entry] of threadBuffer) {
    if (entry.lastUpdate < cutoff) threadBuffer.delete(ch);
  }
}, 120_000).unref();

// Analytics buffer: flushed to SQLite every 10s to avoid blocking the AI loop
const analyticsBuffer = [];
setInterval(() => {
  if (analyticsBuffer.length === 0) return;
  const batch = analyticsBuffer.splice(0);
  const db = require("./db");
  for (const a of batch) {
    db.logAiCall(a.guildId, a.userId, a.provider, a.model, a.tokens, a.latencyMs, a.success, a.error).catch(() => {});
  }
}, 10_000).unref();

// Model-list lookups hit a live upstream (and the dashboard polls GET /api/ai
// frequently). Cache results — including failures — so we don't hammer a flaky
// custom endpoint or flood the logs with the same warning on every poll.
const MODEL_LIST_TTL = 60_000;
const modelListCache = new Map(); // key -> { at, models? , error? }

function modelListCacheKey(providerId, opts, hasKey) {
  return [providerId, opts.baseUrl || "", opts.apiType || "", hasKey ? "k" : ""].join("|");
}

function parseChannelList(str) {
  if (!str || !String(str).trim()) return new Set();
  return new Set(String(str).split(/[\s,]+/).map(s => s.trim()).filter(s => /^\d{17,20}$/.test(s)));
}

function parseFallbackList(str) {
  if (!str || !String(str).trim()) return [];
  return String(str).split(/[\s,]+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
}

function isChannelAllowed(channelId, allowed, ignored) {
  if (ignored.has(channelId)) return false;
  if (allowed.size === 0) return true;
  return allowed.has(channelId);
}

function stripBotMention(content, botId) {
  return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

function splitMessage(text, maxLen = MAX_REPLY_LEN) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const MAX_SPLIT_SEGMENTS = 4;          // hard cap — prevents accidental message spam

// Split a response into conversational message segments by paragraph breaks.
// The AI is told to use blank lines between thoughts — each becomes its own message.
// Falls back to character-limit splitting for long single-block replies.
function splitResponse(text) {
  let segments = [];
  
  if (text.includes("\n\n")) {
    // Split on blank lines (2+ newlines) — each paragraph is a separate message
    segments = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).slice(0, MAX_SPLIT_SEGMENTS);
  }
  
  if (segments.length === 0) {
    segments = [text];
  }

  // Apply character-limit splitting to each segment
  const result = [];
  for (const seg of segments) {
    for (const chunk of splitMessage(seg)) {
      result.push(chunk);
    }
  }
  return result;
}

async function getChannelContext(message, client, limit = 8) {
  if (limit <= 0) return [];
  try {
    // Discord fetch() caps at 100 messages; clamp to avoid API errors
    const fetchLimit = Math.min(limit + 2, 100);
    const fetched = await safe.orNull(message.channel.messages.fetch({ limit: fetchLimit }), "fetch channel context");
    if (!fetched) return [];

    const prefix = settings.get("prefix");
    
    const list = Array.from(fetched.values())
      .filter(m => m.id !== message.id && !m.content.startsWith(prefix))
      .reverse()
      .slice(-limit);

    return list.map(m => {
      const isSelf = m.author.id === client.user.id;
      if (isSelf) {
        return { role: "assistant", content: m.content };
      } else {
        const authorTag = m.member?.displayName || m.author.username;
        return {
          role: "user",
          name: m.author.username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
          content: `[${authorTag} <@${m.author.id}>]: ${m.content}`
        };
      }
    });
  } catch (err) {
    console.error("Failed to fetch channel context:", err);
    return [];
  }
}

async function buildSpeakerProfile(message, ctx) {
  try {
    const member = message.member || await safe.orNull(message.guild.members.fetch(message.author.id), "fetch speaker member");
    if (!member) return "";
    const { data } = ctx;
    const warnings = data.getWarnings(message.guild.id, message.author.id);
    const topRoles = member.roles.cache
      .filter(r => r.id !== message.guild.id && r.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .slice(0, 5)
      .map(r => r.name);
    
    const parts = [];
    const displayName = member.displayName || message.author.username;
    parts.push(`- Name: ${displayName}`);
    if (topRoles.length) parts.push(`- Top roles: ${topRoles.join(", ")}`);
    if (member.joinedAt) {
      const daysAgo = Math.floor((Date.now() - member.joinedAt.getTime()) / 86400000);
      parts.push(`- Joined: ${member.joinedAt.toISOString().slice(0, 10)} (${daysAgo} days ago)`);
    }
    if (warnings.length) parts.push(`- Warning count: ${warnings.length}`);
    
    return parts.length ? `\n### SPEAKER PROFILE (who you're replying to):\n${parts.join("\n")}\n` : "";
  } catch {
    return "";
  }
}

async function buildMessageHistory(message, ctx, limit = 8, userContent, images = []) {
  const { client } = ctx;
  let history = await getChannelContext(message, client, limit);
  
  // Prepend threaded conversation context (last ~3 turns in this channel)
  const thread = threadBuffer.get(message.channel.id);
  if (thread && thread.turns.length > 0) {
    const contextBlock = [{
      role: "system",
      content: `### RECENT CONVERSATION IN THIS CHANNEL (you were part of this):\n${thread.turns.map(t => {
        const prefix = t.role === "assistant" ? "Bot" : t.name || "User";
        return `[${prefix}]: ${t.content}`;
      }).join("\n")}`
    }];
    history = [...contextBlock, ...history];
  }
  
  // Pre-fetch speaker profile — roles, join date, warning count
  const speakerProfile = await buildSpeakerProfile(message, ctx);
  
  // Tag the trigger message so the AI knows exactly what to respond to.
  const taggedContent = `[THIS MESSAGE NEEDS YOUR RESPONSE — ${authorTag} <@${message.author.id}>]: ${userContent}`;
  const contentWithImages = images.length > 0
    ? buildContentParts(taggedContent, images)
    : taggedContent;

  history.push({
    role: "user",
    name: message.author.username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    content: contentWithImages
  });

  let system = settings.get("aiSystemPrompt") || "You are a helpful Discord assistant. Keep replies concise and friendly.";

  // Inject server context so the AI knows where it is and can use tools
  const guildName = message.guild?.name || "Unknown";
  system += `\n\n### SERVER CONTEXT:\n- Server: ${guildName} (ID: ${message.guild.id})\n- Current channel: #${message.channel.name} (ID: ${message.channel.id})\n- Bot's own user ID: ${client.user.id}`;
  
  // Inject speaker profile as metadata (not part of the user's message)
  if (speakerProfile) {
    system += speakerProfile;
  }
  
  if (settings.get("aiMemoryEnabled") !== false) {
    const aiMemory = require("./ai/memory");
    const memories = aiMemory.recall(message.guild.id, message.author.id, 15);
    if (memories.length > 0) {
      const formattedMemories = memories.map(m => {
        const scope = m.userId ? `User <@${m.userId}>` : "Server/General";
        return `- [Fact #${m.id}] (${scope}): ${m.content}`;
      }).join("\n");
      system += `\n\n### KNOWN MEMORIES / FACTS:\n${formattedMemories}`;
    } else {
      system += `\n\n### KNOWN MEMORIES / FACTS:\nNo memories stored yet. Use add_memory to remember things about users or the server.`;
    }
  }

  return [{ role: "system", content: system }, ...history];
}

function cleanResponse(text, thinkingEnabled) {
  if (!text) return "";
  let clean = text;
  if (!thinkingEnabled) {
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, "");
  }
  return clean.trim();
}

// Auto-memory: after each AI interaction, fire a cheap follow-up call to
// extract any learnable facts about the user and save them via add_memory.
// Runs in background (fire-and-forget) so the user gets their response instantly.
async function extractFactsAsync(message, userContent, botReply, providerId) {
  try {
    const aiMemory = require("./ai/memory");
    const groqProvider = require("./ai/providers/groq");
    const groqKey = settings.getAiApiKey("groq");
    if (!groqKey) return;

    const systemPrompt = `Extract any facts worth remembering about this Discord user from the conversation. Return ONLY a JSON array of facts, each with "scope" ("user" or "server") and "content" (max 300 chars). If nothing new was learned, return an empty array []. Example: [{"scope":"user","content":"Prefers TypeScript over Python"},{"scope":"server","content":"New rules posted in #announcements"}]`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `User said: ${userContent.slice(0, 500)}\nBot replied: ${botReply.slice(0, 500)}\n\nExtract facts:` }
    ];

    const result = await groqProvider.chat(messages, {
      apiKey: groqKey,
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      maxTokens: 512,
    });

    let facts = [];
    try {
      // Try to parse the response as JSON
      const text = (typeof result === "string" ? result : result.text || "").trim();
      const match = text.match(/\[[\s\S]*\]/);
      if (match) facts = JSON.parse(match[0]);
    } catch { return; }

    for (const fact of facts) {
      if (fact.content && fact.content.trim().length > 3) {
        const userId = fact.scope === "user" ? message.author.id : null;
        await aiMemory.add(message.guild.id, userId, fact.content);
      }
    }
    if (facts.length > 0) {
      console.log(`[auto-memory] Saved ${facts.length} fact(s) from conversation with ${message.author.tag}`);
    }
  } catch (err) {
    // Silently fail — auto-memory is best-effort only
    console.warn(`[auto-memory] Extraction failed: ${err.message}`);
  }
}

async function chatWithProvider(providerIds, messages) {
  if (!Array.isArray(providerIds)) providerIds = [providerIds];

  // Prefer non-busy providers so concurrent conversations spread across
  // the fallback chain. If all are busy, fall through to try anyway.
  const available = providerIds.filter(id => !busyProviders.has(id));
  const ordered = [...available, ...providerIds.filter(id => busyProviders.has(id))];
  const attempted = new Set();

  let lastError = null;
  for (const providerId of ordered) {
    // Skip duplicates from the shuffled ordering
    if (attempted.has(providerId)) continue;
    attempted.add(providerId);

    const provider = getProvider(providerId);
    if (!provider) {
      lastError = new Error(`Unknown AI provider: ${providerId}`);
      console.warn(`[ai] Skipping unknown provider: ${providerId}`);
      continue;
    }

    const apiKey = settings.getAiApiKey(providerId);
    if (!apiKey) {
      lastError = new Error(`${provider.label} API key is not configured.`);
      continue;
    }

    let model = settings.getAiModel(providerId);

    if (providerId === "groq" && groqProvider.resolveModel) {
      const resolved = groqProvider.resolveModel(model);
      if (resolved !== model) {
        settings.setAiModel("groq", resolved);
        model = resolved;
      }
    }

    const opts = {
      apiKey,
      model,
      temperature: Number(settings.get("aiTemperature") ?? 0.7),
      maxTokens: Number(settings.get("aiMaxTokens") ?? 1024),
      topP: Number(settings.get("aiTopP") ?? 1.0),
      thinkingEnabled: settings.get("aiThinkingEnabled") === true,
    };
    if (provider.baseUrlField) opts.baseUrl = settings.get(provider.baseUrlField);
    if (provider.apiTypeField) opts.apiType = settings.get(provider.apiTypeField);

    if (settings.get("aiToolsEnabled") !== false) {
      const tools = require("./ai/tools");
      opts.tools = tools.getOpenAiTools();
    }

    busyProviders.add(providerId);
    try {
      // Race the provider call against a 30s timeout so a hung provider
      // doesn't stay marked busy forever and block the pool.
      const timedOut = Symbol("timeout");
      const result = await Promise.race([
        provider.chat(messages, opts),
        new Promise(r => setTimeout(() => r(timedOut), 30_000)),
      ]);
      if (result === timedOut) {
        throw new Error(`Provider "${providerId}" timed out after 30s`);
      }
      return { result, providerId };
    } catch (err) {
      lastError = err;
      console.warn(`[ai] Provider "${providerId}" failed: ${err.message}`);
    } finally {
      busyProviders.delete(providerId);
    }
  }

  throw lastError || new Error("All AI providers failed — no provider had a configured API key.");
}

async function handleAiMessage(message, ctx) {
  if (!settings.get("aiEnabled")) return false;

  // Maintenance mode — skip AI responses entirely
  const mm = settings.get("maintenanceMode");
  if ((mm === true || mm === "true") && !ctx.utils?.isOwner(message.author.id)) return false;

  const providerId = settings.get("aiProvider") || "groq";
  const apiKey = settings.getAiApiKey(providerId);
  if (!apiKey) {
    // Primary has no key — check if any fallback has a key before giving up
    const fallbacks = parseFallbackList(settings.get("aiFallbackProviders"));
    const hasAnyKey = fallbacks.some(id => settings.getAiApiKey(id));
    if (!hasAnyKey) return false;
  }

  const allowed = parseChannelList(settings.get("aiAllowedChannels"));
  const ignored = parseChannelList(settings.get("aiIgnoredChannels"));
  if (!isChannelAllowed(message.channel.id, allowed, ignored)) return false;

  const { client } = ctx;
  let userContent = null;

  if (message.mentions.has(client.user.id)) {
    userContent = stripBotMention(message.content, client.user.id);
    if (!userContent) userContent = "The user pinged you without a message. Greet them briefly.";
  } else if (message.reference?.messageId) {
    const ref = await safe.orNull(message.channel.messages.fetch(message.reference.messageId), "fetch referenced message for AI");
    if (ref?.author?.id !== client.user.id) return false;
    userContent = message.content.trim();
    if (!userContent) userContent = "The user replied to your message without text. Ask what they need.";
  } else {
    // Keyword trigger — respond when someone says the bot's keyword
    const keyword = (settings.get("aiKeyword") || "mitto").toLowerCase();
    const msgLower = message.content.toLowerCase();
    const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (keyword && pattern.test(msgLower)) {
      console.log(`[ai] Keyword trigger "${keyword}" matched in message from ${message.author.tag}`);
      userContent = message.content.trim();
    } else if (settings.get("aiChattyMode") === true) {
      // Chatty mode — respond naturally to conversations without being pinged.
      // Per-channel cooldown prevents the bot from dominating the chat.
      const cooldownSec = Number(settings.get("aiChattyCooldown")) || 60;
      const last = chattyCooldowns.get(message.channel.id);
      if (last && Date.now() - last < cooldownSec * 1000) {
        return false;
      }
      // Only log chatty triggers occasionally to avoid log spam
      if (Math.random() < 0.1) {
        console.log(`[ai] Chatty trigger in #${message.channel.name} (cooldown: ${cooldownSec}s)`);
      }
      userContent = message.content.trim();
    } else {
      return false;
    }
  }

  if (message.content.startsWith(ctx.utils.PREFIX)) return false;

  try {
    await message.channel.sendTyping();
    const tools = require("./ai/tools");

    // Detect and download image attachments for vision support
    const images = await processMessageImages(message);
    if (images.length > 0) {
      console.log(`[vision] Processing ${images.length} image(s) from ${message.author.tag}`);
    }

    // Build fallback chain: primary + configured fallbacks (deduplicated, limited to 5)
    const primaryId = settings.get("aiProvider") || "groq";
    const fallbackIds = parseFallbackList(settings.get("aiFallbackProviders"));
    const providerIds = [primaryId, ...fallbackIds].filter((id, i, arr) => arr.indexOf(id) === i);
    let activeProviderId = primaryId;

    let messages = await buildMessageHistory(
      message, ctx,
      Number(settings.get("aiContextLimit") ?? 8),
      userContent,
      images
    );
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let finalReply = "";
    const thinkingEnabled = settings.get("aiThinkingEnabled") === true;
    const startTime = Date.now(); // for analytics latency tracking

    // Pin subsequent tool-calling iterations to the first working provider
    // so the model doesn't switch mid-conversation.
    let pinnedProvider = null;

    while (loopCount < MAX_LOOPS) {
      let response;
      const idsToTry = pinnedProvider ? [pinnedProvider] : providerIds;
      try {
        const chatResult = await chatWithProvider(idsToTry, messages);
        response = chatResult.result;
        if (!pinnedProvider) pinnedProvider = chatResult.providerId;
        if (chatResult.providerId !== primaryId) {
          activeProviderId = chatResult.providerId;
          const providerLabel = getProvider(activeProviderId)?.label || activeProviderId;
          console.log(`[ai] Fallback activated — using "${providerLabel}" for ${message.author.tag}`);
        }
      } catch (err) {
        // All providers exhausted — check if last error was a rate limit
        const rateMatch = err.message.match(/retry after (\d+)s/);
        if (rateMatch || /\b429\b|rate[ -]limit/i.test(err.message)) {
          const delay = rateMatch ? parseInt(rateMatch[1], 10) * 1000 : 5000;
          console.warn(`[ai] All providers rate limited, retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          try {
            const retryResult = await chatWithProvider(idsToTry, messages);
            response = retryResult.result;
            activeProviderId = retryResult.providerId;
          } catch (retryErr) {
            console.error(`[ai] Retry also failed: ${retryErr.message}`);
            response = null;
          }
        } else {
          throw err;
        }
      }

      if (response === null) {
        finalReply = "_I'm being rate limited right now — try again in a few seconds._";
        break;
      }
      if (typeof response === "string") {
        finalReply = cleanResponse(response, thinkingEnabled);
        break;
      }

      const { text, toolCalls } = response;
      if (text) {
        finalReply = cleanResponse(text, thinkingEnabled);
      }

      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args)
          }
        }))
      });

      for (const tc of toolCalls) {
        console.log(`[ai] Executing tool: ${tc.name} with args:`, tc.args);
        let resultStr;
        try {
          resultStr = await tools.executeTool(tc.name, tc.args, ctx, message);
        } catch (err) {
          resultStr = `Error executing tool: ${err.message}`;
        }
        
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: resultStr
        });
      }

      loopCount++;
    }

    if (!finalReply) {
      console.warn("[AI] Empty response after", loopCount, "tool loops");
      finalReply = "I have processed your request.";
    }

    const chunks = splitResponse(finalReply);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply(chunks[i]);
      } else {
        // Natural delay between multi-message responses (300-800ms)
        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
        await message.channel.send(chunks[i]);
      }
    }

    // Update chatty cooldown after a successful response (only in chatty mode)
    if (settings.get("aiChattyMode") === true && chunks.length > 0) {
      chattyCooldowns.set(message.channel.id, Date.now());
    }

    // Update conversation thread buffer for continuity
    const threadEntry = threadBuffer.get(message.channel.id) || { lastUpdate: 0, turns: [] };
    threadEntry.lastUpdate = Date.now();
    threadEntry.turns.push({ role: "user", name: message.author.username, content: userContent });
    threadEntry.turns.push({ role: "assistant", content: finalReply.slice(0, 500) });
    if (threadEntry.turns.length > 6) threadEntry.turns = threadEntry.turns.slice(-6); // keep 3 pairs
    threadBuffer.set(message.channel.id, threadEntry);

    // Analytics: log this AI call
    analyticsBuffer.push({
      guildId: message.guild.id, userId: message.author.id,
      provider: activeProviderId, model: settings.getAiModel(activeProviderId),
      tokens: finalReply.length + (messages.reduce((s, m) => s + String(m.content||"").length, 0)),
      latencyMs: Date.now() - startTime, success: true, error: null,
    });

    // Auto-memory: fire-and-forget fact extraction after successful response
    if (settings.get("aiMemoryEnabled") !== false && settings.get("aiToolsEnabled") !== false) {
      extractFactsAsync(message, userContent, finalReply, activeProviderId).catch(() => {});
    }

    return true;
  } catch (err) {
    console.error("AI reply error:", err.message);
    // Log failed call to analytics
    analyticsBuffer.push({
      guildId: message.guild.id, userId: message.author.id,
      provider: settings.get("aiProvider") || "groq", model: settings.getAiModel(settings.get("aiProvider") || "groq"),
      tokens: 0, latencyMs: Date.now() - startTime, success: false, error: err.message,
    });
    await safe.reply(message, { content: `❌ AI error: ${err.message}` }, "AI error reply");
    return true;
  }
}

function providerPublicMeta(provider) {
  const envVars = Array.isArray(provider.envVar) ? provider.envVar : [provider.envVar];
  return {
    id:           provider.id,
    label:        provider.label,
    envVar:       envVars.join(" / "),
    keyField:     provider.keyField,
    modelField:   provider.modelField,
    defaultModel: provider.defaultModel,
  };
}

function getPublicSettings() {
  const providerId = settings.get("aiProvider") || "groq";
  const provider = getProvider(providerId) || getProvider("groq");
  const key = settings.getAiApiKey(providerId);
  const storedModel = settings.getAiModel(providerId);

  return {
    aiEnabled:          settings.get("aiEnabled"),
    aiProvider:         providerId,
    providers:          listProviders().map(providerPublicMeta),
    model:              storedModel,
    aiSystemPrompt:     settings.get("aiSystemPrompt"),
    aiAllowedChannels:  settings.get("aiAllowedChannels"),
    aiIgnoredChannels:  settings.get("aiIgnoredChannels"),
    hasApiKey:          Boolean(key),
    apiKeyPreview:      key ? `••••${key.slice(-4)}` : "",
    models:             provider.defaultModels,
    customBaseUrl:      settings.get("customBaseUrl"),
    customApiType:      settings.get("customApiType"),
    groqModel:          settings.get("groqModel"),
    // Advanced parameters
    aiTemperature:      settings.get("aiTemperature"),
    aiMaxTokens:        settings.get("aiMaxTokens"),
    aiTopP:             settings.get("aiTopP"),
    aiContextLimit:     settings.get("aiContextLimit"),
    aiToolsEnabled:     settings.get("aiToolsEnabled"),
    aiMemoryEnabled:    settings.get("aiMemoryEnabled"),
    aiThinkingEnabled:   settings.get("aiThinkingEnabled"),
    aiFallbackProviders:  settings.get("aiFallbackProviders") || "",
    aiChattyMode:         settings.get("aiChattyMode") === true,
    aiChattyCooldown:     settings.get("aiChattyCooldown") ?? 60,
    providerStatus:       getProviderStatusSnapshot(),
  };
}

async function getPublicSettingsAsync() {
  const base = getPublicSettings();
  const providerId = base.aiProvider;
  const provider = getProvider(providerId);
  if (!provider) return base;

  const key = settings.getAiApiKey(providerId);
  const hasBaseUrl = provider.baseUrlField && settings.get(provider.baseUrlField);
  if ((key || hasBaseUrl) && typeof provider.listModels === "function") {
    const listOpts = {};
    if (provider.baseUrlField) listOpts.baseUrl = settings.get(provider.baseUrlField);
    if (provider.apiTypeField) listOpts.apiType = settings.get(provider.apiTypeField);

    const cacheKey = modelListCacheKey(providerId, listOpts, Boolean(key));
    const cached = modelListCache.get(cacheKey);
    if (cached && Date.now() - cached.at < MODEL_LIST_TTL) {
      if (cached.models) base.models = cached.models;
    } else {
      try {
        const models = await provider.listModels(key, listOpts);
        modelListCache.set(cacheKey, { at: Date.now(), models });
        base.models = models;
      } catch (err) {
        if (!cached || cached.error !== err.message) {
          console.warn(`[ai] Could not fetch ${provider.label} model list:`, err.message);
        }
        modelListCache.set(cacheKey, { at: Date.now(), error: err.message });
      }
    }
    if (base.model && Array.isArray(base.models) && !base.models.includes(base.model)) {
      base.models = [base.model, ...base.models];
    }
  }
  return base;
}

function getProviderStatusSnapshot() {
  const busyNow = new Set(getBusyProviders());
  const status = {};
  for (const p of listProviders()) {
    status[p.id] = busyNow.has(p.id) ? "busy" : "free";
  }
  return status;
}

function updateSettings(body) {
  if (typeof body.aiEnabled === "boolean") settings.set("aiEnabled", body.aiEnabled);

  if (typeof body.aiProvider === "string" && getProvider(body.aiProvider.trim())) {
    settings.set("aiProvider", body.aiProvider.trim());
  }

  const activeProviderId = settings.get("aiProvider") || "groq";
  const activeProvider = getProvider(activeProviderId);

  const modelValue = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : null;

  if (modelValue && activeProvider) {
    settings.set(activeProvider.modelField, modelValue);
  }

  for (const provider of listProviders()) {
    const modelKey = provider.modelField;
    if (typeof body[modelKey] === "string" && body[modelKey].trim()) {
      settings.set(modelKey, body[modelKey].trim());
    }
    const apiKeyField = body[provider.keyField];
    if (typeof apiKeyField === "string" && apiKeyField.trim()) {
      settings.set(provider.keyField, apiKeyField.trim());
    }
  }

  if (typeof body.customBaseUrl === "string") {
    settings.set("customBaseUrl", body.customBaseUrl.trim());
  }

  if (typeof body.customApiType === "string") {
    const t = body.customApiType.trim().toLowerCase();
    if (t === "openai" || t === "anthropic") settings.set("customApiType", t);
  }

  if (typeof body.aiSystemPrompt === "string") {
    settings.set("aiSystemPrompt", body.aiSystemPrompt.slice(0, 2000));
  }

  if (typeof body.aiAllowedChannels === "string") {
    settings.set("aiAllowedChannels", body.aiAllowedChannels.trim());
  }

  if (typeof body.aiIgnoredChannels === "string") {
    settings.set("aiIgnoredChannels", body.aiIgnoredChannels.trim());
  }

  if (body.clearApiKey === true && activeProvider) {
    settings.set(activeProvider.keyField, "");
  } else if (typeof body.apiKey === "string" && body.apiKey.trim() && activeProvider) {
    settings.set(activeProvider.keyField, body.apiKey.trim());
  }

  // Advanced settings
  if (typeof body.aiTemperature === "number") settings.set("aiTemperature", body.aiTemperature);
  if (typeof body.aiMaxTokens === "number") settings.set("aiMaxTokens", body.aiMaxTokens);
  if (typeof body.aiTopP === "number") settings.set("aiTopP", body.aiTopP);
  if (typeof body.aiContextLimit === "number") settings.set("aiContextLimit", body.aiContextLimit);
  if (typeof body.aiToolsEnabled === "boolean") settings.set("aiToolsEnabled", body.aiToolsEnabled);
  if (typeof body.aiMemoryEnabled === "boolean") settings.set("aiMemoryEnabled", body.aiMemoryEnabled);
  if (typeof body.aiThinkingEnabled === "boolean") settings.set("aiThinkingEnabled", body.aiThinkingEnabled);

  if (typeof body.aiFallbackProviders === "string") {
    const cleaned = parseFallbackList(body.aiFallbackProviders).join(",");
    settings.set("aiFallbackProviders", cleaned);
  }

  if (typeof body.aiChattyMode === "boolean") settings.set("aiChattyMode", body.aiChattyMode);
  if (typeof body.aiChattyCooldown === "number" && body.aiChattyCooldown >= 5 && body.aiChattyCooldown <= 3600) {
    settings.set("aiChattyCooldown", body.aiChattyCooldown);
  }
}

module.exports = {
  handleAiMessage,
  getPublicSettings,
  getPublicSettingsAsync,
  updateSettings,
  chatWithProvider,
  splitMessage,
  parseFallbackList,
  cleanResponse,
  getBusyProviders,
  resolveModel: groqProvider.resolveModel,
  GROQ_MODELS: groqProvider.defaultModels,
};
