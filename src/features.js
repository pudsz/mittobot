const settings = require("./settings");

// ─── Toggleable command categories (shown as cards in the dashboard "Commands" tab)
// Core utility/moderation commands have no category and are always enabled.
const CATEGORIES = {
  fun: {
    key:         "funEnabled",
    label:       "Fun",
    description: "Games and silly commands: 8ball, dice, rps, memes, jokes, cat/dog, ship, and more.",
  },
  info: {
    key:         "infoEnabled",
    label:       "Info & Utility",
    description: "Lookup commands: userinfo, serverinfo, roleinfo, avatar, banner, botinfo, membercount.",
  },
  fakemod: {
    key:         "fakeModEnabled",
    label:       "Fake Moderation",
    description: "Visual-only mod commands (warn, kick, ban, mute, timeout…) that take no real action.",
  },
  leveling: {
    key:         "levelingEnabled",
    label:       "Leveling & XP",
    description: "XP per message, level-up roles/rewards, leaderboard, rank cards. $rank, $levels, $givexp, $setlevel.",
  },
};

function listCategories() {
  return Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c }));
}

function getCategory(id) {
  return CATEGORIES[id] || null;
}

// A category with no settings key, or an unknown id, is treated as always-on.
function isEnabled(id) {
  const cat = CATEGORIES[id];
  if (!cat) return true;
  return settings.get(cat.key) !== false;
}

module.exports = { CATEGORIES, listCategories, getCategory, isEnabled };
