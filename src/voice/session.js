// ─── Voice Session — 1:1 User ↔ AI Voice Chat ──────────────────────────────
// Manages a single voice channel session: one user, one AI.
// Handles the listen → STT → AI → TTS → speak lifecycle.

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
} = require("@discordjs/voice");
const { Readable } = require("stream");
const EventEmitter = require("events");
const tts = require("./tts");
const { createSTTEngine } = require("./stt");
const { processVoiceInput } = require("./ai-bridge");
const { createOpusToPcmStream, createResampleStream } = require("./audio-utils");
const aiMemory = require("../ai/memory");

// Silence detection thresholds
const SILENCE_TIMEOUT_MS = 3000;   // 3s of silence = end of utterance
const MIN_SPEECH_DURATION_MS = 500; // Ignore sounds shorter than 500ms

class VoiceSession extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.guildId
   * @param {string} opts.channelId - Voice channel ID
   * @param {string} opts.userId - The human user in this session (1:1)
   * @param {object} opts.guild - Discord guild object
   * @param {object} opts.client - Discord client
   */
  constructor(opts) {
    super();
    this.guildId = opts.guildId;
    this.channelId = opts.channelId;
    this.userId = opts.userId;
    this.guild = opts.guild;
    this.client = opts.client;
    this.voiceChannel = opts.voiceChannel;
    this.textChannel = opts.textChannel || null; // Linked text channel for logs/fallback

    this.connection = null;
    this.player = null;
    this.sttEngine = null;
    this.speaking = false;       // Currently speaking (prevents echo loop)
    this.listening = false;      // Currently listening for speech
    this.active = false;         // Session is live
    this._startedAt = null;      // Set when session starts

    // Speech detection state
    this._speechBuffer = [];
    this._silenceTimer = null;
    this._lastSpeechMs = 0;
    this._speechStartedMs = 0;
    this._isInSpeech = false;

    // Audio playback queue
    this._playQueue = [];
    this._isPlaying = false;
  }

  get userId() { return this._userId; }
  set userId(v) { this._userId = v; }

  /** Start the voice session — join channel and begin listening */
  async start() {
    if (this.active) return;

    try {
      // 1. Join voice channel
      this.connection = joinVoiceChannel({
        channelId: this.channelId,
        guildId: this.guildId,
        adapterCreator: this.guild.voiceAdapterCreator,
        selfDeaf: false,  // Must be false to receive audio
        selfMute: false,
      });

      // 2. Create audio player for TTS output
      this.player = createAudioPlayer();
      this.connection.subscribe(this.player);

      // 3. Handle player state changes
      this.player.on(AudioPlayerStatus.Playing, () => {
        this.speaking = true;
        this.emit("speaking", true);
      });
      this.player.on(AudioPlayerStatus.Idle, () => {
        this.speaking = false;
        this.emit("speaking", false);
        this._playNext(); // Play next in queue
      });
      this.player.on("error", (err) => {
        console.error("[voice:session] Player error:", err.message);
        this.speaking = false;
        this._playNext();
      });

      // 4. Handle connection state
      this.connection.on(VoiceConnectionStatus.Disconnected, () => {
        console.log("[voice:session] Disconnected from voice channel");
        this.stop();
      });
      this.connection.on(VoiceConnectionStatus.Destroyed, () => {
        this.stop();
      });

      // 5. Initialize STT engine
      this.sttEngine = createSTTEngine("auto");
      await this.sttEngine.init();

      // 6. Start listening if STT is available
      if (this.sttEngine.ready) {
        this._startListening();
      } else {
        console.log("[voice:session] STT not available — listen disabled. User can type in linked text channel.");
      }

      this.active = true;
      this._startedAt = Date.now();
      this.emit("started");
      console.log(`[voice:session] Started session for user ${this.userId} in channel ${this.channelId}`);

      // 7. Play welcome message
      await this.speak("Voice chat connected. How can I help you?");
    } catch (err) {
      console.error("[voice:session] Failed to start:", err.message);
      this.emit("error", err);
    }
  }

  /** Stop the session — disconnect and cleanup */
  stop() {
    if (!this.active) return;
    this.active = false;
    this._stopListening();

    if (this.sttEngine) {
      this.sttEngine.destroy();
      this.sttEngine = null;
    }

    if (this.player) {
      this.player.stop();
      this.player = null;
    }

    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }

    this._playQueue = [];
    this._speechBuffer = [];
    this.emit("stopped");
    console.log(`[voice:session] Stopped session for user ${this.userId}`);
  }

  // ─── Speaking ─────────────────────────────────────────────────────────────

  /**
   * Speak text in the voice channel.
   * @param {string} text - Text to speak
   * @param {string} [voice] - TTS voice ID
   */
  async speak(text, voice) {
    if (!this.active || !text) return;

    // Add to queue (or play immediately if nothing playing)
    this._playQueue.push({ text, voice });
    if (!this._isPlaying) {
      await this._playNext();
    }
  }

  async _playNext() {
    if (this._playQueue.length === 0) {
      this._isPlaying = false;
      this._resumeListening();
      return;
    }

    this._isPlaying = true;
    const item = this._playQueue.shift();

    try {
      const buffers = await tts.synthesizeLong(item.text, item.voice);
      for (const buf of buffers) {
        if (!this.active) break;
        const stream = Readable.from(buf);
        const resource = createAudioResource(stream, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true,
        });
        // Apply stored volume level
        try {
          const settings = require("../settings");
          const vol = settings.get("voiceVolume");
          if (typeof vol === "number" && vol >= 0 && vol <= 2) {
            resource.volume.setVolume(vol);
          }
        } catch { /* best-effort */ }
        this.player.play(resource);
        // Wait for playback to finish
        await new Promise((resolve) => {
          this.player.once(AudioPlayerStatus.Idle, resolve);
          this.player.once("error", resolve);
        });
      }
    } catch (err) {
      console.error("[voice:session] speak error:", err.message);
    }

    // Play next in queue
    setImmediate(() => this._playNext());
  }

  // ─── Listening ────────────────────────────────────────────────────────────

  _startListening() {
    if (this.listening) return;
    this.listening = true;

    try {
      // Subscribe to the user's audio stream
      const audioStream = this.connection.receiver.subscribe(this.userId, {
        end: {
          behavior: "manual",
        },
      });

      // Pipeline: Opus packets → PCM → resample to 16kHz mono
      const opusDecoder = createOpusToPcmStream();
      const resampler = createResampleStream(16000, 1);

      audioStream
        .pipe(opusDecoder)
        .pipe(resampler)
        .on("data", (pcmChunk) => this._onAudioData(pcmChunk))
        .on("error", (err) => console.error("[voice:session] Audio pipeline error:", err.message))
        .on("end", () => console.log("[voice:session] Audio stream ended"));

      audioStream.on("error", (err) => {
        // Ignore 'no audio' errors that happen when user stops speaking
        if (!err.message?.includes("no audio")) {
          console.error("[voice:session] Stream error:", err.message);
        }
      });

      console.log("[voice:session] Listening for speech...");
    } catch (err) {
      console.error("[voice:session] Failed to start listening:", err.message);
      this.listening = false;
    }
  }

  _stopListening() {
    this.listening = false;
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  _resumeListening() {
    // After speaking, resume listening for the user's next utterance
    // No-op: the receiver stream continues, we just reset speech detection state
    this._isInSpeech = false;
    this._speechBuffer = [];
    this._silenceTimer = null;
  }

  _onAudioData(pcmChunk) {
    if (!this.active || !this.listening || this.speaking) return;

    const now = Date.now();
    const energy = this._calculateEnergy(pcmChunk);
    const threshold = 500; // Adjust based on environment

    if (energy > threshold) {
      // Speech detected
      if (!this._isInSpeech) {
        this._isInSpeech = true;
        this._speechStartedMs = now;
        this._speechBuffer = [];
      }
      this._speechBuffer.push(pcmChunk);
      this._lastSpeechMs = now;

      // Reset silence timer
      if (this._silenceTimer) {
        clearTimeout(this._silenceTimer);
        this._silenceTimer = null;
      }
    } else if (this._isInSpeech) {
      // Silence — buffer it and start timeout
      this._speechBuffer.push(pcmChunk);
      if (!this._silenceTimer) {
        this._silenceTimer = setTimeout(() => this._onSpeechEnd(), SILENCE_TIMEOUT_MS);
      }
    }
  }

  _calculateEnergy(pcmBuffer) {
    try {
      const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += Math.abs(samples[i]);
      }
      return sum / samples.length;
    } catch {
      return 0;
    }
  }

  async _onSpeechEnd() {
    if (!this._isInSpeech) return;
    const duration = Date.now() - this._speechStartedMs;

    if (duration < MIN_SPEECH_DURATION_MS) {
      // Too short — ignore
      this._isInSpeech = false;
      this._speechBuffer = [];
      return;
    }

    this._isInSpeech = false;
    this._silenceTimer = null;
    this.listening = false;  // Pause listening while processing

    try {
      // Process through STT
      const pcmFull = Buffer.concat(this._speechBuffer);
      this._speechBuffer = [];

      if (this.sttEngine && this.sttEngine.ready) {
        this.sttEngine.feed(pcmFull);
        const transcript = await this.sttEngine.finalize();

        if (transcript && transcript.trim()) {
          this.emit("transcript", transcript);
          console.log(`[voice:session] Transcript: "${transcript}"`);

          // Send to AI
          const username = this.voiceChannel?.guild?.members?.cache?.get(this.userId)?.displayName || "User";
          const response = await processVoiceInput({
            guildId: this.guildId,
            userId: this.userId,
            username,
            transcript,
            guild: this.guild,
          });

          // Speak the AI response
          if (response?.text) {
            await this.speak(response.text);
          }
        }
      }
    } catch (err) {
      console.error("[voice:session] Speech processing error:", err.message);
    } finally {
      this.listening = true;
    }
  }
}

module.exports = VoiceSession;
