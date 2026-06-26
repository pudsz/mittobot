// Economy engine — virtual currency, daily rewards, work, gambling, transfers.
// All balances are integers (no decimals). Top-level functions handle the core
// logic; the commands layer handles permission checks and formatted output.
const db = require("./db");

const DAILY_AMOUNT = 200;
const WORK_MIN = 50;
const WORK_MAX = 300;
const DAILY_COOLDOWN = 86400000; // 24h
const WORK_COOLDOWN = 3600000;   // 1h

// ─── Balance ────────────────────────────────────────────────────────────

async function getBalance(guildId, userId) {
  const row = await db.getEconomyUser(guildId, userId);
  return { balance: row?.balance || 0, bank: row?.bank || 0, total: (row?.balance || 0) + (row?.bank || 0) };
}

async function addBalance(guildId, userId, amount) {
  await db.upsertEconomyUser(guildId, userId, amount, 0);
}

async function setBalance(guildId, userId, balance, bank) {
  await db.setEconomyUser(guildId, userId, balance, bank, 0, 0);
}

// ─── Daily reward ────────────────────────────────────────────────────────

async function daily(guildId, userId) {
  const row = await db.getEconomyUser(guildId, userId);
  const now = Date.now();
  if (row && (now - row.last_daily) < DAILY_COOLDOWN) {
    const remaining = DAILY_COOLDOWN - (now - row.last_daily);
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    if (remaining < 60000) return { success: false, cooldown: `${secs}s`, amount: 0 };
    if (hours > 0) return { success: false, cooldown: `${hours}h ${mins}m`, amount: 0 };
    return { success: false, cooldown: `${mins}m ${secs}s`, amount: 0 };
  }
  await db.setEconomyUser(guildId, userId, (row?.balance || 0) + DAILY_AMOUNT, row?.bank || 0, now, row?.last_work || 0);
  return { success: true, amount: DAILY_AMOUNT, cooldown: null };
}

// ─── Work ────────────────────────────────────────────────────────────────

async function work(guildId, userId) {
  const row = await db.getEconomyUser(guildId, userId);
  const now = Date.now();
  if (row && (now - row.last_work) < WORK_COOLDOWN) {
    const remaining = WORK_COOLDOWN - (now - row.last_work);
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    return { success: false, cooldown: `${mins}m ${secs}s`, amount: 0 };
  }
  const amount = WORK_MIN + Math.floor(Math.random() * (WORK_MAX - WORK_MIN + 1));
  await db.setEconomyUser(guildId, userId, (row?.balance || 0) + amount, row?.bank || 0, row?.last_daily || 0, now);
  return { success: true, amount, cooldown: null };
}

// ─── Transfer ─────────────────────────────────────────────────────────────

async function pay(guildId, fromId, toId, amount) {
  if (fromId === toId) return { success: false, reason: "You can't pay yourself." };
  if (amount < 1) return { success: false, reason: "Amount must be at least 1." };
  const from = await db.getEconomyUser(guildId, fromId);
  if (!from || from.balance < amount) return { success: false, reason: "Insufficient balance." };
  const ok = await db.transferMoney(guildId, fromId, toId, amount);
  return ok ? { success: true, amount } : { success: false, reason: "Transfer failed." };
}

// ─── Gamble ───────────────────────────────────────────────────────────────

async function gamble(guildId, userId, amount) {
  if (amount < 1) return { success: false, reason: "You must bet at least 1 coin.", net: 0 };
  const row = await db.getEconomyUser(guildId, userId);
  if (!row || row.balance < amount) return { success: false, reason: "Insufficient balance.", net: 0 };

  const won = Math.random() < 0.45; // 45% chance — house edge
  const net = won ? amount : -amount;

  await db.upsertEconomyUser(guildId, userId, net, 0);
  return { success: true, won, net, newBalance: (row.balance || 0) + net };
}

// ─── Rob ───────────────────────────────────────────────────────────────────

async function rob(guildId, robberId, victimId) {
  if (robberId === victimId) return { success: false, reason: "You can't rob yourself.", amount: 0 };
  const victim = await db.getEconomyUser(guildId, victimId);
  if (!victim || victim.balance < 50) return { success: false, reason: "Target has too little to steal.", amount: 0 };

  // 35% success rate, steal 5-20% of their balance
  const success = Math.random() < 0.35;
  if (!success) {
    // Fine the robber 25% of attempted haul
    const fine = Math.min(Math.floor(victim.balance * 0.05), 200);
    await db.upsertEconomyUser(guildId, robberId, -fine, 0);
    return { success: false, reason: `You got caught and fined ${fine} coins!`, amount: -fine };
  }

  const stealAmount = Math.floor(victim.balance * (0.05 + Math.random() * 0.15));
  await db.transferMoney(guildId, victimId, robberId, stealAmount);
  return { success: true, amount: stealAmount };
}

// ─── Leaderboard ──────────────────────────────────────────────────────────

async function leaderboard(guildId, limit = 10) {
  return db.getEconomyLeaderboard(guildId, limit);
}

module.exports = {
  getBalance,
  addBalance,
  setBalance,
  daily,
  work,
  pay,
  gamble,
  rob,
  leaderboard,
  DAILY_AMOUNT,
  WORK_MIN,
  WORK_MAX,
};
