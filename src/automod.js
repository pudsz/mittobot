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
        ignoredChannels: JSON.parse(row.ignored_channels || "[]"),
        ignoredRoles: JSON.parse(row.ignored_roles || "[]"),
        rules: JSON.parse(row.rules || "{}"),
      };
    }
    // Load extended automod config
    exStore = {};
    const exRows = await db.query("SELECT * FROM automod_extended");
    for (const row of exRows) {
      exStore[row.guild_id] = {
        link_blacklist: JSON.parse(row.link_blacklist || "[]"),
        link_whitelist: JSON.parse(row.link_whitelist || "[]"),
        repeated_text: row.repeated_text === 1,
        repeated_text_count: row.repeated_text_count || 3,
        emoji_spam: row.emoji_spam === 1,
        emoji_max: row.emoji_max || 5,
        zalgo_enabled: row.zalgo_enabled === 1,
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
    zalgo_enabled: false,
    zalgo_action: "delete",
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
  store[guildId] = next;
  db.setAutomodConfig(guildId, next).catch(e => console.error("persist automod:", e.message));
  return next;
}

// ─── Spam tracker: per guild+user recent message timestamps (in-memory) ───
const spamTracker = new Map(); // key `${guildId}:${userId}` -> number[] timestamps

// Periodic cleanup: every 5 minutes, purge entries older than the longest window
const SPAM_CLEANUP_INTERVAL = 5 * 60_000;
const SPAM_MAX_WINDOW = 60_000; // 60s — clean entries older than this (safe upper bound for all spam windows)
let spamCleanupTimer = null;

function startSpamCleanup() {
  if (spamCleanupTimer) return;
  spamCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - SPAM_MAX_WINDOW;
    for (const [key, timestamps] of spamTracker) {
      const valid = timestamps.filter(t => t > cutoff);
      if (valid.length === 0) spamTracker.delete(key);
      else spamTracker.set(key, valid);
    }
  }, SPAM_CLEANUP_INTERVAL);
  spamCleanupTimer.unref();
}

function stopSpamCleanup() {
  if (spamCleanupTimer) {
    clearInterval(spamCleanupTimer);
    spamCleanupTimer = null;
  }
}

function trackSpam(guildId, userId, max, windowMs, now) {
  const key = `${guildId}:${userId}`;
  const arr = (spamTracker.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  spamTracker.set(key, arr);
  return arr.length > max;
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

function hasZalgo(content) {
  const matches = content.match(ZALGO_RE);
  if (!matches) return false;
  // If >20% of characters are combining marks, it's zalgo
  return matches.length > content.length * 0.2;
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

// ─── Main entry: returns true if the message was acted on ───
async function checkMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const cfg = getConfig(message.guild.id);
  if (!cfg.enabled) return false;
  if (isExempt(message, cfg)) return false;
  const content = message.content || "";
  const now = Date.now();
  const R = cfg.rules;

  // Order matters: cheap text checks first, spam (stateful) last.
  if (R.invites.enabled && hasInvite(content)) {
    const a = await enforce(message, R.invites, "Invite link"); await logAction(message.guild, cfg, message, "Invite link", a); return true;
  }
  if (R.bannedWords.enabled && hasBannedWord(content, R.bannedWords.words)) {
    const a = await enforce(message, R.bannedWords, "Banned word"); await logAction(message.guild, cfg, message, "Banned word", a); return true;
  }
  if (R.massMention.enabled && message.mentions.users.size > (R.massMention.maxMentions || 5)) {
    const a = await enforce(message, R.massMention, "Mass mention"); await logAction(message.guild, cfg, message, "Mass mention", a); return true;
  }
  if (R.caps.enabled && content.length >= (R.caps.minLength || 10) && capsRatio(content) >= (R.caps.percent || 70)) {
    const a = await enforce(message, R.caps, "Excessive caps"); await logAction(message.guild, cfg, message, "Excessive caps", a); return true;
  }

  // ── Extended automod checks (with configurable actions) ──
  const exCfg = getExtendedConfig(message.guild.id);
  if (exCfg.link_blacklist?.length && hasBlacklistedLink(content, exCfg.link_blacklist, exCfg.link_whitelist)) {
    const a = await enforce(message, { action: exCfg.link_action || "delete" }, "Blacklisted link"); await logAction(message.guild, cfg, message, "Blacklisted link", a); return true;
  }
  if (exCfg.repeated_text && hasRepeatedText(content, exCfg.repeated_text_count || 3)) {
    const a = await enforce(message, { action: exCfg.repeated_text_action || "delete" }, "Repeated text"); await logAction(message.guild, cfg, message, "Repeated text", a); return true;
  }
  if (exCfg.emoji_spam && emojiCount(content) > (exCfg.emoji_max || 5)) {
    const a = await enforce(message, { action: exCfg.emoji_action || "delete" }, "Emoji spam"); await logAction(message.guild, cfg, message, "Emoji spam", a); return true;
  }
  if (exCfg.zalgo_enabled && hasZalgo(content)) {
    const a = await enforce(message, { action: exCfg.zalgo_action || "delete" }, "Zalgo/unicode abuse"); await logAction(message.guild, cfg, message, "Zalgo/unicode abuse", a); return true;
  }

  if (R.spam.enabled) {
    const tripped = trackSpam(message.guild.id, message.author.id, R.spam.maxMessages || 5, (R.spam.perSeconds || 5) * 1000, now);
    if (tripped) {
      const a = await enforce(message, R.spam, "Spam"); await logAction(message.guild, cfg, message, "Spam", a); return true;
    }
  }
  return false;
}

module.exports = {
  load, save, getConfig, setConfig, checkMessage,
  getExtendedConfig, setExtendedConfig,
  startSpamCleanup, stopSpamCleanup,
  RULE_DEFAULTS, AUTOMOD_FILE,
};
