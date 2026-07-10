// Birthday command — members set/view/remove their birthday and view upcoming
// ones. The announcement itself is handled by the periodic tick in
// src/birthdays.js; this command is just the user-facing registration surface.
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const birthdays = require("../birthdays");
const theme = require("../theme");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validDate(month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return false;
  return true;
}

// Parse "MM/DD" or "MM-DD" or "MM/DD/YYYY".
function parseDate(str) {
  const m = String(str || "").match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{4}))?$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = m[3] ? parseInt(m[3], 10) : null;
  if (!validDate(month, day)) return null;
  if (year && (year < 1900 || year > new Date().getUTCFullYear())) return null;
  return { month, day, year };
}

function setBirthdayFor(guildId, userId, month, day, year) {
  birthdays.setBirthday(guildId, userId, month, day, year);
  const label = `${MONTHS[month - 1]} ${day}${year ? `, ${year}` : ""}`;
  return theme.success(guildId, `🎂 Your birthday is set to **${label}**.`);
}

function viewUpcoming(guild) {
  const rows = birthdays.upcoming(guild.id, 15);
  if (!rows.length) return theme.embed(guild.id, "info", "No birthdays registered yet. Set yours with `$birthday set MM/DD`.").setTitle("🎂 Upcoming Birthdays");
  const lines = rows.map(r => {
    const name = guild.members.cache.get(r.user_id)?.displayName || `<@${r.user_id}>`;
    return `**${MONTHS[r.month - 1]} ${r.day}** — ${name}`;
  });
  return theme.embed(guild.id, "info", lines.join("\n")).setTitle("🎂 Upcoming Birthdays");
}

module.exports = [
  {
    name: "birthday",
    description: "Set, view, or remove your birthday",
    aliases: ["bday"],
    category: "fun",
    prefix: async (m, args) => {
      const sub = (args[0] || "").toLowerCase();
      if (sub === "remove" || sub === "delete") {
        birthdays.removeBirthday(m.guild.id, m.author.id);
        return m.reply({ embeds: [theme.success(m.guild.id, "🗑️ Your birthday has been removed.")] });
      }
      if (sub === "list" || sub === "upcoming") {
        return m.reply({ embeds: [viewUpcoming(m.guild)] });
      }
      if (sub === "set") {
        const parsed = parseDate(args[1]);
        if (!parsed) return m.reply({ embeds: [theme.error(m.guild.id, "Invalid date. Use `$birthday set MM/DD` or `MM/DD/YYYY`.")] });
        return m.reply({ embeds: [setBirthdayFor(m.guild.id, m.author.id, parsed.month, parsed.day, parsed.year)] });
      }
      // No subcommand: show the caller's birthday, or usage.
      const own = birthdays.getBirthday(m.guild.id, m.author.id);
      if (own) {
        const label = `${MONTHS[own.month - 1]} ${own.day}${own.year ? `, ${own.year}` : ""}`;
        return m.reply({ embeds: [theme.embed(m.guild.id, "info", `Your birthday is **${label}**.\nUse \`$birthday set MM/DD\` to change it, \`$birthday list\` for upcoming.`).setTitle("🎂 Your Birthday")] });
      }
      return m.reply({ embeds: [theme.embed(m.guild.id, "info", "Set your birthday with `$birthday set MM/DD` (year optional). View others with `$birthday list`.").setTitle("🎂 Birthdays")] });
    },
    slash: new SlashCommandBuilder().setName("birthday").setDescription("Set, view, or remove your birthday")
      .addSubcommand(c => c.setName("set").setDescription("Set your birthday")
        .addIntegerOption(o => o.setName("month").setDescription("Month (1-12)").setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption(o => o.setName("day").setDescription("Day (1-31)").setRequired(true).setMinValue(1).setMaxValue(31))
        .addIntegerOption(o => o.setName("year").setDescription("Year (optional, for age)").setRequired(false).setMinValue(1900).setMaxValue(new Date().getUTCFullYear())))
      .addSubcommand(c => c.setName("view").setDescription("View your birthday"))
      .addSubcommand(c => c.setName("remove").setDescription("Remove your birthday"))
      .addSubcommand(c => c.setName("list").setDescription("List upcoming birthdays")),
    execute: async (i) => {
      const sub = i.options.getSubcommand();
      if (sub === "remove") {
        birthdays.removeBirthday(i.guild.id, i.user.id);
        return i.reply({ embeds: [theme.success(i.guild.id, "🗑️ Your birthday has been removed.")] });
      }
      if (sub === "list") return i.reply({ embeds: [viewUpcoming(i.guild)] });
      if (sub === "view") {
        const own = birthdays.getBirthday(i.guild.id, i.user.id);
        if (!own) return i.reply({ embeds: [theme.embed(i.guild.id, "info", "You haven't set a birthday yet. Use `/birthday set`.")], flags: 64 });
        const label = `${MONTHS[own.month - 1]} ${own.day}${own.year ? `, ${own.year}` : ""}`;
        return i.reply({ embeds: [theme.embed(i.guild.id, "info", `Your birthday is **${label}**.`).setTitle("🎂 Your Birthday")] });
      }
      // set
      const month = i.options.getInteger("month");
      const day = i.options.getInteger("day");
      const year = i.options.getInteger("year");
      if (!validDate(month, day)) return i.reply({ embeds: [theme.error(i.guild.id, "That date doesn't exist.")], flags: 64 });
      return i.reply({ embeds: [setBirthdayFor(i.guild.id, i.user.id, month, day, year)] });
    },
  },
];
