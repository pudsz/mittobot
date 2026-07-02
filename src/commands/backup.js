const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const backup = require("../backup");
const config = require("../config");

const BLURPLE = 0x5865f2;

function usage(ctx, text) {
  return `\`${ctx?.utils?.PREFIX || "$"}${text}\``;
}

function canManage(member, userId) {
  return config.memberLevel(member, userId) >= config.PERM_LEVELS.admin;
}

// ─── Prefix command ─────────────────────────────────────────────────────────

async function prefixBackup(message, args, ctx) {
  if (!canManage(message.member, message.author.id))
    return message.reply({ embeds: [errorEmbed("Only Administrators can manage server backups.")] });

  const sub = args[0]?.toLowerCase();

  // $backup list
  if (sub === "list") {
    const items = await backup.get(message.guild.id);
    if (!items.length) return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("💾 Server Backups").setDescription(`No backups yet. Use ${usage(ctx, "backup create [name]")} to create one.`)] });

    const embed = new EmbedBuilder().setColor(BLURPLE).setTitle("💾 Server Backups");
    for (const item of items) {
      const created = new Date(item.created_at).toLocaleDateString();
      embed.addFields({
        name: `#${item.id} — ${item.name}`,
        value: `Created: ${created} | By: ${item.created_by || "unknown"}`,
      });
    }
    embed.setFooter({ text: `Use ${ctx?.utils?.PREFIX || "$"}backup restore <id> to restore` });
    return message.reply({ embeds: [embed] });
  }

  // $backup create [name]
  if (sub === "create") {
    const name = args.slice(1).join(" ").trim() || `Backup ${new Date().toLocaleDateString()}`;
    const status = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("⏳ Creating backup...")] });

    try {
      const result = await backup.create(message.guild, name, message.author.tag);
      await status.edit({ embeds: [successEmbed(`Backup #${result.id} created: **${name}**\n📋 ${result.roles} roles · ${result.categories} categories · ${result.channels} channels`)] });
    } catch (err) {
      await status.edit({ embeds: [errorEmbed(`Backup failed: ${err.message}`)] });
    }
    return;
  }

  // $backup restore <id>
  if (sub === "restore") {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "backup restore <id>")}`)] });

    const entry = await backup.getById(id);
    if (!entry) return message.reply({ embeds: [errorEmbed("Backup not found.")] });

    const status = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`⏳ Restoring backup #${id} **${entry.name}**...\nThis may take a moment.`)] });

    try {
      const result = await backup.restoreGuild(message.guild, entry.data);
      const embed = new EmbedBuilder()
        .setColor(0x00c776)
        .setTitle("✅ Backup Restored")
        .setDescription(`**${entry.name}** restored.`)
        .addFields(
          { name: "Roles", value: `${result.summary.rolesCreated} created (${result.summary.rolesSkipped} skipped)`, inline: true },
          { name: "Categories", value: String(result.summary.categoriesCreated), inline: true },
          { name: "Channels", value: String(result.summary.channelsCreated), inline: true },
        );
      if (result.summary.errors.length) {
        embed.addFields({ name: "Errors", value: result.summary.errors.slice(0, 5).map(e => `⚠ ${e.item}: ${e.error}`).join("\n").slice(0, 1000) });
      }
      await status.edit({ embeds: [embed] });
    } catch (err) {
      await status.edit({ embeds: [errorEmbed(`Restore failed: ${err.message}`)] });
    }
    return;
  }

  // $backup delete <id>
  if (sub === "delete" || sub === "remove") {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "backup delete <id>")}`)] });
    await backup.remove(id);
    return message.reply({ embeds: [successEmbed(`Backup #${id} deleted.`)] });
  }

  // $backup info <id>
  if (sub === "info") {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "backup info <id>")}`)] });
    const entry = await backup.getById(id);
    if (!entry) return message.reply({ embeds: [errorEmbed("Backup not found.")] });

    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(`💾 Backup #${id}: ${entry.name}`)
      .addFields(
        { name: "Created", value: new Date(entry.created_at).toLocaleString(), inline: true },
        { name: "By", value: entry.created_by || "unknown", inline: true },
        { name: "Roles", value: String(entry.data?.roles?.length ?? 0), inline: true },
        { name: "Categories", value: String(entry.data?.categories?.length ?? 0), inline: true },
        { name: "Channels", value: String(entry.data?.channels?.length ?? 0), inline: true },
      );
    return message.reply({ embeds: [embed] });
  }

  // $backup (no subcommand)
  return message.reply({ embeds: [
    new EmbedBuilder().setColor(BLURPLE).setTitle("💾 Backup Commands")
      .setDescription([
        `${usage(ctx, "backup create [name]")} — Create a backup of the current server structure`,
        `${usage(ctx, "backup list")} — List all backups for this server`,
        `${usage(ctx, "backup info <id>")} — View backup details (roles, channels, categories)`,
        `${usage(ctx, "backup restore <id>")} — Restore roles, categories, and channels from a backup`,
        `${usage(ctx, "backup delete <id>")} — Delete a backup`,
        "",
        "⚠ **Restore creates new roles/channels** — existing ones with the same name will be skipped.",
      ].join("\n"))
  ] });
}

// ─── Slash command ──────────────────────────────────────────────────────────

async function slashBackup(interaction, ctx) {
  if (!canManage(interaction.member, interaction.user.id))
    return interaction.reply({ embeds: [errorEmbed("Only Administrators can manage backups.")], flags: MessageFlags.Ephemeral });

  const action = interaction.options.getString("action");

  if (action === "list") {
    const items = await backup.get(interaction.guild.id);
    if (!items.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("💾 Server Backups").setDescription("No backups yet.")], flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setColor(BLURPLE).setTitle("💾 Server Backups");
    for (const item of items.slice(0, 10)) {
      embed.addFields({ name: `#${item.id} — ${item.name}`, value: `Created: ${new Date(item.created_at).toLocaleDateString()}` });
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (action === "create") {
    const name = interaction.options.getString("name") || `Backup ${new Date().toLocaleDateString()}`;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await backup.create(interaction.guild, name, interaction.user.tag);
      await interaction.editReply({ embeds: [successEmbed(`Backup #${result.id} created: **${name}**\n${result.roles} roles · ${result.categories} categories · ${result.channels} channels`)] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Backup failed: ${err.message}`)] });
    }
    return;
  }

  if (action === "restore") {
    const id = interaction.options.getInteger("id");
    const entry = await backup.getById(id);
    if (!entry) return interaction.reply({ embeds: [errorEmbed("Backup not found.")], flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await backup.restoreGuild(interaction.guild, entry.data);
      const embed = new EmbedBuilder().setColor(0x00c776).setTitle("✅ Backup Restored")
        .addFields(
          { name: "Roles", value: `${result.summary.rolesCreated} created`, inline: true },
          { name: "Categories", value: String(result.summary.categoriesCreated), inline: true },
          { name: "Channels", value: String(result.summary.channelsCreated), inline: true },
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Restore failed: ${err.message}`)] });
    }
    return;
  }

  if (action === "delete") {
    const id = interaction.options.getInteger("id");
    await backup.remove(id);
    return interaction.reply({ embeds: [successEmbed(`Backup #${id} deleted.`)], flags: MessageFlags.Ephemeral });
  }
}

module.exports = [{
  name: "backup",
  description: "Manage server backups (roles, channels, permissions)",
  category: "info",
  defaultPermission: "admin",
  prefix: prefixBackup,
  slash: new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Manage server backups")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName("action").setDescription("Action").setRequired(true)
      .addChoices(
        { name: "List", value: "list" },
        { name: "Create", value: "create" },
        { name: "Restore", value: "restore" },
        { name: "Delete", value: "delete" },
      ))
    .addStringOption(o => o.setName("name").setDescription("Backup name").setRequired(false))
    .addIntegerOption(o => o.setName("id").setDescription("Backup ID to restore/delete").setRequired(false)),
  execute: slashBackup,
}];
