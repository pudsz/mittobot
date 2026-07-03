const db = require("./db");
const safe = require("./safe");
const { EmbedBuilder } = require("discord.js");

// In-memory cache: scheduleId -> { id, guildId, channelId, content, embedJson, scheduledAt, recurrence, enabled, timer, failCount }
const schedules = new Map();
let schedulesGeneration = 0; // bumped on reload() to invalidate stale timer callbacks
const MAX_CONSECUTIVE_FAILURES = 5; // Disable schedule after N consecutive send failures

// ─── Time helpers ─────────────────────────────────────────────────────────

function nextRecurrence(scheduledAt, recurrence) {
  const d = new Date(scheduledAt);
  const now = new Date();
  switch (recurrence) {
    case "daily": {
      // Advance to the next occurrence of the same time-of-day
      const next = new Date(now);
      next.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
      if (next <= now) next.setDate(next.getDate() + 1);
      return next.toISOString();
    }
    case "weekly": {
      // Advance to next occurrence of the same day-of-week + time
      const next = new Date(now);
      next.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
      // Align to the same day of week
      const dayDiff = d.getDay() - next.getDay();
      next.setDate(next.getDate() + (dayDiff <= 0 ? dayDiff + 7 : dayDiff));
      if (next <= now) next.setDate(next.getDate() + 7);
      return next.toISOString();
    }
    case "monthly": {
      // Advance to next occurrence of the same day-of-month + time
      const next = new Date(now);
      next.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
      next.setDate(d.getDate());
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
        // Handle month-end overflow (e.g., Jan 31 -> Feb 28)
        if (next.getDate() !== d.getDate()) {
          next.setDate(0); // last day of previous month
        }
      }
      return next.toISOString();
    }
    default:
      return null;
  }
}

// Parse human-readable recurrence or ISO datetime
function parseScheduleTime(input) {
  // ISO datetime: 2026-06-27T14:30:00 or 2026-06-27 14:30
  const iso = new Date(input);
  if (!isNaN(iso.getTime()) && iso > new Date()) {
    return { scheduledAt: iso.toISOString(), recurrence: null };
  }
  // "daily 14:30", "weekly mon 14:30", "monthly 15 14:30"
  const parts = String(input).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const recurrence = parts[0].toLowerCase();
  if (!["daily", "weekly", "monthly"].includes(recurrence)) return null;
  return { recurrence, rawParts: parts };
}

// Parse time-of-day string like "14:30"
function parseTime(str) {
  const [h, m] = str.split(":").map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { hours: h, minutes: m };
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function buildScheduledAt(recurrence, rawParts) {
  if (recurrence === "daily") {
    // daily 14:30
    const time = parseTime(rawParts[1] || "");
    if (!time) return null;
    return { time };
  }
  if (recurrence === "weekly") {
    // weekly mon 14:30
    const day = DAY_NAMES.indexOf((rawParts[1] || "").toLowerCase().slice(0, 3));
    const time = parseTime(rawParts[2] || "");
    if (day < 0 || !time) return null;
    // Find next occurrence of that day+time
    const next = new Date();
    next.setHours(time.hours, time.minutes, 0, 0);
    const dayDiff = day - next.getDay();
    next.setDate(next.getDate() + (dayDiff <= 0 ? dayDiff + 7 : dayDiff));
    return { scheduledAt: next.toISOString(), time };
  }
  if (recurrence === "monthly") {
    // monthly 15 14:30
    const dom = parseInt(rawParts[1], 10);
    const time = parseTime(rawParts[2] || "");
    if (isNaN(dom) || dom < 1 || dom > 31 || !time) return null;
    const next = new Date();
    next.setHours(time.hours, time.minutes, 0, 0);
    next.setDate(dom);
    if (next <= new Date()) {
      next.setMonth(next.getMonth() + 1);
      if (next.getDate() !== dom) next.setDate(0);
    }
    return { scheduledAt: next.toISOString(), time };
  }
  return null;
}

// ─── Scheduling engine ────────────────────────────────────────────────────

function scheduleMessage(row) {
  const id = row.id;
  const at = new Date(row.scheduled_at).getTime();
  const delay = at - Date.now();
  if (delay <= 0) return null; // Will fire immediately

  const timer = setTimeout(() => fireSchedule(id), delay);
  timer.unref(); // Don't block process exit
  return timer;
}

async function fireSchedule(id) {
  const entry = schedules.get(id);
  if (!entry || entry.isStale?.()) return;

  const { guildId, channelId, content, embedJson, recurrence, client } = entry;
  entry.failCount = entry.failCount || 0;

  if (!client) {
    console.warn(`[scheduler] No client for schedule #${id} — cannot send`);
    return;
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.warn(`[scheduler] Guild ${guildId} not found for schedule #${id} — disabling immediately`);
      disableForever(entry, id);
      return;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      console.warn(`[scheduler] Channel ${channelId} not found for schedule #${id} — disabling immediately`);
      disableForever(entry, id);
      return;
    }

    // Send the message (plain or embed)
    if (embedJson) {
      try {
        const embedData = db.safeJsonParse(embedJson, null);
        const embed = new EmbedBuilder(embedData);
        await safe.send(channel, { content: content || null, embeds: [embed] }, `scheduled #${id}`);
      } catch {
        // Embed parse failed — fall back to plain text
        await safe.send(channel, { content }, `scheduled #${id}`);
      }
    } else {
      await safe.send(channel, { content }, `scheduled #${id}`);
    }

    // Reset failure count on successful send
    entry.failCount = 0;

    console.log(`[scheduler] Sent scheduled message #${id} to #${channel.name}`);

    // Update last_sent_at
    const now = new Date().toISOString();
    await db.updateScheduledMessage(id, { last_sent_at: now });

    // Reschedule if recurring
    if (entry.recurrence) {
      const nextAt = nextRecurrence(entry.scheduledAt, entry.recurrence);
      if (nextAt) {
        await db.updateScheduledMessage(id, { scheduled_at: nextAt, last_sent_at: now });
        entry.scheduledAt = nextAt;
        const timer = scheduleMessage({ id, scheduled_at: nextAt });
        if (timer) {
          entry.timer = timer;
          schedules.set(id, entry);
          console.log(`[scheduler] Rescheduled recurring #${id} for ${nextAt}`);
        }
      }
    } else {
      // One-shot — disable after sending
      entry.enabled = 0;
      entry.timer = null;
      await db.updateScheduledMessage(id, { enabled: 0, last_sent_at: now });
      schedules.delete(id);
      console.log(`[scheduler] One-shot schedule #${id} completed`);
    }
  } catch (err) {
    console.error(`[scheduler] Failed to send schedule #${id}:`, err.message);
    handleSendFailure(entry, id);
  }
}

// Increment failure counter; disable schedule after max consecutive failures.
async function handleSendFailure(entry, id) {
  entry.failCount = (entry.failCount || 0) + 1;
  if (entry.failCount >= MAX_CONSECUTIVE_FAILURES) {
    console.error(`[scheduler] Disabling schedule #${id} after ${entry.failCount} consecutive failures`);
    await disableSchedule(id, entry);
  }
}

// Disable immediately for permanent failures (missing guild/channel).
async function disableForever(entry, id) {
  console.error(`[scheduler] Disabling schedule #${id} — permanent failure`);
  await disableSchedule(id, entry);
}

async function disableSchedule(id, entry) {
  entry.enabled = 0;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  await db.updateScheduledMessage(id, { enabled: 0 });
  schedules.delete(id);
}

// ─── Public API ───────────────────────────────────────────────────────────

let clientRef = null;
let maintenanceTimer = null;

// Hourly maintenance tick (BOT_SPEC §0.3): checkpoint the WAL so it doesn't grow
// unbounded on long-running installs. Uses setInterval (unref'd) so it never
// blocks process exit. Idempotent — safe to call from load()/reload().
function startMaintenance() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(() => {
    try { db.checkpoint(); } catch { /* best-effort */ }
  }, 60 * 60_000);
  maintenanceTimer.unref();
}

function stopMaintenance() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}

async function load(client) {
  clientRef = client;
  startMaintenance();
  try {
    const rows = await db.getAllScheduledMessages();
    for (const row of rows) {
      const existing = schedules.get(row.id);
      if (existing?.timer) clearTimeout(existing.timer);

      const entry = scheduleEntry(client, row);
      const timer = scheduleMessage(row);
      if (timer) {
        entry.timer = timer;
        schedules.set(row.id, entry);
      } else if (new Date(row.scheduled_at) <= new Date()) {
        // Past due — fire immediately
        console.log(`[scheduler] Past-due schedule #${row.id} — firing now`);
        schedules.set(row.id, entry);
        fireSchedule(row.id);
      }
    }
    console.log(`[scheduler] Loaded ${schedules.size} active schedules`);
  } catch (err) {
    console.error("[scheduler] Failed to load schedules:", err.message);
  }
}

async function reload() {
  schedulesGeneration++;
  for (const [, entry] of schedules) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  schedules.clear();
  return load(clientRef);
}

// Track the generation at creation so stale timer callbacks (from a previous
// reload()) exit early instead of operating on stale or missing entries.
function scheduleEntry(client, row) {
  const gen = schedulesGeneration;
  return {
    ...row, client, timer: null, gen,
    isStale() { return gen !== schedulesGeneration; },
  };
}

async function create(guildId, channelId, content, scheduledAt, recurrence, createdBy, embedJson) {
  const id = await db.addScheduledMessage(guildId, channelId, content, scheduledAt, recurrence, createdBy, embedJson);
  const entry = scheduleEntry(clientRef, {
    id, guildId, channelId, content, embedJson,
    scheduledAt, recurrence, enabled: 1, createdBy,
  });
  const timer = scheduleMessage({ id, scheduled_at: scheduledAt });
  if (timer) {
    entry.timer = timer;
    schedules.set(id, entry);
  }
  return entry;
}

async function remove(id) {
  const entry = schedules.get(id);
  if (entry?.timer) clearTimeout(entry.timer);
  schedules.delete(id);
  await db.deleteScheduledMessage(id);
}

function getForGuild(guildId) {
  const results = [];
  for (const [, entry] of schedules) {
    if (entry.guildId === guildId) {
      results.push({
        id: entry.id,
        channelId: entry.channelId,
        content: entry.content,
        embedJson: entry.embedJson,
        scheduledAt: entry.scheduledAt,
        recurrence: entry.recurrence,
        enabled: entry.enabled,
        createdBy: entry.createdBy,
        lastSentAt: entry.last_sent_at,
      });
    }
  }
  return results;
}

function count() {
  return schedules.size;
}

module.exports = {
  load,
  reload,
  create,
  remove,
  getForGuild,
  count,
  startMaintenance,
  stopMaintenance,
  parseScheduleTime,
  buildScheduledAt,
  parseTime,
  nextRecurrence,
  DAY_NAMES,
};
