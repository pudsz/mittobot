const { EmbedBuilder, SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const { errorEmbed, successEmbed, parseDuration, formatDuration, resolveUserId } = require("../utils");
const dangerzone = require("../dangerzone");

// ─── Helpers ───
function parseChannelId(arg) {
  return arg?.match(/^<#(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(arg) ? arg : null);
}

function parseRoleId(arg) {
  return arg?.match(/^<@&(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(arg) ? arg : null);
}

function actionEmoji(action) {
  return { kick: "👢", ban: "🔨", timeout: "🔇" }[action] || "❓";
}

// ─── Status embed for a single channel ───
function channelInfoEmbed(guild, channelId, cfg) {
  const channelName = guild.channels.cache.get(channelId)?.name || channelId;
  const logChannel = cfg.logChannelId ? `<#${cfg.logChannelId}>` : "None";
  const exemptRoles = cfg.exemptRoles?.length
    ? cfg.exemptRoles.map(r => `<@&${r}>`).join(", ")
    : "None";
  const durationLine = cfg.action === "timeout"
    ? `\n**Duration:** ${formatDuration(cfg.timeoutMs || 300_000)}`
    : "";

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`⚠️ Dangerzone — #${channelName}`)
    .setDescription(
      `**Channel:** <#${channelId}>\n` +
      `**Action:** ${actionEmoji(cfg.action)} ${cfg.action}${durationLine}\n` +
      `**Log Channel:** ${logChannel}\n` +
      `**Exempt Roles:** ${exemptRoles}\n` +
      `**Reason:** ${cfg.reason || "Dangerzone: message sent in monitored channel"}`
    )
    .setFooter({ text: "Any message in this channel triggers the punishment" })
    .setTimestamp();
}

// ─── USAGE embed ───
function usageEmbed(prefix) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("⚠️ Dangerzone — Help")
    .setDescription(
      "Set up trap channels that auto-punish anyone who sends a message in them.\n" +
      "Perfect for catching hacked accounts posting scam links."
    )
    .addFields(
      {
        name: "Setup",
        value: [
          `\`${prefix}dangerzone set #channel <kick|ban|timeout> [duration]\``,
          `Set a channel as a dangerzone with a punishment.`,
          `Duration only applies to \`timeout\` (e.g. \`10m\`, \`1h\`, \`1d\`).`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Options",
        value: [
          `\`${prefix}dangerzone log #dangerzone #log-channel\` — set log channel`,
          `\`${prefix}dangerzone exempt #dangerzone @role\` — add exempt role`,
          `\`${prefix}dangerzone unexempt #dangerzone @role\` — remove exempt role`,
          `\`${prefix}dangerzone reason #dangerzone <text>\` — set custom reason`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Management",
        value: [
          `\`${prefix}dangerzone remove #channel\` — remove a dangerzone`,
          `\`${prefix}dangerzone list\` — list all dangerzones`,
          `\`${prefix}dangerzone info #channel\` — show channel config`,
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: "Exempt: server owners, ManageGuild holders, and configured roles" });
}

// ─── Prefix handler ───
async function handleDangerzone(message, args, ctx) {
  const sub = args[0]?.toLowerCase();
  const prefix = ctx.utils.PREFIX;

  if (!sub || sub === "help") {
    return message.reply({ embeds: [usageEmbed(prefix)] });
  }

  // ── SET: $dangerzone set #channel <kick|ban|timeout> [duration]
  if (sub === "set" || sub === "add") {
    const channelId = parseChannelId(args[1]);
    if (!channelId) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}dangerzone set #channel <kick|ban|timeout> [duration]\``)] });

    const channel = message.guild.channels.cache.get(channelId);
    if (!channel) return message.reply({ embeds: [errorEmbed("Channel not found in this server.")] });

    const action = args[2]?.toLowerCase();
    if (!["kick", "ban", "timeout"].includes(action)) {
      return message.reply({ embeds: [errorEmbed("Action must be one of: `kick`, `ban`, `timeout`")] });
    }

    let timeoutMs = 5 * 60_000;
    if (action === "timeout" && args[3]) {
      const parsed = parseDuration(args[3]);
      if (!parsed) return message.reply({ embeds: [errorEmbed("Invalid duration. Use format like `10m`, `1h`, `1d`.")] });
      timeoutMs = parsed;
    }

    dangerzone.addChannel(message.guild.id, channelId, { action, timeoutMs });

    const durationStr = action === "timeout" ? ` for **${formatDuration(timeoutMs)}**` : "";
    return message.reply({
      embeds: [successEmbed(
        `<#${channelId}> is now a **dangerzone** ${actionEmoji(action)}\n` +
        `Anyone who sends a message will be **${action}ed**${durationStr}.`
      )]
    });
  }

  // ── REMOVE: $dangerzone remove #channel
  if (sub === "remove" || sub === "delete") {
    const channelId = parseChannelId(args[1]);
    if (!channelId) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}dangerzone remove #channel\``)] });

    if (!dangerzone.isDangerzone(message.guild.id, channelId)) {
      return message.reply({ embeds: [errorEmbed("That channel is not a dangerzone.")] });
    }

    dangerzone.removeChannel(message.guild.id, channelId);
    return message.reply({ embeds: [successEmbed(`<#${channelId}> is no longer a dangerzone.`)] });
  }

  // ── LIST: $dangerzone list
  if (sub === "list") {
    const channels = dangerzone.listChannels(message.guild.id);
    if (!channels.length) {
      return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("📋 No dangerzone channels configured.")] });
    }

    const lines = channels.map(([chId, cfg]) => {
      const durationStr = cfg.action === "timeout" ? ` (${formatDuration(cfg.timeoutMs || 300_000)})` : "";
      return `${actionEmoji(cfg.action)} <#${chId}> → **${cfg.action}**${durationStr}`;
    });

    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("⚠️ Dangerzone Channels")
        .setDescription(lines.join("\n"))
        .setFooter({ text: `${channels.length} channel(s) configured` })
      ]
    });
  }

  // ── INFO: $dangerzone info #channel
  if (sub === "info" || sub === "status") {
    const channelId = parseChannelId(args[1]);
    if (!channelId) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}dangerzone info #channel\``)] });

    const cfg = dangerzone.getChannelConfig(message.guild.id, channelId);
    if (!cfg) return message.reply({ embeds: [errorEmbed("That channel is not a dangerzone.")] });

    return message.reply({ embeds: [channelInfoEmbed(message.guild, channelId, cfg)] });
  }

  // ── LOG: $dangerzone log #dangerzone #log-channel
  if (sub === "log") {
    const channelId = parseChannelId(args[1]);
    const logChannelId = parseChannelId(args[2]);
    if (!channelId || !logChannelId) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}dangerzone log #dangerzone-channel #log-channel\``)] });
    }

    const cfg = dangerzone.getChannelConfig(message.guild.id, channelId);
    if (!cfg) return message.reply({ embeds: [errorEmbed("That channel is not a dangerzone. Set it up first.")] });

    dangerzone.addChannel(message.guild.id, channelId, { ...cfg, logChannelId });
    return message.reply({ embeds: [successEmbed(`Log channel for <#${channelId}> set to <#${logChannelId}>.`)] });
  }

  // ── EXEMPT: $dangerzone exempt #dangerzone @role
  if (sub === "exempt") {
    const channelId = parseChannelId(args[1]);
    const roleId = parseRoleId(args[2]);
    if (!channelId || !roleId) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}dangerzone exempt #channel @role\``)] });
    }

    const cfg = dangerzone.getChannelConfig(message.guild.id, channelId);
    if (!cfg) return message.reply({ embeds: [errorEmbed("That channel is not a dangerzone. Set it up first.")] });

    const exemptRoles = [...new Set([...(cfg.exemptRoles || []), roleId])];
    dangerzone.addChannel(message.guild.id, channelId, { ...cfg, exemptRoles });
    return message.reply({ embeds: [successEmbed(`<@&${roleId}> is now exempt from the dangerzone in <#${channelId}>.`)] });
  }

  // ── UNEXEMPT: $dangerzone unexempt #dangerzone @role
  if (sub === "unexempt") {
    const channelId = parseChannelId(args[1]);
    const roleId = parseRoleId(args[2]);
    if (!channelId || !roleId) {
      return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}dangerzone unexempt #channel @role\``)] });
    }

    const cfg = dangerzone.getChannelConfig(message.guild.id, channelId);
    if (!cfg) return message.reply({ embeds: [errorEmbed("That channel is not a dangerzone. Set it up first.")] });

    const exemptRoles = (cfg.exemptRoles || []).filter(r => r !== roleId);
    dangerzone.addChannel(message.guild.id, channelId, { ...cfg, exemptRoles });
    return message.reply({ embeds: [successEmbed(`<@&${roleId}> is no longer exempt from the dangerzone in <#${channelId}>.`)] });
  }

  // ── REASON: $dangerzone reason #channel <text>
  if (sub === "reason") {
    const channelId = parseChannelId(args[1]);
    if (!channelId) return message.reply({ embeds: [errorEmbed(`Usage: \`${prefix}dangerzone reason #channel <reason text>\``)] });

    const cfg = dangerzone.getChannelConfig(message.guild.id, channelId);
    if (!cfg) return message.reply({ embeds: [errorEmbed("That channel is not a dangerzone. Set it up first.")] });

    const reason = args.slice(2).join(" ");
    if (!reason) return message.reply({ embeds: [errorEmbed("Provide a reason message.")] });

    dangerzone.addChannel(message.guild.id, channelId, { ...cfg, reason });
    return message.reply({ embeds: [successEmbed(`Reason for <#${channelId}> set to: **${reason}**`)] });
  }

  // Unknown subcommand → show help
  return message.reply({ embeds: [usageEmbed(prefix)] });
}

// ─── Slash command handler ───
async function slashDangerzone(interaction, ctx) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  if (sub === "set") {
    const channel = interaction.options.getChannel("channel");
    const action = interaction.options.getString("action");
    const durationStr = interaction.options.getString("duration");

    let timeoutMs = 5 * 60_000;
    if (action === "timeout" && durationStr) {
      const parsed = parseDuration(durationStr);
      if (!parsed) return interaction.editReply({ embeds: [errorEmbed("Invalid duration.")] });
      timeoutMs = parsed;
    }

    dangerzone.addChannel(interaction.guild.id, channel.id, { action, timeoutMs });
    const durationLine = action === "timeout" ? ` for **${formatDuration(timeoutMs)}**` : "";
    return interaction.editReply({
      embeds: [successEmbed(
        `<#${channel.id}> is now a **dangerzone** ${actionEmoji(action)}\n` +
        `Anyone who sends a message will be **${action}ed**${durationLine}.`
      )]
    });
  }

  if (sub === "remove") {
    const channel = interaction.options.getChannel("channel");
    if (!dangerzone.isDangerzone(interaction.guild.id, channel.id)) {
      return interaction.editReply({ embeds: [errorEmbed("That channel is not a dangerzone.")] });
    }
    dangerzone.removeChannel(interaction.guild.id, channel.id);
    return interaction.editReply({ embeds: [successEmbed(`<#${channel.id}> is no longer a dangerzone.`)] });
  }

  if (sub === "list") {
    const channels = dangerzone.listChannels(interaction.guild.id);
    if (!channels.length) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("📋 No dangerzone channels configured.")] });
    }
    const lines = channels.map(([chId, cfg]) => {
      const durationStr = cfg.action === "timeout" ? ` (${formatDuration(cfg.timeoutMs || 300_000)})` : "";
      return `${actionEmoji(cfg.action)} <#${chId}> → **${cfg.action}**${durationStr}`;
    });
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("⚠️ Dangerzone Channels")
        .setDescription(lines.join("\n"))
        .setFooter({ text: `${channels.length} channel(s) configured` })
      ]
    });
  }

  if (sub === "info") {
    const channel = interaction.options.getChannel("channel");
    const cfg = dangerzone.getChannelConfig(interaction.guild.id, channel.id);
    if (!cfg) return interaction.editReply({ embeds: [errorEmbed("That channel is not a dangerzone.")] });
    return interaction.editReply({ embeds: [channelInfoEmbed(interaction.guild, channel.id, cfg)] });
  }

  if (sub === "log") {
    const channel = interaction.options.getChannel("channel");
    const logChannel = interaction.options.getChannel("log_channel");
    const cfg = dangerzone.getChannelConfig(interaction.guild.id, channel.id);
    if (!cfg) return interaction.editReply({ embeds: [errorEmbed("That channel is not a dangerzone. Set it up first.")] });
    dangerzone.addChannel(interaction.guild.id, channel.id, { ...cfg, logChannelId: logChannel.id });
    return interaction.editReply({ embeds: [successEmbed(`Log channel for <#${channel.id}> set to <#${logChannel.id}>.`)] });
  }

  if (sub === "exempt") {
    const channel = interaction.options.getChannel("channel");
    const role = interaction.options.getRole("role");
    const cfg = dangerzone.getChannelConfig(interaction.guild.id, channel.id);
    if (!cfg) return interaction.editReply({ embeds: [errorEmbed("That channel is not a dangerzone. Set it up first.")] });
    const exemptRoles = [...new Set([...(cfg.exemptRoles || []), role.id])];
    dangerzone.addChannel(interaction.guild.id, channel.id, { ...cfg, exemptRoles });
    return interaction.editReply({ embeds: [successEmbed(`<@&${role.id}> is now exempt from the dangerzone in <#${channel.id}>.`)] });
  }

  if (sub === "reason") {
    const channel = interaction.options.getChannel("channel");
    const reason = interaction.options.getString("reason");
    const cfg = dangerzone.getChannelConfig(interaction.guild.id, channel.id);
    if (!cfg) return interaction.editReply({ embeds: [errorEmbed("That channel is not a dangerzone. Set it up first.")] });
    dangerzone.addChannel(interaction.guild.id, channel.id, { ...cfg, reason });
    return interaction.editReply({ embeds: [successEmbed(`Reason for <#${channel.id}> set to: **${reason}**`)] });
  }
}

// ─── Slash command definition ───
function buildSlash() {
  return new SlashCommandBuilder()
    .setName("dangerzone")
    .setDescription("Manage dangerzone trap channels")
    .addSubcommand(s => s
      .setName("set")
      .setDescription("Set a channel as a dangerzone")
      .addChannelOption(o => o.setName("channel").setDescription("The trap channel").setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName("action").setDescription("Punishment").setRequired(true)
        .addChoices({ name: "Kick", value: "kick" }, { name: "Ban", value: "ban" }, { name: "Timeout", value: "timeout" }))
      .addStringOption(o => o.setName("duration").setDescription("Timeout duration (e.g. 10m, 1h, 1d)").setRequired(false)))
    .addSubcommand(s => s
      .setName("remove")
      .setDescription("Remove a dangerzone")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to remove").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s
      .setName("list")
      .setDescription("List all dangerzone channels"))
    .addSubcommand(s => s
      .setName("info")
      .setDescription("Show config for a dangerzone channel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to inspect").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s
      .setName("log")
      .setDescription("Set the log channel for a dangerzone")
      .addChannelOption(o => o.setName("channel").setDescription("The dangerzone channel").setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o.setName("log_channel").setDescription("Where to log punishments").setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s
      .setName("exempt")
      .setDescription("Add an exempt role to a dangerzone")
      .addChannelOption(o => o.setName("channel").setDescription("The dangerzone channel").setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName("role").setDescription("Role to exempt").setRequired(true)))
    .addSubcommand(s => s
      .setName("reason")
      .setDescription("Set the punishment reason for a dangerzone")
      .addChannelOption(o => o.setName("channel").setDescription("The dangerzone channel").setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName("reason").setDescription("The reason text").setRequired(true)));
}

module.exports = [
  {
    name: "dangerzone",
    description: "Manage dangerzone trap channels — auto-punish anyone who sends a message",
    defaultPermission: "admin",
    prefix: handleDangerzone,
    slash: buildSlash(),
    execute: slashDangerzone,
  },
];
