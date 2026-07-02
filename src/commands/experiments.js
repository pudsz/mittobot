const { EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const db = require("../db");
const data = require("../data");

const ACCENT = 0x9b59b6;
function embed(desc) {
  return new EmbedBuilder().setColor(ACCENT).setDescription(desc);
}

module.exports = [
  {
    name: "experiments",
    description: "Manage alpha experiments and telemetry",
    slash: new SlashCommandBuilder().setName("experiments").setDescription("Manage alpha experiments and telemetry")
      .addSubcommand(s => s
        .setName("enable").setDescription("Activate alpha experiments with a code")
        .addStringOption(o => o.setName("code").setDescription("Your 24-character alpha activation code").setRequired(false)))
      .addSubcommand(s => s
        .setName("telemetry").setDescription("Toggle AI tool telemetry collection")
        .addStringOption(o => o.setName("on").setDescription("Enable or disable telemetry").setRequired(true)
          .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
      .addSubcommand(s => s
        .setName("status").setDescription("Check your alpha experiments status")),
    execute: async (i) => {
      const sub = i.options.getSubcommand();
      const guildId = i.guild?.id;
      if (!guildId) return i.reply({ embeds: [embed("❌ This command can only be used in a server.")], ephemeral: true });

      if (sub === "enable") {
        const codeOpt = i.options.getString("code");
        if (codeOpt) {
          const codeRow = await db.getAlphaCode(codeOpt);
          if (!codeRow || codeRow.used_by) {
            return i.reply({ embeds: [embed("❌ Invalid or already-used alpha code.")], ephemeral: true });
          }
          data.addAlphaUser(i.user.id, guildId, { codeUsed: codeOpt });
          await db.useAlphaCode(codeOpt, i.user.id);
          const user = await i.client.users.fetch(i.user.id);
          user.send({ embeds: [embed("🧪 **Alpha experiments activated!**\nYou now have access to additional AI server management tools like role/channel management.\nUse `/experiments status` to check your status.")] }).catch(() => {});
          return i.reply({ embeds: [embed("✅ **Alpha activated!** You now have access to experimental AI server management tools. Check your DMs for confirmation.")], ephemeral: true });
        }
        return i.reply({ embeds: [embed("⚠️ **Alpha Experiments**\nThis will activate experimental AI server management tools (role/channel management). These tools are in testing and may change.\n\nTo proceed, you'll need an alpha activation code from the server administrator.")], components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("experiments:proceed").setLabel("Enter Code").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("experiments:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
          ),
        ], ephemeral: true });
      }

      if (sub === "telemetry") {
        const val = i.options.getString("on");
        const optOut = val === "off";
        if (data.isAlphaActivated(i.user.id, guildId)) {
          data.setAlphaTelemetryOptOut(i.user.id, guildId, optOut);
          return i.reply({ embeds: [embed(optOut ? "📡 Telemetry **disabled**." : "📡 Telemetry **enabled**.")], ephemeral: true });
        }
        data.addAlphaUser(i.user.id, guildId, { telemetryOptOut: optOut });
        return i.reply({ embeds: [embed("📡 Telemetry preference saved.")], ephemeral: true });
      }

      if (sub === "status") {
        const activated = data.isAlphaActivated(i.user.id, guildId);
        const userData = data.alphaUsers[`${guildId}:${i.user.id}`];
        const optOut = userData?.telemetryOptOut;
        return i.reply({
          embeds: [new EmbedBuilder().setColor(ACCENT)
            .setTitle("🧪 Alpha Experiments — Status")
            .addFields(
              { name: "Activated", value: activated ? "✅ Yes" : "❌ No", inline: true },
              { name: "Telemetry", value: optOut ? "🔴 Disabled" : "🟢 Enabled", inline: true },
              { name: "Tools Available", value: activated ? "Server management (roles, channels)" : "None. Use `/experiments enable` to activate.", inline: false },
            )],
          ephemeral: true,
        });
      }
    },
  },
];
