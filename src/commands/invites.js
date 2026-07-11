// Invite tracking command — `$invites [@user]` shows how many members a user has
// invited to this server, attributed from the member_invites table maintained by
// src/invites.js. Read-only; always-on (no category gate).
const { SlashCommandBuilder } = require("discord.js");
const invites = require("../invites");
const theme = require("../theme");

module.exports = [
  {
    name: "invites",
    description: "See how many members a user has invited",
    aliases: ["invcount", "invitecount"],
    prefix: async (m) => {
      const target = m.mentions.users.first() || m.author;
      const count = invites.countForUser(m.guild.id, target.id);
      const who = target.id === m.author.id ? "You have" : `<@${target.id}> has`;
      return m.reply({
        embeds: [theme.success(m.guild.id, `📨 ${who} invited **${count}** member${count === 1 ? "" : "s"} to **${m.guild.name}**.`)],
        allowedMentions: { parse: [] },
      });
    },
    slash: new SlashCommandBuilder()
      .setName("invites")
      .setDescription("See how many members a user has invited")
      .addUserOption(o => o.setName("user").setDescription("The user to check (defaults to you)")),
    execute: async (i) => {
      const target = i.options.getUser("user") || i.user;
      const count = invites.countForUser(i.guild.id, target.id);
      const who = target.id === i.user.id ? "You have" : `<@${target.id}> has`;
      return i.reply({
        embeds: [theme.success(i.guild.id, `📨 ${who} invited **${count}** member${count === 1 ? "" : "s"} to **${i.guild.name}**.`)],
        allowedMentions: { parse: [] },
      });
    },
  },
];
