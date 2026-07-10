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
  // New game defaults
  BLACKJACK_MIN_BET: 10,
  BLACKJACK_MAX_BET: 10000,
  BLACKJACK_PAYOUT: 1.5,
  SLOTS_MIN_BET: 5,
  SLOTS_MAX_BET: 5000,
  SLOTS_WIN_ODDS: 0.30,
  SLOTS_JACKPOT_MULTIPLIER: 50,
  COINFLIP_MIN_BET: 1,
  COINFLIP_MAX_BET: 10000,
  HIGHLOW_MIN_BET: 10,
  HIGHLOW_MAX_BET: 10000,
  HIGHLOW_DICE_SIDES: 6,
  FISH_MIN_BET: 10,
  FISH_MAX_BET: 5000,
  MINE_MIN_BET: 10,
  MINE_MAX_BET: 5000,
  TRIVIA_STREAK_BONUS: 0.1,
  WORDLE_ENABLED: 1,
  WORDLE_STREAK_BONUS: 0.2,
  TYPERACE_MIN_PLAYERS: 2,
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
    blackjackMinBet: row?.blackjack_min_bet ?? DEFAULTS.BLACKJACK_MIN_BET,
    blackjackMaxBet: row?.blackjack_max_bet ?? DEFAULTS.BLACKJACK_MAX_BET,
    blackjackPayout: row?.blackjack_payout ?? DEFAULTS.BLACKJACK_PAYOUT,
    slotsMinBet: row?.slots_min_bet ?? DEFAULTS.SLOTS_MIN_BET,
    slotsMaxBet: row?.slots_max_bet ?? DEFAULTS.SLOTS_MAX_BET,
    slotsWinOdds: row?.slots_win_odds ?? DEFAULTS.SLOTS_WIN_ODDS,
    slotsJackpotMultiplier: row?.slots_jackpot_multiplier ?? DEFAULTS.SLOTS_JACKPOT_MULTIPLIER,
    coinflipMinBet: row?.coinflip_min_bet ?? DEFAULTS.COINFLIP_MIN_BET,
    coinflipMaxBet: row?.coinflip_max_bet ?? DEFAULTS.COINFLIP_MAX_BET,
    highlowMinBet: row?.highlow_min_bet ?? DEFAULTS.HIGHLOW_MIN_BET,
    highlowMaxBet: row?.highlow_max_bet ?? DEFAULTS.HIGHLOW_MAX_BET,
    highlowDiceSides: row?.highlow_dice_sides ?? DEFAULTS.HIGHLOW_DICE_SIDES,
    fishMinBet: row?.fish_min_bet ?? DEFAULTS.FISH_MIN_BET,
    fishMaxBet: row?.fish_max_bet ?? DEFAULTS.FISH_MAX_BET,
    mineMinBet: row?.mine_min_bet ?? DEFAULTS.MINE_MIN_BET,
    mineMaxBet: row?.mine_max_bet ?? DEFAULTS.MINE_MAX_BET,
    triviaStreakBonus: row?.trivia_streak_bonus ?? DEFAULTS.TRIVIA_STREAK_BONUS,
    wordleEnabled: row?.wordle_enabled ?? DEFAULTS.WORDLE_ENABLED,
    wordleStreakBonus: row?.wordle_streak_bonus ?? DEFAULTS.WORDLE_STREAK_BONUS,
    typeraceMinPlayers: row?.typerace_min_players ?? DEFAULTS.TYPERACE_MIN_PLAYERS,
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
    const row = db.get("SELECT * FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
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
    // Bank interest accrues each time the daily is claimed — interestRate is a
    // percent (0–100) applied to the current bank balance. Rounds down, floored
    // at 0. This gives interestRate a real consumer (it was dead config before).
    const bankBefore = row?.bank || 0;
    const interest = Math.floor(bankBefore * (cfg.interestRate / 100));
    const newBank = bankBefore + interest;
    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, last_daily, last_work)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = excluded.balance,
        bank = excluded.bank,
        last_daily = excluded.last_daily,
        last_work = excluded.last_work
    `, [guildId, userId, (row?.balance || 0) + cfg.dailyAmount, newBank, now, row?.last_work || 0]);
    return { success: true, amount: cfg.dailyAmount, interest, cooldown: null };
  });
}

// ─── Work ────────────────────────────────────────────────────────────────

async function work(guildId, userId) {
  const cfg = await getConfig(guildId);
  return db.withTransaction(() => {
    const row = db.get("SELECT * FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
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

// ─── Transfer ────────────────────────────────────────────────────────────

async function pay(guildId, fromId, toId, amount) {
  if (fromId === toId) return { success: false, reason: "You can't pay yourself." };
  if (amount < 1) return { success: false, reason: "Amount must be at least 1." };
  const cfg = await getConfig(guildId);
  // taxRate is a percent (0–100) skimmed from the transfer. The sender must
  // have enough to cover the full amount (tax is taken from the transferred
  // sum, so the recipient gets amount − tax). Gives taxRate a real consumer.
  const tax = Math.floor(amount * (cfg.taxRate / 100));
  const received = amount - tax;
  const from = await db.getEconomyUser(guildId, fromId);
  if (!from || from.balance < amount) return { success: false, reason: "Insufficient balance." };
  const ok = await db.transferMoney(guildId, fromId, toId, amount);
  if (!ok) return { success: false, reason: "Transfer failed." };
  // Burn the tax portion: transferMoney moved the full amount to the recipient,
  // so debit just the tax back from the recipient (the money supply shrinks).
  if (tax > 0) {
    await db.upsertEconomyUser(guildId, toId, -tax, 0);
  }
  return { success: true, amount, received, tax };
}

// ─── Bank (deposit / withdraw) ────────────────────────────────────────────

async function deposit(guildId, userId, amount) {
  if (amount < 1) return { success: false, reason: "Amount must be at least 1." };
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    if (!row || row.balance < amount) return { success: false, reason: "Insufficient wallet balance." };
    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance - ?,
        bank = bank + ?
    `, [guildId, userId, 0, amount, amount, amount]);
    return { success: true, amount, wallet: (row.balance || 0) - amount, bank: (row.bank || 0) + amount };
  });
}

async function withdraw(guildId, userId, amount) {
  if (amount < 1) return { success: false, reason: "Amount must be at least 1." };
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    if (!row || row.bank < amount) return { success: false, reason: "Insufficient bank balance." };
    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + ?,
        bank = bank - ?
    `, [guildId, userId, amount, 0, amount, amount]);
    return { success: true, amount, wallet: (row.balance || 0) + amount, bank: (row.bank || 0) - amount };
  });
}

// ─── Stats tracking ──────────────────────────────────────────────────────

async function updateGameStats(guildId, userId, { won, wagered, wonAmount, gameType }) {
  return db.withTransaction(() => {
    const row = db.get("SELECT games_played, games_won, games_lost, total_wagered, total_won, biggest_win FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    const played = (row?.games_played || 0) + 1;
    const wonCount = (row?.games_won || 0) + (won ? 1 : 0);
    const lostCount = (row?.games_lost || 0) + (won ? 0 : 1);
    const wageredTotal = (row?.total_wagered || 0) + wagered;
    const wonTotal = (row?.total_won || 0) + (won ? wonAmount : 0);
    const biggestWin = Math.max(row?.biggest_win || 0, won ? wonAmount : 0);
    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, games_played, games_won, games_lost, total_wagered, total_won, biggest_win)
      VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        games_played = excluded.games_played,
        games_won = excluded.games_won,
        games_lost = excluded.games_lost,
        total_wagered = excluded.total_wagered,
        total_won = excluded.total_won,
        biggest_win = excluded.biggest_win
    `, [guildId, userId, played, wonCount, lostCount, wageredTotal, wonTotal, biggestWin]);
  });
}

async function getGameStats(guildId, userId) {
  const row = await db.get("SELECT games_played, games_won, games_lost, total_wagered, total_won, biggest_win FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
  if (!row) return { games_played: 0, games_won: 0, games_lost: 0, total_wagered: 0, total_won: 0, biggest_win: 0, win_rate: 0 };
  return {
    ...row,
    win_rate: row.games_played > 0 ? ((row.games_won / row.games_played) * 100).toFixed(1) : 0
  };
}

// ─── Gamble ──────────────────────────────────────────────────────────────

async function gamble(guildId, userId, amount) {
  const cfg = await getConfig(guildId);
  if (amount < 1) return { success: false, reason: "You must bet at least 1 coin.", net: 0 };
  if (amount < cfg.slotsMinBet || amount > cfg.slotsMaxBet) return { success: false, reason: `Bet must be between ${cfg.slotsMinBet} and ${cfg.slotsMaxBet} coins.`, net: 0 };
  // NOTE: better-sqlite3 transaction callbacks must be synchronous (they may not
  // return a promise). updateGameStats runs as a nested savepoint synchronously.
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    if (!row || row.balance < amount) return { success: false, reason: "Insufficient balance.", net: 0 };

    const won = Math.random() < cfg.slotsWinOdds;
    const isJackpot = won && Math.random() < 0.02;
    const net = won ? (isJackpot ? amount * cfg.slotsJackpotMultiplier : amount) : -amount;

    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + ?,
        bank = bank + ?
    `, [guildId, userId, net, 0, net, 0]);

    updateGameStats(guildId, userId, { won, wagered: amount, wonAmount: won ? net : 0, gameType: "slots" });
    return { success: true, won, net, newBalance: (row.balance || 0) + net, isJackpot };
  });
}

// ─── Blackjack 🃏 ──────────────────────────────────────────────────────────

const SUITS = ["♠️", "♥️", "♣️", "♦️"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  if (card.rank === "A") return 11;
  return parseInt(card.rank, 10);
}

function handValue(hand) {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    value += cardValue(card);
    if (card.rank === "A") aces++;
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function formatHand(hand, hideFirst = false) {
  return hand.map((card, i) => hideFirst && i === 0 ? "🂠" : `${card.suit}${card.rank}`).join(" ");
}

async function blackjack(guildId, userId, amount, action, gameState) {
  const cfg = await getConfig(guildId);
  // Only validate the wager when starting a fresh game. Continuation actions
  // (hit/stand/double) come in with amount=0 and carry the bet in gameState.
  if (!gameState) {
    if (amount < 1) return { success: false, reason: "You must bet at least 1 coin." };
    if (amount < cfg.blackjackMinBet || amount > cfg.blackjackMaxBet) return { success: false, reason: `Bet must be between ${cfg.blackjackMinBet} and ${cfg.blackjackMaxBet} coins.` };
  }

  const state = gameState;
  let deck, playerHand, dealerHand, bet, doubled, finished, result, net, newBalance;

  // better-sqlite3 transaction callbacks must be synchronous. The bet is only
  // settled against the balance when the hand finishes (nothing is debited
  // mid-hand), so `net` is left undefined while the game is in progress.
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);

    if (!state) {
      // New game — require funds to cover the opening bet.
      if (!row || row.balance < amount) return { success: false, reason: "Insufficient balance." };
      deck = shuffleDeck(createDeck());
      playerHand = [deck.pop(), deck.pop()];
      dealerHand = [deck.pop(), deck.pop()];
      bet = amount;
      doubled = false;
      finished = false;

      // Natural blackjack settles immediately.
      if (isBlackjack(playerHand)) {
        if (isBlackjack(dealerHand)) {
          finished = true; result = "push"; net = 0;
        } else {
          finished = true; result = "blackjack"; net = Math.floor(bet * cfg.blackjackPayout);
        }
      }
      // Otherwise fall through: deal and wait for the player's action.
    } else {
      // Continue an existing hand.
      deck = state.deck;
      playerHand = state.playerHand;
      dealerHand = state.dealerHand;
      bet = state.bet;
      doubled = state.doubled;
      finished = state.finished;

      switch (action) {
        case "hit": {
          playerHand.push(deck.pop());
          if (handValue(playerHand) > 21) {
            finished = true;
            result = "bust";
            net = -bet;
          }
          break;
        }
        case "stand": {
          finished = true;
          while (handValue(dealerHand) < 17) dealerHand.push(deck.pop());
          const playerVal = handValue(playerHand);
          const dealerVal = handValue(dealerHand);
          if (dealerVal > 21 || playerVal > dealerVal) { result = "win"; net = bet; }
          else if (playerVal === dealerVal) { result = "push"; net = 0; }
          else { result = "lose"; net = -bet; }
          break;
        }
        case "double": {
          // Doubling commits a second bet, so the player must be able to cover
          // the full doubled exposure (nothing has been debited yet).
          if (doubled || playerHand.length !== 2 || !row || row.balance < bet * 2) {
            return { success: false, reason: "Cannot double down." };
          }
          doubled = true;
          bet *= 2;
          playerHand.push(deck.pop());
          finished = true;
          if (handValue(playerHand) > 21) {
            result = "bust";
            net = -bet;
          } else {
            while (handValue(dealerHand) < 17) dealerHand.push(deck.pop());
            const playerVal = handValue(playerHand);
            const dealerVal = handValue(dealerHand);
            if (dealerVal > 21 || playerVal > dealerVal) { result = "win"; net = bet; }
            else if (playerVal === dealerVal) { result = "push"; net = 0; }
            else { result = "lose"; net = -bet; }
          }
          break;
        }
        default:
          return { success: false, reason: "Invalid action. Use hit, stand, or double." };
      }
    }

    if (finished) {
      // Settle the hand against the balance (net is signed: +win / -loss / 0 push).
      db.run(`
        INSERT INTO economy_users (guild_id, user_id, balance, bank)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          balance = balance + ?,
          bank = bank + ?
      `, [guildId, userId, net, 0, net, 0]);
      newBalance = (row?.balance || 0) + net;
      updateGameStats(guildId, userId, { won: net > 0, wagered: bet, wonAmount: net > 0 ? net : 0, gameType: "blackjack" });
      return {
        success: true,
        finished: true,
        result,
        net,
        newBalance,
        playerHand,
        dealerHand,
        playerValue: handValue(playerHand),
        dealerValue: handValue(dealerHand),
        bet,
        blackjack: result === "blackjack",
      };
    }

    // Game continues. Return the FULL dealer hand — the presentation layer hides
    // the hole card until the hand finishes; persisting only one card here would
    // lose the dealer's second card between turns.
    return {
      success: true,
      finished: false,
      playerHand,
      dealerHand,
      playerValue: handValue(playerHand),
      canDouble: playerHand.length === 2 && !doubled && (row?.balance || 0) >= bet * 2,
      bet,
      deck,
      doubled,
    };
  });
}

// ─── Rob ─────────────────────────────────────────────────────────────────

async function rob(guildId, robberId, victimId) {
  if (robberId === victimId) return { success: false, reason: "You can't rob yourself.", amount: 0 };
  const victim = await db.getEconomyUser(guildId, victimId);
  if (!victim || victim.balance < 50) return { success: false, reason: "Target has too little to steal.", amount: 0 };

  const success = Math.random() < 0.35;
  if (!success) {
    const robber = await db.getEconomyUser(guildId, robberId);
    const robberBal = robber?.balance || 0;
    const fine = Math.min(Math.floor(victim.balance * 0.05), 200, robberBal);
    if (fine > 0) {
      await db.upsertEconomyUser(guildId, robberId, -fine, 0);
    }
    await updateGameStats(guildId, robberId, { won: false, wagered: fine, wonAmount: 0, gameType: "rob" });
    return { success: false, reason: `You got caught and fined ${fine} coins!`, amount: -fine };
  }

  const stealAmount = Math.floor(victim.balance * (0.05 + Math.random() * 0.15));
  await db.transferMoney(guildId, victimId, robberId, stealAmount);
  await updateGameStats(guildId, robberId, { won: true, wagered: 0, wonAmount: stealAmount, gameType: "rob" });
  await updateGameStats(guildId, victimId, { won: false, wagered: stealAmount, wonAmount: 0, gameType: "rob" });
  return { success: true, amount: stealAmount };
}

// ─── Coinflip 🪙 ──────────────────────────────────────────────────────────

async function coinflip(guildId, userId, side, amount) {
  const cfg = await getConfig(guildId);
  if (amount < 1) return { success: false, reason: "You must bet at least 1 coin." };
  if (amount < cfg.coinflipMinBet || amount > cfg.coinflipMaxBet) {
    return { success: false, reason: `Bet must be between ${cfg.coinflipMinBet} and ${cfg.coinflipMaxBet} coins.`, net: 0 };
  }
  side = String(side || "").toLowerCase();
  if (side !== "heads" && side !== "tails") {
    return { success: false, reason: "Choose heads or tails.", net: 0 };
  }
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    if (!row || row.balance < amount) return { success: false, reason: "Insufficient balance.", net: 0 };

    const flip = Math.random() < 0.5 ? "heads" : "tails";
    const won = flip === side;
    const net = won ? amount : -amount;

    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + ?,
        bank = bank + ?
    `, [guildId, userId, net, 0, net, 0]);

    updateGameStats(guildId, userId, { won, wagered: amount, wonAmount: won ? net : 0, gameType: "coinflip" });
    return { success: true, won, flip, net, newBalance: (row.balance || 0) + net };
  });
}

// ─── High/Low 🎲 ──────────────────────────────────────────────────────────
//
// A dice is rolled (default 6-sided). The player bets whether the NEXT roll
// will be higher or lower than the shown number, then both dice are revealed.

async function highlow(guildId, userId, guess, amount) {
  const cfg = await getConfig(guildId);
  if (amount < 1) return { success: false, reason: "You must bet at least 1 coin." };
  if (amount < cfg.highlowMinBet || amount > cfg.highlowMaxBet) {
    return { success: false, reason: `Bet must be between ${cfg.highlowMinBet} and ${cfg.highlowMaxBet} coins.`, net: 0 };
  }
  guess = String(guess || "").toLowerCase();
  if (guess !== "high" && guess !== "low") {
    return { success: false, reason: "Choose high or low.", net: 0 };
  }
  const sides = cfg.highlowDiceSides || 6;
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    if (!row || row.balance < amount) return { success: false, reason: "Insufficient balance.", net: 0 };

    const first = Math.floor(Math.random() * sides) + 1;
    const second = Math.floor(Math.random() * sides) + 1;
    let won = false;
    if (second > first) won = guess === "high";
    else if (second < first) won = guess === "low";
    // Equal rolls are a push (neither higher nor lower) — bet is returned.
    const net = second === first ? 0 : (won ? amount : -amount);

    if (net !== 0) {
      db.run(`
        INSERT INTO economy_users (guild_id, user_id, balance, bank)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          balance = balance + ?,
          bank = bank + ?
      `, [guildId, userId, net, 0, net, 0]);
    }

    updateGameStats(guildId, userId, { won, wagered: amount, wonAmount: won ? net : 0, gameType: "highlow" });
    return {
      success: true, won, push: second === first, first, second, guess,
      net, newBalance: (row.balance || 0) + net,
    };
  });
}

// ─── Fishing 🎣 ──────────────────────────────────────────────────────────

const FISH = {
  common: [
    { name: "Trout", emoji: "🐟", value: 20, weight: 50 },
    { name: "Bass", emoji: "🐟", value: 25, weight: 45 },
    { name: "Perch", emoji: "🐟", value: 15, weight: 55 },
    { name: "Catfish", emoji: "🐟", value: 30, weight: 40 },
    { name: "Carp", emoji: "🐟", value: 18, weight: 50 },
  ],
  uncommon: [
    { name: "Salmon", emoji: "🐠", value: 75, weight: 30 },
    { name: "Tuna", emoji: "🐠", value: 90, weight: 25 },
    { name: "Mackerel", emoji: "🐠", value: 65, weight: 35 },
    { name: "Swordfish", emoji: "🐠", value: 110, weight: 20 },
  ],
  rare: [
    { name: "Golden Trout", emoji: "🟡", value: 300, weight: 10 },
    { name: "Bluefin Tuna", emoji: "🔵", value: 400, weight: 8 },
    { name: "Marlin", emoji: "⚔️", value: 500, weight: 6 },
    { name: "Sturgeon", emoji: "🦈", value: 350, weight: 8 },
  ],
  epic: [
    { name: "Whale Shark", emoji: "🐋", value: 1500, weight: 3 },
    { name: "Giant Squid", emoji: "🦑", value: 2000, weight: 2 },
    { name: "Coelacanth", emoji: "🦎", value: 2500, weight: 1 },
  ],
  legendary: [
    { name: "MEGALODON", emoji: "🦈", value: 10000, weight: 1 },
    { name: "KRAKEN", emoji: "🐙", value: 15000, weight: 1 },
  ],
};

function pickFish() {
  const roll = Math.random() * 100;
  let cumulative = 0;
  const rarities = [
    { key: "common", threshold: 60 },
    { key: "uncommon", threshold: 85 },
    { key: "rare", threshold: 96 },
    { key: "epic", threshold: 99.5 },
    { key: "legendary", threshold: 100 },
  ];
  let chosenRarity = "common";
  for (const r of rarities) {
    if (roll <= r.threshold) { chosenRarity = r.key; break; }
  }
  const pool = FISH[chosenRarity];
  let totalWeight = pool.reduce((sum, f) => sum + f.weight, 0);
  let pick = Math.random() * totalWeight;
  for (const fish of pool) {
    pick -= fish.weight;
    if (pick <= 0) return { ...fish, rarity: chosenRarity };
  }
  return pool[0];
}

async function fish(guildId, userId) {
  const cfg = await getConfig(guildId);
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    const bet = cfg.fishMinBet;
    if (!row || row.balance < bet) return { success: false, reason: `You need at least ${bet} coins to go fishing!`, fish: null };

    const caught = pickFish();
    const net = caught.value - bet;

    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, fish_caught)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + ?,
        fish_caught = fish_caught + 1
    `, [guildId, userId, net, 0, net]);

    return { success: true, fish: caught, net, newBalance: (row.balance || 0) + net, bet };
  });
}

// ─── Mining ⛏️ ──────────────────────────────────────────────────────────

const ORES = {
  common: [
    { name: "Copper", emoji: "🟤", value: 10, weight: 50 },
    { name: "Tin", emoji: "⚪", value: 12, weight: 45 },
    { name: "Coal", emoji: "⬛", value: 8, weight: 55 },
    { name: "Iron", emoji: "🔘", value: 20, weight: 40 },
  ],
  uncommon: [
    { name: "Silver", emoji: "⚪", value: 60, weight: 30 },
    { name: "Gold", emoji: "🟡", value: 100, weight: 25 },
    { name: "Platinum", emoji: "🤍", value: 150, weight: 20 },
  ],
  rare: [
    { name: "Mithral", emoji: "💎", value: 400, weight: 10 },
    { name: "Orichalcum", emoji: "🟠", value: 500, weight: 8 },
    { name: "Moonstone", emoji: "🌙", value: 350, weight: 8 },
  ],
  epic: [
    { name: "Adamantite", emoji: "🔷", value: 1200, weight: 3 },
    { name: "Vibranium", emoji: "💜", value: 2000, weight: 2 },
  ],
  legendary: [
    { name: "DRAGONITE", emoji: "🐉", value: 8000, weight: 1 },
    { name: "CELESTIAL ORE", emoji: "✨", value: 12000, weight: 1 },
  ],
  caveIn: { name: "Cave-In!", emoji: "💥", value: 0, weight: 5 },
};

function pickOre() {
  const roll = Math.random() * 100;
  const rarities = [
    { key: "common", threshold: 55 },
    { key: "uncommon", threshold: 80 },
    { key: "rare", threshold: 94 },
    { key: "epic", threshold: 98.5 },
    { key: "legendary", threshold: 99.5 },
    { key: "caveIn", threshold: 100 },
  ];
  let chosenRarity = "common";
  for (const r of rarities) {
    if (roll <= r.threshold) { chosenRarity = r.key; break; }
  }
  if (chosenRarity === "caveIn") return { ...ORES.caveIn, rarity: "caveIn" };
  const pool = ORES[chosenRarity];
  let totalWeight = pool.reduce((sum, o) => sum + o.weight, 0);
  let pick = Math.random() * totalWeight;
  for (const ore of pool) {
    pick -= ore.weight;
    if (pick <= 0) return { ...ore, rarity: chosenRarity };
  }
  return pool[0];
}

async function mine(guildId, userId) {
  const cfg = await getConfig(guildId);
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank, mine_depth FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    const bet = cfg.mineMinBet;
    if (!row || row.balance < bet) return { success: false, reason: `You need at least ${bet} coins to go mining!`, ore: null };

    const found = pickOre();
    const isCaveIn = found.rarity === "caveIn";
    const net = isCaveIn ? -bet : found.value - bet;
    const newDepth = (row?.mine_depth || 0) + 1;

    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, mine_depth)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + ?,
        mine_depth = excluded.mine_depth
    `, [guildId, userId, net, 0, newDepth, net]);

    return { success: true, ore: found, net, newBalance: (row?.balance || 0) + net, bet, newDepth, isCaveIn };
  });
}

// ─── Trivia 🧠 ──────────────────────────────────────────────────────────

const TRIVIA_QUESTIONS = [
  { q: "What is the capital of France?", options: ["Paris", "London", "Berlin", "Madrid"], answer: 0, category: "geography" },
  { q: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"], answer: 1, category: "science" },
  { q: "What is 2 + 2?", options: ["3", "4", "5", "6"], answer: 1, category: "math" },
  { q: "Who wrote 'Romeo and Juliet'?", options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], answer: 1, category: "literature" },
  { q: "What is the largest ocean on Earth?", options: ["Atlantic", "Indian", "Pacific", "Arctic"], answer: 2, category: "geography" },
  { q: "How many continents are there?", options: ["5", "6", "7", "8"], answer: 2, category: "geography" },
  { q: "What is the chemical symbol for gold?", options: ["Go", "Gd", "Au", "Ag"], answer: 2, category: "science" },
  { q: "Which year did WWII end?", options: ["1943", "1944", "1945", "1946"], answer: 2, category: "history" },
  { q: "What is the fastest land animal?", options: ["Lion", "Cheetah", "Leopard", "Tiger"], answer: 1, category: "science" },
  { q: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], answer: 1, category: "math" },
  { q: "What is the currency of Japan?", options: ["Yuan", "Won", "Yen", "Ringgit"], answer: 2, category: "geography" },
  { q: "Who painted the Mona Lisa?", options: ["Vincent van Gogh", "Pablo Picasso", "Leonardo da Vinci", "Michelangelo"], answer: 2, category: "art" },
  { q: "What is the hardest natural substance on Earth?", options: ["Gold", "Iron", "Diamond", "Platinum"], answer: 2, category: "science" },
  { q: "How many planets are in our solar system?", options: ["7", "8", "9", "10"], answer: 1, category: "science" },
  { q: "What is the largest mammal?", options: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"], answer: 1, category: "science" },
];

function pickTrivia(category) {
  let pool = TRIVIA_QUESTIONS;
  if (category) pool = TRIVIA_QUESTIONS.filter(q => q.category === category);
  if (!pool.length) pool = TRIVIA_QUESTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function trivia(guildId, userId, category) {
  const cfg = await getConfig(guildId);
  const question = pickTrivia(category);
  return { question, category: question.category };
}

async function triviaAnswer(guildId, userId, questionIndex, selectedOption, streak) {
  const cfg = await getConfig(guildId);
  const question = TRIVIA_QUESTIONS[questionIndex % TRIVIA_QUESTIONS.length];
  const correct = selectedOption === question.answer;
  const baseReward = 50;
  const streakBonus = Math.floor(streak * cfg.triviaStreakBonus * baseReward);
  const reward = correct ? baseReward + streakBonus : 0;
  const net = reward;

  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank, trivia_streak FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    const newStreak = correct ? (row?.trivia_streak || 0) + 1 : 0;

    if (net !== 0) {
      db.run(`
        INSERT INTO economy_users (guild_id, user_id, balance, bank, trivia_streak)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          balance = balance + ?,
          trivia_streak = excluded.trivia_streak
      `, [guildId, userId, net, 0, newStreak, net]);
    } else {
      db.run(`
        INSERT INTO economy_users (guild_id, user_id, balance, bank, trivia_streak)
        VALUES (?, ?, 0, 0, 0)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          trivia_streak = 0
      `, [guildId, userId]);
    }

    if (correct) {
      updateGameStats(guildId, userId, { won: true, wagered: 0, wonAmount: reward, gameType: "trivia" });
    }
    return { correct, reward, newStreak, newBalance: (row?.balance || 0) + net, question };
  });
}

// ─── Wordle 🔤 ──────────────────────────────────────────────────────────

const WORDLE_WORDS = [
  "ABOUT", "ABOVE", "ABUSE", "ACTOR", "ACUTE", "ADMIT", "ADOPT", "ADULT", "AFTER", "AGAIN",
  "AGENT", "AGREE", "AHEAD", "ALARM", "ALBUM", "ALERT", "ALIEN", "ALIGN", "ALIKE", "ALIVE",
  "ALLOW", "ALONE", "ALONG", "ALTER", "AMONG", "ANGER", "ANGLE", "ANGRY", "APART", "APPLE",
  "APPLY", "ARENA", "ARGUE", "ARISE", "ARRAY", "ASIDE", "ASSET", "AUDIO", "AUDIT", "AVOID",
  "AWARD", "AWARE", "BADLY", "BAKER", "BASES", "BASIC", "BEACH", "BEGAN", "BEGIN", "BEING",
  "BELOW", "BENCH", "BILLY", "BIRTH", "BLACK", "BLAME", "BLANK", "BLIND", "BLOCK", "BLOOD",
  "BOARD", "BOOST", "BOOTH", "BOUND", "BRAIN", "BRAND", "BREAD", "BREAK", "BREED", "BRIEF",
  "BRING", "BROAD", "BROKE", "BROWN", "BUILD", "BUILT", "BUYER", "CABLE", "CALIF", "CARRY",
  "CATCH", "CAUSE", "CHAIN", "CHAIR", "CHAOS", "CHARM", "CHART", "CHASE", "CHEAP", "CHECK",
  "CHEST", "CHIEF", "CHILD", "CHINA", "CHOSE", "CIVIL", "CLAIM", "CLASS", "CLEAN", "CLEAR",
  "CLICK", "CLIMB", "CLOCK", "CLOSE", "CLOUD", "COACH", "COAST", "COULD", "COUNT", "COURT",
  "COVER", "CRAFT", "CRASH", "CREAM", "CRIME", "CROSS", "CROWD", "CROWN", "CRUDE", "CURVE",
  "CYCLE", "DAILY", "DANCE", "DATED", "DEALT", "DEATH", "DEBUT", "DELAY", "DEPTH", "DOING",
  "DOUBT", "DOZEN", "DRAFT", "DRAMA", "DRAWN", "DREAM", "DRESS", "DRILL", "DRINK", "DRIVE",
  "DROVE", "DYING", "EAGER", "EARLY", "EARTH", "EIGHT", "ELITE", "EMPTY", "ENEMY", "ENJOY",
  "ENTER", "ENTRY", "EQUAL", "ERROR", "EVENT", "EVERY", "EXACT", "EXIST", "EXTRA", "FAITH",
  "FALSE", "FAULT", "FIBER", "FIELD", "FIFTH", "FIFTY", "FIGHT", "FINAL", "FIRST", "FIXED",
  "FLASH", "FLEET", "FLOOR", "FLUID", "FOCUS", "FORCE", "FORTH", "FORTY", "FORUM", "FOUND",
  "FRAME", "FRANK", "FRAUD", "FRESH", "FRONT", "FRUIT", "FULLY", "FUNNY", "GIANT", "GIVEN",
  "GLASS", "GLOBE", "GOING", "GRACE", "GRADE", "GRAND", "GRANT", "GRASS", "GREAT", "GREEN",
  "GROSS", "GROUP", "GROWN", "GUARD", "GUESS", "GUEST", "GUIDE", "HAPPY", "HARRY", "HEART",
  "HEAVY", "HENCE", "HENRY", "HORSE", "HOTEL", "HOUSE", "HUMAN", "IDEAL", "IMAGE", "INDEX",
  "INNER", "INPUT", "ISSUE", "JAPAN", "JIMMY", "JOINT", "JONES", "JUDGE", "KNOWN", "LABEL",
  "LARGE", "LASER", "LATER", "LAUGH", "LAYER", "LEARN", "LEASE", "LEAST", "LEAVE", "LEGAL",
  "LEVEL", "LEWIS", "LIGHT", "LIMIT", "LINKS", "LIVES", "LOCAL", "LOGIC", "LOOSE", "LOWER",
  "LUCKY", "LUNCH", "LYING", "MAGIC", "MAJOR", "MAKER", "MARCH", "MARIA", "MATCH", "MAYBE",
  "MAYOR", "MEANT", "MEDIA", "METAL", "MIGHT", "MINOR", "MINUS", "MIXED", "MODEL", "MONEY",
  "MONTH", "MORAL", "MOTOR", "MOUNT", "MOUSE", "MOUTH", "MOVIE", "MUSIC", "NEEDS", "NEVER",
  "NEWLY", "NIGHT", "NOISE", "NORTH", "NOTED", "NOVEL", "NURSE", "OCCUR", "OCEAN", "OFFER",
  "OFTEN", "ORDER", "OTHER", "OUGHT", "PAINT", "PANEL", "PAPER", "PARTY", "PEACE", "PETER",
  "PHASE", "PHONE", "PHOTO", "PIANO", "PIECE", "PILOT", "PITCH", "PLACE", "PLAIN", "PLANE",
  "PLANT", "PLATE", "POINT", "POUND", "POWER", "PRESS", "PRICE", "PRIDE", "PRIME", "PRINT",
  "PRIOR", "PRIZE", "PROOF", "PROUD", "PROVE", "QUEEN", "QUICK", "QUIET", "QUITE", "RADIO",
  "RAISE", "RANGE", "RAPID", "RATIO", "REACH", "READY", "REFER", "RIGHT", "RIVAL", "RIVER",
  "ROBIN", "ROGER", "ROMAN", "ROUGH", "ROUND", "ROUTE", "ROYAL", "RURAL", "SCALE", "SCENE",
  "SCOPE", "SCORE", "SENSE", "SERVE", "SETUP", "SEVEN", "SHALL", "SHAPE", "SHARE", "SHARP",
  "SHEET", "SHELL", "SHIFT", "SHIRT", "SHOCK", "SHOOT", "SHORT", "SHOWN", "SIDES", "SIGHT",
  "SIMON", "SINCE", "SIXTH", "SIXTY", "SIZED", "SKILL", "SLEEP", "SLIDE", "SMALL", "SMART",
  "SMILE", "SMITH", "SMOKE", "SOLID", "SOLVE", "SORRY", "SOUND", "SOUTH", "SPACE", "SPARE",
  "SPEAK", "SPEED", "SPEND", "SPENT", "SPLIT", "SPOKE", "SPORT", "STAFF", "STAGE", "STAKE",
  "STAND", "START", "STATE", "STEAM", "STEEL", "STEEP", "STEVE", "STICK", "STILL", "STOCK",
  "STONE", "STOOD", "STORE", "STORM", "STORY", "STRIP", "STUCK", "STUDY", "STUFF", "STYLE",
  "SUGAR", "SUITE", "SUPER", "SWEET", "TABLE", "TAKEN", "TASTE", "TAXES", "TEACH", "TEETH",
  "TERRY", "TEXAS", "THANK", "THEIR", "THICK", "THING", "THINK", "THIRD", "THOSE", "THREE",
  "THREW", "THROW", "TIGHT", "TIMES", "TIRED", "TITLE", "TODAY", "TOPIC", "TOTAL", "TOUCH",
  "TOUGH", "TOWER", "TRACK", "TRADE", "TRAIN", "TREAT", "TREND", "TRIAL", "TRIBE", "TRICK",
  "TRIED", "TRIES", "TRUCK", "TRULY", "TRUNK", "TRUST", "TRUTH", "TWICE", "UNDER", "UNDUE",
  "UNION", "UNITY", "UNTIL", "UPPER", "UPSET", "URBAN", "USAGE", "USUAL", "VALID", "VALUE",
  "VIDEO", "VIRUS", "VISIT", "VITAL", "VOICE", "WASTE", "WATCH", "WATER", "WHEEL", "WHERE",
  "WHICH", "WHILE", "WHITE", "WHOLE", "WHOSE", "WOMAN", "WORLD", "WORRY", "WORSE", "WORST",
  "WORTH", "WOULD", "WRITE", "WRONG", "WROTE", "YIELD", "YOUNG", "YOUTH"
];

let dailyWordle = null;
let dailyWordleDate = null;

function getDailyWordle() {
  const today = new Date().toISOString().split("T")[0];
  if (dailyWordleDate !== today) {
    dailyWordleDate = today;
    dailyWordle = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];
  }
  return dailyWordle;
}

function checkWordle(guess, answer) {
  const result = [];
  const answerChars = answer.split("");
  const guessChars = guess.split("");
  
  // First pass: correct positions
  for (let i = 0; i < 5; i++) {
    if (guessChars[i] === answerChars[i]) {
      result[i] = "correct";
      answerChars[i] = null;
      guessChars[i] = null;
    }
  }
  // Second pass: wrong position
  for (let i = 0; i < 5; i++) {
    if (guessChars[i] !== null) {
      const idx = answerChars.indexOf(guessChars[i]);
      if (idx !== -1) {
        result[i] = "present";
        answerChars[idx] = null;
      } else {
        result[i] = "absent";
      }
    }
  }
  return result;
}

async function wordle(guildId, userId, guess) {
  const cfg = await getConfig(guildId);
  if (!cfg.wordleEnabled) return { success: false, reason: "Wordle is disabled on this server." };
  
  guess = guess.toUpperCase();
  if (guess.length !== 5 || !/^[A-Z]{5}$/.test(guess)) {
    return { success: false, reason: "Guess must be a 5-letter word." };
  }
  if (!WORDLE_WORDS.includes(guess)) {
    return { success: false, reason: "Not in word list." };
  }

  const answer = getDailyWordle();
  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank, wordle_streak FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    const result = checkWordle(guess, answer);
    const won = guess === answer;
    const streak = row?.wordle_streak || 0;
    const newStreak = won ? streak + 1 : 0;
    const baseReward = 100;
    const streakBonus = won ? Math.floor(newStreak * cfg.wordleStreakBonus * baseReward) : 0;
    const reward = won ? baseReward + streakBonus : 0;
    const net = reward;

    if (net !== 0) {
      db.run(`
        INSERT INTO economy_users (guild_id, user_id, balance, bank, wordle_streak)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          balance = balance + ?,
          wordle_streak = excluded.wordle_streak
      `, [guildId, userId, net, 0, newStreak, net]);
    } else {
      db.run(`
        INSERT INTO economy_users (guild_id, user_id, balance, bank, wordle_streak)
        VALUES (?, ?, 0, 0, 0)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          wordle_streak = 0
      `, [guildId, userId]);
    }

    if (won) {
      updateGameStats(guildId, userId, { won: true, wagered: 0, wonAmount: reward, gameType: "wordle" });
    }
    return { success: true, result, won, answer: won ? answer : null, reward, newStreak, newBalance: (row?.balance || 0) + net, attempts: 1 };
  });
}

// ─── Typing Race ⌨️ ─────────────────────────────────────────────────────

const TYPING_PASSAGES = [
  "The quick brown fox jumps over the lazy dog.",
  "Programming is the art of telling a computer what to do.",
  "Discord bots make servers more fun and interactive.",
  "Economy systems add progression to chat communities.",
  "Type fast and accurately to win the race.",
  "JavaScript runs on both client and server side.",
  "Databases store persistent data for applications.",
  "Open source software powers the modern web.",
  "Debugging is like being a detective in code.",
  "Clean code reads like well-written prose.",
];

async function typerace(guildId, userId, wpm) {
  const cfg = await getConfig(guildId);
  if (wpm < 10 || wpm > 200) return { success: false, reason: "WPM must be between 10 and 200." };

  return db.withTransaction(() => {
    const row = db.get("SELECT balance, bank, typerace_best_wpm FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    const baseReward = Math.floor(wpm * 2);
    const isRecord = wpm > (row?.typerace_best_wpm || 0);
    const recordBonus = isRecord ? Math.floor(baseReward * 0.5) : 0;
    const reward = baseReward + recordBonus;
    const net = reward;

    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, typerace_best_wpm)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + ?,
        typerace_best_wpm = CASE WHEN ? > typerace_best_wpm THEN ? ELSE typerace_best_wpm END
    `, [guildId, userId, net, 0, wpm, net, wpm, wpm]);

    updateGameStats(guildId, userId, { won: true, wagered: 0, wonAmount: reward, gameType: "typerace" });
    return { success: true, wpm, reward, isRecord, newBest: isRecord ? wpm : row?.typerace_best_wpm || 0, newBalance: (row?.balance || 0) + net };
  });
}

// ─── Leaderboard ────────────────────────────────────────────────────────

async function leaderboard(guildId, limit = 10) {
  return db.getEconomyLeaderboard(guildId, limit);
}

// ─── Shop ─────────────────────────────────────────────────────────────────
//
// `buyShopItem` settles a purchase atomically: it debits the wallet, decrements
// stock (when finite), and returns the item so the command layer can grant the
// role. Role granting is intentionally left to the caller — economy.js has no
// Discord client and must not touch the API directly (keeps it unit-testable).

async function buyShopItem(guildId, userId, itemId) {
  const id = parseInt(itemId, 10);
  if (!Number.isInteger(id)) return { success: false, reason: "Invalid shop item." };
  return db.withTransaction(() => {
    const item = db.get("SELECT * FROM economy_shop WHERE id = ? AND guild_id = ?", [id, guildId]);
    if (!item) return { success: false, reason: "That shop item doesn't exist here." };
    if (item.stock !== -1 && item.stock <= 0) return { success: false, reason: "That item is out of stock.", item };

    const row = db.get("SELECT balance FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
    if (!row || row.balance < item.price) {
      return { success: false, reason: `You need ${item.price} coins (you have ${row?.balance || 0}).`, item };
    }

    // Debit the buyer and decrement stock when finite (-1 means unlimited).
    db.run(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET balance = balance + ?
    `, [guildId, userId, -item.price, 0, -item.price]);
    if (item.stock !== -1) {
      db.run("UPDATE economy_shop SET stock = stock - 1 WHERE id = ?", [id]);
    }
    return {
      success: true,
      item,
      newBalance: (row.balance || 0) - item.price,
    };
  });
}

module.exports = {
  getBalance,
  addBalance,
  setBalance,
  daily,
  work,
  pay,
  deposit,
  withdraw,
  gamble,
  coinflip,
  highlow,
  rob,
  leaderboard,
  getConfig,
  saveConfig,
  clearConfigCache,
  updateGameStats,
  getGameStats,
  DEFAULTS,
  // ── Shop ──────────────────────────────────────────────────
  getShopItems: (guildId) => db.getShopItems(guildId),
  addShopItem: (guildId, name, description, price, roleId, stock) => db.addShopItem(guildId, name, description, price, roleId, stock),
  updateShopItem: (id, patch) => db.updateShopItem(id, patch),
  deleteShopItem: (id) => db.deleteShopItem(id),
  buyShopItem,
  // ── Stats & Reset ────────────────────────────────────────
  getStats: (guildId) => db.getEconomyStats(guildId),
  resetEconomy: (guildId) => {
    configCache.delete(guildId);
    return db.resetEconomy(guildId);
  },
  // ── New Games ────────────────────────────────────────────
  fish,
  mine,
  trivia,
  triviaAnswer,
  wordle,
  typerace,
  blackjack,
  FISH,
  ORES,
  TRIVIA_QUESTIONS,
  WORDLE_WORDS,
  TYPING_PASSAGES,
};