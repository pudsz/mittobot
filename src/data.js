const fs   = require("fs");
const path = require("path");

const STICKY_FILE       = path.join(__dirname, "..", "stickies.json");
const WARNING_FILE      = path.join(__dirname, "..", "warnings.json");
const REACTIONLOG_FILE  = path.join(__dirname, "..", "reactionlogs.json");
const AFK_FILE          = path.join(__dirname, "..", "afk.json");
const CUSTOM_ROLES_FILE = path.join(__dirname, "..", "customroles.json");

function loadJSON(file, fallback = {}) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* ignore */ }
  return fallback;
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// Live data stores — mutate these directly, they're shared by reference via the `data` export
const data = {
  stickies:     {},
  warnings:     {},
  reactionlogs: {},
  afkUsers:     {},
  customRoles:  {},

  saveStickies()     { saveJSON(STICKY_FILE,       this.stickies); },
  saveWarnings()     { saveJSON(WARNING_FILE,       this.warnings); },
  saveReactionlogs() { saveJSON(REACTIONLOG_FILE,   this.reactionlogs); },
  saveAfk()          { saveJSON(AFK_FILE,           this.afkUsers); },
  saveCustomRoles()  { saveJSON(CUSTOM_ROLES_FILE,  this.customRoles); },

  load() {
    this.stickies     = loadJSON(STICKY_FILE);
    this.warnings     = loadJSON(WARNING_FILE);
    this.reactionlogs = loadJSON(REACTIONLOG_FILE);
    this.afkUsers     = loadJSON(AFK_FILE);
    this.customRoles  = loadJSON(CUSTOM_ROLES_FILE);
  },

  // Warning helpers
  getWarnings(guildId, userId)       { return this.warnings[guildId]?.[userId] ?? []; },
  addWarning(guildId, userId, entry) { (this.warnings[guildId] ??= {})[userId] ??= []; this.warnings[guildId][userId].push(entry); this.saveWarnings(); },
  clearWarnings(guildId, userId)     { if (this.warnings[guildId]) delete this.warnings[guildId][userId]; this.saveWarnings(); },
};

module.exports = data;
