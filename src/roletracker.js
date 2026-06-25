// ─── Live Role Tracker ─────────────────────────────────────────────────────
// When a user runs $trackroles @role1 @role2, the bot sends a message listing
// everyone with those roles. This module watches for guildMemberUpdate events
// and auto-edits that message whenever someone gains or loses any tracked role.
//
// Each tracked set is stored in SQLite as a single row with:
//   guild_id, channel_id, message_ids (JSON array), role_ids (JSON array)
// A debounce per channel prevents rapid-fire edits during bulk role changes.

const db     = require("./db");
const safe   = require("./safe");
const { EmbedBuilder } = require("discord.js");

// In-memory cache: { [guildId]: [track, ...] }
// track = { guildId, channelId, messageIds: string[], roleIds: string[], createdAt }
let store = {};

// Debounce map: key `${guildId}:${channelId}` -> timeout ID
const debounceMap = new Map();
const DEBOUNCE_MS  = 800;

// ═════════════════════════════════════════════════════════════════════════
//  Public API
// ═════════════════════════════════════════════════════════════════════════

async function load() {
  try {
    const rows = await db.getAllTrackedRoles();
    store = {};
    for (const row of rows) {
      const g = (store[row.guild_id] ??= []);
      g.push({
        guildId:    row.guild_id,
        channelId:  row.channel_id,
        messageIds: JSON.parse(row.message_ids || "[]"),
        roleIds:    JSON.parse(row.role_ids || "[]"),
        createdAt:  Number(row.created_at),
      });
    }
    console.log(`[roletracker] Loaded ${rows.length} tracked role set(s).`);
  } catch (err) {
    console.error("[roletracker] Failed to load:", err.message);
    store = {};
  }
}

function getTracked(guildId) {
  return store[guildId] || [];
}

// Add a new tracked set (created from a $trackroles command).
// If a track already exists for this channel, it is replaced.
async function addTrack(guildId, channelId, messageIds, roleIds) {
  // Remove any existing track for the same channel first
  await removeTrack(guildId, channelId);

  const entry = { guildId, channelId, messageIds, roleIds, createdAt: Date.now() };
  (store[guildId] ??= []).push(entry);
  await db.addTrackedRoles(guildId, channelId, messageIds, roleIds);
  return entry;
}

// Remove a tracked set by its channel ID.
async function removeTrack(guildId, channelId) {
  if (!store[guildId]) return false;
  const before = store[guildId].length;
  store[guildId] = store[guildId].filter(t => t.channelId !== channelId);
  if (store[guildId].length === 0) delete store[guildId];
  await db.deleteTrackedRoles(guildId, channelId);
  return store[guildId]?.length !== before;
}

// Update stored message IDs after an edit (the message chain may have changed).
async function updateMessageIds(guildId, channelId, messageIds) {
  const tracks = store[guildId];
  if (!tracks) return;
  const track = tracks.find(t => t.channelId === channelId);
  if (!track) return;
  track.messageIds = messageIds;
  await db.updateTrackedRoles(guildId, channelId, messageIds);
}

// ═════════════════════════════════════════════════════════════════════════
//  Event handler — called from index.js guildMemberUpdate
// ═════════════════════════════════════════════════════════════════════════

function handleRoleUpdate(oldMember, newMember) {
  if (!oldMember || !newMember) return;
  const guildId = newMember.guild.id;
  const tracks = store[guildId];
  if (!tracks || tracks.length === 0) return;

  // Find which roles actually changed
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());
  const changed = new Set();

  for (const id of oldRoles) if (!newRoles.has(id)) changed.add(id);
  for (const id of newRoles) if (!oldRoles.has(id)) changed.add(id);
  if (changed.size === 0) return;

  // Find any tracked sets that include one of the changed roles
  for (const track of tracks) {
    const overlap = track.roleIds.some(rid => changed.has(rid));
    if (!overlap) continue;

    // Debounce: schedule an update for this channel
    const key = `${guildId}:${track.channelId}`;
    if (debounceMap.has(key)) clearTimeout(debounceMap.get(key));
    debounceMap.set(key, setTimeout(() => {
      debounceMap.delete(key);
      rebuildTrackedMessage(newMember.guild, track).catch(err =>
        console.error("[roletracker] rebuild error:", err.message)
      );
    }, DEBOUNCE_MS));
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  Rebuild a tracked message in-place
// ═════════════════════════════════════════════════════════════════════════

// Build the same markdown output as the $listroles command.
function localBuildListRolesText(roles) {
  const lines = [];
  for (const role of roles) {
    const members = [...role.members.values()];
    lines.push(`# <@&${role.id}> — ${members.length} member${members.length !== 1 ? "s" : ""}`);
    if (members.length === 0) {
      lines.push("*No members*");
    } else {
      members.sort((a, b) => a.displayName.localeCompare(b.displayName));
      lines.push(members.map(m => `<@${m.id}>`).join(" "));
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function localSplitRoleChunks(text) {
  if (text.length <= 1900) return [text];
  const parts = [];
  const sections = text.split(/(?=^# )/m);
  let buf = "";
  for (const sec of sections) {
    if (buf.length + sec.length > 1900) {
      if (buf) { parts.push(buf.trim()); buf = ""; }
      if (sec.length > 1900) {
        const lines = sec.split("\n");
        let secBuf = "";
        for (const line of lines) {
          if ((secBuf + "\n" + line).length > 1900) {
            if (secBuf) parts.push(secBuf.trim());
            secBuf = line;
          } else {
            secBuf = secBuf ? secBuf + "\n" + line : line;
          }
        }
        if (secBuf) parts.push(secBuf.trim());
      } else {
        buf = sec;
      }
    } else {
      buf = buf ? buf + sec : sec;
    }
  }
  if (buf) parts.push(buf.trim());
  return parts;
}

async function rebuildTrackedMessage(guild, track) {
  if (!guild) return;
  const channel = guild.channels.cache.get(track.channelId);
  if (!channel) {
    // Channel was deleted — clean up
    await removeTrack(guild.id, track.channelId);
    return;
  }

  // Resolve roles (some may have been deleted)
  const roles = track.roleIds
    .map(id => guild.roles.cache.get(id))
    .filter(Boolean);

  if (roles.length === 0) {
    // All roles deleted — send a notice and remove tracking
    const notice = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("⛔ Tracking Stopped")
      .setDescription("All tracked roles have been deleted.")
      .setTimestamp();
    const firstMsg = await safe.orNull(channel.messages.fetch(track.messageIds[0]).catch(() => null), "roletracker fetch first msg");
    if (firstMsg) {
      await safe.edit(firstMsg, { content: "", embeds: [notice] }, "roletracker no-roles notice");
    }
    // Clean up extra messages
    for (let i = 1; i < track.messageIds.length; i++) {
      const msg = await safe.orNull(channel.messages.fetch(track.messageIds[i]).catch(() => null), "roletracker fetch extra msg");
      if (msg) await safe.delete(msg, "roletracker cleanup");
    }
    await removeTrack(guild.id, track.channelId);
    return;
  }

  // Build updated text
  const text = localBuildListRolesText(roles);
  const chunks = localSplitRoleChunks(text);

  const newMessageIds = [];

  // Edit first message (or send a new one if it was deleted)
  const firstMsg = await safe.orNull(channel.messages.fetch(track.messageIds[0]).catch(() => null), "roletracker fetch first");
  if (firstMsg) {
    await safe.edit(firstMsg, { content: chunks[0], allowedMentions: { parse: [] } }, "roletracker edit first");
    newMessageIds.push(firstMsg.id);
  } else if (chunks.length > 0) {
    // First message was deleted — send a new one
    const newMsg = await safe.send(channel, { content: chunks[0], allowedMentions: { parse: [] } }, "roletracker resend first");
    if (newMsg) newMessageIds.push(newMsg.id);
  }

  // Handle follow-up messages
  for (let i = 1; i < chunks.length; i++) {
    if (i < track.messageIds.length) {
      // Edit existing follow-up message
      const msg = await safe.orNull(channel.messages.fetch(track.messageIds[i]).catch(() => null), "roletracker fetch followup");
      if (msg) {
        await safe.edit(msg, { content: chunks[i], allowedMentions: { parse: [] } }, "roletracker edit followup");
        newMessageIds.push(msg.id);
      } else {
        // Was deleted — send new
        const newMsg = await safe.send(channel, { content: chunks[i], allowedMentions: { parse: [] } }, "roletracker resend followup");
        if (newMsg) newMessageIds.push(newMsg.id);
      }
    } else {
      // Need more messages than before
      const newMsg = await safe.send(channel, { content: chunks[i], allowedMentions: { parse: [] } }, "roletracker send extra");
      if (newMsg) newMessageIds.push(newMsg.id);
    }
  }

  // Delete any leftover extra messages (if the list got shorter)
  for (let i = chunks.length; i < track.messageIds.length; i++) {
    const msg = await safe.orNull(channel.messages.fetch(track.messageIds[i]).catch(() => null), "roletracker fetch stale");
    if (msg) await safe.delete(msg, "roletracker delete stale");
  }

  // Update stored message IDs
  if (newMessageIds.length > 0) {
    await updateMessageIds(guild.id, track.channelId, newMessageIds);
  }
}

module.exports = {
  load,
  getTracked,
  addTrack,
  removeTrack,
  handleRoleUpdate,
  rebuildTrackedMessage,
};
