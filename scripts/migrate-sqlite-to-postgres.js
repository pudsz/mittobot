// One-time migration: copy all data from the legacy local SQLite file (bot.db)
// into the configured Postgres database (DATABASE_URL).
//
//   DATABASE_URL=postgres://... node scripts/migrate-sqlite-to-postgres.js
//
// Safe to re-run: every write is an UPSERT / full-replace, so re-running just
// overwrites with the same data. The SQLite file is left untouched.

require("dotenv").config();
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const db = require("../src/db");

const sqlitePath = path.join(__dirname, "..", "bot.db");

async function step(label, fn) {
  try {
    const n = await fn();
    console.log(`  ✓ ${label}${typeof n === "number" ? ` (${n})` : ""}`);
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Aborting."); process.exit(1);
  }
  if (!fs.existsSync(sqlitePath)) {
    console.error(`No SQLite database at ${sqlitePath} — nothing to migrate.`); process.exit(1);
  }

  const sq = new DatabaseSync(sqlitePath);
  const all = (sql) => { try { return sq.prepare(sql).all(); } catch { return []; } };

  console.log("Initializing Postgres schema...");
  await db.init();
  console.log("Migrating tables:");

  await step("global_settings", async () => {
    const rows = all("SELECT key, value FROM global_settings");
    for (const r of rows) {
      let v; try { v = JSON.parse(r.value); } catch { v = r.value; }
      await db.setGlobalSetting(r.key, v);
    }
    return rows.length;
  });

  await step("command_config", async () => {
    const rows = all("SELECT * FROM command_config");
    for (const r of rows) {
      await db.setCommandConfig(r.guild_id, r.command, {
        enabled: r.enabled === 1,
        permission: r.permission,
        allowedRoles: JSON.parse(r.allowed_roles || "[]"),
        allowedChannels: JSON.parse(r.allowed_channels || "[]"),
        blockedChannels: JSON.parse(r.blocked_channels || "[]"),
        cooldown: r.cooldown,
        settings: JSON.parse(r.settings || "{}"),
      });
    }
    return rows.length;
  });

  await step("automod_config", async () => {
    const rows = all("SELECT * FROM automod_config");
    for (const r of rows) {
      await db.setAutomodConfig(r.guild_id, {
        enabled: r.enabled === 1,
        logChannelId: r.log_channel_id,
        ignoredChannels: JSON.parse(r.ignored_channels || "[]"),
        ignoredRoles: JSON.parse(r.ignored_roles || "[]"),
        rules: JSON.parse(r.rules || "{}"),
      });
    }
    return rows.length;
  });

  await step("greet_config", async () => {
    const rows = all("SELECT * FROM greet_config");
    for (const r of rows) {
      await db.setGreetConfig(r.guild_id, {
        welcome_enabled: r.welcome_enabled === 1,
        welcome_channel_id: r.welcome_channel_id,
        welcome_message: r.welcome_message,
        leave_enabled: r.leave_enabled === 1,
        leave_channel_id: r.leave_channel_id,
        leave_message: r.leave_message,
        logs_enabled: r.logs_enabled === 1,
        logs_channel_id: r.logs_channel_id,
        logs_member_events: r.logs_member_events === 1,
        logs_message_events: r.logs_message_events === 1,
      });
    }
    return rows.length;
  });

  await step("roles_config", async () => {
    const rows = all("SELECT * FROM roles_config");
    for (const r of rows) {
      await db.setRolesConfig(r.guild_id, JSON.parse(r.autoroles || "[]"), JSON.parse(r.reaction_roles || "{}"));
    }
    return rows.length;
  });

  await step("warnings", async () => {
    const rows = all("SELECT * FROM warnings");
    for (const r of rows) {
      await db.addWarning(r.guild_id, r.user_id, { reason: r.reason, by: r.by, timestamp: r.timestamp });
    }
    return rows.length;
  });

  await step("stickies", async () => {
    const rows = all("SELECT * FROM stickies");
    const map = {};
    for (const r of rows) { try { map[r.channel_id] = JSON.parse(r.content); } catch {} }
    await db.replaceStickies(map);
    return rows.length;
  });

  await step("reaction_logs", async () => {
    const rows = all("SELECT * FROM reaction_logs");
    const map = {};
    for (const r of rows) map[r.guild_id] = { channelId: r.channel_id };
    await db.replaceReactionLogs(map);
    return rows.length;
  });

  await step("afk_users", async () => {
    const rows = all("SELECT * FROM afk_users");
    const map = {};
    for (const r of rows) map[r.user_id] = { reason: r.reason, since: r.since, guildId: r.guild_id };
    await db.replaceAfkUsers(map);
    return rows.length;
  });

  await step("custom_roles", async () => {
    const rows = all("SELECT * FROM custom_roles");
    const map = {};
    for (const r of rows) (map[r.guild_id] ??= {})[r.user_id] = r.role_id;
    await db.replaceCustomRoles(map);
    return rows.length;
  });

  sq.close();
  await db.pool.end();
  console.log("Migration complete.");
}

main().catch((err) => { console.error(err); process.exit(1); });
