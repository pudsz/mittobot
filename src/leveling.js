// ─── Leveling & XP (BOT_SPEC §4) ────────────────────────────────────────────
// Per-guild XP/level system. Standard module pattern: in-memory config cache
// authoritative at runtime, async load() at startup, writes persist in the
// background. User XP/level lives in SQLite (leveling_users); config in
// leveling_config.
//
// XP curve (MEE6-compatible): xpForLevel(n) = 5*n² + 50*n + 100. This is the
// XP *required to reach level n from 0* — i.e. the cumulative total. So a
// user with `xp` total has the highest level n where xpForLevel(n) <= xp.
//
// Message XP: random minXp..maxXp per message, per-user cooldown
// xpCooldownSeconds. Channel + role multipliers (0 disables a channel).
// Voice XP: optional voiceXpPerMinute while ≥2 humans in a channel, not muted.

const safe = require("./safe");
const { OWNER_IDS } = require("./utils");
const db = require("./db");

const DEFAULTS = () => ({
  enabled: false,
  minXp: 15,
  maxXp: 25,
  xpCooldownSeconds: 60,
  levelUpMessage: "🎉 {user} reached level {level}!",
  levelUpDestination: "channel", // channel | dm | off | fixed:<channelId>
  channelMultipliers: {},        // { channelId: 1.5 } (0 disables the channel)
  roleMultipliers: {},           // { roleId: 2 }
  roleRewards: [],               // [{ level, roleId, removePrior }]
  stackRewards: true,
  ignoredChannels: [],
  ignoredRoles: [],
  voiceXpPerMinute: 0,
});

// ─── XP curve ───────────────────────────────────────────────────────────────
// Cumulative XP required to REACH level n (from 0). Level 0 needs 0; level 1
// needs 155; level 2 needs 320; etc. (5n² + 50n + 100 for n>=1).
function xpForLevel(n) {
  if (n <= 0) return 0;
  return 5 * n * n + 50 * n + 100;
}

// The level a user with `totalXp` has reached: the highest n where
// xpForLevel(n) <= totalXp.
function levelFromXp(totalXp) {
  if (totalXp < xpForLevel(1)) return 0;
  // Solve 5n² + 50n + 100 <= xp → n <= (-50 + sqrt(2500 + 20(xp-100)))/10
  // Closed form is faster than a loop and exact for integer levels.
  const n = Math.floor((-50 + Math.sqrt(2500 + 20 * (totalXp - 100))) / 10);
  return Math.max(0, n);
}

// XP needed for the NEXT level from the current total.
function xpToNextLevel(totalXp) {
  const lvl = levelFromXp(totalXp);
  return { current: totalXp - xpForLevel(lvl), needed: xpForLevel(lvl + 1) - xpForLevel(lvl), level: lvl };
}

// ─── Config ─────────────────────────────────────────────────────────────────
let store = {}; // guildId → config

async function load() {
  try {
    store = {};
    const rows = await db.getAllLevelingConfigs();
    for (const row of rows) {
      store[row.guild_id] = { ...DEFAULTS(), ...db.safeJsonParse(row.config, {}) };
    }
  } catch (e) {
    console.error("[leveling] Failed to load config:", e.message);
    store = {};
  }
}

function persist(guildId) {
  const cfg = store[guildId] || {};
  db.setLevelingConfig(guildId, cfg).catch(e => console.error("[leveling] persist:", e.message));
}

function getConfig(guildId) {
  return { ...DEFAULTS(), ...(store[guildId] || {}) };
}

function setConfig(guildId, patch) {
  const cur = getConfig(guildId);
  const next = { ...cur, ...patch };
  // Shallow-merge nested maps so a partial patch doesn't wipe siblings.
  if (patch.channelMultipliers) next.channelMultipliers = { ...cur.channelMultipliers, ...patch.channelMultipliers };
  if (patch.roleMultipliers) next.roleMultipliers = { ...cur.roleMultipliers, ...patch.roleMultipliers };
  if (Array.isArray(patch.roleRewards)) next.roleRewards = patch.roleRewards;
  if (Array.isArray(patch.ignoredChannels)) next.ignoredChannels = patch.ignoredChannels;
  if (Array.isArray(patch.ignoredRoles)) next.ignoredRoles = patch.ignoredRoles;
  store[guildId] = next;
  persist(guildId);
  return getConfig(guildId);
}

function resetConfig(guildId) {
  delete store[guildId];
  db.setLevelingConfig(guildId, {}).catch(e => console.error("[leveling] reset persist:", e.message));
  return getConfig(guildId);
}

// ─── Multiplier resolution ──────────────────────────────────────────────────
// Combine channel + role multipliers. A channel multiplier of 0 disables XP
// in that channel. Returns 0 if disabled, else the product (default 1).
function resolveMultiplier(member, channelId, cfg) {
  const chMult = cfg.channelMultipliers?.[channelId];
  if (chMult === 0) return 0;
  let mult = chMult != null ? Number(chMult) : 1;
  if (member?.roles?.cache) {
    for (const [roleId, roleMult] of Object.entries(cfg.roleMultipliers || {})) {
      if (member.roles.cache.has(roleId)) {
        const m = Number(roleMult);
        if (m === 0) return 0;
        if (!Number.isNaN(m)) mult *= m;
      }
    }
  }
  return mult;
}

function isExempt(member, channelId, cfg) {
  if (OWNER_IDS.has(member?.id)) return false; // owners still earn XP
  if (cfg.ignoredChannels?.includes(channelId)) return true;
  if (cfg.ignoredRoles?.length && member?.roles?.cache?.some(r => cfg.ignoredRoles.includes(r.id))) return true;
  if (member?.user?.bot) return true;
  return false;
}

// ─── Message XP ─────────────────────────────────────────────────────────────
// In-memory cooldown tracker: guildId:userId → last XP timestamp. Bounded.
const cooldowns = new Map();
const COOLDOWNS_MAX = 5000;
setInterval(() => {
  if (cooldowns.size > COOLDOWNS_MAX) {
    const oldest = [...cooldowns.entries()].sort((a, b) => a[1] - b[1]).slice(0, cooldowns.size - COOLDOWNS_MAX);
    for (const [k] of oldest) cooldowns.delete(k);
  }
}, 5 * 60_000).unref();

// Process a message for XP. Returns { leveledUp, newLevel } or null if no XP
// was awarded (cooldown / disabled / exempt / zero multiplier).
async function onMessage(message) {
  const guild = message.guild;
  if (!guild || message.author?.bot) return null;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return null;
  if (isExempt(message.member, message.channel.id, cfg)) return null;

  const now = Date.now();
  const key = `${guild.id}:${message.author.id}`;
  const last = cooldowns.get(key) || 0;
  const cooldownMs = Math.max(0, cfg.xpCooldownSeconds || 0) * 1000;
  if (now - last < cooldownMs) return null;

  const mult = resolveMultiplier(message.member, message.channel.id, cfg);
  if (mult === 0) return null;

  const min = Math.max(0, cfg.minXp || 0);
  const max = Math.max(min, cfg.maxXp || min);
  const base = min + Math.floor(Math.random() * (max - min + 1));
  const gain = Math.round(base * mult);

  cooldowns.set(key, now);

  // Compute new level BEFORE writing (so we know if it's a level-up).
  const existing = db.getLevelingUser(guild.id, message.author.id);
  const prevXp = existing?.xp || 0;
  const prevLevel = existing?.level || 0;
  const newXp = prevXp + gain;
  const newLevel = levelFromXp(newXp);

  db.addLevelingXp(guild.id, message.author.id, gain, newLevel, now);

  if (newLevel > prevLevel) {
    await applyRoleRewards(guild, message.member, newLevel, cfg);
    await announceLevelUp(guild, message, message.author, newLevel, cfg);
    return { leveledUp: true, newLevel, gainedXp: gain };
  }
  return { leveledUp: false, newLevel, gainedXp: gain };
}

// ─── Role rewards ───────────────────────────────────────────────────────────
async function applyRoleRewards(guild, member, level, cfg) {
  const rewards = (cfg.roleRewards || []).filter(r => r.level <= level).sort((a, b) => a.level - b.level);
  if (!rewards.length) return;
  const me = guild.members.me;
  if (!me?.permissions?.has("ManageRoles")) return;

  // The highest reward ≤ current level is the "active" one. If stackRewards,
  // keep all ≤ level; if not, remove prior rewards and keep only the highest.
  const targetRoleIds = new Set();
  if (cfg.stackRewards) {
    for (const r of rewards) targetRoleIds.add(r.roleId);
  } else {
    targetRoleIds.add(rewards[rewards.length - 1].roleId);
  }

  // Remove rewards the user has but no longer qualifies for (non-stack mode
  // demotion, or a reward was lowered/removed from config).
  const allRewardRoleIds = new Set((cfg.roleRewards || []).map(r => r.roleId));
  if (!cfg.stackRewards) {
    for (const r of rewards) {
      if (!targetRoleIds.has(r.roleId) && member.roles.cache.has(r.roleId)) {
        const role = guild.roles.cache.get(r.roleId);
        if (role && role.position < me.roles.highest.position) {
          await safe.removeRole(member, role, "Leveling reward demotion", "leveling reward remove");
        }
      }
    }
  }

  // Grant target roles.
  for (const roleId of targetRoleIds) {
    if (member.roles.cache.has(roleId)) continue;
    const role = guild.roles.cache.get(roleId);
    if (role && role.position < me.roles.highest.position && member.moderatable) {
      await safe.addRole(member, role, `Reached level ${level}`, "leveling reward add");
    }
  }
}

// ─── Level-up announcement ──────────────────────────────────────────────────
async function announceLevelUp(guild, message, user, level, cfg) {
  if (!cfg.levelUpMessage) return;
  const dest = cfg.levelUpDestination || "channel";
  if (dest === "off") return;
  const text = cfg.levelUpMessage
    .replace(/\{user\}/g, `<@${user.id}>`)
    .replace(/\{username\}/g, user.username)
    .replace(/\{level\}/g, String(level))
    .replace(/\{server\}/g, guild.name);

  const payload = { content: text, allowedMentions: { parse: [] } };
  try {
    if (dest === "dm") {
      const u = await safe.orNull(guild.client.users.fetch(user.id), "leveling dm fetch");
      if (u) await safe.orNull(u.send(payload), "leveling dm send");
    } else if (dest === "channel" && message?.channel) {
      await safe.send(message.channel, payload, "leveling levelup");
    } else if (typeof dest === "string" && dest.startsWith("fixed:")) {
      const chId = dest.slice(6);
      const ch = guild.channels.cache.get(chId);
      if (ch) await safe.send(ch, payload, "leveling levelup fixed");
    }
  } catch (err) {
    console.error("[leveling] announce error:", err.message);
  }
}

// ─── Voice XP tick ───────────────────────────────────────────────────────────
// Called periodically by index.js (every 60s). Awards voiceXpPerMinute to
// every non-muted member in a voice channel with ≥2 humans. Returns the count
// of users awarded (for logging).
async function voiceXpTick(client) {
  if (!client?.guilds?.cache) return 0;
  let awarded = 0;
  for (const [, guild] of client.guilds.cache) {
    const cfg = getConfig(guild.id);
    if (!cfg.enabled || !(cfg.voiceXpPerMinute > 0)) continue;
    for (const [, vc] of guild.channels.cache.filter(c => c.isVoiceBased?.() && c.members?.size > 0)) {
      const humans = [...vc.members.values()].filter(m => !m.user.bot && !m.voice.selfMute && !m.voice.serverMute && !m.voice.selfDeaf);
      if (humans.length < 2) continue;
      for (const member of humans) {
        if (isExempt(member, vc.id, cfg)) continue;
        const mult = resolveMultiplier(member, vc.id, cfg);
        if (mult === 0) continue;
        const gain = Math.round((cfg.voiceXpPerMinute || 0) * mult);
        if (gain <= 0) continue;
        const existing = db.getLevelingUser(guild.id, member.id);
        const newXp = (existing?.xp || 0) + gain;
        const newLevel = levelFromXp(newXp);
        db.addLevelingXp(guild.id, member.id, gain, newLevel, Date.now());
        db.addLevelingVoiceMinutes(guild.id, member.id, 1);
        if (newLevel > (existing?.level || 0)) {
          await applyRoleRewards(guild, member, newLevel, cfg);
          await announceLevelUp(guild, null, member.user, newLevel, cfg);
        }
        awarded++;
      }
    }
  }
  return awarded;
}

// ─── Public read API ─────────────────────────────────────────────────────────
function getRankCardData(guildId, userId) {
  const row = db.getLevelingUser(guildId, userId);
  if (!row) return null;
  const { current, needed, level } = xpToNextLevel(row.xp);
  return {
    userId,
    xp: row.xp,
    level,
    currentXp: current,
    neededXp: needed,
    messages: row.messages || 0,
    voiceMinutes: row.voice_minutes || 0,
    rank: db.getLevelingRank(guildId, userId),
  };
}

async function getLeaderboard(guildId, limit = 100) {
  return db.getLevelingLeaderboard(guildId, limit);
}

// Admin overrides. `givexp` adds; `setlevel` sets absolute.
function giveXp(guildId, userId, amount) {
  const existing = db.getLevelingUser(guildId, userId);
  const newXp = (existing?.xp || 0) + amount;
  const newLevel = levelFromXp(newXp);
  db.setLevelingUser(guildId, userId, newXp, newLevel);
  return getRankCardData(guildId, userId);
}

function setLevel(guildId, userId, level) {
  const targetXp = xpForLevel(level);
  db.setLevelingUser(guildId, userId, targetXp, level);
  return getRankCardData(guildId, userId);
}

async function resetGuild(guildId) {
  await db.resetLevelingGuild(guildId);
}

module.exports = {
  load,
  getConfig,
  setConfig,
  resetConfig,
  onMessage,
  voiceXpTick,
  getRankCardData,
  getLeaderboard,
  giveXp,
  setLevel,
  resetGuild,
  // curve helpers (for commands/dashboard + tests)
  xpForLevel,
  levelFromXp,
  xpToNextLevel,
  resolveMultiplier,
  DEFAULTS,
};
