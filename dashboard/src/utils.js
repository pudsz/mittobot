/**
 * Format a millisecond timestamp to a readable date+time string.
 * @param {number|string} ts - Unix timestamp in milliseconds
 * @returns {string}
 */
export function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Build a query string suffix for guild-scoped API requests.
 * @param {string} guildId
 * @returns {string}
 */
export function guildQuery(guildId) {
  return guildId ? `?guildId=${guildId}` : "";
}
