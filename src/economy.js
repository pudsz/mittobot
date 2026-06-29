// Economy engine — virtual currency, daily rewards, work, gambling, transfers.
// All balances are integers (no decimals). Top-level functions handle the core
// logic; the commands layer handles permission checks and formatted output.
const db = require("./db");

const DEFAULTS = {
  DAILY_AMOUNT: 200,
  WORK_MIN: 50,
  WORK_MAX: 300,
  DAILY_COOLDOWN: 86400000, // 24h
  WORK_COOLDOWN: 3600000,   // 1h
  INTEREST_RATE: 0.0,       // 0% bank interest per day
  TAX_RATE: 0.0,            // 0% transfer tax
  GAMBLE_ODDS: 0.45,        // 45% win chance
};

// Per-guild config cache — loaded from DB on first access
const configCache = new Map();

async function getConfig(guildId) {
  if (configCache.has(guildId)) return configCache.get(guildId);
  const row = await db.getEconomyConfig(guildId);
  const cfg = {
    dailyAmount: row?.daily_amount ?? DEFAULTS.DAILY_AMOUNT,
    workMin: row?.work_min ?? DEFAULTS.WORK_MIN,
    workMax: row?.work_max ?? DEFAULTS.WORK_MAX,
    dailyCooldown: row?.daily_cooldown ?? DEFAULTS.DAILY_COOLDOWN,
    workCooldown: row?.work_cooldown ?? DEFAULTS.WORK_COOLDOWN,
    interestRate: row?.interest_rate ?? DEFAULTS.INTEREST_RATE,
    taxRate: row?.tax_rate ?? DEFAULTS.TAX_RATE,
    gambleOdds: row?.gamble_odds ?? DEFAULTS.GAMBLE_ODDS,
  };
  configCache.set(guildId, cfg);
  return cfg;
}

function clearConfigCache(guildId) {
  configCache.delete(guildId);
}

async function saveConfig(guildId, patch) {
  const current = await getConfig(guildId);
  const merged = { ...current, ...patch };
  await db.setEconomyConfig(guildId, merged);
  configCache.delete(guildId);
  return getConfig(guildId);
}

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
  const cfg = await getConfig(guildId);
  return db.withTransaction(() => {
    const row = db.get("SELECT * FROM economy_users WHERE guild_id = ? AND user_id = ?", guildId, userId);
    const now = Date.now();
    if (row && (now - row.last_daily) < cfg.dailyCooldown) {
      const remaining = cfg.dailyCooldown - (now - row.last_daily);
      const hours = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      if (remaining < 60000) return { success: false, cooldown: `${secs}s`, amount: 0 };
      if (hours > 0) return { success: false, cooldown: `${hours}h ${mins}m`, amount: 0 };
      return { success: false, cooldown: `${mins}m ${secs}s`, amount: 0 };
    }
    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, last_daily, last_work)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = excluded.balance,
        bank = excluded.bank,
        last_daily = excluded.last_daily,
        last_work = excluded.last_work
    `, [guildId, userId, (row?.balance || 0) + cfg.dailyAmount, row?.bank || 0, now, row?.last_work || 0]);
    return { success: true, amount: cfg.dailyAmount, cooldown: null };
  });
}

// ─── Work ────────────────────────────────────────────────────────────────

async function work(guildId, userId) {
  const cfg = await getConfig(guildId);
  return db.withTransaction(() => {
    const row = db.get("SELECT * FROM economy_users WHERE guild_id = ? AND user_id = ?", guildId, userId);
    const now = Date.now();
    if (row && (now - row.last_work) < cfg.workCooldown) {
      const remaining = cfg.workCooldown - (now - row.last_work);
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      return { success: false, cooldown: `${mins}m ${secs}s`, amount: 0 };
    }
    const amount = cfg.workMin + Math.floor(Math.random() * (cfg.workMax - cfg.workMin + 1));
    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, last_daily, last_work)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = excluded.balance,
        bank = excluded.bank,
        last_daily = excluded.last_daily,
        last_work = excluded.last_work
    `, [guildId, userId, (row?.balance || 0) + amount, row?.bank || 0, row?.last_daily || 0, now]);
    return { success: true, amount, cooldown: null };
  });
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
  const cfg = await getConfig(guildId);
  if (amount < 1) return { success: false, reason: "You must bet at least 1 coin.", net: 0 };
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", guildId, userId);
    if (!row || row.balance < amount) return { success: false, reason: "Insufficient balance.", net: 0 };

    const won = Math.random() < cfg.gambleOdds;
    const net = won ? amount : -amount;

    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + ?,
        bank = bank + ?
    `, [guildId, userId, net, 0, net, 0]);
    return { success: true, won, net, newBalance: (row.balance || 0) + net };
  });
}

// ─── Rob ───────────────────────────────────────────────────────────────────

async function rob(guildId, robberId, victimId) {
  if (robberId === victimId) return { success: false, reason: "You can't rob yourself.", amount: 0 };
  const victim = await db.getEconomyUser(guildId, victimId);
  if (!victim || victim.balance < 50) return { success: false, reason: "Target has too little to steal.", amount: 0 };

  // 35% success rate, steal 5-20% of their balance
  const success = Math.random() < 0.35;
  if (!success) {
    const robber = await db.getEconomyUser(guildId, robberId);
    const robberBal = robber?.balance || 0;
    const fine = Math.min(Math.floor(victim.balance * 0.05), 200, robberBal);
    if (fine > 0) {
      await db.upsertEconomyUser(guildId, robberId, -fine, 0);
    }
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
  getConfig,
  saveConfig,
  clearConfigCache,
  DEFAULTS,
  // ── Shop ──────────────────────────────────────────────────
  getShopItems: (guildId) => db.getShopItems(guildId),
  addShopItem: (guildId, name, description, price, roleId, stock) => db.addShopItem(guildId, name, description, price, roleId, stock),
  updateShopItem: (id, patch) => db.updateShopItem(id, patch),
  deleteShopItem: (id) => db.deleteShopItem(id),
  // ── Stats & Reset ────────────────────────────────────────
  getStats: (guildId) => db.getEconomyStats(guildId),
  resetEconomy: (guildId) => {
    configCache.delete(guildId);
    return db.resetEconomy(guildId);
  },
};
