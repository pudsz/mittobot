const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const scheduler = require("../scheduler");
const config = require("../config");

const BLURPLE = 0x5865f2;

function usage(ctx, text) {
  return `\`${ctx?.utils?.PREFIX || "$"}${text}\``;
}

function canManage(member, userId) {
  return config.memberLevel(member, userId) >= config.PERM_LEVELS.admin;
}

const RECURRENCE_LABELS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

function formatScheduleTime(scheduledAt, recurrence) {
  const d = new Date(scheduledAt);
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (recurrence) {
    return `${RECURRENCE_LABELS[recurrence] || recurrence} at ${timeStr} (next: ${dateStr} ${timeStr})`;
  }
  return `${dateStr} at ${timeStr}`;
}

function timestampToRelative(iso) {
  if (!iso) return "never";
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
}

// ─── Prefix command ─────────────────────────────────────────────────────────

async function prefixSchedule(message, args, ctx) {
  if (!canManage(message.member, message.author.id))
    return message.reply({ embeds: [errorEmbed("Only Administrators can manage scheduled messages.")] });

  const sub = args[0]?.toLowerCase();

  // $schedule list
  if (sub === "list") {
    const items = scheduler.getForGuild(message.guild.id);
    if (!items.length) return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("📅 Scheduled Messages").setDescription("No scheduled messages.")] });

    const embed = new EmbedBuilder().setColor(BLURPLE).setTitle("📅 Scheduled Messages");
    for (const item of items) {
      const status = item.enabled ? "🟢" : "🔴";
      const t = formatScheduleTime(item.scheduledAt, item.recurrence);
      const preview = (item.content || "").slice(0, 80) + (item.content?.length > 80 ? "…" : "");
      embed.addFields({
        name: `${status} #${item.id} — <#${item.channelId}>`,
        value: `**When:** ${t}\n**Last sent:** ${timestampToRelative(item.lastSentAt)}\n**Preview:** ${preview}`,
      });
    }
    embed.setFooter({ text: `${ctx?.utils?.PREFIX || "$"}schedule create|recurring|delete — ${ctx?.utils?.PREFIX || "$"}schedule delete <id> to remove` });
    return message.reply({ embeds: [embed] });
  }

  // $schedule delete <id>
  if (sub === "delete" || sub === "remove") {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "schedule delete <id>")}`)] });
    await scheduler.remove(id);
    return message.reply({ embeds: [successEmbed(`Schedule #${id} deleted.`)] });
  }

  // $schedule create <channel> <datetime> <message>
  if (sub === "create") {
    const channelMention = message.mentions.channels.first();
    const channelArg = channelMention || (args[1] ? message.guild.channels.cache.get(args[1]) : null);
    if (!channelArg) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "schedule create #channel <ISO datetime> <message>")}`)] });

    // Skip past the channel arg (either the mention position or index 1)
    const chanIdx = channelMention ? args.findIndex(a => a && a.includes(channelArg.id)) : 1;
    const dateStr = args[chanIdx + 1];
    if (!dateStr) return message.reply({ embeds: [errorEmbed("Provide a datetime. E.g. `2026-06-27T14:30:00` or `2026-06-27 14:30`")] });

    const iso = new Date(dateStr);
    if (isNaN(iso.getTime()) || iso <= new Date())
      return message.reply({ embeds: [errorEmbed("Invalid or past datetime. Use ISO format: `2026-06-27T14:30:00`")] });

    const content = args.slice(chanIdx + 2).join(" ").trim();
    if (!content) return message.reply({ embeds: [errorEmbed("Provide a message to send.")] });

    const entry = await scheduler.create(
      message.guild.id, channelArg.id, content,
      iso.toISOString(), null,
      message.author.tag
    );
    return message.reply({ embeds: [successEmbed(`Schedule #${entry.id} created for <#${channelArg.id}> at ${formatScheduleTime(entry.scheduledAt, null)}`)] });
  }

  // $schedule recurring <channel> <daily|weekly|monthly> <time|day time|dom time> <message>
  if (sub === "recurring") {
    const channelMention = message.mentions.channels.first();
    const channelArg = channelMention || message.guild.channels.cache.get(args[1]);
    if (!channelArg) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "schedule recurring #channel daily 14:30 <message>")}`)] });

    // Find recurrence type
    const recIdx = args.findIndex(a => a && ["daily", "weekly", "monthly"].includes(a.toLowerCase()));
    if (recIdx < 0) return message.reply({ embeds: [errorEmbed("Recurrence must be: daily, weekly, or monthly")] });

    const recurrence = args[recIdx].toLowerCase();
    const rawParts = args.slice(recIdx); // e.g. ["daily", "14:30", "hello", "world"]

    let timePart;
    if (recurrence === "daily") {
      timePart = rawParts[1]; // daily 14:30
    } else {
      timePart = rawParts[2]; // weekly mon 14:30  or  monthly 15 14:30
    }

    const built = scheduler.buildScheduledAt(recurrence, rawParts);
    if (!built || !built.scheduledAt) return message.reply({ embeds: [errorEmbed(
      recurrence === "daily" ? `Usage: ${usage(ctx, "schedule recurring #channel daily HH:MM <message>")}` :
      recurrence === "weekly" ? `Usage: ${usage(ctx, "schedule recurring #channel weekly mon HH:MM <message>")}` :
      `Usage: ${usage(ctx, "schedule recurring #channel monthly DD HH:MM <message>")}`
    )] });

    // Content starts after time spec
    const contentStart = recurrence === "daily" ? recIdx + 2 : recurrence === "weekly" ? recIdx + 3 : recIdx + 3;
    const content = args.slice(contentStart).join(" ").trim();
    if (!content) return message.reply({ embeds: [errorEmbed("Provide a message to send.")] });

    const entry = await scheduler.create(
      message.guild.id, channelArg.id, content,
      built.scheduledAt, recurrence,
      message.author.tag
    );
    return message.reply({ embeds: [successEmbed(`Recurring schedule #${entry.id} created: **${RECURRENCE_LABELS[recurrence]}** in <#${channelArg.id}>. Next: ${formatScheduleTime(entry.scheduledAt, recurrence)}`)] });
  }

  // $schedule (no subcommand)
  return message.reply({ embeds: [
    new EmbedBuilder().setColor(BLURPLE).setTitle("📅 Schedule Commands")
      .setDescription([
        `${usage(ctx, "schedule list")} — View all scheduled messages`,
        `${usage(ctx, "schedule create #channel <ISO datetime> <message>")} — Schedule a one-shot message`,
        `${usage(ctx, "schedule recurring #channel daily HH:MM <message>")} — Daily recurring message`,
        `${usage(ctx, "schedule recurring #channel weekly mon HH:MM <message>")} — Weekly (sun-sat)`,
        `${usage(ctx, "schedule recurring #channel monthly DD HH:MM <message>")} — Monthly (day 1-31)`,
        `${usage(ctx, "schedule delete <id>")} — Remove a schedule`,
      ].join("\n"))
  ] });
}

// ─── Slash command ──────────────────────────────────────────────────────────

async function slashSchedule(interaction, ctx) {
  if (!canManage(interaction.member, interaction.user.id))
    return interaction.reply({ embeds: [errorEmbed("Only Administrators can manage scheduled messages.")], flags: MessageFlags.Ephemeral });

  const action = interaction.options.getString("action");

  if (action === "list") {
    const items = scheduler.getForGuild(interaction.guild.id);
    if (!items.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("📅 Scheduled Messages").setDescription("No scheduled messages.")], flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setColor(BLURPLE).setTitle("📅 Scheduled Messages");
    for (const item of items) {
      const status = item.enabled ? "🟢" : "🔴";
      const t = formatScheduleTime(item.scheduledAt, item.recurrence);
      const preview = (item.content || "").slice(0, 80) + (item.content?.length > 80 ? "…" : "");
      embed.addFields({ name: `${status} #${item.id} — <#${item.channelId}>`, value: `**When:** ${t}\n**Preview:** ${preview}` });
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (action === "delete") {
    const id = interaction.options.getInteger("id");
    await scheduler.remove(id);
    return interaction.reply({ embeds: [successEmbed(`Schedule #${id} deleted.`)], flags: MessageFlags.Ephemeral });
  }

  if (action === "create") {
    const channel = interaction.options.getChannel("channel");
    const datetime = interaction.options.getString("datetime");
    const message = interaction.options.getString("message");

    if (!channel || !datetime || !message)
      return interaction.reply({ embeds: [errorEmbed("channel, datetime, and message are required")], flags: MessageFlags.Ephemeral });

    const iso = new Date(datetime);
    if (isNaN(iso.getTime()) || iso <= new Date())
      return interaction.reply({ embeds: [errorEmbed("Invalid or past datetime. Use ISO format: `2026-06-27T14:30:00`")], flags: MessageFlags.Ephemeral });

    const entry = await scheduler.create(interaction.guild.id, channel.id, message, iso.toISOString(), null, interaction.user.tag);
    return interaction.reply({ embeds: [successEmbed(`Schedule #${entry.id} created for ${channel}`)], flags: MessageFlags.Ephemeral });
  }

  if (action === "recurring") {
    const channel = interaction.options.getChannel("channel");
    const recurrence = interaction.options.getString("recurrence");
    const time = interaction.options.getString("time"); // HH:MM
    const message = interaction.options.getString("message");

    if (!channel || !recurrence || !time || !message)
      return interaction.reply({ embeds: [errorEmbed("channel, recurrence, time, and message are required")], flags: MessageFlags.Ephemeral });

    const rawParts = [recurrence, time];
    const built = scheduler.buildScheduledAt(recurrence, rawParts);
    if (!built || !built.scheduledAt) {
      return interaction.reply({ embeds: [errorEmbed("Invalid time format. Use HH:MM (e.g., 14:30).")], flags: MessageFlags.Ephemeral });
    }

    const entry = await scheduler.create(interaction.guild.id, channel.id, message, built.scheduledAt, recurrence, interaction.user.tag);
    return interaction.reply({ embeds: [successEmbed(`Recurring schedule #${entry.id} created: **${RECURRENCE_LABELS[recurrence]}** in ${channel}`)], flags: MessageFlags.Ephemeral });
  }
}

module.exports = [{
  name: "schedule",
  description: "Manage scheduled messages",
  category: "info",
  defaultPermission: "admin",
  prefix: prefixSchedule,
  slash: new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Manage scheduled messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("action").setDescription("Action").setRequired(true)
      .addChoices(
        { name: "List", value: "list" },
        { name: "Create", value: "create" },
        { name: "Recurring", value: "recurring" },
        { name: "Delete", value: "delete" },
      ))
    .addChannelOption(o => o.setName("channel").setDescription("Target channel").setRequired(false))
    .addStringOption(o => o.setName("datetime").setDescription("ISO datetime (e.g. 2026-06-27T14:30:00)").setRequired(false))
    .addStringOption(o => o.setName("recurrence").setDescription("Recurrence type").setRequired(false)
      .addChoices(
        { name: "Daily", value: "daily" },
        { name: "Weekly", value: "weekly" },
        { name: "Monthly", value: "monthly" },
      ))
    .addStringOption(o => o.setName("time").setDescription("Time in HH:MM (for recurring)").setRequired(false))
    .addStringOption(o => o.setName("message").setDescription("Message content").setRequired(false))
    .addIntegerOption(o => o.setName("id").setDescription("Schedule ID to delete").setRequired(false)),
  execute: slashSchedule,
}];
