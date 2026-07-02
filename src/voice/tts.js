// ─── Text-to-Speech Engine (edge-tts-universal) ─────────────────────────────
// Free, high-quality neural TTS using Microsoft Edge's internal API.
// No API key required. Multiple voices available.

const { EdgeTTS } = require("edge-tts-universal");
const { Readable } = require("stream");

// Default voice — Emma is clear and natural
const DEFAULT_VOICE = "en-US-EmmaMultilingualNeural";

// Available voices (common ones)
const VOICES = {
  "en-US-EmmaMultilingualNeural": "Emma (US female, multilingual)",
  "en-US-GuyNeural": "Guy (US male)",
  "en-US-JennyNeural": "Jenny (US female)",
  "en-US-AriaNeural": "Aria (US female, expressive)",
  "en-US-DavisNeural": "Davis (US male)",
  "en-GB-SoniaNeural": "Sonia (UK female)",
  "en-GB-RyanNeural": "Ryan (UK male)",
  "ja-JP-NanamiNeural": "Nanami (Japanese female)",
  "de-DE-KatjaNeural": "Katja (German female)",
  "fr-FR-DeniseNeural": "Denise (French female)",
};

// Rate limits: max ~1000 chars per synthesis to avoid timeouts.
// Long messages are split into sentences.
const MAX_CHARS_PER_SYNTHESIS = 800;

function splitLongText(text) {
  if (text.length <= MAX_CHARS_PER_SYNTHESIS) return [text];
  const parts = [];
  // Split on sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > MAX_CHARS_PER_SYNTHESIS) {
      if (current) parts.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current) parts.push(current.trim());
  // If splitting by sentences didn't work, hard-split
  if (parts.length === 0) {
    for (let i = 0; i < text.length; i += MAX_CHARS_PER_SYNTHESIS) {
      parts.push(text.slice(i, i + MAX_CHARS_PER_SYNTHESIS));
    }
  }
  return parts;
}

/**
 * Synthesize text to an MP3 audio buffer.
 * @param {string} text - Text to speak
 * @param {string} [voice] - Voice ID (default: Emma)
 * @param {number} [rate] - Speaking rate (default: 0, range: -50 to 50)
 * @param {number} [pitch] - Voice pitch (default: 0, range: -50 to 50)
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
async function synthesize(text, voice = DEFAULT_VOICE, rate = 0, pitch = 0) {
  if (!text || !text.trim()) return null;
  const clean = text.trim().slice(0, MAX_CHARS_PER_SYNTHESIS);
  try {
    const tts = new EdgeTTS(clean, voice);
    const result = await tts.synthesize();
    if (!result?.audio) return null;
    return Buffer.from(await result.audio.arrayBuffer());
  } catch (err) {
    console.error("[voice:tts] Synthesis failed:", err.message);
    return null;
  }
}

/**
 * Synthesize long text, splitting across multiple audio chunks.
 * Returns an array of MP3 buffers for sequential playback.
 */
async function synthesizeLong(text, voice = DEFAULT_VOICE, rate = 0, pitch = 0) {
  if (!text || !text.trim()) return [];
  const parts = splitLongText(text);
  const buffers = [];
  for (const part of parts) {
    const buf = await synthesize(part, voice, rate, pitch);
    if (buf) buffers.push(buf);
  }
  return buffers;
}

/**
 * Get list of available voices.
 */
function listVoices() {
  return Object.entries(VOICES).map(([id, desc]) => ({ id, description: desc }));
}

module.exports = {
  synthesize,
  synthesizeLong,
  listVoices,
  DEFAULT_VOICE,
  VOICES,
};
