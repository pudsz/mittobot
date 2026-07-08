const settings = require("./settings");
const { getProvider, listProviders } = require("./ai/providers");
const groqProvider = require("./ai/providers/groq");
const { processMessageImages, buildContentParts } = require("./ai/images");
const { getPersonality, DEFAULT_PERSONALITY } = require("./ai/personalities");
const { extractMemoriesAsync } = require("./ai/memory-extractor");
const db = require("./db");

const safe = require("./safe");

const MAX_REPLY_LEN = 2000;

// Token-constrained providers benefit from a shorter system prompt.
// NVIDIA's smaller models (8B/14B) have 8K-32K windows vs Groq's 128K.
function usesConcisePrompt(providerId) {
  return providerId === "nvidia" || providerId === "gemini";
}

// Tracks which providers are currently handling a request.
// When multiple people talk to the bot at once, the load-balancer
// prefers non-busy providers so conversations are distributed across
// the fallback chain instead of queuing on the primary.
// Uses a Map<providerId, timestamp> so we can evict only stale entries
// instead of flushing the entire set (which would kill legitimately busy providers).
const busyProviders = new Map(); // providerId → timestamp of request start
const BUSY_PROVIDERS_MAX_SIZE = 50; // Maximum number of providers to track
function getBusyProviders() {
  return [...busyProviders.keys()];
}

// Periodic cleanup: evict only providers that have been busy for >5 minutes.
// Defense against a missed finally block from a process crash or an unhandled rejection.
// In-flight requests have a 30s timeout; anything stuck >5min is dead.
const PROVIDER_BUSY_TIMEOUT = 300_000; // 5 minutes
setInterval(() => {
  if (busyProviders.size === 0) return;
  const now = Date.now();
  const stale = [];
  for (const [id, startedAt] of busyProviders) {
    if (now - startedAt > PROVIDER_BUSY_TIMEOUT) stale.push(id);
  }
  for (const id of stale) busyProviders.delete(id);
  if (stale.length > 0) {
    console.warn(`[ai] Evicted ${stale.length} stuck provider(s): ${stale.join(", ")}`);
  }
  // Size-based eviction: if we exceed max size, remove oldest entries
  if (busyProviders.size > BUSY_PROVIDERS_MAX_SIZE) {
    const entries = Array.from(busyProviders.entries()).sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, busyProviders.size - BUSY_PROVIDERS_MAX_SIZE);
    for (const [id] of toRemove) busyProviders.delete(id);
    console.warn(`[ai] Evicted ${toRemove.length} old provider(s) due to size limit`);
  }
}, 60_000).unref();

// Per-channel cooldown for chatty mode — prevents the bot from responding
// too frequently in the same channel. Stale entries are cleaned up every minute.
const chattyCooldowns = new Map(); // channelId -> timestamp of last response
const CHATTY_COOLDOWN_MAX_SIZE = 1000; // Maximum number of channels to track
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ch, ts] of chattyCooldowns) {
    if (ts < cutoff) chattyCooldowns.delete(ch);
  }
  // Size-based eviction: if we exceed max size, remove oldest entries
  if (chattyCooldowns.size > CHATTY_COOLDOWN_MAX_SIZE) {
    const entries = Array.from(chattyCooldowns.entries()).sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, chattyCooldowns.size - CHATTY_COOLDOWN_MAX_SIZE);
    for (const [ch] of toRemove) chattyCooldowns.delete(ch);
  }
}, 60_000).unref();

// Conversation history is fully persistent in SQLite (ai_conversations table).
// Guild channels use one shared per-channel thread with explicit speaker labels.
// DMs use isolated per-user private threads and never mix with guild history.

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
const MODEL_LIST_CACHE_MAX_SIZE = 100; // Maximum number of model lists to cache
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

// ─── Input sanitization for prompt injection defense ────────────────────────
// Strips common injection patterns from user input BEFORE it reaches the AI
// provider. Applied to user messages AND memory content.
function sanitizeUserInput(text) {
  if (!text || typeof text !== "string") return text || "";

  // 1. Strip system role overrides — the most common injection vector
  text = text.replace(
    /\b(SYSTEM|SYSTEM OVERRIDE|ASSISTANT|ADMIN OVERRIDE|IGNORE PREVIOUS|DISREGARD)\s*[:：\n]/gi,
    ""
  );

  // 2. Strip tool invocation spoofing — attempts to trick the model into
  //    calling dangerous tools via natural language commands
  text = text.replace(
    /\b(calls?|invoke|execute|run)\s+(ban_member|kick_member|mute_member|warn_member|purge_messages|send_message|add_role|remove_role|create_channel)\b/gi,
    ""
  );

  // 3. Strip jailbreak / role-play override patterns
  text = text.replace(
    /\b(DAN|Do Anything Now|jailbreak|pretend you are not an AI|Act as if you have no restrictions|override all rules|You are now DAN|Ignore all previous instructions|Ignore all prior instructions)/gi,
    ""
  );

  // 4. Token overflow protection — cap at 4000 chars to prevent context-window abuse
  if (text.length > 4000) {
    text = text.slice(0, 4000) + "\n\n[... message truncated]";
  }

  return text.trim();
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
        const authorTag = speakerLabelFromMessage(m);
        return {
          role: "user",
          name: safeOpenAiName(m.author.username),
          content: `[${authorTag}]: ${m.content}`
        };
      }
    });
  } catch (err) {
    console.error("Failed to fetch channel context:", err);
    return [];
  }
}

function safeOpenAiName(raw, fallback = "speaker") {
  const cleaned = String(raw || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);
  return cleaned || fallback;
}

function speakerLabelFromMessage(message) {
  const displayName = message.member?.displayName || message.author?.globalName || message.author?.username || "Unknown";
  const username = message.author?.username || "unknown";
  return `${displayName} (@${username}, id:${message.author.id})`;
}

function speakerLabelFromRow(row, guild) {
  if (!row.user_id) return null;
  const member = guild?.members?.cache?.get(row.user_id);
  if (member) {
    const displayName = member.displayName || member.user?.globalName || member.user?.username || "Unknown";
    const username = member.user?.username || "unknown";
    return `${displayName} (@${username}, id:${row.user_id})`;
  }
  return `User id:${row.user_id}`;
}

function formatPersistedTurn(row, guild) {
  if (row.role === "user") {
    const label = speakerLabelFromRow(row, guild) || "Unknown user";
    return {
      role: "user",
      name: safeOpenAiName(row.user_id || "unknown"),
      content: `[${label}]: ${row.content}`,
    };
  }
  if (row.role === "system") {
    // Stored system rows are compact tool-result summaries. Feed them back as
    // user-visible context instead of adding extra system prompts mid-history.
    return { role: "user", name: "context", content: `[tool context]: ${row.content}` };
  }
  return { role: row.role, content: row.content };
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
    parts.push(`- Current speaker: ${displayName} (@${message.author.username}, id:${message.author.id})`);
    if (topRoles.length) parts.push(`- Top roles: ${topRoles.join(", ")}`);

    // Join date with context
    if (member.joinedAt) {
      const daysAgo = Math.floor((Date.now() - member.joinedAt.getTime()) / 86400000);
      const dateStr = member.joinedAt.toISOString().slice(0, 10);
      if (daysAgo < 7) {
        parts.push(`- Joined: ${dateStr} (${daysAgo} days ago - recently!)`);
      } else if (daysAgo > 365) {
        parts.push(`- Joined: ${dateStr} (${Math.floor(daysAgo / 365)} years ago - veteran)`);
      } else {
        parts.push(`- Joined: ${dateStr} (${daysAgo} days ago)`);
      }
    }

    // Server boosting status
    if (member.premiumSince) {
      const boostDays = Math.floor((Date.now() - member.premiumSince.getTime()) / 86400000);
      parts.push(`- Boosting: Yes (${boostDays} days)`);
    }

    // Warning count
    if (warnings.length) {
      parts.push(`- Warning count: ${warnings.length}`);
    }

    // Notable permissions
    if (member.permissions) {
      const notablePerms = [];
      if (member.permissions.has(1n)) notablePerms.push("Admin");
      if (member.permissions.has(1n << 3n)) notablePerms.push("ManageMessages");
      if (member.permissions.has(1n << 40n)) notablePerms.push("ModerateMembers");
      if (notablePerms.length) parts.push(`- Notable perms: ${notablePerms.join(", ")}`);
    }

    return parts.length ? `\n### SPEAKER PROFILE (who you're replying to):\n${parts.join("\n")}\n` : "";
  } catch {
    return "";
  }
}

// Resolve the scope and key tuple that uniquely identifies an active conversation thread.
//   - Guild channels  → scope "global"  (one shared thread per channel; everyone contributes)
//   - Direct messages → scope "private" (one thread per user)
function conversationKey(message) {
  if (message.guild) {
    return { scope: "global", key: { guildId: message.guild.id, channelId: message.channel.id, userId: message.author.id } };
  }
  return { scope: "private", key: { userId: message.author.id } };
}

async function buildMessageHistory(message, ctx, limit = 8, userContent, images = []) {
  const { client } = ctx;
  const { scope, key } = conversationKey(message);
  const guild = message.guild || null;
  const isDM = !message.guild;

  // Guild channels get ambient channel context; DMs skip it (history covers it).
  // When persisted history exists, reduce ambient context to avoid overlap bloat.
  const db = require("./db");
  const persisted = db.getConversationHistory(scope, key, 20);
  const hasPersisted = persisted.length > 0;

  // When we have both persisted and ambient context, reduce the ambient limit
  // to avoid loading the same messages twice in the prompt.
  const ambientLimit = hasPersisted ? Math.max(2, Math.floor(limit / 2)) : limit;
  let history = message.guild ? await getChannelContext(message, client, ambientLimit) : [];

  if (hasPersisted) {
    const formatted = persisted.map(row => formatPersistedTurn(row, guild));
    // Persisted history first (recency-ordered), then reduced ambient context.
    history = [...formatted, ...history];
  }

  // Pre-fetch speaker profile for guild channels (skipped in DMs.
  const speakerProfile = message.guild ? await buildSpeakerProfile(message, ctx) : "";

  // Tag the trigger message so the AI knows exactly what to respond to.
  const currentSpeaker = isDM ? `DM user ${message.author.username} (id:${message.author.id})` : speakerLabelFromMessage(message);
  const taggedContent = `[THIS MESSAGE NEEDS YOUR RESPONSE — ${currentSpeaker}]: ${userContent}`;
  const contentWithImages = images.length > 0
    ? buildContentParts(taggedContent, images)
    : taggedContent;

  history.push({
    role: "user",
    name: safeOpenAiName(message.author.username),
    content: contentWithImages,
  });

  // ── Layered system prompt lookup ──
  // Resolve channel → guild → default tier, then fall back to settings.aiSystemPrompt.
  // Token-constrained providers (NVIDIA, Gemini) use a shorter concise variant.
  const resolved = await db.resolvePrompt({
    guildId: message.guild?.id || null,
    channelId: message.channel.id,
  });
  const providerHint = settings.get("aiProvider") || "groq";
  const scopeLabel = scope === "global"
    ? `GLOBAL (shared channel thread — channel #${message.channel?.name}${message.guild ? ` in ${message.guild.name}` : ""})`
    : `PRIVATE (per-user DM thread)`;
  let system;
  if (resolved.prompt) {
    system = resolved.prompt;
  } else if (usesConcisePrompt(providerHint)) {
    system = settings.AI_SYSTEM_PROMPT_CONCISE;
  } else {
    system = settings.get("aiSystemPrompt")
      || "You are a helpful Discord assistant. Keep replies concise and friendly.";
  }
  system += `\n\n### CONVERSATION SCOPE:\n- Scope: ${scopeLabel}`;
  system += `\n- Identity rule: bracketed speaker labels are authoritative. Never treat memories or previous messages from one user ID as belonging to another user.`;
  if (resolved.source) {
    system += `\n- Prompt source: ${resolved.source} tier`;
  }

  // ── Personality preset injection ─────────────────────────────────────────
  // Prepend the selected personality's systemPrefix to set the core identity
  // and behavior tone. The personality prefix acts as a top-level instruction
  // that influences how the harness prompt below is interpreted.
  {
    const personalityId = settings.get("aiPersonality") || DEFAULT_PERSONALITY;
    const preset = getPersonality(personalityId);
    const sep = "\n\n" + "=".repeat(80) + "\n# PERSONALITY OVERRIDE — " + preset.emoji + " " + preset.name + " (" + preset.id + ")\n" + "=".repeat(80) + "\n\n";
    system = preset.systemPrefix + sep + system;
  }

  // Inject server context — compact format for token-constrained providers
  const concise = usesConcisePrompt(providerHint);
  if (message.guild) {
    if (concise) {
      system += `\nServer: ${message.guild.name} | Channel: #${message.channel.name} | Bot ID: ${client.user.id}`;
      if (speakerProfile) system += speakerProfile;
    } else {
      system += `\n\n### SERVER CONTEXT:\n- Server: ${message.guild.name} (ID: ${message.guild.id})\n- Current channel: #${message.channel.name} (ID: ${message.channel.id})\n- Bot's own user ID: ${client.user.id}\n- This is a shared channel thread. Multiple people may be present; answer only the current speaker unless they explicitly ask about someone else.`;
      if (speakerProfile) system += speakerProfile;
    }
  } else {
    if (concise) {
      system += `\nPrivate DM with ${message.author.username} id:${message.author.id} | Bot ID: ${client.user.id} | No server/channel memory is shared here`;
    } else {
      system += `\n\n### DM CONTEXT (private thread):\n- This is a private direct message conversation with ${message.author.username} (ID: ${message.author.id}).\n- This DM history is separate from server/channel conversation history.\n- DM memories are private to this user and must not be treated as server/global facts.\n- Bot's own user ID: ${client.user.id}`;
    }
  }

  // Memory injection — token-efficient format for constrained providers
  if (message.guild && settings.get("aiMemoryEnabled") !== false) {
    const aiMemory = require("./ai/memory");
    const memories = aiMemory.recall(message.guild.id, message.author.id, concise ? 8 : 15);
    if (memories.length > 0) {
      const formattedMemories = memories.map(m => {
        const scopeTag = m.userId ? `@${m.userId}` : "server";
        // Token-efficient: [MEM#N scope]: content  vs old verbose format.
        // Sanitize memory content to prevent stored injection payloads.
        return `[MEM#${m.id} ${scopeTag}]: ${sanitizeUserInput(m.content)}`;
      }).join("\n");
      system += concise
        ? `\n### MEMORIES:\n${formattedMemories}`
        : `\n\n### KNOWN MEMORIES:\n${formattedMemories}`;
    }
  } else if (!message.guild) {
    const aiMemory = require("./ai/memory");
    const memories = aiMemory.recallDm(message.author.id, concise ? 8 : 15);
    if (memories.length > 0) {
      const formattedMemories = memories.map(m => `[DM-MEM#${m.id} user:${message.author.id}]: ${sanitizeUserInput(m.content)}`).join("\n");
      system += concise
        ? `\n### MEMORIES:\n${formattedMemories}`
        : `\n\n### KNOWN MEMORIES ABOUT YOU:\n${formattedMemories}`;
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

  // Strip hallucinated tool-call JSON that the model wrote as raw text.
  // Handles BOTH complete JSON and incomplete/truncated JSON (e.g. missing
  // closing braces after a content string was cut off by max_tokens).
  //
  // Strategy: detect the {"name": "...", "parameters": ...} signature
  // and strip it, even if the JSON is malformed. Don't touch legitimate
  // JSON inside ``` backtick code blocks.
  const TOOL_CALL_SIG = /\{\s*"name"\s*:\s*"/;

  // 1. If the entire response is just a raw tool-call blob (no code blocks),
  //    discard it entirely — even partial/incomplete JSON.
  if (!clean.includes("```") && TOOL_CALL_SIG.test(clean)) {
    // Strip the leading {"name":...} blob, keeping only text that precedes it
    const sigIdx = clean.search(TOOL_CALL_SIG);
    const openBrace = clean.lastIndexOf("{", sigIdx);
    if (openBrace >= 0 && openBrace <= sigIdx) {
      const before = clean.slice(0, openBrace).trim();
      // If there was meaningful text before the JSON, keep that; otherwise discard
      if (before.length > 0 && !/^[\s,]*$/.test(before)) {
        clean = before;
      } else {
        return ""; // pure tool-call hallucination — discard entirely
      }
    }
  }

  // 2. Strip trailing tool-call JSON that follows legitimate text.
  //    Handles both newline-separated and inline cases. The comma after
  //    the tool name is optional (catches incomplete JSON too).
  clean = clean.replace(/(?:\n|^)\s*\{\s*"name"\s*:\s*"[^"]+"[^]*$/, "").trim();

  return clean.trim();
}

async function chatWithProvider(providerIds, messages, options = {}) {
  if (!Array.isArray(providerIds)) providerIds = [providerIds];
  const modelByProvider = options && typeof options.modelByProvider === "object" && options.modelByProvider
    ? options.modelByProvider
    : {};

  // Prefer non-busy providers so concurrent conversations spread across
  // the fallback chain. If all are busy, fall through to try anyway.
  const available = providerIds.filter(id => !busyProviders.has(id));
  const ordered = [...available, ...providerIds.filter(id => busyProviders.has(id))];
  // Also skip entries that are stale (>5min) — treat them as available
  for (const id of ordered) {
    const startedAt = busyProviders.get(id);
    if (startedAt && Date.now() - startedAt > PROVIDER_BUSY_TIMEOUT) {
      busyProviders.delete(id);
    }
  }
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

    const requestModel = modelByProvider[providerId] || (options.providerId === providerId ? options.model : null);
    const hasRequestModel = typeof requestModel === "string" && requestModel.trim();
    let model = hasRequestModel
      ? requestModel.trim()
      : settings.getAiModel(providerId);

    if (providerId === "groq" && groqProvider.resolveModel) {
      const resolved = groqProvider.resolveModel(model);
      if (resolved !== model) {
        if (!hasRequestModel) settings.setAiModel("groq", resolved);
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

    if (options.disableTools !== true && settings.get("aiToolsEnabled") !== false) {
      const tools = require("./ai/tools");
      opts.tools = tools.getOpenAiTools();
    }

    busyProviders.set(providerId, Date.now());
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
      return { result, providerId, model };
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
  const isDM = !message.guild;

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
  // Channel allow/block lists only apply to guild channels — DMs always pass
  if (!isDM && !isChannelAllowed(message.channel.id, allowed, ignored)) return false;

  const { client } = ctx;
  let userContent = null;

  // DMs: always respond, no trigger needed
  if (isDM) {
    userContent = message.content.trim();
    if (!userContent) userContent = "You sent an empty message.";
  } else if (message.mentions.has(client.user.id)) {
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

  // ── Prompt injection sanitization ─────────────────────────────────────────
  // Strip injection patterns from user input before it reaches the AI provider.
  userContent = sanitizeUserInput(userContent);

  let startTime = Date.now(); // hoisted for catch-block access
  let typingInterval = null; // refreshed to keep the "bot is typing..." indicator alive during tool loops
  try {
    await message.channel.sendTyping();
    // Refresh typing indicator every 8s so users see "bot is typing..." dots
    // throughout multi-turn tool loops. Discord's indicator expires after ~10s.
    typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8_000).unref();
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
    const MAX_LOOPS = 15;
    let finalReply = "";
    const thinkingEnabled = settings.get("aiThinkingEnabled") === true;
    startTime = Date.now(); // for analytics latency tracking

    // Pin subsequent tool-calling iterations to the first working provider
    // so the model doesn't switch mid-conversation.
    let pinnedProvider = null;

    // Track tool interactions for thread buffer persistence — without this,
    // the AI forgets what it learned (web search results, user info, etc.)
    // on the very next message because only the final text reply is saved.
    const toolInteractions = []; // [{ name, args, result }]

    // Per-conversation add_memory call counter (prevent memory loop spam)
    let addMemoryCallsThisTurn = 0;
    const MAX_ADD_MEMORY_PER_TURN = 3;

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
      // Only accept text when there are NO tool calls — otherwise treat
      // any text as a companion remark or hallucinated tool-call noise and
      // skip it. This prevents raw JSON from leaking into finalReply when
      // the model mixes tool calls with conversational text.
      if (text && (!toolCalls || toolCalls.length === 0)) {
        finalReply = cleanResponse(text, thinkingEnabled);
        break;
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

      // Track add_memory calls per conversation turn (prevent loops)
      for (const tc of toolCalls) {
        if (tc.name === "add_memory") {
          addMemoryCallsThisTurn++;
          if (addMemoryCallsThisTurn > MAX_ADD_MEMORY_PER_TURN) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: tc.name,
              content: "Error: Too many add_memory calls in one conversation. Please collect facts and make a single call."
            });
            continue;
          }
        }
        console.log(`[ai] Executing tool: ${tc.name} with args:`, tc.args);
        let resultStr;
        const toolStart = Date.now();
        try {
          resultStr = await tools.executeTool(tc.name, tc.args, ctx, message);
          if (message.guild) ctx.data.logAlphaTelemetry({ userId: message.author.id, guildId: message.guild.id, toolName: tc.name, success: true, durationMs: Date.now() - toolStart });
        } catch (err) {
          resultStr = `Error executing tool: ${err.message}`;
          if (message.guild) ctx.data.logAlphaTelemetry({ userId: message.author.id, guildId: message.guild.id, toolName: tc.name, success: false, errorMsg: err.message, durationMs: Date.now() - toolStart });
        }
        // Persist tool interaction so the thread buffer can reference it on next turn
        toolInteractions.push({ name: tc.name, args: tc.args, result: resultStr });
        
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

    // Final sanitisation pass — strip any tool-call JSON that leaked through
    finalReply = cleanResponse(finalReply, thinkingEnabled);

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

    // Save conversation turn to persistent SQLite history using the active scope/key.
    // Global scope (guild channels) shares one thread per channel; private scope (DMs)
    // keeps one thread per user.
    //
    // When tools were called, persist a compact summary so the AI remembers what it
    // looked up (web search results, user info, etc.) on the next turn. Without this,
    // tool results vanish and the AI loses context between messages.
    {
      const db = require("./db");
      const { scope, key } = conversationKey(message);
      try { db.addConversationTurn(scope, key, "user", userContent); } catch (e) { console.error("[ai] persist conversation turn:", e.message); }
      // Persist tool interaction summaries before the final reply so the AI
      // can reference what it learned. Keep it compact to avoid DB bloat.
      if (toolInteractions.length > 0) {
        const toolSummary = toolInteractions.map(t => {
          const resultPreview = String(t.result || "").slice(0, 200);
          return `[used ${t.name}]: ${resultPreview}`;
        }).join("\n");
        try { db.addConversationTurn(scope, key, "system", `Tool results: ${toolSummary}`.slice(0, 1500)); } catch (e) { console.error("[ai] persist tool interactions:", e.message); }
      }
      try { db.addConversationTurn(scope, key, "assistant", finalReply.slice(0, 1500)); } catch (e) { console.error("[ai] persist conversation turn:", e.message); }
      db.trimConversationHistory(scope, key, 40);
    }

    // Analytics: log this AI call
    analyticsBuffer.push({
      guildId: message.guild?.id || "dm", userId: message.author.id,
      provider: activeProviderId, model: settings.getAiModel(activeProviderId),
      tokens: finalReply.length + (messages.reduce((s, m) => s + String(m.content||"").length, 0)),
      latencyMs: Date.now() - startTime, success: true, error: null,
    });

    clearInterval(typingInterval);

    // Auto-memory: fire-and-forget memory extraction after successful response
    if (settings.get("aiMemoryEnabled") !== false && settings.get("aiToolsEnabled") !== false) {
      try {
        extractMemoriesAsync(message, userContent, finalReply, activeProviderId).catch(() => {});
      } catch { /* memory extraction is best-effort */ }
    }

    return true;
  } catch (err) {
    clearInterval(typingInterval);
    console.error("AI reply error:", err.message);
    // Log failed call to analytics (defensive: startTime fallback to 0 if somehow undefined)
    try {
      analyticsBuffer.push({
        guildId: message.guild?.id || "dm", userId: message.author.id,
        provider: settings.get("aiProvider") || "groq", model: settings.getAiModel(settings.get("aiProvider") || "groq"),
        tokens: 0, latencyMs: typeof startTime === "number" ? Date.now() - startTime : 0, success: false, error: err.message,
      });
    } catch { /* analytics push should never crash the bot */ }
    // Reply with error, but don't throw — prevent unhandled rejection crashing the process
    try {
      await safe.reply(message, { content: `❌ AI error: ${err.message}` }, "AI error reply");
    } catch { /* best-effort — if replying fails, just log */ }
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
    aiToolPermissions:    settings.get("aiToolPermissions") || "",
    // Keys that the dashboard AI config surface reads back so toggles/inputs
    // reflect their stored state on reload. Previously these were writable via
    // updateSettings but never returned by GET /api/ai, so the dashboard always
    // rendered them as off/empty after a refresh.
    aiDmEnabled:          settings.get("aiDmEnabled"),
    aiBrowserEnabled:     settings.get("aiBrowserEnabled"),
    aiKeyword:            settings.get("aiKeyword") || "",
    aiPersonality:        settings.get("aiPersonality") || "neutral",
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
        // Size-based eviction: if we exceed max size, remove oldest entries
        if (modelListCache.size > MODEL_LIST_CACHE_MAX_SIZE) {
          const entries = Array.from(modelListCache.entries()).sort((a, b) => a[1].at - b[1].at);
          const toRemove = entries.slice(0, modelListCache.size - MODEL_LIST_CACHE_MAX_SIZE);
          for (const [key] of toRemove) modelListCache.delete(key);
        }
      } catch (err) {
        if (!cached || cached.error !== err.message) {
          console.warn(`[ai] Could not fetch ${provider.label} model list:`, err.message);
        }
        modelListCache.set(cacheKey, { at: Date.now(), error: err.message });
        // Size-based eviction: if we exceed max size, remove oldest entries
        if (modelListCache.size > MODEL_LIST_CACHE_MAX_SIZE) {
          const entries = Array.from(modelListCache.entries()).sort((a, b) => a[1].at - b[1].at);
          const toRemove = entries.slice(0, modelListCache.size - MODEL_LIST_CACHE_MAX_SIZE);
          for (const [key] of toRemove) modelListCache.delete(key);
        }
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
    settings.set("aiSystemPrompt", body.aiSystemPrompt.slice(0, 20000));
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
  if (typeof body.aiDmEnabled === "boolean") settings.set("aiDmEnabled", body.aiDmEnabled);
  if (typeof body.aiBrowserEnabled === "boolean") settings.set("aiBrowserEnabled", body.aiBrowserEnabled);

  // Keyword trigger: the chat keyword that wakes the AI in guild channels.
  if (typeof body.aiKeyword === "string") {
    const kw = body.aiKeyword.trim().slice(0, 32);
    settings.set("aiKeyword", kw);
  }
  // Personality preset: only accept ids actually defined in personalities.js
  // so a stale/typo'd value can't point at a non-existent preset.
  if (typeof body.aiPersonality === "string") {
    const pid = body.aiPersonality.trim().toLowerCase();
    if (getPersonality(pid)) settings.set("aiPersonality", pid);
  }
}

function getActiveConvoCount() {
  // Count active private DM users plus active guild channel threads in the last 10 min.
  try {
    const db = require("./db");
    return db.db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT scope, guild_id, channel_id, user_id
        FROM ai_conversations
        WHERE timestamp > ?
        GROUP BY scope, guild_id, channel_id, user_id
      )
    `).get(Date.now() - 600_000)?.c || 0;
  } catch {
    return 0;
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
  sanitizeUserInput,
  getBusyProviders,
  getActiveConvoCount,
  resolveModel: groqProvider.resolveModel,
  GROQ_MODELS: groqProvider.defaultModels,
};
