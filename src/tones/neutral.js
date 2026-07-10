// Neutral tone — the bot's default voice. Complete/canonical key list:
// every key used anywhere via tone.t() must exist here, since the other
// packs fall back to this one.
module.exports = {
  meta: {
    id: "neutral",
    name: "Neutral",
    emoji: "💬",
    description: "Clean and to the point — no fluff, no attitude.",
  },
  emoji: {
    success: "✅",
    error: "❌",
    warn: "⚠️",
    info: "ℹ️",
    loading: "⏳",
  },
  strings: {
    // ── Router denials ──
    "deny.disabled": [
      "That command is turned off in this server.",
      "This command isn't enabled here.",
    ],
    "deny.category": [
      "That group of commands is switched off right now.",
      "Those commands are currently disabled here.",
    ],
    "deny.channel": [
      "That command doesn't work in this channel.",
      "You'll have to use that one somewhere else — it's not allowed in this channel.",
    ],
    "deny.permission": [
      "You don't have permission to use that.",
      "That one's above your pay grade — you don't have access to it.",
    ],
    "deny.cooldown": [
      "Hold on — you can use that again in **{remain}s**.",
      "That command is on cooldown. Try again in **{remain}s**.",
    ],
    "deny.default": [
      "You can't use that command right now.",
    ],

    // ── Generic errors / status ──
    "error.generic": [
      "Something went wrong on my end. Give it another try in a moment.",
      "That didn't work — something broke while I was handling it.",
      "I hit an error running that. Try again?",
    ],
    "error.api": [
      "Couldn't reach {what} right now — try again in a bit.",
      "{what} isn't responding at the moment. Give it a minute.",
    ],
    "error.maintenance": [
      "I'm undergoing maintenance right now — check back soon.",
    ],

    // ── Common success framing ──
    "success.generic": [
      "Done.",
      "All set.",
      "Got it — done.",
    ],
    "success.saved": [
      "Saved.",
      "Changes saved.",
    ],

    // ── UI widgets ──
    "ui.notyours": [
      "This panel belongs to someone else — run the command yourself to get your own.",
      "Only the person who opened this can use it.",
    ],
    "ui.expired": [
      "This panel has expired — run the command again to reopen it.",
    ],
    "ui.noperm": [
      "You don't have permission to use these controls.",
    ],
    "ui.cancelled": [
      "Cancelled — nothing was changed.",
    ],
    "ui.confirmed": [
      "Confirmed.",
    ],
  },
};
