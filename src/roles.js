const fs   = require("fs");
const path = require("path");
const safe = require("./safe");
const db = require("./db");

const ROLES_FILE = path.join(__dirname, "..", "roles.json");

// ─── Per-guild config. Shape:
// { [guildId]: {
//     autoroles: [roleId, ...],                       // assigned on join
//     reactionRoles: { [messageId]: { [emojiKey]: roleId } },
//   } }
let store = {};

async function load() {
  try {
    store = {};
    const rows = await db.getAllRolesConfigs();
    for (const row of rows) {
      store[row.guild_id] = {
        autoroles: JSON.parse(row.autoroles || "[]"),
        reactionRoles: JSON.parse(row.reaction_roles || "{}"),
      };
    }
  } catch (e) {
    console.error("Failed to load roles config from db:", e);
    store = {};
  }
}
function save() {}

function getGuild(guildId) {
  const g = store[guildId] || {};
  return { autoroles: g.autoroles || [], reactionRoles: g.reactionRoles || {} };
}

// ─── Autoroles ───
function getAutoroles(guildId) { return getGuild(guildId).autoroles; }
function setAutoroles(guildId, roleIds) {
  const cleanIds = roleIds.filter(x => /^\d{17,20}$/.test(x));
  (store[guildId] ??= {}).autoroles = cleanIds;

  const g = getGuild(guildId);
  db.setRolesConfig(guildId, cleanIds, g.reactionRoles).catch(e => console.error("persist roles:", e.message));
  return getAutoroles(guildId);
}

// ─── Reaction roles ───
// Emoji key: unicode char for standard emoji, or the custom emoji id.
function emojiKey(emoji) { return emoji.id || emoji.name; }

function getReactionRoles(guildId) { return getGuild(guildId).reactionRoles; }

function addReactionRole(guildId, messageId, key, roleId) {
  const g = (store[guildId] ??= {});
  (g.reactionRoles ??= {});
  (g.reactionRoles[messageId] ??= {});
  g.reactionRoles[messageId][key] = roleId;

  db.setRolesConfig(guildId, g.autoroles || [], g.reactionRoles).catch(e => console.error("persist roles:", e.message));
}

function removeReactionRole(guildId, messageId, key) {
  const map = store[guildId]?.reactionRoles?.[messageId];
  if (!map) return false;
  delete map[key];
  if (Object.keys(map).length === 0) delete store[guildId].reactionRoles[messageId];

  const g = getGuild(guildId);
  db.setRolesConfig(guildId, g.autoroles || [], g.reactionRoles).catch(e => console.error("persist roles:", e.message));
  return true;
}

function roleForReaction(guildId, messageId, emoji) {
  return store[guildId]?.reactionRoles?.[messageId]?.[emojiKey(emoji)] || null;
}

// ─── Event handlers ───
async function onMemberAdd(member) {
  const roleIds = getAutoroles(member.guild.id);
  if (!roleIds.length) return;
  const me = member.guild.members.me;
  for (const id of roleIds) {
    const role = member.guild.roles.cache.get(id);
    if (role && role.position < me.roles.highest.position) {
      await safe.addRole(member, role, "Autorole on join", "autorole on join");
    }
  }
}

// reaction: a (possibly partial) MessageReaction; added: bool
async function onReaction(reaction, user, added) {
  if (user.bot) return;
  if (reaction.partial) { if (!await safe.orNull(reaction.fetch(), "fetch partial reaction for reaction role")) return; }
  const msg = reaction.message;
  const guild = msg.guild;
  if (!guild) return;
  const roleId = roleForReaction(guild.id, msg.id, reaction.emoji);
  if (!roleId) return;
  const member = await safe.orNull(guild.members.fetch(user.id), "fetch member for reaction role");
  if (!member) return;
  const role = guild.roles.cache.get(roleId);
  if (!role || role.position >= guild.members.me.roles.highest.position) return;
  if (added) await safe.addRole(member, role, "Reaction role", "reaction role add");
  else       await safe.removeRole(member, role, "Reaction role", "reaction role remove");
}

module.exports = {
  load, save, getGuild,
  getAutoroles, setAutoroles,
  getReactionRoles, addReactionRole, removeReactionRole, roleForReaction, emojiKey,
  onMemberAdd, onReaction,
  ROLES_FILE,
};
