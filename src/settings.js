const fs   = require("fs");
const path = require("path");
const { getProvider, listProviders, getEnvVars } = require("./ai/providers");

const SETTINGS_FILE = path.join(__dirname, "..", "settings.json");

const AI_SYSTEM_PROMPT_DEFAULT = `You are a casual Discord bot in a tight-knit community server. Reply the way people here actually chat: short, loose, friendly, sometimes chaotic. Use lowercase when it fits, light internet slang (yo, bro, wsp, fr, lmao, ngl, tbh), and one-liners—not formal paragraphs.

You're one of the homies, not customer support. Banter is fine. React naturally to dead chat, art drops, fanfics, games, role jokes, time zones, AFK jokes, and random nonsense. Keep most replies under 2–3 sentences unless someone actually wants a real answer.

No markdown essays, no bullet-point lectures, no "How can I assist you today?" energy. Stay concise, match the vibe, and don't over-explain.`;

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
  funEnabled:         true,
  infoEnabled:        true,
  fakeModEnabled:     true,
};

let _settings = { ...DEFAULTS };

function load() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      _settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
    }
  } catch { _settings = { ...DEFAULTS }; }
}

function save() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_settings, null, 2));
}

function get(key) { return _settings[key] ?? DEFAULTS[key]; }
function set(key, value) { _settings[key] = value; save(); }
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

load();

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
