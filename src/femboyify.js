// ─── Femboyify nickname lock — persisted to SQLite ─────────────────────────
// When a user is femboyified ($femboyify @user on), their original nickname is
// saved. If they manually change their nickname (guildMemberUpdate), the bot
// reverts it immediately. Running $femboyify @user off removes the lock.

const { PermissionFlagsBits } = require("discord.js");
const db = require("./db");
const safe = require("./safe");

// In-memory cache: key `${guildId}:${userId}` -> { originalNick, timestamp }
const cache = new Map();

async function load() {
  cache.clear();
  try {
    const rows = await db.getAllFemboyifiedUsers();
    for (const row of rows) {
      cache.set(`${row.guild_id}:${row.user_id}`, {
        originalNick: row.original_nick,
        timestamp: Number(row.timestamp),
      });
    }
    console.log(`[femboyify] Loaded ${rows.length} femboyified user(s).`);
  } catch (err) {
    console.error("[femboyify] Failed to load:", err.message);
  }
}

function isFemboyified(guildId, userId) {
  return cache.has(`${guildId}:${userId}`);
}

function getOriginalNick(guildId, userId) {
  return cache.get(`${guildId}:${userId}`)?.originalNick || null;
}

async function setFemboyified(guildId, userId, originalNick) {
  const key = `${guildId}:${userId}`;
  cache.set(key, { originalNick, timestamp: Date.now() });
  await db.setFemboyifiedUser(guildId, userId, originalNick);
}

async function removeFemboyified(guildId, userId) {
  const key = `${guildId}:${userId}`;
  cache.delete(key);
  await db.removeFemboyifiedUser(guildId, userId);
}

// ─── guildMemberUpdate handler ─────────────────────────────────────────────
// If a femboyified user's nickname changes, revert it immediately.
function handleNicknameUpdate(oldMember, newMember) {
  if (!oldMember || !newMember) return;
  const guildId = newMember.guild.id;
  const userId = newMember.id;

  const entry = cache.get(`${guildId}:${userId}`);
  if (!entry) return;

  // No nickname change? skip.
  if (oldMember.nickname === newMember.nickname) return;

  // If the new nickname matches the stored original, someone ran "off" — skip.
  if (entry.originalNick && newMember.nickname === entry.originalNick) return;

  const me = newMember.guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) return;
  if (!newMember.manageable) return;

  // Rebuild the expected femboyified nickname and revert
  const expectedNick = `the cute ${entry.originalNick.replace(/^the cute | femboy$/gi, "").trim()} femboy`;
  safe.orNull(newMember.setNickname(expectedNick, "Femboyify nickname lock"), "femboyify revert");
}

// Build the femboyified nickname for a member
function buildFemboyNick(displayName) {
  const base = displayName.replace(/^the cute | femboy$/gi, "").trim();
  return `the cute ${base} femboy`;
}

module.exports = {
  load,
  isFemboyified,
  getOriginalNick,
  setFemboyified,
  removeFemboyified,
  handleNicknameUpdate,
  buildFemboyNick,
};
