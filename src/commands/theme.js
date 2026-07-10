// /theme — per-guild appearance & voice panel (colors, footer, emoji style,
// tone pack) built on the ui.js panel engine.
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const theme = require("../theme");
const tone = require("../tone");
const ui = require("../ui");

const HEX_RE = /^#?([0-9a-f]{6})$/i;

const EMOJI_STYLE_LABELS = {
  pack:    { label: "Tone pack emoji", description: "Emoji follow the selected tone pack" },
  classic: { label: "Classic", description: "The traditional ✅ / ❌ / ⚠️ set" },
  minimal: { label: "Minimal", description: "No emoji prefixes at all" },
};

function hex(n) {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function panelEmbed(guildId, guildName) {
  const t = theme.getTheme(guildId);
  const pack = tone.PACKS[t.tone] || tone.PACKS[tone.DEFAULT_PACK];
  const e = new EmbedBuilder()
    .setColor(t.colors.accent)
    .setTitle("🎨 Server Theme")
    .setDescription(
      `Customize how I look and talk in **${guildName}**.\n` +
      `Preview (current voice): *"${tone.sample(t.tone, "success.generic")}"*`
    )
    .addFields(
      { name: "Tone", value: `${pack.meta.emoji} **${pack.meta.name}** — ${pack.meta.description}`, inline: false },
      {
        name: "Colors",
        value: [
          `Success \`${hex(t.colors.success)}\``,
          `Error \`${hex(t.colors.error)}\``,
          `Info \`${hex(t.colors.info)}\``,
          `Warn \`${hex(t.colors.warn)}\``,
          `Accent \`${hex(t.colors.accent)}\``,
        ].join(" • "),
        inline: false,
      },
      { name: "Emoji style", value: EMOJI_STYLE_LABELS[t.emojiStyle]?.label ?? t.emojiStyle, inline: true },
      { name: "Footer", value: t.footer.enabled ? `On — \`${t.footer.text || "{guild}"}\`` : "Off", inline: true },
    );
  return e;
}

function panelRows(guildId) {
  const t = theme.getTheme(guildId);
  const toneSelect = new StringSelectMenuBuilder()
    .setCustomId("theme:tone")
    .setPlaceholder("Choose a tone pack…")
    .addOptions(tone.listPacks().map(p => ({
      label: p.name,
      value: p.id,
      description: p.description.slice(0, 100),
      emoji: p.emoji,
      default: p.id === t.tone,
    })));
  const emojiSelect = new StringSelectMenuBuilder()
    .setCustomId("theme:emojiStyle")
    .setPlaceholder("Emoji style…")
    .addOptions(theme.EMOJI_STYLES.map(s => ({
      label: EMOJI_STYLE_LABELS[s].label,
      value: s,
      description: EMOJI_STYLE_LABELS[s].description,
      default: s === t.emojiStyle,
    })));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("theme:colors").setLabel("Edit Colors").setEmoji("🎨").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("theme:footer").setLabel("Footer").setEmoji("📝").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("theme:preview").setLabel("Preview").setEmoji("👀").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("theme:reset").setLabel("Reset").setEmoji("♻️").setStyle(ButtonStyle.Danger),
  );
  return [
    new ActionRowBuilder().addComponents(toneSelect),
    new ActionRowBuilder().addComponents(emojiSelect),
    buttons,
  ];
}

ui.registerPanel("theme", {
  level: "admin",
  render(session) {
    const guildName = session.state.guildName || "this server";
    return { embeds: [panelEmbed(session.guildId, guildName)], components: panelRows(session.guildId) };
  },
  handlers: {
    async tone(interaction, session, { repaint }) {
      theme.setTheme(session.guildId, { tone: interaction.values[0] });
      await repaint();
    },
    async emojiStyle(interaction, session, { repaint }) {
      theme.setTheme(session.guildId, { emojiStyle: interaction.values[0] });
      await repaint();
    },
    async colors(interaction, session) {
      const t = theme.getTheme(session.guildId);
      const modal = new ModalBuilder().setCustomId("theme_modal:colors").setTitle("Theme Colors (hex)");
      for (const kind of theme.COLOR_KINDS) {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(kind)
            .setLabel(`${kind[0].toUpperCase()}${kind.slice(1)} color`)
            .setStyle(TextInputStyle.Short)
            .setValue(hex(t.colors[kind]))
            .setMinLength(6).setMaxLength(7)
            .setRequired(true),
        ));
      }
      await interaction.showModal(modal);
    },
    async footer(interaction, session) {
      const t = theme.getTheme(session.guildId);
      const modal = new ModalBuilder().setCustomId("theme_modal:footer").setTitle("Embed Footer")
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("text")
            .setLabel("Footer text — {guild} = server name")
            .setPlaceholder("Leave empty to disable the footer")
            .setStyle(TextInputStyle.Short)
            .setValue(t.footer.enabled ? (t.footer.text || "{guild}") : "")
            .setMaxLength(200)
            .setRequired(false),
        ));
      await interaction.showModal(modal);
    },
    async preview(interaction, session) {
      const gid = session.guildId;
      await interaction.reply({
        embeds: [
          theme.success(gid, tone.t(gid, "success.generic")),
          theme.error(gid, tone.t(gid, "error.generic")),
          theme.warn(gid, tone.t(gid, "deny.cooldown", { remain: 12 })),
          theme.info(gid, tone.t(gid, "deny.channel")),
          theme.embed(gid, "accent", "Accent color — used for titles and highlights."),
        ],
        flags: 64, // ephemeral
      });
    },
    async reset(interaction, session) {
      await ui.confirm(interaction, {
        embed: theme.warn(session.guildId, "Reset all theme settings (tone, colors, footer, emoji) to defaults?"),
        ownerId: interaction.user.id,
        confirmLabel: "Reset theme",
        ephemeral: true,
        onConfirm: async (i) => {
          theme.resetTheme(session.guildId);
          await i.update({ embeds: [theme.success(session.guildId, "Theme reset to defaults.")], components: [] });
          // Repaint the main panel behind the confirm.
          try {
            const def = { render: () => ({ embeds: [panelEmbed(session.guildId, session.state.guildName || "this server")], components: panelRows(session.guildId) }) };
            await session.message?.edit(def.render());
          } catch { /* panel may be gone */ }
        },
      });
    },
  },
  modals: {
    async colors(interaction, session, { repaint }) {
      const patch = {};
      const bad = [];
      for (const kind of theme.COLOR_KINDS) {
        const raw = interaction.fields.getTextInputValue(kind).trim();
        const m = raw.match(HEX_RE);
        if (m) patch[kind] = parseInt(m[1], 16);
        else bad.push(`${kind}: \`${raw}\``);
      }
      if (bad.length) {
        return ui.ephemeralNote(interaction, `Invalid hex color(s) — ${bad.join(", ")}. Use e.g. \`#5865f2\`.`);
      }
      theme.setTheme(session.guildId, { colors: patch });
      await repaint();
    },
    async footer(interaction, session, { repaint }) {
      const text = interaction.fields.getTextInputValue("text").trim();
      theme.setTheme(session.guildId, {
        footer: text ? { enabled: true, text } : { enabled: false, text: null },
      });
      await repaint();
    },
  },
});

async function openThemePanel(source, guild, userId) {
  await ui.openPanel(source, "theme", {
    ownerId: userId,
    guildId: guild.id,
    state: { guildName: guild.name },
    ephemeral: true,
  });
}

module.exports = [
  {
    name: "theme",
    description: "Customize the bot's colors, footer, and voice for this server",
    defaultPermission: "admin",
    slash: new SlashCommandBuilder()
      .setName("theme")
      .setDescription("Customize the bot's colors, footer, and voice for this server"),
    execute: async (interaction) => {
      if (!interaction.guild) return interaction.reply({ content: "Server-only command.", flags: 64 });
      await openThemePanel(interaction, interaction.guild, interaction.user.id);
    },
    prefix: async (message) => {
      if (!message.guild) return;
      await openThemePanel(message, message.guild, message.author.id);
    },
  },
];
