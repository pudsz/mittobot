// Giveaway command — mod-gated management of button-entry giveaways.
//   $giveaway start <1h|30m|…> <winners> <prize…>
//   $giveaway end <id>
//   $giveaway reroll <id>
//   $giveaway list
// The actual entry flow (Enter button) and the deadline sweep live in
// src/giveaways.js; this command is just the staff-facing control surface.
const { SlashCommandBuilder } = require("discord.js");
const giveaways = require("../giveaways");
const utils = require("../utils");
const theme = require("../theme");

// Summarize the guild's active giveaways as an info embed.
function listEmbed(guildId) {
  const rows = giveaways.listActive(guildId);
  if (!rows.length) return theme.embed(guildId, "info", "No active giveaways. Start one with `$giveaway start 1h 1 Nitro`.").setTitle("🎉 Giveaways");
  const lines = rows.map(g => {
    const endsUnix = Math.floor(Number(g.ends_at) / 1000);
    return `**#${g.id}** — ${g.prize} • ${g.winners_count} winner${g.winners_count === 1 ? "" : "s"} • ${g.entry_count} entries • ends <t:${endsUnix}:R>`;
  });
  return theme.embed(guildId, "info", lines.join("\n")).setTitle("🎉 Active Giveaways");
}

module.exports = [
  {
    name: "giveaway",
    description: "Start and manage timed giveaways",
    aliases: ["gw"],
    defaultPermission: "mod",
    prefix: async (m, args) => {
      const sub = (args[0] || "").toLowerCase();

      if (sub === "list") {
        return m.reply({ embeds: [listEmbed(m.guild.id)] });
      }

      if (sub === "end" || sub === "reroll") {
        const id = parseInt(args[1], 10);
        if (!Number.isInteger(id)) return m.reply({ embeds: [theme.error(m.guild.id, `Usage: \`$giveaway ${sub} <id>\`.`)] });
        const gv = giveaways.getGiveaway(id);
        if (!gv || gv.guild_id !== m.guild.id) return m.reply({ embeds: [theme.error(m.guild.id, `No giveaway #${id} in this server.`)] });
        const result = sub === "end"
          ? await giveaways.endGiveaway(id, m.client)
          : await giveaways.reroll(id, m.client);
        if (!result.ok) {
          const reason = { already_ended: "That giveaway has already ended.", not_ended: "That giveaway hasn't ended yet — end it first." }[result.error] || "Something went wrong.";
          return m.reply({ embeds: [theme.error(m.guild.id, reason)] });
        }
        const verb = sub === "end" ? "Ended" : "Rerolled";
        const who = result.winners.length ? result.winners.map(w => `<@${w}>`).join(", ") : "no valid entries";
        return m.reply({ embeds: [theme.success(m.guild.id, `${verb} giveaway #${id}. Winner${result.winners.length === 1 ? "" : "s"}: ${who}.`)] });
      }

      if (sub === "start") {
        const durationMs = utils.parseDuration(args[1]);
        if (!durationMs) return m.reply({ embeds: [theme.error(m.guild.id, "Invalid duration. Use e.g. `30m`, `2h`, `1d` (max 28d).")] });
        const winners = parseInt(args[2], 10);
        if (!Number.isInteger(winners) || winners < 1 || winners > 50) return m.reply({ embeds: [theme.error(m.guild.id, "Winners must be a number between 1 and 50.")] });
        const prize = args.slice(3).join(" ").trim();
        if (!prize) return m.reply({ embeds: [theme.error(m.guild.id, "Usage: `$giveaway start <duration> <winners> <prize>`.")] });
        const gv = await giveaways.create(m.guild, m.channel.id, prize.slice(0, 256), winners, durationMs, m.author.id);
        if (!gv) return m.reply({ embeds: [theme.error(m.guild.id, "Couldn't post the giveaway — check my permissions in this channel.")] });
        return m.reply({ embeds: [theme.success(m.guild.id, `Giveaway **#${gv.id}** started for **${prize}**! ${winners} winner${winners === 1 ? "" : "s"}.`)] });
      }

      return m.reply({ embeds: [theme.embed(m.guild.id, "info", "Manage giveaways:\n`$giveaway start <duration> <winners> <prize>`\n`$giveaway end <id>`\n`$giveaway reroll <id>`\n`$giveaway list`").setTitle("🎉 Giveaways")] });
    },
    slash: new SlashCommandBuilder().setName("giveaway").setDescription("Start and manage timed giveaways")
      .addSubcommand(c => c.setName("start").setDescription("Start a giveaway in this channel")
        .addStringOption(o => o.setName("duration").setDescription("How long it runs, e.g. 30m, 2h, 1d").setRequired(true))
        .addIntegerOption(o => o.setName("winners").setDescription("Number of winners (1-50)").setRequired(true).setMinValue(1).setMaxValue(50))
        .addStringOption(o => o.setName("prize").setDescription("What's being given away").setRequired(true)))
      .addSubcommand(c => c.setName("end").setDescription("End a giveaway now and draw winners")
        .addIntegerOption(o => o.setName("id").setDescription("Giveaway ID").setRequired(true)))
      .addSubcommand(c => c.setName("reroll").setDescription("Reroll winners for an ended giveaway")
        .addIntegerOption(o => o.setName("id").setDescription("Giveaway ID").setRequired(true)))
      .addSubcommand(c => c.setName("list").setDescription("List active giveaways")),
    execute: async (i) => {
      const sub = i.options.getSubcommand();

      if (sub === "list") return i.reply({ embeds: [listEmbed(i.guild.id)] });

      if (sub === "end" || sub === "reroll") {
        const id = i.options.getInteger("id");
        const gv = giveaways.getGiveaway(id);
        if (!gv || gv.guild_id !== i.guild.id) return i.reply({ embeds: [theme.error(i.guild.id, `No giveaway #${id} in this server.`)], flags: 64 });
        const result = sub === "end"
          ? await giveaways.endGiveaway(id, i.client)
          : await giveaways.reroll(id, i.client);
        if (!result.ok) {
          const reason = { already_ended: "That giveaway has already ended.", not_ended: "That giveaway hasn't ended yet — end it first." }[result.error] || "Something went wrong.";
          return i.reply({ embeds: [theme.error(i.guild.id, reason)], flags: 64 });
        }
        const verb = sub === "end" ? "Ended" : "Rerolled";
        const who = result.winners.length ? result.winners.map(w => `<@${w}>`).join(", ") : "no valid entries";
        return i.reply({ embeds: [theme.success(i.guild.id, `${verb} giveaway #${id}. Winner${result.winners.length === 1 ? "" : "s"}: ${who}.`)] });
      }

      // start
      const durationMs = utils.parseDuration(i.options.getString("duration"));
      if (!durationMs) return i.reply({ embeds: [theme.error(i.guild.id, "Invalid duration. Use e.g. `30m`, `2h`, `1d` (max 28d).")], flags: 64 });
      const winners = i.options.getInteger("winners");
      const prize = i.options.getString("prize").trim();
      if (!prize) return i.reply({ embeds: [theme.error(i.guild.id, "Prize is required.")], flags: 64 });
      const gv = await giveaways.create(i.guild, i.channel.id, prize.slice(0, 256), winners, durationMs, i.user.id);
      if (!gv) return i.reply({ embeds: [theme.error(i.guild.id, "Couldn't post the giveaway — check my permissions in this channel.")], flags: 64 });
      return i.reply({ embeds: [theme.success(i.guild.id, `Giveaway **#${gv.id}** started for **${prize}**! ${winners} winner${winners === 1 ? "" : "s"}.`)] });
    },
  },
];
