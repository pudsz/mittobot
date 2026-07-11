// Invite tracking — attribute member joins to the invite code (and inviter) that
// let them in. Discord doesn't tell us which invite a member used, so we keep an
// in-memory snapshot of every guild's invite uses and, on each join, re-fetch and
// diff to find the one code whose use-count incremented. Attribution rows persist
// in SQLite (member_invites); the cache is rebuilt from the API on startup.
//
// Requires the bot to have "Manage Server" so it can read guild invites — every
// path here degrades gracefully (logs + returns) when the fetch is denied.
const db = require("./db");
const safe = require("./safe");

// guildId → Map<code, uses>
const cache = new Map();

// Snapshot a single guild's current invite uses into the cache. Best-effort:
// missing permission or an API error just leaves that guild uncached.
async function cacheGuild(guild) {
  if (!guild) return;
  const invites = await safe.orNull(guild.invites.fetch(), `invites fetch ${guild.id}`);
  if (!invites) return; // likely missing Manage Server — skip silently
  const map = new Map();
  for (const inv of invites.values()) map.set(inv.code, inv.uses || 0);
  // Vanity URL (if any) has its own use counter and no code in the collection.
  if (guild.vanityURLCode) {
    const vanity = await safe.orNull(guild.fetchVanityData(), `invites vanity ${guild.id}`);
    if (vanity) map.set(guild.vanityURLCode, vanity.uses || 0);
  }
  cache.set(guild.id, map);
}

// On join, figure out which invite was used by diffing fresh uses against the
// cached snapshot, then record the attribution and refresh the cache.
async function onMemberAdd(member) {
  try {
    const guild = member.guild;
    if (!guild) return;

    const before = cache.get(guild.id) || new Map();
    const invites = await safe.orNull(guild.invites.fetch(), `invites fetch ${guild.id}`);
    if (!invites) return; // can't attribute without Manage Server — bail quietly

    // Build the "after" snapshot and find the first code whose uses went up.
    const after = new Map();
    let usedCode = null;
    let inviterId = null;
    for (const inv of invites.values()) {
      after.set(inv.code, inv.uses || 0);
      const prev = before.get(inv.code) || 0;
      if (usedCode === null && (inv.uses || 0) > prev) {
        usedCode = inv.code;
        inviterId = inv.inviter ? inv.inviter.id : null;
      }
    }
    // Vanity URL fallback — check it separately since it's not in the collection.
    if (usedCode === null && guild.vanityURLCode) {
      const vanity = await safe.orNull(guild.fetchVanityData(), `invites vanity ${guild.id}`);
      if (vanity) {
        after.set(guild.vanityURLCode, vanity.uses || 0);
        if ((vanity.uses || 0) > (before.get(guild.vanityURLCode) || 0)) usedCode = guild.vanityURLCode;
      }
    }

    cache.set(guild.id, after);

    // Record even when unattributed (usedCode null) so the join is still logged.
    db.recordMemberInvite(guild.id, member.id, inviterId, usedCode);
  } catch (e) {
    console.error("[invites] onMemberAdd:", e.message);
  }
}

// Keep the cache fresh as invites are created/revoked so the diff stays accurate.
function onInviteCreate(invite) {
  try {
    const gid = invite.guild?.id;
    if (!gid) return;
    if (!cache.has(gid)) cache.set(gid, new Map());
    cache.get(gid).set(invite.code, invite.uses || 0);
  } catch (e) {
    console.error("[invites] onInviteCreate:", e.message);
  }
}

function onInviteDelete(invite) {
  try {
    const gid = invite.guild?.id;
    if (!gid) return;
    cache.get(gid)?.delete(invite.code);
  } catch (e) {
    console.error("[invites] onInviteDelete:", e.message);
  }
}

// On ready, snapshot every guild the bot is in so the first join diffs correctly.
async function init(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      await cacheGuild(guild);
    }
  } catch (e) {
    console.error("[invites] init:", e.message);
  }
}

// How many members a given user has invited in this guild.
function countForUser(guildId, userId) {
  return db.getInviteCountForUser(guildId, userId);
}

function getLeaderboard(guildId, limit = 25) {
  return db.getInviteLeaderboard(guildId, limit);
}

module.exports = {
  cacheGuild,
  onMemberAdd,
  onInviteCreate,
  onInviteDelete,
  init,
  countForUser,
  getLeaderboard,
};
