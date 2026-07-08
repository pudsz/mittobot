const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { errorEmbed, successEmbed, OWNER_IDS } = require("../utils");
const settings = require("../settings");
const db = require("../db");
const ui = require("../ui");
const { chatWithProvider, splitMessage, parseFallbackList, cleanResponse, sanitizeUserInput } = require("../ai");
const aiMemory = require("../ai/memory");
const { getPersonality, listPersonalities, DEFAULT_PERSONALITY } = require("../ai/personalities");

const BLURPLE = 0x5865f2;

const SETTABLE_KEYS = {
  aiEnabled:         { type: "boolean", description: "Enable or disable the AI system" },
  aiProvider:        { type: "string",  description: "Active AI provider (groq, openai, claude, gemini, nvidia, deepseek, together, custom)" },
  aiTemperature:     { type: "number",  description: "Response creativity (0.0 = precise, 2.0 = creative)", min: 0, max: 2 },
  aiMaxTokens:       { type: "number",  description: "Max response length in tokens", min: 64, max: 8192 },
  aiTopP:            { type: "number",  description: "Nucleus sampling threshold (0.0-1.0)", min: 0, max: 1 },
  aiContextLimit:    { type: "number",  description: "Recent messages to include as context (1-20)", min: 1, max: 20 },
  aiToolsEnabled:    { type: "boolean", description: "Allow AI to use Discord tools (moderation, etc.)" },
  aiMemoryEnabled:   { type: "boolean", description: "Enable AI memory system" },
  aiThinkingEnabled: { type: "boolean", description: "Enable thinking mode for supported providers" },
  aiKeyword:         { type: "string",  description: "Keyword that triggers the AI in chat" },
  aiChattyMode:      { type: "boolean", description: "Respond to natural conversation without being pinged" },
  aiChattyCooldown:  { type: "number",  description: "Seconds between chatty responses (5-3600)", min: 5, max: 3600 },
  aiPersonality:     { type: "string",  description: "AI personality preset (neutral, playful, serious, warm, quirky)" },
  aiFallbackProviders: { type: "string", description: "Comma-separated fallback provider IDs" },
  aiSystemPrompt:    { type: "string",  description: "Custom system prompt for the AI (max ~1500 chars in Discord)" },
  aiAllowedChannels: { type: "string",  description: "Comma-separated channel IDs where AI can respond (empty = everywhere)" },
  aiIgnoredChannels: { type: "string",  description: "Comma-separated channel IDs where AI should ignore messages" },
  aiDmEnabled:       { type: "boolean", description: "Enable AI responses in direct messages" },
  aiBrowserEnabled:  { type: "boolean", description: "Enable Playwright-powered browse_page tool" },
  customBaseUrl:     { type: "string",  description: "Custom provider API base URL (for custom provider)" },
  customApiType:     { type: "string",  description: "Custom API type: openai or anthropic" },
  aiToolPermissions: { type: "string",  description: "JSON map of tool → min perm level (e.g. {\"warn_member\":\"mod\"})" },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function isGuildOwner(member) {
  if (!member) return false;
  if (OWNER_IDS.has(member.id)) return true;
  if (member.guild?.ownerId && member.id === member.guild.ownerId) return true;
  return false;
}

function buildProviderChain() {
  const primaryId = settings.get("aiProvider") || "groq";
  const fallbackIds = parseFallbackList(settings.get("aiFallbackProviders"));
  return [primaryId, ...fallbackIds].filter((id, i, arr) => arr.indexOf(id) === i);
}

// ─── Prefix: $resetglobalconversation ─────────────────────────────────────
async function prefixResetGlobalConversation(message, args, ctx) {
  await aiMemory.clear(message.guild.id);
  await message.reply({
    embeds: [successEmbed("All AI memories for this server have been cleared. The bot will start fresh in conversations.", message)],
  });
}

async function slashResetGlobalConversation(interaction, ctx) {
  await aiMemory.clear(interaction.guild.id);
  await interaction.reply({
    embeds: [successEmbed("All AI memories for this server have been cleared. The bot will start fresh in conversations.", interaction)],
  });
}

// ─── Shared AI call logic ─────────────────────────────────────────────────
async function runAiQuery(userContent, authorTag, authorId, ctx, msgLike) {
  userContent = sanitizeUserInput(userContent);

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

    if (toolCalls && toolCalls.length > 0) {
      const tools = require("../ai/tools");
      for (const tc of toolCalls) {
        let toolResult;
        const toolStart = Date.now();
        try {
          toolResult = await tools.executeTool(tc.name, tc.args, ctx, msgLike);
          if (msgLike.guild) ctx.data.logAlphaTelemetry({ userId: msgLike.author.id, guildId: msgLike.guild.id, toolName: tc.name, success: true, durationMs: Date.now() - toolStart });
        } catch (err) {
          toolResult = "Error: " + err.message;
          if (msgLike.guild) ctx.data.logAlphaTelemetry({ userId: msgLike.author.id, guildId: msgLike.guild.id, toolName: tc.name, success: false, errorMsg: err.message, durationMs: Date.now() - toolStart });
        }
        reply += "\n\n> *Used `" + tc.name + "`:* " + toolResult;
      }
    }
  }

  return reply;
}

// ─── Slash: /ai chat ──────────────────────────────────────────────────────
async function handleAiChat(interaction, ctx) {
  const query = interaction.options.getString("query");
  if (!settings.get("aiEnabled")) {
    return interaction.reply({ embeds: [errorEmbed("AI is currently disabled.", interaction)], flags: MessageFlags.Ephemeral });
  }
  const chain = buildProviderChain();
  if (!chain.some(id => settings.getAiApiKey(id))) {
    return interaction.reply({ embeds: [errorEmbed("No AI API key configured.", interaction)], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();
  const authorTag = interaction.member?.displayName || interaction.user.username;
  let reply;
  try {
    reply = await runAiQuery(query, authorTag, interaction.user.id, ctx, interaction);
  } catch (err) {
    return interaction.editReply({ embeds: [errorEmbed("AI error: " + err.message, interaction)] });
  }

  if (!reply || !reply.trim()) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("The AI returned an empty response.")] });
  }

  const chunks = splitMessage(reply, 2000);
  await interaction.editReply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i]);
  }
}

// ─── Interactive Settings Wizard ─────────────────────────────────────────
// Uses the ui.js panel system: category picker → setting detail → edit via
// inline toggle (booleans), modal (strings/numbers), or select menu (choices).

// Maps userId → { guildId, messageId } so modal/select handlers can find the
// active panel session and update it directly (modals and follow-up selects
// arrive as separate interactions whose message.id doesn't match the panel).
const activePanels = new Map();

const SETTING_CATEGORIES = {
  general:  { emoji: "📋", label: "General",    keys: ["aiEnabled", "aiProvider", "aiKeyword", "aiSystemPrompt"] },
  behavior: { emoji: "🧠", label: "Behavior",   keys: ["aiTemperature", "aiMaxTokens", "aiTopP", "aiContextLimit", "aiPersonality"] },
  features: { emoji: "🔧", label: "Features",   keys: ["aiToolsEnabled", "aiMemoryEnabled", "aiThinkingEnabled", "aiChattyMode", "aiChattyCooldown", "aiDmEnabled", "aiBrowserEnabled"] },
  channels: { emoji: "📢", label: "Channels",   keys: ["aiAllowedChannels", "aiIgnoredChannels"] },
  advanced: { emoji: "⚡", label: "Advanced",   keys: ["aiFallbackProviders", "customBaseUrl", "customApiType", "aiToolPermissions"] },
};

function formatSettingValue(key, meta) {
  const raw = settings.get(key);
  if (meta.type === "boolean") return raw ? "✅ On" : "❌ Off";
  if (meta.type === "number" && raw !== undefined && raw !== null) return `\`${raw}\``;
  if (key === "aiPersonality") {
    const p = getPersonality(raw);
    return `${p.emoji} **${p.name}**`;
  }
  return raw ? `\`${String(raw).slice(0, 60)}\`` : "*(not set)*";
}

function categoryEmbed(catId, session) {
  const cat = SETTING_CATEGORIES[catId];
  const lines = cat.keys.map(k => {
    const meta = SETTABLE_KEYS[k];
    const val = formatSettingValue(k, meta);
    return `**${k}** — ${val}\n${meta.description}\n`;
  });
  return new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(`${cat.emoji} ${cat.label} Settings`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Click a button below to change a setting" });
}

function buildCategoryView(catId) {
  const cat = SETTING_CATEGORIES[catId];
  const embed = categoryEmbed(catId);
  const rows = [];
  let currentRow = new ActionRowBuilder();
  for (const key of cat.keys) {
    const meta = SETTABLE_KEYS[key];
    if (meta.type === "boolean") {
      // Boolean: inline toggle
      const isOn = settings.get(key) === true;
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`aisettings:toggle:${key}`)
          .setLabel(key.replace(/^(ai)/, "").replace(/^./, c => c.toUpperCase()))
          .setEmoji(isOn ? "🟢" : "🔴")
          .setStyle(isOn ? ButtonStyle.Success : ButtonStyle.Danger)
      );
    } else {
      // String/Number: edit button
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`aisettings:edit:${key}`)
          .setLabel(key.replace(/^(ai)/, "").replace(/^./, c => c.toUpperCase()).slice(0, 20))
          .setEmoji("✏️")
          .setStyle(ButtonStyle.Secondary)
      );
    }
    // Discord max 5 components per row
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }
  if (currentRow.components.length > 0) rows.push(currentRow);
  // Back button
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("aisettings:back").setEmoji("↩️").setLabel("Back to categories").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aisettings:close").setEmoji("🚪").setLabel("Close").setStyle(ButtonStyle.Danger),
  ));
  return { embeds: [embed], components: rows };
}

function buildCategoryPicker() {
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle("⚙️ AI Settings Wizard")
    .setDescription("Select a category to configure AI settings.\n\n" +
      Object.entries(SETTING_CATEGORIES).map(([id, c]) => `${c.emoji} **${c.label}** — ${c.keys.length} settings`).join("\n"));
  const select = new StringSelectMenuBuilder()
    .setCustomId("aisettings:cat")
    .setPlaceholder("Choose a category…")
    .addOptions(
      Object.entries(SETTING_CATEGORIES).map(([id, c]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setEmoji(c.emoji)
          .setDescription((() => { const d = `${c.keys.length} settings: ${c.keys.join(", ")}`; return d.length > 100 ? d.slice(0, 97) + "…" : d; })())
          .setValue(id)
      )
    );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("aisettings:close").setEmoji("🚪").setLabel("Close").setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

ui.registerPanel("aisettings", {
  level: "admin",
  async render(session) {
    if (session.state.category) {
      return buildCategoryView(session.state.category);
    }
    return buildCategoryPicker();
  },
  handlers: {
    // Category select
    async cat(interaction, session, { repaint }) {
      session.state.category = interaction.values[0];
      await repaint();
    },
    // Back to category picker
    async back(interaction, session, { repaint }) {
      delete session.state.category;
      await repaint();
    },
    // Close the panel
    async close(interaction, session) {
      await interaction.update({ embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("Settings wizard closed.")], components: [] });
      ui.endSession(interaction.message.id);
    },
    // Toggle a boolean setting
    async toggle(interaction, session, { repaint, arg }) {
      const key = arg;
      const meta = SETTABLE_KEYS[key];
      if (!meta || meta.type !== "boolean") return;
      const newVal = !settings.get(key);
      settings.set(key, newVal);
      await repaint();
      await ui.ephemeralNote(interaction, `✅ Set \`${key}\` to ${newVal ? "On" : "Off"}`);
    },
    // Open a modal for string/number/choice input
    async edit(interaction, session, { arg }) {
      const key = arg;
      const meta = SETTABLE_KEYS[key];
      if (!meta) return;

      const currentVal = settings.get(key);
      const modalId = `aisettings_modal:${key}`;

      // Choice-based settings: use a select menu
      if (key === "aiProvider") {
        const { listProviders } = require("../ai/providers");
        const providers = listProviders();
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`aisettings:setprovider`)
            .setPlaceholder("Select a provider…")
            .addOptions(providers.map(p => ({
              label: p.label,
              value: p.id,
              default: p.id === currentVal,
            })))
        );
        await interaction.reply({ content: "Choose an AI provider:", components: [row], flags: MessageFlags.Ephemeral });
        return;
      }

      if (key === "aiPersonality") {
        const presets = listPersonalities();
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`aisettings:setpersonality`)
            .setPlaceholder("Select a personality…")
            .addOptions(presets.map(p => ({
              label: `${p.emoji} ${p.name}`,
              value: p.id,
              description: p.description.slice(0, 100),
              default: p.id === (currentVal || DEFAULT_PERSONALITY),
            })))
        );
        await interaction.reply({ content: "Choose an AI personality:", components: [row], flags: MessageFlags.Ephemeral });
        return;
      }

      if (key === "customApiType") {
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`aisettings:set:`)
            .setPlaceholder("API type…")
            .addOptions([
              { label: "OpenAI", value: "openai", default: (currentVal || "openai") === "openai" },
              { label: "Anthropic", value: "anthropic", default: currentVal === "anthropic" },
            ])
        );
        await interaction.reply({ content: "Choose API type:", components: [row], flags: MessageFlags.Ephemeral });
        return;
      }

      if (key === "aiChattyCooldown" || key === "aiContextLimit" || key === "aiMaxTokens" ||
          key === "aiTemperature" || key === "aiTopP") {
        // Modal for numbers
        const modal = new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(`Edit ${key}`);
        const label = key === "aiChattyCooldown" ? "Seconds (5-3600)"
          : key === "aiContextLimit" ? "Messages (1-20)"
          : key === "aiMaxTokens" ? "Tokens (64-8192)"
          : key === "aiTemperature" ? "Value (0.0-2.0)"
          : "Value (0.0-1.0)";
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("value")
              .setLabel(label)
              .setStyle(TextInputStyle.Short)
              .setValue(currentVal != null ? String(currentVal) : "")
              .setRequired(true)
          )
        );
        await interaction.showModal(modal);
        return;
      }

      // Long text fields use a paragraph modal
      const isLong = key === "aiSystemPrompt" || key === "aiToolPermissions" ||
                     key === "aiAllowedChannels" || key === "aiIgnoredChannels";
      const modal = new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Edit ${key}`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("value")
            .setLabel(meta.description.slice(0, 45))
            .setStyle(isLong ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setValue(currentVal ? String(currentVal) : "")
            .setRequired(key !== "aiSystemPrompt")
        )
      );
      await interaction.showModal(modal);
    },
    // Provider select from the inline reply
    async setprovider(interaction, session, { repaint }) {
      const key = "aiProvider";
      const parsed = interaction.values[0];
      const { listProviders } = require("../ai/providers");
      const valid = listProviders().map(p => p.id);
      if (!valid.includes(parsed)) return;
      settings.set(key, parsed);
      await interaction.update({ content: `✅ Set \`${key}\` to \`${parsed}\``, components: [], flags: MessageFlags.Ephemeral });
      await repaintActivePanel(interaction.user.id);
    },
    // Personality select from the inline reply
    async setpersonality(interaction, session, { repaint }) {
      const key = "aiPersonality";
      const parsed = interaction.values[0];
      const valid = listPersonalities().map(p => p.id);
      if (!valid.includes(parsed)) return;
      settings.set(key, parsed);
      await interaction.update({ content: `✅ Set \`${key}\` to \`${parsed}\``, components: [], flags: MessageFlags.Ephemeral });
      await repaintActivePanel(interaction.user.id);
    },
    // Generic set for customApiType
    async set(interaction, session, { repaint }) {
      const parsed = interaction.values[0];
      settings.set("customApiType", parsed);
      await interaction.update({ content: `✅ Set \`customApiType\` to \`${parsed}\``, components: [], flags: MessageFlags.Ephemeral });
      await repaintActivePanel(interaction.user.id);
    },
  },
  modals: {
    async aiTemperature(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiMaxTokens(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiTopP(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiContextLimit(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiChattyCooldown(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiKeyword(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiFallbackProviders(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiSystemPrompt(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async customBaseUrl(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiToolPermissions(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiAllowedChannels(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
    async aiIgnoredChannels(interaction, session, { repaint }) {
      await handleModalSubmit(interaction, session, repaint);
    },
  },
});

// Find the active panel session for a user and repaint its category view.
// Called from modal and select handlers where the interaction's message.id
// doesn't match the panel session's message.
async function repaintActivePanel(userId) {
  const ref = activePanels.get(userId);
  if (!ref) return;
  const panelSession = ui.getSession(ref.messageId, "panel:aisettings");
  if (!panelSession || !panelSession.message?.editable) return;
  const payload = panelSession.state.category
    ? buildCategoryView(panelSession.state.category)
    : buildCategoryPicker();
  await panelSession.message.edit(payload).catch(() => {});
}

async function handleModalSubmit(interaction, session, repaint) {
  const actualKey = interaction.customId.includes(":")
    ? interaction.customId.split(":").pop()
    : interaction.customId.replace("aisettings_modal:", "");
  const rawValue = interaction.fields.getTextInputValue("value");
  const meta = SETTABLE_KEYS[actualKey];
  if (!meta) return;

  let parsed;
  if (meta.type === "number") {
    parsed = parseFloat(rawValue);
    if (isNaN(parsed)) {
      await interaction.reply({ content: `❌ \`${actualKey}\` expects a numeric value.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (meta.min !== undefined && parsed < meta.min) {
      await interaction.reply({ content: `❌ Minimum value is ${meta.min}.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (meta.max !== undefined && parsed > meta.max) {
      await interaction.reply({ content: `❌ Maximum value is ${meta.max}.`, flags: MessageFlags.Ephemeral });
      return;
    }
  } else {
    parsed = rawValue.trim();
    if (!parsed && actualKey !== "aiSystemPrompt") {
      await interaction.reply({ content: `❌ \`${actualKey}\` requires a non-empty value.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (actualKey === "customApiType" && parsed !== "openai" && parsed !== "anthropic") {
      await interaction.reply({ content: "❌ customApiType must be \`openai\` or \`anthropic\`.", flags: MessageFlags.Ephemeral });
      return;
    }
  }

  settings.set(actualKey, parsed);
  await interaction.reply({
    content: `✅ Set \`${actualKey}\` to \`${meta.type === "number" ? parsed : String(parsed).slice(0, 100)}\``,
    flags: MessageFlags.Ephemeral,
  });
  // Update the panel to reflect the change
  await repaintActivePanel(interaction.user.id);
}

async function handleSettingsWizard(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can configure AI settings.", interaction)], flags: MessageFlags.Ephemeral });
  }
  const msg = await ui.openPanel(interaction, "aisettings", {
    ownerId: interaction.user.id,
    guildId: interaction.guild.id,
    state: {},
    ephemeral: true,
    ttlMs: 600_000,
  });
  if (msg?.id) {
    activePanels.set(interaction.user.id, { messageId: msg.id, guildId: interaction.guild.id });
  }
  return msg;
}

// ─── Slash: /ai settings view ─────────────────────────────────────────────
async function handleSettingsView(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can view AI settings.", interaction)], flags: MessageFlags.Ephemeral });
  }

  const personalityOpts = listPersonalities().map(p => `${p.emoji} **${p.name}** (\`${p.id}\`)`).join("\n");
  const personalityCurrent = getPersonality(settings.get("aiPersonality"));

  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle("⚙️ AI Configuration")
    .addFields(
      { name: "Enabled", value: settings.get("aiEnabled") ? "✅ Yes" : "❌ No", inline: true },
      { name: "Provider", value: `\`${settings.get("aiProvider") || "groq"}\``, inline: true },
      { name: "Keywords", value: `\`${settings.get("aiKeyword") || "mitto"}\``, inline: true },
      { name: "Temperature", value: `\`${settings.get("aiTemperature") ?? 0.7}\``, inline: true },
      { name: "Max Tokens", value: `\`${settings.get("aiMaxTokens") ?? 4096}\``, inline: true },
      { name: "Top P", value: `\`${settings.get("aiTopP") ?? 1.0}\``, inline: true },
      { name: "Context Limit", value: `\`${settings.get("aiContextLimit") ?? 8}\` messages`, inline: true },
      { name: "Tools", value: settings.get("aiToolsEnabled") ? "✅ On" : "❌ Off", inline: true },
      { name: "Memory", value: settings.get("aiMemoryEnabled") ? "✅ On" : "❌ Off", inline: true },
      { name: "Thinking Mode", value: settings.get("aiThinkingEnabled") ? "✅ On" : "❌ Off", inline: true },
      { name: "Chatty Mode", value: settings.get("aiChattyMode") ? `✅ On (${settings.get("aiChattyCooldown")}s)` : "❌ Off", inline: true },
      { name: "Fallback Providers", value: `\`${settings.get("aiFallbackProviders") || "none"}\``, inline: true },
      { name: "Personality", value: `${personalityCurrent.emoji} **${personalityCurrent.name}** (\`${personalityCurrent.id}\`)`, inline: false },
      { name: "DM Responses", value: settings.get("aiDmEnabled") !== false ? "✅ On" : "❌ Off", inline: true },
      { name: "Browser Tool", value: settings.get("aiBrowserEnabled") !== false ? "✅ On" : "❌ Off", inline: true },
      { name: "Allowed Channels", value: settings.get("aiAllowedChannels") ? `\`${settings.get("aiAllowedChannels")}\`` : "All", inline: true },
      { name: "Ignored Channels", value: settings.get("aiIgnoredChannels") ? `\`${settings.get("aiIgnoredChannels")}\`` : "None", inline: true },
      { name: "Custom Base URL", value: settings.get("customBaseUrl") ? `\`${settings.get("customBaseUrl")}\`` : "Not set", inline: true },
      { name: "Custom API Type", value: `\`${settings.get("customApiType") || "openai"}\``, inline: true },
    )
    .setFooter({ text: "Use /ai settings wizard for interactive setup or /ai settings set for raw key-value" });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── Slash: /ai settings set ──────────────────────────────────────────────
async function handleSettingsSet(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can change AI settings.", interaction)], flags: MessageFlags.Ephemeral });
  }

  const key = interaction.options.getString("key");
  const rawValue = interaction.options.getString("value");

  const meta = SETTABLE_KEYS[key];
  if (!meta) {
    const validKeys = Object.keys(SETTABLE_KEYS).join(", ");
    return interaction.reply({
      embeds: [errorEmbed(`Unknown setting \`${key}\`. Valid keys: ${validKeys}`, interaction)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Validate and parse the value
  let parsed;
  if (meta.type === "boolean") {
    const lower = rawValue.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "1" || lower === "on") {
      parsed = true;
    } else if (lower === "false" || lower === "no" || lower === "0" || lower === "off") {
      parsed = false;
    } else {
      return interaction.reply({
        embeds: [errorEmbed(`\`${key}\` expects a boolean value (true/false, yes/no, on/off)`, interaction)],
        flags: MessageFlags.Ephemeral,
      });
    }
  } else if (meta.type === "number") {
    parsed = parseFloat(rawValue);
    if (isNaN(parsed)) {
      return interaction.reply({
        embeds: [errorEmbed(`\`${key}\` expects a numeric value`, interaction)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (meta.min !== undefined && parsed < meta.min) {
      return interaction.reply({
        embeds: [errorEmbed(`\`${key}\` minimum value is ${meta.min}`, interaction)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (meta.max !== undefined && parsed > meta.max) {
      return interaction.reply({
        embeds: [errorEmbed(`\`${key}\` maximum value is ${meta.max}`, interaction)],
        flags: MessageFlags.Ephemeral,
      });
    }    } else {
      // string type
      parsed = rawValue.trim();
      // Allow clearing aiSystemPrompt to revert to the harness default
      if (!parsed && key !== "aiSystemPrompt") {
        return interaction.reply({
          embeds: [errorEmbed(`\`${key}\` requires a non-empty value`, interaction)],
          flags: MessageFlags.Ephemeral,
        });
      }
    // Validate personality IDs for the aiPersonality key
    if (key === "aiPersonality") {
      const validIds = listPersonalities().map(p => p.id);
      if (!validIds.includes(parsed)) {
        return interaction.reply({
          embeds: [errorEmbed(`Invalid personality \`${parsed}\`. Valid options: ${validIds.join(", ")}`, interaction)],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
    // Validate provider IDs for aiProvider
    if (key === "aiProvider") {
      const { listProviders } = require("../ai/providers");
      const validProviders = listProviders().map(p => p.id);
      if (!validProviders.includes(parsed)) {
        return interaction.reply({
          embeds: [errorEmbed(`Invalid provider \`${parsed}\`. Valid options: ${validProviders.join(", ")}`, interaction)],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
    // Validate customApiType: must be "openai" or "anthropic"
    if (key === "customApiType") {
      if (parsed !== "openai" && parsed !== "anthropic") {
        return interaction.reply({
          embeds: [errorEmbed("customApiType must be \`openai\` or \`anthropic\`", interaction)],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  // Apply the setting
  // Allow clearing aiSystemPrompt back to the default (harness prompt)
  if (key === "aiSystemPrompt" && parsed === "") {
    settings.set(key, "");
  } else {
    settings.set(key, parsed);
  }

  const displayValue = meta.type === "boolean" ? (parsed ? "true" : "false") : String(parsed);
  await interaction.reply({
    embeds: [successEmbed(`Set \`${key}\` to \`${displayValue}\``, interaction)],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Slash: /ai memory list ───────────────────────────────────────────────
const MEMORIES_PER_PAGE = 10;

async function handleMemoryList(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can view AI memories.", interaction)], flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild.id;
  const all = [
    ...aiMemory.serverMemories(guildId).map(m => ({ ...m, scope: "server" })),
    ...aiMemory.forGuild(guildId).filter(m => m.userId).map(m => ({ ...m, scope: "user" })),
  ];
  all.sort((a, b) => b.createdAt - a.createdAt);

  if (all.length === 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("No memories stored for this guild.")],
    });
  }

  const totalPages = Math.ceil(all.length / MEMORIES_PER_PAGE) || 1;
  let page = 0;

  function buildPage(pageNum) {
    const start = pageNum * MEMORIES_PER_PAGE;
    const slice = all.slice(start, start + MEMORIES_PER_PAGE);
    const lines = slice.map(m => {
      const date = new Date(m.createdAt).toLocaleDateString();
      const scopeLabel = m.scope === "server" ? "🌐 Server" : `👤 User <@${m.userId}>`;
      return `\`#${m.id}\` ${scopeLabel} • ${date}\n${m.content.slice(0, 200)}`;
    });

    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle("🧠 AI Memories")
      .setDescription(lines.join("\n\n"))
      .setFooter({ text: `Page ${pageNum + 1} / ${totalPages} • ${all.length} total memories` });

    const row = new ActionRowBuilder();
    if (pageNum > 0) {
      row.addComponents(new ButtonBuilder().setCustomId("memlist:prev").setEmoji("◀️").setStyle(ButtonStyle.Secondary));
    }
    if (pageNum < totalPages - 1) {
      row.addComponents(new ButtonBuilder().setCustomId("memlist:next").setEmoji("▶️").setStyle(ButtonStyle.Secondary));
    }
    row.addComponents(new ButtonBuilder().setCustomId("memlist:close").setLabel("Close").setStyle(ButtonStyle.Danger));

    return { embeds: [embed], components: row.components.length > 0 ? [row] : [] };
  }

  const msg = await interaction.editReply(buildPage(page));

  const filter = i => i.customId.startsWith("memlist:") && i.user.id === interaction.user.id;
  const collector = msg.createMessageComponentCollector({ filter, time: 60_000 });

  collector.on("collect", async i => {
    if (i.customId === "memlist:prev" && page > 0) page--;
    else if (i.customId === "memlist:next" && page < totalPages - 1) page++;
    else if (i.customId === "memlist:close") {
      await i.update({ components: [] });
      return collector.stop();
    }
    await i.update(buildPage(page));
  });

  collector.on("end", async () => {
    try { await interaction.editReply({ components: [] }); } catch { /* ephemeral expired */ }
  });
}

// ─── Slash: /ai memory show <id> ─────────────────────────────────────────
async function handleMemoryShow(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can view AI memories.", interaction)], flags: MessageFlags.Ephemeral });
  }

  const id = interaction.options.getInteger("id");
  const guildId = interaction.guild.id;
  const all = aiMemory.forGuild(guildId).filter(m => m.id === id);
  const mem = all.length > 0 ? all[0] : null;

  if (!mem) {
    return interaction.reply({
      embeds: [errorEmbed(`Memory #${id} not found in this guild.`, interaction)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const date = new Date(mem.createdAt).toLocaleString();
  const scopeLabel = mem.userId ? `User <@${mem.userId}>` : "🌐 Server (shared)";

  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(`Memory #${mem.id}`)
    .addFields(
      { name: "Scope", value: scopeLabel, inline: true },
      { name: "Created", value: date, inline: true },
      { name: "Guild", value: mem.guildId === "dm" ? "Direct Message" : `<#${mem.guildId}>`, inline: true },
      { name: "Content", value: mem.content.slice(0, 1024) },
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── Slash: /ai memory clear ─────────────────────────────────────────────
async function handleMemoryClear(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can clear AI memories.", interaction)], flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guild.id;
  const count = aiMemory.forGuild(guildId).length;

  if (count === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("No memories to clear for this guild.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("memclear:confirm").setLabel("Yes, clear all").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("memclear:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ Clear All Memories?")
    .setDescription(`This will delete **${count} memory${count === 1 ? "" : "ies"}** for this guild. This action cannot be undone.\n\nClick **Yes, clear all** to proceed.`);

  const msg = await interaction.reply({
    embeds: [embed],
    components: [confirmRow],
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  });

  const filter = i => i.customId.startsWith("memclear:") && i.user.id === interaction.user.id;
  const collected = await msg.awaitMessageComponent({ filter, time: 30_000 }).catch(() => null);

  if (!collected) {
    return interaction.editReply({ components: [] });
  }

  if (collected.customId === "memclear:cancel") {
    return collected.update({
      embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("Memory clear cancelled.")],
      components: [],
    });
  }

  await aiMemory.clear(guildId);
  await collected.update({
    embeds: [successEmbed(`Cleared **${count}** memor${count === 1 ? "y" : "ies"} for this guild.`, interaction)],
    components: [],
  });
}

// ─── Slash: /ai conversations clear ──────────────────────────────────────
async function handleConversationsClear(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can clear conversation history.", interaction)], flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guild.id;

  // Count existing conversations for this guild
  const countRow = db.get(
    "SELECT COUNT(*) as c FROM ai_conversations WHERE guild_id = ? AND scope = 'global'",
    [guildId]
  );
  const count = countRow?.c || 0;

  if (count === 0) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("No conversation history to clear for this guild.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("convclear:confirm").setLabel("Yes, clear all").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("convclear:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ Clear Conversation History?")
    .setDescription(`This will delete **${count} message${count === 1 ? "" : "s"}** of conversation history for this guild. This cannot be undone.\n\nAI memories will **not** be affected.`);

  const msg = await interaction.reply({
    embeds: [embed],
    components: [confirmRow],
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  });

  const filter = i => i.customId.startsWith("convclear:") && i.user.id === interaction.user.id;
  const collected = await msg.awaitMessageComponent({ filter, time: 30_000 }).catch(() => null);

  if (!collected) {
    return interaction.editReply({ components: [] });
  }

  if (collected.customId === "convclear:cancel") {
    return collected.update({
      embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("Conversation clear cancelled.")],
      components: [],
    });
  }

  // Proceed with clearing guild-wide conversation history
  db.run("DELETE FROM ai_conversations WHERE guild_id = ? AND scope = 'global'", [guildId]);
  await collected.update({
    embeds: [successEmbed(`Cleared **${count}** conversation message${count === 1 ? "" : "s"} for this guild.`, interaction)],
    components: [],
  });
}

// ─── Slash: /ai personality list ──────────────────────────────────────────
async function handlePersonalityList(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can view personality presets.", interaction)], flags: MessageFlags.Ephemeral });
  }

  const currentId = settings.get("aiPersonality") || DEFAULT_PERSONALITY;
  const presets = listPersonalities();

  const lines = presets.map(p => {
    const isActive = p.id === currentId;
    const label = isActive ? `**${p.emoji} ${p.name}** ⬅️ (active)` : `${p.emoji} **${p.name}**`;
    return `${label}\n${p.description}\nUse: \`/ai personality set ${p.id}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle("🎭 AI Personality Presets")
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: "Set a personality with /ai personality set <id>" });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── Slash: /ai personality set ───────────────────────────────────────────
async function handlePersonalitySet(interaction, ctx) {
  if (!isGuildOwner(interaction.member)) {
    return interaction.reply({ embeds: [errorEmbed("Only the guild owner can change the AI personality.", interaction)], flags: MessageFlags.Ephemeral });
  }

  const id = interaction.options.getString("id");
  const preset = listPersonalities().find(p => p.id === id);

  if (!preset) {
    const validIds = listPersonalities().map(p => p.id).join(", ");
    return interaction.reply({
      embeds: [errorEmbed(`Invalid personality \`${id}\`. Valid: ${validIds}`, interaction)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const previous = settings.get("aiPersonality") || DEFAULT_PERSONALITY;
  settings.set("aiPersonality", id);

  const prevLabel = id === previous ? "" : ` (was \`${previous}\`)`;
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(`${preset.emoji} Personality Changed`)
    .setDescription(`Set to **${preset.name}**${prevLabel}\n\n${preset.description}`)
    .setFooter({ text: "New responses will use this personality." });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── Main slash dispatch ──────────────────────────────────────────────────
async function slashAiExecute(interaction, ctx) {
  const subGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (!subGroup) {
    if (sub === "chat") return handleAiChat(interaction, ctx);
  } else if (subGroup === "settings") {
    switch (sub) {
      case "view":   return handleSettingsView(interaction, ctx);
      case "wizard": return handleSettingsWizard(interaction, ctx);
      case "set":    return handleSettingsSet(interaction, ctx);
    }
  } else if (subGroup === "memory") {
    switch (sub) {
      case "list":  return handleMemoryList(interaction, ctx);
      case "show":  return handleMemoryShow(interaction, ctx);
      case "clear": return handleMemoryClear(interaction, ctx);
    }
  } else if (subGroup === "conversations") {
    if (sub === "clear") return handleConversationsClear(interaction, ctx);
  } else if (subGroup === "personality") {
    switch (sub) {
      case "list": return handlePersonalityList(interaction, ctx);
      case "set":  return handlePersonalitySet(interaction, ctx);
    }
  }

  return interaction.reply({ embeds: [errorEmbed("Unknown subcommand.", interaction)], flags: MessageFlags.Ephemeral });
}

// ─── Exports ──────────────────────────────────────────────────────────────
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
    description: "AI commands — chat, settings, memories, conversations, personality",
    defaultPermission: "admin",
    slash: new SlashCommandBuilder()
      .setName("ai")
      .setDescription("AI commands — chat, settings, memories, conversations, personality")
      .addSubcommand(sub =>
        sub.setName("chat")
          .setDescription("Ask the AI a direct question (bypasses channel context)")
          .addStringOption(o =>
            o.setName("query").setDescription("Your question or prompt").setRequired(true).setMaxLength(1500)
          )
      )
      .addSubcommandGroup(group =>
        group.setName("settings")
          .setDescription("View or change AI settings")
          .addSubcommand(sub =>
            sub.setName("view")
              .setDescription("Show current AI configuration")
          )
          .addSubcommand(sub =>
            sub.setName("wizard")
              .setDescription("Interactive settings wizard with buttons and modals")
          )
          .addSubcommand(sub =>
            sub.setName("set")
              .setDescription("Change an AI setting")
              .addStringOption(o =>
                o.setName("key").setDescription("Setting key to change").setRequired(true)
                  .addChoices(
                    { name: "aiEnabled (true/false)", value: "aiEnabled" },
                    { name: "aiProvider (groq/openai/claude/...)", value: "aiProvider" },
                    { name: "aiTemperature (0.0-2.0)", value: "aiTemperature" },
                    { name: "aiMaxTokens (64-8192)", value: "aiMaxTokens" },
                    { name: "aiTopP (0.0-1.0)", value: "aiTopP" },
                    { name: "aiContextLimit (1-20)", value: "aiContextLimit" },
                    { name: "aiToolsEnabled (true/false)", value: "aiToolsEnabled" },
                    { name: "aiMemoryEnabled (true/false)", value: "aiMemoryEnabled" },
                    { name: "aiThinkingEnabled (true/false)", value: "aiThinkingEnabled" },
                    { name: "aiKeyword (trigger word)", value: "aiKeyword" },
                    { name: "aiChattyMode (true/false)", value: "aiChattyMode" },
                    { name: "aiChattyCooldown (5-3600 seconds)", value: "aiChattyCooldown" },
                    { name: "aiPersonality (neutral/playful/serious/warm/quirky)", value: "aiPersonality" },
                    { name: "aiFallbackProviders (comma-separated)", value: "aiFallbackProviders" },
                    { name: "aiSystemPrompt (custom system prompt)", value: "aiSystemPrompt" },
                    { name: "aiAllowedChannels (comma-separated IDs)", value: "aiAllowedChannels" },
                    { name: "aiIgnoredChannels (comma-separated IDs)", value: "aiIgnoredChannels" },
                    { name: "aiDmEnabled (true/false)", value: "aiDmEnabled" },
                    { name: "aiBrowserEnabled (true/false)", value: "aiBrowserEnabled" },
                    { name: "customBaseUrl (custom API URL)", value: "customBaseUrl" },
                    { name: "customApiType (openai or anthropic)", value: "customApiType" },
                    { name: "aiToolPermissions (JSON permission map)", value: "aiToolPermissions" },
                  )
              )
              .addStringOption(o =>
                o.setName("value").setDescription("New value for the setting").setRequired(true)
              )
          )
      )
      .addSubcommandGroup(group =>
        group.setName("memory")
          .setDescription("Manage AI memories")
          .addSubcommand(sub =>
            sub.setName("list")
              .setDescription("List all stored memories for this guild")
          )
          .addSubcommand(sub =>
            sub.setName("show")
              .setDescription("Show a specific memory by ID")
              .addIntegerOption(o =>
                o.setName("id").setDescription("Memory ID").setRequired(true).setMinValue(1)
              )
          )
          .addSubcommand(sub =>
            sub.setName("clear")
              .setDescription("Clear all memories for this guild (requires confirmation)")
          )
      )
      .addSubcommandGroup(group =>
        group.setName("conversations")
          .setDescription("Manage AI conversation history")
          .addSubcommand(sub =>
            sub.setName("clear")
              .setDescription("Clear conversation history for this guild (requires confirmation)")
          )
      )
      .addSubcommandGroup(group =>
        group.setName("personality")
          .setDescription("Manage AI personality presets")
          .addSubcommand(sub =>
            sub.setName("list")
              .setDescription("List available personality presets")
          )
          .addSubcommand(sub =>
            sub.setName("set")
              .setDescription("Set the active personality preset")
              .addStringOption(o =>
                o.setName("id").setDescription("Personality preset ID").setRequired(true)
                  .addChoices(
                    { name: "Neutral — balanced, friendly, professional", value: "neutral" },
                    { name: "Playful — witty, casual, humorous", value: "playful" },
                    { name: "Serious — direct, formal, to-the-point", value: "serious" },
                    { name: "Warm — empathetic, supportive, patient", value: "warm" },
                    { name: "Quirky — meme-aware, energetic, Discord slang", value: "quirky" },
                  )
              )
          )
      ),
    execute: slashAiExecute,
  },
];
