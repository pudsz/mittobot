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
      repeated_text  INTEGER DEFAULT 0,
      repeated_text_count INTEGER DEFAULT 3,
      emoji_spam     INTEGER DEFAULT 0,
      emoji_max      INTEGER DEFAULT 5,
      zalgo_enabled  INTEGER DEFAULT 0
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
      guild_id TEXT,
      user_id  TEXT,
      role_id  TEXT,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS dangerzone_config (
      guild_id TEXT PRIMARY KEY,
      channels TEXT DEFAULT '{}'
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
  `);

  // Migrations for columns added after initial table creation
  try { db.exec("ALTER TABLE moderation_log ADD COLUMN proof TEXT"); } catch { /* column already exists */ }

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
    INSERT INTO automod_extended (guild_id, link_blacklist, link_whitelist, repeated_text, repeated_text_count, emoji_spam, emoji_max, zalgo_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      link_blacklist = excluded.link_blacklist,
      link_whitelist = excluded.link_whitelist,
      repeated_text = excluded.repeated_text,
      repeated_text_count = excluded.repeated_text_count,
      emoji_spam = excluded.emoji_spam,
      emoji_max = excluded.emoji_max,
      zalgo_enabled = excluded.zalgo_enabled
  `).run(
    guildId,
    JSON.stringify(cfg.link_blacklist || []),
    JSON.stringify(cfg.link_whitelist || []),
    cfg.repeated_text ? 1 : 0,
    cfg.repeated_text_count || 3,
    cfg.emoji_spam ? 1 : 0,
    cfg.emoji_max || 5,
    cfg.zalgo_enabled ? 1 : 0
  );
}

// ── Auto-Execute Rules Engine ──────────────────────────────────────────
async function getAutoExecRules(guildId) {
  return query("SELECT * FROM autoexec_rules WHERE guild_id = ? ORDER BY priority ASC", [guildId]);
}

async function setAutoExecRule(guildId, rule) {
  const stmt = db.prepare(`
    INSERT INTO autoexec_rules (guild_id, trigger_event, conditions, actions, enabled, priority)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      trigger_event = excluded.trigger_event,
      conditions = excluded.conditions,
      actions = excluded.actions,
      enabled = excluded.enabled,
      priority = excluded.priority
  `);
  return stmt.run(
    guildId,
    rule.trigger_event,
    JSON.stringify(rule.conditions || {}),
    JSON.stringify(rule.actions || []),
    rule.enabled !== false ? 1 : 0,
    rule.priority || 0
  );
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

async function clearAiMemories(guildId) {
  if (guildId) {
    db.prepare("DELETE FROM ai_memories WHERE guild_id = ?").run(guildId);
  } else {
    db.prepare("DELETE FROM ai_memories").run();
  }
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
      INSERT INTO custom_roles (guild_id, user_id, role_id)
      VALUES (?, ?, ?)
    `);
    for (const [guildId, users] of Object.entries(customRoles)) {
      for (const [userId, roleId] of Object.entries(users)) {
        insertStmt.run(guildId, userId, roleId);
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
};