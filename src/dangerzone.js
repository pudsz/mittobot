const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { OWNER_IDS, formatDuration } = require("./utils");
const safe = require("./safe");
const db = require("./db");

// ─── Per-guild dangerzone config. Shape:
// { [guildId]: { channels: { [channelId]: { action, timeoutMs, logChannelId, exemptRoles[], reason } } } }
let store = {};

const ACTION_LABELS = {
  kick:    "👢 Kicked",
  ban:     "🔨 Banned",
  timeout: "🔇 Timed out",
};

function guildDefaults() {
  return { channels: {} };
}

async function load() {
  try {
    store = {};
    const rows = await db.getAllDangerzoneConfigs();
    for (const row of rows) {
      store[row.guild_id] = {
        channels: db.safeJsonParse(row.channels, {}),
      };
    }
  } catch (e) {
    console.error("Failed to load dangerzone config from db:", e);
    store = {};
  }
}

function save() {}

function getConfig(guildId) {
  const base = guildDefaults();
  const saved = store[guildId];
  if (!saved) return base;
  return { ...base, ...saved };
}

function setConfig(guildId, cfg) {
  store[guildId] = cfg;
  db.setDangerzoneConfig(guildId, cfg).catch(e => console.error("persist dangerzone:", e.message));
  return cfg;
}

// Add or update a dangerzone channel
function addChannel(guildId, channelId, opts) {
  const cfg = getConfig(guildId);
  cfg.channels[channelId] = {
    action:       opts.action || "kick",
    timeoutMs:    opts.timeoutMs || 5 * 60_000,
    logChannelId: opts.logChannelId || null,
    exemptRoles:  opts.exemptRoles || [],
    reason:       opts.reason || "Dangerzone: message sent in monitored channel",
  };
  return setConfig(guildId, cfg);
}

// Remove a dangerzone channel
function removeChannel(guildId, channelId) {
  const cfg = getConfig(guildId);
  delete cfg.channels[channelId];
  return setConfig(guildId, cfg);
}

// Is a channel in the dangerzone?
function isDangerzone(guildId, channelId) {
  return Boolean(store[guildId]?.channels?.[channelId]);
}

// Get channel config
function getChannelConfig(guildId, channelId) {
  return store[guildId]?.channels?.[channelId] || null;
}

// List all dangerzone channels for a guild
function listChannels(guildId) {
  return Object.entries(getConfig(guildId).channels);
}

// Check if a member is exempt (owner, has ManageGuild, or has an exempt role)
function isExempt(member, channelCfg) {
  if (!member) return true;
  if (OWNER_IDS.has(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (channelCfg.exemptRoles?.length && member.roles.cache.some(r => channelCfg.exemptRoles.includes(r.id))) return true;
  return false;
}

// Log the punishment to the configured log channel
async function logPunishment(guild, channelCfg, message, actionLabel) {
  const logChId = channelCfg.logChannelId;
  if (!logChId) return;
  const ch = guild.channels.cache.get(logChId);
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ Dangerzone Triggered")
    .setDescription(
      `**User:** ${message.author.tag} (<@${message.author.id}>)\n` +
      `**Action:** ${actionLabel}\n` +
      `**Channel:** <#${message.channel.id}>\n` +
      `**Reason:** ${channelCfg.reason}`
    )
    .addFields({ name: "Message Content", value: (message.content || "*[no text]*").slice(0, 1000) })
    .setThumbnail(message.author.displayAvatarURL?.())
    .setTimestamp();
  safe.send(ch, { embeds: [embed] }, "dangerzone log");
}

// ─── Main entry: returns true if the message was acted on ───
async function checkMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const channelCfg = getChannelConfig(message.guild.id, message.channel.id);
  if (!channelCfg) return false;
  if (isExempt(message.member, channelCfg)) return false;

  const member = message.member;
  const reason = channelCfg.reason || "Dangerzone: message in monitored channel";
  const me = message.guild.members.me;

  // Delete the message first
  await safe.delete(message, "dangerzone message");

  let actionLabel = "Unknown";

  try {
    if (channelCfg.action === "ban") {
      if (me.permissions.has(PermissionFlagsBits.BanMembers) && member.bannable) {
        await member.ban({ reason, deleteMessageSeconds: 7 * 24 * 60 * 60 });
        actionLabel = ACTION_LABELS.ban;
      } else {
        actionLabel = "🔨 Ban attempted (insufficient permissions)";
      }
    } else if (channelCfg.action === "kick") {
      if (me.permissions.has(PermissionFlagsBits.KickMembers) && member.kickable) {
        await member.kick(reason);
        actionLabel = ACTION_LABELS.kick;
      } else {
        actionLabel = "👢 Kick attempted (insufficient permissions)";
      }
    } else if (channelCfg.action === "timeout") {
      const ms = channelCfg.timeoutMs || 5 * 60_000;
      if (me.permissions.has(PermissionFlagsBits.ModerateMembers) && member.moderatable) {
        await member.timeout(ms, reason);
        actionLabel = `${ACTION_LABELS.timeout} for **${formatDuration(ms)}**`;
      } else {
        actionLabel = "🔇 Timeout attempted (insufficient permissions)";
      }
    }
  } catch (err) {
    console.error(`Dangerzone action error for ${member.user.tag}:`, err.message);
    actionLabel += ` (error: ${err.message})`;
  }

  await logPunishment(message.guild, channelCfg, message, actionLabel);
  return true;
}

module.exports = {
  load, save, getConfig, setConfig,
  addChannel, removeChannel, isDangerzone, getChannelConfig, listChannels,
  checkMessage,
  ACTION_LABELS,
};
