// Social — read-only helper command. Connectors are created/managed from the
// dashboard (Community → Social); this just lists what's configured so admins
// can eyeball it in-chat. Prefix-only (`$social list`) — no slash surface, to
// keep the bot under Discord's 100 global slash-command cap.
const { PermissionFlagsBits } = require("discord.js");
const social = require("../social");
const theme = require("../theme");
const { OWNER_IDS } = require("../utils");

function canManage(member) {
  return member?.permissions?.has(PermissionFlagsBits.ManageGuild) || OWNER_IDS.has(member?.id);
}

module.exports = [
  {
    name: "social",
    description: "List configured social connectors (RSS/YouTube/Twitch)",
    prefix: async (m, args) => {
      if (!canManage(m.member)) return m.reply({ embeds: [theme.error(m.guild.id, "You need **Manage Server** to view connectors.")] });
      // Only a `list` subcommand for now; bare `$social` lists too.
      const sub = (args[0] || "list").toLowerCase();
      if (sub !== "list") return m.reply({ embeds: [theme.error(m.guild.id, "Usage: `$social list`. Add connectors from the dashboard.")] });
      return m.reply({ embeds: [social.listEmbed(m.guild.id)] });
    },
  },
];
