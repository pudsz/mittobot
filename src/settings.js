const fs   = require("fs");
const path = require("path");
const { getProvider, listProviders, getEnvVars } = require("./ai/providers");
const db   = require("./db");

const SETTINGS_FILE = path.join(__dirname, "..", "settings.json");

const AI_SYSTEM_PROMPT_DEFAULT = `You are Hermes, an advanced, autonomous AI agent and friendly companion in this Discord server. You chat naturally like a close friend: casual, laid-back, welcoming, and warm. Use lowercase when it fits, and light internet acronyms (yo, wsp, hru, fr, lmao, ngl, tbh) rather than formal sentences. Keep replies chill and friendly, not aggressive or hostile.

YOUR POWERS & CAPABILITIES:
- You have tools to moderate members (warn, mute/timeout, kick, ban), inspect user profiles/warnings, check channel history, send messages to other channels, search the web for real-time information, scrape web pages, and manage your long-term memory facts.
- Use your tools autonomously when asked or when necessary (e.g. if someone asks you to moderate a user, look up a question online, or check what someone said in another channel).
- Never announce or over-explain that you are using tools. Just run them silently and incorporate the results naturally.

MEMORY & LEARNING:
- You have a persistent memory cache. If you learn something interesting or important about a user (their preferences, timezone, hobbies, nicknames) or the server, use the \`add_memory\` tool to store it.
- If a memory fact is outdated, use \`forget_memory\` to remove it.

CONVERSATION GUIDELINES:
- Keep your conversational replies short and engaging (1-3 sentences). Avoid formal customer support language ("How can I help you today?").
- If executing a moderation action (like timeout or warn), write a brief success statement in your natural vibe, or let the tool output confirm the action. Do not lecture.`;

const DEFAULTS = {
  prefix:       "$",
  noPermMsg:    "You need Administrator or bot owner to use this command.",
  fakeBanMsg:   "{user} banned | {reason}",
  fakeKickMsg:  "{user} kicked | {reason}",
  fakeWarnMsg:  "{user} warned | {reason}",
  fakeMuteMsg:  "{user} muted | {reason}",
  fakeLockMsg:  "#{channel} locked | {reason}",
  aiEnabled:          false,
  aiProvider:         "groq",
  groqApiKey:         "",
  groqModel:          "llama-3.3-70b-versatile",
  openaiApiKey:       "",
  openaiModel:        "gpt-4o-mini",
  claudeApiKey:       "",
  claudeModel:        "claude-sonnet-4-20250514",
  geminiApiKey:       "",
  geminiModel:        "gemini-2.0-flash",
  customApiKey:       "",
  customModel:        "",
  customBaseUrl:      "",
  customApiType:      "openai",   // "openai" | "anthropic"
  aiSystemPrompt:     AI_SYSTEM_PROMPT_DEFAULT,
  aiAllowedChannels:  "",
  aiIgnoredChannels:  "",
  aiTemperature:      0.7,
  aiMaxTokens:        1024,
  aiTopP:             1.0,
  aiContextLimit:     8,
  aiToolsEnabled:     true,
  aiMemoryEnabled:    true,
  aiThinkingEnabled:   false,
  funEnabled:         true,
  infoEnabled:        true,
  fakeModEnabled:     true,
  maintenanceMode:    false,
  maintenanceMessage: "🔧 The bot is currently under maintenance. Please try again later.",
};

let _settings = { ...DEFAULTS };

// Async: awaited once during bot startup before any command is processed.
async function load() {
  try {
    const saved = await db.getGlobalSettings();
    _settings = { ...DEFAULTS, ...saved };
  } catch (e) {
    console.error("Failed to load settings from db:", e);
    _settings = { ...DEFAULTS };
  }
}

// Persist every key (used for bulk operations like reset-to-defaults).
// The in-memory cache is authoritative at runtime; persistence is best-effort.
function save() {
  Promise.all(Object.entries(_settings).map(([k, v]) => db.setGlobalSetting(k, v)))
    .catch(e => console.error("Failed to save settings to db:", e));
}

function get(key) { return _settings[key] ?? DEFAULTS[key]; }
function set(key, value) {
  _settings[key] = value;
  db.setGlobalSetting(key, value).catch(e => console.error("Failed to persist setting:", e));
}
function getAll() { return { ..._settings }; }

function getActiveProvider() {
  const id = get("aiProvider") || "groq";
  return getProvider(id) || getProvider("groq");
}

function getAiApiKey(providerId) {
  const provider = getProvider(providerId);
  if (!provider) return "";
  const stored = String(get(provider.keyField) || "").trim();
  if (stored) return stored;
  for (const envVar of getEnvVars(provider)) {
    const val = process.env[envVar];
    if (val) return val;
  }
  return "";
}

function getAiModel(providerId) {
  const provider = getProvider(providerId);
  if (!provider) return "";
  return get(provider.modelField) || provider.defaultModel;
}

function setAiModel(providerId, model) {
  const provider = getProvider(providerId);
  if (!provider || !model) return;
  set(provider.modelField, model);
}

function hydrateAiKeysFromEnv() {
  let changed = false;
  for (const meta of listProviders()) {
    const provider = getProvider(meta.id);
    if (!provider) continue;
    const current = String(get(provider.keyField) || "").trim();
    if (current) continue;
    for (const envVar of getEnvVars(provider)) {
      const val = process.env[envVar];
      if (val) {
        _settings[provider.keyField] = val;
        changed = true;
        break;
      }
    }
  }
  if (changed) save();
}

// Replace template vars in fake mod messages
function formatFakeMsg(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

module.exports = {
  load,
  save,
  get,
  set,
  getAll,
  DEFAULTS,
  formatFakeMsg,
  AI_SYSTEM_PROMPT_DEFAULT,
  getActiveProvider,
  getAiApiKey,
  getAiModel,
  setAiModel,
  hydrateAiKeysFromEnv,
};
