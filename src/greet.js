const fs   = require("fs");
const path = require("path");
const { EmbedBuilder } = require("discord.js");

const GREET_FILE = path.join(__dirname, "..", "greet.json");

// ─── Per-guild config. Shape:
// { [guildId]: {
//     welcome: { enabled, channelId, message },
//     leave:   { enabled, channelId, message },
//     logs:    { enabled, channelId, memberEvents, messageEvents },
//   } }
let store = {};

function guildDefaults() {
  return {
    welcome: { enabled: false, channelId: null, message: "Welcome {user} to **{server}**! You're member #{count}." },
    leave:   { enabled: false, channelId: null, message: "{tag} left the server. We're now {count} members." },
    logs:    { enabled: false, channelId: null, memberEvents: true, messageEvents: true },
  };
}

function load() {
  try { if (fs.existsSync(GREET_FILE)) store = JSON.parse(fs.readFileSync(GREET_FILE, "utf8")); }
  catch { store = {}; }
}
function save() { fs.writeFileSync(GREET_FILE, JSON.stringify(store, null, 2)); }

function getConfig(guildId) {
  const base = guildDefaults();
  const saved = store[guildId];
  if (!saved) return base;
  return {
    welcome: { ...base.welcome, ...(saved.welcome || {}) },
    leave:   { ...base.leave,   ...(saved.leave   || {}) },
    logs:    { ...base.logs,    ...(saved.logs    || {}) },
  };
}

function setConfig(guildId, patch) {
  const cur = getConfig(guildId);
  const next = {
    welcome: { ...cur.welcome, ...(patch.welcome || {}) },
    leave:   { ...cur.leave,   ...(patch.leave   || {}) },
    logs:    { ...cur.logs,    ...(patch.logs    || {}) },
  };
  store[guildId] = next;
  save();
  return next;
}

// Replace {user} {tag} {server} {count} placeholders.
function format(template, member, guild) {
  const user = member.user || member;
  return String(template || "")
    .replace(/\{user\}/g, `<@${user.id}>`)
    .replace(/\{tag\}/g, user.tag || user.username)
    .replace(/\{username\}/g, user.username)
    .replace(/\{server\}/g, guild.name)
    .replace(/\{count\}/g, guild.memberCount);
}

function sendTo(guild, channelId, embed) {
  if (!channelId) return;
  const ch = guild.channels.cache.get(channelId);
  if (ch) ch.send({ embeds: [embed] }).catch(() => null);
}

// ─── Event handlers ───
async function onMemberAdd(member) {
  const cfg = getConfig(member.guild.id);
  if (cfg.welcome.enabled && cfg.welcome.channelId) {
    const embed = new EmbedBuilder().setColor(0x57f287).setDescription(format(cfg.welcome.message, member, member.guild));
    const avatar = member.user.displayAvatarURL();
    if (avatar) embed.setThumbnail(avatar);
    sendTo(member.guild, cfg.welcome.channelId, embed);
  }
  if (cfg.logs.enabled && cfg.logs.memberEvents && cfg.logs.channelId) {
    const embed = new EmbedBuilder().setColor(0x57f287).setAuthor({ name: `${member.user.tag} joined`, iconURL: member.user.displayAvatarURL() })
      .setDescription(`<@${member.id}> • account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`).setTimestamp();
    sendTo(member.guild, cfg.logs.channelId, embed);
  }
}

async function onMemberRemove(member) {
  const cfg = getConfig(member.guild.id);
  if (cfg.leave.enabled && cfg.leave.channelId) {
    const embed = new EmbedBuilder().setColor(0xed4245).setDescription(format(cfg.leave.message, member, member.guild));
    sendTo(member.guild, cfg.leave.channelId, embed);
  }
  if (cfg.logs.enabled && cfg.logs.memberEvents && cfg.logs.channelId) {
    const embed = new EmbedBuilder().setColor(0xed4245).setAuthor({ name: `${member.user.tag} left`, iconURL: member.user.displayAvatarURL() })
      .setDescription(`<@${member.id}>`).setTimestamp();
    sendTo(member.guild, cfg.logs.channelId, embed);
  }
}

async function onMessageDelete(message) {
  if (!message.guild || message.author?.bot) return;
  const cfg = getConfig(message.guild.id);
  if (!cfg.logs.enabled || !cfg.logs.messageEvents || !cfg.logs.channelId) return;
  const embed = new EmbedBuilder().setColor(0xed4245)
    .setAuthor({ name: `${message.author?.tag ?? "Unknown"} • message deleted`, iconURL: message.author?.displayAvatarURL?.() })
    .setDescription(`In <#${message.channel.id}>:\n${(message.content || "*[no text / embed]*").slice(0, 1500)}`).setTimestamp();
  sendTo(message.guild, cfg.logs.channelId, embed);
}

async function onMessageUpdate(oldMsg, newMsg) {
  if (!newMsg.guild || newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  const cfg = getConfig(newMsg.guild.id);
  if (!cfg.logs.enabled || !cfg.logs.messageEvents || !cfg.logs.channelId) return;
  const embed = new EmbedBuilder().setColor(0xfee75c)
    .setAuthor({ name: `${newMsg.author?.tag ?? "Unknown"} • message edited`, iconURL: newMsg.author?.displayAvatarURL?.() })
    .setDescription(`In <#${newMsg.channel.id}> ([jump](${newMsg.url}))`)
    .addFields(
      { name: "Before", value: (oldMsg.content || "*[unknown]*").slice(0, 1000) },
      { name: "After",  value: (newMsg.content || "*[unknown]*").slice(0, 1000) },
    ).setTimestamp();
  sendTo(newMsg.guild, cfg.logs.channelId, embed);
}

module.exports = {
  load, save, getConfig, setConfig,
  onMemberAdd, onMemberRemove, onMessageDelete, onMessageUpdate,
  GREET_FILE,
};
