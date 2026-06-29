// Persistent AI memory. In-memory cache is authoritative at runtime; writes
// persist per-row to SQLite (mirrors the src/data.js philosophy). Scopes:
//   - guild user memories   (guildId + userId) → facts about a specific member
//   - guild server memories (guildId + null)   → facts about the server
//   - DM memories           ("dm" + userId)    → private facts for one DM user
// Memories replace the previous concept of "facts" (renamed for terminology clarity).
const db = require("../db");

const MAX_CONTENT = 600;       // clamp a single memory
const MAX_PER_USER = 60;       // prune oldest beyond this, per (guild,user)
const MAX_PER_SERVER = 120;    // prune oldest server-scoped memories, per guild

let items = []; // [{ id, guildId, userId|null, content, createdAt }]

function now() {
  return Date.now();
}

function clamp(text) {
  return String(text || "").trim().slice(0, MAX_CONTENT);
}

async function load() {
  items = [];
  for (const row of await db.getAiMemories()) {
    items.push({
      id: Number(row.id),
      guildId: row.guild_id,
      userId: row.user_id || null,
      content: row.content,
      createdAt: Number(row.created_at),
    });
  }
}

// All memories tied to a specific user in a guild.
function forUser(guildId, userId) {
  return items.filter(m => m.guildId === guildId && m.userId === userId);
}

// All server-wide memories (no specific user) in a guild.
function serverMemories(guildId) {
  return items.filter(m => m.guildId === guildId && !m.userId);
}

// Everything visible in a guild (server memories + every user's memories).
function forGuild(guildId) {
  return items.filter(m => m.guildId === guildId);
}

// What to inject into the prompt for a given speaker: this user's memories plus
// server-wide memories, most-recent first, capped.
function recall(guildId, userId, limit = 25) {
  const mine = forUser(guildId, userId);
  const server = serverMemories(guildId);
  return [...mine, ...server]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

// Recall memories for a DM user. DMs intentionally do not read user_id=NULL
// "server" memories from the "dm" sentinel, so one DM cannot leak into another.
function recallDm(userId, limit = 15) {
  const mine = forUser("dm", userId);
  return mine.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

async function prune(guildId, userId) {
  const scope = userId
    ? items.filter(m => m.guildId === guildId && m.userId === userId)
    : serverMemories(guildId);
  const cap = userId ? MAX_PER_USER : MAX_PER_SERVER;
  if (scope.length <= cap) return;
  const excess = scope.sort((a, b) => a.createdAt - b.createdAt).slice(0, scope.length - cap);
  for (const old of excess) await forget(old.id);
}

async function add(guildId, userId, content) {
  const text = clamp(content);
  if (!guildId || !text) return null;
  const uid = userId || null;

  // Skip exact duplicates in the same scope.
  const dupe = items.find(m => m.guildId === guildId && m.userId === uid && m.content.toLowerCase() === text.toLowerCase());
  if (dupe) return dupe;

  const createdAt = now();
  let id;
  try {
    id = Number(await db.addAiMemory(guildId, uid, text, createdAt));
  } catch (e) {
    console.error("persist ai memory:", e.message);
    id = -createdAt; // synthetic id so the runtime cache still works this session
  }
  const mem = { id, guildId, userId: uid, content: text, createdAt };
  items.push(mem);
  prune(guildId, uid).catch(e => console.error("prune ai memory:", e.message));
  return mem;
}

async function forget(id) {
  const numId = Number(id);
  const idx = items.findIndex(m => m.id === numId);
  if (idx === -1) return false;
  items.splice(idx, 1);
  try {
    if (numId >= 0) await db.deleteAiMemory(numId);
  } catch (e) {
    console.error("delete ai memory:", e.message);
  }
  return true;
}

async function clear(guildId) {
  items = guildId ? items.filter(m => m.guildId !== guildId) : [];
  try {
    await db.clearAiMemories(guildId || null);
  } catch (e) {
    console.error("clear ai memory:", e.message);
  }
}

module.exports = {
  load, add, forget, clear,
  forUser, serverMemories, forGuild,
  recall, recallDm,
};
