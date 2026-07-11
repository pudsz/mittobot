// Ticket command — staff post the support panel and close tickets. The actual
// ticket lifecycle (channel creation, transcript, deletion) is driven by the
// button handlers in src/tickets.js; this command is the manual surface:
//   $ticket panel  — post the "Create Ticket" panel (Manage Guild)
//   $ticket close  — close the ticket in the current channel
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const tickets = require("../tickets");
const theme = require("../theme");
const { OWNER_IDS } = require("../utils");

function canManage(member) {
  return member?.permissions?.has(PermissionFlagsBits.ManageGuild) || OWNER_IDS.has(member?.id);
}

module.exports = [
  {
    name: "ticket",
    description: "Post the support ticket panel or close a ticket",
    aliases: ["tickets"],
    prefix: async (m, args) => {
      const sub = (args[0] || "").toLowerCase();
      const cfg = tickets.getConfig(m.guild.id);

      if (sub === "panel") {
        if (!canManage(m.member)) return m.reply({ embeds: [theme.error(m.guild.id, "You need **Manage Server** to post the ticket panel.")] });
        if (!cfg.enabled) return m.reply({ embeds: [theme.error(m.guild.id, "The ticket system is disabled. Enable it in the dashboard first.")] });
        const sent = await tickets.postPanel(m.channel, m.guild.id);
        if (!sent) return m.reply({ embeds: [theme.error(m.guild.id, "I couldn't post the panel here. Check my permissions.")] });
        return m.reply({ embeds: [theme.success(m.guild.id, "🎫 Ticket panel posted.")] });
      }

      if (sub === "close") {
        const ok = await tickets.closeChannel(m.channel, m.author.id);
        if (!ok) return m.reply({ embeds: [theme.error(m.guild.id, "This channel is not an open ticket.")] });
        return m.reply({ embeds: [theme.info(m.guild.id, "Closing ticket and archiving transcript…")] });
      }

      return m.reply({ embeds: [theme.embed(m.guild.id, "info", "**Ticket commands**\n`$ticket panel` — post the support panel (Manage Server)\n`$ticket close` — close the current ticket").setTitle("🎫 Tickets")] });
    },
    slash: new SlashCommandBuilder().setName("ticket").setDescription("Post the support ticket panel or close a ticket")
      .addSubcommand(c => c.setName("panel").setDescription("Post the ticket panel in this channel (Manage Server)"))
      .addSubcommand(c => c.setName("close").setDescription("Close the ticket in this channel")),
    execute: async (i) => {
      const sub = i.options.getSubcommand();
      const cfg = tickets.getConfig(i.guild.id);

      if (sub === "panel") {
        if (!canManage(i.member)) return i.reply({ embeds: [theme.error(i.guild.id, "You need **Manage Server** to post the ticket panel.")], flags: 64 });
        if (!cfg.enabled) return i.reply({ embeds: [theme.error(i.guild.id, "The ticket system is disabled. Enable it in the dashboard first.")], flags: 64 });
        const sent = await tickets.postPanel(i.channel, i.guild.id);
        if (!sent) return i.reply({ embeds: [theme.error(i.guild.id, "I couldn't post the panel here. Check my permissions.")], flags: 64 });
        return i.reply({ embeds: [theme.success(i.guild.id, "🎫 Ticket panel posted.")], flags: 64 });
      }

      // close
      const ok = await tickets.closeChannel(i.channel, i.user.id);
      if (!ok) return i.reply({ embeds: [theme.error(i.guild.id, "This channel is not an open ticket.")], flags: 64 });
      return i.reply({ embeds: [theme.info(i.guild.id, "Closing ticket and archiving transcript…")], flags: 64 });
    },
  },
];
