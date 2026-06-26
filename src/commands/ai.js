const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const settings = require("../settings");
const { chatWithProvider, splitMessage, parseFallbackList, cleanResponse } = require("../ai");
const { getProvider } = require("../ai/providers");

// ─── $resetglobalconversation — clear all AI memories for this server
//     Owner-only. Resets the AI's learned facts so it starts fresh.
async function prefixResetGlobalConversation(message, args, ctx) {
  const aiMemory = require("../ai/memory");
  await aiMemory.clear(message.guild.id);
  await message.reply({
    embeds: [successEmbed("All AI memories for this server have been cleared. The bot will start fresh in conversations.")],
  });
}

async function slashResetGlobalConversation(interaction, ctx) {
  const aiMemory = require("../ai/memory");
  await aiMemory.clear(interaction.guild.id);
  await interaction.reply({
    embeds: [successEmbed("All AI memories for this server have been cleared. The bot will start fresh in conversations.")],
  });
}

// Build the fallback chain (reuses parseFallbackList from ai.js)
function buildProviderChain() {
  const primaryId = settings.get("aiProvider") || "groq";
  const fallbackIds = parseFallbackList(settings.get("aiFallbackProviders"));
  return [primaryId, ...fallbackIds].filter((id, i, arr) => arr.indexOf(id) === i);
}

// Shared AI call logic for both prefix and slash.
// `msgLike` must have a `.guild` property (Discord Message or Interaction).
async function runAiQuery(userContent, authorTag, authorId, ctx, msgLike) {
  const system = settings.get("aiSystemPrompt") || "You are a helpful assistant.";
  const messages = [
    { role: "system", content: system },
    { role: "user", content: `[${authorTag} <@${authorId}>]: ${userContent}` },
  ];

  const providerIds = buildProviderChain();
  const result = await chatWithProvider(providerIds, messages);
  const response = result.result;
  const thinkingEnabled = settings.get("aiThinkingEnabled") === true;

  let reply;
  if (typeof response === "string") {
    reply = cleanResponse(response, thinkingEnabled);
  } else {
    const { text, toolCalls } = response;
    reply = cleanResponse(text || "", thinkingEnabled);

    // Execute any tool calls inline (single-pass, no loop)
    if (toolCalls && toolCalls.length > 0) {
      const tools = require("../ai/tools");
      for (const tc of toolCalls) {
        let toolResult;
        try {
          toolResult = await tools.executeTool(tc.name, tc.args, ctx, msgLike);
        } catch (err) {
          toolResult = "Error: " + err.message;
        }
        reply += "\n\n> *Used `" + tc.name + "`:* " + toolResult;
      }
    }
  }

  return reply;
}

// ─── $ai <message> — standalone AI query, separate from global conversation.
//     Admin-only. Sends a direct query to the AI without channel context,
//     chatty mode, pings, or any conversational history.
async function prefixAi(message, args, ctx) {
  const query = args.join(" ").trim();
  if (!query) {
    return message.reply({
      embeds: [errorEmbed("Usage: `$ai <your message>` — ask the AI a question directly.")],
    });
  }

  if (query.length > 1500) {
    return message.reply({
      embeds: [errorEmbed("Message too long — keep it under 1500 characters.")],
    });
  }

  if (!settings.get("aiEnabled")) {
    return message.reply({ embeds: [errorEmbed("AI is currently disabled.")] });
  }

  // Check if any provider in the chain has a configured key
  const chain = buildProviderChain();
  const hasAnyKey = chain.some(id => settings.getAiApiKey(id));
  if (!hasAnyKey) {
    return message.reply({ embeds: [errorEmbed("No AI API key is configured. Set one up in the dashboard.")] });
  }

  await message.channel.sendTyping();

  const authorTag = message.member?.displayName || message.author.username;
  let reply;
  try {
    reply = await runAiQuery(query, authorTag, message.author.id, ctx, message);
  } catch (err) {
    console.error("$ai command error:", err.message);
    return message.reply({ embeds: [errorEmbed("AI error: " + err.message)] });
  }

  if (!reply || !reply.trim()) {
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("The AI returned an empty response.")] });
  }

  // Send as raw text, split if needed — reply to first chunk, send rest
  const MAX_LEN = 2000;
  const chunks = splitMessage(reply, MAX_LEN);
  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      await message.reply(chunks[i]);
    } else {
      await message.channel.send(chunks[i]);
    }
  }
}

module.exports = [
  {
    name: "resetglobalconversation",
    description: "Clear all AI memories for this server (owner-only)",
    defaultPermission: "owner",
    prefix: prefixResetGlobalConversation,
    slash: new SlashCommandBuilder()
      .setName("resetglobalconversation")
      .setDescription("Clear all AI memories for this server (owner-only)"),
    execute: slashResetGlobalConversation,
  },
  {
    name: "ai",
    description: "Ask the AI a direct question (admin-only, bypasses channel context)",
    defaultPermission: "admin",
    prefix: prefixAi,
    slash: new SlashCommandBuilder()
      .setName("ai")
      .setDescription("Ask the AI a direct question (bypasses channel context)")
      .addStringOption(o =>
        o.setName("query").setDescription("Your question or prompt").setRequired(true).setMaxLength(1500)
      ),
    async execute(interaction, ctx) {
      const query = interaction.options.getString("query");
      if (!settings.get("aiEnabled")) {
        return interaction.reply({ embeds: [errorEmbed("AI is currently disabled.")], ephemeral: true });
      }
      const chain = buildProviderChain();
      if (!chain.some(id => settings.getAiApiKey(id))) {
        return interaction.reply({ embeds: [errorEmbed("No AI API key configured.")], ephemeral: true });
      }

      await interaction.deferReply();
      const authorTag = interaction.member?.displayName || interaction.user.username;
      let reply;
      try {
        reply = await runAiQuery(query, authorTag, interaction.user.id, ctx, interaction);
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed("AI error: " + err.message)] });
      }

      if (!reply || !reply.trim()) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("The AI returned an empty response.")] });
      }

      // Split if needed (consistent with prefix version)
      const chunks = splitMessage(reply, 2000);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    },
  },
];
