// ─── Voice Manager ──────────────────────────────────────────────────────────
// Orchestrates voice sessions across the bot. Handles voiceStateUpdate events,
// enforces 1:1 sessions per AI voice channel, and provides the public API.

const VoiceSession = require("./session");
const settings = require("../settings");

class VoiceManager {
  constructor(client) {
    this.client = client;
    /** @type {Map<string, Map<string, VoiceSession>>} guildId → channelId → session */
    this.sessions = new Map();
    /** @type {Set<string>} guildId:channelId keys with a start() in flight */
    this._pendingSessions = new Set();
  }

  /**
   * Handle voiceStateUpdate events from Discord.
   * Called from the main index.js event handler.
   */
  handleVoiceStateUpdate(oldState, newState) {
    // Bot's own state changes — ignore
    if (newState.member?.id === this.client.user?.id) return;
    if (oldState.member?.id === this.client.user?.id) return;

    if (!settings.get("voiceEnabled")) return;
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!guildId) return;

    const voiceChannelId = settings.get("voiceChannelId");

    // User joined a voice channel
    if (newState.channelId && newState.channelId !== oldState.channelId) {
      // Check if this is the designated AI voice channel
      if (voiceChannelId && newState.channelId !== voiceChannelId) return;

      // Check: is there already an active session (or one being created) in this channel?
      const pendingKey = `${guildId}:${newState.channelId}`;
      if (this._pendingSessions.has(pendingKey)) return;

      const guildSessions = this.sessions.get(guildId);
      if (guildSessions?.has(newState.channelId)) {
        // Another user is in this session — ignore (1:1 enforcement)
        // Unless the joining user is the session user rejoining
        const existing = guildSessions.get(newState.channelId);
        if (existing.userId === newState.member?.id) {
          // Same user rejoined — do nothing, session is active
          return;
        }
        return;
      }

      // Check if channel already has other humans (should be 1:1)
      const channel = newState.guild?.channels?.cache?.get(newState.channelId);
      if (channel) {
        const humanCount = channel.members.filter(m => !m.user.bot).size;
        if (humanCount > 1) return; // Wait until it's 1:1
      }

      this._createSession(guildId, newState.channelId, newState.member.id, newState.guild, channel);
    }

    // User left a voice channel
    if (oldState.channelId && (!newState.channelId || newState.channelId !== oldState.channelId)) {
      const guildSessions = this.sessions.get(guildId);
      if (!guildSessions) return;

      const session = guildSessions.get(oldState.channelId);
      if (!session) return;

      // Only end session if the session owner left
      if (session.userId === oldState.member?.id) {
        // Check if there are other humans in the channel
        const channel = oldState.guild?.channels?.cache?.get(oldState.channelId);
        const otherHumans = channel
          ? channel.members.filter(m => !m.user.bot && m.id !== this.client.user?.id).size
          : 0;
        if (otherHumans === 0) {
          this._destroySession(guildId, oldState.channelId);
        }
      }
    }
  }

  /**
   * Create a new voice session.
   * Called when user joins a designated AI voice channel.
   */
  async _createSession(guildId, channelId, userId, guild, voiceChannel) {
    const pendingKey = `${guildId}:${channelId}`;
    if (this._pendingSessions.has(pendingKey)) return null;
    this._pendingSessions.add(pendingKey);

    if (!this.sessions.has(guildId)) {
      this.sessions.set(guildId, new Map());
    }

    const session = new VoiceSession({
      guildId,
      channelId,
      userId,
      guild,
      client: this.client,
      voiceChannel,
    });

    this.sessions.get(guildId).set(channelId, session);

    session.on("started", () => {
      console.log(`[voice] Session started: guild=${guildId} channel=${channelId} user=${userId}`);
    });

    session.on("stopped", () => {
      console.log(`[voice] Session stopped: guild=${guildId} channel=${channelId} user=${userId}`);
    });

    session.on("transcript", (text) => {
      console.log(`[voice] Transcript from ${userId}: "${text.slice(0, 100)}"`);
    });

    session.on("error", (err) => {
      console.error(`[voice] Session error: guild=${guildId} channel=${channelId}:`, err.message);
      this._destroySession(guildId, channelId);
    });

    try {
      await session.start();
    } catch (err) {
      console.error("[voice] Failed to start session:", err.message);
      this._destroySession(guildId, channelId);
      return null;
    } finally {
      this._pendingSessions.delete(pendingKey);
    }
    return session;
  }

  /**
   * Destroy and clean up a voice session.
   */
  _destroySession(guildId, channelId) {
    const guildSessions = this.sessions.get(guildId);
    if (!guildSessions) return;

    const session = guildSessions.get(channelId);
    if (session) {
      session.stop();
      guildSessions.delete(channelId);
    }

    if (guildSessions.size === 0) {
      this.sessions.delete(guildId);
    }
  }

  /**
   * Speak text in an active voice session (used by AI tools).
   * @param {string} guildId
   * @param {string} channelId
   * @param {string} text
   * @returns {Promise<boolean>} Whether the message was spoken
   */
  async speak(guildId, channelId, text) {
    const guildSessions = this.sessions.get(guildId);
    if (!guildSessions) return false;
    const session = guildSessions.get(channelId);
    if (!session) return false;
    await session.speak(text);
    return true;
  }

  /**
   * Join a specific voice channel (invoked by the /join command).
   * @param {string} guildId
   * @param {string} channelId - Voice channel to join
   * @param {string} userId - The user who issued the command
   * @param {object} guild - Discord guild object
   * @param {object} voiceChannel - The resolved voice channel object
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async joinChannel(guildId, channelId, userId, guild, voiceChannel) {
    // Check for existing session in this channel
    const guildSessions = this.sessions.get(guildId);
    if (guildSessions?.has(channelId)) {
      return { ok: false, error: "I'm already in that voice channel." };
    }
    const pendingKey = `${guildId}:${channelId}`;
    if (this._pendingSessions.has(pendingKey)) {
      return { ok: false, error: "Already connecting to that channel, please wait." };
    }

    const session = await this._createSession(guildId, channelId, userId, guild, voiceChannel);
    if (!session) {
      return { ok: false, error: "Failed to start voice session. Check the logs for details." };
    }
    return { ok: true };
  }

  /**
   * Leave a voice channel (invoked by the /leave command).
   * @param {string} guildId
   * @param {string} channelId - Voice channel to leave
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async leaveChannel(guildId, channelId) {
    const guildSessions = this.sessions.get(guildId);
    if (!guildSessions?.has(channelId)) {
      return { ok: false, error: "I'm not in that voice channel." };
    }
    this._destroySession(guildId, channelId);
    return { ok: true };
  }

  /**
   * Get all active sessions (for status/dashboard).
   */
  getActiveSessions() {
    const result = [];
    for (const [guildId, channels] of this.sessions) {
      for (const [channelId, session] of channels) {
        if (session.active) {
          result.push({
            guildId,
            channelId,
            userId: session.userId,
            startedAt: session._startedAt,
          });
        }
      }
    }
    return result;
  }

  /**
   * Destroy all sessions (on bot shutdown).
   */
  destroy() {
    for (const [guildId, channels] of this.sessions) {
      for (const [channelId, session] of channels) {
        session.stop();
      }
    }
    this.sessions.clear();
    this._pendingSessions.clear();
    console.log("[voice] All sessions destroyed");
  }
}

module.exports = VoiceManager;
