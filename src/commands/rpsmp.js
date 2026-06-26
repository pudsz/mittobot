// Multiplayer Rock Paper Scissors — challenge another user to a head-to-head match.
// Players click RPS buttons on the message; both picks reveal simultaneously when
// both have chosen. Games expire after 60s of inactivity.
const {
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const CATEGORY = "fun";
const BLURPLE = 0x5865f2;
const GAME_TIMEOUT_MS = 60_000;

const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };

// In-memory game registry: messageId -> { player1, player2, picks, messageRef }
const games = new Map();

// Returns "p1" | "p2" | "tie"
function determineWinner(p1, p2) {
  if (p1 === p2) return "tie";
  if (
    (p1 === "rock" && p2 === "scissors") ||
    (p1 === "paper" && p2 === "rock") ||
    (p1 === "scissors" && p2 === "paper")
  ) return "p1";
  return "p2";
}

function buildEmbed(player1, player2, picks, ended, winner) {
  const e = new EmbedBuilder().setColor(BLURPLE).setTitle("🎮 Rock Paper Scissors — Multiplayer");
  if (ended) {
    const revealed = `<@${player1}> played **${EMOJI[picks[player1]]}**\n<@${player2}> played **${EMOJI[picks[player2]]}**`;
    if (winner === "tie") {
      e.setDescription(`${revealed}\n\n🤝 **It's a tie!**`);
      e.setColor(0xfee75c);
    } else {
      const winnerId = winner === "p1" ? player1 : player2;
      e.setDescription(`${revealed}\n\n🎉 <@${winnerId}> **wins!**`);
      e.setColor(0x57f287);
    }
  } else {
    e.setDescription(
      `<@${player1}>: ${picks[player1] ? "✅ picked" : "❓ waiting"}\n` +
      `<@${player2}>: ${picks[player2] ? "✅ picked" : "❓ waiting"}\n\n` +
      `Each player, click your choice below! (expires in 60s)`
    );
  }
  return e;
}

function buildRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rpsmp_rock").setEmoji("🪨").setLabel("Rock").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("rpsmp_paper").setEmoji("📄").setLabel("Paper").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("rpsmp_scissors").setEmoji("✂️").setLabel("Scissors").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

async function startGame(source, opponent) {
  const author = source.author || source.user;
  if (!opponent || opponent.bot) {
    return source.reply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setDescription("❌ Challenge a real user, not a bot!")],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (opponent.id === author.id) {
    return source.reply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setDescription("❌ You can't challenge yourself.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = buildEmbed(author.id, opponent.id, {}, false);
  const row = buildRow();

  // Slash: deferReply first, then editReply, then fetchReply to track the message.
  // Prefix: reply directly returns the sent Message — track it from the return value.
  let msg;
  if (typeof source.deferReply === "function") {
    await source.deferReply();
    await source.editReply({ embeds: [embed], components: [row] });
    msg = await source.fetchReply();
  } else {
    msg = await source.reply({ embeds: [embed], components: [row] });
  }

  const game = {
    player1: author.id,
    player2: opponent.id,
    picks: {},
    messageRef: msg,
    timeout: setTimeout(async () => {
      const stillThere = games.get(msg.id);
      if (!stillThere) return;
      games.delete(msg.id);
      const e = buildEmbed(author.id, opponent.id, stillThere.picks, false)
        .setColor(0x95a5a6)
        .setDescription("⏱️ Game expired — not everyone picked in time.");
      try { await msg.edit({ embeds: [e], components: [] }); } catch { /* message may be deleted */ }
    }, GAME_TIMEOUT_MS).unref(),
  };
  games.set(msg.id, game);
}

// Public — called by index.js's interactionCreate handler when a Button
// interaction comes in with customId starting with "rpsmp_".
async function handleButton(interaction) {
  if (!interaction.customId?.startsWith("rpsmp_")) return false;
  const game = games.get(interaction.message.id);
  if (!game) {
    try {
      await interaction.update({
        embeds: [
          buildEmbed("?", "?", {}, false).setColor(0x95a5a6).setDescription("⏱️ This game has expired."),
        ],
        components: [],
      });
    } catch { /* ignore */ }
    return true;
  }
  if (![game.player1, game.player2].includes(interaction.user.id)) {
    await interaction.reply({ content: "Only the two players in this match can pick.", ephemeral: true });
    return true;
  }
  const pick = interaction.customId.replace("rpsmp_", "");
  if (game.picks[interaction.user.id] === pick) {
    await interaction.reply({ content: `You already picked **${EMOJI[pick]} ${pick}** — waiting for your opponent.`, ephemeral: true });
    return true;
  }
  game.picks[interaction.user.id] = pick;

  const bothPicked = game.picks[game.player1] && game.picks[game.player2];
  if (bothPicked) {
    clearTimeout(game.timeout);
    games.delete(interaction.message.id);
    const winner = determineWinner(game.picks[game.player1], game.picks[game.player2]);
    const endedEmbed = buildEmbed(game.player1, game.player2, game.picks, true, winner);
    await interaction.update({ embeds: [endedEmbed], components: [] });
    return true;
  }

  // One picked, waiting for the other
  const waitingEmbed = buildEmbed(game.player1, game.player2, game.picks, false);
  await interaction.update({ embeds: [waitingEmbed] });
  await interaction.followUp({ content: `Locked in **${EMOJI[pick]} ${pick}**! Waiting for your opponent…`, ephemeral: true });
  return true;
}

module.exports = [
  {
    name: "rpsmp",
    description: "Challenge another user to multiplayer Rock Paper Scissors",
    category: CATEGORY,
    slash: new SlashCommandBuilder()
      .setName("rpsmp")
      .setDescription("Challenge another user to multiplayer Rock Paper Scissors")
      .addUserOption(o => o.setName("opponent").setDescription("User to challenge").setRequired(true)),
    prefix: async (message) => {
      const opponent = message.mentions?.users?.first();
      if (!opponent) {
        return message.reply({
          embeds: [new EmbedBuilder().setColor(0xed4245).setDescription("❌ Usage: `$rpsmp @user`")],
        });
      }
      await startGame(message, opponent);
    },
    execute: async (interaction) => {
      const opponent = interaction.options.getUser("opponent");
      // startGame handles deferReply for slash interactions — don't pre-defer here.
      await startGame(interaction, opponent);
    },
  },
];

// Expose for the interaction handler in index.js
module.exports.handleRpsMpButton = handleButton;
