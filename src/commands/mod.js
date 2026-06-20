const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { isAuthorized, noPermEmbed, errorEmbed, successEmbed, resolveUserId, parseDuration, formatDuration } = require("../utils");
const config = require("../config");

// ─── Warn escalation ──────────────────────────────────────────
// Configurable per guild via $config realwarn / dashboard. The ladder maps a
// warning count to an automatic action. Default mirrors a common setup.
// action: "none" | "mute" | "kick" | "ban"; durationMs only used for mute.
const DEFAULT_WARN_LADDER = [
  { count: 2, action: "mute", duration: "10m" },
  { count: 3, action: "mute", duration: "1h" },
  { count: 4, action: "mute", duration: "1d" },
  { count: 5, action: "kick" },
  { count: 6, action: "ban" },
];

// Read the ladder for a guild (falls back to the default).
function warnLadder(guildId) {
  const cfg = config.resolve(guildId, "realwarn", { defaultSettings: { ladder: DEFAULT_WARN_LADDER } });
  const ladder = cfg.settings?.ladder;
  return Array.isArray(ladder) && ladder.length ? ladder : DEFAULT_WARN_LADDER;
}

// Find the action that matches the current warning count (exact count match).
function ladderActionFor(guildId, count) {
  return warnLadder(guildId).find(step => step.count === count) || null;
}

// Apply an escalation step to a member. Returns a human string describing what happened, or null.
async function applyEscalation(guild, member, step, reason) {
  if (!step || step.action === "none") return null;
  const me = guild.members.me;
  const escalationReason = `Auto-escalation: ${reason}`;
  try {
    if (step.action === "mute") {
      const ms = parseDuration(step.duration) || 10 * 60_000;
      if (me.permissions.has(PermissionFlagsBits.ModerateMembers) && member.moderatable) {
        await member.timeout(ms, escalationReason);
        return `🔇 auto-muted for **${formatDuration(ms)}**`;
      }
      return null;
    }
    if (step.action === "kick") {
      if (me.permissions.has(PermissionFlagsBits.KickMembers) && member.kickable) {
        await member.kick(escalationReason);
        return "👢 auto-kicked";
      }
      return null;
    }
    if (step.action === "ban") {
      if (me.permissions.has(PermissionFlagsBits.BanMembers) && member.bannable) {
        await member.ban({ reason: escalationReason });
        return "🔨 auto-banned";
      }
      return null;
    }
  } catch { return null; }
  return null;
}

// ════════════════════════════════════════════════════════════
// FAKE MODERATION
// Mirrors the real-mod output (same green ✅ embeds + wording) but
// performs NO Discord actions and persists nothing.
// ════════════════════════════════════════════════════════════
const FAKE_DEFAULT_DURATION_MS = 10 * 60_000;

// Build the success line so it reads exactly like the real command would.
function fakeModLine(type, { username, reason, durationMs, channelName, slowmodeArg }) {
  switch (type) {
    case "warn":      return `${username} warned | ${reason}`;
    case "kick":      return `${username} kicked | ${reason}`;
    case "ban":       return `${username} banned | ${reason}`;
    case "softban":   return `${username} softbanned | ${reason}`;
    case "tempban":   return `${username} banned for **${formatDuration(durationMs)}** | ${reason}`;
    case "mute":      return `${username} muted for **${formatDuration(durationMs)}** | ${reason}`;
    case "timeout":   return `${username} timed out for **${formatDuration(durationMs)}** | ${reason}`;
    case "unmute":    return `${username} unmuted`;
    case "untimeout": return `${username} timeout removed`;
    case "unban":     return `${username} unbanned | ${reason}`;
    case "lock":      return `#${channelName} locked 🔒 | ${reason}`;
    case "unlock":    return `#${channelName} unlocked 🔓 | ${reason}`;
    case "slowmode":  return (!slowmodeArg || slowmodeArg === "0" || slowmodeArg === "off")
                        ? "Slowmode disabled"
                        : `Slowmode set to **${slowmodeArg}s**`;
    default:          return `${username} ${type}`;
  }
}

const DURATION_TYPES = new Set(["mute", "timeout", "tempban"]);

async function handleFakeMod(message, args, type) {

  if (type === "lock" || type === "unlock") {
    const line = fakeModLine(type, { channelName: message.channel.name, reason: args.join(" ") || "No reason" });
    await message.delete().catch(() => null);
    return message.channel.send({ embeds: [successEmbed(line)] });
  }
  if (type === "slowmode") {
    const line = fakeModLine(type, { slowmodeArg: args[0] });
    await message.delete().catch(() => null);
    return message.channel.send({ embeds: [successEmbed(line)] });
  }

  const userId = resolveUserId(args[0]);
  if (!userId) return message.reply({ embeds: [errorEmbed(`Usage: $${type} @user [reason]`)] });
  const member   = await message.guild.members.fetch(userId).catch(() => null);
  const username = member ? member.user.username : `<@${userId}>`;

  let durationMs = FAKE_DEFAULT_DURATION_MS, reasonStart = 1;
  if (DURATION_TYPES.has(type)) {
    const parsed = parseDuration(args[1]);
    if (parsed) { durationMs = parsed; reasonStart = 2; }
  }
  const reason = args.slice(reasonStart).join(" ") || "No reason";
  const line = fakeModLine(type, { username, reason, durationMs });
  await message.delete().catch(() => null);
  return message.channel.send({ embeds: [successEmbed(line)] });
}

async function slashFakeMod(interaction, type) {
  await interaction.deferReply();

  if (type === "lock" || type === "unlock") {
    const reason = interaction.options.getString("reason") || "No reason";
    return interaction.editReply({ embeds: [successEmbed(fakeModLine(type, { channelName: interaction.channel.name, reason }))] });
  }
  if (type === "slowmode") {
    const val = interaction.options.getInteger("seconds")?.toString();
    return interaction.editReply({ embeds: [successEmbed(fakeModLine(type, { slowmodeArg: val }))] });
  }

  const user     = interaction.options.getUser("user");
  const username = user ? user.username : "?";
  const reason   = interaction.options.getString("reason") || "No reason";
  let durationMs = FAKE_DEFAULT_DURATION_MS;
  if (DURATION_TYPES.has(type)) {
    const parsed = parseDuration(interaction.options.getString("duration"));
    if (parsed) durationMs = parsed;
  }
  return interaction.editReply({ embeds: [successEmbed(fakeModLine(type, { username, reason, durationMs }))] });
}

// ════════════════════════════════════════════════════════════
// REAL MODERATION (shared core)
// ════════════════════════════════════════════════════════════
async function execRealMod(respond, guild, type, member, durationMs, reason, data, authorTag) {
  try {
    if (type === "warn") {
      data.addWarning(guild.id, member.id, { reason, by: authorTag, timestamp: Date.now() });
      const count = data.getWarnings(guild.id, member.id).length;
      let line = `${member.user.username} warned (**${count}** total) | ${reason}`;
      const step = ladderActionFor(guild.id, count);
      const escalation = await applyEscalation(guild, member, step, reason);
      if (escalation) line += `\n${escalation} (warning #${count})`;
      return respond({ embeds: [successEmbed(line)] });
    }
    if (type === "mute") {
      const mutedRole = guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
      if (mutedRole && member.roles.highest.position < guild.members.me.roles.highest.position) await member.roles.add(mutedRole, reason);
      await member.timeout(durationMs, reason).catch(() => null);
      return respond({ embeds: [successEmbed(`${member.user.username} muted for **${formatDuration(durationMs)}** | ${reason}`)] });
    }
    if (type === "kick") {
      await member.kick(reason);
      return respond({ embeds: [successEmbed(`${member.user.username} kicked | ${reason}`)] });
    }
    if (type === "ban") {
      await member.ban({ reason, deleteMessageSeconds: 7 * 24 * 60 * 60 });
      return respond({ embeds: [successEmbed(`${member.user.username} banned | ${reason}`)] });
    }
  } catch (err) {
    console.error(err);
    return respond({ embeds: [errorEmbed(`Failed: ${err.message}`)] });
  }
}

async function handleRealMod(message, args, type, ctx) {
  const { data } = ctx;
  const userId = resolveUserId(args[0]);
  if (!userId) return message.reply({ embeds: [errorEmbed(`Usage: $real${type} @user [reason]`)] });
  const member = await message.guild.members.fetch(userId).catch(() => null);
  if (!member) return message.reply({ embeds: [errorEmbed("User not found")] });
  let durationMs = 10 * 60_000, reasonStart = 1;
  if (type === "mute") {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed("I need `Moderate Members` to mute.")] });
    const parsed = parseDuration(args[1]); if (parsed) { durationMs = parsed; reasonStart = 2; }
  } else if (type === "kick" && !message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply({ embeds: [errorEmbed("I need `Kick Members` permission.")] });
  else if  (type === "ban"  && !message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers))  return message.reply({ embeds: [errorEmbed("I need `Ban Members` permission.")] });
  const reason = args.slice(reasonStart).join(" ") || "No reason";
  await execRealMod(e => message.channel.send(e), message.guild, type, member, durationMs, reason, data, message.author.tag);
  await message.delete().catch(() => null);
}

async function slashRealMod(interaction, ctx, type) {
  const { data } = ctx;
  await interaction.deferReply();

  const user = interaction.options.getUser("user");
  if (!user) return interaction.editReply({ embeds: [errorEmbed("Please mention a user.")] });
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply({ embeds: [errorEmbed("User not found in this server.")] });

  const reason = interaction.options.getString("reason") || "No reason";
  let durationMs = 10 * 60_000;

  if (type === "mute") {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers))
      return interaction.editReply({ embeds: [errorEmbed("I need `Moderate Members` to mute.")] });
    const durStr = interaction.options.getString("duration");
    if (durStr) { const parsed = parseDuration(durStr); if (parsed) durationMs = parsed; }
  } else if (type === "kick" && !interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers))
    return interaction.editReply({ embeds: [errorEmbed("I need `Kick Members` permission.")] });
  else if  (type === "ban"  && !interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers))
    return interaction.editReply({ embeds: [errorEmbed("I need `Ban Members` permission.")] });

  await execRealMod(e => interaction.editReply(e), interaction.guild, type, member, durationMs, reason, data, interaction.user.tag);
}

// ─── Standalone real-mod handlers (unmute, unban, warnlist, warnclear, lock, unlock, slowmode)
async function handleRealUnmute(message, args, ctx) {
  const userId = resolveUserId(args[0]); if (!userId) return message.reply({ embeds: [errorEmbed("Usage: $realunmute @user")] });
  const member = await message.guild.members.fetch(userId).catch(() => null); if (!member) return message.reply({ embeds: [errorEmbed("User not found")] });
  const mutedRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
  try {
    if (mutedRole && member.roles.cache.has(mutedRole.id)) await member.roles.remove(mutedRole);
    if (message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) await member.timeout(null).catch(() => null);
    await message.channel.send({ embeds: [successEmbed(`${member.user.username} unmuted`)] });
  } catch (err) { await message.reply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function slashRealUnmute(interaction, ctx) {
  await interaction.deferReply();
  const user   = interaction.options.getUser("user");
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
  const mutedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
  try {
    if (mutedRole && member.roles.cache.has(mutedRole.id)) await member.roles.remove(mutedRole);
    if (interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) await member.timeout(null).catch(() => null);
    await interaction.editReply({ embeds: [successEmbed(`${member.user.username} unmuted`)] });
  } catch (err) { await interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function handleRealUnban(message, args, ctx) {
  const userId = resolveUserId(args[0]); if (!userId) return message.reply({ embeds: [errorEmbed("Usage: $realunban <userId> [reason]")] });
  const reason = args.slice(1).join(" ") || "No reason";
  try { await message.guild.bans.remove(userId, reason); await message.channel.send({ embeds: [successEmbed(`<@${userId}> unbanned | ${reason}`)] }); }
  catch (err) { await message.reply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
  await message.delete().catch(() => null);
}

async function slashRealUnban(interaction, ctx) {
  await interaction.deferReply();
  const user   = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason") || "No reason";
  try { await interaction.guild.bans.remove(user.id, reason); await interaction.editReply({ embeds: [successEmbed(`${user.username} unbanned | ${reason}`)] }); }
  catch (err) { await interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function handleRealWarnList(message, args, ctx) {
  const { data } = ctx;
  const userId = resolveUserId(args[0]); if (!userId) return message.reply({ embeds: [errorEmbed("Usage: $realwarnlist @user")] });
  const member = await message.guild.members.fetch(userId).catch(() => null);
  const username = member?.user.username ?? `<@${userId}>`;
  const list = data.getWarnings(message.guild.id, userId);
  if (!list.length) return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(`📋 **${username}** has no warnings`)] });
  const lines = list.map((w, i) => `**${i + 1}.** ${w.reason} — by \`${w.by}\` <t:${Math.floor(w.timestamp / 1000)}:R>`);
  await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(`⚠️ Warnings — ${username}`).setDescription(lines.join("\n")).setFooter({ text: `${list.length} warning(s) total` })] });
}

async function slashRealWarnList(interaction, ctx) {
  const { data } = ctx;
  await interaction.deferReply({ ephemeral: true });
  const user = interaction.options.getUser("user");
  const list = data.getWarnings(interaction.guild.id, user.id);
  if (!list.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(`📋 **${user.username}** has no warnings`)] });
  const lines = list.map((w, i) => `**${i + 1}.** ${w.reason} — by \`${w.by}\` <t:${Math.floor(w.timestamp / 1000)}:R>`);
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(`⚠️ Warnings — ${user.username}`).setDescription(lines.join("\n")).setFooter({ text: `${list.length} warning(s) total` })] });
}

async function handleRealWarnClear(message, args, ctx) {
  const { data } = ctx;
  const userId = resolveUserId(args[0]); if (!userId) return message.reply({ embeds: [errorEmbed("Usage: $realwarnclear @user")] });
  const member = await message.guild.members.fetch(userId).catch(() => null);
  data.clearWarnings(message.guild.id, userId);
  await message.reply({ embeds: [successEmbed(`Cleared all warnings for **${member?.user.username ?? `<@${userId}>`}**`)] });
}

async function slashRealWarnClear(interaction, ctx) {
  const { data } = ctx;
  const user = interaction.options.getUser("user");
  data.clearWarnings(interaction.guild.id, user.id);
  await interaction.reply({ embeds: [successEmbed(`Cleared all warnings for **${user.username}**`)], ephemeral: true });
}

async function handleRealLock(message, args, unlock, ctx) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [errorEmbed("I need `Manage Channels`.")] });
  const reason = args.join(" ") || "No reason";
  try {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: unlock ? null : false }, { reason: `${unlock ? "Unlocked" : "Locked"} by ${message.author.tag}: ${reason}` });
    await message.reply({ embeds: [successEmbed(`#${message.channel.name} ${unlock ? "unlocked 🔓" : "locked 🔒"} | ${reason}`)] });
  } catch (err) { await message.reply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function slashRealLock(interaction, unlock, ctx) {
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels))
    return interaction.reply({ embeds: [errorEmbed("I need `Manage Channels`.")], ephemeral: true });
  const reason = interaction.options.getString("reason") || "No reason";
  await interaction.deferReply();
  try {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: unlock ? null : false }, { reason: `${unlock ? "Unlocked" : "Locked"} by ${interaction.user.tag}: ${reason}` });
    await interaction.editReply({ embeds: [successEmbed(`#${interaction.channel.name} ${unlock ? "unlocked 🔓" : "locked 🔒"} | ${reason}`)] });
  } catch (err) { await interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function handleRealSlowmode(message, args, ctx) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [errorEmbed("I need `Manage Channels`.")] });
  const seconds = parseInt(args[0], 10);
  if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply({ embeds: [errorEmbed("Provide seconds between 0 and 21600")] });
  try {
    await message.channel.setRateLimitPerUser(seconds, `Set by ${message.author.tag}`);
    await message.reply({ embeds: [successEmbed(seconds === 0 ? "Slowmode disabled" : `Slowmode set to **${seconds}s**`)] });
  } catch (err) { await message.reply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function slashRealSlowmode(interaction, ctx) {
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels))
    return interaction.reply({ embeds: [errorEmbed("I need `Manage Channels`.")], ephemeral: true });
  const seconds = interaction.options.getInteger("seconds");
  await interaction.deferReply();
  try {
    await interaction.channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`);
    await interaction.editReply({ embeds: [successEmbed(seconds === 0 ? "Slowmode disabled" : `Slowmode set to **${seconds}s**`)] });
  } catch (err) { await interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

// ─── SlashCommandBuilder helpers
function fakeModSlash(name, desc, withDuration = false) {
  const b = new SlashCommandBuilder().setName(name).setDescription(desc);
  b.addUserOption(o => o.setName("user").setDescription("Target user").setRequired(false));
  b.addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false));
  if (withDuration) b.addStringOption(o => o.setName("duration").setDescription("Duration e.g. 10m, 1h, 1d").setRequired(false));
  return b;
}
function realModSlash(name, desc, withDuration = false) {
  const b = new SlashCommandBuilder().setName(name).setDescription(desc)
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false));
  if (withDuration) b.addStringOption(o => o.setName("duration").setDescription("Duration e.g. 10m, 1h, 1d").setRequired(false));
  return b;
}

module.exports = [
  // Fake mod
  { name: "warn",     description: "Fake warn",         category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"warn"),    slash: fakeModSlash("warn",    "Fake warn a user"),    execute: (i,c) => slashFakeMod(i,"warn") },
  { name: "kick",     description: "Fake kick",         category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"kick"),    slash: fakeModSlash("kick",    "Fake kick a user"),    execute: (i,c) => slashFakeMod(i,"kick") },
  { name: "ban",      description: "Fake ban",          category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"ban"),     slash: fakeModSlash("ban",     "Fake ban a user"),     execute: (i,c) => slashFakeMod(i,"ban") },
  { name: "mute",     description: "Fake mute",         category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"mute"),    slash: fakeModSlash("mute",    "Fake mute a user", true), execute: (i,c) => slashFakeMod(i,"mute") },
  { name: "unmute",   description: "Fake unmute",       category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"unmute"),  slash: fakeModSlash("unmute",  "Fake unmute a user"),  execute: (i,c) => slashFakeMod(i,"unmute") },
  { name: "unban",    description: "Fake unban",        category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"unban"),   slash: fakeModSlash("unban",   "Fake unban a user"),   execute: (i,c) => slashFakeMod(i,"unban") },
  { name: "softban",  description: "Fake softban",      category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"softban"), slash: fakeModSlash("softban", "Fake softban a user"), execute: (i,c) => slashFakeMod(i,"softban") },
  { name: "tempban",  description: "Fake tempban",      category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"tempban"), slash: fakeModSlash("tempban", "Fake tempban a user", true), execute: (i,c) => slashFakeMod(i,"tempban") },
  { name: "timeout",  description: "Fake timeout",      category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"timeout"), slash: fakeModSlash("timeout", "Fake timeout a user", true), execute: (i,c) => slashFakeMod(i,"timeout") },
  { name: "untimeout",description: "Fake untimeout",    category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"untimeout"),slash: fakeModSlash("untimeout","Fake untimeout a user"),execute: (i,c) => slashFakeMod(i,"untimeout") },
  { name: "lock",     description: "Fake lock",         category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"lock"),    slash: new SlashCommandBuilder().setName("lock").setDescription("Fake lock this channel").addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),    execute: (i,c) => slashFakeMod(i,"lock") },
  { name: "unlock",   description: "Fake unlock",       category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"unlock"),  slash: new SlashCommandBuilder().setName("unlock").setDescription("Fake unlock this channel").addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),  execute: (i,c) => slashFakeMod(i,"unlock") },
  { name: "slowmode", description: "Fake slowmode",     category: "fakemod", prefix: (m,a,c) => handleFakeMod(m,a,"slowmode"),slash: new SlashCommandBuilder().setName("slowmode").setDescription("Fake set slowmode").addIntegerOption(o => o.setName("seconds").setDescription("Seconds").setRequired(false)),     execute: (i,c) => slashFakeMod(i,"slowmode") },
  // Real mod
  { name: "realwarn",      description: "Warn a user",           prefix: (m,a,c) => handleRealMod(m,a,"warn",c),      slash: realModSlash("realwarn",      "Warn a user"),              execute: (i,c) => slashRealMod(i,c,"warn") },
  { name: "realkick",      description: "Kick a user",           prefix: (m,a,c) => handleRealMod(m,a,"kick",c),      slash: realModSlash("realkick",      "Kick a user"),              execute: (i,c) => slashRealMod(i,c,"kick") },
  { name: "realban",       description: "Ban a user",            prefix: (m,a,c) => handleRealMod(m,a,"ban",c),       slash: realModSlash("realban",       "Ban a user"),               execute: (i,c) => slashRealMod(i,c,"ban") },
  { name: "realmute",      description: "Mute a user",           prefix: (m,a,c) => handleRealMod(m,a,"mute",c),      slash: realModSlash("realmute",      "Mute a user", true),        execute: (i,c) => slashRealMod(i,c,"mute") },
  { name: "realunmute",    description: "Unmute a user",         prefix: (m,a,c) => handleRealUnmute(m,a,c),          slash: realModSlash("realunmute",    "Unmute a user"),            execute: (i,c) => slashRealUnmute(i,c) },
  { name: "realunban",     description: "Unban a user",          prefix: (m,a,c) => handleRealUnban(m,a,c),           slash: realModSlash("realunban",     "Unban a user"),             execute: (i,c) => slashRealUnban(i,c) },
  { name: "realwarnlist",  description: "List warnings",         prefix: (m,a,c) => handleRealWarnList(m,a,c),        slash: realModSlash("realwarnlist",  "List warnings for a user"), execute: (i,c) => slashRealWarnList(i,c) },
  { name: "realwarnclear", description: "Clear warnings",        prefix: (m,a,c) => handleRealWarnClear(m,a,c),       slash: realModSlash("realwarnclear", "Clear all warnings"),       execute: (i,c) => slashRealWarnClear(i,c) },
  { name: "reallock",      description: "Lock this channel",     prefix: (m,a,c) => handleRealLock(m,a,false,c),      slash: new SlashCommandBuilder().setName("reallock").setDescription("Lock this channel").addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),    execute: (i,c) => slashRealLock(i,false,c) },
  { name: "realunlock",    description: "Unlock this channel",   prefix: (m,a,c) => handleRealLock(m,a,true,c),       slash: new SlashCommandBuilder().setName("realunlock").setDescription("Unlock this channel").addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),  execute: (i,c) => slashRealLock(i,true,c) },
  { name: "realslowmode",  description: "Set slowmode",          prefix: (m,a,c) => handleRealSlowmode(m,a,c),        slash: new SlashCommandBuilder().setName("realslowmode").setDescription("Set slowmode").addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0-21600)").setRequired(true).setMinValue(0).setMaxValue(21600)), execute: (i,c) => slashRealSlowmode(i,c) },
];

// Default permission levels (admins can override per-command via $config / dashboard).
// kick/ban escalate to admin; everything else mod-gated by default.
const ADMIN_DEFAULT = new Set(["ban", "kick", "realban", "realkick"]);
for (const cmd of module.exports) {
  cmd.defaultPermission = ADMIN_DEFAULT.has(cmd.name) ? "admin" : "mod";
}

// Expose the configurable warn-escalation ladder so $config / the dashboard surface it.
const realwarnDef = module.exports.find(c => c.name === "realwarn");
if (realwarnDef) realwarnDef.defaultSettings = { ladder: DEFAULT_WARN_LADDER };
