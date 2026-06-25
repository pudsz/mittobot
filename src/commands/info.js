const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const safe = require("../safe");
const { resolveUserId, errorEmbed } = require("../utils");

const CATEGORY = "info";
const BLURPLE = 0x5865f2;

const ts = (date) => `<t:${Math.floor(date.getTime() / 1000)}:F> (<t:${Math.floor(date.getTime() / 1000)}:R>)`;

// ─── userinfo ────────────────────────────────────────────────
function userInfoEmbed(user, member) {
  const e = new EmbedBuilder()
    .setColor(member?.displayColor || BLURPLE)
    .setTitle(`👤 ${user.tag}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "ID", value: user.id, inline: true },
      { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
      { name: "Account Created", value: ts(user.createdAt), inline: false },
    );
  if (member) {
    if (member.joinedAt) e.addFields({ name: "Joined Server", value: ts(member.joinedAt), inline: false });
    const roles = member.roles.cache.filter(r => r.id !== member.guild.id).sort((a, b) => b.position - a.position).map(r => `<@&${r.id}>`);
    e.addFields({ name: `Roles (${roles.length})`, value: roles.slice(0, 20).join(" ") || "None", inline: false });
    if (member.premiumSince) e.addFields({ name: "Boosting Since", value: ts(member.premiumSince), inline: false });
  }
  return e;
}

async function handleUserInfo(message, args) {
  const id = resolveUserId(args[0]) || message.author.id;
  const member = await safe.orNull(message.guild.members.fetch(id), `userinfo fetch member ${id}`);
  const user = member?.user || await safe.orNull(message.client.users.fetch(id), `userinfo fetch user ${id}`);
  if (!user) return message.reply({ embeds: [errorEmbed("User not found.")] });
  return message.reply({ embeds: [userInfoEmbed(user, member)] });
}

// ─── serverinfo ──────────────────────────────────────────────
async function serverInfoEmbed(guild) {
  const owner = await safe.orNull(guild.fetchOwner(), "serverinfo fetch owner");
  const channels = guild.channels.cache;
  const textCount  = channels.filter(c => c.type === 0).size;
  const voiceCount = channels.filter(c => c.type === 2).size;
  return new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(`🏠 ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      { name: "Owner", value: owner ? `${owner.user.tag}` : "Unknown", inline: true },
      { name: "Members", value: `${guild.memberCount}`, inline: true },
      { name: "ID", value: guild.id, inline: true },
      { name: "Channels", value: `💬 ${textCount} • 🔊 ${voiceCount}`, inline: true },
      { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
      { name: "Emojis", value: `${guild.emojis.cache.size}`, inline: true },
      { name: "Boosts", value: `${guild.premiumSubscriptionCount || 0} (Tier ${guild.premiumTier})`, inline: true },
      { name: "Created", value: ts(guild.createdAt), inline: false },
    );
}

// ─── roleinfo ────────────────────────────────────────────────
function roleInfoEmbed(role) {
  return new EmbedBuilder()
    .setColor(role.color || BLURPLE)
    .setTitle(`🎭 ${role.name}`)
    .addFields(
      { name: "ID", value: role.id, inline: true },
      { name: "Color", value: role.hexColor, inline: true },
      { name: "Members", value: `${role.members.size}`, inline: true },
      { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
      { name: "Hoisted", value: role.hoist ? "Yes" : "No", inline: true },
      { name: "Position", value: `${role.position}`, inline: true },
      { name: "Created", value: ts(role.createdAt), inline: false },
    );
}

// ─── avatar / banner ─────────────────────────────────────────
function avatarEmbed(user) {
  return new EmbedBuilder().setColor(BLURPLE).setTitle(`🖼️ ${user.tag}'s avatar`)
    .setImage(user.displayAvatarURL({ size: 1024 }))
    .setDescription(`[Open original](${user.displayAvatarURL({ size: 4096 })})`);
}

// ─── botinfo ─────────────────────────────────────────────────
function botInfoEmbed(client) {
  const mins = Math.floor((client.uptime || 0) / 60000);
  const up = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  const users = client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0);
  return new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(`🤖 ${client.user.username}`)
    .setThumbnail(client.user.displayAvatarURL())
    .addFields(
      { name: "Servers", value: `${client.guilds.cache.size}`, inline: true },
      { name: "Users", value: users.toLocaleString(), inline: true },
      { name: "Ping", value: `${Math.round(client.ws.ping)}ms`, inline: true },
      { name: "Uptime", value: up, inline: true },
      { name: "Node", value: process.version, inline: true },
    );
}

// ─── listroles ─────────────────────────────────────────────
// Build a plain markdown message: # heading with role ping, then member pings.
function buildListRolesText(roles) {
  const lines = [];
  for (const role of roles) {
    const members = [...role.members.values()];
    lines.push(`# <@&${role.id}> — ${members.length} member${members.length !== 1 ? "s" : ""}`);
    if (members.length === 0) {
      lines.push("*No members*");
    } else {
      members.sort((a, b) => a.displayName.localeCompare(b.displayName));
      lines.push(members.map(m => `<@${m.id}>`).join(" "));
    }
    lines.push(""); // blank line between roles
  }
  return lines.join("\n").trim();
}

// Split into chunks of max 1900 chars (safety margin under 2000), splitting at role boundaries.
function splitRoleChunks(text) {
  if (text.length <= 1900) return [text];
  const parts = [];
  // Split on each role heading (#) and rejoin up to the limit
  const sections = text.split(/(?=^# )/m);
  let buf = "";
  for (const sec of sections) {
    if (buf.length + sec.length > 1900) {
      if (buf) { parts.push(buf.trim()); buf = ""; }
      // If a single section is >1900 chars, split it further by member lines
      if (sec.length > 1900) {
        const lines = sec.split("\n");
        let secBuf = "";
        for (const line of lines) {
          if ((secBuf + "\n" + line).length > 1900) {
            if (secBuf) parts.push(secBuf.trim());
            secBuf = line;
          } else {
            secBuf = secBuf ? secBuf + "\n" + line : line;
          }
        }
        if (secBuf) parts.push(secBuf.trim());
      } else {
        buf = sec;
      }
    } else {
      buf = buf ? buf + sec : sec;
    }
  }
  if (buf) parts.push(buf.trim());
  return parts;
}

// ─── whohas (which roles have a permission) ──────────────────
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const labelFor = (key) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2"); // ManageMessages -> Manage Messages

// Normalized alias -> { flags: [bigint], label, note? }. Every Discord permission
// is auto-indexed by its flag key/label; curated human aliases are added on top.
function buildPermIndex() {
  const index = new Map();
  for (const [key, bit] of Object.entries(PermissionFlagsBits)) {
    const entry = { flags: [bit], label: labelFor(key) };
    index.set(norm(key), entry);
    index.set(norm(entry.label), entry);
  }
  // alias(names, targetKey) reuses an existing flag; pass {flags,label,note} to define a custom/pseudo permission.
  const alias = (names, target, extra = {}) => {
    const base = target ? index.get(norm(target)) : null;
    const flags = extra.flags || base?.flags;
    if (!flags) return; // target absent in this discord.js version — skip gracefully
    const entry = { flags, label: extra.label || base?.label || target, note: extra.note };
    for (const n of names) index.set(norm(n), entry);
  };

  // BypassSlowmode is a real Discord permission (1 << 52). Members with Manage Messages
  // or Manage Channels also bypass slowmode in practice, so surface them as a note.
  alias(["bypass slowmode", "slowmode bypass", "slowmode", "ignore slowmode", "no slowmode"], "BypassSlowmode", {
    note: "Members with **Manage Messages** or **Manage Channels** also bypass slowmode in practice — use `$whohas manage messages` / `$whohas manage channels` to find those.",
  });
  alias(["admin"], "Administrator");
  alias(["ban", "ban members"], "BanMembers");
  alias(["kick", "kick members"], "KickMembers");
  alias(["timeout", "mute", "moderate", "moderate members"], "ModerateMembers");
  alias(["manage messages", "delete messages", "purge"], "ManageMessages");
  alias(["manage channels", "channels"], "ManageChannels");
  alias(["manage roles", "roles"], "ManageRoles");
  alias(["manage server", "manage guild", "server"], "ManageGuild");
  alias(["manage nicknames", "nicknames"], "ManageNicknames");
  alias(["manage webhooks", "webhooks"], "ManageWebhooks");
  alias(["manage threads", "threads"], "ManageThreads");
  alias(["manage events", "events"], "ManageEvents");
  alias(["mention everyone", "ping everyone", "everyone"], "MentionEveryone");
  alias(["view audit log", "audit log", "audit"], "ViewAuditLog");
  alias(["view channel", "read messages"], "ViewChannel");
  alias(["send messages"], "SendMessages");
  alias(["mute members", "voice mute"], "MuteMembers");
  alias(["deafen members"], "DeafenMembers");
  alias(["move members"], "MoveMembers");
  alias(["connect", "voice connect"], "Connect");
  alias(["stream", "video", "go live"], "Stream");
  alias(["manage emojis", "emojis", "manage emojis and stickers", "manage expressions"], "ManageGuildExpressions");
  return index;
}
const PERM_INDEX = buildPermIndex();

function resolvePerm(input) {
  const key = norm(input || "");
  if (!key) return null;
  if (PERM_INDEX.has(key)) return PERM_INDEX.get(key);
  // Fall back to a substring match (e.g. "manage mess" -> Manage Messages).
  for (const [k, v] of PERM_INDEX) if (key.length >= 3 && (k.includes(key) || key.includes(k))) return v;
  return null;
}

function fmtRoles(guild, roles, cap = 30) {
  const shown = roles.slice(0, cap).map(r => (r.id === guild.id ? "@everyone" : `<@&${r.id}>`));
  const more = roles.length - shown.length;
  if (more > 0) shown.push(`*+${more} more*`);
  return shown.join(" ");
}

function whoHasEmbed(guild, perm) {
  const ADMIN = PermissionFlagsBits.Administrator;
  const queryingAdmin = perm.flags.includes(ADMIN);
  const direct = [];
  const viaAdmin = [];
  // Pass checkAdmin=false so .has() reports the literal bit, not Administrator's implicit grant-all.
  for (const role of [...guild.roles.cache.values()].sort((a, b) => b.position - a.position)) {
    if (perm.flags.some(f => role.permissions.has(f, false))) direct.push(role);
    else if (!queryingAdmin && role.permissions.has(ADMIN, false)) viaAdmin.push(role); // Administrator implicitly grants everything
  }

  const e = new EmbedBuilder().setColor(BLURPLE).setTitle(`🔐 Roles with ${perm.label}`);
  if (perm.note) e.setDescription(perm.note);
  e.addFields({
    name: `Has it directly (${direct.length})`,
    value: direct.length ? fmtRoles(guild, direct) : "No roles have this permission enabled.",
    inline: false,
  });
  if (viaAdmin.length)
    e.addFields({ name: `Also effective via Administrator (${viaAdmin.length})`, value: fmtRoles(guild, viaAdmin), inline: false });
  e.setFooter({ text: `${direct.length + viaAdmin.length} of ${guild.roles.cache.size} roles effectively have this` });
  return e;
}

function whoHasReply(guild, query) {
  if (!query) return errorEmbed("Give a permission to look up, e.g. `$whohas bypass slowmode` or `$whohas ban members`.");
  const perm = resolvePerm(query);
  if (!perm)
    return errorEmbed(`Unknown permission \`${query}\`. Try names like \`bypass slowmode\`, \`ban members\`, \`manage roles\`, \`administrator\`, or \`timeout\`.`);
  return whoHasEmbed(guild, perm);
}

module.exports = [
  {
    name: "userinfo", description: "Show info about a user", category: CATEGORY,
    prefix: (m, a) => handleUserInfo(m, a),
    slash: new SlashCommandBuilder().setName("userinfo").setDescription("Show info about a user")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(false)),
    execute: async (i) => {
      const user = i.options.getUser("user") || i.user;
      const member = await safe.orNull(i.guild.members.fetch(user.id), `slash userinfo fetch ${user.id}`);
      return i.reply({ embeds: [userInfoEmbed(user, member)] });
    },
  },
  {
    name: "serverinfo", description: "Show info about this server", category: CATEGORY,
    prefix: async (m) => m.reply({ embeds: [await serverInfoEmbed(m.guild)] }),
    slash: new SlashCommandBuilder().setName("serverinfo").setDescription("Show info about this server"),
    execute: async (i) => i.reply({ embeds: [await serverInfoEmbed(i.guild)] }),
  },
  {
    name: "roleinfo", description: "Show info about a role", category: CATEGORY,
    prefix: (m, a) => {
      const role = m.mentions.roles.first() || m.guild.roles.cache.get(a[0]) || m.guild.roles.cache.find(r => r.name.toLowerCase() === a.join(" ").toLowerCase());
      if (!role) return m.reply({ embeds: [errorEmbed("Role not found. Mention it, or give an ID/name.")] });
      return m.reply({ embeds: [roleInfoEmbed(role)] });
    },
    slash: new SlashCommandBuilder().setName("roleinfo").setDescription("Show info about a role")
      .addRoleOption(o => o.setName("role").setDescription("Target role").setRequired(true)),
    execute: (i) => i.reply({ embeds: [roleInfoEmbed(i.options.getRole("role"))] }),
  },
  {
    name: "whohas", description: "List which roles have a given permission", category: CATEGORY,
    prefix: (m, a) => m.reply({ embeds: [whoHasReply(m.guild, a.join(" "))] }),
    slash: new SlashCommandBuilder().setName("whohas").setDescription("List which roles have a given permission")
      .addStringOption(o => o.setName("permission").setDescription("e.g. bypass slowmode, ban members, manage roles, administrator").setRequired(true)),
    execute: (i) => i.reply({ embeds: [whoHasReply(i.guild, i.options.getString("permission"))] }),
  },
  {
    name: "avatar", description: "Show a user's avatar", category: CATEGORY,
    prefix: async (m, a) => {
      const id = resolveUserId(a[0]) || m.author.id;
      const user = await safe.orNull(m.client.users.fetch(id), `avatar fetch user ${id}`);
      if (!user) return m.reply({ embeds: [errorEmbed("User not found.")] });
      return m.reply({ embeds: [avatarEmbed(user)] });
    },
    slash: new SlashCommandBuilder().setName("avatar").setDescription("Show a user's avatar")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(false)),
    execute: (i) => i.reply({ embeds: [avatarEmbed(i.options.getUser("user") || i.user)] }),
  },
  {
    name: "membercount", description: "Show the server member count", category: CATEGORY,
    prefix: (m) => m.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription(`👥 **${m.guild.memberCount}** members`)] }),
    slash: new SlashCommandBuilder().setName("membercount").setDescription("Show the server member count"),
    execute: (i) => i.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription(`👥 **${i.guild.memberCount}** members`)] }),
  },
  {
    name: "botinfo", description: "Show bot stats", category: CATEGORY,
    prefix: (m) => m.reply({ embeds: [botInfoEmbed(m.client)] }),
    slash: new SlashCommandBuilder().setName("botinfo").setDescription("Show bot stats"),
    execute: (i) => i.reply({ embeds: [botInfoEmbed(i.client)] }),
  },
  {
    name: "trackroles", description: "Live-track members in specific roles (auto-updates)", category: CATEGORY,
    prefix: async (m, a) => {
      let roles;
      if (m.mentions.roles.size > 0) {
        const roleRegex = /<@&(\d+)>/g;
        const orderedIds = [...m.content.matchAll(roleRegex)].map(match => match[1]);
        const roleCache = m.mentions.roles;
        roles = orderedIds.map(id => roleCache.get(id)).filter(Boolean);
      } else if (a.length > 0) {
        roles = a.map(id =>
          m.guild.roles.cache.get(id) ||
          m.guild.roles.cache.find(r => r.name.toLowerCase() === id.toLowerCase())
        ).filter(Boolean);
      }
      if (!roles || roles.length === 0) {
        return m.reply({ embeds: [errorEmbed("Mention at least one role, e.g. `$trackroles @Owner @Staff`")] });
      }

      try {
        const roletracker = require("../roletracker");

        const text = buildListRolesText(roles);
        const chunks = splitRoleChunks(text);
        const messageIds = [];

        // Send initial messages
        const first = await safe.orNull(m.channel.send({ content: chunks[0], allowedMentions: { parse: [] } }), "trackroles send first");
        if (!first) return m.reply({ embeds: [errorEmbed("Failed to send the tracking message.")] });
        messageIds.push(first.id);

        for (let i = 1; i < chunks.length; i++) {
          const msg = await safe.orNull(m.channel.send({ content: chunks[i], allowedMentions: { parse: [] } }), "trackroles send extra");
          if (msg) messageIds.push(msg.id);
        }

        const roleIds = roles.map(r => r.id);
        await roletracker.addTrack(m.guild.id, m.channel.id, messageIds, roleIds);

        // Delete the command message
        safe.delete(m, "trackroles command cleanup");
      } catch (err) {
        console.error("trackroles error:", err.message);
        m.reply({ embeds: [errorEmbed("Failed to start tracking: " + err.message)] });
      }
    },
    slash: new SlashCommandBuilder()
      .setName("trackroles")
      .setDescription("Live-track members in specific roles (auto-updates)")
      .addRoleOption(o => o.setName("role1").setDescription("First role").setRequired(true))
      .addRoleOption(o => o.setName("role2").setDescription("Second role").setRequired(false))
      .addRoleOption(o => o.setName("role3").setDescription("Third role").setRequired(false))
      .addRoleOption(o => o.setName("role4").setDescription("Fourth role").setRequired(false))
      .addRoleOption(o => o.setName("role5").setDescription("Fifth role").setRequired(false))
      .addRoleOption(o => o.setName("role6").setDescription("Sixth role").setRequired(false))
      .addRoleOption(o => o.setName("role7").setDescription("Seventh role").setRequired(false))
      .addRoleOption(o => o.setName("role8").setDescription("Eighth role").setRequired(false))
      .addRoleOption(o => o.setName("role9").setDescription("Ninth role").setRequired(false))
      .addRoleOption(o => o.setName("role10").setDescription("Tenth role").setRequired(false))
      .addRoleOption(o => o.setName("role11").setDescription("11th role").setRequired(false))
      .addRoleOption(o => o.setName("role12").setDescription("12th role").setRequired(false))
      .addRoleOption(o => o.setName("role13").setDescription("13th role").setRequired(false))
      .addRoleOption(o => o.setName("role14").setDescription("14th role").setRequired(false))
      .addRoleOption(o => o.setName("role15").setDescription("15th role").setRequired(false))
      .addRoleOption(o => o.setName("role16").setDescription("16th role").setRequired(false))
      .addRoleOption(o => o.setName("role17").setDescription("17th role").setRequired(false))
      .addRoleOption(o => o.setName("role18").setDescription("18th role").setRequired(false))
      .addRoleOption(o => o.setName("role19").setDescription("19th role").setRequired(false))
      .addRoleOption(o => o.setName("role20").setDescription("20th role").setRequired(false)),
    execute: async (i) => {
      const roles = [];
      for (let j = 1; j <= 20; j++) {
        const r = i.options.getRole(`role${j}`);
        if (r) roles.push(r);
      }
      if (roles.length === 0) {
        return i.reply({ embeds: [errorEmbed("No roles provided.")], ephemeral: true });
      }

      try {
        const roletracker = require("../roletracker");
        const text = buildListRolesText(roles);
        const chunks = splitRoleChunks(text);
        const messageIds = [];

        await i.deferReply({ ephemeral: true });

        const first = await safe.orNull(i.channel.send({ content: chunks[0], allowedMentions: { parse: [] } }), "trackroles slash send first");
        if (first) messageIds.push(first.id);

        for (let k = 1; k < chunks.length; k++) {
          const msg = await safe.orNull(i.channel.send({ content: chunks[k], allowedMentions: { parse: [] } }), "trackroles slash send extra");
          if (msg) messageIds.push(msg.id);
        }

        if (messageIds.length === 0) {
          return i.editReply({ embeds: [errorEmbed("Failed to send the tracking message.")] });
        }

        const roleIds = roles.map(r => r.id);
        await roletracker.addTrack(i.guild.id, i.channel.id, messageIds, roleIds);
        await i.editReply({ content: "✅ Tracking started! The message above will auto-update when members gain or lose these roles.", embeds: [] });
      } catch (err) {
        console.error("trackroles slash error:", err.message);
        i.editReply({ embeds: [errorEmbed("Failed to start tracking: " + err.message)] });
      }
    },
  },
  {
    name: "untrackroles", description: "Stop live-tracking roles in this channel", category: CATEGORY,
    prefix: async (m) => {
      try {
        const roletracker = require("../roletracker");
        const tracks = roletracker.getTracked(m.guild.id);
        const track = tracks.find(t => t.channelId === m.channel.id);
        if (!track) {
          return m.reply({ embeds: [errorEmbed("No tracked roles in this channel. Reply to a tracked message or use `$trackroles` to start tracking.")] });
        }
        await roletracker.removeTrack(m.guild.id, m.channel.id);

        // Edit the tracked messages to show they've stopped
        const channel = m.guild.channels.cache.get(track.channelId);
        if (channel) {
          for (let i = 1; i < track.messageIds.length; i++) {
            const msg = await safe.orNull(channel.messages.fetch(track.messageIds[i]).catch(() => null), "untrackroles fetch extra");
            if (msg) await safe.delete(msg, "untrackroles cleanup");
          }
          const firstMsg = await safe.orNull(channel.messages.fetch(track.messageIds[0]).catch(() => null), "untrackroles fetch first");
          if (firstMsg) {
            await safe.edit(firstMsg, { content: "⏹️ **Tracking stopped.** The list above may be outdated." }, "untrackroles edit");
          }
        }
        m.reply({ embeds: [require("../utils").successEmbed("Tracking stopped for this channel.")] });
      } catch (err) {
        console.error("untrackroles error:", err.message);
        m.reply({ embeds: [errorEmbed("Failed to stop tracking: " + err.message)] });
      }
    },
    slash: new SlashCommandBuilder()
      .setName("untrackroles")
      .setDescription("Stop live-tracking roles in this channel"),
    execute: async (i) => {
      try {
        const roletracker = require("../roletracker");
        const tracks = roletracker.getTracked(i.guild.id);
        const track = tracks.find(t => t.channelId === i.channel.id);
        if (!track) {
          return i.reply({ embeds: [errorEmbed("No tracked roles in this channel.")], ephemeral: true });
        }
        await roletracker.removeTrack(i.guild.id, i.channel.id);

        const channel = i.guild.channels.cache.get(track.channelId);
        if (channel) {
          for (let i = 1; i < track.messageIds.length; i++) {
            const msg = await safe.orNull(channel.messages.fetch(track.messageIds[i]).catch(() => null), "untrackroles slash fetch extra");
            if (msg) await safe.delete(msg, "untrackroles slash cleanup");
          }
          const firstMsg = await safe.orNull(channel.messages.fetch(track.messageIds[0]).catch(() => null), "untrackroles slash fetch first");
          if (firstMsg) {
            await safe.edit(firstMsg, { content: "⏹️ **Tracking stopped.** The list above may be outdated." }, "untrackroles slash edit");
          }
        }
        await i.reply({ embeds: [require("../utils").successEmbed("Tracking stopped for this channel.")], ephemeral: true });
      } catch (err) {
        console.error("untrackroles slash error:", err.message);
        i.reply({ embeds: [errorEmbed("Failed to stop tracking: " + err.message)] });
      }
    },
  },
  {
    name: "trackedroles", description: "List all active role tracks in the server", category: CATEGORY,
    prefix: (m) => {
      try {
        const roletracker = require("../roletracker");
        const tracks = roletracker.getTracked(m.guild.id);
        if (tracks.length === 0) {
          return m.reply({ embeds: [errorEmbed("No active role tracks in this server. Use `$trackroles @role1 @role2` to start one.")] });
        }
        const lines = tracks.map((t, i) => {
          const channel = m.guild.channels.cache.get(t.channelId);
          const ch = channel ? `<#${channel.id}>` : "`deleted-channel`";
          const roles = t.roleIds.map(id => m.guild.roles.cache.get(id)).filter(Boolean);
          const roleStr = roles.length > 0 ? roles.map(r => `<@&${r.id}>`).join(" ") : "*deleted roles*";
          return `**${i + 1}.** ${ch} — ${roleStr}`;
        });
        const embed = new EmbedBuilder()
          .setColor(BLURPLE)
          .setTitle(`📋 Active Role Tracks (${tracks.length})`)
          .setDescription(lines.join("\n"));
        m.reply({ embeds: [embed] });
      } catch (err) {
        console.error("trackedroles error:", err.message);
        m.reply({ embeds: [errorEmbed("Error: " + err.message)] });
      }
    },
    slash: new SlashCommandBuilder()
      .setName("trackedroles")
      .setDescription("List all active role tracks in the server"),
    execute: async (i) => {
      try {
        const roletracker = require("../roletracker");
        const tracks = roletracker.getTracked(i.guild.id);
        if (tracks.length === 0) {
          return i.reply({ embeds: [errorEmbed("No active role tracks in this server.")], ephemeral: true });
        }
        const lines = tracks.map((t, idx) => {
          const channel = i.guild.channels.cache.get(t.channelId);
          const ch = channel ? `<#${channel.id}>` : "`deleted-channel`";
          const roles = t.roleIds.map(id => i.guild.roles.cache.get(id)).filter(Boolean);
          const roleStr = roles.length > 0 ? roles.map(r => `<@&${r.id}>`).join(" ") : "*deleted roles*";
          return `**${idx + 1}.** ${ch} — ${roleStr}`;
        });
        const embed = new EmbedBuilder()
          .setColor(BLURPLE)
          .setTitle(`📋 Active Role Tracks (${tracks.length})`)
          .setDescription(lines.join("\n"));
        await i.reply({ embeds: [embed], ephemeral: true });
      } catch (err) {
        console.error("trackedroles slash error:", err.message);
        i.reply({ embeds: [errorEmbed("Error: " + err.message)] });
      }
    },
  },
  {
    name: "listroles", description: "List members in specific roles", category: CATEGORY,
    prefix: (m, a) => {
      let roles;
      if (m.mentions.roles.size > 0) {
        // Parse role mentions from message content to preserve the order the user typed them.
        // m.mentions.roles returns roles in guild cache order, not mention order.
        const roleRegex = /<@&(\d+)>/g;
        const orderedIds = [...m.content.matchAll(roleRegex)].map(match => match[1]);
        const roleCache = m.mentions.roles;
        roles = orderedIds.map(id => roleCache.get(id)).filter(Boolean);
      } else if (a.length > 0) {
        roles = a.map(id =>
          m.guild.roles.cache.get(id) ||
          m.guild.roles.cache.find(r => r.name.toLowerCase() === id.toLowerCase())
        ).filter(Boolean);
      }
      if (!roles || roles.length === 0) {
        return m.reply({ embeds: [errorEmbed("Mention at least one role, e.g. `$listroles @Owner @Staff`")] });
      }
      const text = buildListRolesText(roles);
      const chunks = splitRoleChunks(text);
      m.reply({ content: chunks[0], allowedMentions: { parse: [] } }).catch(() => null);
      for (let i = 1; i < chunks.length; i++) {
        m.channel.send({ content: chunks[i], allowedMentions: { parse: [] } }).catch(() => null);
      }
    },
    slash: new SlashCommandBuilder()
      .setName("listroles")
      .setDescription("List members in specific roles")
      .addRoleOption(o => o.setName("role1").setDescription("First role").setRequired(true))
      .addRoleOption(o => o.setName("role2").setDescription("Second role").setRequired(false))
      .addRoleOption(o => o.setName("role3").setDescription("Third role").setRequired(false))
      .addRoleOption(o => o.setName("role4").setDescription("Fourth role").setRequired(false))
      .addRoleOption(o => o.setName("role5").setDescription("Fifth role").setRequired(false))
      .addRoleOption(o => o.setName("role6").setDescription("Sixth role").setRequired(false))
      .addRoleOption(o => o.setName("role7").setDescription("Seventh role").setRequired(false))
      .addRoleOption(o => o.setName("role8").setDescription("Eighth role").setRequired(false))
      .addRoleOption(o => o.setName("role9").setDescription("Ninth role").setRequired(false))
      .addRoleOption(o => o.setName("role10").setDescription("Tenth role").setRequired(false))
      .addRoleOption(o => o.setName("role11").setDescription("11th role").setRequired(false))
      .addRoleOption(o => o.setName("role12").setDescription("12th role").setRequired(false))
      .addRoleOption(o => o.setName("role13").setDescription("13th role").setRequired(false))
      .addRoleOption(o => o.setName("role14").setDescription("14th role").setRequired(false))
      .addRoleOption(o => o.setName("role15").setDescription("15th role").setRequired(false))
      .addRoleOption(o => o.setName("role16").setDescription("16th role").setRequired(false))
      .addRoleOption(o => o.setName("role17").setDescription("17th role").setRequired(false))
      .addRoleOption(o => o.setName("role18").setDescription("18th role").setRequired(false))
      .addRoleOption(o => o.setName("role19").setDescription("19th role").setRequired(false))
      .addRoleOption(o => o.setName("role20").setDescription("20th role").setRequired(false)),
    execute: async (i) => {
      const roles = [];
      for (let j = 1; j <= 20; j++) {
        const r = i.options.getRole(`role${j}`);
        if (r) roles.push(r);
      }
      if (roles.length === 0) {
        return i.reply({ embeds: [errorEmbed("No roles provided.")], ephemeral: true });
      }
      const text = buildListRolesText(roles);
      const chunks = splitRoleChunks(text);
      await i.reply({ content: chunks[0], allowedMentions: { parse: [] } });
      for (let k = 1; k < chunks.length; k++) {
        await i.channel.send({ content: chunks[k], allowedMentions: { parse: [] } }).catch(() => null);
      }
    },
  },
];
