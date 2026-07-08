// Tone pack registry. `neutral` is canonical: it must define every key,
// since other packs fall back to it for anything they omit.
const neutral = require("./neutral");
const playful = require("./playful");
const serious = require("./serious");

const PACKS = { neutral, playful, serious };
const DEFAULT_PACK = "neutral";

module.exports = { PACKS, DEFAULT_PACK };
