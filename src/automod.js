const fs   = require("fs");
const path = require("path");
const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const safe = require("./safe");
const { OWNER_IDS } = require("./utils");
const db = require("./db");

const AUTOMOD_FILE = path.join(__dirname, "..", "automod.json");

// ─── Per-guild automod config. Shape:
// { [guildId]: { enabled, logChannelId, ignoredChannels[], ignoredRoles[], rules: { invites, bannedWords, spam, massMention, caps } } }
let store = {};
let exStore = {}; // extended automod config (in-memory cache)

const URL_RE = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu;
const ZALGO_RE = /[\u0300-\u036f\u0483-\u0489\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7-\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb-\u0ebc\u0ec8-\u0ecd\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86-\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u1dc0-\u1dff\u20d0-\u20ff\u2cef-\u2cf1\u2de0-\u2dff\u3099-\u309a\ua66f-\ua672\ua67c\ua67d\ua802\ua806\ua80b\ua825-\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31-\uaa32\uaa35-\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7-\uaab8\uaabe-\uaabf\uaac1\uabe3-\uabe5\uabe6-\uabea\uabec\uabed\ufb1e\ufe00-\ufe0f\ufe20-\ufe23\ufe26\ufe27\ufff9-\ufffb]/g;

// Per-rule defaults. `action` ∈ "delete" | "warn" | "mute".
const RULE_DEFAULTS = {
  invites:     { enabled: false, action: "delete" },
  bannedWords: { enabled: false, action: "delete", words: [] },
  spam:        { enabled: false, action: "mute", maxMessages: 5, perSeconds: 5, muteMs: 5 * 60_000 },
  massMention: { enabled: false, action: "delete", maxMentions: 5 },
  caps:        { enabled: false, action: "delete", minLength: 10, percent: 70 },
};

function guildDefaults() {
  return {
    enabled: false,
    logChannelId: null,
    ignoredChannels: [],
    ignoredRoles: [],
    rules: JSON.parse(JSON.stringify(RULE_DEFAULTS)),
    // Heat system (BOT_SPEC §3.2). Each rule violation adds heatValue; actions
    // trigger at thresholds. Disabled by default — opt in per guild.
    heat: {
      enabled: false,
      decayPerMinute: 5,
      thresholds: [
        { heat: 20, action: "warn" },
        { heat: 40, action: "mute", duration: "10m" },
        { heat: 80, action: "kick" },
      ],
    },
  };
}

async function load() {
  try {
    store = {};
    const rows = await db.getAllAutomodConfigs();
    startSpamCleanup();
    for (const row of rows) {
      store[row.guild_id] = {
        enabled: row.enabled === 1,
        logChannelId: row.log_channel_id,
        ignoredChannels: db.safeJsonParse(row.ignored_channels, []),
        ignoredRoles: db.safeJsonParse(row.ignored_roles, []),
        rules: db.safeJsonParse(row.rules, {}),
      };
    }
    // Load extended automod config
    exStore = {};
    const exRows = await db.query("SELECT * FROM automod_extended");
    for (const row of exRows) {
      exStore[row.guild_id] = {
        link_blacklist: db.safeJsonParse(row.link_blacklist, []),
        link_whitelist: db.safeJsonParse(row.link_whitelist, []),
        link_action: row.link_action || "delete",
        repeated_text: row.repeated_text === 1,
        repeated_text_count: row.repeated_text_count || 3,
        repeated_text_action: row.repeated_text_action || "delete",
        emoji_spam: row.emoji_spam === 1,
        emoji_max: row.emoji_max || 5,
        emoji_action: row.emoji_action || "delete",
        blocked_emojis_enabled: row.blocked_emojis_enabled === 1,
        blocked_emojis: db.safeJsonParse(row.blocked_emojis, []),
        blocked_emojis_action: row.blocked_emojis_action || "delete",
        blocked_reaction_emojis_enabled: row.blocked_reaction_emojis_enabled === 1,
        blocked_reaction_emojis: db.safeJsonParse(row.blocked_reaction_emojis, []),
        blocked_reaction_action: row.blocked_reaction_action || "delete",
        zalgo_enabled: row.zalgo_enabled === 1,
        zalgo_action: row.zalgo_action || "delete",
        // §3.1 new rule types
        regex_enabled: row.regex_enabled === 1,
        regex_patterns: db.safeJsonParse(row.regex_patterns, []),
        regex_action: row.regex_action || "delete",
        attachments_enabled: row.attachments_enabled === 1,
        attachments_blocked_exts: db.safeJsonParse(row.attachments_blocked_exts, []),
        attachments_max_size_mb: row.attachments_max_size_mb || 0,
        attachments_action: row.attachments_action || "delete",
        newlines_enabled: row.newlines_enabled === 1,
        newlines_max: row.newlines_max || 10,
        newlines_action: row.newlines_action || "delete",
        mentions_roles_enabled: row.mentions_roles_enabled === 1,
        mentions_roles_max: row.mentions_roles_max || 3,
        mentions_roles_action: row.mentions_roles_action || "delete",
      };
    }
  } catch (e) {
    console.error("Failed to load automod config from db:", e);
    store = {};
    exStore = {};
  }
}
function save() {}

function getExtendedConfig(guildId) {
  return exStore[guildId] || {
    link_blacklist: [],
    link_whitelist: [],
    link_action: "delete",
    repeated_text: false,
    repeated_text_count: 3,
    repeated_text_action: "delete",
    emoji_spam: false,
    emoji_max: 5,
    emoji_action: "delete",
    blocked_emojis_enabled: false,
    blocked_emojis: [],
    blocked_emojis_action: "delete",
    blocked_reaction_emojis_enabled: false,
    blocked_reaction_emojis: [],
    blocked_reaction_action: "delete",
    zalgo_enabled: false,
    zalgo_action: "delete",
    // §3.1 new rule types
    regex_enabled: false,
    regex_patterns: [],
    regex_action: "delete",
    attachments_enabled: false,
    attachments_blocked_exts: [],
    attachments_max_size_mb: 0,
    attachments_action: "delete",
    newlines_enabled: false,
    newlines_max: 10,
    newlines_action: "delete",
    mentions_roles_enabled: false,
    mentions_roles_max: 3,
    mentions_roles_action: "delete",
  };
}

function setExtendedConfig(guildId, patch) {
  const cur = getExtendedConfig(guildId);
  const next = { ...cur, ...patch };
  if (Array.isArray(patch.link_blacklist)) next.link_blacklist = patch.link_blacklist;
  if (Array.isArray(patch.link_whitelist)) next.link_whitelist = patch.link_whitelist;
  exStore[guildId] = next;
  db.setExtendedAutomod(guildId, next).catch(e => console.error("persist extended automod:", e.message));
  return next;
}

// Deep-merge stored config over defaults so new rule fields appear automatically.
function getConfig(guildId) {
  const base = guildDefaults();
  const saved = store[guildId];
  if (!saved) return base;
  const merged = { ...base, ...saved, rules: { ...base.rules } };
  for (const key of Object.keys(base.rules)) {
    merged.rules[key] = { ...base.rules[key], ...(saved.rules?.[key] || {}) };
  }
  return merged;
}

function setConfig(guildId, patch) {
  const cur = getConfig(guildId);
  const next = { ...cur, ...patch };
  if (patch.rules) {
    next.rules = { ...cur.rules };
    for (const [k, v] of Object.entries(patch.rules)) next.rules[k] = { ...cur.rules[k], ...v };
  }
  // Deep-merge heat so a partial patch (e.g. just toggling `enabled`) doesn't
  // wipe decayPerMinute / thresholds.
  if (patch.heat && typeof patch.heat === "object") {
    next.heat = { ...cur.heat, ...patch.heat };
    if (Array.isArray(patch.heat.thresholds)) next.heat.thresholds = patch.heat.thresholds;
  }
  store[guildId] = next;
  db.setAutomodConfig(guildId, next).catch(e => console.error("persist automod:", e.message));
  return next;
}

// ─── Spam tracker: per guild+user recent message timestamps (in-memory) ───
const spamTracker = new Map(); // key `${guildId}:${userId}` -> number[] timestamps
const SPAM_TRACKER_MAX_SIZE = 1000; // Maximum number of user spam histories to track

// Periodic cleanup: every 5 minutes, purge entries older than the longest window
const SPAM_CLEANUP_INTERVAL = 5 * 60_000;
const SPAM_MAX_WINDOW = 60_000; // 60s — clean entries older than this (safe upper bound for all spam windows)
let spamCleanupTimer = null;

function startSpamCleanup() {
  if (spamCleanupTimer) return;
  startHeatCleanup();
  spamCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - SPAM_MAX_WINDOW;
    for (const [key, timestamps] of spamTracker) {
      const valid = timestamps.filter(t => t > cutoff);
      if (valid.length === 0) spamTracker.delete(key);
      else spamTracker.set(key, valid);
    }
    // Size-based eviction: if we exceed max size, remove oldest entries
    if (spamTracker.size > SPAM_TRACKER_MAX_SIZE) {
      const entries = Array.from(spamTracker.entries()).sort((a, b) => {
        const aLatest = a[1].length ? a[1][a[1].length - 1] : 0;
        const bLatest = b[1].length ? b[1][b[1].length - 1] : 0;
        return aLatest - bLatest;
      });
      const toRemove = entries.slice(0, spamTracker.size - SPAM_TRACKER_MAX_SIZE);
      for (const [key] of toRemove) spamTracker.delete(key);
    }
  }, SPAM_CLEANUP_INTERVAL);
  spamCleanupTimer.unref();
}

function stopSpamCleanup() {
  if (spamCleanupTimer) {
    clearInterval(spamCleanupTimer);
    spamCleanupTimer = null;
  }
  stopHeatCleanup();
}

function trackSpam(guildId, userId, max, windowMs, now) {
  const key = `${guildId}:${userId}`;
  const arr = (spamTracker.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  spamTracker.set(key, arr);
  return arr.length > max;
}

// ─── Heat system (BOT_SPEC §3.2) ────────────────────────────────────────────
// Per-(guild,user) heat map. Decay is computed LAZILY on read (no timer ticking
// down every user every minute) — each entry stores its last-updated timestamp,
// and getHeat subtracts decayPerMinute * minutes-elapsed before returning.
//
// In-memory only (no table) — heat is transient. Bounded + periodic eviction so
// a long-lived process can't leak.
const heatMap = new Map(); // key `${guildId}:${userId}` -> { heat, updatedAt }
const HEAT_MAP_MAX_SIZE = 5000;
const HEAT_MAX_HEAT = 10_000; // sanity cap so a runaway can't overflow
const HEAT_CLEANUP_INTERVAL = 5 * 60_000;

// Lazily decay + return current heat for a (guild,user). Decays toward 0 based
// on elapsed minutes since the last update. Never goes negative.
function getHeat(guildId, userId, now = Date.now(), decayPerMinute = 5) {
  const key = `${guildId}:${userId}`;
  const entry = heatMap.get(key);
  if (!entry) return 0;
  const minutesElapsed = (now - entry.updatedAt) / 60_000;
  const decayed = entry.heat - decayPerMinute * minutesElapsed;
  const current = Math.max(0, decayed);
  if (current === 0) {
    heatMap.delete(key);
    return 0;
  }
  // Update the stored value + timestamp so subsequent reads don't re-decay.
  entry.heat = current;
  entry.updatedAt = now;
  return current;
}

// Add heat for a (guild,user) and return the post-add heat value. Saturates at
// HEAT_MAX_HEAT. Touches updatedAt so decay restarts from now.
function addHeat(guildId, userId, amount, now = Date.now(), decayPerMinute = 5) {
  const key = `${guildId}:${userId}`;
  const prior = getHeat(guildId, userId, now, decayPerMinute);
  const next = Math.min(HEAT_MAX_HEAT, prior + Math.max(0, amount));
  heatMap.set(key, { heat: next, updatedAt: now });
  return next;
}

// Find the highest threshold the user's current heat has reached (descending
// sort assumed; returns the first threshold whose heat <= current).
function thresholdHit(currentHeat, thresholds) {
  if (!Array.isArray(thresholds) || !thresholds.length) return null;
  const sorted = [...thresholds].sort((a, b) => (b.heat || 0) - (a.heat || 0));
  return sorted.find(t => currentHeat >= (t.heat || 0)) || null;
}

// Carry out a heat-threshold action on a member. Returns the action label or
// null if the member can't be acted on. Durations parse via the same format the
// real-mod commands use (s/m/h/d, capped at 28d).
const { parseDuration } = require("./utils");
async function enforceHeat(message, threshold, ruleName) {
  const action = threshold.action || "warn";
  const member = message.member;
  const me = message.guild.members.me;
  try {
    if (action === "mute") {
      if (!me.permissions.has(PermissionFlagsBits.ModerateMembers) || !member?.moderatable) return null;
      const ms = threshold.duration ? (parseDuration(threshold.duration) || 10 * 60_000) : 10 * 60_000;
      await safe.timeout(member, ms, `Automod heat: ${ruleName}`, `automod heat timeout: ${ruleName}`);
      return "mute";
    }
    if (action === "kick") {
      if (!me.permissions.has(PermissionFlagsBits.KickMembers) || !member?.kickable) return null;
      await safe.kick(member, `Automod heat: ${ruleName}`, `automod heat kick: ${ruleName}`);
      return "kick";
    }
    if (action === "ban") {
      if (!me.permissions.has(PermissionFlagsBits.BanMembers) || !member?.bannable) return null;
      await safe.ban(member, { reason: `Automod heat: ${ruleName}` }, `automod heat ban: ${ruleName}`);
      return "ban";
    }
    // warn — delete handled by the calling rule's enforce; just log.
    return "warn";
  } catch { return null; }
}

// Periodic eviction of stale/zero heat entries. unref'd.
let heatCleanupTimer = null;
function startHeatCleanup() {
  if (heatCleanupTimer) return;
  heatCleanupTimer = setInterval(() => {
    const now = Date.now();
    // Drop entries that have decayed to ~0 (older than (heat/decayPerMinute) min).
    // Simple heuristic: drop entries older than 2 hours — at decay 5/min, 600
    // heat decays in 2h, well past any practical threshold.
    const cutoff = now - 2 * 60 * 60_000;
    for (const [key, entry] of heatMap) {
      if (entry.updatedAt < cutoff) heatMap.delete(key);
    }
    if (heatMap.size > HEAT_MAP_MAX_SIZE) {
      const entries = Array.from(heatMap.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const toRemove = entries.slice(0, heatMap.size - HEAT_MAP_MAX_SIZE);
      for (const [key] of toRemove) heatMap.delete(key);
    }
  }, HEAT_CLEANUP_INTERVAL);
  heatCleanupTimer.unref();
}

function stopHeatCleanup() {
  if (heatCleanupTimer) { clearInterval(heatCleanupTimer); heatCleanupTimer = null; }
}

// ─── Detection helpers ───
const INVITE_RE = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-z0-9-]+/i;

function hasInvite(content) { return INVITE_RE.test(content); }

function hasBannedWord(content, words) {
  if (!words?.length) return false;
  const lower = content.toLowerCase();
  return words.some(w => w && lower.includes(w.toLowerCase()));
}

function capsRatio(content) {
  const letters = content.replace(/[^a-zA-Z]/g, "");
  if (!letters.length) return 0;
  const upper = content.replace(/[^A-Z]/g, "").length;
  return Math.round((upper / letters.length) * 100);
}

// ── Extended detection helpers ──
function hasBlacklistedLink(content, blacklist, whitelist) {
  const urls = content.match(URL_RE);
  if (!urls) return false;
  for (const url of urls) {
    const hostname = url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    // Check whitelist first — exempt domains allow all links from those domains
    if (whitelist?.length && whitelist.some(w => hostname.includes(w.toLowerCase()))) return false;
    // Check blacklist
    if (blacklist?.length && blacklist.some(b => hostname.includes(b.toLowerCase()))) return true;
  }
  return false;
}

function hasRepeatedText(content, threshold) {
  if (!content || content.length < threshold * 3) return false;
  // Check for same line/sentence repeated N+ times
  const lines = content.split(/[\n.]/).filter(l => l.trim().length > 3);
  const counts = {};
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    counts[trimmed] = (counts[trimmed] || 0) + 1;
    if (counts[trimmed] >= threshold) return true;
  }
  // Check for same single word repeated N+ times (like spam bots do)
  const words = content.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const wordCounts = {};
  for (const word of words) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
    if (wordCounts[word] >= threshold * 3) return true;
  }
  return false;
}

function emojiCount(content) {
  const matches = content.match(EMOJI_RE);
  return matches ? matches.length : 0;
}

function normalizeEmojiToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const custom = raw.match(/^<a?:([^:>\s]+):(\d+)>$/);
  if (custom) return custom[2];
  const nameId = raw.match(/^[^:>\s]+:(\d+)$/);
  if (nameId) return nameId[1];
  if (/^\d{5,}$/.test(raw)) return raw;
  return raw.toLowerCase();
}

function emojiAliasesFromReactionEmoji(emoji) {
  const out = new Set();
  if (!emoji) return out;
  if (emoji.id) {
    out.add(emoji.id);
    if (emoji.name) out.add(`${emoji.name}:${emoji.id}`.toLowerCase());
    out.add(`<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`.toLowerCase());
  }
  if (emoji.name) out.add(emoji.name.toLowerCase());
  return out;
}

function emojiTokensFromContent(content) {
  const out = new Set();
  const customRe = /<a?:[^:>\s]+:(\d+)>/g;
  let m;
  while ((m = customRe.exec(content || ""))) out.add(m[1]);
  const matches = String(content || "").match(EMOJI_RE) || [];
  for (const match of matches) out.add(match.toLowerCase());
  return out;
}

function hasBlockedMessageEmoji(content, blocked) {
  if (!blocked?.length) return false;
  const tokens = emojiTokensFromContent(content);
  if (!tokens.size) return false;
  return blocked.some(e => {
    const normalized = normalizeEmojiToken(e);
    return normalized && tokens.has(normalized);
  });
}

function hasBlockedReactionEmoji(emoji, blocked) {
  if (!blocked?.length) return false;
  const aliases = emojiAliasesFromReactionEmoji(emoji);
  if (!aliases.size) return false;
  return blocked.some(e => {
    const normalized = normalizeEmojiToken(e);
    return normalized && aliases.has(normalized);
  });
}

function hasZalgo(content) {
  const matches = content.match(ZALGO_RE);
  if (!matches) return false;
  // If >20% of characters are combining marks, it's zalgo
  return matches.length > content.length * 0.2;
}

// ── §3.1 new rule detection helpers ─────────────────────────────────────────
// regex: compile-once with try/catch, cap at 10 patterns, only test against
// the first 2k chars (BOT_SPEC's "5 ms per-message regex budget" guard — a
// catastrophic-backtracking pattern can't blow up on a huge message).
const REGEX_TEST_CAP = 2000;
const REGEX_MAX_PATTERNS = 10;
const regexCache = new Map(); // pattern string → RegExp | null (null = invalid)
const REGEX_CACHE_MAX = 200;

function compileRegex(pattern) {
  if (typeof pattern !== "string" || !pattern.trim()) return null;
  if (regexCache.has(pattern)) return regexCache.get(pattern);
  let re = null;
  try { re = new RegExp(pattern, "i"); } catch { re = null; }
  if (regexCache.size > REGEX_CACHE_MAX) {
    const first = regexCache.keys().next().value;
    if (first) regexCache.delete(first);
  }
  regexCache.set(pattern, re);
  return re;
}

function matchesRegex(content, patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return false;
  const sample = String(content || "").slice(0, REGEX_TEST_CAP);
  for (const p of patterns.slice(0, REGEX_MAX_PATTERNS)) {
    const re = compileRegex(p);
    if (re && re.test(sample)) return true;
  }
  return false;
}

// newlines: count line breaks (LF + CRLF count as one each).
function countNewlines(content) {
  const c = String(content || "");
  if (!c) return 0;
  return (c.match(/\n/g) || []).length;
}

// Member is exempt if owner, has ManageMessages, or matches ignored role/channel.
function isExempt(message, cfg) {
  if (OWNER_IDS.has(message.author.id)) return true;
  if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (cfg.ignoredChannels.includes(message.channel.id)) return true;
  if (cfg.ignoredRoles.length && message.member?.roles.cache.some(r => cfg.ignoredRoles.includes(r.id))) return true;
  return false;
}

async function logAction(guild, cfg, message, ruleName, action) {
  if (!cfg.logChannelId) return;
  const ch = guild.channels.cache.get(cfg.logChannelId);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🛡️ Automod")
    .setDescription(`**Rule:** ${ruleName}\n**Action:** ${action}\n**User:** ${message.author.tag} (<@${message.author.id}>)\n**Channel:** <#${message.channel.id}>`)
    .addFields({ name: "Content", value: (message.content || "*[no text]*").slice(0, 1000) })
    .setTimestamp();
  safe.send(ch, { embeds: [embed] }, "automod log");
}

async function logReactionAction(guild, cfg, reaction, user, ruleName, action) {
  if (!cfg.logChannelId) return;
  const ch = guild.channels.cache.get(cfg.logChannelId);
  if (!ch) return;
  const emojiLabel = reaction.emoji?.id
    ? `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : reaction.emoji?.name || "unknown";
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🛡️ Automod")
    .setDescription(`**Rule:** ${ruleName}\n**Action:** ${action}\n**User:** ${user.tag || user.id} (<@${user.id}>)\n**Channel:** <#${reaction.message.channel.id}>\n**Emoji:** ${emojiLabel}`)
    .addFields({ name: "Message", value: `[Jump to message](${reaction.message.url})` })
    .setTimestamp();
  safe.send(ch, { embeds: [embed] }, "automod reaction log");
}

// Carry out a rule's action. Returns the action label that succeeded.
async function enforce(message, rule, ruleName) {
  const action = rule.action || "delete";
  try {
    if (action === "delete" || action === "warn" || action === "mute") {
      await safe.delete(message, "automod delete");
    }
    if (action === "mute") {
      const ms = rule.muteMs || 5 * 60_000;
      if (message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers) && message.member?.moderatable) {
        await safe.timeout(message.member, ms, `Automod: ${ruleName}`, `automod timeout: ${ruleName}`);
      }
    }
    if (action === "warn") {
      const warn = await safe.orNull(message.channel.send(`⚠️ <@${message.author.id}>, your message was removed (**${ruleName}**).`), `automod warn msg: ${ruleName}`);
      if (warn) setTimeout(() => safe.delete(warn, `automod warn delete: ${ruleName}`), 5000);
    }
  } catch { /* best-effort */ }
  return action;
}

async function enforceReaction(reaction, user, member, rule, ruleName) {
  const action = rule.action || "delete";
  try {
    await safe.orNull(reaction.users.remove(user.id), `automod remove reaction: ${ruleName}`);
    if (action === "mute") {
      const ms = rule.muteMs || 5 * 60_000;
      if (reaction.message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers) && member?.moderatable) {
        await safe.timeout(member, ms, `Automod: ${ruleName}`, `automod reaction timeout: ${ruleName}`);
      }
    }
    if (action === "kick") {
      if (reaction.message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers) && member?.kickable) {
        await safe.kick(member, `Automod: ${ruleName}`, `automod reaction kick: ${ruleName}`);
      }
    }
    if (action === "ban") {
      if (reaction.message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers) && member?.bannable) {
        await safe.ban(member, { reason: `Automod: ${ruleName}` }, `automod reaction ban: ${ruleName}`);
      }
    }
    if (action === "warn") {
      const warn = await safe.orNull(
        reaction.message.channel.send(`⚠️ <@${user.id}>, that reaction is not allowed (**${ruleName}**).`),
        `automod reaction warn msg: ${ruleName}`
      );
      if (warn) setTimeout(() => safe.delete(warn, `automod reaction warn delete: ${ruleName}`), 5000);
    }
  } catch { /* best-effort */ }
  return action;
}

// ─── Main entry: returns true if the message was acted on ───
async function checkMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const cfg = getConfig(message.guild.id);
  if (!cfg.enabled) return false;
  if (isExempt(message, cfg)) return false;
  const content = message.content || "";
  const now = Date.now();
  const R = cfg.rules;

  // `fire` centralizes enforce + log + heat so every rule block is one line and
  // heat accumulates identically across all of them. Returns true (acted).
  // `heatValue` defaults to 10 (matches RULE_DEFAULTS expectations); pass 0 to
  // skip heat for a rule that shouldn't add it.
  const heat = cfg.heat || {};
  const heatEnabled = heat.enabled === true;
  const decayPerMinute = Math.max(0, heat.decayPerMinute ?? 5);
  const fire = async (rule, ruleName, heatValue = 10) => {
    const action = await enforce(message, rule, ruleName);
    await logAction(message.guild, cfg, message, ruleName, action);
    // Best-effort trigger counter (BOT_SPEC §3.4). Never blocks the hot path.
    try { db.incrementAutomodStat(message.guild.id, ruleName).catch(() => {}); } catch {}
    if (heatEnabled && heatValue > 0) {
      try {
        const h = addHeat(message.guild.id, message.author.id, heatValue, now, decayPerMinute);
        const hit = thresholdHit(h, heat.thresholds);
        if (hit) {
          const heatAction = await enforceHeat(message, hit, ruleName);
          if (heatAction) {
            await logAction(message.guild, cfg, message, `Heat (${ruleName} → ${heatAction} @ ${hit.heat})`, heatAction);
          }
        }
      } catch (err) { console.error("[automod] heat error:", err.message); }
    }
    return true;
  };

  // Order matters: cheap text checks first, spam (stateful) last.
  if (R.invites.enabled && hasInvite(content)) {
    return await fire(R.invites, "Invite link");
  }
  if (R.bannedWords.enabled && hasBannedWord(content, R.bannedWords.words)) {
    return await fire(R.bannedWords, "Banned word");
  }
  if (R.massMention.enabled && message.mentions.users.size > (R.massMention.maxMentions || 5)) {
    return await fire(R.massMention, "Mass mention");
  }
  if (R.caps.enabled && content.length >= (R.caps.minLength || 10) && capsRatio(content) >= (R.caps.percent || 70)) {
    return await fire(R.caps, "Excessive caps");
  }

  // ── Extended automod checks (with configurable actions) ──
  const exCfg = getExtendedConfig(message.guild.id);
  if (exCfg.link_blacklist?.length && hasBlacklistedLink(content, exCfg.link_blacklist, exCfg.link_whitelist)) {
    return await fire({ action: exCfg.link_action || "delete" }, "Blacklisted link");
  }
  if (exCfg.repeated_text && hasRepeatedText(content, exCfg.repeated_text_count || 3)) {
    return await fire({ action: exCfg.repeated_text_action || "delete" }, "Repeated text");
  }
  if (exCfg.emoji_spam && emojiCount(content) > (exCfg.emoji_max || 5)) {
    return await fire({ action: exCfg.emoji_action || "delete" }, "Emoji spam");
  }
  if (exCfg.blocked_emojis_enabled && hasBlockedMessageEmoji(content, exCfg.blocked_emojis)) {
    return await fire({ action: exCfg.blocked_emojis_action || "delete" }, "Blocked emoji");
  }
  if (exCfg.zalgo_enabled && hasZalgo(content)) {
    return await fire({ action: exCfg.zalgo_action || "delete" }, "Zalgo/unicode abuse");
  }

  // ── §3.1 new rule types ──
  // regex: content-based, capped at 10 patterns × first 2k chars (5ms budget).
  if (exCfg.regex_enabled && exCfg.regex_patterns?.length && matchesRegex(content, exCfg.regex_patterns)) {
    return await fire({ action: exCfg.regex_action || "delete" }, "Regex match");
  }
  // newlines: wall-of-text guard.
  if (exCfg.newlines_enabled && countNewlines(content) > (exCfg.newlines_max || 10)) {
    return await fire({ action: exCfg.newlines_action || "delete" }, "Newline spam");
  }
  // attachments + mentions_roles need the message object (not in testRules).
  if (exCfg.attachments_enabled && message.attachments?.size > 0) {
    const blocked = exCfg.attachments_blocked_exts || [];
    const maxMb = exCfg.attachments_max_size_mb || 0;
    let tripped = false;
    for (const [, att] of message.attachments) {
      const name = (att.name || "").toLowerCase();
      const ext = name.slice(name.lastIndexOf(".") + 1);
      if (blocked.length && blocked.includes(ext)) { tripped = true; break; }
      if (maxMb > 0 && att.size > maxMb * 1024 * 1024) { tripped = true; break; }
    }
    if (tripped) return await fire({ action: exCfg.attachments_action || "delete" }, "Blocked attachment");
  }
  if (exCfg.mentions_roles_enabled && message.mentions.roles.size > (exCfg.mentions_roles_max || 3)) {
    return await fire({ action: exCfg.mentions_roles_action || "delete" }, "Mass role mention");
  }

  if (R.spam.enabled) {
    const tripped = trackSpam(message.guild.id, message.author.id, R.spam.maxMessages || 5, (R.spam.perSeconds || 5) * 1000, now);
    if (tripped) {
      return await fire(R.spam, "Spam");
    }
  }
  return false;
}

// ─── Test mode (BOT_SPEC §3.4) ──────────────────────────────────────────────
// Dry-run every content rule against `content` and return which would fire,
// WITHOUT enforcing (no delete, no mute, no warn) and WITHOUT heat/stats.
// Spam is skipped (it's stateful and can't be evaluated from a single string).
// `mentionCount` lets the caller simulate mass-mention; defaults to 0.
function testRules(guildId, content, { mentionCount = 0 } = {}) {
  const cfg = getConfig(guildId);
  const R = cfg.rules || {};
  const exCfg = getExtendedConfig(guildId);
  const text = String(content || "");
  const hits = [];

  const check = (name, wouldFire, action) => {
    if (wouldFire) hits.push({ rule: name, action: action || "delete" });
  };

  if (R.invites?.enabled) check("Invite link", hasInvite(text), R.invites.action);
  if (R.bannedWords?.enabled) check("Banned word", hasBannedWord(text, R.bannedWords.words || []), R.bannedWords.action);
  if (R.massMention?.enabled) check("Mass mention", mentionCount > (R.massMention.maxMentions || 5), R.massMention.action);
  if (R.caps?.enabled) check("Excessive caps", text.length >= (R.caps.minLength || 10) && capsRatio(text) >= (R.caps.percent || 70), R.caps.action);

  if (exCfg.link_blacklist?.length) check("Blacklisted link", hasBlacklistedLink(text, exCfg.link_blacklist, exCfg.link_whitelist), exCfg.link_action);
  if (exCfg.repeated_text) check("Repeated text", hasRepeatedText(text, exCfg.repeated_text_count || 3), exCfg.repeated_text_action);
  if (exCfg.emoji_spam) check("Emoji spam", emojiCount(text) > (exCfg.emoji_max || 5), exCfg.emoji_action);
  if (exCfg.blocked_emojis_enabled) check("Blocked emoji", hasBlockedMessageEmoji(text, exCfg.blocked_emojis), exCfg.blocked_emojis_action);
  if (exCfg.zalgo_enabled) check("Zalgo/unicode abuse", hasZalgo(text), exCfg.zalgo_action);

  // §3.1 new content-based rules (attachments + mentions_roles need the message
  // object and can't be tested from a string — noted below).
  if (exCfg.regex_enabled && exCfg.regex_patterns?.length) check("Regex match", matchesRegex(text, exCfg.regex_patterns), exCfg.regex_action);
  if (exCfg.newlines_enabled) check("Newline spam", countNewlines(text) > (exCfg.newlines_max || 10), exCfg.newlines_action);

  const contentOnlyNotes = [];
  if (exCfg.attachments_enabled) contentOnlyNotes.push("Attachments rule is not tested in dry-run mode (needs a real message with attachments).");
  if (exCfg.mentions_roles_enabled) contentOnlyNotes.push("Mass role mention rule is not tested in dry-run mode (needs a real message with role mentions).");
  const spamNote = R.spam?.enabled ? "Spam is stateful and not tested in dry-run mode." : null;
  const notes = [spamNote, ...contentOnlyNotes].filter(Boolean);

  return { hits, enabled: cfg.enabled, notes };
}

async function checkReaction(reaction, user) {
  if (user?.bot || !reaction.message?.guild) return false;
  const guild = reaction.message.guild;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return false;

  const message = reaction.message;
  if (cfg.ignoredChannels.includes(message.channel.id)) return false;

  const member = guild.members.cache.get(user.id) || await safe.orNull(guild.members.fetch(user.id), "automod fetch reaction member");
  if (!member) return false;
  if (OWNER_IDS.has(user.id)) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  if (cfg.ignoredRoles.length && member.roles.cache.some(r => cfg.ignoredRoles.includes(r.id))) return false;

  const exCfg = getExtendedConfig(guild.id);
  if (!exCfg.blocked_reaction_emojis_enabled) return false;
  if (!hasBlockedReactionEmoji(reaction.emoji, exCfg.blocked_reaction_emojis)) return false;

  const action = await enforceReaction(
    reaction,
    user,
    member,
    { action: exCfg.blocked_reaction_action || "delete" },
    "Blocked reaction emoji"
  );
  await logReactionAction(guild, cfg, reaction, user, "Blocked reaction emoji", action);
  return true;
}

module.exports = {
  load, save, getConfig, setConfig, checkMessage, checkReaction,
  getExtendedConfig, setExtendedConfig,
  startSpamCleanup, stopSpamCleanup,
  testRules,
  RULE_DEFAULTS, AUTOMOD_FILE,
  // Heat system (BOT_SPEC §3.2)
  getHeat, addHeat, thresholdHit, enforceHeat, stopHeatCleanup,
  // §3.1 new rule detection
  matchesRegex, countNewlines,
  _test: { hasBlockedMessageEmoji, hasBlockedReactionEmoji, normalizeEmojiToken, getHeat, addHeat, thresholdHit, testRules, matchesRegex, countNewlines },
};
