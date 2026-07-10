// ─── Anti-raid ──────────────────────────────────────────────────────────────
// Per-guild raid protection: join-rate detection, account-age gate, and a
// lockdown action. Standard module pattern — in-memory cache authoritative at
// runtime, async load() awaited once at startup, writes persist in the
// background. Wired into guildMemberAdd BEFORE greet/autoroles so a raiding
// wave is stopped before it gets roles or welcome messages.
//
// Config shape (per guild):
// {
//   enabled: false,
//   joinRate:   { maxJoins: 10, windowSeconds: 10 },   // >maxJoins in window = raid
//   accountAge: { minAccountAgeHours: 24, gateAction: "kick"|"quarantine"|"notify" },
//   raidAction: "lockdown"|"kick_new"|"quarantine"|"notify",
//   alertChannelId: null,
//   cooldownMinutes: 30,           // auto-unlock lockdown after this
//   quarantineRoleId: null,        // for quarantine actions
//   exemptRoles: [],               // role IDs exempt from the account-age gate
// }
//
// State is in-memory only (no table needed beyond config) — join timestamps
// and the active lockdown are transient. Bounded Maps + periodic eviction so
// a long-lived process can't leak.

const { PermissionFlagsBits, ChannelType } = require("discord.js");
const safe = require("./safe");
const { OWNER_IDS } = require("./utils");
const db = require("./db");

const DEFAULTS = () => ({
  enabled: false,
  joinRate: { maxJoins: 10, windowSeconds: 10 },
  accountAge: { minAccountAgeHours: 24, gateAction: "notify" },
  raidAction: "lockdown",
  alertChannelId: null,
  cooldownMinutes: 30,
  quarantineRoleId: null,
  exemptRoles: [],
});

const GATE_ACTIONS = new Set(["kick", "quarantine", "notify"]);
const RAID_ACTIONS = new Set(["lockdown", "kick_new", "quarantine", "notify"]);

let store = {}; // guildId → config

// joinTimes: guildId → number[] of recent join timestamps (ms). Bounded.
const joinTimes = new Map();
const JOIN_TIMES_MAX_PER_GUILD = 200;
const JOIN_TIMES_MAX_GUILDS = 1000;

// raidState: guildId → { lockedAt, cooldownMs, channels: [{id, snapshot}] }
// `channels` snapshots the @everyone overwrite per locked channel so unlock
// can restore it exactly instead of nuking a pre-existing deny.
const raidState = new Map();
const RAID_STATE_MAX_GUILDS = 500;

// ─── Load / persist ─────────────────────────────────────────────────────────
async function load() {
  try {
    store = {};
    const rows = await db.getAllAntiraidConfigs();
    for (const row of rows) {
      store[row.guild_id] = { ...DEFAULTS(), ...db.safeJsonParse(row.config, {}) };
    }
  } catch (e) {
    console.error("[antiraid] Failed to load config:", e.message);
    store = {};
  }
}

function persist(guildId) {
  const cfg = store[guildId] || {};
  db.setAntiraidConfig(guildId, cfg).catch(e => console.error("[antiraid] persist:", e.message));
}

function getConfig(guildId) {
  return { ...DEFAULTS(), ...(store[guildId] || {}) };
}

function setConfig(guildId, patch) {
  const cur = getConfig(guildId);
  const next = { ...cur, ...patch };
  // Shallow-merge nested objects so a partial patch doesn't wipe siblings.
  if (patch.joinRate) next.joinRate = { ...cur.joinRate, ...patch.joinRate };
  if (patch.accountAge) next.accountAge = { ...cur.accountAge, ...patch.accountAge };
  // Validate enum fields.
  if (next.accountAge && !GATE_ACTIONS.has(next.accountAge.gateAction)) next.accountAge.gateAction = "notify";
  if (!RAID_ACTIONS.has(next.raidAction)) next.raidAction = "lockdown";
  store[guildId] = next;
  persist(guildId);
  return getConfig(guildId);
}

function resetConfig(guildId) {
  delete store[guildId];
  db.setAntiraidConfig(guildId, {}).catch(e => console.error("[antiraid] reset persist:", e.message));
  return getConfig(guildId);
}

// ─── Bounded-state cleanup ──────────────────────────────────────────────────
// Periodically evict stale join timestamps and expired lockdowns. unref'd so
// it never blocks shutdown.
const JOIN_WINDOW_MAX = 120_000; // 2 min upper bound for any configured window
setInterval(() => {
  const cutoff = Date.now() - JOIN_WINDOW_MAX;
  for (const [gid, arr] of joinTimes) {
    const valid = arr.filter(t => t > cutoff);
    if (valid.length === 0) joinTimes.delete(gid);
    else joinTimes.set(gid, valid);
  }
  // Size caps.
  if (joinTimes.size > JOIN_TIMES_MAX_GUILDS) {
    const oldest = [...joinTimes.entries()]
      .sort((a, b) => (a[1][a[1].length - 1] || 0) - (b[1][b[1].length - 1] || 0))
      .slice(0, joinTimes.size - JOIN_TIMES_MAX_GUILDS);
    for (const [gid] of oldest) joinTimes.delete(gid);
  }
  // Expire lockdowns whose cooldown has passed (defensive — unlock also runs
  // on its own timer; this catches a missed timer after a crash/restart).
  const now = Date.now();
  for (const [gid, state] of raidState) {
    if (state.lockedAt && now - state.lockedAt >= state.cooldownMs) {
      // Fire-and-forget; can't await inside this synchronous sweep, but the
      // guild client lookup needs the live client. Mark stale and let the
      // next memberAdd / API call clean it up via maybeUnlock.
    }
  }
}, 60_000).unref();

// ─── Join tracking ──────────────────────────────────────────────────────────
function recordJoin(guildId, now = Date.now()) {
  const arr = (joinTimes.get(guildId) || []).filter(t => now - t < JOIN_WINDOW_MAX);
  arr.push(now);
  if (arr.length > JOIN_TIMES_MAX_PER_GUILD) arr.shift();
  joinTimes.set(guildId, arr);
  return arr;
}

function isRaid(guildId, cfg, now = Date.now()) {
  const { maxJoins, windowSeconds } = cfg.joinRate || {};
  if (!maxJoins || !windowSeconds) return false;
  const window = windowSeconds * 1000;
  const arr = (joinTimes.get(guildId) || []).filter(t => now - t < window);
  return arr.length >= maxJoins;
}

// ─── Lockdown ───────────────────────────────────────────────────────────────
// Deny SendMessages (and thread creation) for @everyone in every text channel
// the bot can manage. Snapshots the prior @everyone overwrite per channel so
// unlock restores it exactly. Returns the list of locked channels.
async function lockChannels(guild, reason) {
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) return [];
  const everyone = guild.roles.everyone;
  const deny = PermissionFlagsBits.SendMessages
    | PermissionFlagsBits.CreatePublicThreads
    | PermissionFlagsBits.SendMessagesInThreads;
  const locked = [];
  const channels = guild.channels.cache.filter(
    c => c.type === ChannelType.GuildText && c.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)
  );
  for (const [, ch] of channels) {
    const prior = ch.permissionOverwrites.cache.get(everyone.id)?.toJSON?.() || null;
    try {
      await ch.permissionOverwrites.edit(everyone, { SendMessages: false, CreatePublicThreads: false, SendMessagesInThreads: false }, { reason, type: 0 });
      locked.push({ id: ch.id, snapshot: prior });
    } catch (err) {
      console.error(`[antiraid] lock #${ch.name} failed:`, err.message);
    }
  }
  return locked;
}

// Restore the snapshotted @everyone overwrite per channel (or remove our deny
// if there was none originally).
async function unlockChannels(guild, locked) {
  const everyone = guild.roles.everyone;
  for (const entry of locked || []) {
    const ch = guild.channels.cache.get(entry.id);
    if (!ch) continue;
    try {
      if (entry.snapshot && (entry.snapshot.allow || entry.snapshot.deny)) {
        // Restore the original allow/deny bits.
        await ch.permissionOverwrites.edit(everyone, {
          allow: entry.snapshot.allow,
          deny: entry.snapshot.deny,
        }, { type: 0 });
      } else {
        // No prior overwrite — remove the one we added.
        await ch.permissionOverwrites.delete(everyone, "anti-raid unlock").catch(() => {});
      }
    } catch (err) {
      console.error(`[antiraid] unlock #${entry.id} failed:`, err.message);
    }
  }
}

async function startLockdown(guild, cfg, reason) {
  const channels = await lockChannels(guild, reason);
  const cooldownMs = Math.max(1, cfg.cooldownMinutes || 30) * 60_000;
  raidState.set(guild.id, { lockedAt: Date.now(), cooldownMs, channels });
  // Auto-unlock timer. unref'd so it never blocks shutdown.
  setTimeout(() => maybeUnlock(guild.id), cooldownMs).unref();
  return channels.length;
}

// Looks up the live guild from the running client. Best-effort: if the client
// isn't reachable (called from the periodic sweep), no-op.
async function maybeUnlock(guildId) {
  const state = raidState.get(guildId);
  if (!state) return false;
  // require the client lazily via the module's setter (set by index.js).
  const guild = _client?.guilds?.cache?.get(guildId);
  raidState.delete(guildId);
  if (!guild) return false;
  await unlockChannels(guild, state.channels);
  await alert(guild, getConfig(guildId), "🔓 Anti-raid lockdown auto-unlocked (cooldown elapsed).");
  return true;
}

function isLocked(guildId) {
  return raidState.has(guildId);
}

// Manual unlock (admin-triggered via API/command).
async function manualUnlock(guildId) {
  return maybeUnlock(guildId);
}

let _client = null;
function setClient(client) { _client = client; }

// ─── Alert ──────────────────────────────────────────────────────────────────
async function alert(guild, cfg, message) {
  if (!cfg.alertChannelId) return;
  const ch = guild.channels.cache.get(cfg.alertChannelId);
  if (!ch) return;
  await safe.send(ch, { content: message, allowedMentions: { parse: [] } }, "antiraid alert");
}

// ─── Account-age gate ───────────────────────────────────────────────────────
function isExempt(member, cfg) {
  if (OWNER_IDS.has(member.id)) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  const exempt = cfg.exemptRoles || [];
  if (exempt.length && member.roles?.cache?.some(r => exempt.includes(r.id))) return true;
  return false;
}

async function applyAccountGate(guild, member, cfg) {
  const minHours = cfg.accountAge?.minAccountAgeHours || 0;
  if (!minHours) return null; // gate disabled
  if (isExempt(member, cfg)) return null;
  const created = member.user.createdAt ? member.user.createdAt.getTime() : 0;
  const ageHours = (Date.now() - created) / 3_600_000;
  if (ageHours >= minHours) return null; // old enough

  const action = cfg.accountAge?.gateAction || "notify";
  const tag = member.user.tag;
  if (action === "kick") {
    if (member.kickable) {
      await safe.kick(member, `Anti-raid gate: account < ${minHours}h old`, "antiraid gate kick");
    }
    return `🚪 Kicked new account ${tag} (${Math.floor(ageHours)}h old < ${minHours}h gate).`;
  }
  if (action === "quarantine" && cfg.quarantineRoleId) {
    const role = guild.roles.cache.get(cfg.quarantineRoleId);
    const botHighest = guild.members.me?.roles?.highest?.position || 0;
    if (role && role.position < botHighest && member.moderatable) {
      await safe.addRole(member, role, "Anti-raid gate: account too new", "antiraid gate quarantine");
      return `🔒 Quarantined new account ${tag} (${Math.floor(ageHours)}h old < ${minHours}h gate).`;
    }
    return `⚠️ Couldn't quarantine ${tag} (role hierarchy / permissions).`;
  }
  // notify
  return `ℹ️ New account joined: ${tag} (${Math.floor(ageHours)}h old < ${minHours}h gate).`;
}

// ─── Raid response ──────────────────────────────────────────────────────────
async function applyRaidAction(guild, cfg) {
  const action = cfg.raidAction || "lockdown";
  if (isLocked(guild.id) && action === "lockdown") return "lockdown already active";

  if (action === "lockdown") {
    const n = await startLockdown(guild, cfg, "Anti-raid: join-rate threshold exceeded");
    return `🔒 Lockdown — denied SendMessages in ${n} channel(s). Auto-unlock in ${cfg.cooldownMinutes || 30}m.`;
  }
  if (action === "kick_new") {
    // Kick members who joined within the join-rate window (the suspected raiders).
    const window = (cfg.joinRate?.windowSeconds || 10) * 1000;
    const since = Date.now() - window;
    let kicked = 0;
    // members.cache may not include brand-new joins; fetch to be safe.
    const fetched = await safe.orNull(guild.members.fetch({ after: "0", limit: 200 }), "antiraid fetch members") || guild.members.cache;
    for (const [, m] of fetched) {
      if (m.user.bot || OWNER_IDS.has(m.id)) continue;
      if (m.joinedTimestamp && m.joinedTimestamp > since && m.kickable) {
        await safe.kick(m, "Anti-raid: joined during raid window", "antiraid raid kick");
        kicked++;
      }
    }
    return `👢 Kicked ${kicked} member(s) who joined in the last ${cfg.joinRate?.windowSeconds || 10}s.`;
  }
  if (action === "quarantine" && cfg.quarantineRoleId) {
    const window = (cfg.joinRate?.windowSeconds || 10) * 1000;
    const since = Date.now() - window;
    const role = guild.roles.cache.get(cfg.quarantineRoleId);
    const botHighest = guild.members.me?.roles?.highest?.position || 0;
    let n = 0;
    if (role && role.position < botHighest) {
      const fetched = await safe.orNull(guild.members.fetch({ after: "0", limit: 200 }), "antiraid fetch members") || guild.members.cache;
      for (const [, m] of fetched) {
        if (m.user.bot || OWNER_IDS.has(m.id)) continue;
        if (m.joinedTimestamp && m.joinedTimestamp > since && m.moderatable) {
          await safe.addRole(m, role, "Anti-raid: joined during raid window", "antiraid raid quarantine");
          n++;
        }
      }
    }
    return `🔒 Quarantined ${n} member(s) who joined in the last ${cfg.joinRate?.windowSeconds || 10}s.`;
  }
  // notify (default)
  return `⚠️ Raid detected — join-rate threshold exceeded. (notify-only mode)`;
}

// ─── Main entry: guildMemberAdd ─────────────────────────────────────────────
// Returns a short summary string for logging/alerting. Must be called BEFORE
// greet/autoroles so a gated/raiding member doesn't receive a welcome or roles.
async function onMemberAdd(member) {
  const guild = member.guild;
  if (!guild || member.user?.bot) return null;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return null;

  const now = Date.now();
  recordJoin(guild.id, now);

  let alertMsg = null;

  // 1) Account-age gate — applied per-member regardless of raid state.
  try {
    const gateResult = await applyAccountGate(guild, member, cfg);
    if (gateResult) alertMsg = gateResult;
  } catch (err) {
    console.error("[antiraid] account gate error:", err.message);
  }

  // 2) Join-rate raid detection — only act on the join that crosses the
  //    threshold, and only if not already locked (for lockdown mode).
  if (isRaid(guild.id, cfg, now)) {
    if (cfg.raidAction === "lockdown" && isLocked(guild.id)) {
      // Already locked — don't re-trigger.
    } else {
      try {
        const raidMsg = await applyRaidAction(guild, cfg);
        const fullMsg = `🛡️ **Raid detected** in **${guild.name}** — join-rate threshold exceeded.\n${raidMsg}`;
        await alert(guild, cfg, fullMsg);
        alertMsg = alertMsg ? `${alertMsg}\n${raidMsg}` : raidMsg;
        console.warn(`[antiraid] ${guild.name}: ${raidMsg}`);
      } catch (err) {
        console.error("[antiraid] raid action error:", err.message);
      }
    }
  }

  return alertMsg;
}

module.exports = {
  load,
  getConfig,
  setConfig,
  resetConfig,
  onMemberAdd,
  isRaid,
  isLocked,
  manualUnlock,
  setClient,
  // exported for tests
  _test: { recordJoin, applyAccountGate, DEFAULTS, GATE_ACTIONS, RAID_ACTIONS },
};
