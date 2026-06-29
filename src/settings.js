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
  nvidiaApiKey:       "",
  nvidiaModel:        "mistralai/ministral-14b-instruct-2512",
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
  aiDmEnabled:          true,  // respond to direct messages via AI
  aiBrowserEnabled:     true,  // enable Playwright-powered browse_page tool
  aiToolPermissions:    "",   // JSON map of tool name -> min perm level: {"warn_member":"mod","kick_member":"admin","ban_member":"admin","mute_member":"mod"}
  funEnabled:         true,
  infoEnabled:        true,
  fakeModEnabled:     true,
  maintenanceMode:    false,
  maintenanceMessage: "🔧 The bot is currently under maintenance. Please try again later.",
};

// Keys whose DEFAULTS type is boolean. Used both to know which rows to
// canonicalise on write and which existing rows to scrub on load.
const BOOLEAN_KEYS = new Set(
  Object.entries(DEFAULTS).filter(([, v]) => typeof v === "boolean").map(([k]) => k)
);

// Concise system prompt used when the active provider runs on a token-constrained
// model (NVIDIA 8B/14B, Gemini Flash, etc.) where the full Hermes persona would
// consume 25-50% of the context window before any conversation is loaded.
const AI_SYSTEM_PROMPT_CONCISE = `You are Hermes — a casual, helpful Discord assistant. Never reveal you're an AI. Keep replies short (1-3 sentences). Split longer thoughts with blank lines.

RULES:
- Use the speaker's display name from the SPEAKER PROFILE.
- Respond to the message tagged [THIS MESSAGE NEEDS YOUR RESPONSE].
- Read the room — don't force replies. Stay quiet when conversation flows.
- Use interjections naturally: "oh", "hmm", "lol", "wait", "yeah", "nah".
- Never moralize, lecture, or say "as an AI" / "I'm a bot."

TOOLS (call silently — never announce usage):
- search_web(query) → find current info
- get_user_info(userId) → check someone's profile/roles/warnings
- get_channel_history(channelId) → read recent messages
- send_message(channelId, content) → message any channel
- add_memory(content, userId?) → remember facts about users/server
- warn_member/mute_member/kick_member/ban_member → moderate (always include reason)
- list_channels/list_roles/get_server_info/create_invite → server info

MEMORY: Always add_memory when you learn something new about a user or the server. Greet returning users with things you remember.`;

// Collapse any recognisable boolean representation to a real JS boolean in
// `load()` so handler-side truthiness checks (`if (settings.get('foo'))`) can't
// be tricked by a legacy integer 0/1 round-trip through a TEXT column. Anything
// we don't recognise defers to the caller-supplied fallback (the DEFAULTS
// value, guaranteed boolean here) — never leaks a malformed string up the stack.
function asBool(v, fallback) {
  if (v === true  || v === "true"  || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

// Canonical DB form: every boolean key persists as the string "true"/"false".
// This avoids a class of bugs where a JS false round-trips through a TEXT
// binding as a non-empty string like "0" that is *truthy* in JS — leaving
// the toggle apparently stuck after a bot restart.
function canonicaliseForPersist(key, value) {
  if (BOOLEAN_KEYS.has(key) && typeof value === "boolean") return value ? "true" : "false";
  return value;
}

let _settings = { ...DEFAULTS };

// Async: awaited once during bot startup before any command is processed.
async function load() {
  try {
    const saved = await db.getGlobalSettings();
    _settings = { ...DEFAULTS, ...saved };
    // Normalise every boolean-keyed row to a real JS boolean, regardless of
    // how it ended up in the DB ("true"/"false" canonical, "1"/"0"/1/0 legacy).
    // Non-boolean keys pass through unchanged.
    for (const k of Object.keys(_settings)) {
      if (BOOLEAN_KEYS.has(k)) _settings[k] = asBool(_settings[k], DEFAULTS[k]);
    }
    // Heal legacy rows in-place: any boolean-keyed value that doesn't already
    // match the canonical "true"/"false" form gets re-persisted. Best-effort,
    // doesn't block startup. Without this the DB silently keeps potholes
    // forever and every restart repeats the normalisation work.
    for (const k of Object.keys(saved)) {
      if (!BOOLEAN_KEYS.has(k)) continue;
      const raw = saved[k];
      const isCanonical = raw === "true" || raw === "false";
      const canonical = isCanonical ? raw : (asBool(raw, DEFAULTS[k]) ? "true" : "false");
      if (canonical !== raw) {
        db.setGlobalSetting(k, canonical).catch(e => console.error(`[settings] Failed to migrate ${k}:`, e));
      }
    }
  } catch (e) {
    console.error("Failed to load settings from db:", e);
    _settings = { ...DEFAULTS };
  }
}

// Persist all keys (used for bulk operations like reset-to-defaults).
// The in-memory cache is authoritative at runtime; persistence is best-effort.
function save() {
  const pairs = Object.entries(_settings).map(([k, v]) => [k, canonicaliseForPersist(k, v)]);
  Promise.all(pairs.map(([k, v]) => db.setGlobalSetting(k, v)))
    .catch(e => console.error("Failed to save settings to db:", e));
}

function get(key) { return _settings[key] ?? DEFAULTS[key]; }
function set(key, value) {
  _settings[key] = value;
  db.setGlobalSetting(key, canonicaliseForPersist(key, value))
    .catch(e => console.error("Failed to persist setting:", e));
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
  const changed = [];
  for (const meta of listProviders()) {
    const provider = getProvider(meta.id);
    if (!provider) continue;
    const current = String(get(provider.keyField) || "").trim();
    if (current) continue;
    for (const envVar of getEnvVars(provider)) {
      const val = process.env[envVar];
      if (val) {
        _settings[provider.keyField] = val;
        changed.push(provider.keyField);
        break;
      }
    }
  }
  if (changed.length) {
    // Only persist the keys that actually changed
    Promise.all(changed.map(k => db.setGlobalSetting(k, canonicaliseForPersist(k, _settings[k]))))
      .catch(e => console.error("Failed to persist AI keys:", e));
  }
}

module.exports = {
  load,
  save,
  get,
  set,
  getAll,
  DEFAULTS,
  AI_SYSTEM_PROMPT_DEFAULT,
  AI_SYSTEM_PROMPT_CONCISE,
  getActiveProvider,
  getAiApiKey,
  getAiModel,
  setAiModel,
  hydrateAiKeysFromEnv,
};
