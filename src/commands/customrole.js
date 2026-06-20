const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { OWNER_IDS, ANCHOR_ROLE_ID, canCreateCustomRole, isAuthorized, noPermEmbed, errorEmbed, successEmbed, resolveUserId } = require("../utils");

function isValidHex(color) { return /^#?([0-9A-Fa-f]{6})$/.test(color); }
function normalizeHex(color) { if (!color.startsWith('#')) color = '#' + color; return color.toUpperCase(); }

function blendColors(hex1, hex2) {
  const c1 = parseInt(hex1.replace('#', ''), 16), c2 = parseInt(hex2.replace('#', ''), 16);
  const r = Math.floor(((c1 >> 16 & 255) + (c2 >> 16 & 255)) / 2);
  const g = Math.floor(((c1 >> 8  & 255) + (c2 >> 8  & 255)) / 2);
  const b = Math.floor(((c1       & 255) + (c2       & 255)) / 2);
  return (r << 16) | (g << 8) | b;
}

function getRandomVibrantColor() {
  const h = Math.floor(Math.random() * 360), s = 70 + Math.floor(Math.random() * 30), l = 40 + Math.floor(Math.random() * 20);
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l / 100 - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; } else              { r = c; g = 0; b = x; }
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

async function removeExistingCustomRole(guildId, userId, guild, data) {
  if (data.customRoles[guildId]?.[userId]) {
    const oldRoleId = data.customRoles[guildId][userId].roleId;
    const oldRole   = guild.roles.cache.get(oldRoleId);
    const member    = await guild.members.fetch(userId).catch(() => null);
    if (member && oldRole) await member.roles.remove(oldRole).catch(() => null);
    if (oldRole) await oldRole.delete().catch(() => null);
    delete data.customRoles[guildId][userId];
    data.saveCustomRoles();
    return true;
  }
  return false;
}

function parseRoleName(rawArgs) {
  if (!rawArgs[0]) return null;
  if (rawArgs[0].startsWith('"')) {
    if (rawArgs[0].endsWith('"') && rawArgs[0].length > 1) return { roleName: rawArgs[0].slice(1, -1), remaining: rawArgs.slice(1) };
    let combined = rawArgs[0];
    for (let i = 1; i < rawArgs.length; i++) {
      combined += ' ' + rawArgs[i];
      if (rawArgs[i].endsWith('"')) return { roleName: combined.slice(1, -1), remaining: rawArgs.slice(i + 1) };
    }
    return null;
  }
  return { roleName: rawArgs[0], remaining: rawArgs.slice(1) };
}

function usageEmbed() {
  return new EmbedBuilder().setColor(0x5865f2).setTitle("🎨 Custom Role Usage").addFields(
    { name: "⚪ Normal",      value: '`$customrole create @user "Name" normal #FF0000`' },
    { name: "🌈 Gradient",    value: '`$customrole create @user "Name" gradient #FF0000 #0000FF`' },
    { name: "✨ Holographic", value: '`$customrole create @user "Name" holographic`' },
    { name: "Other",          value: '`$customrole remove` | `$customrole remove @user` | `$customrole list`' },
    { name: "📎 Icon",        value: "Attach an image to set a role icon (requires server boost level 2)." }
  );
}

async function handleCustomRole(message, args, ctx) {
  const { data } = ctx;
  const member = message.member;
  if (!canCreateCustomRole(member)) return message.reply({ embeds: [errorEmbed("This command is restricted to **Server Boosters** 💎 and **Administrators** 🛡️.")] });
  const sub = args[0]?.toLowerCase();

  if (sub === "list") {
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !OWNER_IDS.has(message.author.id))
      return message.reply({ embeds: [errorEmbed("Only Administrators can view the custom role list.")] });
    const roles   = data.customRoles[message.guild.id] || {};
    const entries = Object.entries(roles);
    if (!entries.length) return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("No custom roles currently active.")] });
    const MAX = 20, lines = [];
    for (let i = 0; i < Math.min(entries.length, MAX); i++) {
      const [uid, d] = entries[i];
      const m    = await message.guild.members.fetch(uid).catch(() => null);
      const name = m ? m.displayName : `<@${uid}>`;
      const icon = { normal: '⚪', gradient: '🌈', holographic: '✨' }[d.style] ?? '⚪';
      lines.push(`${icon} **${name}**: \`${d.name}\` (${d.color || 'Random'})`);
    }
    let desc = lines.join('\n'); if (entries.length > MAX) desc += `\n*…and ${entries.length - MAX} more.*`;
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🎨 Active Custom Roles").setDescription(desc)] });
  }

  if (sub === "remove" || sub === "delete") {
    let targetId = message.author.id;
    if (args[1]) {
      if (!member.permissions.has(PermissionFlagsBits.Administrator) && !OWNER_IDS.has(message.author.id))
        return message.reply({ embeds: [errorEmbed("Only Admins can remove someone else's custom role.")] });
      const resolved = resolveUserId(args[1]);
      if (!resolved) return message.reply({ embeds: [errorEmbed("Couldn't resolve that user.")] });
      targetId = resolved;
    }
    if (!data.customRoles[message.guild.id]?.[targetId]) return message.reply({ embeds: [errorEmbed("That user doesn't have a custom role.")] });
    try { await removeExistingCustomRole(message.guild.id, targetId, message.guild, data); return message.reply({ embeds: [successEmbed("Custom role removed.")] }); }
    catch (err) { return message.reply({ embeds: [errorEmbed(`Failed to remove role: ${err.message}`)] }); }
  }

  if (sub === "create") {
    const userId = resolveUserId(args[1]); if (!userId) return message.reply({ embeds: [usageEmbed()] });
    if (userId !== message.author.id && !member.permissions.has(PermissionFlagsBits.Administrator) && !OWNER_IDS.has(message.author.id))
      return message.reply({ embeds: [errorEmbed("You can only create a custom role for yourself.")] });
    const targetMember = await message.guild.members.fetch(userId).catch(() => null);
    if (!targetMember) return message.reply({ embeds: [errorEmbed("That user isn't in this server.")] });
    const parsed = parseRoleName(args.slice(2)); if (!parsed) return message.reply({ embeds: [errorEmbed('Unclosed quote in role name.')] });
    const { roleName, remaining } = parsed; if (!roleName) return message.reply({ embeds: [usageEmbed()] });
    if (roleName.length > 100) return message.reply({ embeds: [errorEmbed("Role name is too long (max 100 characters).")] });
    const style = remaining[0]?.toLowerCase();
    if (!style || !['normal', 'gradient', 'holographic'].includes(style))
      return message.reply({ embeds: [errorEmbed("Missing or invalid style. Choose: `normal`, `gradient`, or `holographic`")] });
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles))
      return message.reply({ embeds: [errorEmbed("I need the `Manage Roles` permission.")] });

    try {
      await removeExistingCustomRole(message.guild.id, userId, message.guild, data);
      let finalColorInt = 0, displayColor = "Random";
      if (style === 'holographic') {
        finalColorInt = getRandomVibrantColor(); displayColor = "Random ✨";
      } else if (style === 'gradient') {
        const hex1 = remaining[1], hex2 = remaining[2];
        if (!hex1 || !hex2 || !isValidHex(hex1) || !isValidHex(hex2)) return message.reply({ embeds: [errorEmbed("Gradient requires two hex colors.")] });
        finalColorInt = blendColors(normalizeHex(hex1), normalizeHex(hex2)); displayColor = `${normalizeHex(hex1)} → ${normalizeHex(hex2)}`;
      } else {
        const hex = remaining[1];
        if (!hex || !isValidHex(hex)) return message.reply({ embeds: [errorEmbed("Normal requires one hex color.")] });
        finalColorInt = parseInt(normalizeHex(hex).replace('#', ''), 16); displayColor = normalizeHex(hex);
      }
      let roleIcon = null;
      if (message.attachments.size > 0) {
        const att = message.attachments.first();
        if (att.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(att.url)) roleIcon = att.url;
      }
      const roleData = { name: roleName, color: finalColorInt, hoist: style === 'holographic', mentionable: false };
      if (roleIcon) roleData.icon = roleIcon;
      const newRole = await message.guild.roles.create(roleData);
      if (ANCHOR_ROLE_ID) {
        const anchor = message.guild.roles.cache.get(ANCHOR_ROLE_ID);
        if (anchor) await newRole.setPosition(anchor.position + 1).catch(console.error);
      }
      await targetMember.roles.add(newRole);
      (data.customRoles[message.guild.id] ??= {})[userId] = { roleId: newRole.id, style, color: displayColor, name: roleName, hasIcon: !!roleIcon, createdAt: Date.now() };
      data.saveCustomRoles();
      const styleEmoji = { normal: '⚪', gradient: '🌈', holographic: '✨' }[style];
      const embed = new EmbedBuilder().setColor(finalColorInt).setTitle("🎨 Custom Role Created").setDescription(`Custom role created for **${targetMember.user.username}**`)
        .addFields(
          { name: "Role Name", value: roleName,                       inline: true },
          { name: "Color",     value: `\`${displayColor}\``,          inline: true },
          { name: "Style",     value: `${styleEmoji} ${style}`,       inline: true },
          { name: "Icon",      value: roleIcon ? "✅ Set" : "❌ None", inline: true }
        )
        .setFooter({ text: `Created by ${message.author.tag}` }).setTimestamp();
      if (roleIcon) embed.setThumbnail(roleIcon);
      return message.reply({ embeds: [embed] });
    } catch (err) {
      if (err.code === 50013 || err.message?.includes("icon"))
        return message.reply({ embeds: [errorEmbed("Failed to set role icon — your server needs boost level 2.")] });
      return message.reply({ embeds: [errorEmbed(`Failed to create role: ${err.message}`)] });
    }
  }
  return message.reply({ embeds: [usageEmbed()] });
}

async function slashCustomRole(interaction, ctx) {
  await interaction.reply({ embeds: [usageEmbed().setDescription("Use `$customrole` in chat — slash support for custom roles coming soon.")] });
}

module.exports = [
  {
    name: "customrole",
    description: "Create, remove, or list custom roles",
    defaultPermission: "booster",
    prefix: handleCustomRole,
    slash: new SlashCommandBuilder().setName("customrole").setDescription("Custom role information"),
    execute: slashCustomRole,
  },
];
