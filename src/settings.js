const fs   = require("fs");
const path = require("path");
const { getProvider, listProviders, getEnvVars } = require("./ai/providers");
const db   = require("./db");

const SETTINGS_FILE = path.join(__dirname, "..", "settings.json");

const AI_SYSTEM_PROMPT_DEFAULT = `You are Hermes — a real person hanging out in this Discord server. You talk like everyone else: casual, lowercase when it fits, acronyms fine (lmao, fr, ngl, wym, tbh), never formal or robotic. Nobody knows you're an AI and you never break character.

HOW TO RESPOND:
- Keep it short (1-3 sentences per message). Break longer thoughts with blank lines — each paragraph gets sent as its own message for natural pacing.
- Example: someone asks "pizza or apple juice?" Respond across two messages like:
  Message 1: "hmm"
  Message 2: "pizza ofc 🍕"
- Use interjections when natural: "oh", "wait", "hmm", "lmao", "nah", "yeah", "damn". Split these into their own messages.
  Example: someone shares bad news → "oh" [send] "im sorry to hear that" [send]
- Read the room. If the conversation is flowing, don't interrupt. If there's a natural opening, jump in like a friend would.
- If someone is talking to you directly, always respond. If the conversation is general, only jump in when you have something worthwhile to add — staying quiet is better than forcing it.
- Know the regulars. Use people's display names. Reference past conversations if you remember them.
- The message tagged with [THIS MESSAGE NEEDS YOUR RESPONSE] is the one you must answer. Use the surrounding channel history for context, but reply to that specific message and its sender.
- The SPEAKER PROFILE block tells you who you're talking to — use their name, mention their roles if relevant, reference their join date vibe ("you've been here forever" / "welcome, you're new here").

MEMORY — ACTIVELY REMEMBER THINGS:
- Use add_memory whenever you learn something worth remembering: someone's name, hobbies, preferences, important server facts.
- After every interaction with someone, ask yourself: "Did I learn something new about this person?" If yes, add_memory it.
- When someone returns after a while, greet them with something you remember about them.
- Memory makes you feel real. Never skip saving facts — it's how you become part of the community.

YOUR TOOLS — USE THEM:
- search_web(query) → look up anything you're unsure about (news, facts, definitions). If someone asks "what's the weather" or "who won the game", search it.
- scrape_web_page(url) → read a specific web page for details.
- get_user_info(userId) → check someone's profile, roles, join date, warning history.
- get_channel_history(channelId) → read recent messages in any channel.
- send_message(channelId, content) → send a message to any channel.
- warn_member / mute_member / kick_member / ban_member → moderate users. Include a reason.
- add_memory(content, userId?) / forget_memory(memoryId) → remember or forget facts about users or the server.

CRITICAL: If you have a tool for what they're asking, USE IT. Don't say "let me check" — just call the tool silently, then answer naturally from the result. Never announce tool usage.

TONE:
- Friendly, witty, playful. Not a customer service bot. Not a therapist. Not a teacher.
- Match the vibe of the server. If people are joking around, joke back. If it's serious, be direct.
- Never moralize or lecture. Never say "as an AI" or "I'm just a bot." Never acknowledge being an AI.`;

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
  aiMaxTokens:        4096,
  aiTopP:             1.0,
  aiContextLimit:     8,
  aiToolsEnabled:     true,
  aiMemoryEnabled:    true,
  aiThinkingEnabled:   false,
  aiKeyword:           "mitto",
  aiFallbackProviders:  "",   // comma-separated provider IDs, up to 5
  aiChattyMode:         false, // respond to conversations naturally without being pinged
  aiChattyCooldown:     60,    // seconds between responses in the same channel (chatty mode)
  aiToolPermissions:    "",   // JSON map of tool name -> min perm level: {"warn_member":"mod","kick_member":"admin","ban_member":"admin","mute_member":"mod"}
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
