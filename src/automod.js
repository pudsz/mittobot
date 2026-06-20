const fs   = require("fs");
const path = require("path");
const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { OWNER_IDS } = require("./utils");

const AUTOMOD_FILE = path.join(__dirname, "..", "automod.json");

// ─── Per-guild automod config. Shape:
// { [guildId]: { enabled, logChannelId, ignoredChannels[], ignoredRoles[], rules: { invites, bannedWords, spam, massMention, caps } } }
let store = {};

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

function load() {
  try { if (fs.existsSync(AUTOMOD_FILE)) store = JSON.parse(fs.readFileSync(AUTOMOD_FILE, "utf8")); }
  catch { store = {}; }
}
function save() { fs.writeFileSync(AUTOMOD_FILE, JSON.stringify(store, null, 2)); }

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
  save();
  return next;
}

// ─── Spam tracker: per guild+user recent message timestamps (in-memory) ───
const spamTracker = new Map(); // key `${guildId}:${userId}` -> number[] timestamps

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
  ch.send({ embeds: [embed] }).catch(() => null);
}

// Carry out a rule's action. Returns the action label that succeeded.
async function enforce(message, rule, ruleName) {
  const action = rule.action || "delete";
  try {
    if (action === "delete" || action === "warn" || action === "mute") {
      await message.delete().catch(() => null);
    }
    if (action === "mute") {
      const ms = rule.muteMs || 5 * 60_000;
      if (message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers) && message.member?.moderatable) {
        await message.member.timeout(ms, `Automod: ${ruleName}`).catch(() => null);
      }
    }
    if (action === "warn") {
      const warn = await message.channel.send(`⚠️ <@${message.author.id}>, your message was removed (**${ruleName}**).`).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => null), 5000);
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
  RULE_DEFAULTS, AUTOMOD_FILE,
};
