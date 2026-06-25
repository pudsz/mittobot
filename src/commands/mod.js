const { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const safe = require("../safe");
const { isAuthorized, noPermEmbed, errorEmbed, successEmbed, resolveUserId, parseDuration, formatDuration } = require("../utils");
const config = require("../config");
const db = require("../db");
const autoexec = require("../autoexec");

// ─── Warn escalation ──────────────────────────────────────────
// Configurable per guild via $config realwarn / dashboard.
// Now supports: points-based thresholds, time-decay, probation role assignment.
// Each step: { count or points, action, duration, probationRoleId?, probationDuration? }
// count = based on total warning count, points = based on weighted severity sum.
// Use `type: "count"` or `type: "points"` (default: "count" for backward compat).
const DEFAULT_WARN_LADDER = [
  { type: "count", threshold: 2, action: "mute", duration: "10m" },
  { type: "count", threshold: 3, action: "mute", duration: "1h" },
  { type: "count", threshold: 4, action: "mute", duration: "1d" },
  { type: "count", threshold: 5, action: "kick" },
  { type: "count", threshold: 6, action: "ban" },
];

const DM_TEMPLATE_DEFAULTS = {
  warn: "⚠️ You've been warned in **{server}**. Reason: {reason}",
  mute: "🔇 You've been muted in **{server}** for {duration}. Reason: {reason}",
  kick: "👢 You've been kicked from **{server}**. Reason: {reason}",
  ban: "🔨 You've been banned from **{server}**. Reason: {reason}",
  unmute: "🔊 You've been unmuted in **{server}**.",
  unban: "You've been unbanned from **{server}**.",
};

const SEVERITY_LABELS = { 1: "Minor", 2: "Moderate", 3: "Severe", 4: "Critical", 5: "Extreme" };

// Read the ladder for a guild (falls back to the default).
function warnLadder(guildId) {
  const cfg = config.resolve(guildId, "realwarn", { defaultSettings: { ladder: DEFAULT_WARN_LADDER } });
  const ladder = cfg.settings?.ladder;
  return Array.isArray(ladder) && ladder.length ? ladder : DEFAULT_WARN_LADDER;
}

// Get weighted warning count for a guild in a time window (warnings within decay period).
function getActiveWarningCount(data, guildId, userId, decayMs) {
  const all = data.getWarnings(guildId, userId);
  if (!all.length) return { count: 0, points: 0 };
  if (!decayMs) return { count: all.length, points: all.reduce((s, w) => s + (w.points || 1), 0) };
  const cutoff = Date.now() - decayMs;
  const active = all.filter(w => w.timestamp >= cutoff);
  return { count: active.length, points: active.reduce((s, w) => s + (w.points || 1), 0) };
}

// Find the action matching the threshold type (count or points).
// Handles both new format ({ type, threshold }) and legacy format ({ count }).
function ladderActionFor(guildId, count, points) {
  const ladder = warnLadder(guildId);
  const threshold = (s) => s.threshold ?? s.count; // backward compat
  // Check points-based thresholds first
  const pointsStep = ladder.find(s => (s.type === "points" || s.type === "score") && points >= threshold(s));
  if (pointsStep) return pointsStep;
  // Fall back to count-based
  return ladder.find(s => (s.type === "count" || !s.type) && count >= threshold(s)) || null;
}

// Apply an escalation step to a member. Returns a human string describing what happened, or null.
async function applyEscalation(guild, member, step, reason) {
  if (!step || step.action === "none") return null;
  const me = guild.members.me;
  const escalationReason = `Auto-escalation: ${reason}`;
  let result = null;
  try {
    if (step.action === "mute") {
      const ms = parseDuration(step.duration) || 10 * 60_000;
      if (me.permissions.has(PermissionFlagsBits.ModerateMembers) && member.moderatable) {
        await member.timeout(ms, escalationReason);
        result = `🔇 auto-muted for **${formatDuration(ms)}**`;
      }
    } else if (step.action === "kick") {
      if (me.permissions.has(PermissionFlagsBits.KickMembers) && member.kickable) {
        await member.kick(escalationReason);
        result = "👢 auto-kicked";
      }
    } else if (step.action === "ban") {
      if (me.permissions.has(PermissionFlagsBits.BanMembers) && member.bannable) {
        await member.ban({ reason: escalationReason });
        result = "🔨 auto-banned";
      }
    } else if (step.action === "probation" || (step.action === "probate")) {
      // Assign probation role
      if (step.probationRoleId) {
        const role = guild.roles.cache.get(step.probationRoleId);
        if (role && role.position < me.roles.highest.position) {
          await member.roles.add(role, escalationReason);
          const expireMs = parseDuration(step.probationDuration) || 7 * 24 * 60 * 60_000;
          const expiresAt = Date.now() + expireMs;
          await db.setProbation(guild.id, member.id, step.probationRoleId, expiresAt, 0);
          result = `⏳ placed on **probation** for ${formatDuration(expireMs)}`;
        }
      }
    }
  } catch { /* best-effort */ }
  return result;
}

// Send DM to a user using guild's template (or default). Returns true if sent.
async function sendPunishmentDM(guild, member, action, vars = {}) {
  if (!member || member.user.bot) return false;
  try {
    // Check guild template
    let tmpl = await db.getDmTemplate(guild.id, action);
    const msg = tmpl?.enabled !== 0 ? (tmpl?.message || DM_TEMPLATE_DEFAULTS[action] || "") : "";
    if (!msg) return false;
    const formatted = msg
      .replace(/\{user\}/g, `<@${member.id}>`)
      .replace(/\{username\}/g, member.user.username)
      .replace(/\{server\}/g, guild.name)
      .replace(/\{reason\}/g, vars.reason || "No reason")
      .replace(/\{duration\}/g, vars.duration || "")
      .replace(/\{mod\}/g, vars.mod || "Moderator");
    await safe.orNull(member.send(formatted), `DM ${action} to ${member.user.tag}`);
    return true;
  } catch { return false; }
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
    await safe.delete(message, "fake mod lock/unlock");
    return message.channel.send({ embeds: [successEmbed(line)] });
  }
  if (type === "slowmode") {
    const line = fakeModLine(type, { slowmodeArg: args[0] });
    await safe.delete(message, "fake mod slowmode");
    return message.channel.send({ embeds: [successEmbed(line)] });
  }

  const userId = resolveUserId(args[0]);
  if (!userId) return message.reply({ embeds: [errorEmbed(`Usage: $${type} @user [reason]`)] });
  const member   = await safe.orNull(message.guild.members.fetch(userId), `fake mod fetch ${userId}`);
  const username = member ? member.user.username : `<@${userId}>`;

  let durationMs = FAKE_DEFAULT_DURATION_MS, reasonStart = 1;
  if (DURATION_TYPES.has(type)) {
    const parsed = parseDuration(args[1]);
    if (parsed) { durationMs = parsed; reasonStart = 2; }
  }
  const reason = args.slice(reasonStart).join(" ") || "No reason";
  const line = fakeModLine(type, { username, reason, durationMs });
  await safe.delete(message, "fake mod command");
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
// REAL MODERATION (shared core) — weighted warnings edition
// ════════════════════════════════════════════════════════════

// Moderation log helper — logs every real mod action to the audit trail.
async function logModAction(guildId, userId, modId, action, reason, details) {
  try {
    await db.addModLogEntry(guildId, userId, modId, action, reason, details);
  } catch { /* best-effort */ }
}

async function execRealMod(respond, guild, type, member, durationMs, reason, data, authorTag, { severity = 1, moderatorId } = {}) {
  try {
    const username = member.user.username;
    const userId = member.id;
    const guildId = guild.id;

    if (type === "warn") {
      const points = severity; // 1-5 severity maps directly to warning points
      data.addWarning(guildId, userId, { reason, by: authorTag, timestamp: Date.now(), severity, points });
      const count = data.getWarnings(guildId, userId).length;

      // Log the action
      await logModAction(guildId, userId, authorTag, "warn", reason, `severity=${severity} pts=${points}`);

      // Send DM
      await sendPunishmentDM(guild, member, "warn", { reason, mod: authorTag });

      let line = `${username} warned (**${count}** total, **${points}** pts) | ${reason}`;

      // Check escalation ladder with both count and points
      const active = getActiveWarningCount(data, guildId, userId, 0); // no decay for now
      const step = ladderActionFor(guildId, active.count, active.points);
      const escalation = await applyEscalation(guild, member, step, reason);
      if (escalation) line += `\n${escalation} (warning #${count})`;

      // Auto-exec: fire rules triggered by "warn" event
      autoexec.executeTrigger(guildId, "warn", {
        guild, member, user: member.user, username, userId,
        reason, moderator: authorTag, moderatorUserId: moderatorId || null,
        severity, warningCount: count,
      }).catch(err => console.error("autoexec warn:", err.message));

      return respond({ embeds: [successEmbed(line)] });
    }
    if (type === "mute") {
      const mutedRole = guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
      if (mutedRole && member.roles.highest.position < guild.members.me.roles.highest.position) await member.roles.add(mutedRole, reason);
      await safe.timeout(member, durationMs, reason, "real mute");

      await logModAction(guildId, userId, authorTag, "mute", reason, `duration=${formatDuration(durationMs)}`);
      await sendPunishmentDM(guild, member, "mute", { reason, duration: formatDuration(durationMs), mod: authorTag });

      // Auto-exec: fire rules triggered by "mute" event
      autoexec.executeTrigger(guildId, "mute", {
        guild, member, user: member.user, username, userId,
        reason, moderator: authorTag, moderatorUserId: moderatorId || null,
        duration: formatDuration(durationMs),
      }).catch(err => console.error("autoexec mute:", err.message));

      return respond({ embeds: [successEmbed(`${username} muted for **${formatDuration(durationMs)}** | ${reason}`)] });
    }
    if (type === "kick") {
      await member.kick(reason);

      await logModAction(guildId, userId, authorTag, "kick", reason, "");
      await sendPunishmentDM(guild, member, "kick", { reason, mod: authorTag });

      // Auto-exec: fire rules triggered by "kick" event
      autoexec.executeTrigger(guildId, "kick", {
        guild, member, user: member.user, username, userId,
        reason, moderator: authorTag, moderatorUserId: moderatorId || null,
      }).catch(err => console.error("autoexec kick:", err.message));

      return respond({ embeds: [successEmbed(`${username} kicked | ${reason}`)] });
    }
    if (type === "ban") {
      await member.ban({ reason, deleteMessageSeconds: 7 * 24 * 60 * 60 });

      await logModAction(guildId, userId, authorTag, "ban", reason, "7d msg delete");
      await sendPunishmentDM(guild, member, "ban", { reason, mod: authorTag });

      // Auto-exec: fire rules triggered by "ban" event
      autoexec.executeTrigger(guildId, "ban", {
        guild, member, user: member.user, username, userId,
        reason, moderator: authorTag, moderatorUserId: moderatorId || null,
      }).catch(err => console.error("autoexec ban:", err.message));

      return respond({ embeds: [successEmbed(`${username} banned | ${reason}`)] });
    }
  } catch (err) {
    console.error(err);
    return respond({ embeds: [errorEmbed(`Failed: ${err.message}`)] });
  }
}

async function handleRealMod(message, args, type, ctx) {
  const { data } = ctx;
  const userId = resolveUserId(args[0]);
  if (!userId) return message.reply({ embeds: [errorEmbed(`Usage: $real${type} @user [severity] [reason]`)] });
  const member = await safe.orNull(message.guild.members.fetch(userId), `real mod fetch ${userId}`);
  if (!member) return message.reply({ embeds: [errorEmbed("User not found")] });
  let durationMs = 10 * 60_000, reasonStart = 1;
  let severity = 1;
  if (type === "warn") {
    // Check if second arg is a severity number (1-5)
    const sev = parseInt(args[1], 10);
    if (args[1] && !isNaN(sev) && sev >= 1 && sev <= 5) {
      severity = sev;
      reasonStart = 2;
    }
  } else if (type === "mute") {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed("I need `Moderate Members` to mute.")] });
    const parsed = parseDuration(args[1]); if (parsed) { durationMs = parsed; reasonStart = 2; }
  } else if (type === "kick" && !message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply({ embeds: [errorEmbed("I need `Kick Members` permission.")] });
  else if  (type === "ban"  && !message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers))  return message.reply({ embeds: [errorEmbed("I need `Ban Members` permission.")] });
  const reason = args.slice(reasonStart).join(" ") || "No reason";
  await execRealMod(e => message.channel.send(e), message.guild, type, member, durationMs, reason, data, message.author.tag, { severity, moderatorId: message.author.id });
  await safe.delete(message, "real mod command");
}

async function slashRealMod(interaction, ctx, type) {
  const { data } = ctx;
  await interaction.deferReply();

  const user = interaction.options.getUser("user");
  if (!user) return interaction.editReply({ embeds: [errorEmbed("Please mention a user.")] });
  const member = await safe.orNull(interaction.guild.members.fetch(user.id), `slash real mod fetch ${user.id}`);
  if (!member) return interaction.editReply({ embeds: [errorEmbed("User not found in this server.")] });

  const reason = interaction.options.getString("reason") || "No reason";
  const severity = Math.min(Math.max(interaction.options.getInteger("severity") || 1, 1), 5);
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

  await execRealMod(e => interaction.editReply(e), interaction.guild, type, member, durationMs, reason, data, interaction.user.tag, { severity, moderatorId: interaction.user.id });
}

// ─── Standalone real-mod handlers (unmute, unban, warnlist, warnclear, lock, unlock, slowmode)
async function handleRealUnmute(message, args, ctx) {
  const userId = resolveUserId(args[0]); if (!userId) return message.reply({ embeds: [errorEmbed("Usage: $realunmute @user")] });
  const member = await safe.orNull(message.guild.members.fetch(userId), `real unmute fetch ${userId}`); if (!member) return message.reply({ embeds: [errorEmbed("User not found")] });
  const mutedRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
  try {
    if (mutedRole && member.roles.cache.has(mutedRole.id)) await member.roles.remove(mutedRole);
    if (message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) await safe.timeout(member, null, "real unmute");
    await message.channel.send({ embeds: [successEmbed(`${member.user.username} unmuted`)] });
  } catch (err) { await message.reply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function slashRealUnmute(interaction, ctx) {
  await interaction.deferReply();
  const user   = interaction.options.getUser("user");
  const member = await safe.orNull(interaction.guild.members.fetch(user.id), `slash real unmute fetch ${user.id}`);
  if (!member) return interaction.editReply({ embeds: [errorEmbed("User not found.")] });
  const mutedRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === "muted");
  try {
    if (mutedRole && member.roles.cache.has(mutedRole.id)) await member.roles.remove(mutedRole);
    if (interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) await safe.timeout(member, null, "slash real unmute");
    await interaction.editReply({ embeds: [successEmbed(`${member.user.username} unmuted`)] });
  } catch (err) { await interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
}

async function handleRealUnban(message, args, ctx) {
  const userId = resolveUserId(args[0]); if (!userId) return message.reply({ embeds: [errorEmbed("Usage: $realunban <userId> [reason]")] });
  const reason = args.slice(1).join(" ") || "No reason";
  try { await message.guild.bans.remove(userId, reason); await message.channel.send({ embeds: [successEmbed(`<@${userId}> unbanned | ${reason}`)] }); }
  catch (err) { await message.reply({ embeds: [errorEmbed(`Failed: ${err.message}`)] }); }
  await safe.delete(message, "real unban command");
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
  const member = await safe.orNull(message.guild.members.fetch(userId), `warnlist fetch ${userId}`);
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
  const member = await safe.orNull(message.guild.members.fetch(userId), `warnclear fetch ${userId}`);
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

// ─── Sync channel permissions with parent categories
const CHANNEL_ID_RE = /<#(\d{17,20})>|(\d{17,20})/g;

function parseChannelIds(input) {
  const ids = [];
  const seen = new Set();
  for (const match of (input || "").matchAll(CHANNEL_ID_RE)) {
    const id = match[1] || match[2];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function splitSyncReason(args) {
  const idx = args.findIndex(arg => arg === "--reason" || arg === "-r");
  if (idx === -1) return { targetArgs: args, reason: "No reason" };
  return {
    targetArgs: args.slice(0, idx),
    reason: args.slice(idx + 1).join(" ") || "No reason",
  };
}

function isCategory(channel) {
  return channel?.type === ChannelType.GuildCategory;
}

function channelLabel(channel) {
  if (!channel) return "unknown";
  return channel.toString?.() || `#${channel.name || channel.id}`;
}

function parentCategoryFor(channel) {
  if (isCategory(channel?.parent)) return channel.parent;
  if (isCategory(channel?.parent?.parent)) return channel.parent.parent;
  return null;
}

function sortChannels(channels) {
  return [...channels].sort((a, b) => {
    const byParent = (a.parentId || "").localeCompare(b.parentId || "");
    if (byParent) return byParent;
    return (a.rawPosition ?? 0) - (b.rawPosition ?? 0);
  });
}

function categoryChildren(category) {
  return sortChannels(
    category.guild.channels.cache.filter(ch => ch.parentId === category.id && typeof ch.lockPermissions === "function").values()
  );
}

function addChannelOrCategory(targets, skipped, channel) {
  if (!channel) return;
  if (isCategory(channel)) {
    const children = categoryChildren(channel);
    if (!children.length) skipped.push({ label: channelLabel(channel), reason: "category has no child channels" });
    for (const child of children) targets.set(child.id, child);
    return;
  }
  targets.set(channel.id, channel);
}

async function addChannelsById(guild, ids, targets, skipped) {
  for (const id of ids) {
    const channel = guild.channels.cache.get(id) || await safe.orNull(guild.channels.fetch(id), `syncperms fetch channel ${id}`);
    if (!channel) {
      skipped.push({ label: `\`${id}\``, reason: "channel not found" });
      continue;
    }
    addChannelOrCategory(targets, skipped, channel);
  }
}

function allCategorizedChannels(guild) {
  return sortChannels(guild.channels.cache.filter(ch => ch.parentId && typeof ch.lockPermissions === "function").values());
}

function syncUsage() {
  return [
    "Usage:",
    "`$syncperms` - sync every channel in this channel's category",
    "`$syncperms all` - sync every categorized channel in the server",
    "`$syncperms category <category id/mention>` - sync one category",
    "`$syncperms #channel1 #channel2 ...` - sync selected channels",
    "Add `--reason <text>` to set the audit-log reason.",
  ].join("\n");
}

async function selectPrefixSyncTargets(message, args) {
  const { targetArgs, reason } = splitSyncReason(args);
  const sub = targetArgs[0]?.toLowerCase();
  const targets = new Map();
  const skipped = [];

  if (!sub) {
    const category = parentCategoryFor(message.channel);
    if (!category) return { error: "This channel is not inside a category.\n" + syncUsage() };
    addChannelOrCategory(targets, skipped, category);
    return { targets: [...targets.values()], skipped, reason, scopeLabel: `category ${category.name}` };
  }

  if (sub === "all") {
    for (const channel of allCategorizedChannels(message.guild)) targets.set(channel.id, channel);
    return { targets: [...targets.values()], skipped, reason, scopeLabel: "all categorized channels" };
  }

  if (sub === "category" || sub === "current") {
    if (sub === "current") {
      const category = parentCategoryFor(message.channel);
      if (!category) return { error: "This channel is not inside a category.\n" + syncUsage() };
      addChannelOrCategory(targets, skipped, category);
      return { targets: [...targets.values()], skipped, reason, scopeLabel: `category ${category.name}` };
    }

    const ids = parseChannelIds(targetArgs.slice(1).join(" "));
    if (!ids.length) {
      const category = parentCategoryFor(message.channel);
      if (!category) return { error: "Provide a category id/mention, or run the command inside a category.\n" + syncUsage() };
      addChannelOrCategory(targets, skipped, category);
      return { targets: [...targets.values()], skipped, reason, scopeLabel: `category ${category.name}` };
    }

    const channel = message.guild.channels.cache.get(ids[0]) || await safe.orNull(message.guild.channels.fetch(ids[0]), `syncperms fetch category ${ids[0]}`);
    if (!isCategory(channel)) return { error: "That is not a category channel." };
    addChannelOrCategory(targets, skipped, channel);
    return { targets: [...targets.values()], skipped, reason, scopeLabel: `category ${channel.name}` };
  }

  const ids = parseChannelIds(targetArgs.join(" "));
  if (!ids.length) return { error: syncUsage() };
  await addChannelsById(message.guild, ids, targets, skipped);
  return { targets: [...targets.values()], skipped, reason, scopeLabel: "selected channels" };
}

async function selectSlashSyncTargets(interaction) {
  const scope = interaction.options.getString("scope") || "current";
  const category = interaction.options.getChannel("category");
  const channelsText = interaction.options.getString("channels") || "";
  const reason = interaction.options.getString("reason") || "No reason";
  const targets = new Map();
  const skipped = [];

  if (scope === "all") {
    for (const channel of allCategorizedChannels(interaction.guild)) targets.set(channel.id, channel);
    return { targets: [...targets.values()], skipped, reason, scopeLabel: "all categorized channels" };
  }

  if (scope === "current" || scope === "category") {
    const resolvedCategory = category || parentCategoryFor(interaction.channel);
    if (!isCategory(resolvedCategory)) return { error: "Pick a category, or run this in a channel inside a category." };
    addChannelOrCategory(targets, skipped, resolvedCategory);
    return { targets: [...targets.values()], skipped, reason, scopeLabel: `category ${resolvedCategory.name}` };
  }

  if (scope === "selected") {
    const ids = parseChannelIds(channelsText);
    if (category) addChannelOrCategory(targets, skipped, category);
    if (ids.length) await addChannelsById(interaction.guild, ids, targets, skipped);
    if (!targets.size && !skipped.length) return { error: "Provide channel mentions/IDs in `channels`, or choose a category." };
    return { targets: [...targets.values()], skipped, reason, scopeLabel: "selected channels" };
  }

  return { error: "Unknown sync scope." };
}

function memberHasManageChannels(member, memberPermissions) {
  return Boolean(
    memberPermissions?.has?.(PermissionFlagsBits.ManageChannels) ||
    member?.permissions?.has?.(PermissionFlagsBits.ManageChannels)
  );
}

function auditReason(userTag, reason) {
  return `Permission sync by ${userTag}: ${reason || "No reason"}`.slice(0, 512);
}

async function syncPermissionTargets(targets, skipped, reason) {
  const synced = [];
  const failed = [];
  const allSkipped = [...skipped];

  for (const channel of targets) {
    if (!channel.parentId) {
      allSkipped.push({ channel, reason: "not inside a category" });
      continue;
    }
    if (typeof channel.lockPermissions !== "function") {
      allSkipped.push({ channel, reason: "channel type cannot sync permissions" });
      continue;
    }
    const botPerms = channel.permissionsFor(channel.guild.members.me);
    if (!botPerms?.has(PermissionFlagsBits.ManageChannels)) {
      failed.push({ channel, reason: "bot lacks Manage Channels here" });
      continue;
    }
    try {
      const permissionOverwrites = channel.parent.permissionOverwrites.cache.map(overwrite => overwrite.toJSON());
      await channel.edit({ permissionOverwrites, reason });
      synced.push(channel);
    } catch (err) {
      failed.push({ channel, reason: err.message || "unknown error" });
    }
  }

  return { synced, failed, skipped: allSkipped };
}

function compactList(items, formatter) {
  const visible = items.slice(0, 10).map(formatter);
  const remaining = items.length - visible.length;
  if (remaining > 0) visible.push(`...and ${remaining} more`);
  return visible.join("\n").slice(0, 1024) || "None";
}

function syncSummaryEmbed(result, scopeLabel) {
  const total = result.synced.length + result.failed.length + result.skipped.length;
  const embed = new EmbedBuilder()
    .setColor(result.failed.length ? 0xfee75c : 0x00c776)
    .setTitle("Permission Sync Complete")
    .setDescription(`Synced **${result.synced.length}/${total}** channel(s) with their parent category permissions for **${scopeLabel}**.`);

  if (result.synced.length) {
    embed.addFields({ name: `Synced (${result.synced.length})`, value: compactList(result.synced, ch => channelLabel(ch)), inline: false });
  }
  if (result.failed.length) {
    embed.addFields({
      name: `Failed (${result.failed.length})`,
      value: compactList(result.failed, item => `${channelLabel(item.channel)} - ${item.reason}`),
      inline: false,
    });
  }
  if (result.skipped.length) {
    embed.addFields({
      name: `Skipped (${result.skipped.length})`,
      value: compactList(result.skipped, item => `${item.channel ? channelLabel(item.channel) : item.label} - ${item.reason}`),
      inline: false,
    });
  }
  return embed;
}

async function handleSyncPerms(message, args, ctx) {
  if (!memberHasManageChannels(message.member)) return message.reply({ embeds: [errorEmbed("You need `Manage Channels` to sync permissions.")] });
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [errorEmbed("I need `Manage Channels`.")] });

  const selection = await selectPrefixSyncTargets(message, args);
  if (selection.error) return message.reply({ embeds: [errorEmbed(selection.error)] });
  if (!selection.targets.length && !selection.skipped.length) return message.reply({ embeds: [errorEmbed("No channels matched that selection.")] });

  const progress = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`Syncing **${selection.targets.length}** channel(s)...`)] });
  const result = await syncPermissionTargets(selection.targets, selection.skipped, auditReason(message.author.tag, selection.reason));
  const payload = { embeds: [syncSummaryEmbed(result, selection.scopeLabel)] };
  const edited = await safe.edit(progress, payload, "syncperms progress");
  if (!edited) safe.send(message.channel, payload, "syncperms fallback");
}

async function slashSyncPerms(interaction, ctx) {
  if (!memberHasManageChannels(interaction.member, interaction.memberPermissions))
    return interaction.reply({ embeds: [errorEmbed("You need `Manage Channels` to sync permissions.")], ephemeral: true });
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels))
    return interaction.reply({ embeds: [errorEmbed("I need `Manage Channels`.")], ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const selection = await selectSlashSyncTargets(interaction);
  if (selection.error) return interaction.editReply({ embeds: [errorEmbed(selection.error)] });
  if (!selection.targets.length && !selection.skipped.length) return interaction.editReply({ embeds: [errorEmbed("No channels matched that selection.")] });

  const result = await syncPermissionTargets(selection.targets, selection.skipped, auditReason(interaction.user.tag, selection.reason));
  await interaction.editReply({ embeds: [syncSummaryEmbed(result, selection.scopeLabel)] });
}

function syncPermsSlash() {
  return new SlashCommandBuilder()
    .setName("syncperms")
    .setDescription("Sync multiple channels with their parent category permissions")
    .addStringOption(o => o
      .setName("scope")
      .setDescription("Which channels to sync")
      .setRequired(false)
      .addChoices(
        { name: "Current category", value: "current" },
        { name: "Selected category", value: "category" },
        { name: "Selected channels/categories", value: "selected" },
        { name: "All categorized channels", value: "all" },
      ))
    .addChannelOption(o => o
      .setName("category")
      .setDescription("Category to sync; categories in selected scope expand to child channels")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false))
    .addStringOption(o => o
      .setName("channels")
      .setDescription("Channel/category mentions or IDs, separated by spaces")
      .setRequired(false))
    .addStringOption(o => o
      .setName("reason")
      .setDescription("Audit-log reason")
      .setRequired(false));
}

// ─── SlashCommandBuilder helpers
function fakeModSlash(name, desc, withDuration = false) {
  const b = new SlashCommandBuilder().setName(name).setDescription(desc);
  b.addUserOption(o => o.setName("user").setDescription("Target user").setRequired(false));
  b.addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false));
  if (withDuration) b.addStringOption(o => o.setName("duration").setDescription("Duration e.g. 10m, 1h, 1d").setRequired(false));
  return b;
}
function realModSlash(name, desc, withDuration = false, withSeverity = false) {
  const b = new SlashCommandBuilder().setName(name).setDescription(desc)
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false));
  if (withDuration) b.addStringOption(o => o.setName("duration").setDescription("Duration e.g. 10m, 1h, 1d").setRequired(false));
  if (withSeverity) b.addIntegerOption(o => o.setName("severity").setDescription("Warning severity (1-5)").setRequired(false).setMinValue(1).setMaxValue(5));
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
  { name: "realwarn",      description: "Warn a user",           prefix: (m,a,c) => handleRealMod(m,a,"warn",c),      slash: new SlashCommandBuilder().setName("realwarn").setDescription("Warn a user").addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)).addIntegerOption(o => o.setName("severity").setDescription("Severity (1-5, more = worse)").setRequired(false).setMinValue(1).setMaxValue(5)).addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)), execute: (i,c) => slashRealMod(i,c,"warn") },
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
  { name: "syncperms",     description: "Sync channels with category permissions", prefix: (m,a,c) => handleSyncPerms(m,a,c), slash: syncPermsSlash(), execute: (i,c) => slashSyncPerms(i,c) },
];

// Default permission levels (admins can override per-command via $config / dashboard).
// kick/ban escalate to admin; everything else mod-gated by default.
const ADMIN_DEFAULT = new Set(["ban", "kick", "realban", "realkick", "syncperms"]);
for (const cmd of module.exports) {
  cmd.defaultPermission = ADMIN_DEFAULT.has(cmd.name) ? "admin" : "mod";
}

// Expose the configurable warn-escalation ladder so $config / the dashboard surface it.
const realwarnDef = module.exports.find(c => c.name === "realwarn");
if (realwarnDef) realwarnDef.defaultSettings = { ladder: DEFAULT_WARN_LADDER };

// ─── Probation expiry cleanup (runs every 5 minutes) ──────────────────────
let probationTimer = null;
let clientRef = null;

// The index.js bootstrap calls this with the Discord client reference so the
// cleanup timer can look up guilds, fetch members, and remove probation roles.
function setClient(client) {
  clientRef = client;
}

async function removeExpiredProbationRole(p) {
  if (!clientRef || !p.guild_id || !p.role_id || !p.user_id) return;
  try {
    const guild = clientRef.guilds.cache.get(p.guild_id);
    if (!guild) return;
    const member = await safe.orNull(guild.members.fetch(p.user_id).catch(() => null), `probation cleanup fetch ${p.user_id}`);
    if (!member) return;
    const role = guild.roles.cache.get(p.role_id);
    if (!role) return;
    if (member.roles.cache.has(p.role_id)) {
      await safe.removeRole(member, role, "probation expired");
    }
  } catch { /* best-effort */ }
}

function startProbationCleanup() {
  if (probationTimer) return;
  probationTimer = setInterval(async () => {
    try {
      const all = await db.getAllProbations();
      const now = Date.now();
      for (const p of all) {
        if (p.expires_at && Number(p.expires_at) <= now) {
          try {
            // Remove the Discord role from the member first
            await removeExpiredProbationRole(p);
            // Then remove the DB record
            await db.removeProbation(p.guild_id, p.user_id);
          } catch { /* best-effort */ }
        }
      }
    } catch { /* best-effort */ }
  }, 5 * 60_000);
  probationTimer.unref();
}

function stopProbationCleanup() {
  if (probationTimer) {
    clearInterval(probationTimer);
    probationTimer = null;
  }
}

// Export cleanup lifecycle + client setter
module.exports.startProbationCleanup = startProbationCleanup;
module.exports.stopProbationCleanup = stopProbationCleanup;
module.exports.setClient = setClient;
