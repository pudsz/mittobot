// Economy commands — virtual currency, daily rewards, work, transfers, gambling, skill games, bank, and shop.
// Prefix: $balance, $daily, $work, $pay, $deposit, $withdraw, $leaderboard, $gamble, $betflip, $highlow, $rob, $fish, $mine, $trivia, $wordle, $typerace, $blackjack, $shop, $buy, $gamestats
// Slash: individual commands for each

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require("discord.js");
const economy = require("../economy");
const theme = require("../theme");
const safe = require("../safe");

const CATEGORY = "fun";

function formatCoins(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function coinEmbed(guildId, title, description, fields = []) {
  const embed = theme.embed(guildId, "info", description).setTitle(`🪙 ${title}`);
  if (fields.length) embed.addFields(fields);
  return embed;
}

function successEmbed(guildId, title, description, fields = []) {
  const embed = theme.embed(guildId, "success", description).setTitle(`✅ ${title}`);
  if (fields.length) embed.addFields(fields);
  return embed;
}

function errorEmbed(guildId, title, description) {
  return theme.embed(guildId, "error", description).setTitle(`❌ ${title}`);
}

function warningEmbed(guildId, title, description) {
  return theme.embed(guildId, "warn", description).setTitle(`⚠️ ${title}`);
}

// ─── Balance ───────────────────────────────────────────────────────────
async function cmdBalance(messageOrInteraction, target, guildId) {
  const userId = target?.id || target?.user?.id || messageOrInteraction.author?.id || messageOrInteraction.user?.id;
  const userTag = target?.tag || target?.user?.tag || messageOrInteraction.author?.tag || messageOrInteraction.user?.tag;
  const bal = await economy.getBalance(guildId, userId);
  return coinEmbed(guildId, `${userTag}'s Balance`, null, [
    { name: "💵 Wallet", value: `**${formatCoins(bal.balance)}** coins`, inline: true },
    { name: "🏦 Bank", value: `**${formatCoins(bal.bank)}** coins`, inline: true },
    { name: "💰 Total", value: `**${formatCoins(bal.total)}** coins`, inline: true },
  ]);
}

// ─── Daily ─────────────────────────────────────────────────────────────
async function cmdDaily(guildId, userId, userTag) {
  const result = await economy.daily(guildId, userId);
  if (!result.success) {
    return errorEmbed(guildId, "Daily Already Claimed", `Come back in **${result.cooldown}**.`);
  }
  const fields = [
    { name: "💵 New Wallet Balance", value: await economy.getBalance(guildId, userId).then(b => `**${formatCoins(b.balance)}** coins`), inline: true },
  ];
  if (result.interest && result.interest > 0) {
    fields.push({ name: "🏦 Bank Interest", value: `+${formatCoins(result.interest)} coins to your bank`, inline: true });
  }
  return successEmbed(guildId, "Daily Reward Claimed!", `**${userTag}** claimed their daily reward!\n+${formatCoins(result.amount)} coins added to your wallet.`, fields);
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
    return errorEmbed(guildId, "Too Exhausted", `Rest for **${result.cooldown}** before working again.`);
  }
  const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
  const bal = await economy.getBalance(guildId, userId);
  return successEmbed(guildId, "Work Complete!", `${job} **${formatCoins(result.amount)}** coins!`, [
    { name: "💵 Wallet", value: `**${formatCoins(bal.balance)}** coins`, inline: true },
  ]);
}

// ─── Pay ───────────────────────────────────────────────────────────────
async function cmdPay(guild, guildId, fromId, fromTag, toId, toTag, amount) {
  const targetMember = await guild.members.fetch(toId).catch(() => null);
  if (!targetMember) return errorEmbed(guildId, "User Not Found", "That user is not in this server.");
  const result = await economy.pay(guildId, fromId, toId, amount);
  if (!result.success) return errorEmbed(guildId, "Transfer Failed", result.reason);
  const bal = await economy.getBalance(guildId, fromId);
  const desc = result.tax > 0
    ? `**${fromTag}** paid **${formatCoins(amount)}** coins to **${toTag}**! A **${result.tax}** coin tax was deducted (${formatCoins(result.received)} received).`
    : `**${fromTag}** paid **${formatCoins(amount)}** coins to **${toTag}**!`;
  return successEmbed(guildId, "Payment Sent!", desc, [
    { name: "💵 Your Wallet", value: `**${formatCoins(bal.balance)}** coins`, inline: true },
  ]);
}

// ─── Leaderboard ───────────────────────────────────────────────────────
async function cmdLeaderboard(guild, guildId) {
  const lb = await economy.leaderboard(guildId, 10);
  if (!lb.length) return coinEmbed(guildId, "Leaderboard", "No one has earned any coins yet. Be the first!");
  const members = await Promise.all(lb.slice(0, 10).map(row =>
    guild.members.fetch(row.user_id).catch(() => null)
  ));
  const lines = lb.slice(0, 10).map((row, i) => {
    const member = members[i];
    const name = member?.displayName || member?.user?.username || row.user_id;
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${medal} **${name.replace(/\*/g, "\\*")}** — ${formatCoins(row.total)} coins`;
  });
  return coinEmbed(guildId, "🏆 Richest Members", lines.join("\n"));
}

// ─── Gamble (Slots) 🎰 ─────────────────────────────────────────────────
async function cmdGamble(guildId, userId, userTag, amount) {
  const result = await economy.gamble(guildId, userId, amount);
  if (!result.success) return errorEmbed(guildId, "Gamble Failed", result.reason);
  
  if (result.won) {
    const title = result.isJackpot ? "🎰 JACKPOT! 🎰" : "🎰 You Won!";
    const desc = result.isJackpot 
      ? `**${userTag}** hit the JACKPOT on slots!\n+${formatCoins(result.net)} coins!`
      : `**${userTag}** gambled **${formatCoins(amount)}** and **WON**!\n+${formatCoins(result.net)} coins!`;
    return successEmbed(guildId, title, desc, [
      { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
    ]);
  } else {
    return errorEmbed(guildId, "🎰 You Lost...", `**${userTag}** gambled **${formatCoins(amount)}** and lost.\n-${formatCoins(Math.abs(result.net))} coins.`, [
      { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
    ]);
  }
}

// ─── Rob 🔫 ────────────────────────────────────────────────────────────
async function cmdRob(guildId, robberId, robberTag, victimId, victimTag) {
  const result = await economy.rob(guildId, robberId, victimId);
  if (!result.success) return errorEmbed(guildId, "Robbery Failed", result.reason);
  return successEmbed(guildId, "🔫 Successful Heist!", `**${robberTag}** robbed **${victimTag}** and got away with **${formatCoins(result.amount)}** coins!`, [
    { name: "💵 Your Wallet", value: await economy.getBalance(guildId, robberId).then(b => `**${formatCoins(b.balance)}** coins`), inline: true },
  ]);
}

// ─── Coinflip 🪙 ───────────────────────────────────────────────────────
async function cmdCoinflip(guildId, userId, userTag, side, amount) {
  const result = await economy.coinflip(guildId, userId, side, amount);
  if (!result.success) return errorEmbed(guildId, "Coinflip Failed", result.reason);
  if (result.won) {
    return successEmbed(guildId, "🪙 Heads or Tails!", `**${userTag}** called **${side}** — the coin landed **${result.flip}**!\n+${formatCoins(result.net)} coins!`, [
      { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
    ]);
  }
  return errorEmbed(guildId, "🪙 You Lost...", `**${userTag}** called **${side}** — the coin landed **${result.flip}**.\n-${formatCoins(Math.abs(result.net))} coins.`, [
    { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
  ]);
}

// ─── High/Low 🎲 ───────────────────────────────────────────────────────
async function cmdHighlow(guildId, userId, userTag, guess, amount) {
  const result = await economy.highlow(guildId, userId, guess, amount);
  if (!result.success) return errorEmbed(guildId, "High/Low Failed", result.reason);
  const guessWord = result.guess === "high" ? "higher" : "lower";
  if (result.push) {
    return warningEmbed(guildId, "🎲 Push!", `Rolled **${result.first}** then **${result.second}** — equal rolls. Your bet is returned.`, [
      { name: "💵 Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
    ]);
  }
  if (result.won) {
    return successEmbed(guildId, "🎲 You Win!", `Rolled **${result.first}** → **${result.second}**. You bet **${guessWord}** and won!\n+${formatCoins(result.net)} coins!`, [
      { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
    ]);
  }
  return errorEmbed(guildId, "🎲 You Lost...", `Rolled **${result.first}** → **${result.second}**. You bet **${guessWord}** and lost.\n-${formatCoins(Math.abs(result.net))} coins.`, [
    { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
  ]);
}

// ─── Bank: deposit / withdraw 🏦 ───────────────────────────────────────
async function cmdDeposit(guildId, userId, userTag, amount) {
  const result = await economy.deposit(guildId, userId, amount);
  if (!result.success) return errorEmbed(guildId, "Deposit Failed", result.reason);
  return successEmbed(guildId, "🏦 Deposited", `**${userTag}** deposited **${formatCoins(result.amount)}** coins into the bank.`, [
    { name: "💵 Wallet", value: `**${formatCoins(result.wallet)}** coins`, inline: true },
    { name: "🏦 Bank", value: `**${formatCoins(result.bank)}** coins`, inline: true },
  ]);
}

async function cmdWithdraw(guildId, userId, userTag, amount) {
  const result = await economy.withdraw(guildId, userId, amount);
  if (!result.success) return errorEmbed(guildId, "Withdrawal Failed", result.reason);
  return successEmbed(guildId, "🏦 Withdrawn", `**${userTag}** withdrew **${formatCoins(result.amount)}** coins from the bank.`, [
    { name: "💵 Wallet", value: `**${formatCoins(result.wallet)}** coins`, inline: true },
    { name: "🏦 Bank", value: `**${formatCoins(result.bank)}** coins`, inline: true },
  ]);
}

// ─── Shop 🛒 ───────────────────────────────────────────────────────────
async function cmdShop(guild) {
  const items = await economy.getShopItems(guild.id);
  if (!items.length) return coinEmbed(guild.id, "🛒 Server Shop", "No items for sale yet. An admin can add some from the dashboard.");
  const lines = items.map(it => {
    const stock = it.stock === -1 ? "∞" : it.stock > 0 ? `${it.stock} left` : "sold out";
    const role = it.role_id ? ` · grants <@&${it.role_id}>` : "";
    return `\`#${it.id}\` **${it.name}** — **${formatCoins(it.price)}** coins · ${stock}${role}\n${it.description ? `*${it.description.slice(0, 120)}*` : ""}`;
  });
  return coinEmbed(guild.id, "🛒 Server Shop", lines.join("\n\n"));
}

async function cmdBuy(source, guild, member, userId, userTag, itemId) {
  const result = await economy.buyShopItem(guild.id, userId, itemId);
  if (!result.success) return errorEmbed(guild.id, "Purchase Failed", result.reason);
  const item = result.item;

  // Grant the linked role, if any. economy.js must not touch Discord, so the
  // role grant lives here in the command layer.
  if (item.role_id) {
    const role = guild.roles.cache.get(item.role_id);
    if (role && member) {
      const ok = await safe.addRole(member, role, "Shop purchase", `shop buy by ${userTag}`);
      if (!ok) {
        // The coins were already spent; warn but don't refund — admin set up a
        // role the bot can't assign (hierarchy). Log it so it's discoverable.
        console.warn(`[shop] ${userTag} bought ${item.name} but role ${item.role_id} couldn't be granted (hierarchy/missing).`);
        return warningEmbed(guild.id, "⚠️ Role Not Granted", `You bought **${item.name}** for **${formatCoins(item.price)}** coins, but I couldn't grant the role (it may be above me). Contact an admin.`, [
          { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
        ]);
      }
    }
  }

  return successEmbed(guild.id, "🛒 Purchase Complete!", `**${userTag}** bought **${item.name}** for **${formatCoins(item.price)}** coins!${item.role_id ? `\nRole granted: <@&${item.role_id}>` : ""}`, [
    { name: "💵 New Balance", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
  ]);
}

// ─── Fishing 🎣 ────────────────────────────────────────────────────────
function formatFish(fish) {
  const rarityColors = { common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡" };
  return `${rarityColors[fish.rarity] || "⚪"} ${fish.emoji} **${fish.name}** (${fish.rarity}) — ${formatCoins(fish.value)} coins`;
}

async function cmdFish(guildId, userId, userTag) {
  const result = await economy.fish(guildId, userId);
  if (!result.success) return errorEmbed(guildId, "Fishing Failed", result.reason);
  
  const fish = result.fish;
  const embed = successEmbed(guildId, "🎣 Fishing Result", `**${userTag}** cast their line and caught...`, [
    { name: "Catch", value: formatFish(fish), inline: false },
    { name: "💰 Net Gain", value: result.net >= 0 ? `+${formatCoins(result.net)} coins` : `-${formatCoins(Math.abs(result.net))} coins`, inline: true },
    { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
  ]);
  
  if (fish.rarity === "legendary") {
    embed.setColor(0xffd700).setTitle("🎣 LEGENDARY CATCH! 🎣");
  } else if (fish.rarity === "epic") {
    embed.setColor(0x9b59b6).setTitle("🎣 EPIC CATCH! 🎣");
  }
  return embed;
}

// ─── Mining ⛏️ ────────────────────────────────────────────────────────
function formatOre(ore) {
  const rarityColors = { common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡", caveIn: "🔴" };
  return `${rarityColors[ore.rarity] || "⚪"} ${ore.emoji} **${ore.name}** (${ore.rarity}) — ${formatCoins(ore.value)} coins`;
}

async function cmdMine(guildId, userId, userTag) {
  const result = await economy.mine(guildId, userId);
  if (!result.success) return errorEmbed(guildId, "Mining Failed", result.reason);
  
  const ore = result.ore;
  const embed = result.isCaveIn 
    ? errorEmbed(guildId, "💥 CAVE-IN! 💥", `**${userTag}** triggered a cave-in!\nLost **${formatCoins(result.bet)}** coins.`, [
        { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
        { name: "⛏️ Depth", value: `Level ${result.newDepth}`, inline: true },
      ])
    : successEmbed(guildId, "⛏️ Mining Result", `**${userTag}** swung their pickaxe and found...`, [
        { name: "Find", value: formatOre(ore), inline: false },
        { name: "💰 Net Gain", value: result.net >= 0 ? `+${formatCoins(result.net)} coins` : `-${formatCoins(Math.abs(result.net))} coins`, inline: true },
        { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}** coins`, inline: true },
        { name: "⛏️ Depth", value: `Level ${result.newDepth}`, inline: true },
      ]);
  
  if (ore.rarity === "legendary") embed.setColor(0xffd700).setTitle("⛏️ LEGENDARY FIND! ⛏️");
  else if (ore.rarity === "epic") embed.setColor(0x9b59b6).setTitle("⛏️ EPIC FIND! ⛏️");
  return embed;
}

// ─── Trivia 🧠 ────────────────────────────────────────────────────────
const triviaSessions = new Map();

function createTriviaButtons(question, customId) {
  const row = new ActionRowBuilder();
  question.options.forEach((opt, i) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${customId}_${i}`)
        .setLabel(opt)
        .setStyle(ButtonStyle.Primary)
    );
  });
  return row;
}

async function cmdTrivia(guildId, userId, userTag, category) {
  const result = await economy.trivia(guildId, userId, category);
  const question = result.question;
  const sessionId = `trivia_${guildId}_${userId}_${Date.now()}`;
  triviaSessions.set(sessionId, { question, category: result.category, streak: 0, userId, guildId });

  const embed = coinEmbed(guildId, `🧠 Trivia: ${result.category}`, `**${question.q}**\n\n*Pick the correct answer below.*`, [
    { name: "Category", value: result.category, inline: true },
  ]);
  return { embeds: [embed], components: [createTriviaButtons(question, sessionId)] };
}

async function handleTriviaAnswer(interaction, sessionId, selectedIndex) {
  const session = triviaSessions.get(sessionId);
  if (!session || session.userId !== interaction.user.id) {
    return interaction.update({ embeds: [errorEmbed(interaction.guildId, "Expired", "This trivia session has expired.")], components: [] });
  }

  const questionIndex = economy.TRIVIA_QUESTIONS.findIndex(q => q.q === session.question.q);
  const result = await economy.triviaAnswer(session.guildId, session.userId, questionIndex, selectedIndex, session.streak);
  triviaSessions.delete(sessionId);

  if (result.correct) {
    // Chain into the next question so the streak can keep building.
    const next = await economy.trivia(session.guildId, session.userId, session.category);
    const newSessionId = `trivia_${session.guildId}_${session.userId}_${Date.now()}`;
    triviaSessions.set(newSessionId, {
      question: next.question,
      category: next.category,
      streak: result.newStreak,
      userId: session.userId,
      guildId: session.guildId,
    });

    return interaction.update({
      embeds: [successEmbed(interaction.guildId, "✅ Correct!", `**+${formatCoins(result.reward)}** coins! Next question:\n\n**${next.question.q}**`, [
        { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}**`, inline: true },
        { name: "🔥 Streak", value: `${result.newStreak}`, inline: true },
      ])],
      components: [createTriviaButtons(next.question, newSessionId)],
    });
  } else {
    return interaction.update({
      embeds: [errorEmbed(interaction.guildId, "❌ Wrong!", `The answer was: **${session.question.options[session.question.answer]}**\nStreak broken!`, [
        { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}**`, inline: true },
      ])],
      components: [],
    });
  }
}

// ─── Wordle 🔤 ────────────────────────────────────────────────────────
function formatWordleResult(result) {
  const emojiMap = { correct: "🟩", present: "🟨", absent: "⬛" };
  return result.map(r => emojiMap[r] || "⬛").join("");
}

async function cmdWordle(guildId, userId, userTag, guess) {
  const result = await economy.wordle(guildId, userId, guess);
  if (!result.success) return errorEmbed(guildId, "Wordle Error", result.reason);
  
  const grid = formatWordleResult(result.result);
  const title = result.won ? `🎉 Wordle Solved! (Streak: ${result.newStreak})` : "🔤 Wordle Guess";
  const desc = `**${userTag}** guessed: **${guess.toUpperCase()}**\n${grid}`;
  
  return result.won
    ? successEmbed(guildId, title, desc, [
        { name: "💰 Reward", value: `+${formatCoins(result.reward)} coins`, inline: true },
        { name: "🔥 Streak", value: `${result.newStreak}`, inline: true },
        { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}**`, inline: true },
      ])
    : coinEmbed(guildId, title, desc, [
        { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}**`, inline: true },
        { name: "🔥 Streak", value: `${result.newStreak}`, inline: true },
      ]);
}

// ─── Typing Race ⌨️ ───────────────────────────────────────────────────
const typeraceSessions = new Map();

async function cmdTyperace(guildId, userId, userTag) {
  const passage = economy.TYPING_PASSAGES[Math.floor(Math.random() * economy.TYPING_PASSAGES.length)];
  const sessionId = `typerace_${guildId}_${userId}_${Date.now()}`;
  typeraceSessions.set(sessionId, { passage, startTime: Date.now(), userId, guildId });

  const embed = coinEmbed(guildId, "⌨️ Typing Race", `Type this passage as fast as you can:\n\n**${passage}**\n\n*Reply to this message with the passage to submit your time!*`, [])
    .setFooter({ text: "Your WPM is calculated from your reply." });
  return { embeds: [embed], sessionId };
}

async function handleTyperaceSubmit(message, sessionId, typedText) {
  const session = typeraceSessions.get(sessionId);
  if (!session || session.userId !== message.author.id) return null;

  // Require an accurate transcription — without this a one-character reply would
  // score an instant (cap-limited) WPM and farm coins.
  const normalize = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalize(typedText) !== normalize(session.passage)) {
    typeraceSessions.delete(sessionId);
    return errorEmbed(message.guildId, "❌ Text Mismatch", "That didn't match the passage. Run `typerace` again to retry.");
  }

  const elapsed = (Date.now() - session.startTime) / 1000 / 60; // minutes
  const words = session.passage.split(" ").length;
  const wpm = Math.round(words / elapsed);
  typeraceSessions.delete(sessionId);

  if (wpm < 10 || wpm > 200) {
    return errorEmbed(message.guildId, "Invalid WPM", `Calculated WPM: ${wpm}. Must be between 10-200.`);
  }

  const result = await economy.typerace(session.guildId, session.userId, wpm);
  return successEmbed(message.guildId, "⌨️ Race Complete!", `**${message.author.tag}** typed at **${wpm} WPM**!`, [
    { name: "💰 Reward", value: `+${formatCoins(result.reward)} coins`, inline: true },
    { name: result.isRecord ? "🏆 NEW RECORD!" : "🏁 Best WPM", value: `${result.newBest} WPM`, inline: true },
    { name: "💵 Wallet", value: `**${formatCoins(result.newBalance)}**`, inline: true },
  ]);
}

// ─── Game Stats ───────────────────────────────────────────────────────
async function cmdGameStats(guildId, userId, userTag) {
  const stats = await economy.getGameStats(guildId, userId);
  return coinEmbed(guildId, `📊 ${userTag}'s Game Stats`, null, [
    { name: "🎮 Games Played", value: `${stats.games_played}`, inline: true },
    { name: "✅ Won", value: `${stats.games_won}`, inline: true },
    { name: "❌ Lost", value: `${stats.games_lost}`, inline: true },
    { name: "📈 Win Rate", value: `${stats.win_rate}%`, inline: true },
    { name: "💰 Total Wagered", value: `${formatCoins(stats.total_wagered)}`, inline: true },
    { name: "🏆 Total Won", value: `${formatCoins(stats.total_won)}`, inline: true },
    { name: "💎 Biggest Win", value: `${formatCoins(stats.biggest_win)}`, inline: true },
  ]);
}

// ─── Command Definitions ──────────────────────────────────────────────

const balanceCmd = {
  name: "balance", description: "Check your or another user's balance", category: CATEGORY,
  prefix: async (m) => { const target = m.mentions.users.first() || m.author; return m.reply({ embeds: [await cmdBalance(m, target, m.guild.id)] }); },
  slash: new SlashCommandBuilder().setName("balance").setDescription("Check your or another user's balance").addUserOption(o => o.setName("user").setDescription("The user to check").setRequired(false)),
  execute: async (i) => { const target = i.options.getUser("user") || i.user; return i.reply({ embeds: [await cmdBalance(i, target, i.guild.id)] }); },
};

const dailyCmd = {
  name: "daily", description: "Claim your daily coin reward", category: CATEGORY,
  prefix: async (m) => m.reply({ embeds: [await cmdDaily(m.guild.id, m.author.id, m.author.tag)] }),
  slash: new SlashCommandBuilder().setName("daily").setDescription("Claim your daily coin reward"),
  execute: async (i) => i.reply({ embeds: [await cmdDaily(i.guild.id, i.user.id, i.user.tag)] }),
};

const workCmd = {
  name: "work", description: "Work to earn some coins", category: CATEGORY,
  prefix: async (m) => m.reply({ embeds: [await cmdWork(m.guild.id, m.author.id, m.author.tag)] }),
  slash: new SlashCommandBuilder().setName("work").setDescription("Work to earn some coins"),
  execute: async (i) => i.reply({ embeds: [await cmdWork(i.guild.id, i.user.id, i.user.tag)] }),
};

const payCmd = {
  name: "pay", description: "Transfer coins to another user", category: CATEGORY,
  prefix: async (m, a) => {
    const target = m.mentions.users.first();
    if (!target) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$pay @user <amount>")] });
    const amount = parseInt(a[1], 10);
    if (!amount || amount < 1) return m.reply({ embeds: [errorEmbed(m.guild.id, "Invalid Amount", "Amount must be at least 1.")] });
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
};

const leaderboardCmd = {
  name: "leaderboard", description: "View the richest members", category: CATEGORY, aliases: ["lb"],
  prefix: async (m) => m.reply({ embeds: [await cmdLeaderboard(m.guild, m.guild.id)] }),
  slash: new SlashCommandBuilder().setName("leaderboard").setDescription("View the richest members"),
  execute: async (i) => i.reply({ embeds: [await cmdLeaderboard(i.guild, i.guild.id)] }),
};

const gambleCmd = {
  name: "gamble", description: "Play slots for a chance to win big", category: CATEGORY,
  prefix: async (m, a) => {
    const amount = parseInt(a[0], 10);
    if (!amount || amount < 1) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$gamble <amount>")] });
    return m.reply({ embeds: [await cmdGamble(m.guild.id, m.author.id, m.author.tag, amount)] });
  },
  slash: new SlashCommandBuilder().setName("gamble").setDescription("Play slots for a chance to win big")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to bet").setRequired(true).setMinValue(1)),
  execute: async (i) => {
    await i.deferReply();
    const amount = i.options.getInteger("amount");
    return i.editReply({ embeds: [await cmdGamble(i.guild.id, i.user.id, i.user.tag, amount)] });
  },
};

const robCmd = {
  name: "rob", description: "Attempt to rob another user", category: CATEGORY,
  prefix: async (m, a) => {
    const target = m.mentions.users.first();
    if (!target) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$rob @user")] });
    return m.reply({ embeds: [await cmdRob(m.guild.id, m.author.id, m.author.tag, target.id, target.tag)] });
  },
  slash: new SlashCommandBuilder().setName("rob").setDescription("Attempt to rob another user")
    .addUserOption(o => o.setName("user").setDescription("The user to rob").setRequired(true)),
  execute: async (i) => {
    await i.deferReply();
    const target = i.options.getUser("user");
    return i.editReply({ embeds: [await cmdRob(i.guild.id, i.user.id, i.user.tag, target.id, target.tag)] });
  },
};

const fishCmd = {
  name: "fish", description: "Go fishing for coins", category: CATEGORY,
  prefix: async (m) => m.reply({ embeds: [await cmdFish(m.guild.id, m.author.id, m.author.tag)] }),
  slash: new SlashCommandBuilder().setName("fish").setDescription("Go fishing for coins"),
  execute: async (i) => i.reply({ embeds: [await cmdFish(i.guild.id, i.user.id, i.user.tag)] }),
};

const mineCmd = {
  name: "mine", description: "Go mining for ores and gems", category: CATEGORY,
  prefix: async (m) => m.reply({ embeds: [await cmdMine(m.guild.id, m.author.id, m.author.tag)] }),
  slash: new SlashCommandBuilder().setName("mine").setDescription("Go mining for ores and gems"),
  execute: async (i) => i.reply({ embeds: [await cmdMine(i.guild.id, i.user.id, i.user.tag)] }),
};

const triviaCmd = {
  name: "trivia", description: "Answer trivia questions for coins", category: CATEGORY,
  prefix: async (m, a) => {
    const category = a[0]?.toLowerCase();
    return m.reply(await cmdTrivia(m.guild.id, m.author.id, m.author.tag, category));
  },
  slash: new SlashCommandBuilder().setName("trivia").setDescription("Answer trivia questions for coins")
    .addStringOption(o => o.setName("category").setDescription("Question category").setRequired(false)
      .addChoices(
        { name: "Geography", value: "geography" },
        { name: "Science", value: "science" },
        { name: "Math", value: "math" },
        { name: "History", value: "history" },
        { name: "Literature", value: "literature" },
        { name: "Art", value: "art" },
        { name: "Random", value: "random" },
      )),
  execute: async (i) => {
    const category = i.options.getString("category") || null;
    return i.reply(await cmdTrivia(i.guild.id, i.user.id, i.user.tag, category));
  },
};

const wordleCmd = {
  name: "wordle", description: "Guess the daily 5-letter word", category: CATEGORY,
  prefix: async (m, a) => {
    const guess = a[0];
    if (!guess) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$wordle <guess>")] });
    return m.reply({ embeds: [await cmdWordle(m.guild.id, m.author.id, m.author.tag, guess)] });
  },
  slash: new SlashCommandBuilder().setName("wordle").setDescription("Guess the daily 5-letter word")
    .addStringOption(o => o.setName("guess").setDescription("Your 5-letter guess").setRequired(true).setMinLength(5).setMaxLength(5)),
  execute: async (i) => {
    const guess = i.options.getString("guess");
    return i.reply({ embeds: [await cmdWordle(i.guild.id, i.user.id, i.user.tag, guess)] });
  },
};

const typeraceCmd = {
  name: "typerace", description: "Test your typing speed for coins", category: CATEGORY,
  prefix: async (m) => {
    const { embeds, sessionId } = await cmdTyperace(m.guild.id, m.author.id, m.author.tag);
    const sent = await m.reply({ embeds });
    const session = typeraceSessions.get(sessionId);
    if (session && sent?.id) session.promptMessageId = sent.id;
  },
  slash: new SlashCommandBuilder().setName("typerace").setDescription("Test your typing speed for coins"),
  execute: async (i) => {
    const { embeds, sessionId } = await cmdTyperace(i.guild.id, i.user.id, i.user.tag);
    const sent = await i.reply({ embeds, fetchReply: true });
    const session = typeraceSessions.get(sessionId);
    if (session && sent?.id) session.promptMessageId = sent.id;
  },
};

// ─── Blackjack 🃏 ────────────────────────────────────────────────────────
const blackjackSessions = new Map();

function formatCard(card) {
  return card ? `${card.suit}${card.rank}` : "🂠";
}

function formatBlackjackEmbed(guildId, userTag, state, action = null) {
  const { playerHand, dealerHand, playerValue, dealerValue, bet, finished, result, net, newBalance, blackjack, canDouble } = state;
  const hideDealer = !finished;
  
  let title = "🃏 Blackjack";
  let color = 0x5865f2;
  let description = `**${userTag}**'s hand: ${playerHand.map(formatCard).join(" ")} (Value: **${playerValue}**)\n`;
  description += `Dealer's hand: ${dealerHand.map((c, i) => hideDealer && i > 0 ? "🂠" : formatCard(c)).join(" ")} ${hideDealer ? `(Value: **?**)` : `(Value: **${dealerValue}**)`}`;
  
  const fields = [
    { name: "💰 Bet", value: formatCoins(bet), inline: true },
  ];
  
  if (finished) {
    if (result === "blackjack") {
      title = "🃏 BLACKJACK!";
      color = 0xffd700;
      description += `\n\n🎉 **Blackjack!** You win **${formatCoins(net)}** coins! (${formatCoins(bet)} × ${state.payout || 1.5}x)`;
    } else if (result === "win") {
      title = "✅ You Win!";
      color = 0x00c776;
      description += `\n\nYou beat the dealer! **+${formatCoins(net)}** coins!`;
    } else if (result === "push") {
      title = "🤝 Push";
      color = 0xfee75c;
      description += `\n\nIt's a tie! Your bet is returned.`;
    } else if (result === "bust") {
      title = "💥 Bust!";
      color = 0xed4245;
      description += `\n\nYou went over 21. **-${formatCoins(Math.abs(net))}** coins.`;
    } else if (result === "lose") {
      title = "❌ You Lose";
      color = 0xed4245;
      description += `\n\nDealer wins. **-${formatCoins(Math.abs(net))}** coins.`;
    }
    fields.push({ name: "💵 New Balance", value: `**${formatCoins(newBalance)}** coins`, inline: true });
    return { embed: theme.embed(guildId, "info", description).setTitle(title).setColor(color).addFields(fields), components: [] };
  }
  
  // Game in progress - add action buttons
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder().setCustomId(`bj_hit_${state.sessionId}`).setLabel("Hit").setStyle(ButtonStyle.Primary).setEmoji("🃏"),
    new ButtonBuilder().setCustomId(`bj_stand_${state.sessionId}`).setLabel("Stand").setStyle(ButtonStyle.Success).setEmoji("✋"),
  );
  if (canDouble) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`bj_double_${state.sessionId}`).setLabel("Double Down").setStyle(ButtonStyle.Secondary).setEmoji("💰")
    );
  }
  
  return { embed: coinEmbed(guildId, title, description, fields), components: [row] };
}

async function cmdBlackjack(guildId, userId, userTag, amount, action, sessionId) {
  const cfg = await economy.getConfig(guildId);
  const payout = cfg.blackjackPayout || 1.5;
  
  let gameState = null;
  if (sessionId && blackjackSessions.has(sessionId)) {
    const session = blackjackSessions.get(sessionId);
    if (session.userId !== userId || session.guildId !== guildId) {
      return { embeds: [errorEmbed(guildId, "Invalid Session", "This blackjack session doesn't belong to you.")] };
    }
    gameState = session.state;
  }

  const result = await economy.blackjack(guildId, userId, amount, action || "new", gameState);
  if (!result.success) return { embeds: [errorEmbed(guildId, "Blackjack Error", result.reason)] };
  
  if (result.finished) {
    blackjackSessions.delete(sessionId);
    const { embed, components } = formatBlackjackEmbed(guildId, userTag, { ...result, payout });
    return { embeds: [embed], components };
  } else {
    // Store session for next action
    const newSessionId = sessionId || `bj_${guildId}_${userId}_${Date.now()}`;
    blackjackSessions.set(newSessionId, { 
      userId, 
      guildId, 
      state: { 
        ...result, 
        sessionId: newSessionId,
        playerHand: result.playerHand,
        dealerHand: result.dealerHand,
        playerValue: result.playerValue,
        bet: result.bet,
        canDouble: result.canDouble
      } 
    });
    const { embed, components } = formatBlackjackEmbed(guildId, userTag, { 
      ...result, 
      sessionId: newSessionId,
      playerHand: result.playerHand,
      dealerHand: result.dealerHand,
      playerValue: result.playerValue,
      bet: result.bet,
      canDouble: result.canDouble
    });
    return { embeds: [embed], components };
  }
}

async function handleBlackjackAction(interaction, sessionId, action) {
  const session = blackjackSessions.get(sessionId);
  if (!session || session.userId !== interaction.user.id) {
    return interaction.update({ embeds: [errorEmbed(interaction.guildId, "Expired", "This game session has expired.")], components: [] });
  }
  
  const result = await cmdBlackjack(session.guildId, session.userId, interaction.user.tag, 0, action, sessionId);
  if (result.embeds) {
    await interaction.update(result);
  } else {
    await interaction.update({ embeds: [result], components: [] });
  }
}

const blackjackCmd = {
  name: "blackjack", description: "Play blackjack against the dealer", category: CATEGORY,
  prefix: async (m, a) => {
    const amount = parseInt(a[0], 10);
    if (!amount || amount < 1) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$blackjack <amount>")] });
    const result = await cmdBlackjack(m.guild.id, m.author.id, m.author.tag, amount);
    return m.reply(result);
  },
  slash: new SlashCommandBuilder().setName("blackjack").setDescription("Play blackjack against the dealer")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to bet").setRequired(true).setMinValue(1)),
  execute: async (i) => {
    const amount = i.options.getInteger("amount");
    const result = await cmdBlackjack(i.guild.id, i.user.id, i.user.tag, amount);
    return i.reply(result);
  },
};

const gamestatsCmd = {
  name: "gamestats", description: "View your game statistics", category: CATEGORY, aliases: ["gstats"],
  prefix: async (m, a) => {
    const target = m.mentions.users.first() || m.author;
    return m.reply({ embeds: [await cmdGameStats(m.guild.id, target.id, target.tag)] });
  },
  slash: new SlashCommandBuilder().setName("gamestats").setDescription("View your game statistics")
    .addUserOption(o => o.setName("user").setDescription("The user to check").setRequired(false)),
  execute: async (i) => {
    const target = i.options.getUser("user") || i.user;
    return i.reply({ embeds: [await cmdGameStats(i.guild.id, target.id, target.tag)] });
  },
};

const coinflipCmd = {
  name: "betflip", description: "Bet coins on a coin flip (heads or tails)", category: CATEGORY,
  prefix: async (m, a) => {
    const side = String(a[0] || "").toLowerCase();
    const amount = parseInt(a[1], 10);
    if ((side !== "heads" && side !== "tails") || !amount || amount < 1) {
      return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$betflip <heads|tails> <amount>")] });
    }
    return m.reply({ embeds: [await cmdCoinflip(m.guild.id, m.author.id, m.author.tag, side, amount)] });
  },
  slash: new SlashCommandBuilder().setName("betflip").setDescription("Bet coins on a coin flip (heads or tails)")
    .addStringOption(o => o.setName("side").setDescription("Your call").setRequired(true)
      .addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" }))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to bet").setRequired(true).setMinValue(1)),
  execute: async (i) => {
    const side = i.options.getString("side");
    const amount = i.options.getInteger("amount");
    return i.reply({ embeds: [await cmdCoinflip(i.guild.id, i.user.id, i.user.tag, side, amount)] });
  },
};

const highlowCmd = {
  name: "highlow", description: "Bet whether the next dice roll is higher or lower", category: CATEGORY,
  prefix: async (m, a) => {
    const guess = String(a[0] || "").toLowerCase();
    const amount = parseInt(a[1], 10);
    if ((guess !== "high" && guess !== "low") || !amount || amount < 1) {
      return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$highlow <high|low> <amount>")] });
    }
    return m.reply({ embeds: [await cmdHighlow(m.guild.id, m.author.id, m.author.tag, guess, amount)] });
  },
  slash: new SlashCommandBuilder().setName("highlow").setDescription("Bet whether the next dice roll is higher or lower")
    .addStringOption(o => o.setName("guess").setDescription("Higher or lower?").setRequired(true)
      .addChoices({ name: "Higher", value: "high" }, { name: "Lower", value: "low" }))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to bet").setRequired(true).setMinValue(1)),
  execute: async (i) => {
    const guess = i.options.getString("guess");
    const amount = i.options.getInteger("amount");
    return i.reply({ embeds: [await cmdHighlow(i.guild.id, i.user.id, i.user.tag, guess, amount)] });
  },
};

const depositCmd = {
  name: "deposit", description: "Deposit coins into your bank", category: CATEGORY,
  prefix: async (m, a) => {
    const amount = parseInt(a[0], 10);
    if (!amount || amount < 1) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$deposit <amount>")] });
    return m.reply({ embeds: [await cmdDeposit(m.guild.id, m.author.id, m.author.tag, amount)] });
  },
  slash: new SlashCommandBuilder().setName("deposit").setDescription("Deposit coins into your bank")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to deposit").setRequired(true).setMinValue(1)),
  execute: async (i) => {
    const amount = i.options.getInteger("amount");
    return i.reply({ embeds: [await cmdDeposit(i.guild.id, i.user.id, i.user.tag, amount)] });
  },
};

const withdrawCmd = {
  name: "withdraw", description: "Withdraw coins from your bank", category: CATEGORY,
  prefix: async (m, a) => {
    const amount = parseInt(a[0], 10);
    if (!amount || amount < 1) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$withdraw <amount>")] });
    return m.reply({ embeds: [await cmdWithdraw(m.guild.id, m.author.id, m.author.tag, amount)] });
  },
  slash: new SlashCommandBuilder().setName("withdraw").setDescription("Withdraw coins from your bank")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to withdraw").setRequired(true).setMinValue(1)),
  execute: async (i) => {
    const amount = i.options.getInteger("amount");
    return i.reply({ embeds: [await cmdWithdraw(i.guild.id, i.user.id, i.user.tag, amount)] });
  },
};

const shopCmd = {
  name: "shop", description: "View the server shop", category: CATEGORY,
  prefix: async (m) => m.reply({ embeds: [await cmdShop(m.guild)] }),
  slash: new SlashCommandBuilder().setName("shop").setDescription("View the server shop"),
  execute: async (i) => i.reply({ embeds: [await cmdShop(i.guild)] }),
};

const buyCmd = {
  name: "buy", description: "Buy an item from the server shop", category: CATEGORY,
  prefix: async (m, a) => {
    const itemId = parseInt(a[0], 10);
    if (!itemId) return m.reply({ embeds: [errorEmbed(m.guild.id, "Usage", "$buy <item id> — see $shop")] });
    return m.reply({ embeds: [await cmdBuy(m, m.guild, m.member, m.author.id, m.author.tag, itemId)] });
  },
  slash: new SlashCommandBuilder().setName("buy").setDescription("Buy an item from the server shop")
    .addIntegerOption(o => o.setName("id").setDescription("Shop item ID (from /shop)").setRequired(true).setMinValue(1)),
  execute: async (i) => {
    const itemId = i.options.getInteger("id");
    const member = i.member || (i.guild ? await i.guild.members.fetch(i.user.id).catch(() => null) : null);
    return i.reply({ embeds: [await cmdBuy(i, i.guild, member, i.user.id, i.user.tag, itemId)] });
  },
};

// ─── Interaction / reply routing (called from index.js) ────────────────────

// Handles bj_* and trivia_* button clicks. Returns true if it consumed the
// interaction, false if the customId belongs to something else.
async function routeGameButton(interaction) {
  if (!interaction.isButton?.() || !interaction.customId) return false;
  const id = interaction.customId;
  if (id.startsWith("bj_")) {
    // Format: bj_<action>_<sessionId>, where sessionId is itself "bj_<g>_<u>_<ts>".
    const rest = id.slice(3);
    const us = rest.indexOf("_");
    if (us === -1) return false;
    const action = rest.slice(0, us);
    const sessionId = rest.slice(us + 1);
    await handleBlackjackAction(interaction, sessionId, action);
    return true;
  }
  if (id.startsWith("trivia_")) {
    // Format: <sessionId>_<optionIndex>.
    const li = id.lastIndexOf("_");
    const sessionId = id.slice(0, li);
    const idx = parseInt(id.slice(li + 1), 10);
    if (Number.isNaN(idx)) return false;
    await handleTriviaAnswer(interaction, sessionId, idx);
    return true;
  }
  return false;
}

// Consumes a message that replies to an active typerace prompt. Returns true if
// handled so the caller can stop further processing of the message.
async function consumeTyperaceReply(message) {
  const replyTo = message.reference?.messageId;
  if (!replyTo) return false;
  for (const [sid, session] of typeraceSessions) {
    if (session.promptMessageId === replyTo && session.userId === message.author.id) {
      const embed = await handleTyperaceSubmit(message, sid, message.content);
      if (embed) await message.reply({ embeds: [embed] }).catch(() => {});
      return true;
    }
  }
  return false;
}

// Export handler for button interactions (trivia, etc.)
module.exports = [
  balanceCmd, dailyCmd, workCmd, payCmd, depositCmd, withdrawCmd, leaderboardCmd,
  gambleCmd, coinflipCmd, highlowCmd, robCmd,
  fishCmd, mineCmd, triviaCmd, wordleCmd, typeraceCmd, blackjackCmd,
  shopCmd, buyCmd, gamestatsCmd
];

// Export interaction handlers for index.js to use
module.exports.handleTriviaAnswer = handleTriviaAnswer;
module.exports.handleTyperaceSubmit = handleTyperaceSubmit;
module.exports.handleBlackjackAction = handleBlackjackAction;
module.exports.routeGameButton = routeGameButton;
module.exports.consumeTyperaceReply = consumeTyperaceReply;
module.exports.triviaSessions = triviaSessions;
module.exports.typeraceSessions = typeraceSessions;
module.exports.blackjackSessions = blackjackSessions;