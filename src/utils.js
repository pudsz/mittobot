const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const settings = require("./settings");

const MAX_PURGE      = 100;
const OWNER_IDS      = new Set(["1091375944524120125", "1328742607307804716", "1432503578467106970", "1462151133387686155"]);
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

const successEmbed = (msg) => new EmbedBuilder().setColor(0x00c776).setDescription(`✅ ${msg}`);
const errorEmbed   = (msg) => new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${msg}`);
const noPermEmbed  = ()    => new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${settings.get("noPermMsg")}`);

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
  return arg?.match(/^<@!?(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(arg) ? arg : null);
}

module.exports = {
  get PREFIX() { return settings.get("prefix"); },
  MAX_PURGE, OWNER_IDS, ANCHOR_ROLE_ID,
  getPrefix, isOwner, isAuthorized, canCreateCustomRole,
  successEmbed, errorEmbed, noPermEmbed,
  parseDuration, formatDuration, resolveUserId,
};
