// ─── Input Validation Functions ─────────────────────────────────────────────
// Centralized validation for common input types to prevent invalid data
// from propagating through the system.

/**
 * Validate Discord user ID
 * @param {string} id - The user ID to validate
 * @returns {boolean} True if valid
 */
function isValidUserId(id) {
  return typeof id === "string" && /^\d{17,20}$/.test(id);
}

/**
 * Validate Discord channel ID
 * @param {string} id - The channel ID to validate
 * @returns {boolean} True if valid
 */
function isValidChannelId(id) {
  return typeof id === "string" && /^\d{17,20}$/.test(id);
}

/**
 * Validate Discord role ID
 * @param {string} id - The role ID to validate
 * @returns {boolean} True if valid
 */
function isValidRoleId(id) {
  return typeof id === "string" && /^\d{17,20}$/.test(id);
}

/**
 * Validate Discord guild ID
 * @param {string} id - The guild ID to validate
 * @returns {boolean} True if valid
 */
function isValidGuildId(id) {
  return typeof id === "string" && /^\d{17,20}$/.test(id);
}

/**
 * Validate duration string (e.g., "10m", "1h", "30s")
 * @param {string} str - The duration string to validate
 * @returns {boolean} True if valid
 */
function isValidDuration(str) {
  if (typeof str !== "string") return false;
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return false;
  const val = parseInt(match[1], 10);
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ms = val * units[match[2].toLowerCase()];
  return ms >= 1_000 && ms <= 28 * 86_400_000; // Between 1 second and 28 days
}

/**
 * Validate Discord message ID
 * @param {string} id - The message ID to validate
 * @returns {boolean} True if valid
 */
function isValidMessageId(id) {
  return typeof id === "string" && /^\d{17,20}$/.test(id);
}

/**
 * Sanitize string input to prevent injection attacks
 * @param {string} str - The string to sanitize
 * @param {number} maxLength - Maximum allowed length (default: 1000)
 * @returns {string} Sanitized string
 */
function sanitizeString(str, maxLength = 1000) {
  if (typeof str !== "string") return "";
  // Remove null bytes and other control characters except newlines/tabs
  let sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }
  return sanitized;
}

/**
 * Validate and sanitize a Discord username or display name
 * @param {string} name - The name to validate
 * @returns {string|null} Sanitized name or null if invalid
 */
function isValidUsername(name) {
  if (typeof name !== "string") return null;
  if (name.length < 2 || name.length > 32) return null;
  // Discord allows most characters except some special ones
  if (/[\x00-\x1F\x7F]/.test(name)) return null;
  return sanitizeString(name, 32);
}

/**
 * Validate URL string
 * @param {string} url - The URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    // Only allow http/https protocols
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate number is within range
 * @param {number} num - The number to validate
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {boolean} True if valid
 */
function isInRange(num, min, max) {
  return typeof num === "number" && !isNaN(num) && num >= min && num <= max;
}

/**
 * Validate array has expected structure
 * @param {any} arr - The value to check
 * @param {number} minLength - Minimum length (default: 0)
 * @param {number} maxLength - Maximum length (default: Infinity)
 * @returns {boolean} True if valid array
 */
function isValidArray(arr, minLength = 0, maxLength = Infinity) {
  if (!Array.isArray(arr)) return false;
  return arr.length >= minLength && arr.length <= maxLength;
}

/**
 * Validate object has expected structure
 * @param {any} obj - The value to check
 * @param {string[]} requiredKeys - Keys that must be present
 * @returns {boolean} True if valid object
 */
function isValidObject(obj, requiredKeys = []) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
  for (const key of requiredKeys) {
    if (!(key in obj)) return false;
  }
  return true;
}

module.exports = {
  isValidUserId,
  isValidChannelId,
  isValidRoleId,
  isValidGuildId,
  isValidDuration,
  isValidMessageId,

  sanitizeString,
  isValidUsername,
  isValidUrl,
  isInRange,
  isValidArray,
  isValidObject,
};
