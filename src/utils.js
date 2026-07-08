const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const settings = require("./settings");
const validation = require("./validation");

const MAX_PURGE      = 100;
// OWNER_IDS from environment variable (comma-separated) or fallback to empty set
const OWNER_IDS      = new Set(
  (process.env.OWNER_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(id => /^\d{17,20}$/.test(id))
);

// Warn if no owner IDs are set (except in test environments)
if (OWNER_IDS.size === 0 && process.env.NODE_ENV !== "test") {
  console.warn("[utils] No OWNER_IDS set in environment variables. Bot owner commands will not work.");
}
// PREFIX is read dynamically from settings so it can be changed at runtime
function getPrefix() { return settings.get("prefix"); }

const ANCHOR_ROLE_ID = "1511836977912217781";

function isOwner(userId) {
  return OWNER_IDS.has(userId);
}

function isAuthorized(message) {
  return OWNER_IDS.has(message.author.id) || message.member?.permissions.has(PermissionFlagsBits.Administrator);
}

function canCreateCustomRole(member) {
  if (!member) return false;
  if (OWNER_IDS.has(member.id) || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.premiumSince) return true;
  return false;
}

// Embed factories route through the theme module so guilds get their own
// colors/footer/tone. `src` (optional) is a Message/Interaction/guildId; when
// omitted the default theme renders, identical to the old hardcoded output.
// theme.js is lazy-required to avoid a utils↔theme cycle.
const successEmbed = (msg, src = null) => require("./theme").success(src, msg);
const errorEmbed   = (msg, src = null) => require("./theme").error(src, msg);
const noPermEmbed  = (src = null)      => require("./theme").noPerm(src);

function parseDuration(str) {
  const match = str?.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const val   = parseInt(match[1]);
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ms    = val * units[match[2].toLowerCase()];
  if (ms < 1_000 || ms > 28 * 86_400_000) return null;
  return ms;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function resolveUserId(arg) {
  if (!arg) return null;
  // Handle mention format <@123456789> or <@!123456789>
  const mentionMatch = arg.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    const id = mentionMatch[1];
    return validation.isValidUserId(id) ? id : null;
  }
  // Handle raw ID
  return validation.isValidUserId(arg) ? arg : null;
}

module.exports = {
  get PREFIX() { return settings.get("prefix"); },
  MAX_PURGE, OWNER_IDS, ANCHOR_ROLE_ID,
  getPrefix, isOwner, isAuthorized, canCreateCustomRole,
  successEmbed, errorEmbed, noPermEmbed,
  parseDuration, formatDuration, resolveUserId,
  validation,
};
