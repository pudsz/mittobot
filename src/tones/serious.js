// Serious tone — formal and professional. Missing keys fall back to neutral.
module.exports = {
  meta: {
    id: "serious",
    name: "Serious",
    emoji: "🏛️",
    description: "Formal and professional — suited to strictly-run servers.",
  },
  emoji: {
    success: "✅",
    error: "🚫",
    warn: "⚠️",
    info: "📋",
    loading: "⏳",
  },
  strings: {
    "deny.disabled": [
      "This command has been disabled by server administration.",
    ],
    "deny.category": [
      "This command category is currently disabled by server administration.",
    ],
    "deny.channel": [
      "This command is not permitted in this channel.",
    ],
    "deny.permission": [
      "You lack the required permission to use this command.",
      "Access denied — insufficient permissions.",
    ],
    "deny.cooldown": [
      "This command is rate-limited. Please retry in **{remain}s**.",
    ],
    "deny.default": [
      "This command is unavailable at this time.",
    ],

    "error.generic": [
      "An internal error occurred while processing the command. Please retry.",
      "The operation could not be completed due to an internal error.",
    ],
    "error.api": [
      "The external service ({what}) is currently unreachable. Please retry later.",
    ],
    "error.maintenance": [
      "The bot is undergoing scheduled maintenance. Service will resume shortly.",
    ],

    "success.generic": [
      "Operation completed.",
      "Completed successfully.",
    ],
    "success.saved": [
      "Configuration saved.",
    ],

    "ui.notyours": [
      "This panel is controlled by another user. Run the command to open your own.",
    ],
    "ui.expired": [
      "This panel has expired. Run the command again to continue.",
    ],
    "ui.noperm": [
      "You are not authorized to use these controls.",
    ],
    "ui.cancelled": [
      "Operation cancelled. No changes were made.",
    ],
    "ui.confirmed": [
      "Operation confirmed.",
    ],
  },
};
