const db = require("./db");

const data = {
  stickies:     {},
  warnings:     {},
  reactionlogs: {},
  afkUsers:     {},
  customRoles:  {},

  // The in-memory caches above are authoritative at runtime; each save* method
  // mirrors the relevant cache into Postgres in the background (best-effort).
  saveStickies() {
    db.replaceStickies(this.stickies).catch(e => console.error("persist stickies:", e.message));
  },

  saveReactionlogs() {
    db.replaceReactionLogs(this.reactionlogs).catch(e => console.error("persist reactionlogs:", e.message));
  },

  saveAfk() {
    db.replaceAfkUsers(this.afkUsers).catch(e => console.error("persist afk:", e.message));
  },

  saveCustomRoles() {
    db.replaceCustomRoles(this.customRoles).catch(e => console.error("persist customRoles:", e.message));
  },

  // Async: awaited once during bot startup.
  async load() {
    this.stickies = {};
    for (const row of await db.getStickies()) {
      try { this.stickies[row.channel_id] = JSON.parse(row.content); } catch { /* ignore */ }
    }

    this.warnings = {};
    for (const row of await db.getAllWarnings()) {
      const g = (this.warnings[row.guild_id] ??= {});
      const u = (g[row.user_id] ??= []);
      u.push({
        reason: row.reason,
        by: row.by,
        timestamp: Number(row.timestamp),
        severity: row.severity || 1,
        points: row.points || 1,
      });
    }

    this.reactionlogs = {};
    for (const row of await db.getReactionLogs()) {
      this.reactionlogs[row.guild_id] = { channelId: row.channel_id };
    }

    this.afkUsers = {};
    for (const row of await db.getAfkUsers()) {
      this.afkUsers[row.user_id] = { reason: row.reason, since: Number(row.since), guildId: row.guild_id };
    }

    this.customRoles = {};
    for (const row of await db.getCustomRoles()) {
      (this.customRoles[row.guild_id] ??= {})[row.user_id] = row.role_id;
    }
  },

  getWarnings(guildId, userId) {
    return this.warnings[guildId]?.[userId] ?? [];
  },

  addWarning(guildId, userId, entry) {
    (this.warnings[guildId] ??= {})[userId] ??= [];
    this.warnings[guildId][userId].push(entry);
    db.addWarning(guildId, userId, entry).catch(e => console.error("persist warning:", e.message));
  },

  // Get total warning points for a user in a guild
  getWarningPoints(guildId, userId) {
    const list = this.warnings[guildId]?.[userId] ?? [];
    return list.reduce((sum, w) => sum + (w.points || 1), 0);
  },

  // Get warnings within a time window (for time-decay)
  getWarningsSince(guildId, userId, sinceTimestamp) {
    const list = this.warnings[guildId]?.[userId] ?? [];
    if (!sinceTimestamp) return list;
    return list.filter(w => w.timestamp >= sinceTimestamp);
  },

  clearWarnings(guildId, userId) {
    if (this.warnings[guildId]) {
      delete this.warnings[guildId][userId];
    }
    db.clearWarnings(guildId, userId).catch(e => console.error("clear warnings:", e.message));
  }
};

module.exports = data;
