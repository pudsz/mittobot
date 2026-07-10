const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const safe = require("../safe");
const { OWNER_IDS, ANCHOR_ROLE_ID, canCreateCustomRole, isAuthorized, noPermEmbed, errorEmbed, successEmbed, resolveUserId } = require("../utils");

function isValidHex(color) { return /^#?([0-9A-Fa-f]{6})$/.test(color); }
function normalizeHex(color) { if (!color.startsWith('#')) color = '#' + color; return color.toUpperCase(); }

function usage(ctx, text) {
  return `\`${ctx?.utils?.PREFIX || "$"}${text}\``;
}

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

async function removeExistingCustomRole(guildId, userId, guild, data, knownMember = null) {
  if (data.customRoles[guildId]?.[userId]) {
    const oldRoleId = data.customRoles[guildId][userId].roleId;
    const oldRole   = guild.roles.cache.get(oldRoleId);
    // Avoid a redundant fetch when the caller already has the member in scope.
    const member = knownMember ?? await safe.orNull(guild.members.fetch(userId), `customrole removeExisting fetch ${userId}`);
    if (member && oldRole) await safe.removeRole(member, oldRole, "remove existing custom role", "customrole: remove old role");
    if (oldRole) await safe.orNull(oldRole.delete(), `customrole: delete old role ${oldRole.id}`);
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

// Shared create logic used by both the prefix and slash handlers. All validation
// runs BEFORE removeExistingCustomRole, so a bad color/style no longer deletes
// the user's current custom role (the old prefix code removed it first).
// Throws Error with a user-facing message on validation/permission failure.
async function createCustomRoleCore(guild, targetMember, roleName, style, color1, color2, iconUrl, data, authorTag) {
  if (!roleName) throw new Error("Missing role name.");
  if (roleName.length > 100) throw new Error("Role name is too long (max 100 characters).");
  if (!style || !["normal", "gradient", "holographic"].includes(style))
    throw new Error("Missing or invalid style. Choose: `normal`, `gradient`, or `holographic`");
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles))
    throw new Error("I need the `Manage Roles` permission.");

  let finalColorInt = 0, displayColor = "Random";
  if (style === "holographic") {
    finalColorInt = getRandomVibrantColor(); displayColor = "Random ✨";
  } else if (style === "gradient") {
    if (!color1 || !color2 || !isValidHex(color1) || !isValidHex(color2))
      throw new Error("Gradient requires two hex colors.");
    finalColorInt = blendColors(normalizeHex(color1), normalizeHex(color2));
    displayColor = `${normalizeHex(color1)} → ${normalizeHex(color2)}`;
  } else {
    if (!color1 || !isValidHex(color1)) throw new Error("Normal requires one hex color.");
    finalColorInt = parseInt(normalizeHex(color1).replace("#", ""), 16);
    displayColor = normalizeHex(color1);
  }

  await removeExistingCustomRole(guild.id, targetMember.id, guild, data, targetMember);

  const roleData = { name: roleName, color: finalColorInt, hoist: style === "holographic", mentionable: false };
  if (iconUrl) roleData.icon = iconUrl;
  const newRole = await guild.roles.create(roleData);
  if (ANCHOR_ROLE_ID) {
    const anchor = guild.roles.cache.get(ANCHOR_ROLE_ID);
    if (anchor) await newRole.setPosition(anchor.position + 1).catch(console.error);
  }
  await targetMember.roles.add(newRole);
  (data.customRoles[guild.id] ??= {})[targetMember.id] = { roleId: newRole.id, style, color: displayColor, name: roleName, hasIcon: !!iconUrl, createdAt: Date.now() };
  data.saveCustomRoles();

  const styleEmoji = { normal: "⚪", gradient: "🌈", holographic: "✨" }[style];
  const embed = new EmbedBuilder().setColor(finalColorInt).setTitle("🎨 Custom Role Created")
    .setDescription(`Custom role created for **${targetMember.user.username}**`)
    .addFields(
      { name: "Role Name", value: roleName, inline: true },
      { name: "Color", value: `\`${displayColor}\``, inline: true },
      { name: "Style", value: `${styleEmoji} ${style}`, inline: true },
      { name: "Icon", value: iconUrl ? "✅ Set" : "❌ None", inline: true },
    )
    .setFooter({ text: `Created by ${authorTag}` }).setTimestamp();
  if (iconUrl) embed.setThumbnail(iconUrl);
  return embed;
}

function usageEmbed(ctx) {
  return new EmbedBuilder().setColor(0x5865f2).setTitle("🎨 Custom Role Usage").addFields(
    { name: "⚪ Normal",      value: usage(ctx, 'customrole create @user "Name" normal #FF0000') },
    { name: "🌈 Gradient",    value: usage(ctx, 'customrole create @user "Name" gradient #FF0000 #0000FF') },
    { name: "✨ Holographic", value: usage(ctx, 'customrole create @user "Name" holographic') },
    { name: "Other",          value: `${usage(ctx, "customrole remove")} | ${usage(ctx, "customrole remove @user")} | ${usage(ctx, "customrole list")}` },
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
      const m    = await safe.orNull(message.guild.members.fetch(uid), `customrole list fetch ${uid}`);
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
    const userId = resolveUserId(args[1]); if (!userId) return message.reply({ embeds: [usageEmbed(ctx)] });
    if (userId !== message.author.id && !member.permissions.has(PermissionFlagsBits.Administrator) && !OWNER_IDS.has(message.author.id))
      return message.reply({ embeds: [errorEmbed("You can only create a custom role for yourself.")] });
    const targetMember = await safe.orNull(message.guild.members.fetch(userId), `customrole create fetch ${userId}`);
    if (!targetMember) return message.reply({ embeds: [errorEmbed("That user isn't in this server.")] });
    const parsed = parseRoleName(args.slice(2)); if (!parsed) return message.reply({ embeds: [errorEmbed('Unclosed quote in role name.')] });
    const { roleName, remaining } = parsed;

    let roleIcon = null;
    if (message.attachments.size > 0) {
      const att = message.attachments.first();
      if (att.contentType?.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(att.url)) roleIcon = att.url;
    }

    try {
      const embed = await createCustomRoleCore(message.guild, targetMember, roleName, remaining[0]?.toLowerCase(), remaining[1], remaining[2], roleIcon, data, message.author.tag);
      return message.reply({ embeds: [embed] });
    } catch (err) {
      if (err.code === 50013 || err.message?.includes("icon"))
        return message.reply({ embeds: [errorEmbed("Failed to set role icon — your server needs boost level 2.")] });
      return message.reply({ embeds: [errorEmbed(err.message || "Failed to create role.")] });
    }
  }
  return message.reply({ embeds: [usageEmbed(ctx)] });
}

async function slashCustomRole(interaction, ctx) {
  const { data } = ctx;
  const sub = interaction.options.getSubcommand();
  const member = interaction.member;

  // list
  if (sub === "list") {
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !OWNER_IDS.has(interaction.user.id))
      return interaction.reply({ embeds: [errorEmbed("Only Administrators can view the custom role list.")], flags: 64 });
    const roles = data.customRoles[interaction.guild.id] || {};
    const entries = Object.entries(roles);
    if (!entries.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("No custom roles currently active.")] });
    const MAX = 20, lines = [];
    for (let i = 0; i < Math.min(entries.length, MAX); i++) {
      const [uid, d] = entries[i];
      const m = await safe.orNull(interaction.guild.members.fetch(uid), `customrole slash list fetch ${uid}`);
      const name = m ? m.displayName : `<@${uid}>`;
      const icon = { normal: "⚪", gradient: "🌈", holographic: "✨" }[d.style] ?? "⚪";
      lines.push(`${icon} **${name}**: \`${d.name}\` (${d.color || "Random"})`);
    }
    let desc = lines.join("\n"); if (entries.length > MAX) desc += `\n*…and ${entries.length - MAX} more.*`;
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🎨 Active Custom Roles").setDescription(desc)] });
  }

  // remove
  if (sub === "remove") {
    const targetUser = interaction.options.getUser("user");
    const targetId = targetUser?.id || interaction.user.id;
    if (targetUser && targetUser.id !== interaction.user.id && !member.permissions.has(PermissionFlagsBits.Administrator) && !OWNER_IDS.has(interaction.user.id))
      return interaction.reply({ embeds: [errorEmbed("Only Admins can remove someone else's custom role.")], flags: 64 });
    if (!data.customRoles[interaction.guild.id]?.[targetId])
      return interaction.reply({ embeds: [errorEmbed("That user doesn't have a custom role.")], flags: 64 });
    try { await removeExistingCustomRole(interaction.guild.id, targetId, interaction.guild, data); return interaction.reply({ embeds: [successEmbed("Custom role removed.")] }); }
    catch (err) { return interaction.reply({ embeds: [errorEmbed(`Failed to remove role: ${err.message}`)], flags: 64 }); }
  }

  // create
  if (sub === "create") {
    if (!canCreateCustomRole(member))
      return interaction.reply({ embeds: [errorEmbed("This command is restricted to **Server Boosters** 💎 and **Administrators** 🛡️.")], flags: 64 });
    const targetUser = interaction.options.getUser("user") || interaction.user;
    if (targetUser.id !== interaction.user.id && !member.permissions.has(PermissionFlagsBits.Administrator) && !OWNER_IDS.has(interaction.user.id))
      return interaction.reply({ embeds: [errorEmbed("You can only create a custom role for yourself.")], flags: 64 });
    const targetMember = await safe.orNull(interaction.guild.members.fetch(targetUser.id), `customrole slash create fetch ${targetUser.id}`);
    if (!targetMember) return interaction.reply({ embeds: [errorEmbed("That user isn't in this server.")], flags: 64 });
    const roleName = interaction.options.getString("name");
    const style = interaction.options.getString("style");
    const color1 = interaction.options.getString("color");
    const color2 = interaction.options.getString("color2");

    try {
      const embed = await createCustomRoleCore(interaction.guild, targetMember, roleName, style, color1, color2, null, data, interaction.user.tag);
      return interaction.reply({ embeds: [embed] });
    } catch (err) {
      if (err.code === 50013 || err.message?.includes("icon"))
        return interaction.reply({ embeds: [errorEmbed("Failed to set role icon — your server needs boost level 2.")], flags: 64 });
      return interaction.reply({ embeds: [errorEmbed(err.message || "Failed to create role.")], flags: 64 });
    }
  }

  return interaction.reply({ embeds: [usageEmbed(ctx)], flags: 64 });
}

module.exports = [
  {
    name: "customrole",
    description: "Create, remove, or list custom roles",
    defaultPermission: "booster",
    prefix: handleCustomRole,
    slash: new SlashCommandBuilder().setName("customrole").setDescription("Create, remove, or list custom roles")
      .addSubcommand(c => c.setName("create").setDescription("Create a custom role")
        .addStringOption(o => o.setName("name").setDescription("Role name (max 100 chars)").setRequired(true).setMaxLength(100))
        .addStringOption(o => o.setName("style").setDescription("Visual style").setRequired(true)
          .addChoices(
            { name: "⚪ Normal (1 color)", value: "normal" },
            { name: "🌈 Gradient (2 colors)", value: "gradient" },
            { name: "✨ Holographic (random vibrant)", value: "holographic" },
          ))
        .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #FF0000 (normal) or first gradient color").setRequired(false))
        .addStringOption(o => o.setName("color2").setDescription("Second hex color (gradient only)").setRequired(false))
        .addUserOption(o => o.setName("user").setDescription("Create for another user (admin only)").setRequired(false)))
      .addSubcommand(c => c.setName("remove").setDescription("Remove your custom role")
        .addUserOption(o => o.setName("user").setDescription("Remove another user's role (admin only)").setRequired(false)))
      .addSubcommand(c => c.setName("list").setDescription("List active custom roles (admin only)")),
    execute: slashCustomRole,
  },
];

// Exported for direct testing — the core create/validation logic.
module.exports.createCustomRoleCore = createCustomRoleCore;
