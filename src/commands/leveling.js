// ─── Leveling commands (BOT_SPEC §4.2) ──────────────────────────────────────
// $rank [user] / /rank        — rank card: level, XP progress bar, rank, msgs
// $levels / /levels           — paginated top users (10/page)
// $givexp <user> <amount>     — admin: add XP
// $setlevel <user> <n>        — admin: set absolute level
// $resetlevels                — owner: wipe the guild's leveling data (confirm)
// Category: "leveling" (feature toggle via levelingEnabled).

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { successEmbed, errorEmbed, OWNER_IDS } = require("../utils");
const leveling = require("../leveling");
const ui = require("../ui");
const safe = require("../safe");

const CATEGORY = "leveling";
const BLURPLE = 0x5865f2;

// ─── Progress bar ───────────────────────────────────────────────────────────
// Returns a 10-segment text bar: "████░░░░░░ 45/165 XP".
function progressBar(current, needed) {
  const total = Math.max(1, needed);
  const filled = Math.min(10, Math.round((current / total) * 10));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

// ─── Rank card ──────────────────────────────────────────────────────────────
async function cmdRank(guild, userId, requesterId) {
  if (!leveling.getConfig(guild.id).enabled) {
    return errorEmbed("Leveling is disabled in this server.");
  }
  const data = leveling.getRankCardData(guild.id, userId);
  if (!data) {
    return errorEmbed("That user hasn't earned any XP yet.");
  }
  const member = guild.members.cache.get(userId);
  const name = member?.displayName || member?.user?.username || userId;
  const bar = progressBar(data.currentXp, data.neededXp);
  return new EmbedBuilder()
    .setColor(BLURPLE)
    .setAuthor({ name: `Rank card — ${name}`, iconURL: member?.user?.displayAvatarURL?.() })
    .addFields(
      { name: "Level", value: `**${data.level}**`, inline: true },
      { name: "Rank", value: `#${data.rank || "—"}`, inline: true },
      { name: "Messages", value: String(data.messages), inline: true },
      { name: "XP Progress", value: `${bar}\n**${data.currentXp}** / ${data.neededXp} XP (total ${data.xp.toLocaleString()})` },
      ...(data.voiceMinutes > 0 ? [{ name: "Voice time", value: `${data.voiceMinutes} min`, inline: true }] : []),
    )
    .setFooter({ text: requesterId === userId ? "Your rank" : `Viewing ${name}'s rank` });
}

// ─── Leaderboard (paginated) ────────────────────────────────────────────────
async function cmdLeaderboard(source, guild) {
  if (!leveling.getConfig(guild.id).enabled) {
    return safe.orNull(source.reply?.({ embeds: [errorEmbed("Leveling is disabled in this server.")] }) ?? source.reply({ embeds: [errorEmbed("Leveling is disabled in this server.")] }), "leveling lb disabled");
  }
  const rows = await leveling.getLeaderboard(guild.id, 100);
  if (!rows.length) {
    return safe.orNull(source.reply?.({ embeds: [errorEmbed("No one has earned XP yet.")] }) ?? source.reply({ embeds: [errorEmbed("No one has earned XP yet.")] }), "leveling lb empty");
  }
  // Chunk into pages of 10.
  const pages = [];
  for (let i = 0; i < rows.length; i += 10) {
    const chunk = rows.slice(i, i + 10);
    const lines = chunk.map((r, idx) => {
      const rank = i + idx + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `**${rank}.**`;
      const member = guild.members.cache.get(r.user_id);
      const name = member?.displayName || member?.user?.username || r.user_id;
      return `${medal} **${name}** — Level ${r.level} · ${r.xp.toLocaleString()} XP · ${r.messages} msgs`;
    });
    pages.push(new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(`🏆 Leveling Leaderboard — ${guild.name}`)
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Page ${Math.floor(i / 10) + 1}/${Math.ceil(rows.length / 10)} · ${rows.length} ranked members` }));
  }
  // source.reply for prefix, source.reply for slash (both have .reply).
  // ui.paginate handles the button session.
  return ui.paginate(source, { pages, ownerId: source.author?.id ?? source.user?.id, ttlMs: 120_000 });
}

// ─── Admin: givexp / setlevel ───────────────────────────────────────────────
function parseAmount(raw) {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

async function cmdGiveXp(guild, targetId, amount, modTag) {
  if (!Number.isFinite(amount) || amount === 0) return errorEmbed("Amount must be a non-zero number.");
  // Cap to a sane range to avoid overflow / abuse.
  const capped = Math.max(-1_000_000, Math.min(1_000_000, amount));
  const data = leveling.giveXp(guild.id, targetId, capped);
  return successEmbed(`Added **${capped}** XP to <@${targetId}>. They're now **Level ${data.level}** with ${data.xp.toLocaleString()} XP. (by ${modTag})`);
}

async function cmdSetLevel(guild, targetId, level, modTag) {
  if (!Number.isFinite(level) || level < 0 || level > 1000) return errorEmbed("Level must be between 0 and 1000.");
  const data = leveling.setLevel(guild.id, targetId, level);
  return successEmbed(`Set <@${targetId}> to **Level ${level}** (${data.xp.toLocaleString()} XP). (by ${modTag})`);
}

// ─── Command definitions ────────────────────────────────────────────────────
module.exports = [
  {
    name: "rank",
    description: "Show your or another user's leveling rank card",
    category: CATEGORY,
    prefix: async (m, a) => {
      const target = m.mentions.users.first() || m.author;
      m.reply({ embeds: [await cmdRank(m.guild, target.id, m.author.id)], allowedMentions: { parse: [] } });
    },
    slash: new SlashCommandBuilder().setName("rank").setDescription("Show your leveling rank card")
      .addUserOption(o => o.setName("user").setDescription("Whose rank to view (defaults to you)").setRequired(false)),
    execute: async (i) => {
      const target = i.options.getUser("user") || i.user;
      i.reply({ embeds: [await cmdRank(i.guild, target.id, i.user.id)], allowedMentions: { parse: [] } });
    },
  },
  {
    name: "levels",
    description: "View the leveling leaderboard",
    category: CATEGORY,
    // Named "levels" (not "leaderboard") to avoid colliding with the economy
    // command's slash name — Discord requires globally-unique slash command
    // names, and slashMap is keyed by name so a duplicate would overwrite the
    // economy handler too. Prefix: just $levels (no sub-arg needed).
    prefix: async (m) => { await cmdLeaderboard(m, m.guild); },
    slash: new SlashCommandBuilder().setName("levels").setDescription("View the leveling leaderboard"),
    execute: async (i) => { await cmdLeaderboard(i, i.guild); },
  },
  {
    name: "givexp",
    description: "Add or remove XP from a user (admin)",
    category: CATEGORY,
    defaultPermission: "admin",
    prefix: async (m, a) => {
      const target = m.mentions.users.first();
      if (!target) return m.reply({ embeds: [errorEmbed("Usage: `$givexp @user <amount>`.")] });
      const amount = parseAmount(a[1]);
      if (amount === null) return m.reply({ embeds: [errorEmbed("Amount must be a number (can be negative to remove).")] });
      m.reply({ embeds: [await cmdGiveXp(m.guild, target.id, amount, m.author.tag)], allowedMentions: { parse: [] } });
    },
    slash: new SlashCommandBuilder().setName("givexp").setDescription("Add or remove XP from a user")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("XP to add (negative to remove)").setRequired(true)),
    execute: async (i) => {
      const target = i.options.getUser("user");
      const amount = i.options.getInteger("amount");
      i.reply({ embeds: [await cmdGiveXp(i.guild, target.id, amount, i.user.tag)], allowedMentions: { parse: [] } });
    },
  },
  {
    name: "setlevel",
    description: "Set a user's level directly (admin)",
    category: CATEGORY,
    defaultPermission: "admin",
    prefix: async (m, a) => {
      const target = m.mentions.users.first();
      if (!target) return m.reply({ embeds: [errorEmbed("Usage: `$setlevel @user <level>`.")] });
      const level = parseAmount(a[1]);
      if (level === null || level < 0) return m.reply({ embeds: [errorEmbed("Level must be a non-negative number.")] });
      m.reply({ embeds: [await cmdSetLevel(m.guild, target.id, level, m.author.tag)], allowedMentions: { parse: [] } });
    },
    slash: new SlashCommandBuilder().setName("setlevel").setDescription("Set a user's level directly")
      .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption(o => o.setName("level").setDescription("Level to set").setRequired(true).setMinValue(0).setMaxValue(1000)),
    execute: async (i) => {
      const target = i.options.getUser("user");
      const level = i.options.getInteger("level");
      i.reply({ embeds: [await cmdSetLevel(i.guild, target.id, level, i.user.tag)], allowedMentions: { parse: [] } });
    },
  },
  {
    name: "resetlevels",
    description: "Reset all leveling data for this server (owner only)",
    category: CATEGORY,
    defaultPermission: "owner",
    prefix: async (m) => {
      const proceed = await ui.confirm(m, {
        embed: new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ Reset all leveling data?")
          .setDescription(`This permanently wipes XP, levels, and message counts for **every member** in **${m.guild.name}**. Role rewards already granted are NOT removed. This cannot be undone.`),
        ownerId: m.author.id,
        confirmLabel: "Reset everything",
        ttlMs: 60_000,
        onConfirm: async (i) => {
          await leveling.resetGuild(m.guild.id);
          i.update({ embeds: [successEmbed("All leveling data for this server has been reset.")], components: [] });
        },
      });
      // ui.confirm handles the dialog; nothing more to do.
      void proceed;
    },
    slash: new SlashCommandBuilder().setName("resetlevels").setDescription("Reset all leveling data for this server (owner only)"),
    execute: async (i) => {
      if (!OWNER_IDS.has(i.user.id)) return i.reply({ embeds: [errorEmbed("Owner only.")], flags: MessageFlags.Ephemeral });
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await ui.confirm(i, {
        embed: new EmbedBuilder().setColor(0xfee75c).setTitle("⚠️ Reset all leveling data?")
          .setDescription(`This permanently wipes XP, levels, and message counts for **every member** in **${i.guild.name}**. Role rewards already granted are NOT removed. This cannot be undone.`),
        ownerId: i.user.id,
        confirmLabel: "Reset everything",
        ttlMs: 60_000,
        onConfirm: async (btn) => {
          await leveling.resetGuild(i.guild.id);
          btn.update({ embeds: [successEmbed("All leveling data for this server has been reset.")], components: [] });
        },
      });
    },
  },
];
