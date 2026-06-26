const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const config = require("../config");

const BLURPLE = 0x5865f2;

// Only real admins/owners may reconfigure commands, regardless of how `config` is itself gated.
function canManage(member, userId) {
  return config.memberLevel(member, userId) >= config.PERM_LEVELS.admin;
}

function knownCommand(ctx, name) {
  const def = ctx.commandMap.get(name);
  // Ignore dynamic modules and unknowns for safety.
  return def && !def._dynamic ? def : null;
}

function configEmbed(guildId, name, def) {
  const c = config.resolve(guildId, name, def);
  const chan = (arr) => arr.length ? arr.map(id => `<#${id}>`).join(" ") : "—";
  const roles = c.allowedRoles.length ? c.allowedRoles.map(id => `<@&${id}>`).join(" ") : "—";
  const e = new EmbedBuilder()
    .setColor(c.enabled ? BLURPLE : 0xed4245)
    .setTitle(`⚙️ Config — $${name}`)
    .addFields(
      { name: "Enabled",     value: c.enabled ? "✅ Yes" : "❌ No", inline: true },
      { name: "Permission",  value: config.PERM_LABELS[c.permission] || c.permission, inline: true },
      { name: "Cooldown",    value: c.cooldown ? `${c.cooldown}s` : "None", inline: true },
      { name: "Extra Roles", value: roles, inline: false },
      { name: "Allowed Channels", value: chan(c.allowedChannels), inline: false },
      { name: "Blocked Channels", value: chan(c.blockedChannels), inline: false },
    );
  const keys = Object.keys(c.settings || {});
  if (keys.length) e.addFields({ name: "Command Settings", value: keys.map(k => `\`${k}\`: ${JSON.stringify(c.settings[k])}`).join("\n").slice(0, 1000) });
  e.setFooter({ text: "Edit: $config <command> <enable|disable|perm|cooldown|allow|block|reset>" });
  return e;
}

const HELP = new EmbedBuilder().setColor(BLURPLE).setTitle("⚙️ $config — per-command settings").setDescription([
  "`$config <command>` — view a command's config",
  "`$config <command> enable|disable`",
  "`$config <command> perm <everyone|booster|mod|admin|owner>`",
  "`$config <command> cooldown <seconds>` (0 to clear)",
  "`$config <command> allow #channel` / `block #channel` — toggle a channel",
  "`$config <command> allowrole @role` — toggle an extra allowed role",
  "`$config <command> reset` — restore defaults",
].join("\n"));

// Core mutation logic shared by prefix + slash. Returns an embed to reply with.
function applyChange(guildId, def, name, sub, value, mentions) {
  const cur = config.resolve(guildId, name, def);
  switch (sub) {
    case "enable":  config.set(guildId, name, { enabled: true });  return successEmbed(`\`$${name}\` enabled.`);
    case "disable": config.set(guildId, name, { enabled: false }); return successEmbed(`\`$${name}\` disabled.`);
    case "perm": {
      const lvl = String(value || "").toLowerCase();
      if (!config.PERM_ORDER.includes(lvl)) return errorEmbed(`Permission must be one of: ${config.PERM_ORDER.join(", ")}`);
      config.set(guildId, name, { permission: lvl });
      return successEmbed(`\`$${name}\` now requires **${config.PERM_LABELS[lvl]}**.`);
    }
    case "cooldown": {
      const secs = parseInt(value, 10);
      if (isNaN(secs) || secs < 0 || secs > 86400) return errorEmbed("Cooldown must be 0–86400 seconds.");
      config.set(guildId, name, { cooldown: secs });
      return successEmbed(secs ? `\`$${name}\` cooldown set to **${secs}s**.` : `\`$${name}\` cooldown cleared.`);
    }
    case "allow": case "block": {
      const chId = mentions?.channelId;
      if (!chId) return errorEmbed(`Usage: \`$config ${name} ${sub} #channel\``);
      const field = sub === "allow" ? "allowedChannels" : "blockedChannels";
      const list = [...cur[field]];
      const idx = list.indexOf(chId);
      if (idx >= 0) list.splice(idx, 1); else list.push(chId);
      config.set(guildId, name, { [field]: list });
      return successEmbed(`<#${chId}> ${idx >= 0 ? "removed from" : "added to"} **${sub}** list for \`$${name}\`.`);
    }
    case "allowrole": {
      const roleId = mentions?.roleId;
      if (!roleId) return errorEmbed(`Usage: \`$config ${name} allowrole @role\``);
      const list = [...cur.allowedRoles];
      const idx = list.indexOf(roleId);
      if (idx >= 0) list.splice(idx, 1); else list.push(roleId);
      config.set(guildId, name, { allowedRoles: list });
      return successEmbed(`<@&${roleId}> ${idx >= 0 ? "removed from" : "added to"} extra roles for \`$${name}\`.`);
    }
    case "reset": config.reset(guildId, name); return successEmbed(`\`$${name}\` config reset to defaults.`);
    default: return errorEmbed("Unknown action. See `$config` for usage.");
  }
}

async function prefixConfig(message, args, ctx) {
  if (!canManage(message.member, message.author.id))
    return message.reply({ embeds: [errorEmbed("Only Administrators can manage command config.")] });
  if (!args[0]) return message.reply({ embeds: [HELP] });

  const name = args[0].toLowerCase();
  const def = knownCommand(ctx, name);
  if (!def) return message.reply({ embeds: [errorEmbed(`Unknown command \`${name}\`.`)] });

  const sub = args[1]?.toLowerCase();
  if (!sub) return message.reply({ embeds: [configEmbed(message.guild.id, name, def)] });

  const mentions = {
    channelId: message.mentions.channels.first()?.id || (/^\d{17,20}$/.test(args[2]) ? args[2] : null),
    roleId:    message.mentions.roles.first()?.id,
  };
  const embed = applyChange(message.guild.id, def, name, sub, args[2], mentions);
  return message.reply({ embeds: [embed] });
}

async function slashConfig(interaction, ctx) {
  if (!canManage(interaction.member, interaction.user.id))
    return interaction.reply({ embeds: [errorEmbed("Only Administrators can manage command config.")], flags: MessageFlags.Ephemeral });

  const name = interaction.options.getString("command").toLowerCase();
  const def = knownCommand(ctx, name);
  if (!def) return interaction.reply({ embeds: [errorEmbed(`Unknown command \`${name}\`.`)], flags: MessageFlags.Ephemeral });

  const action  = interaction.options.getString("action");
  if (!action) return interaction.reply({ embeds: [configEmbed(interaction.guild.id, name, def)] });

  const value   = interaction.options.getString("value");
  const channel = interaction.options.getChannel("channel");
  const role    = interaction.options.getRole("role");
  const mentions = { channelId: channel?.id, roleId: role?.id };
  const embed = applyChange(interaction.guild.id, def, name, action, value, mentions);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = [
  {
    name: "config",
    description: "Configure any command (enable, permission, channels, cooldown)",
    defaultPermission: "admin",
    prefix: prefixConfig,
    slash: new SlashCommandBuilder()
      .setName("config")
      .setDescription("Configure any command (admin only)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName("command").setDescription("Command name").setRequired(true))
      .addStringOption(o => o.setName("action").setDescription("Leave empty to view. Otherwise an action below.").setRequired(false)
        .addChoices(
          { name: "enable", value: "enable" }, { name: "disable", value: "disable" },
          { name: "perm", value: "perm" }, { name: "cooldown", value: "cooldown" },
          { name: "allow channel", value: "allow" }, { name: "block channel", value: "block" },
          { name: "allow role", value: "allowrole" }, { name: "reset", value: "reset" },
        ))
      .addStringOption(o => o.setName("value").setDescription("Value (perm level or cooldown seconds)").setRequired(false))
      .addChannelOption(o => o.setName("channel").setDescription("Channel for allow/block").setRequired(false))
      .addRoleOption(o => o.setName("role").setDescription("Role for allowrole").setRequired(false)),
    execute: slashConfig,
  },
];
