const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
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
  const member = await message.guild.members.fetch(id).catch(() => null);
  const user = member?.user || await message.client.users.fetch(id).catch(() => null);
  if (!user) return message.reply({ embeds: [errorEmbed("User not found.")] });
  return message.reply({ embeds: [userInfoEmbed(user, member)] });
}

// ─── serverinfo ──────────────────────────────────────────────
async function serverInfoEmbed(guild) {
  const owner = await guild.fetchOwner().catch(() => null);
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

module.exports = [
  {
    name: "userinfo", description: "Show info about a user", category: CATEGORY,
    prefix: (m, a) => handleUserInfo(m, a),
    slash: new SlashCommandBuilder().setName("userinfo").setDescription("Show info about a user")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(false)),
    execute: async (i) => {
      const user = i.options.getUser("user") || i.user;
      const member = await i.guild.members.fetch(user.id).catch(() => null);
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
    name: "avatar", description: "Show a user's avatar", category: CATEGORY,
    prefix: async (m, a) => {
      const id = resolveUserId(a[0]) || m.author.id;
      const user = await m.client.users.fetch(id).catch(() => null);
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
];
