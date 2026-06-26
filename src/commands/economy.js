// Economy commands — virtual currency, daily rewards, work, transfers, gambling.
// All prefixes: $balance, $daily, $work, $pay, $leaderboard, $gamble, $rob
// Slash equivalents use subcommand group: /economy balance|daily|work|pay|leaderboard|gamble|rob

const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const economy = require("../economy");

const CATEGORY = "fun";
const COIN_EMOJI = "🪙";
const BLURPLE = 0x5865f2;

function coinEmbed(desc) {
  return new EmbedBuilder().setColor(BLURPLE).setDescription(`${COIN_EMOJI} ${desc}`);
}

function errEmbed(desc) {
  return new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${desc}`);
}

function formatCoins(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ─── Balance ───────────────────────────────────────────────────────────
async function cmdBalance(messageOrInteraction, target, guildId) {
  const userId = target?.id || target?.user?.id || messageOrInteraction.author?.id || messageOrInteraction.user?.id;
  const userTag = target?.tag || target?.user?.tag || messageOrInteraction.author?.tag || messageOrInteraction.user?.tag;
  const bal = await economy.getBalance(guildId, userId);
  return coinEmbed(
    `**${userTag}**'s wallet\\n` +
    `💵 Wallet: **${formatCoins(bal.balance)}** coins\\n` +
    `🏦 Bank: **${formatCoins(bal.bank)}** coins\\n` +
    `💰 Total: **${formatCoins(bal.total)}** coins`
  );
}

// ─── Daily ─────────────────────────────────────────────────────────────
async function cmdDaily(guildId, userId, userTag) {
  const result = await economy.daily(guildId, userId);
  if (!result.success) {
    return errEmbed(`You already claimed your daily! Come back in **${result.cooldown}**.`);
  }
  return coinEmbed(
    `**${userTag}** claimed their daily reward!\\n` +
    `+${formatCoins(result.amount)} coins added to your wallet.\\n` +
    `Come back in 24h for another reward!`
  );
}

// ─── Work ──────────────────────────────────────────────────────────────
const WORK_JOBS = [
  "You worked as a Discord moderator and earned",
  "You streamed on voice chat and earned",
  "You debugged someone's code and earned",
  "You designed custom emojis and earned",
  "You wrote a bot command and earned",
  "You moderated a heated debate and earned",
  "You organized a server event and earned",
  "You helped a new member and earned",
  "You created a meme that went viral and earned",
  "You mined crypto on a Raspberry Pi and earned",
];
async function cmdWork(guildId, userId, userTag) {
  const result = await economy.work(guildId, userId);
  if (!result.success) {
    return errEmbed(`You're exhausted! Rest for **${result.cooldown}** before working again.`);
  }
  const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
  return coinEmbed(`${job} **${formatCoins(result.amount)}** coins!`);
}

// ─── Pay ───────────────────────────────────────────────────────────────
async function cmdPay(guild, guildId, fromId, fromTag, toId, toTag, amount) {
  // Verify target is in the guild before transferring
  const targetMember = await guild.members.fetch(toId).catch(() => null);
  if (!targetMember) return errEmbed("That user is not in this server.");
  const result = await economy.pay(guildId, fromId, toId, amount);
  if (!result.success) return errEmbed(result.reason);
  return coinEmbed(`**${fromTag}** paid **${formatCoins(amount)}** coins to **${toTag}**!`);
}

// ─── Leaderboard ───────────────────────────────────────────────────────
async function cmdLeaderboard(guild, guildId) {
  const lb = await economy.leaderboard(guildId, 10);
  if (!lb.length) return coinEmbed("No one has earned any coins yet. Be the first!");
  // Resolve all member display names in parallel to avoid sequential API calls
  const members = await Promise.all(lb.slice(0, 10).map(row =>
    guild.members.fetch(row.user_id).catch(() => null)
  ));
  const lines = lb.slice(0, 10).map((row, i) => {
    const member = members[i];
    const name = member?.displayName || member?.user?.username || row.user_id;
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${medal} **${name.replace(/\*/g, "\\*")}** — ${formatCoins(row.total)} coins`;
  });
  return coinEmbed(`**💰 Richest Members**\\n\\n${lines.join("\\n")}`);
}

// ─── Gamble ────────────────────────────────────────────────────────────
async function cmdGamble(guildId, userId, userTag, amount) {
  const result = await economy.gamble(guildId, userId, amount);
  if (!result.success) return errEmbed(result.reason);
  if (result.won) {
    return coinEmbed(
      `🎰 **${userTag}** gambled **${formatCoins(amount)}** and **WON**!\\n` +
      `+${formatCoins(result.net)} coins! New balance: **${formatCoins(result.newBalance)}**`
    );
  } else {
    return coinEmbed(
      `🎰 **${userTag}** gambled **${formatCoins(amount)}** and lost...\\n` +
      `${formatCoins(result.net)} coins. New balance: **${formatCoins(result.newBalance)}**`
    );
  }
}

// ─── Rob ───────────────────────────────────────────────────────────────
async function cmdRob(guildId, robberId, robberTag, victimId, victimTag) {
  const result = await economy.rob(guildId, robberId, victimId);
  if (!result.success) return errEmbed(result.reason);
  return coinEmbed(`🔫 **${robberTag}** robbed **${victimTag}** and got away with **${formatCoins(result.amount)}** coins!`);
}

// ─── Command defs ──────────────────────────────────────────────────────
module.exports = [
  // balance
  {
    name: "balance", description: "Check your or another user's balance", category: CATEGORY,
    prefix: async (m) => {
      const target = m.mentions.users.first() || m.author;
      return m.reply({ embeds: [await cmdBalance(m, target, m.guild.id)] });
    },
    slash: new SlashCommandBuilder().setName("balance").setDescription("Check your or another user's balance")
      .addUserOption(o => o.setName("user").setDescription("The user to check").setRequired(false)),
    execute: async (i) => {
      const target = i.options.getUser("user") || i.user;
      return i.reply({ embeds: [await cmdBalance(i, target, i.guild.id)] });
    },
  },
  // daily
  {
    name: "daily", description: "Claim your daily coin reward", category: CATEGORY,
    prefix: async (m) => m.reply({ embeds: [await cmdDaily(m.guild.id, m.author.id, m.author.tag)] }),
    slash: new SlashCommandBuilder().setName("daily").setDescription("Claim your daily coin reward"),
    execute: async (i) => i.reply({ embeds: [await cmdDaily(i.guild.id, i.user.id, i.user.tag)] }),
  },
  // work
  {
    name: "work", description: "Work to earn some coins", category: CATEGORY,
    prefix: async (m) => m.reply({ embeds: [await cmdWork(m.guild.id, m.author.id, m.author.tag)] }),
    slash: new SlashCommandBuilder().setName("work").setDescription("Work to earn some coins"),
    execute: async (i) => i.reply({ embeds: [await cmdWork(i.guild.id, i.user.id, i.user.tag)] }),
  },
  // pay
  {
    name: "pay", description: "Transfer coins to another user", category: CATEGORY,
    prefix: async (m, a) => {
      const target = m.mentions.users.first();
      if (!target) return m.reply({ embeds: [errEmbed("Usage: `$pay @user amount`")] });
      const amount = parseInt(a[1], 10);
      if (!amount || amount < 1) return m.reply({ embeds: [errEmbed("Invalid amount.")] });
      return m.reply({ embeds: [await cmdPay(m.guild, m.guild.id, m.author.id, m.author.tag, target.id, target.tag, amount)] });
    },
    slash: new SlashCommandBuilder().setName("pay").setDescription("Transfer coins to another user")
      .addUserOption(o => o.setName("user").setDescription("The user to pay").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to pay").setRequired(true).setMinValue(1)),
    execute: async (i) => {
      const target = i.options.getUser("user");
      const amount = i.options.getInteger("amount");
      return i.reply({ embeds: [await cmdPay(i.guild, i.guild.id, i.user.id, i.user.tag, target.id, target.tag, amount)] });
    },
  },
  // leaderboard (prefix uses "lb" alias too)
  {
    name: "leaderboard", description: "View the richest members", category: CATEGORY,
    prefix: async (m) => m.reply({ embeds: [await cmdLeaderboard(m.guild, m.guild.id)] }),
    slash: new SlashCommandBuilder().setName("leaderboard").setDescription("View the richest members"),
    execute: async (i) => i.reply({ embeds: [await cmdLeaderboard(i.guild, i.guild.id)] }),
  },
  {
    name: "lb", description: "View the richest members (alias for leaderboard)", category: CATEGORY,
    prefix: async (m) => m.reply({ embeds: [await cmdLeaderboard(m.guild, m.guild.id)] }),
    // No slash command for the alias — just prefix
  },
  // gamble
  {
    name: "gamble", description: "Gamble your coins for a chance to double them", category: CATEGORY,
    prefix: async (m, a) => {
      const amount = parseInt(a[0], 10);
      if (!amount || amount < 1) return m.reply({ embeds: [errEmbed("Usage: `$gamble amount`")] });
      return m.reply({ embeds: [await cmdGamble(m.guild.id, m.author.id, m.author.tag, amount)] });
    },
    slash: new SlashCommandBuilder().setName("gamble").setDescription("Gamble your coins for a chance to double them")
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to gamble").setRequired(true).setMinValue(1)),
    execute: async (i) => {
      const amount = i.options.getInteger("amount");
      return i.reply({ embeds: [await cmdGamble(i.guild.id, i.user.id, i.user.tag, amount)] });
    },
  },
  // rob
  {
    name: "rob", description: "Attempt to rob another user", category: CATEGORY,
    prefix: async (m) => {
      const target = m.mentions.users.first();
      if (!target) return m.reply({ embeds: [errEmbed("Usage: `$rob @user`")] });
      return m.reply({ embeds: [await cmdRob(m.guild.id, m.author.id, m.author.tag, target.id, target.tag)] });
    },
    slash: new SlashCommandBuilder().setName("rob").setDescription("Attempt to rob another user")
      .addUserOption(o => o.setName("user").setDescription("The user to rob").setRequired(true)),
    execute: async (i) => {
      const target = i.options.getUser("user");
      return i.reply({ embeds: [await cmdRob(i.guild.id, i.user.id, i.user.tag, target.id, target.tag)] });
    },
  },
];
