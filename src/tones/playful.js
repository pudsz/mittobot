// Playful tone — casual, a little cheeky. Missing keys fall back to neutral.
module.exports = {
  meta: {
    id: "playful",
    name: "Playful",
    emoji: "🎉",
    description: "Casual and cheeky — the bot has fun with you.",
  },
  emoji: {
    success: "🎉",
    error: "💥",
    warn: "😬",
    info: "💡",
    loading: "🌀",
  },
  strings: {
    "deny.disabled": [
      "That command's switched off here, sorry!",
      "Nope — somebody turned that one off in this server.",
      "That one's napping right now (disabled).",
    ],
    "deny.category": [
      "That whole command family is off right now. Blame the admins!",
      "Those commands are taking a break — they've been disabled here.",
    ],
    "deny.channel": [
      "Not in here! Try that command in another channel.",
      "Wrong room for that one — it's blocked in this channel.",
      "Shh, not in this channel. Take it somewhere else!",
    ],
    "deny.permission": [
      "Nice try, but you don't have the keys for that one. 🔑",
      "That's locked for you, sorry! Ask someone with more power.",
      "You wish! You don't have permission for that.",
    ],
    "deny.cooldown": [
      "Whoa whoa, slow down! Try again in **{remain}s**. ⏳",
      "Easy there, speedster — **{remain}s** left on the cooldown.",
      "Patience! You've got **{remain}s** to go.",
    ],
    "deny.default": [
      "Can't do that right now, sorry!",
    ],

    "error.generic": [
      "Oops — I tripped over my own wires. 😵 Try again?",
      "Well, that exploded. Give it another shot in a sec!",
      "Yikes, something broke on my end. Not your fault, promise!",
    ],
    "error.api": [
      "{what} is ghosting me right now 👻 — try again in a bit.",
      "Couldn't wake up {what}. Give it a minute and retry!",
    ],
    "error.maintenance": [
      "I'm in the shop getting my oil changed 🔧 — back soon!",
    ],

    "success.generic": [
      "Boom, done! 💪",
      "Easy. Done!",
      "Consider it handled. 😎",
    ],
    "success.saved": [
      "Saved it! ✨",
      "Locked in. 📝",
    ],

    "ui.notyours": [
      "Hey, hands off — this panel isn't yours! Run the command to get your own.",
      "Nuh-uh, this one belongs to someone else. 🙅",
    ],
    "ui.expired": [
      "This panel fell asleep 💤 — run the command again to wake it up.",
    ],
    "ui.noperm": [
      "These buttons are above your pay grade, sorry! 🔒",
    ],
    "ui.cancelled": [
      "Cancelled! Nothing happened, promise. 🤞",
    ],
    "ui.confirmed": [
      "You got it! ✅",
    ],
  },
};
