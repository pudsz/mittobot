// Suggestions command surface. `$suggest <text>` / `/suggestion submit` (everyone)
// posts a suggestion to the configured board; `$suggestion approve|reject|implement
// <id> [note]` / `/suggestion approve|…` (Manage Messages) records a staff decision
// and re-colors the board embed. The slash surface is a single `/suggestion` group
// (to stay under Discord's 100 global-command cap): `submit` is open to everyone,
// while the review subcommands are gated in-handler by Manage Messages. Board
// posting/voting live in src/suggestions.js.
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const suggestions = require("../suggestions");
const theme = require("../theme");

const MAX_CONTENT = 1000;
// slash/prefix decision keyword → stored status
const DECISION = { approve: "approved", reject: "rejected", implement: "implemented" };

// `mod` = Manage Messages, matching the previous `defaultPermission: "mod"`.
function isMod(member) {
  return !!member?.permissions?.has(PermissionFlagsBits.ManageMessages);
}

async function submit(guildId, guild, userId, content, reply) {
  if (!content) return reply(theme.error(guildId, "Provide your suggestion: `$suggest <text>`."));
  if (content.length > MAX_CONTENT) return reply(theme.error(guildId, `Suggestion too long (max ${MAX_CONTENT} chars).`));
  const res = await suggestions.create(guild, userId, content);
  if (res.error === "disabled") return reply(theme.error(guildId, "Suggestions aren't enabled here. An admin can enable them from the dashboard."));
  if (res.error === "nochannel" || !res.message) return reply(theme.error(guildId, "The suggestion channel is misconfigured. Ask an admin to fix it."));
  return reply(theme.success(guildId, `💡 Suggestion #${res.id} submitted!`));
}

async function review(guildId, status, id, note, client, reply) {
  const updated = await suggestions.setStatus(id, status, note, client);
  if (!updated) return reply(theme.error(guildId, `No suggestion with id **${id}**.`));
  return reply(theme.success(guildId, `Suggestion #${id} marked **${status}**.`));
}

module.exports = [
  {
    name: "suggest",
    description: "Submit a suggestion to the server's suggestion board",
    prefix: async (m, args) => submit(m.guild.id, m.guild, m.author.id, args.join(" ").trim(),
      e => m.reply({ embeds: [e] })),
  },
  {
    name: "suggestion",
    description: "Submit or review a suggestion",
    // Everyone can reach `/suggestion submit`; review subcommands self-gate on mod.
    prefix: async (m, args, ctx) => {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "submit") {
        return submit(m.guild.id, m.guild, m.author.id, args.slice(1).join(" ").trim(), e => m.reply({ embeds: [e] }));
      }
      const status = DECISION[sub];
      if (!status) return m.reply({ embeds: [theme.error(m.guild.id, "Usage: `$suggestion approve|reject|implement <id> [note]`.")] });
      if (!isMod(m.member)) return m.reply({ embeds: [theme.error(m.guild.id, "You need **Manage Messages** to review suggestions.")] });
      const id = parseInt(args[1], 10);
      if (!id) return m.reply({ embeds: [theme.error(m.guild.id, "Provide a suggestion id: `$suggestion approve <id>`.")] });
      const note = args.slice(2).join(" ").slice(0, 1024) || null;
      return review(m.guild.id, status, id, note, ctx.client, e => m.reply({ embeds: [e] }));
    },
    slash: new SlashCommandBuilder().setName("suggestion").setDescription("Submit or review a suggestion")
      .addSubcommand(c => c.setName("submit").setDescription("Submit a suggestion to the server's suggestion board")
        .addStringOption(o => o.setName("text").setDescription("Your suggestion").setRequired(true).setMaxLength(MAX_CONTENT)))
      .addSubcommand(c => c.setName("approve").setDescription("Approve a suggestion (Manage Messages)")
        .addIntegerOption(o => o.setName("id").setDescription("Suggestion id").setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName("note").setDescription("Optional staff note").setMaxLength(1024)))
      .addSubcommand(c => c.setName("reject").setDescription("Reject a suggestion (Manage Messages)")
        .addIntegerOption(o => o.setName("id").setDescription("Suggestion id").setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName("note").setDescription("Optional staff note").setMaxLength(1024)))
      .addSubcommand(c => c.setName("implement").setDescription("Mark a suggestion as implemented (Manage Messages)")
        .addIntegerOption(o => o.setName("id").setDescription("Suggestion id").setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName("note").setDescription("Optional staff note").setMaxLength(1024))),
    execute: async (i, ctx) => {
      const sub = i.options.getSubcommand();
      if (sub === "submit") {
        return submit(i.guild.id, i.guild, i.user.id, (i.options.getString("text") || "").trim(),
          e => i.reply({ embeds: [e], flags: 64 }));
      }
      if (!isMod(i.member)) return i.reply({ embeds: [theme.error(i.guild.id, "You need **Manage Messages** to review suggestions.")], flags: 64 });
      const status = DECISION[sub];
      const id = i.options.getInteger("id");
      const note = i.options.getString("note") || null;
      return review(i.guild.id, status, id, note, ctx.client, e => i.reply({ embeds: [e] }));
    },
  },
];
