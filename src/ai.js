const settings = require("./settings");
const { getProvider, listProviders } = require("./ai/providers");
const groqProvider = require("./ai/providers/groq");
const { processMessageImages, buildContentParts } = require("./ai/images");

const safe = require("./safe");

const MAX_REPLY_LEN = 2000;

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

async function getChannelContext(message, client, limit = 8) {
  if (limit <= 0) return [];
  try {
    const fetched = await safe.orNull(message.channel.messages.fetch({ limit: limit + 2 }), "fetch channel context");
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
          content: `[${authorTag}]: ${m.content}`
        };
      }
    });
  } catch (err) {
    console.error("Failed to fetch channel context:", err);
    return [];
  }
}

async function buildMessageHistory(message, ctx, limit = 8, userContent, images = []) {
  const { client } = ctx;
  const history = await getChannelContext(message, client, limit);
  
  // If there are images, embed them inline as content parts
  const authorTag = message.member?.displayName || message.author.username;
  const taggedContent = `[${authorTag}]: ${userContent}`;
  const contentWithImages = images.length > 0
    ? buildContentParts(taggedContent, images)
    : taggedContent;

  history.push({
    role: "user",
    name: message.author.username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    content: contentWithImages
  });

  let system = settings.get("aiSystemPrompt") || "You are a helpful Discord assistant. Keep replies concise and friendly.";
  
  if (settings.get("aiMemoryEnabled") !== false) {
    const aiMemory = require("./ai/memory");
    const memories = aiMemory.recall(message.guild.id, message.author.id, 15);
    if (memories.length > 0) {
      const formattedMemories = memories.map(m => {
        const scope = m.userId ? `User <@${m.userId}>` : "Server/General";
        return `- [Fact #${m.id}] (${scope}): ${m.content}`;
      }).join("\n");
      system += `\n\n### KNOWN MEMORIES / FACTS:\n${formattedMemories}\nUse these facts to personalize your responses. If a fact is outdated or no longer true, you can delete it using forget_memory. If you learn something new and important about a user or server, use add_memory to save it.`;
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

async function chatWithProvider(providerId, messages) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);

  const apiKey = settings.getAiApiKey(providerId);
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

  return provider.chat(messages, opts);
}

async function handleAiMessage(message, ctx) {
  if (!settings.get("aiEnabled")) return false;

  // Maintenance mode — skip AI responses entirely
  const mm = settings.get("maintenanceMode");
  if ((mm === true || mm === "true") && !ctx.utils?.isOwner(message.author.id)) return false;

  const providerId = settings.get("aiProvider") || "groq";
  const apiKey = settings.getAiApiKey(providerId);
  if (!apiKey) return false;

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
    return false;
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

    while (loopCount < MAX_LOOPS) {
      const response = await chatWithProvider(providerId, messages);
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

    const chunks = splitMessage(finalReply);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) await message.reply(chunks[i]);
      else await message.channel.send(chunks[i]);
    }
    return true;
  } catch (err) {
    console.error("AI reply error:", err.message);
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
}

module.exports = {
  handleAiMessage,
  getPublicSettings,
  getPublicSettingsAsync,
  updateSettings,
  chatWithProvider,
  resolveModel: groqProvider.resolveModel,
  GROQ_MODELS: groqProvider.defaultModels,
};
