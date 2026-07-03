// ─── Event Bus & Live Feed (BOT_SPEC §10) ───────────────────────────────────
// Tiny in-process pub/sub with a per-guild ring buffer. Every system that does
// something visible publishes an event here; the dashboard's live activity
// console (SSE) and the /api/activity endpoint consume it.
//
// Deliberately dependency-free and synchronous — publish() must never throw or
// block the hot path. Subscribers (SSE connections) are notified best-effort.

const RING_LIMIT = 200;        // events retained per guild
const MAX_GUILDS = 500;        // cap distinct guild buffers to bound memory

// guildId -> Array<event> (newest last)
const buffers = new Map();
// Set of subscriber callbacks: fn(event) — event includes guildId
const subscribers = new Set();

let seq = 0;

// Known event types (for reference / dashboard filtering). Not enforced.
const EVENT_TYPES = [
  "member_join", "member_leave", "automod", "mod_action", "ai_reply",
  "level_up", "ticket_open", "ticket_close", "giveaway_end", "music_play",
  "raid_alert", "starboard", "suggestion", "schedule_fired", "backup",
];

function ringFor(guildId) {
  let ring = buffers.get(guildId);
  if (!ring) {
    // Evict the oldest guild buffer if we're over the cap (rough LRU by insertion).
    if (buffers.size >= MAX_GUILDS) {
      const oldestKey = buffers.keys().next().value;
      if (oldestKey !== undefined) buffers.delete(oldestKey);
    }
    ring = [];
    buffers.set(guildId, ring);
  }
  return ring;
}

/**
 * Publish an event to the bus + per-guild ring buffer.
 * @param {string} guildId
 * @param {{type: string, summary: string, data?: object}} evt
 * @returns {object|null} the stored event, or null if it was dropped
 */
function publish(guildId, evt) {
  try {
    if (!guildId || !evt || !evt.type) return null;
    const event = {
      id: ++seq,
      guildId: String(guildId),
      type: String(evt.type),
      summary: String(evt.summary || evt.type),
      data: evt.data && typeof evt.data === "object" ? evt.data : {},
      ts: Date.now(),
    };

    const ring = ringFor(event.guildId);
    ring.push(event);
    if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);

    for (const fn of subscribers) {
      try { fn(event); } catch { /* a broken subscriber must not affect others */ }
    }
    return event;
  } catch {
    // The event bus is best-effort; never let it crash a caller.
    return null;
  }
}

/**
 * Subscribe to all published events. Returns an unsubscribe function.
 * @param {(event: object) => void} fn
 */
function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Get the most recent events for a guild (newest first).
 * @param {string} guildId
 * @param {number} limit
 */
function getRecent(guildId, limit = 50) {
  const ring = buffers.get(String(guildId));
  if (!ring || !ring.length) return [];
  const n = Math.max(1, Math.min(Number(limit) || 50, RING_LIMIT));
  return ring.slice(-n).reverse();
}

function subscriberCount() {
  return subscribers.size;
}

module.exports = {
  EVENT_TYPES,
  RING_LIMIT,
  publish,
  subscribe,
  getRecent,
  subscriberCount,
};
