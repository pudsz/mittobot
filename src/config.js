const fs   = require("fs");
const path = require("path");
const { PermissionFlagsBits } = require("discord.js");
const { OWNER_IDS } = require("./utils");
const db = require("./db");

const CONFIG_FILE = path.join(__dirname, "..", "commandconfig.json");

// ─── Permission levels (ordered ladder; higher number = more privileged) ───
const PERM_LEVELS = {
  everyone: 0,
  booster:  1,
  mod:      2,
  admin:    3,
  owner:    4,
};
const PERM_LABELS = {
  everyone: "Everyone",
  booster:  "Server Booster",
  mod:      "Moderator (Manage Messages)",
  admin:    "Administrator",
  owner:    "Bot Owner",
};
const PERM_ORDER = Object.keys(PERM_LEVELS);

// Compute a member's effective level from their Discord permissions / roles.
function memberLevel(member, userId) {
  if (OWNER_IDS.has(userId)) return PERM_LEVELS.owner;
  if (!member) return PERM_LEVELS.everyone;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return PERM_LEVELS.admin;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return PERM_LEVELS.mod;
  if (member.premiumSince) return PERM_LEVELS.booster;
  return PERM_LEVELS.everyone;
}

// ─── Store: per-guild, per-command overrides. Shape:
// { [guildId]: { [commandName]: { enabled, permission, allowedRoles[], allowedChannels[], blockedChannels[], cooldown, settings{} } } }
let store = {};

async function load() {
  try {
    store = {};
    const rows = await db.getAllCommandConfigs();
    for (const row of rows) {
      const g = (store[row.guild_id] ??= {});
      g[row.command] = {
        enabled: row.enabled === 1,
        permission: row.permission,
        allowedRoles: db.safeJsonParse(row.allowed_roles, []),
        allowedChannels: db.safeJsonParse(row.allowed_channels, []),
        blockedChannels: db.safeJsonParse(row.blocked_channels, []),
        cooldown: row.cooldown,
        settings: db.safeJsonParse(row.settings, {}),
      };
    }
  } catch (e) {
    console.error("Failed to load command config from db:", e);
    store = {};
  }
}
function save() {}

// Raw stored override for a command (may be undefined / partial).
function getRaw(guildId, command) {
  return store[guildId]?.[command] || {};
}

// Merge a command's compiled defaults with the stored override.
// `def` is the command definition (provides defaultPermission, category, etc.).
function resolve(guildId, command, def = {}) {
  const raw = getRaw(guildId, command);
  return {
    enabled:         raw.enabled !== undefined ? raw.enabled : true,
    permission:      raw.permission || def.defaultPermission || "everyone",
    allowedRoles:    raw.allowedRoles || [],
    allowedChannels: raw.allowedChannels || [],
    blockedChannels: raw.blockedChannels || [],
    cooldown:        raw.cooldown || 0, // seconds, per-user
    settings:        { ...(def.defaultSettings || {}), ...(raw.settings || {}) },
  };
}

function set(guildId, command, patch) {
  (store[guildId] ??= {})[command] ??= {};
  Object.assign(store[guildId][command], patch);
  const cfg = resolve(guildId, command);
  db.setCommandConfig(guildId, command, cfg).catch(e => console.error("persist command config:", e.message));
}

// Merge into a command's `settings` bag without clobbering siblings.
function setSetting(guildId, command, key, value) {
  (store[guildId] ??= {})[command] ??= {};
  (store[guildId][command].settings ??= {})[key] = value;
  const cfg = resolve(guildId, command);
  db.setCommandConfig(guildId, command, cfg).catch(e => console.error("persist command config:", e.message));
}

function reset(guildId, command) {
  if (store[guildId]) {
    delete store[guildId][command];
    db.deleteCommandConfig(guildId, command).catch(e => console.error("reset command config:", e.message));
  }
}

// ─── Cooldown tracking (in-memory; resets on restart) ───
// key: `${guildId}:${command}:${userId}` -> timestamp(ms) when cooldown expires
const cooldowns = new Map();
const COOLDOWNS_MAX_SIZE = 5000; // Maximum number of cooldown entries to track

// Evict expired entries every 15 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, until] of cooldowns) {
    if (now >= until) cooldowns.delete(key);
  }
  // Size-based eviction: if we exceed max size, remove oldest entries
  if (cooldowns.size > COOLDOWNS_MAX_SIZE) {
    const entries = Array.from(cooldowns.entries()).sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, cooldowns.size - COOLDOWNS_MAX_SIZE);
    for (const [key] of toRemove) cooldowns.delete(key);
  }
}, 15 * 60_000).unref();

// Returns remaining seconds if on cooldown, or 0 if clear (and arms the cooldown).
function checkCooldown(guildId, command, userId, seconds, now) {
  if (!seconds) return 0;
  const key = `${guildId}:${command}:${userId}`;
  const until = cooldowns.get(key) || 0;
  if (now < until) return Math.ceil((until - now) / 1000);
  cooldowns.set(key, now + seconds * 1000);
  return 0;
}

// ─── Central access decision. Returns { ok: true } or { ok: false, reason }.
// `member` may be null (e.g. uncached); level then resolves to everyone.
function evaluate({ guildId, command, def, member, userId, channelId, now }) {
  const cfg = resolve(guildId, command, def);

  if (!cfg.enabled) return { ok: false, reason: "disabled", cfg };

  // Channel gating
  if (cfg.blockedChannels.length && cfg.blockedChannels.includes(channelId))
    return { ok: false, reason: "channel", cfg };
  if (cfg.allowedChannels.length && !cfg.allowedChannels.includes(channelId))
    return { ok: false, reason: "channel", cfg };

  // Permission gating: either meet the level, or hold one of the allowed roles.
  const needed = PERM_LEVELS[cfg.permission] ?? 0;
  const have   = memberLevel(member, userId);
  const roleOk = cfg.allowedRoles.length && member?.roles?.cache?.some(r => cfg.allowedRoles.includes(r.id));
  if (have < needed && !roleOk) return { ok: false, reason: "permission", cfg };

  // Cooldown (owners bypass)
  if (have < PERM_LEVELS.owner) {
    const remain = checkCooldown(guildId, command, userId, cfg.cooldown, now);
    if (remain > 0) return { ok: false, reason: "cooldown", remain, cfg };
  }

  return { ok: true, cfg };
}

module.exports = {
  load, save,
  getRaw, resolve, set, setSetting, reset,
  evaluate, memberLevel,
  PERM_LEVELS, PERM_LABELS, PERM_ORDER,
  CONFIG_FILE,
};
