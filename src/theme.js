// Per-guild theme store + themed embed factory. Follows the standard module
// pattern: in-memory authoritative cache, async load() at startup, writes
// persist to SQLite in the background.
//
// Every embed the bot sends should come through here so guilds get their own
// colors / footer / tone. `src` is polymorphic: a guild id string, a Message,
// an Interaction, a Guild, or null (null renders the built-in defaults).
//
// NOTE: this module must never require ./utils (utils requires us for its
// embed factories); ./tone is required lazily where needed.
const { EmbedBuilder } = require("discord.js");
const db = require("./db");
const settings = require("./settings");

const EMOJI_STYLES = ["pack", "classic", "minimal"];
const CLASSIC_EMOJI = { success: "✅", error: "❌", warn: "⚠️", info: "ℹ️", loading: "⏳" };
const COLOR_KINDS = ["success", "error", "info", "warn", "accent"];

// Defaults intentionally mirror the colors previously hardcoded across the
// codebase, so an unthemed guild renders exactly as before.
function themeDefaults() {
  return {
    tone: "neutral",
    colors: {
      success: 0x00c776,
      error: 0xed4245,
      info: 0x5865f2,
      warn: 0xfee75c,
      accent: 0xeb459e,
    },
    footer: { enabled: false, text: null },
    emojiStyle: "classic",
  };
}

let store = {};

async function load() {
  try {
    store = {};
    const rows = await db.getAllThemeConfigs();
    for (const row of rows) {
      store[row.guild_id] = db.safeJsonParse(row.config, {});
    }
  } catch (e) {
    console.error("Failed to load theme config from db:", e);
    store = {};
  }
}

function resolveGuildId(src) {
  if (!src) return null;
  if (typeof src === "string") return src;
  return src.guildId ?? src.guild?.id ?? src.id ?? null;
}

function getTheme(src) {
  const guildId = resolveGuildId(src);
  const base = themeDefaults();
  const saved = guildId ? store[guildId] : null;
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    colors: { ...base.colors, ...(saved.colors || {}) },
    footer: { ...base.footer, ...(saved.footer || {}) },
  };
}

function setTheme(guildId, patch) {
  const current = store[guildId] || {};
  const next = {
    ...current,
    ...patch,
    colors: { ...(current.colors || {}), ...(patch.colors || {}) },
    footer: { ...(current.footer || {}), ...(patch.footer || {}) },
  };
  store[guildId] = next;
  db.setThemeConfig(guildId, next).catch(e => console.error("persist theme:", e.message));
  return getTheme(guildId);
}

function resetTheme(guildId) {
  delete store[guildId];
  db.setThemeConfig(guildId, {}).catch(e => console.error("persist theme:", e.message));
  return getTheme(guildId);
}

function color(src, kind) {
  const t = getTheme(src);
  return t.colors[kind] ?? t.colors.info;
}

function emojiFor(src, kind) {
  const t = getTheme(src);
  if (t.emojiStyle === "minimal") return "";
  if (t.emojiStyle === "classic") return CLASSIC_EMOJI[kind] ?? "";
  const tone = require("./tone");
  return tone.emoji(resolveGuildId(src), kind);
}

function applyFooter(embedBuilder, src, guildName = null) {
  const t = getTheme(src);
  if (!t.footer.enabled) return embedBuilder;
  const name = guildName ?? (typeof src === "object" ? src?.guild?.name : null);
  const text = (t.footer.text || "{guild}").replace("{guild}", name || "");
  if (text.trim()) embedBuilder.setFooter({ text: text.slice(0, 2048) });
  return embedBuilder;
}

// Base themed embed. kind: success|error|info|warn|accent.
function embed(src, kind = "info", description = null) {
  const e = new EmbedBuilder().setColor(color(src, kind));
  if (description) e.setDescription(description);
  return applyFooter(e, src);
}

function withEmoji(src, kind, msg) {
  const em = emojiFor(src, kind);
  return em ? `${em} ${msg}` : msg;
}

const success = (src, msg) => embed(src, "success", withEmoji(src, "success", msg));
const error   = (src, msg) => embed(src, "error", withEmoji(src, "error", msg));
const info    = (src, msg) => embed(src, "info", withEmoji(src, "info", msg));
const warn    = (src, msg) => embed(src, "warn", withEmoji(src, "warn", msg));

// Permission-denied embed. A guild-agnostic global override (settings
// noPermMsg) wins over the tone pack, preserving existing behavior.
function noPerm(src) {
  const overridden = settings.get("noPermMsg");
  let msg;
  if (overridden && overridden !== settings.DEFAULTS.noPermMsg) {
    msg = overridden;
  } else {
    const tone = require("./tone");
    msg = tone.t(resolveGuildId(src), "deny.permission");
  }
  return error(src, msg);
}

// Embed whose text comes from a tone key: theme.say(msg, "error", "error.generic")
function say(src, kind, toneKey, vars = {}) {
  const tone = require("./tone");
  const factory = { success, error, info, warn }[kind] || info;
  return factory(src, tone.t(resolveGuildId(src), toneKey, vars));
}

module.exports = {
  load, getTheme, setTheme, resetTheme, themeDefaults,
  color, embed, success, error, info, warn, noPerm, say,
  emojiFor, resolveGuildId,
  EMOJI_STYLES, COLOR_KINDS,
};
