const {
  EmbedBuilder, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { isOwner, successEmbed, errorEmbed, noPermEmbed } = require("../utils");
const settings = require("../settings");

// ─── Main settings panel embed + buttons
function settingsEmbed() {
  const s = settings.getAll();
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("⚙️ Bot Settings")
    .addFields(
      { name: "Prefix",             value: `\`${s.prefix}\``,       inline: true },
      { name: "No-Perm Message",    value: s.noPermMsg,              inline: false },
      { name: "Fake Ban Message",   value: `\`${s.fakeBanMsg}\``,   inline: false },
      { name: "Fake Kick Message",  value: `\`${s.fakeKickMsg}\``,  inline: false },
      { name: "Fake Warn Message",  value: `\`${s.fakeWarnMsg}\``,  inline: false },
      { name: "Fake Mute Message",  value: `\`${s.fakeMuteMsg}\``,  inline: false },
      { name: "Fake Lock Message",  value: `\`${s.fakeLockMsg}\``,  inline: false },
    )
    .setFooter({ text: "Variables: {user} {reason} {channel} — click a button to edit" });
}

function settingsRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("settings:prefix")     .setLabel("Prefix")           .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("settings:noPermMsg")  .setLabel("No-Perm Message")  .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("settings:fakeWarnMsg").setLabel("Fake Warn Msg")    .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("settings:fakeBanMsg") .setLabel("Fake Ban Msg")     .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("settings:fakeKickMsg").setLabel("Fake Kick Msg")    .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("settings:fakeMuteMsg").setLabel("Fake Mute Msg")    .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("settings:fakeLockMsg").setLabel("Fake Lock Msg")    .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("settings:reset")      .setLabel("Reset All")        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ─── Friendly labels for modal titles
const LABELS = {
  prefix:       "Command Prefix",
  noPermMsg:    "No-Permission Message",
  fakeBanMsg:   "Fake Ban Message",
  fakeKickMsg:  "Fake Kick Message",
  fakeWarnMsg:  "Fake Warn Message",
  fakeMuteMsg:  "Fake Mute Message",
  fakeLockMsg:  "Fake Lock Message",
};

// ─── Called by index.js when a settings:* button is clicked
async function handleSettingsButton(interaction) {
  if (!isOwner(interaction.user.id)) return interaction.reply({ embeds: [noPermEmbed()], ephemeral: true });
  const key = interaction.customId.replace("settings:", "");

  if (key === "reset") {
    Object.entries(settings.DEFAULTS).forEach(([k, v]) => settings.set(k, v));
    return interaction.update({ embeds: [settingsEmbed()], components: settingsRows() });
  }

  const modal = new ModalBuilder()
    .setCustomId(`settings_modal:${key}`)
    .setTitle(`Edit: ${LABELS[key] ?? key}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("value")
        .setLabel(LABELS[key] ?? key)
        .setStyle(key === "noPermMsg" ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setValue(settings.get(key))
        .setRequired(true)
        .setMaxLength(200)
    )
  );

  await interaction.showModal(modal);
}

// ─── Called by index.js when a settings_modal:* modal is submitted
async function handleSettingsModal(interaction) {
  if (!isOwner(interaction.user.id)) return interaction.reply({ embeds: [noPermEmbed()], ephemeral: true });
  const key   = interaction.customId.replace("settings_modal:", "");
  const value = interaction.fields.getTextInputValue("value").trim();

  if (!value) return interaction.reply({ embeds: [errorEmbed("Value cannot be empty.")], ephemeral: true });

  if (key === "prefix" && value.length > 3)
    return interaction.reply({ embeds: [errorEmbed("Prefix must be 1–3 characters.")], ephemeral: true });

  settings.set(key, value);

  // Update the original panel message
  await interaction.update({ embeds: [settingsEmbed()], components: settingsRows() }).catch(() =>
    interaction.reply({ embeds: [successEmbed(`\`${LABELS[key] ?? key}\` updated.`)], ephemeral: true })
  );
}

// ─── Prefix + slash command entry
async function prefixSettings(message, args, ctx) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [noPermEmbed()] });
  await message.reply({ embeds: [settingsEmbed()], components: settingsRows() });
}

async function slashSettings(interaction, ctx) {
  if (!isOwner(interaction.user.id)) return interaction.reply({ embeds: [noPermEmbed()], ephemeral: true });
  await interaction.reply({ embeds: [settingsEmbed()], components: settingsRows() });
}

module.exports = [
  {
    name: "settings",
    description: "Configure bot settings (owner only)",
    defaultPermission: "owner",
    prefix: prefixSettings,
    slash: new SlashCommandBuilder().setName("settings").setDescription("Configure bot settings (owner only)"),
    execute: slashSettings,
  },
];

module.exports.handleSettingsButton = handleSettingsButton;
module.exports.handleSettingsModal  = handleSettingsModal;
