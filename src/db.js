const Database = require("better-sqlite3");
const path = require("path");

// ─── Connection ────────────────────────────────────────────────────────────
// All persistent state lives in SQLite so the bot can scale vertically.
// For horizontal scaling, a proper client-server DB like Postgres would be needed.
// The database file is stored locally as ggboi.sqlite
const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "ggboi.sqlite");
const db = new Database(dbPath);

// Enable foreign key constraints
db.pragma("foreign_keys = ON");

// Helper to run queries with params
function query(text, params = []) {
  return db.prepare(text).all(params);
}

// Helper to run queries that return a single row
function get(text, params = []) {
  return db.prepare(text).get(params);
}

// Helper to run queries for INSERT/UPDATE/DELETE
function run(text, params = []) {
  return db.prepare(text).run(params);
}

// Run a set of statements inside a single transaction
async function withTransaction(fn) {
  return db.transaction(fn)();
}

// Safe JSON parsing with validation and fallback
function safeJsonParse(jsonString, fallback) {
  if (typeof jsonString !== "string") return fallback;
  try {
    const parsed = JSON.parse(jsonString);
    // Validate that parsed result is expected type (object or array)
    if (parsed === null || (typeof parsed !== "object" && !Array.isArray(parsed))) {
      console.warn("[db] JSON parse returned unexpected type, using fallback");
      return fallback;
    }
    return parsed;
  } catch (err) {
    console.warn("[db] JSON parse error:", err.message);
    return fallback;
  }
}

// ─── Schema ────────────────────────────────────────────────────────────────
// JSON blobs are stored as TEXT (the domain modules JSON.parse them on load),
// and booleans as INTEGER 0/1 to match the existing in-memory cache mapping.
function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS command_config (
      guild_id         TEXT,
      command          TEXT,
      enabled          INTEGER DEFAULT 1,
      permission       TEXT,
      allowed_roles    TEXT DEFAULT '[]',
      allowed_channels TEXT DEFAULT '[]',
      blocked_channels TEXT DEFAULT '[]',
      cooldown         INTEGER DEFAULT 0,
      settings         TEXT DEFAULT '{}',
      PRIMARY KEY (guild_id, command)
    );

    CREATE TABLE IF NOT EXISTS automod_config (
      guild_id         TEXT PRIMARY KEY,
      enabled          INTEGER DEFAULT 0,
      log_channel_id   TEXT,
      ignored_channels TEXT DEFAULT '[]',
      ignored_roles    TEXT DEFAULT '[]',
      rules            TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS greet_config (
      guild_id            TEXT PRIMARY KEY,
      welcome_enabled     INTEGER DEFAULT 0,
      welcome_channel_id  TEXT,
      welcome_message     TEXT,
      leave_enabled       INTEGER DEFAULT 0,
      leave_channel_id    TEXT,
      leave_message       TEXT,
      logs_enabled        INTEGER DEFAULT 0,
      logs_channel_id     TEXT,
      logs_member_events  INTEGER DEFAULT 1,
      logs_message_events INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS roles_config (
      guild_id       TEXT PRIMARY KEY,
      autoroles      TEXT DEFAULT '[]',
      reaction_roles TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS stickies (
      channel_id TEXT PRIMARY KEY,
      message_id TEXT,
      content    TEXT
    );

    CREATE TABLE IF NOT EXISTS warnings (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id  TEXT,
      user_id   TEXT,
      reason    TEXT,
      by        TEXT,
      timestamp BIGINT,
      severity  INTEGER DEFAULT 1,
      points    INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS mod_notes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id  TEXT,
      user_id   TEXT,
      content   TEXT,
      by        TEXT,
      timestamp BIGINT
    );

    CREATE TABLE IF NOT EXISTS probation (
      guild_id      TEXT,
      user_id       TEXT,
      role_id       TEXT,
      expires_at    BIGINT,
      warning_count INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS moderation_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id  TEXT,
      user_id   TEXT,
      mod_id    TEXT,
      action    TEXT,
      reason    TEXT,
      details   TEXT,
      proof     TEXT,
      timestamp BIGINT
    );

    CREATE TABLE IF NOT EXISTS dm_templates (
      guild_id  TEXT,
      action    TEXT,
      message   TEXT,
      enabled   INTEGER DEFAULT 1,
      PRIMARY KEY (guild_id, action)
    );

    CREATE TABLE IF NOT EXISTS automod_extended (
      guild_id      TEXT PRIMARY KEY,
      link_blacklist TEXT DEFAULT '[]',
      link_whitelist TEXT DEFAULT '[]',
      link_action    TEXT DEFAULT 'delete',
      repeated_text  INTEGER DEFAULT 0,
      repeated_text_count INTEGER DEFAULT 3,
      repeated_text_action TEXT DEFAULT 'delete',
      emoji_spam     INTEGER DEFAULT 0,
      emoji_max      INTEGER DEFAULT 5,
      emoji_action   TEXT DEFAULT 'delete',
      blocked_emojis_enabled INTEGER DEFAULT 0,
      blocked_emojis TEXT DEFAULT '[]',
      blocked_emojis_action TEXT DEFAULT 'delete',
      blocked_reaction_emojis_enabled INTEGER DEFAULT 0,
      blocked_reaction_emojis TEXT DEFAULT '[]',
      blocked_reaction_action TEXT DEFAULT 'delete',
      zalgo_enabled  INTEGER DEFAULT 0,
      zalgo_action   TEXT DEFAULT 'delete',
      regex_enabled     INTEGER DEFAULT 0,
      regex_patterns    TEXT DEFAULT '[]',
      regex_action      TEXT DEFAULT 'delete',
      attachments_enabled        INTEGER DEFAULT 0,
      attachments_blocked_exts   TEXT DEFAULT '[]',
      attachments_max_size_mb    REAL DEFAULT 0,
      attachments_action         TEXT DEFAULT 'delete',
      newlines_enabled INTEGER DEFAULT 0,
      newlines_max     INTEGER DEFAULT 10,
      newlines_action  TEXT DEFAULT 'delete',
      mentions_roles_enabled INTEGER DEFAULT 0,
      mentions_roles_max    INTEGER DEFAULT 3,
      mentions_roles_action TEXT DEFAULT 'delete'
    );

    CREATE TABLE IF NOT EXISTS reaction_logs (
      guild_id   TEXT PRIMARY KEY,
      channel_id TEXT
    );

    CREATE TABLE IF NOT EXISTS afk_users (
      user_id  TEXT PRIMARY KEY,
      reason   TEXT,
      since    BIGINT,
      guild_id TEXT
    );

    CREATE TABLE IF NOT EXISTS custom_roles (
      guild_id   TEXT,
      user_id    TEXT,
      role_id    TEXT,
      style      TEXT,
      color      TEXT,
      name       TEXT,
      has_icon   INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dangerzone_config (
      guild_id TEXT PRIMARY KEY,
      channels TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS theme_config (
      guild_id TEXT PRIMARY KEY,
      config   TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS antiraid_config (
      guild_id TEXT PRIMARY KEY,
      config   TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS automod_stats (
      guild_id TEXT,
      rule     TEXT,
      day      TEXT,
      count    INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, rule, day)
    );

    CREATE TABLE IF NOT EXISTS leveling_users (
      guild_id     TEXT,
      user_id      TEXT,
      xp           INTEGER DEFAULT 0,
      level        INTEGER DEFAULT 0,
      last_xp_at   INTEGER DEFAULT 0,
      messages     INTEGER DEFAULT 0,
      voice_minutes INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS leveling_xp ON leveling_users (guild_id, xp DESC);

    CREATE TABLE IF NOT EXISTS leveling_config (
      guild_id TEXT PRIMARY KEY,
      config   TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS ai_memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT,
      user_id    TEXT,
      content    TEXT,
      created_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS ai_memories_scope ON ai_memories (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS autoexec_rules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT,
      trigger_event TEXT,
      conditions    TEXT DEFAULT '{}',
      actions       TEXT DEFAULT '[]',
      enabled       INTEGER DEFAULT 1,
      priority      INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS autoexec_guild ON autoexec_rules (guild_id, priority);

    CREATE TABLE IF NOT EXISTS tracked_roles (
      guild_id    TEXT,
      channel_id  TEXT,
      message_ids TEXT DEFAULT '[]',
      role_ids    TEXT DEFAULT '[]',
      created_at  BIGINT
    );
    CREATE INDEX IF NOT EXISTS tracked_roles_guild ON tracked_roles (guild_id);

    CREATE TABLE IF NOT EXISTS femboyified_users (
      guild_id      TEXT,
      user_id       TEXT,
      original_nick TEXT,
      timestamp     BIGINT,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tempbans (
      guild_id   TEXT,
      user_id    TEXT,
      expires_at BIGINT,
      mod_id     TEXT,
      reason     TEXT,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS ai_analytics (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT,
      user_id    TEXT,
      provider   TEXT,
      model      TEXT,
      tokens     INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      success    INTEGER DEFAULT 1,
      error      TEXT,
      timestamp  BIGINT
    );
    CREATE INDEX IF NOT EXISTS ai_analytics_ts ON ai_analytics (timestamp);

    CREATE TABLE IF NOT EXISTS ai_personalities (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      name    TEXT NOT NULL,
      prompt  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      channel_id    TEXT NOT NULL,
      content       TEXT NOT NULL,
      embed_json    TEXT,
      scheduled_at  TEXT NOT NULL,
      recurrence    TEXT,
      enabled       INTEGER DEFAULT 1,
      created_by    TEXT,
      last_sent_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS sched_guild ON scheduled_messages (guild_id, enabled);

    CREATE TABLE IF NOT EXISTS server_backups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      created_by  TEXT
    );
    CREATE INDEX IF NOT EXISTS backup_guild ON server_backups (guild_id);

    CREATE TABLE IF NOT EXISTS economy_users (
      guild_id       TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      balance        INTEGER DEFAULT 0,
      bank           INTEGER DEFAULT 0,
      last_daily     BIGINT DEFAULT 0,
      last_work      BIGINT DEFAULT 0,
      games_played   INTEGER DEFAULT 0,
      games_won      INTEGER DEFAULT 0,
      games_lost     INTEGER DEFAULT 0,
      total_wagered  INTEGER DEFAULT 0,
      total_won      INTEGER DEFAULT 0,
      biggest_win    INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS economy_config (
      guild_id        TEXT PRIMARY KEY,
      daily_amount    INTEGER DEFAULT 200,
      work_min        INTEGER DEFAULT 50,
      work_max        INTEGER DEFAULT 300,
      daily_cooldown  BIGINT DEFAULT 86400000,
      work_cooldown   BIGINT DEFAULT 3600000,
      interest_rate   REAL DEFAULT 0.0,
      tax_rate        REAL DEFAULT 0.0,
      gamble_odds     REAL DEFAULT 0.45,
      -- New game configs
      blackjack_min_bet     INTEGER DEFAULT 10,
      blackjack_max_bet     INTEGER DEFAULT 10000,
      blackjack_payout      REAL DEFAULT 1.5,
      slots_min_bet         INTEGER DEFAULT 5,
      slots_max_bet         INTEGER DEFAULT 5000,
      slots_win_odds        REAL DEFAULT 0.30,
      slots_jackpot_multiplier INTEGER DEFAULT 50,
      coinflip_min_bet      INTEGER DEFAULT 1,
      coinflip_max_bet      INTEGER DEFAULT 10000,
      highlow_min_bet       INTEGER DEFAULT 10,
      highlow_max_bet       INTEGER DEFAULT 10000,
      highlow_dice_sides    INTEGER DEFAULT 6,
      -- Skill games
      fish_min_bet          INTEGER DEFAULT 10,
      fish_max_bet          INTEGER DEFAULT 5000,
      mine_min_bet          INTEGER DEFAULT 10,
      mine_max_bet          INTEGER DEFAULT 5000,
      trivia_streak_bonus   REAL DEFAULT 0.1,
      wordle_enabled        INTEGER DEFAULT 1,
      wordle_streak_bonus   REAL DEFAULT 0.2,
      typerace_min_players  INTEGER DEFAULT 2
    );

    CREATE TABLE IF NOT EXISTS economy_shop (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      price       INTEGER NOT NULL,
      role_id     TEXT,
      stock       INTEGER DEFAULT -1
    );
    CREATE INDEX IF NOT EXISTS eco_shop_guild ON economy_shop (guild_id);

    CREATE TABLE IF NOT EXISTS embed_templates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      embed_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS embed_templates_guild ON embed_templates (guild_id);

    CREATE TABLE IF NOT EXISTS alpha_codes (
      code       TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      used_by    TEXT,
      used_at    BIGINT
    );

    CREATE TABLE IF NOT EXISTS alpha_users (
      user_id           TEXT NOT NULL,
      guild_id          TEXT NOT NULL,
      activated_at      BIGINT NOT NULL,
      code_used         TEXT,
      telemetry_opt_out INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS alpha_telemetry (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT,
      guild_id    TEXT,
      tool_name   TEXT NOT NULL,
      success     INTEGER DEFAULT 1,
      error_msg   TEXT,
      duration_ms INTEGER DEFAULT 0,
      timestamp   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS alpha_telemetry_ts ON alpha_telemetry (timestamp);

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL DEFAULT 'private',  -- 'global' (per-channel) | 'private' (per-user DM)
      guild_id   TEXT,                              -- NULL for private DMs; real guildId for global channel threads
      channel_id TEXT,                              -- channel id for global; NULL for private
      user_id    TEXT,                              -- private thread owner / legacy guild trigger user
      speaker_user_id TEXT,                         -- actual guild-channel speaker on user turns
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      timestamp  BIGINT NOT NULL
    );
    -- Note: ai_conversations indexes are created in the migration section below,
    -- AFTER ALTER TABLE statements have added scope/channel_id to legacy DBs.

    -- Layered system prompts: default → guild → channel. Most-specific wins.
    -- target_id='*' is the sentinel for the single default row (NULL can't be a PK).
    -- target_id='*' is the sentinel for the single default row.
    CREATE TABLE IF NOT EXISTS ai_prompts (
      scope      TEXT NOT NULL,    -- 'default' | 'guild' | 'channel'
      target_id  TEXT NOT NULL,    -- '*' for default, guildId for guild, channelId for channel
      prompt     TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (scope, target_id)
    );
  `);

  // Migrations for columns added after initial table creation
  try { db.exec("ALTER TABLE moderation_log ADD COLUMN proof TEXT"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE ai_conversations ADD COLUMN guild_id TEXT DEFAULT 'dm'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE ai_conversations ADD COLUMN scope TEXT DEFAULT 'private'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE ai_conversations ADD COLUMN channel_id TEXT"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE ai_conversations ADD COLUMN user_id_dm TEXT"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE ai_conversations ADD COLUMN speaker_user_id TEXT"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN link_action TEXT DEFAULT 'delete'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN repeated_text_action TEXT DEFAULT 'delete'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN emoji_action TEXT DEFAULT 'delete'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN blocked_emojis_enabled INTEGER DEFAULT 0"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN blocked_emojis TEXT DEFAULT '[]'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN blocked_emojis_action TEXT DEFAULT 'delete'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN blocked_reaction_emojis_enabled INTEGER DEFAULT 0"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN blocked_reaction_emojis TEXT DEFAULT '[]'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN blocked_reaction_action TEXT DEFAULT 'delete'"); } catch { /* column already exists */ }
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN zalgo_action TEXT DEFAULT 'delete'"); } catch { /* column already exists */ }
  // §3.1 new rule types
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN regex_enabled INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN regex_patterns TEXT DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN regex_action TEXT DEFAULT 'delete'"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN attachments_enabled INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN attachments_blocked_exts TEXT DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN attachments_max_size_mb REAL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN attachments_action TEXT DEFAULT 'delete'"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN newlines_enabled INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN newlines_max INTEGER DEFAULT 10"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN newlines_action TEXT DEFAULT 'delete'"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN mentions_roles_enabled INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN mentions_roles_max INTEGER DEFAULT 3"); } catch {}
  try { db.exec("ALTER TABLE automod_extended ADD COLUMN mentions_roles_action TEXT DEFAULT 'delete'"); } catch {}
  // Economy user stats columns
  try { db.exec("ALTER TABLE economy_users ADD COLUMN games_played INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN games_won INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN games_lost INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN total_wagered INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN total_won INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN biggest_win INTEGER DEFAULT 0"); } catch {}
  // Economy config new game columns
  try { db.exec("ALTER TABLE economy_config ADD COLUMN blackjack_min_bet INTEGER DEFAULT 10"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN blackjack_max_bet INTEGER DEFAULT 10000"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN blackjack_payout REAL DEFAULT 1.5"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN slots_min_bet INTEGER DEFAULT 5"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN slots_max_bet INTEGER DEFAULT 5000"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN slots_win_odds REAL DEFAULT 0.30"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN slots_jackpot_multiplier INTEGER DEFAULT 50"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN coinflip_min_bet INTEGER DEFAULT 1"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN coinflip_max_bet INTEGER DEFAULT 10000"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN highlow_min_bet INTEGER DEFAULT 10"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN highlow_max_bet INTEGER DEFAULT 10000"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN highlow_dice_sides INTEGER DEFAULT 6"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN fish_min_bet INTEGER DEFAULT 10"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN fish_max_bet INTEGER DEFAULT 5000"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN mine_min_bet INTEGER DEFAULT 10"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN mine_max_bet INTEGER DEFAULT 5000"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN trivia_streak_bonus REAL DEFAULT 0.1"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN wordle_enabled INTEGER DEFAULT 1"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN wordle_streak_bonus REAL DEFAULT 0.2"); } catch {}
  try { db.exec("ALTER TABLE economy_config ADD COLUMN typerace_min_players INTEGER DEFAULT 2"); } catch {}
  // Economy user stats columns for new games
  try { db.exec("ALTER TABLE economy_users ADD COLUMN wordle_streak INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN typerace_best_wpm INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN fish_caught INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN mine_depth INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE economy_users ADD COLUMN trivia_streak INTEGER DEFAULT 0"); } catch {}
  // Custom roles — persist the full role object (not just role_id) so style,
  // color, name, and icon survive a restart. Pre-existing DBs only had role_id.
  try { db.exec("ALTER TABLE custom_roles ADD COLUMN style TEXT"); } catch {}
  try { db.exec("ALTER TABLE custom_roles ADD COLUMN color TEXT"); } catch {}
  try { db.exec("ALTER TABLE custom_roles ADD COLUMN name TEXT"); } catch {}
  try { db.exec("ALTER TABLE custom_roles ADD COLUMN has_icon INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE custom_roles ADD COLUMN created_at INTEGER DEFAULT 0"); } catch {}
  // (typo column retained for back-compat; safe to ignore)
  // Normalize legacy rows: guild_id='dm' sentinel rows become proper private DMs (guild_id=NULL).
  try { db.exec("UPDATE ai_conversations SET scope='private', guild_id=NULL, channel_id=NULL WHERE guild_id='dm'"); } catch {}
  // Older per-(guild, user) rows: only normalize rows with missing scope.
  // New rows are written with correct scope='global' or scope='private',
  // so never touch scope='private' rows — that would silently corrupt any
  // guild-scoped data that happens to be mislabelled.
  try { db.exec("UPDATE ai_conversations SET scope='private', guild_id=NULL, channel_id=NULL WHERE scope IS NULL OR scope = ''"); } catch {}
  // Newer code distinguishes the thread owner/legacy trigger user (`user_id`)
  // from the actual speaker (`speaker_user_id`) in shared guild channels.
  try { db.exec("UPDATE ai_conversations SET speaker_user_id=user_id WHERE scope='global' AND role='user' AND speaker_user_id IS NULL"); } catch {}
  // Add the new scope index if missing (idempotent).
  try { db.exec("CREATE INDEX IF NOT EXISTS ai_convo_scope ON ai_conversations (scope, guild_id, channel_id, user_id, timestamp)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS ai_convo_user ON ai_conversations (guild_id, user_id, timestamp)"); } catch {}

  console.log("[db] SQLite schema ready.");
}

// ── Global settings ───────────────────────────────────────────────────────
async function getGlobalSettings() {
  const rows = query("SELECT key, value FROM global_settings");
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

async function setGlobalSetting(key, val) {
  db.prepare(`
    INSERT INTO global_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(val));
}

// ── Command config ───────────────────────────────────────────────────────
async function getAllCommandConfigs() {
  return query("SELECT * FROM command_config");
}

async function setCommandConfig(guildId, command, cfg) {
  db.prepare(`
    INSERT INTO command_config
       (guild_id, command, enabled, permission, allowed_roles, allowed_channels, blocked_channels, cooldown, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, command) DO UPDATE SET
      enabled = excluded.enabled,
      permission = excluded.permission,
      allowed_roles = excluded.allowed_roles,
      allowed_channels = excluded.allowed_channels,
      blocked_channels = excluded.blocked_channels,
      cooldown = excluded.cooldown,
      settings = excluded.settings
  `).run(
    guildId,
    command,
    cfg.enabled ? 1 : 0,
    cfg.permission,
    JSON.stringify(cfg.allowedRoles || []),
    JSON.stringify(cfg.allowedChannels || []),
    JSON.stringify(cfg.blockedChannels || []),
    cfg.cooldown || 0,
    JSON.stringify(cfg.settings || {})
  );
}

async function deleteCommandConfig(guildId, command) {
  db.prepare("DELETE FROM command_config WHERE guild_id = ? AND command = ?").run(guildId, command);
}

// ── Automod ───────────────────────────────────────────────────────────────
async function getAllAutomodConfigs() {
  return query("SELECT * FROM automod_config");
}

async function setAutomodConfig(guildId, cfg) {
  db.prepare(`
    INSERT INTO automod_config (guild_id, enabled, log_channel_id, ignored_channels, ignored_roles, rules)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      enabled = excluded.enabled,
      log_channel_id = excluded.log_channel_id,
      ignored_channels = excluded.ignored_channels,
      ignored_roles = excluded.ignored_roles,
      rules = excluded.rules
  `).run(
    guildId,
    cfg.enabled ? 1 : 0,
    cfg.logChannelId || null,
    JSON.stringify(cfg.ignoredChannels || []),
    JSON.stringify(cfg.ignoredRoles || []),
    JSON.stringify(cfg.rules || {})
  );
}

// ── Greet ───────────────────────────────────────────────────────────────
async function getAllGreetConfigs() {
  return query("SELECT * FROM greet_config");
}

async function setGreetConfig(guildId, cfg) {
  db.prepare(`
    INSERT INTO greet_config
       (guild_id, welcome_enabled, welcome_channel_id, welcome_message,
        leave_enabled, leave_channel_id, leave_message,
        logs_enabled, logs_channel_id, logs_member_events, logs_message_events)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      welcome_enabled = excluded.welcome_enabled,
      welcome_channel_id = excluded.welcome_channel_id,
      welcome_message = excluded.welcome_message,
      leave_enabled = excluded.leave_enabled,
      leave_channel_id = excluded.leave_channel_id,
      leave_message = excluded.leave_message,
      logs_enabled = excluded.logs_enabled,
      logs_channel_id = excluded.logs_channel_id,
      logs_member_events = excluded.logs_member_events,
      logs_message_events = excluded.logs_message_events
  `).run(
    guildId,
    cfg.welcome_enabled ? 1 : 0,
    cfg.welcome_channel_id || null,
    cfg.welcome_message || null,
    cfg.leave_enabled ? 1 : 0,
    cfg.leave_channel_id || null,
    cfg.leave_message || null,
    cfg.logs_enabled ? 1 : 0,
    cfg.logs_channel_id || null,
    cfg.logs_member_events ? 1 : 0,
    cfg.logs_message_events ? 1 : 0
  );
}

// ── Roles ───────────────────────────────────────────────────────────────
async function getAllRolesConfigs() {
  return query("SELECT * FROM roles_config");
}

async function setRolesConfig(guildId, autoroles, reactionRoles) {
  db.prepare(`
    INSERT INTO roles_config (guild_id, autoroles, reaction_roles)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      autoroles = excluded.autoroles,
      reaction_roles = excluded.reaction_roles
  `).run(guildId, JSON.stringify(autoroles || []), JSON.stringify(reactionRoles || {}));
}

// ── Warnings ─────────────────────────────────────────────────────────────
async function getAllWarnings() {
  return query("SELECT * FROM warnings ORDER BY timestamp ASC");
}

async function addWarning(guildId, userId, entry) {
  db.prepare(`
    INSERT INTO warnings (guild_id, user_id, reason, by, timestamp, severity, points)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, entry.reason, entry.by, entry.timestamp, entry.severity || 1, entry.points || 1);
  return db.prepare("SELECT last_insert_rowid() as id").get().id;
}

async function clearWarnings(guildId, userId) {
  db.prepare("DELETE FROM warnings WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

async function getWarningsSince(guildId, userId, sinceTimestamp) {
  return query("SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND timestamp >= ? ORDER BY timestamp ASC", [guildId, userId, sinceTimestamp]);
}

async function getTotalWarningPoints(guildId, userId, sinceTimestamp) {
  const row = db.prepare("SELECT COALESCE(SUM(points), 0) as total FROM warnings WHERE guild_id = ? AND user_id = ? AND timestamp >= ?").get(guildId, userId, sinceTimestamp);
  return row ? row.total : 0;
}

async function getWarningCount(guildId, userId, sinceTimestamp) {
  const row = db.prepare("SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ? AND timestamp >= ?").get(guildId, userId, sinceTimestamp);
  return row ? row.count : 0;
}

// ── Mod Notes ──────────────────────────────────────────────────────────
async function getModNotes(guildId, userId) {
  return query("SELECT * FROM mod_notes WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC", [guildId, userId]);
}

async function addModNote(guildId, userId, content, by, timestamp) {
  db.prepare("INSERT INTO mod_notes (guild_id, user_id, content, by, timestamp) VALUES (?, ?, ?, ?, ?)").run(guildId, userId, content, by, timestamp);
}

async function deleteModNote(id) {
  db.prepare("DELETE FROM mod_notes WHERE id = ?").run(id);
}

// ── Probation ──────────────────────────────────────────────────────────
async function getProbation(guildId, userId) {
  return db.prepare("SELECT * FROM probation WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
}

async function setProbation(guildId, userId, roleId, expiresAt, warningCount) {
  db.prepare(`
    INSERT INTO probation (guild_id, user_id, role_id, expires_at, warning_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      role_id = excluded.role_id,
      expires_at = excluded.expires_at,
      warning_count = excluded.warning_count
  `).run(guildId, userId, roleId, expiresAt, warningCount);
}

async function removeProbation(guildId, userId) {
  db.prepare("DELETE FROM probation WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

async function getAllProbations() {
  return query("SELECT * FROM probation");
}

// ── Moderation Log ─────────────────────────────────────────────────────
async function getModLog(guildId, limit = 100) {
  return query("SELECT * FROM moderation_log WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?", [guildId, limit]);
}

async function getModLogForUser(guildId, userId, limit = 50) {
  return query("SELECT * FROM moderation_log WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ?", [guildId, userId, limit]);
}

async function addModLogEntry(guildId, userId, modId, action, reason, details, proof) {
  db.prepare("INSERT INTO moderation_log (guild_id, user_id, mod_id, action, reason, details, proof, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(guildId, userId, modId, action, reason || "", details || "", proof ? JSON.stringify(proof) : null, Date.now());
}

// ── DM Templates ───────────────────────────────────────────────────────
async function getDmTemplate(guildId, action) {
  return db.prepare("SELECT * FROM dm_templates WHERE guild_id = ? AND action = ?").get(guildId, action);
}

async function setDmTemplate(guildId, action, message, enabled) {
  db.prepare(`
    INSERT INTO dm_templates (guild_id, action, message, enabled)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, action) DO UPDATE SET
      message = excluded.message,
      enabled = excluded.enabled
  `).run(guildId, action, message, enabled ? 1 : 0);
}

async function getAllDmTemplates(guildId) {
  return query("SELECT * FROM dm_templates WHERE guild_id = ?", [guildId]);
}

// ── Extended Automod ───────────────────────────────────────────────────
async function getExtendedAutomod(guildId) {
  return db.prepare("SELECT * FROM automod_extended WHERE guild_id = ?").get(guildId);
}

async function setExtendedAutomod(guildId, cfg) {
  db.prepare(`
    INSERT INTO automod_extended (
      guild_id,
      link_blacklist,
      link_whitelist,
      link_action,
      repeated_text,
      repeated_text_count,
      repeated_text_action,
      emoji_spam,
      emoji_max,
      emoji_action,
      blocked_emojis_enabled,
      blocked_emojis,
      blocked_emojis_action,
      blocked_reaction_emojis_enabled,
      blocked_reaction_emojis,
      blocked_reaction_action,
      zalgo_enabled,
      zalgo_action,
      regex_enabled,
      regex_patterns,
      regex_action,
      attachments_enabled,
      attachments_blocked_exts,
      attachments_max_size_mb,
      attachments_action,
      newlines_enabled,
      newlines_max,
      newlines_action,
      mentions_roles_enabled,
      mentions_roles_max,
      mentions_roles_action
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      link_blacklist = excluded.link_blacklist,
      link_whitelist = excluded.link_whitelist,
      link_action = excluded.link_action,
      repeated_text = excluded.repeated_text,
      repeated_text_count = excluded.repeated_text_count,
      repeated_text_action = excluded.repeated_text_action,
      emoji_spam = excluded.emoji_spam,
      emoji_max = excluded.emoji_max,
      emoji_action = excluded.emoji_action,
      blocked_emojis_enabled = excluded.blocked_emojis_enabled,
      blocked_emojis = excluded.blocked_emojis,
      blocked_emojis_action = excluded.blocked_emojis_action,
      blocked_reaction_emojis_enabled = excluded.blocked_reaction_emojis_enabled,
      blocked_reaction_emojis = excluded.blocked_reaction_emojis,
      blocked_reaction_action = excluded.blocked_reaction_action,
      zalgo_enabled = excluded.zalgo_enabled,
      zalgo_action = excluded.zalgo_action,
      regex_enabled = excluded.regex_enabled,
      regex_patterns = excluded.regex_patterns,
      regex_action = excluded.regex_action,
      attachments_enabled = excluded.attachments_enabled,
      attachments_blocked_exts = excluded.attachments_blocked_exts,
      attachments_max_size_mb = excluded.attachments_max_size_mb,
      attachments_action = excluded.attachments_action,
      newlines_enabled = excluded.newlines_enabled,
      newlines_max = excluded.newlines_max,
      newlines_action = excluded.newlines_action,
      mentions_roles_enabled = excluded.mentions_roles_enabled,
      mentions_roles_max = excluded.mentions_roles_max,
      mentions_roles_action = excluded.mentions_roles_action
  `).run(
    guildId,
    JSON.stringify(cfg.link_blacklist || []),
    JSON.stringify(cfg.link_whitelist || []),
    cfg.link_action || "delete",
    cfg.repeated_text ? 1 : 0,
    cfg.repeated_text_count || 3,
    cfg.repeated_text_action || "delete",
    cfg.emoji_spam ? 1 : 0,
    cfg.emoji_max || 5,
    cfg.emoji_action || "delete",
    cfg.blocked_emojis_enabled ? 1 : 0,
    JSON.stringify(cfg.blocked_emojis || []),
    cfg.blocked_emojis_action || "delete",
    cfg.blocked_reaction_emojis_enabled ? 1 : 0,
    JSON.stringify(cfg.blocked_reaction_emojis || []),
    cfg.blocked_reaction_action || "delete",
    cfg.zalgo_enabled ? 1 : 0,
    cfg.zalgo_action || "delete",
    cfg.regex_enabled ? 1 : 0,
    JSON.stringify((cfg.regex_patterns || []).slice(0, 10)),
    cfg.regex_action || "delete",
    cfg.attachments_enabled ? 1 : 0,
    JSON.stringify((cfg.attachments_blocked_exts || []).slice(0, 50)),
    cfg.attachments_max_size_mb || 0,
    cfg.attachments_action || "delete",
    cfg.newlines_enabled ? 1 : 0,
    cfg.newlines_max || 10,
    cfg.newlines_action || "delete",
    cfg.mentions_roles_enabled ? 1 : 0,
    cfg.mentions_roles_max || 3,
    cfg.mentions_roles_action || "delete"
  );
}

// ── Auto-Execute Rules Engine ──────────────────────────────────────────
async function getAutoExecRules(guildId) {
  return query("SELECT * FROM autoexec_rules WHERE guild_id = ? ORDER BY priority ASC", [guildId]);
}

async function setAutoExecRule(guildId, rule) {
  const hasId = rule && rule.id;
  const stmt = db.prepare(`
    INSERT INTO autoexec_rules ${hasId ? "(id, guild_id, trigger_event, conditions, actions, enabled, priority)"
      : "(guild_id, trigger_event, conditions, actions, enabled, priority)"}
    VALUES ${hasId ? "(?, ?, ?, ?, ?, ?, ?)" : "(?, ?, ?, ?, ?, ?)"}
    ON CONFLICT(id) DO UPDATE SET
      trigger_event = excluded.trigger_event,
      conditions = excluded.conditions,
      actions = excluded.actions,
      enabled = excluded.enabled,
      priority = excluded.priority
  `);
  const params = hasId
    ? [rule.id, guildId, rule.trigger_event, JSON.stringify(rule.conditions || {}), JSON.stringify(rule.actions || []), rule.enabled !== false ? 1 : 0, rule.priority || 0]
    : [guildId, rule.trigger_event, JSON.stringify(rule.conditions || {}), JSON.stringify(rule.actions || []), rule.enabled !== false ? 1 : 0, rule.priority || 0];
  return stmt.run(...params);
}

async function deleteAutoExecRule(id) {
  db.prepare("DELETE FROM autoexec_rules WHERE id = ?").run(id);
}

// ── AI Analytics ───────────────────────────────────────────────────────────
async function logAiCall(guildId, userId, provider, model, tokens, latencyMs, success, error) {
  db.prepare(`
    INSERT INTO ai_analytics (guild_id, user_id, provider, model, tokens, latency_ms, success, error, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, provider, model || "", tokens || 0, latencyMs || 0, success ? 1 : 0, error || null, Date.now());
}

async function getAiAnalytics(guildId, days = 7) {
  const since = Date.now() - days * 86400000;
  return query(`
    SELECT provider, COUNT(*) as calls, SUM(tokens) as tokens, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
           ROUND(AVG(latency_ms)) as avg_latency_ms
    FROM ai_analytics WHERE guild_id = ? AND timestamp >= ? GROUP BY provider ORDER BY calls DESC
  `, [guildId, since]);
}

async function getAiTopUsers(guildId, days = 7, limit = 10) {
  const since = Date.now() - days * 86400000;
  return query(`
    SELECT user_id, COUNT(*) as calls
    FROM ai_analytics WHERE guild_id = ? AND timestamp >= ? AND user_id IS NOT NULL
    GROUP BY user_id ORDER BY calls DESC LIMIT ?
  `, [guildId, since, limit]);
}

async function getAiDailyAnalytics(guildId, days = 7) {
  const since = Date.now() - days * 86400000;
  return query(`
    SELECT provider,
           CAST(timestamp / 86400000 AS INTEGER) as day_epoch,
           COUNT(*) as calls,
           SUM(tokens) as tokens,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
    FROM ai_analytics WHERE guild_id = ? AND timestamp >= ?
    GROUP BY provider, day_epoch ORDER BY day_epoch ASC
  `, [guildId, since]);
}

// ── AI Personalities ─────────────────────────────────────────────────────────
async function getPersonalities() {
  return query("SELECT * FROM ai_personalities ORDER BY id ASC");
}

async function addPersonality(name, prompt) {
  const info = db.prepare("INSERT INTO ai_personalities (name, prompt) VALUES (?, ?)").run(name.trim(), prompt.trim());
  return info.lastInsertRowid;
}

async function updatePersonality(id, name, prompt) {
  db.prepare("UPDATE ai_personalities SET name = ?, prompt = ? WHERE id = ?").run(name.trim(), prompt.trim(), Number(id));
}

async function deletePersonality(id) {
  db.prepare("DELETE FROM ai_personalities WHERE id = ?").run(Number(id));
}

// ── AI memories ──────────────────────────────────────────────────────────
async function getAiMemories() {
  return query("SELECT * FROM ai_memories ORDER BY created_at ASC");
}

async function addAiMemory(guildId, userId, content, createdAt) {
  const stmt = db.prepare(`
    INSERT INTO ai_memories (guild_id, user_id, content, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(guildId, userId || null, content, createdAt);
  return info.lastInsertRowid;
}

async function deleteAiMemory(id) {
  db.prepare("DELETE FROM ai_memories WHERE id = ?").run(id);
}

async function clearAiMemories({ guildId = null, userId = null } = {}) {
  // Guild scoping is additive (each guild keeps isolated memory rows).
  // User scoping matches the ai_memories schema: null = server memories
  // (user_id IS NULL), value = a specific Discord user, omitted = wipe all.
  const conds = [];
  const params = [];
  if (guildId) { conds.push("guild_id = ?"); params.push(guildId); }
  if (userId === null) {
    conds.push("user_id IS NULL");
  } else if (userId) {
    conds.push("user_id = ?");
    params.push(userId);
  }
  const sql = conds.length
    ? `DELETE FROM ai_memories WHERE ${conds.join(" AND ")}`
    : "DELETE FROM ai_memories";
  const info = run(sql, params);
  return info.changes || 0;
}

// ── Stickies ─────────────────────────────────────────────────────────────
async function getStickies() {
  return query("SELECT * FROM stickies");
}

async function replaceStickies(stickies) {
  return withTransaction(() => {
    db.prepare("DELETE FROM stickies").run();
    const insertStmt = db.prepare(`
      INSERT INTO stickies (channel_id, message_id, content)
      VALUES (?, ?, ?)
    `);
    for (const [channelId, val] of Object.entries(stickies)) {
      insertStmt.run(channelId, val.messageId || null, JSON.stringify(val));
    }
  });
}

// ── Reaction logs ────────────────────────────────────────────────────────
async function getReactionLogs() {
  return query("SELECT * FROM reaction_logs");
}

async function replaceReactionLogs(reactionlogs) {
  return withTransaction(() => {
    db.prepare("DELETE FROM reaction_logs").run();
    const insertStmt = db.prepare(`
      INSERT INTO reaction_logs (guild_id, channel_id)
      VALUES (?, ?)
    `);
    for (const [guildId, val] of Object.entries(reactionlogs)) {
      insertStmt.run(guildId, val.channelId);
    }
  });
}

// ── AFK users ───────────────────────────────────────────────────────────
async function getAfkUsers() {
  return query("SELECT * FROM afk_users");
}

async function replaceAfkUsers(afkUsers) {
  return withTransaction(() => {
    db.prepare("DELETE FROM afk_users").run();
    const insertStmt = db.prepare(`
      INSERT INTO afk_users (user_id, reason, since, guild_id)
      VALUES (?, ?, ?, ?)
    `);
    for (const [userId, val] of Object.entries(afkUsers)) {
      insertStmt.run(userId, val.reason || "", val.since || Date.now(), val.guildId || null);
    }
  });
}

// ── Custom roles ────────────────────────────────────────────────────────
async function getCustomRoles() {
  return query("SELECT * FROM custom_roles");
}

async function replaceCustomRoles(customRoles) {
  return withTransaction(() => {
    db.prepare("DELETE FROM custom_roles").run();
    const insertStmt = db.prepare(`
      INSERT INTO custom_roles (guild_id, user_id, role_id, style, color, name, has_icon, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [guildId, users] of Object.entries(customRoles)) {
      for (const [userId, val] of Object.entries(users)) {
        // The in-memory store holds a rich object { roleId, style, color, name,
        // hasIcon, createdAt }. Older code bound the whole object as role_id,
        // which SQLite rejects (objects aren't bindable) — so nothing persisted.
        const r = val && typeof val === "object" ? val : { roleId: val };
        insertStmt.run(
          guildId, userId, r.roleId,
          r.style ?? null, r.color ?? null, r.name ?? null,
          r.hasIcon ? 1 : 0, r.createdAt ?? 0,
        );
      }
    }
  });
}

// ── Tracked Roles (live role-list messages) ────────────────────────────
async function getAllTrackedRoles() {
  return query("SELECT * FROM tracked_roles");
}

async function getTrackedRolesForGuild(guildId) {
  return query("SELECT * FROM tracked_roles WHERE guild_id = ?", [guildId]);
}

async function addTrackedRoles(guildId, channelId, messageIds, roleIds) {
  db.prepare(`
    INSERT INTO tracked_roles (guild_id, channel_id, message_ids, role_ids, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, channelId, JSON.stringify(messageIds), JSON.stringify(roleIds), Date.now());
}

async function updateTrackedRoles(guildId, channelId, messageIds) {
  db.prepare(`
    UPDATE tracked_roles SET message_ids = ? WHERE guild_id = ? AND channel_id = ?
  `).run(JSON.stringify(messageIds), guildId, channelId);
}

async function deleteTrackedRoles(guildId, channelId) {
  db.prepare("DELETE FROM tracked_roles WHERE guild_id = ? AND channel_id = ?").run(guildId, channelId);
}

// ── Dangerzone ───────────────────────────────────────────────────────────
async function getAllDangerzoneConfigs() {
  return query("SELECT * FROM dangerzone_config");
}

async function setDangerzoneConfig(guildId, cfg) {
  db.prepare(`
    INSERT INTO dangerzone_config (guild_id, channels)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channels = excluded.channels
  `).run(guildId, JSON.stringify(cfg.channels || {}));
}

// ── Theme ────────────────────────────────────────────────────────────────
async function getAllThemeConfigs() {
  return query("SELECT * FROM theme_config");
}

async function setThemeConfig(guildId, cfg) {
  db.prepare(`
    INSERT INTO theme_config (guild_id, config)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      config = excluded.config
  `).run(guildId, JSON.stringify(cfg || {}));
}

// ── Anti-raid ──────────────────────────────────────────────────────────────
async function getAllAntiraidConfigs() {
  return query("SELECT * FROM antiraid_config");
}

async function setAntiraidConfig(guildId, cfg) {
  db.prepare(`
    INSERT INTO antiraid_config (guild_id, config)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      config = excluded.config
  `).run(guildId, JSON.stringify(cfg || {}));
}

// ── Automod trigger stats (BOT_SPEC §3.4) ──────────────────────────────────
// Per-(guild, rule, day) counter. `day` is YYYY-MM-DD UTC. Upserted on each
// violation so the hot path is a single INSERT...ON CONFLICT (sync, fast).
function dayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function incrementAutomodStat(guildId, rule) {
  if (!guildId || !rule) return;
  db.prepare(`
    INSERT INTO automod_stats (guild_id, rule, day, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(guild_id, rule, day) DO UPDATE SET
      count = count + 1
  `).run(guildId, rule, dayStr());
}

async function getAutomodStats(guildId, days = 30) {
  if (!guildId) return [];
  const since = dayStr(new Date(Date.now() - days * 86_400_000));
  return query(`
    SELECT rule, day, count FROM automod_stats
    WHERE guild_id = ? AND day >= ?
    ORDER BY day DESC, count DESC
  `, [guildId, since]);
}

async function clearAutomodStats(guildId) {
  if (!guildId) return;
  db.prepare("DELETE FROM automod_stats WHERE guild_id = ?").run(guildId);
}

// ── Leveling (BOT_SPEC §4) ────────────────────────────────────────────────
async function getAllLevelingConfigs() {
  return query("SELECT * FROM leveling_config");
}

async function setLevelingConfig(guildId, cfg) {
  db.prepare(`
    INSERT INTO leveling_config (guild_id, config)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      config = excluded.config
  `).run(guildId, JSON.stringify(cfg || {}));
}

function getLevelingUser(guildId, userId) {
  return get("SELECT * FROM leveling_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
}

// Atomic XP + message increment in one statement. Returns the new row.
function addLevelingXp(guildId, userId, xpGain, level, now) {
  db.prepare(`
    INSERT INTO leveling_users (guild_id, user_id, xp, level, last_xp_at, messages, voice_minutes)
    VALUES (?, ?, ?, ?, ?, 1, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      xp = xp + ?,
      level = ?,
      last_xp_at = ?,
      messages = messages + 1
  `).run(guildId, userId, xpGain, level, now, xpGain, level, now);
  return getLevelingUser(guildId, userId);
}

// Set absolute xp + level (for $setlevel / $givexp). Recomputes messages=0
// is wrong — keep messages. Use for admin overrides.
function setLevelingUser(guildId, userId, xp, level) {
  db.prepare(`
    INSERT INTO leveling_users (guild_id, user_id, xp, level, last_xp_at, messages, voice_minutes)
    VALUES (?, ?, ?, ?, 0, 0, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      xp = ?,
      level = ?
  `).run(guildId, userId, xp, level, xp, level);
  return getLevelingUser(guildId, userId);
}

function addLevelingVoiceMinutes(guildId, userId, minutes) {
  db.prepare(`
    INSERT INTO leveling_users (guild_id, user_id, xp, level, last_xp_at, messages, voice_minutes)
    VALUES (?, ?, 0, 0, 0, 0, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      voice_minutes = voice_minutes + ?
  `).run(guildId, userId, minutes, minutes);
}

async function getLevelingLeaderboard(guildId, limit = 100) {
  return query("SELECT user_id, xp, level, messages, voice_minutes FROM leveling_users WHERE guild_id = ? ORDER BY xp DESC LIMIT ?", [guildId, Math.min(Math.max(limit, 1), 1000)]);
}

// Rank = 1 + count of users with more xp. Returns 0 if the user has no row.
function getLevelingRank(guildId, userId) {
  const row = get("SELECT (SELECT COUNT(*) + 1 FROM leveling_users u2 WHERE u2.guild_id = u1.guild_id AND u2.xp > u1.xp) AS rank FROM leveling_users u1 WHERE u1.guild_id = ? AND u1.user_id = ?", [guildId, userId]);
  return row ? row.rank : 0;
}

async function resetLevelingGuild(guildId) {
  db.prepare("DELETE FROM leveling_users WHERE guild_id = ?").run(guildId);
}

// ── Femboyified Users ────────────────────────────────────────────────────
async function getAllFemboyifiedUsers() {
  return query("SELECT * FROM femboyified_users");
}

async function setFemboyifiedUser(guildId, userId, originalNick) {
  db.prepare(`
    INSERT INTO femboyified_users (guild_id, user_id, original_nick, timestamp)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      original_nick = excluded.original_nick,
      timestamp = excluded.timestamp
  `).run(guildId, userId, originalNick, Date.now());
}

async function removeFemboyifiedUser(guildId, userId) {
  db.prepare("DELETE FROM femboyified_users WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

// ── Tempbans ─────────────────────────────────────────────────────────────
async function getAllTempbans() {
  return query("SELECT * FROM tempbans");
}

async function setTempban(guildId, userId, expiresAt, modId, reason) {
  db.prepare(`
    INSERT INTO tempbans (guild_id, user_id, expires_at, mod_id, reason)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      expires_at = excluded.expires_at,
      mod_id = excluded.mod_id,
      reason = excluded.reason
  `).run(guildId, userId, expiresAt, modId, reason);
}

async function removeTempban(guildId, userId) {
  db.prepare("DELETE FROM tempbans WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

function close() {
  db.close();
}

module.exports = {
  db,
  query,
  get,
  run,
  withTransaction,
  safeJsonParse,
  init,
  close,

  // ── Global settings ──────────────────────────────────────────────────────
  getGlobalSettings,
  setGlobalSetting,

  // ── Command config ───────────────────────────────────────────────────────
  getAllCommandConfigs,
  setCommandConfig,
  deleteCommandConfig,

  // ── Automod ──────────────────────────────────────────────────────────────
  getAllAutomodConfigs,
  setAutomodConfig,

  // ── Greet ───────────────────────────────────────────────────────────────
  getAllGreetConfigs,
  setGreetConfig,

  // ── Roles ───────────────────────────────────────────────────────────────
  getAllRolesConfigs,
  setRolesConfig,

  // ── Warnings ─────────────────────────────────────────────────────────────
  getAllWarnings,
  addWarning,
  clearWarnings,
  getWarningsSince,
  getTotalWarningPoints,
  getWarningCount,

  // ── AI memories ──────────────────────────────────────────────────────────
  getAiMemories,
  addAiMemory,
  deleteAiMemory,
  clearAiMemories,

  // ── Stickies ─────────────────────────────────────────────────────────────
  getStickies,
  replaceStickies,

  // ── Reaction logs ───────────────────────────────────────────────────────
  getReactionLogs,
  replaceReactionLogs,

  // ── AFK users ───────────────────────────────────────────────────────────
  getAfkUsers,
  replaceAfkUsers,

  // ── Custom roles ────────────────────────────────────────────────────────
  getCustomRoles,
  replaceCustomRoles,

  // ── Tracked Roles ─────────────────────────────────────────────────────────────────
  getAllTrackedRoles,
  getTrackedRolesForGuild,
  addTrackedRoles,
  updateTrackedRoles,
  deleteTrackedRoles,

  // ── Dangerzone ───────────────────────────────────────────────────────────
  getAllDangerzoneConfigs,
  setDangerzoneConfig,

  // ── Theme ─────────────────────────────────────────────────────────────────
  getAllThemeConfigs,
  setThemeConfig,

  // ── Anti-raid ────────────────────────────────────────────────────────────
  getAllAntiraidConfigs,
  setAntiraidConfig,

  // ── Automod stats ─────────────────────────────────────────────────────────
  incrementAutomodStat,
  getAutomodStats,
  clearAutomodStats,

  // ── Leveling (BOT_SPEC §4) ────────────────────────────────────────────────
  getAllLevelingConfigs,
  setLevelingConfig,
  getLevelingUser,
  addLevelingXp,
  setLevelingUser,
  addLevelingVoiceMinutes,
  getLevelingLeaderboard,
  getLevelingRank,
  resetLevelingGuild,

  // ── Femboyified Users ────────────────────────────────────────────────────
  getAllFemboyifiedUsers,
  setFemboyifiedUser,
  removeFemboyifiedUser,

  // ── Tempbans ─────────────────────────────────────────────────────────────
  getAllTempbans,
  setTempban,
  removeTempban,

  // ── Mod Notes ────────────────────────────────────────────────────────────
  getModNotes,
  addModNote,
  deleteModNote,

  // ── Probation ────────────────────────────────────────────────────────────
  getProbation,
  setProbation,
  removeProbation,
  getAllProbations,

  // ── Moderation Log ───────────────────────────────────────────────────────
  getModLog,
  getModLogForUser,
  addModLogEntry,

  // ── DM Templates ─────────────────────────────────────────────────────────
  getDmTemplate,
  setDmTemplate,
  getAllDmTemplates,

  // ── Extended Automod ─────────────────────────────────────────────────────
  getExtendedAutomod,
  setExtendedAutomod,

  // ── Auto-Execute Rules Engine ────────────────────────────────────────────
  getAutoExecRules,
  setAutoExecRule,
  deleteAutoExecRule,

  // ── AI Analytics ──────────────────────────────────────────────────────────
  logAiCall,
  getAiAnalytics,
  getAiTopUsers,
  getAiDailyAnalytics,

  // ── AI Personalities ──────────────────────────────────────────────────────
  getPersonalities,
  addPersonality,
  updatePersonality,
  deletePersonality,

  // ── Scheduled Messages ───────────────────────────────────────────────────
  async getScheduledMessages(guildId) {
    return query("SELECT * FROM scheduled_messages WHERE guild_id = ? ORDER BY scheduled_at ASC", [guildId]);
  },
  async getAllScheduledMessages() {
    return query("SELECT * FROM scheduled_messages WHERE enabled = 1 ORDER BY scheduled_at ASC");
  },
  async addScheduledMessage(guildId, channelId, content, scheduledAt, recurrence, createdBy, embedJson) {
    const info = db.prepare(`
      INSERT INTO scheduled_messages (guild_id, channel_id, content, embed_json, scheduled_at, recurrence, enabled, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(guildId, channelId, content, embedJson || null, scheduledAt, recurrence || null, createdBy || null);
    return info.lastInsertRowid;
  },
  async updateScheduledMessage(id, patch) {
    const sets = [];
    const vals = [];
    const allowed = ["channel_id", "content", "embed_json", "scheduled_at", "recurrence", "enabled", "last_sent_at"];
    for (const [k, v] of Object.entries(patch)) {
      if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (!sets.length) return;
    vals.push(id);
    db.prepare(`UPDATE scheduled_messages SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  },
  async deleteScheduledMessage(id) {
    db.prepare("DELETE FROM scheduled_messages WHERE id = ?").run(id);
  },

  // ── Server Backups ─────────────────────────────────────────────────────
  async getBackups(guildId) {
    return query("SELECT id, guild_id, name, created_at, created_by FROM server_backups WHERE guild_id = ? ORDER BY created_at DESC", [guildId]);
  },
  async getBackup(id) {
    return get("SELECT * FROM server_backups WHERE id = ?", [id]);
  },
  async addBackup(guildId, name, data, createdBy) {
    const info = db.prepare("INSERT INTO server_backups (guild_id, name, data, created_at, created_by) VALUES (?, ?, ?, ?, ?)").run(guildId, name, JSON.stringify(data), new Date().toISOString(), createdBy || null);
    return info.lastInsertRowid;
  },
  async deleteBackup(id) {
    db.prepare("DELETE FROM server_backups WHERE id = ?").run(id);
  },

  // ── Economy ─────────────────────────────────────────────────────────────
  async getEconomyUser(guildId, userId) {
    return get("SELECT * FROM economy_users WHERE guild_id = ? AND user_id = ?", [guildId, userId]);
  },
  async upsertEconomyUser(guildId, userId, balance, bank) {
    db.prepare(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = balance + excluded.balance,
        bank = bank + excluded.bank
    `).run(guildId, userId, balance || 0, bank || 0);
  },
  async setEconomyUser(guildId, userId, balance, bank, lastDaily, lastWork) {
    db.prepare(`
      INSERT INTO economy_users (guild_id, user_id, balance, bank, last_daily, last_work)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        balance = excluded.balance,
        bank = excluded.bank,
        last_daily = excluded.last_daily,
        last_work = excluded.last_work
    `).run(guildId, userId, balance, bank, lastDaily || 0, lastWork || 0);
  },
  async transferMoney(guildId, fromId, toId, amount) {
    return withTransaction(() => {
      const from = db.prepare("SELECT balance, bank FROM economy_users WHERE guild_id = ? AND user_id = ?").get(guildId, fromId);
      if (!from || from.balance < amount) return false;
      db.prepare("UPDATE economy_users SET balance = balance - ? WHERE guild_id = ? AND user_id = ?").run(amount, guildId, fromId);
      db.prepare(`
        INSERT INTO economy_users (guild_id, user_id, balance, bank)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET balance = balance + ?
      `).run(guildId, toId, amount, amount);
      return true;
    });
  },
  async getEconomyLeaderboard(guildId, limit = 10) {
    return query(
      "SELECT user_id, balance, bank, (balance + bank) as total FROM economy_users WHERE guild_id = ? ORDER BY total DESC LIMIT ?",
      [guildId, limit]
    );
  },

  // ── Economy config ──────────────────────────────────────────────────
  async getEconomyConfig(guildId) {
    const row = get("SELECT * FROM economy_config WHERE guild_id = ?", [guildId]);
    if (!row) return null;
    return row;
  },
  async setEconomyConfig(guildId, cfg) {
    db.prepare(`
      INSERT INTO economy_config (
        guild_id, daily_amount, work_min, work_max, daily_cooldown, work_cooldown,
        interest_rate, tax_rate, gamble_odds,
        blackjack_min_bet, blackjack_max_bet, blackjack_payout,
        slots_min_bet, slots_max_bet, slots_win_odds, slots_jackpot_multiplier,
        coinflip_min_bet, coinflip_max_bet,
        highlow_min_bet, highlow_max_bet, highlow_dice_sides,
        fish_min_bet, fish_max_bet,
        mine_min_bet, mine_max_bet,
        trivia_streak_bonus,
        wordle_enabled, wordle_streak_bonus,
        typerace_min_players
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        daily_amount = excluded.daily_amount,
        work_min = excluded.work_min,
        work_max = excluded.work_max,
        daily_cooldown = excluded.daily_cooldown,
        work_cooldown = excluded.work_cooldown,
        interest_rate = excluded.interest_rate,
        tax_rate = excluded.tax_rate,
        gamble_odds = excluded.gamble_odds,
        blackjack_min_bet = excluded.blackjack_min_bet,
        blackjack_max_bet = excluded.blackjack_max_bet,
        blackjack_payout = excluded.blackjack_payout,
        slots_min_bet = excluded.slots_min_bet,
        slots_max_bet = excluded.slots_max_bet,
        slots_win_odds = excluded.slots_win_odds,
        slots_jackpot_multiplier = excluded.slots_jackpot_multiplier,
        coinflip_min_bet = excluded.coinflip_min_bet,
        coinflip_max_bet = excluded.coinflip_max_bet,
        highlow_min_bet = excluded.highlow_min_bet,
        highlow_max_bet = excluded.highlow_max_bet,
        highlow_dice_sides = excluded.highlow_dice_sides,
        fish_min_bet = excluded.fish_min_bet,
        fish_max_bet = excluded.fish_max_bet,
        mine_min_bet = excluded.mine_min_bet,
        mine_max_bet = excluded.mine_max_bet,
        trivia_streak_bonus = excluded.trivia_streak_bonus,
        wordle_enabled = excluded.wordle_enabled,
        wordle_streak_bonus = excluded.wordle_streak_bonus,
        typerace_min_players = excluded.typerace_min_players
    `).run(
      guildId,
      cfg.dailyAmount ?? 200, cfg.workMin ?? 50, cfg.workMax ?? 300,
      cfg.dailyCooldown ?? 86400000, cfg.workCooldown ?? 3600000,
      cfg.interestRate ?? 0.0, cfg.taxRate ?? 0.0, cfg.gambleOdds ?? 0.45,
      cfg.blackjackMinBet ?? 10, cfg.blackjackMaxBet ?? 10000, cfg.blackjackPayout ?? 1.5,
      cfg.slotsMinBet ?? 5, cfg.slotsMaxBet ?? 5000, cfg.slotsWinOdds ?? 0.30, cfg.slotsJackpotMultiplier ?? 50,
      cfg.coinflipMinBet ?? 1, cfg.coinflipMaxBet ?? 10000,
      cfg.highlowMinBet ?? 10, cfg.highlowMaxBet ?? 10000, cfg.highlowDiceSides ?? 6,
      cfg.fishMinBet ?? 10, cfg.fishMaxBet ?? 5000,
      cfg.mineMinBet ?? 10, cfg.mineMaxBet ?? 5000,
      cfg.triviaStreakBonus ?? 0.1,
      // Coerce booleans to 0/1 — SQLite can't bind raw JS booleans.
      (cfg.wordleEnabled == null ? 1 : cfg.wordleEnabled ? 1 : 0), cfg.wordleStreakBonus ?? 0.2,
      cfg.typeraceMinPlayers ?? 2
    );
  },
  async getEconomyStats(guildId) {
    const row = get(
      "SELECT COUNT(*) as users, SUM(balance) as total_wallet, SUM(bank) as total_bank, SUM(balance + bank) as total_coins FROM economy_users WHERE guild_id = ?",
      [guildId]
    );
    const richest = get("SELECT user_id, (balance + bank) as total FROM economy_users WHERE guild_id = ? ORDER BY total DESC LIMIT 1", [guildId]);
    return { ...row, richestUserId: richest?.user_id || null, richestTotal: richest?.total || 0 };
  },
  async resetEconomy(guildId) {
    return withTransaction(() => {
      db.prepare("DELETE FROM economy_users WHERE guild_id = ?").run(guildId);
      db.prepare("DELETE FROM economy_config WHERE guild_id = ?").run(guildId);
      db.prepare("DELETE FROM economy_shop WHERE guild_id = ?").run(guildId);
    });
  },

  // ── Economy shop ────────────────────────────────────────────────────
  async getShopItems(guildId) {
    return query("SELECT * FROM economy_shop WHERE guild_id = ? ORDER BY price ASC", [guildId]);
  },
  async addShopItem(guildId, name, description, price, roleId, stock) {
    const info = db.prepare("INSERT INTO economy_shop (guild_id, name, description, price, role_id, stock) VALUES (?, ?, ?, ?, ?, ?)").run(guildId, name, description || "", price, roleId || null, stock ?? -1);
    return info.lastInsertRowid;
  },
  async updateShopItem(id, patch) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(patch)) {
      if (["name", "description", "price", "role_id", "stock"].includes(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (!sets.length) return;
    vals.push(id);
    db.prepare(`UPDATE economy_shop SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  },
  async deleteShopItem(id) {
    db.prepare("DELETE FROM economy_shop WHERE id = ?").run(id);
  },

  // ── Embed templates ────────────────────────────────────────────────
  async getEmbedTemplates(guildId) {
    return query("SELECT id, guild_id, name, embed_json, created_at, updated_at FROM embed_templates WHERE guild_id = ? ORDER BY name ASC", [guildId]);
  },
  async saveEmbedTemplate(guildId, name, embedJson, existingId) {
    const now = new Date().toISOString();
    if (existingId) {
      db.prepare("UPDATE embed_templates SET name = ?, embed_json = ?, updated_at = ? WHERE id = ? AND guild_id = ?").run(name, embedJson, now, existingId, guildId);
      return existingId;
    }
    const info = db.prepare("INSERT INTO embed_templates (guild_id, name, embed_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(guildId, name, embedJson, now, now);
    return info.lastInsertRowid;
  },
  async deleteEmbedTemplate(id) {
    db.prepare("DELETE FROM embed_templates WHERE id = ?").run(id);
  },

  // ── AI Conversations (persistent conversation history) ───────────
  // Scope ("global" per-channel or "private" per-user) decides which fields
  // are populated. Guild-channel threads are shared by everyone in that channel;
  // speaker_user_id identifies the speaker on guild-channel user turns only.
  // Private DMs keep user_id on every row because it is the thread owner.
  addConversationTurn(scope, key, role, content) {
    const ts = Date.now();
    const guildId = scope === "global" ? (key && key.guildId) || null : null;
    const channelId = scope === "global" ? (key && key.channelId) || null : null;
    // Keep user_id populated for old DBs that created it as NOT NULL and for
    // private DM thread lookup. speaker_user_id is the reliable guild speaker.
    const userId = (key && key.userId) || null;
    const speakerUserId = scope === "global" && role === "user" ? userId : null;
    db.prepare(`
      INSERT INTO ai_conversations (scope, guild_id, channel_id, user_id, speaker_user_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(scope, guildId, channelId, userId, speakerUserId, role, String(content || "").slice(0, 1500), ts);
  },
  getConversationHistory(scope, key, limit = 20) {
    if (scope === "global") {
      return query(
        `SELECT role, content, user_id, timestamp FROM (
           SELECT
             role,
             content,
             CASE WHEN role='user' THEN COALESCE(speaker_user_id, user_id) ELSE NULL END as user_id,
             timestamp
           FROM ai_conversations
           WHERE scope='global' AND guild_id=? AND channel_id=?
           ORDER BY timestamp DESC LIMIT ?
         ) ORDER BY timestamp ASC`,
        [key.guildId, key.channelId, limit]
      );
    }
    return query(
      `SELECT role, content, user_id, timestamp FROM (
         SELECT role, content, user_id, timestamp
         FROM ai_conversations
         WHERE scope='private' AND user_id=? AND guild_id IS NULL AND channel_id IS NULL
         ORDER BY timestamp DESC LIMIT ?
       ) ORDER BY timestamp ASC`,
      [key.userId, limit]
    );
  },
  getConversationLogs(opts = {}) {
    const { scope = null, guildId = null, channelId = null, userId = null, limit = 100 } = opts;
    const conds = [];
    const params = [];
    if (scope) { conds.push("scope = ?"); params.push(scope); }
    // Guild filter: when a guild is specified, only match that guild.
    // Private DM rows (guild_id IS NULL) are global to the bot and only
    // appear when no guildId is provided (i.e. unfiltered view). The
    // API endpoint handles scope separation by skipping the guild filter
    // for scope='private' since DMs have no guild.
    if (guildId) { conds.push("guild_id = ?"); params.push(guildId); }
    if (channelId) { conds.push("channel_id = ?"); params.push(channelId); }
    if (userId) { conds.push("user_id = ?"); params.push(userId); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    params.push(limit);
    return query(
      `SELECT
         id,
         scope,
         guild_id,
         channel_id,
         CASE
           WHEN scope='global' AND role='user' THEN COALESCE(speaker_user_id, user_id)
           WHEN scope='global' THEN NULL
           ELSE user_id
         END as user_id,
         role,
         content,
         timestamp
       FROM ai_conversations ${where} ORDER BY timestamp DESC LIMIT ?`,
      params
    );
  },
  getConversationUsers(opts = {}) {
    const { scope = null, guildId = null, channelId = null } = opts;
    const conds = [];
    const params = [];
    if (scope) { conds.push("scope = ?"); params.push(scope); }
    // Guild filter: when a guild is specified, only match that guild.
    // Private DM rows (guild_id IS NULL) only surface when no guildId
    // is provided. The API endpoint skips the guild filter for
    // scope='private' since DMs have no guild affiliation.
    if (guildId) { conds.push("guild_id = ?"); params.push(guildId); }
    if (channelId) { conds.push("channel_id = ?"); params.push(channelId); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    return query(
      `SELECT
         scope,
         guild_id,
         channel_id,
         CASE WHEN scope = 'private' THEN user_id ELSE NULL END as user_id,
         MAX(timestamp) as last_active
       FROM ai_conversations ${where}
       GROUP BY scope, guild_id, channel_id, CASE WHEN scope = 'private' THEN user_id ELSE NULL END
       ORDER BY last_active DESC`,
      params
    );
  },
  trimConversationHistory(scope, key, keep = 40) {
    let count, rowIds;
    if (scope === "global") {
      const row = db.prepare(
        "SELECT COUNT(*) as c FROM ai_conversations WHERE scope='global' AND guild_id=? AND channel_id=?"
      ).get(key.guildId, key.channelId);
      count = row && row.c;
      if (count && count > keep) {
        db.prepare(
          `DELETE FROM ai_conversations WHERE id IN (
             SELECT id FROM ai_conversations
             WHERE scope='global' AND guild_id=? AND channel_id=?
             ORDER BY timestamp ASC LIMIT ?
           )`
        ).run(key.guildId, key.channelId, count - keep);
      }
    } else {
      const row = db.prepare(
        "SELECT COUNT(*) as c FROM ai_conversations WHERE scope='private' AND user_id=? AND guild_id IS NULL AND channel_id IS NULL"
      ).get(key.userId);
      count = row && row.c;
      if (count && count > keep) {
        db.prepare(
          `DELETE FROM ai_conversations WHERE id IN (
             SELECT id FROM ai_conversations
             WHERE scope='private' AND user_id=? AND guild_id IS NULL AND channel_id IS NULL
             ORDER BY timestamp ASC LIMIT ?
           )`
        ).run(key.userId, count - keep);
      }
    }
  },

  // ── Layered system prompts (default → guild → channel) ─────────────
  // target_id='*' is the sentinel for the single default row (NULL can't be a PK).
  async getPrompt(scope, targetId) {
    const tid = scope === "default" ? "*" : (targetId || "*");
    return get("SELECT * FROM ai_prompts WHERE scope = ? AND target_id = ?", [scope, tid]);
  },
  async listPrompts(guildId = null) {
    if (!guildId) return query("SELECT * FROM ai_prompts ORDER BY scope ASC, target_id ASC");
    return query(
      "SELECT * FROM ai_prompts WHERE scope='default' OR scope='guild' AND target_id=? OR scope='channel' ORDER BY scope ASC, target_id ASC",
      [guildId]
    );
  },
  async upsertPrompt(scope, targetId, prompt) {
    const now = Date.now();
    const tid = scope === "default" ? "*" : (targetId || "*");
    const trimmed = String(prompt || "").slice(0, 20000);
    const existing = get("SELECT 1 FROM ai_prompts WHERE scope = ? AND target_id = ?", [scope, tid]);
    if (existing) {
      db.prepare("UPDATE ai_prompts SET prompt = ?, updated_at = ? WHERE scope = ? AND target_id = ?")
        .run(trimmed, now, scope, tid);
      return true;
    }
    db.prepare("INSERT INTO ai_prompts (scope, target_id, prompt, updated_at) VALUES (?, ?, ?, ?)")
      .run(scope, tid, trimmed, now);
    return true;
  },
  async deletePrompt(scope, targetId) {
    const tid = scope === "default" ? "*" : (targetId || "*");
    db.prepare("DELETE FROM ai_prompts WHERE scope = ? AND target_id = ?").run(scope, tid);
  },
  async clearGuildPrompts(guildId) {
    db.prepare("DELETE FROM ai_prompts WHERE scope = 'guild' AND target_id = ?").run(guildId);
    db.prepare("DELETE FROM ai_prompts WHERE scope = 'channel' AND target_id = ?").run(guildId);
  },
  // ── Alpha Experiments ─────────────────────────────────────────────────
  async createAlphaCode(code, createdBy) {
    db.prepare("INSERT INTO alpha_codes (code, created_by, created_at) VALUES (?, ?, ?)").run(code, createdBy, Date.now());
  },
  async getAlphaCode(code) {
    return get("SELECT * FROM alpha_codes WHERE code = ?", [code]);
  },
  async useAlphaCode(code, userId) {
    const info = db.prepare("UPDATE alpha_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL").run(userId, Date.now(), code);
    return info.changes > 0;
  },
  async getAllAlphaCodes() {
    return query("SELECT * FROM alpha_codes ORDER BY created_at DESC");
  },
  async getAlphaUser(userId, guildId) {
    return get("SELECT * FROM alpha_users WHERE user_id = ? AND guild_id = ?", [userId, guildId]);
  },
  async setAlphaUser(userId, guildId, { activatedAt, codeUsed, telemetryOptOut }) {
    db.prepare(`
      INSERT INTO alpha_users (user_id, guild_id, activated_at, code_used, telemetry_opt_out)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, guild_id) DO UPDATE SET
        telemetry_opt_out = excluded.telemetry_opt_out
    `).run(userId, guildId, activatedAt || Date.now(), codeUsed || null, telemetryOptOut ? 1 : 0);
  },
  async getAllAlphaUsers() {
    return query("SELECT * FROM alpha_users ORDER BY activated_at DESC");
  },
  async addAlphaTelemetry({ userId, guildId, toolName, success, errorMsg, durationMs }) {
    db.prepare(`
      INSERT INTO alpha_telemetry (user_id, guild_id, tool_name, success, error_msg, duration_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId || null, guildId || null, toolName, success ? 1 : 0, errorMsg || null, durationMs || 0, Date.now());
  },
  async getAlphaTelemetry(opts = {}) {
    const { guildId = null, userId = null, success = null, limit = 50, offset = 0 } = opts;
    const conds = [];
    const params = [];
    if (guildId) { conds.push("guild_id = ?"); params.push(guildId); }
    if (userId) { conds.push("user_id = ?"); params.push(userId); }
    if (success !== null) { conds.push("success = ?"); params.push(success ? 1 : 0); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    params.push(limit);
    params.push(offset);
    return query(`SELECT * FROM alpha_telemetry ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`, params);
  },
  async purgeAlphaTelemetry() {
    db.prepare("DELETE FROM alpha_telemetry").run();
  },

  async resolvePrompt({ guildId = null, channelId = null } = {}) {
    // Returns { prompt, source } where source is 'channel' | 'guild' | 'default' | 'settings'.
    // Most-specific tier wins; falls back to settings.aiSystemPrompt if no DB override.
    if (channelId) {
      const row = get("SELECT prompt FROM ai_prompts WHERE scope='channel' AND target_id=?", channelId);
      if (row) return { prompt: row.prompt, source: "channel" };
    }
    if (guildId) {
      const row = get("SELECT prompt FROM ai_prompts WHERE scope='guild' AND target_id=?", guildId);
      if (row) return { prompt: row.prompt, source: "guild" };
    }
    const def = get("SELECT prompt FROM ai_prompts WHERE scope='default' AND target_id='*'");
    if (def) return { prompt: def.prompt, source: "default" };
    return { prompt: null, source: null };
  },
};
