const settings = require("./settings");
const { getProvider, listProviders } = require("./ai/providers");
const groqProvider = require("./ai/providers/groq");

const MAX_REPLY_LEN = 2000;

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

function buildMessages(userContent, replyContext) {
  const system = settings.get("aiSystemPrompt") || "You are a helpful Discord assistant. Keep replies concise and friendly.";
  const messages = [{ role: "system", content: system }];

  if (replyContext) {
    messages.push({ role: "assistant", content: replyContext });
  }

  messages.push({ role: "user", content: userContent });
  return messages;
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

  const opts = { apiKey, model };
  if (provider.baseUrlField) opts.baseUrl = settings.get(provider.baseUrlField);
  if (provider.apiTypeField) opts.apiType = settings.get(provider.apiTypeField);

  return provider.chat(messages, opts);
}

async function handleAiMessage(message, ctx) {
  if (!settings.get("aiEnabled")) return false;

  const providerId = settings.get("aiProvider") || "groq";
  const apiKey = settings.getAiApiKey(providerId);
  if (!apiKey) return false;

  const allowed = parseChannelList(settings.get("aiAllowedChannels"));
  const ignored = parseChannelList(settings.get("aiIgnoredChannels"));
  if (!isChannelAllowed(message.channel.id, allowed, ignored)) return false;

  const { client } = ctx;
  let userContent = null;
  let replyContext = null;

  if (message.mentions.has(client.user.id)) {
    userContent = stripBotMention(message.content, client.user.id);
    if (!userContent) userContent = "The user pinged you without a message. Greet them briefly.";
  } else if (message.reference?.messageId) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref?.author?.id !== client.user.id) return false;
    userContent = message.content.trim();
    if (!userContent) userContent = "The user replied to your message without text. Ask what they need.";
    if (ref.content) replyContext = ref.content.slice(0, 1500);
  } else {
    return false;
  }

  if (message.content.startsWith(ctx.utils.PREFIX)) return false;

  try {
    await message.channel.sendTyping();
    const reply = await chatWithProvider(providerId, buildMessages(userContent, replyContext));
    const chunks = splitMessage(reply);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) await message.reply(chunks[i]);
      else await message.channel.send(chunks[i]);
    }
    return true;
  } catch (err) {
    console.error("AI reply error:", err.message);
    await message.reply({ content: `❌ AI error: ${err.message}` }).catch(() => null);
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
    // Custom provider config (only meaningful when aiProvider === "custom")
    customBaseUrl:      settings.get("customBaseUrl"),
    customApiType:      settings.get("customApiType"),
    // backward compat for any old clients
    groqModel:          settings.get("groqModel"),
  };
}

async function getPublicSettingsAsync() {
  const base = getPublicSettings();
  const providerId = base.aiProvider;
  const provider = getProvider(providerId);
  if (!provider) return base;

  const key = settings.getAiApiKey(providerId);
  // Custom provider can list models without a key (e.g. local Ollama); others need one.
  const hasBaseUrl = provider.baseUrlField && settings.get(provider.baseUrlField);
  if ((key || hasBaseUrl) && typeof provider.listModels === "function") {
    try {
      const listOpts = {};
      if (provider.baseUrlField) listOpts.baseUrl = settings.get(provider.baseUrlField);
      if (provider.apiTypeField) listOpts.apiType = settings.get(provider.apiTypeField);
      base.models = await provider.listModels(key, listOpts);
      if (base.model && !base.models.includes(base.model)) {
        base.models = [base.model, ...base.models];
      }
    } catch (err) {
      console.warn(`[ai] Could not fetch ${provider.label} model list:`, err.message);
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
