// ─── Safe wrappers for Discord API calls ─────────────────────────────────────
// Replaces silent .catch(() => null) with actionable error logging.
// Every function returns a promise that resolves to null on failure so that
// callers can destructure / check the result without crashing.
//
// Usage:
//   const member = await safe.fetch(memberPromise, "fetch member");
//   safe.send(ch, embed, "log embed");  // fire-and-forget

function orNull(promise, label) {
  return promise.catch(err => {
    console.error(`[safe] ${label}: ${err.message || err}`);
    return null;
  });
}

// ─── Discord API convenience wrappers ────────────────────────────────────────
// Each includes a human-readable context label so you can tell what failed.

function send(channel, payload, label) {
  const ctx = label || `send to #${channel?.name || channel?.id || "?"}`;
  return orNull(channel?.send?.(payload), ctx);
}

function reply(message, payload, label) {
  const ctx = label || `reply to ${message?.author?.tag || "?"}`;
  return orNull(message?.reply?.(payload), ctx);
}

function edit(msg, payload, label) {
  const ctx = label || `edit msg ${msg?.id || "?"}`;
  return orNull(msg?.edit?.(payload), ctx);
}

function deleteMsg(msg, label) {
  const ctx = label || `delete msg ${msg?.id || "?"}`;
  return orNull(msg?.delete?.(), ctx);
}

function react(message, emoji, label) {
  const ctx = label || `react to msg ${message?.id || "?"}`;
  return orNull(message?.react?.(emoji), ctx);
}

function timeout(member, ms, reason, label) {
  const ctx = label || `timeout ${member?.user?.tag || member?.id || "?"}`;
  return orNull(member?.timeout?.(ms, reason), ctx);
}

function ban(member, options, label) {
  const ctx = label || `ban ${member?.user?.tag || member?.id || "?"}`;
  return orNull(member?.ban?.(options), ctx);
}

function kick(member, reason, label) {
  const ctx = label || `kick ${member?.user?.tag || member?.id || "?"}`;
  return orNull(member?.kick?.(reason), ctx);
}

function addRole(member, role, reason, label) {
  const ctx = label || `add role to ${member?.user?.tag || member?.id || "?"}`;
  return orNull(member?.roles?.add?.(role, reason), ctx);
}

function removeRole(member, role, reason, label) {
  const ctx = label || `remove role from ${member?.user?.tag || member?.id || "?"}`;
  return orNull(member?.roles?.remove?.(role, reason), ctx);
}

module.exports = {
  orNull,
  send, reply, edit, delete: deleteMsg, react,
  timeout, ban, kick,
  addRole, removeRole,
};
