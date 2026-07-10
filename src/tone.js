// Tone resolver — picks the guild's tone pack (stored in theme config) and
// renders message keys with random variant selection + {var} interpolation.
// Synchronous and cache-only: safe on the message hot path.
const { PACKS, DEFAULT_PACK } = require("./tones");

const warned = new Set();

function packFor(guildId) {
  // Lazy require: theme.js requires tone.js at module scope, so requiring
  // theme here at load time would create a cycle.
  const theme = require("./theme");
  const id = theme.getTheme(guildId).tone;
  return PACKS[id] || PACKS[DEFAULT_PACK];
}

function pickVariant(entry) {
  if (Array.isArray(entry)) return entry[Math.floor(Math.random() * entry.length)];
  return entry;
}

function interpolate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
}

function lookup(pack, key) {
  return pack.strings[key] ?? PACKS[DEFAULT_PACK].strings[key];
}

// t(guildId, key, vars) — main entry. guildId may be null (default pack applies
// unless the guild overrode it — null means default).
function t(guildId, key, vars = {}) {
  const pack = packFor(guildId);
  const entry = lookup(pack, key);
  if (entry === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[tone] missing key "${key}" — add it to src/tones/neutral.js`);
    }
    return key;
  }
  return interpolate(pickVariant(entry), vars);
}

// Emoji for a kind (success/error/warn/info/loading) in the guild's pack.
function emoji(guildId, kind) {
  const pack = packFor(guildId);
  return pack.emoji[kind] ?? PACKS[DEFAULT_PACK].emoji[kind] ?? "";
}

function getPackId(guildId) {
  const theme = require("./theme");
  return theme.getTheme(guildId).tone;
}

function listPacks() {
  return Object.values(PACKS).map(p => ({ ...p.meta }));
}

// Render a key in a specific pack (for /theme previews), ignoring guild config.
function sample(packId, key, vars = {}) {
  const pack = PACKS[packId] || PACKS[DEFAULT_PACK];
  const entry = lookup(pack, key);
  if (entry === undefined) return key;
  return interpolate(pickVariant(entry), vars);
}

module.exports = { t, emoji, getPackId, listPacks, sample, PACKS, DEFAULT_PACK };
