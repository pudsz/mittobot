const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require("discord.js");
const { successEmbed } = require("../utils");
const aiMemory = require("../ai/memory");

// ─── $clearmymemories — clear all AI memories belonging to the calling user
async function prefixClearMyMemories(message, args, ctx) {
  const userId = message.author.id;
  const guildId = message.guild.id;

  const ownMemories = aiMemory.forUser(guildId, userId);
  if (ownMemories.length === 0) {
    return message.reply({
      embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("You have no stored memories to clear.")],
    });
  }

  let deleted = 0;
  for (const mem of ownMemories) {
    if (await aiMemory.forget(mem.id)) deleted++;
  }

  await message.reply({
    embeds: [successEmbed(`Cleared **${deleted}** of your stored memories. The bot will no longer remember these facts about you.`)],
  });
}

async function slashClearMyMemories(interaction, ctx) {
  const userId = interaction.user.id;
  const guildId = interaction.guild.id;

  const ownMemories = aiMemory.forUser(guildId, userId);
  if (ownMemories.length === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("You have no stored memories to clear.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Defer reply before the loop to avoid timeout (>3s on many memories)
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let deleted = 0;
  for (const mem of ownMemories) {
    if (await aiMemory.forget(mem.id)) deleted++;
  }

  await interaction.editReply({
    embeds: [successEmbed(`Cleared **${deleted}** of your stored memories. The bot will no longer remember these facts about you.`)],
  });
}

module.exports = [
  {
    name: "clearmymemories",
    description: "Delete all of your AI-stored memories so the bot forgets facts about you",
    defaultPermission: "all",
    prefix: prefixClearMyMemories,
    slash: new SlashCommandBuilder()
      .setName("clearmymemories")
      .setDescription("Delete all of your AI-stored memories so the bot forgets facts about you"),
    execute: slashClearMyMemories,
  },
];
