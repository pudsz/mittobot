// ─── Speech-to-Text Engine (pluggable backends) ────────────────────────────
// Supports multiple free STT backends:
//   1. Vosk — offline, local, free (requires native compilation)
//   2. whisper.cpp — local subprocess (requires compiled binary)
//   3. None — returns null, listen mode disabled
//
// The user can configure which backend to use via settings.
// If no backend is available, voice sessions can still use TTS with text input.

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const EventEmitter = require("events");

// ─── Backend Detection ──────────────────────────────────────────────────────

function isVoskAvailable() {
  try {
    require.resolve("vosk");
    return true;
  } catch {
    return false;
  }
}

function isWhisperCppAvailable() {
  // Check common paths for whisper.cpp binary
  const paths = [
    path.join(__dirname, "..", "..", "whisper.cpp", "main"),
    path.join(__dirname, "..", "..", "whisper", "main"),
    "/usr/local/bin/whisper",
    "/usr/bin/whisper",
  ];
  return paths.some(p => { try { return fs.existsSync(p); } catch { return false; } });
}

// ─── STT Engine factory ─────────────────────────────────────────────────────

function createSTTEngine(backend = "auto") {
  if (backend === "auto") {
    if (isVoskAvailable()) backend = "vosk";
    else if (isWhisperCppAvailable()) backend = "whisper";
    else backend = "none";
  }

  switch (backend) {
    case "vosk":
      return new VoskEngine();
    case "whisper":
      return new WhisperCppEngine();
    case "none":
    default:
      return new NoopEngine();
  }
}

// ─── Vosk Engine ────────────────────────────────────────────────────────────
// Requires vosk npm package + a language model.
// Model download: https://alphacephei.com/vosk/models

class VoskEngine extends EventEmitter {
  constructor() {
    super();
    this.model = null;
    this.recognizer = null;
    this.ready = false;
  }

  get name() { return "Vosk (offline)"; }
  get requiresSetup() { return true; }
  get setupInstructions() {
    return [
      "1. Install vosk: npm install vosk",
      "2. Download a model from https://alphacephei.com/vosk/models",
      "   Recommended: vosk-model-small-en-us-0.15 (~50MB)",
      "3. Extract to: models/vosk-model-small-en-us-0.15/",
      "4. Set STT_MODEL_PATH in .env or use default path",
    ];
  }

  async init(modelPath) {
    try {
      const vosk = require("vosk");
      const resolvedPath = modelPath || path.join(__dirname, "..", "..", "models", "vosk-model-small-en-us-0.15");
      if (!fs.existsSync(resolvedPath)) {
        console.warn("[voice:stt] Vosk model not found at", resolvedPath);
        console.warn("[voice:stt]", this.setupInstructions.join("\n"));
        this.ready = false;
        return false;
      }
      this.model = new vosk.Model(resolvedPath);
      this.recognizer = new vosk.Recognizer({ model: this.model, sampleRate: 16000 });
      this.ready = true;
      console.log("[voice:stt] Vosk engine ready");
      return true;
    } catch (err) {
      console.error("[voice:stt] Vosk init failed:", err.message);
      this.ready = false;
      return false;
    }
  }

  /**
   * Feed PCM s16le 16000Hz mono audio data.
   * Emits 'result' with { text, final: true } when speech is detected.
   * Emits 'partial' with { text, final: false } for interim results.
   */
  feed(pcmBuffer) {
    if (!this.ready || !this.recognizer) return;
    try {
      if (this.recognizer.acceptWaveform(pcmBuffer)) {
        const result = this.recognizer.result();
        if (result && result.text) {
          this.emit("result", { text: result.text, final: true });
        }
      } else {
        const partial = this.recognizer.partialResult();
        if (partial && partial.partial) {
          this.emit("partial", { text: partial.partial, final: false });
        }
      }
    } catch (err) {
      // Ignore transient errors
    }
  }

  /** Call when user stops speaking to get final result */
  finalize() {
    if (!this.ready || !this.recognizer) return null;
    try {
      const result = this.recognizer.finalResult();
      if (result && result.text) {
        this.emit("result", { text: result.text, final: true });
        return result.text;
      }
    } catch {}
    return null;
  }

  destroy() {
    if (this.recognizer) {
      try { this.recognizer.free(); } catch {}
      this.recognizer = null;
    }
    if (this.model) {
      try { this.model.free(); } catch {}
      this.model = null;
    }
    this.ready = false;
  }
}

// ─── Whisper.cpp Engine (subprocess) ───────────────────────────────────────
// Requires a compiled whisper.cpp binary.
// Build: git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp && make

class WhisperCppEngine extends EventEmitter {
  constructor() {
    super();
    this.binaryPath = null;
    this.modelPath = null;
    this.ready = false;
  }

  get name() { return "whisper.cpp (subprocess)"; }
  get requiresSetup() { return true; }
  get setupInstructions() {
    return [
      "1. Build whisper.cpp: https://github.com/ggerganov/whisper.cpp",
      "2. Download a GGML model (e.g. ggml-small.en.bin)",
      "3. Set WHISPER_BINARY_PATH in .env",
      "4. Set WHISPER_MODEL_PATH in .env",
    ];
  }

  async init(binaryPath, modelPath) {
    this.binaryPath = binaryPath || process.env.WHISPER_BINARY_PATH;
    this.modelPath = modelPath || process.env.WHISPER_MODEL_PATH;
    if (!this.binaryPath || !fs.existsSync(this.binaryPath)) {
      console.warn("[voice:stt] whisper.cpp binary not found");
      this.ready = false;
      return false;
    }
    if (!this.modelPath || !fs.existsSync(this.modelPath)) {
      console.warn("[voice:stt] whisper.cpp model not found");
      this.ready = false;
      return false;
    }
    this.ready = true;
    console.log("[voice:stt] whisper.cpp engine ready");
    return true;
  }

  /** Transcribe a full PCM buffer via subprocess */
  async transcribe(pcmBuffer) {
    if (!this.ready) return null;
    try {
      const proc = spawn(this.binaryPath, [
        "-m", this.modelPath,
        "-f", "-",  // Read from stdin
        "-otxt",     // Output text only
        "--no-timestamps",
      ], { stdio: ["pipe", "pipe", "pipe"] });

      proc.stdin.write(pcmBuffer);
      proc.stdin.end();

      return new Promise((resolve) => {
        let output = "";
        proc.stdout.on("data", (d) => { output += d.toString(); });
        proc.on("close", () => {
          const text = output.trim();
          if (text) {
            this.emit("result", { text, final: true });
            resolve(text);
          } else {
            resolve(null);
          }
        });
        proc.on("error", () => resolve(null));
      });
    } catch (err) {
      console.error("[voice:stt] whisper.cpp error:", err.message);
      return null;
    }
  }

  feed(pcmBuffer) {
    // whisper.cpp doesn't support streaming, collect buffer and transcribe on silence
    if (!this._buffer) this._buffer = [];
    this._buffer.push(pcmBuffer);
  }

  finalize() {
    if (!this._buffer || this._buffer.length === 0) return null;
    const full = Buffer.concat(this._buffer);
    this._buffer = [];
    return this.transcribe(full);
  }

  destroy() {
    this._buffer = [];
    this.ready = false;
  }
}

// ─── Noop Engine (disabled) ─────────────────────────────────────────────────

class NoopEngine extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
  }

  get name() { return "Disabled — TTS only"; }
  get requiresSetup() { return false; }
  get setupInstructions() { return []; }

  async init() { this.ready = false; return true; }
  feed() {}
  finalize() { return null; }
  destroy() {}
}

module.exports = {
  createSTTEngine,
  isVoskAvailable,
  isWhisperCppAvailable,
  VoskEngine,
  WhisperCppEngine,
  NoopEngine,
};
