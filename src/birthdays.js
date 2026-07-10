// Birthdays — members register their birthday; a periodic tick announces the
// day's birthdays in a configured channel (optionally granting a role for the
// day). Per-guild config is cached in memory; birthdays themselves live in
// SQLite and are queried by (month, day) on each tick.
const { EmbedBuilder } = require("discord.js");
const safe = require("./safe");
const db = require("./db");

let store = {}; // guildId → config

function defaults() {
  return {
    enabled: false,
    channelId: null,
    message: "🎉 Happy Birthday {user}! 🎂",
    roleId: null,
    hour: 9, // UTC hour (0-23) the daily announcement fires
  };
}

async function load() {
  try {
    store = {};
    for (const row of await db.getAllBirthdayConfigs()) {
      store[row.guild_id] = {
        enabled: row.enabled === 1,
        channelId: row.channel_id,
        message: row.message || defaults().message,
        roleId: row.role_id,
        hour: row.hour ?? 9,
      };
    }
  } catch (e) {
    console.error("[birthdays] load:", e.message);
    store = {};
  }
}

function getConfig(guildId) {
  return { ...defaults(), ...(store[guildId] || {}) };
}

function setConfig(guildId, patch) {
  const next = { ...getConfig(guildId), ...patch };
  store[guildId] = next;
  db.setBirthdayConfig(guildId, {
    enabled: next.enabled,
    channel_id: next.channelId,
    message: next.message,
    role_id: next.roleId,
    hour: next.hour,
  }).catch(e => console.error("[birthdays] persist:", e.message));
  return next;
}

// ── User birthday storage (delegates to db) ──
function setBirthday(guildId, userId, month, day, year) {
  db.setBirthday(guildId, userId, month, day, year);
}
function getBirthday(guildId, userId) {
  return db.getBirthday(guildId, userId);
}
function removeBirthday(guildId, userId) {
  db.deleteBirthday(guildId, userId);
}
function upcoming(guildId, limit = 25) {
  return db.getUpcomingBirthdays(guildId, limit);
}

function format(template, member, guild) {
  const user = member.user || member;
  return String(template || "")
    .replace(/\{user\}/g, `<@${user.id}>`)
    .replace(/\{tag\}/g, user.tag || user.username)
    .replace(/\{username\}/g, user.username)
    .replace(/\{server\}/g, guild.name);
}

// Periodic tick (called from a setInterval in index.js). Announces birthdays for
// each guild once per day, when the current UTC hour reaches the guild's `hour`.
// last_announced (YYYY-MM-DD) guards against re-announcing within the same day.
async function tick(client) {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const hour = now.getUTCHours();
  const dateStr = `${now.getUTCFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  for (const [guildId, cfg] of Object.entries(store)) {
    if (!cfg.enabled || !cfg.channelId) continue;
    if (hour < (cfg.hour ?? 9)) continue; // not time yet today
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(cfg.channelId);
    if (!channel) continue;

    let rows;
    try { rows = db.getBirthdaysOn(guildId, month, day); } catch { continue; }
    for (const row of rows) {
      if (row.last_announced === dateStr) continue; // already announced today
      const member = await safe.orNull(guild.members.fetch(row.user_id), `birthday fetch ${row.user_id}`);
      if (!member) { db.markBirthdayAnnounced(guildId, row.user_id, dateStr); continue; }

      const embed = new EmbedBuilder().setColor(0xeb459e)
        .setDescription(format(cfg.message, member, guild))
        .setThumbnail(member.user.displayAvatarURL());
      if (row.year) {
        const age = now.getUTCFullYear() - row.year;
        if (age > 0 && age < 130) embed.setFooter({ text: `Turning ${age} today` });
      }
      await safe.send(channel, { embeds: [embed] }, "birthday announce");

      if (cfg.roleId) {
        const role = guild.roles.cache.get(cfg.roleId);
        if (role) await safe.addRole(member, role, "Birthday role", "birthday role grant");
      }
      db.markBirthdayAnnounced(guildId, row.user_id, dateStr);
    }
  }
}

module.exports = { load, getConfig, setConfig, setBirthday, getBirthday, removeBirthday, upcoming, tick };
