const fs   = require("fs");
const path = require("path");

const ROLES_FILE = path.join(__dirname, "..", "roles.json");

// ─── Per-guild config. Shape:
// { [guildId]: {
//     autoroles: [roleId, ...],                       // assigned on join
//     reactionRoles: { [messageId]: { [emojiKey]: roleId } },
//   } }
let store = {};

function load() {
  try { if (fs.existsSync(ROLES_FILE)) store = JSON.parse(fs.readFileSync(ROLES_FILE, "utf8")); }
  catch { store = {}; }
}
function save() { fs.writeFileSync(ROLES_FILE, JSON.stringify(store, null, 2)); }

function getGuild(guildId) {
  const g = store[guildId] || {};
  return { autoroles: g.autoroles || [], reactionRoles: g.reactionRoles || {} };
}

// ─── Autoroles ───
function getAutoroles(guildId) { return getGuild(guildId).autoroles; }
function setAutoroles(guildId, roleIds) {
  (store[guildId] ??= {}).autoroles = roleIds.filter(x => /^\d{17,20}$/.test(x));
  save();
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
  save();
}

function removeReactionRole(guildId, messageId, key) {
  const map = store[guildId]?.reactionRoles?.[messageId];
  if (!map) return false;
  delete map[key];
  if (Object.keys(map).length === 0) delete store[guildId].reactionRoles[messageId];
  save();
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
      await member.roles.add(role, "Autorole on join").catch(() => null);
    }
  }
}

// reaction: a (possibly partial) MessageReaction; added: bool
async function onReaction(reaction, user, added) {
  if (user.bot) return;
  if (reaction.partial) { if (!await reaction.fetch().catch(() => null)) return; }
  const msg = reaction.message;
  const guild = msg.guild;
  if (!guild) return;
  const roleId = roleForReaction(guild.id, msg.id, reaction.emoji);
  if (!roleId) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  const role = guild.roles.cache.get(roleId);
  if (!role || role.position >= guild.members.me.roles.highest.position) return;
  if (added) await member.roles.add(role, "Reaction role").catch(() => null);
  else       await member.roles.remove(role, "Reaction role").catch(() => null);
}

module.exports = {
  load, save, getGuild,
  getAutoroles, setAutoroles,
  getReactionRoles, addReactionRole, removeReactionRole, roleForReaction, emojiKey,
  onMemberAdd, onReaction,
  ROLES_FILE,
};
