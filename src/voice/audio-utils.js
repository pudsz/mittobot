// ─── Audio Format Conversion Utilities ───────────────────────────────────────
// Converts between audio formats needed for Discord voice and speech processing.
//
// Flow for LISTENING:  Discord Opus → PCM s16le 48000Hz → resample to 16000Hz → Vosk
// Flow for SPEAKING:   edge-tts MP3 → PCM s16le → encode to Opus → Discord

const prism = require("prism-media");
const { Readable, Transform, PassThrough } = require("stream");
const { spawn } = require("child_process");

// ─── FFmpeg availability check ──────────────────────────────────────────────
let _ffmpegChecked = false;
let _ffmpegAvailable = false;

function isFfmpegAvailable() {
  if (_ffmpegChecked) return _ffmpegAvailable;
  try {
    require("child_process").execSync("ffmpeg -version", { stdio: "ignore" });
    _ffmpegAvailable = true;
  } catch {
    _ffmpegAvailable = false;
  }
  _ffmpegChecked = true;
  return _ffmpegAvailable;
}

// ─── Decode Opus packets to PCM ──────────────────────────────────────────────
// Discord sends Opus packets (20ms frames, 48000Hz, stereo).
// Returns a Transform that outputs PCM s16le 48000Hz.
function createOpusToPcmStream() {
  return new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
}

// ─── Resample PCM from 48000Hz stereo to 16000Hz mono ─────────────────────
// Vosk expects PCM s16le 16000Hz mono.
// Uses ffmpeg for high-quality resampling, or falls back to basic averaging.
function createResampleStream(outRate = 16000, outChannels = 1) {
  if (isFfmpegAvailable()) {
    const ffmpeg = spawn("ffmpeg", [
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", String(outRate),
      "-ac", String(outChannels),
      "-af", "volume=1.5", // Boost voice volume slightly
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    return ffmpeg.stdin ? ffmpeg.stdout : null;
  }
  // Basic fallback: drop every 3rd sample for 48k→16k, average channels for stereo→mono
  return new Transform({
    readableObjectMode: false,
    writableObjectMode: false,
    transform(chunk, encoding, callback) {
      const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
      const outLen = Math.floor(samples.length / 6); // 48k stereo → 16k mono
      const out = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const left = samples[i * 6] || 0;
        const right = samples[i * 6 + 1] || 0;
        out[i] = Math.max(-32768, Math.min(32767, Math.round((left + right) / 2)));
      }
      callback(null, Buffer.from(out.buffer));
    },
  });
}

// ─── Convert edge-tts MP3 buffer to Opus stream for Discord ────────────────
// Returns a Readable stream of Opus packets suitable for createAudioResource.
function mp3ToOpusStream(mp3Buffer) {
  if (isFfmpegAvailable()) {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-f", "opus",
      "-ar", "48000",
      "-ac", "2",
      "-b:a", "96k",
      "-application", "audio",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const input = Readable.from(mp3Buffer);
    input.pipe(ffmpeg.stdin);
    return ffmpeg.stdout;
  }
  // Fallback: return MP3 buffer as a stream — @discordjs/voice can detect the format
  // via StreamType.Arbitrary and decode it using its internal FFmpeg pipeline.
  // If FFmpeg isn't available, the player will emit a clear decoding error.
  const fallbackStream = new Readable({
    read() {
      this.push(mp3Buffer);
      this.push(null);
    },
  });
  return fallbackStream;
}

// ─── Convert PCM buffer to Vosk-compatible format ─────────────────────────
function pcmToVoskFormat(pcmBuffer) {
  // Vosk expects 16-bit signed PCM at 16000Hz
  return pcmBuffer;
}

module.exports = {
  isFfmpegAvailable,
  createOpusToPcmStream,
  createResampleStream,
  mp3ToOpusStream,
  pcmToVoskFormat,
};
