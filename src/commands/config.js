const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const config = require("../config");

const BLURPLE = 0x5865f2;
const ALIAS_RE = /^[a-z0-9_-]{1,32}$/;

function prefix(ctx) {
  return ctx?.utils?.PREFIX || "$";
}

function usage(ctx, name, rest = "") {
  return `\`${prefix(ctx)}${name}${rest ? ` ${rest}` : ""}\``;
}

// Only real admins/owners may reconfigure commands, regardless of how `config` is itself gated.
function canManage(member, userId) {
  return config.memberLevel(member, userId) >= config.PERM_LEVELS.admin;
}

function knownCommand(ctx, name, guildId = null) {
  const resolved = typeof ctx.resolvePrefixCommand === "function"
    ? ctx.resolvePrefixCommand(name, guildId)
    : { name, def: ctx.commandMap.get(name) };
  const def = resolved.def;
  // Ignore dynamic modules and unknowns for safety.
  return def && !def._dynamic ? { name: resolved.name, def } : null;
}

function configEmbed(ctx, guildId, name, def) {
  const c = config.resolve(guildId, name, def);
  const aliases = typeof ctx.commandAliases === "function" ? ctx.commandAliases(def, guildId) : (def.aliases || []);
  const chan = (arr) => arr.length ? arr.map(id => `<#${id}>`).join(" ") : "—";
  const roles = c.allowedRoles.length ? c.allowedRoles.map(id => `<@&${id}>`).join(" ") : "—";
  const e = new EmbedBuilder()
    .setColor(c.enabled ? BLURPLE : 0xed4245)
    .setTitle(`⚙️ Config — ${prefix(ctx)}${name}`)
    .addFields(
      { name: "Enabled",     value: c.enabled ? "✅ Yes" : "❌ No", inline: true },
      { name: "Permission",  value: config.PERM_LABELS[c.permission] || c.permission, inline: true },
      { name: "Cooldown",    value: c.cooldown ? `${c.cooldown}s` : "None", inline: true },
      { name: "Aliases",     value: aliases.length ? aliases.map(a => `\`${prefix(ctx)}${a}\``).join(", ") : "—", inline: false },
      { name: "Extra Roles", value: roles, inline: false },
      { name: "Allowed Channels", value: chan(c.allowedChannels), inline: false },
      { name: "Blocked Channels", value: chan(c.blockedChannels), inline: false },
    );
  const keys = Object.keys(c.settings || {});
  if (keys.length) e.addFields({ name: "Command Settings", value: keys.map(k => `\`${k}\`: ${JSON.stringify(c.settings[k])}`).join("\n").slice(0, 1000) });
  e.setFooter({ text: `Edit: ${prefix(ctx)}config <command> <enable|disable|perm|cooldown|allow|block|alias|reset>` });
  return e;
}

function helpEmbed(ctx) {
  return new EmbedBuilder().setColor(BLURPLE).setTitle(`⚙️ ${prefix(ctx)}config — per-command settings`).setDescription([
    `${usage(ctx, "config", "<command>")} — view a command's config`,
    `${usage(ctx, "config", "<command> enable|disable")}`,
    `${usage(ctx, "config", "<command> perm <everyone|booster|mod|admin|owner>")}`,
    `${usage(ctx, "config", "<command> cooldown <seconds>")} (0 to clear)`,
    `${usage(ctx, "config", "<command> allow #channel")} / ${usage(ctx, "config", "<command> block #channel")} — toggle a channel`,
    `${usage(ctx, "config", "<command> allowrole @role")} — toggle an extra allowed role`,
    `${usage(ctx, "config", "<command> alias <name>")} — add or remove an alias`,
    `${usage(ctx, "config", "<command> aliases clear")} — remove custom aliases`,
    `${usage(ctx, "config", "<command> reset")} — restore defaults`,
  ].join("\n"));
}

function aliasError(ctx, guildId, name, alias, commandMap) {
  if (!ALIAS_RE.test(alias)) return "Alias must be 1-32 chars using lowercase letters, numbers, `_`, or `-`.";
  if (alias === name) return "That is already the command name.";
  const direct = commandMap.get(alias);
  if (direct && direct.name !== name) return `\`${alias}\` is already a command.`;
  if (typeof ctx.commandAliases === "function") {
    for (const def of commandMap.values()) {
      if (!def?.name || def.name === name) continue;
      if (ctx.commandAliases(def, guildId).includes(alias)) {
        return `\`${alias}\` is already an alias for \`${def.name}\`.`;
      }
    }
  }
  return null;
}

// Core mutation logic shared by prefix + slash. Returns an embed to reply with.
function applyChange(ctx, guildId, def, name, sub, value, mentions) {
  const cur = config.resolve(guildId, name, def);
  const aliases = Array.isArray(cur.settings?.aliases) ? [...cur.settings.aliases] : [];
  switch (sub) {
    case "enable":  config.set(guildId, name, { enabled: true });  return successEmbed(`${usage(ctx, name)} enabled.`);
    case "disable": config.set(guildId, name, { enabled: false }); return successEmbed(`${usage(ctx, name)} disabled.`);
    case "perm": {
      const lvl = String(value || "").toLowerCase();
      if (!config.PERM_ORDER.includes(lvl)) return errorEmbed(`Permission must be one of: ${config.PERM_ORDER.join(", ")}`);
      config.set(guildId, name, { permission: lvl });
      return successEmbed(`${usage(ctx, name)} now requires **${config.PERM_LABELS[lvl]}**.`);
    }
    case "cooldown": {
      const secs = parseInt(value, 10);
      if (isNaN(secs) || secs < 0 || secs > 86400) return errorEmbed("Cooldown must be 0–86400 seconds.");
      config.set(guildId, name, { cooldown: secs });
      return successEmbed(secs ? `${usage(ctx, name)} cooldown set to **${secs}s**.` : `${usage(ctx, name)} cooldown cleared.`);
    }
    case "allow": case "block": {
      const chId = mentions?.channelId;
      if (!chId) return errorEmbed(`Usage: ${usage(ctx, "config", `${name} ${sub} #channel`)}`);
      const field = sub === "allow" ? "allowedChannels" : "blockedChannels";
      const list = [...cur[field]];
      const idx = list.indexOf(chId);
      if (idx >= 0) list.splice(idx, 1); else list.push(chId);
      config.set(guildId, name, { [field]: list });
      return successEmbed(`<#${chId}> ${idx >= 0 ? "removed from" : "added to"} **${sub}** list for ${usage(ctx, name)}.`);
    }
    case "allowrole": {
      const roleId = mentions?.roleId;
      if (!roleId) return errorEmbed(`Usage: ${usage(ctx, "config", `${name} allowrole @role`)}`);
      const list = [...cur.allowedRoles];
      const idx = list.indexOf(roleId);
      if (idx >= 0) list.splice(idx, 1); else list.push(roleId);
      config.set(guildId, name, { allowedRoles: list });
      return successEmbed(`<@&${roleId}> ${idx >= 0 ? "removed from" : "added to"} extra roles for ${usage(ctx, name)}.`);
    }
    case "alias":
    case "aliases": {
      const alias = String(value || "").trim().toLowerCase();
      if (!alias) return errorEmbed(`Usage: ${usage(ctx, "config", `${name} alias <alias>`)} or ${usage(ctx, "config", `${name} aliases clear`)}`);
      if (alias === "clear") {
        config.set(guildId, name, { settings: { ...cur.settings, aliases: [] } });
        return successEmbed(`Custom aliases cleared for ${usage(ctx, name)}.`);
      }
      const err = aliasError(ctx, guildId, name, alias, ctx.commandMap);
      if (err) return errorEmbed(err);
      const idx = aliases.indexOf(alias);
      if (idx >= 0) aliases.splice(idx, 1);
      else {
        if (aliases.length >= 10) return errorEmbed("A command can have at most 10 custom aliases.");
        aliases.push(alias);
      }
      config.set(guildId, name, { settings: { ...cur.settings, aliases } });
      return successEmbed(`${usage(ctx, alias)} ${idx >= 0 ? "removed from" : "added as"} an alias for ${usage(ctx, name)}.`);
    }
    case "reset": config.reset(guildId, name); return successEmbed(`${usage(ctx, name)} config reset to defaults.`);
    default: return errorEmbed(`Unknown action. See ${usage(ctx, "config")} for usage.`);
  }
}

async function prefixConfig(message, args, ctx) {
  if (!canManage(message.member, message.author.id))
    return message.reply({ embeds: [errorEmbed("Only Administrators can manage command config.")] });
  if (!args[0]) return message.reply({ embeds: [helpEmbed(ctx)] });

  const requestedName = args[0].toLowerCase();
  const known = knownCommand(ctx, requestedName, message.guild.id);
  if (!known) return message.reply({ embeds: [errorEmbed(`Unknown command \`${requestedName}\`.`)] });
  const { name, def } = known;

  const sub = args[1]?.toLowerCase();
  if (!sub) return message.reply({ embeds: [configEmbed(ctx, message.guild.id, name, def)] });

  const mentions = {
    channelId: message.mentions.channels.first()?.id || (/^\d{17,20}$/.test(args[2]) ? args[2] : null),
    roleId:    message.mentions.roles.first()?.id,
  };
  const embed = applyChange(ctx, message.guild.id, def, name, sub, args[2], mentions);
  return message.reply({ embeds: [embed] });
}

async function slashConfig(interaction, ctx) {
  if (!canManage(interaction.member, interaction.user.id))
    return interaction.reply({ embeds: [errorEmbed("Only Administrators can manage command config.")], flags: MessageFlags.Ephemeral });

  const name = interaction.options.getString("command").toLowerCase();
  const known = knownCommand(ctx, name, interaction.guild.id);
  if (!known) return interaction.reply({ embeds: [errorEmbed(`Unknown command \`${name}\`.`)], flags: MessageFlags.Ephemeral });
  const def = known.def;
  const canonicalName = known.name;

  const action  = interaction.options.getString("action");
  if (!action) return interaction.reply({ embeds: [configEmbed(ctx, interaction.guild.id, canonicalName, def)] });

  const value   = interaction.options.getString("value");
  const channel = interaction.options.getChannel("channel");
  const role    = interaction.options.getRole("role");
  const mentions = { channelId: channel?.id, roleId: role?.id };
  const embed = applyChange(ctx, interaction.guild.id, def, canonicalName, action, value, mentions);
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
          { name: "allow role", value: "allowrole" }, { name: "alias", value: "alias" }, { name: "reset", value: "reset" },
        ))
      .addStringOption(o => o.setName("value").setDescription("Value (perm level or cooldown seconds)").setRequired(false))
      .addChannelOption(o => o.setName("channel").setDescription("Channel for allow/block").setRequired(false))
      .addRoleOption(o => o.setName("role").setDescription("Role for allowrole").setRequired(false)),
    execute: slashConfig,
  },
];
