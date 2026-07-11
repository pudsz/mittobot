// Music — per-guild voice queue + playback. State is lazy: a guild's player is
// created on first `play` and torn down when the queue drains or the bot is
// disconnected. Nothing here persists across restarts (an active voice session
// can't survive a process restart anyway), so there is no DB/`load()` — the
// dashboard reads live in-memory state via `getState`.
//
// Audio source: we try to resolve/stream via `play-dl` (an optional dependency).
// If it isn't installed, playback of remote sources is not possible in this
// environment — the queue + all controls still work, and `play` reports the
// limitation instead of silently doing nothing. This keeps the command surface
// fully functional whether or not the streaming lib is available.
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
} = require("@discordjs/voice");

// Optional streaming lib. Loaded lazily & defensively so a missing/broken
// install degrades gracefully rather than crashing the bot at require time.
let playdl = null;
let playdlError = null;
try {
  playdl = require("play-dl");
} catch (e) {
  playdlError = e.message;
}

const STREAMING_AVAILABLE = !!playdl;

// guildId → { connection, player, queue:[track], current:track|null, textChannelId, voiceChannelId }
const guilds = new Map();

const MAX_QUEUE = 100;

function makeTrack({ title, url, duration, requestedBy, thumbnail }) {
  return {
    title: title || "Unknown track",
    url: url || null,
    duration: duration || 0, // seconds; 0 = unknown/live
    requestedBy: requestedBy || null, // { id, tag }
    thumbnail: thumbnail || null,
  };
}

// Resolve a free-text query or URL into a playable track descriptor. Returns
// null if nothing could be resolved (or streaming is unavailable).
async function resolveQuery(query, requestedBy) {
  if (!STREAMING_AVAILABLE) return null;
  const q = String(query || "").trim();
  if (!q) return null;
  try {
    // Direct URL: validate + read metadata.
    if (/^https?:\/\//i.test(q)) {
      const type = playdl.yt_validate ? playdl.yt_validate(q) : "video";
      if (type === "video" || type === "search") {
        const info = await playdl.video_basic_info(q);
        const d = info?.video_details;
        if (d) return makeTrack({
          title: d.title, url: d.url, duration: d.durationInSec,
          requestedBy, thumbnail: d.thumbnails?.[0]?.url,
        });
      }
      // Fall through to search for non-YouTube URLs.
    }
    // Free-text search → first result.
    const results = await playdl.search(q, { limit: 1 });
    const r = results?.[0];
    if (r) return makeTrack({
      title: r.title, url: r.url, duration: r.durationInSec,
      requestedBy, thumbnail: r.thumbnails?.[0]?.url,
    });
  } catch (e) {
    console.error("[music] resolveQuery:", e.message);
  }
  return null;
}

// Build an AudioResource for a track. Throws if streaming is unavailable so the
// caller can surface a clear error instead of a silent no-op.
async function makeResource(track) {
  if (!STREAMING_AVAILABLE) {
    // STREAM STUB: without a source library we can't produce audio bytes. The
    // queue advances so controls stay consistent, but nothing is heard.
    throw new Error("streaming-unavailable");
  }
  const stream = await playdl.stream(track.url);
  return createAudioResource(stream.stream, { inputType: stream.type, metadata: track });
}

function getGuildState(guildId) {
  return guilds.get(guildId) || null;
}

// Ensure a voice connection + player exist for this guild, joining the given
// voice channel. Idempotent — reuses an existing session if present.
function ensureConnection(voiceChannel, textChannelId) {
  const guildId = voiceChannel.guild.id;
  let state = guilds.get(guildId);
  if (state && state.connection) {
    state.textChannelId = textChannelId || state.textChannelId;
    return state;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });
  connection.subscribe(player);

  state = {
    connection,
    player,
    queue: [],
    current: null,
    textChannelId: textChannelId || null,
    voiceChannelId: voiceChannel.id,
  };
  guilds.set(guildId, state);

  // When the current resource finishes (Idle), advance the queue.
  player.on(AudioPlayerStatus.Idle, () => {
    playNext(guildId).catch(e => console.error("[music] playNext:", e.message));
  });
  player.on("error", (err) => {
    console.error("[music] player error:", err.message);
    playNext(guildId).catch(e => console.error("[music] playNext:", e.message));
  });

  // If the connection drops and can't recover, tear the session down.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Reconnecting — leave state intact.
    } catch {
      destroy(guildId);
    }
  });

  return state;
}

// Pull the next track off the queue and play it. If the queue is empty, clears
// `current` (the session stays connected so users can queue more).
async function playNext(guildId) {
  const state = guilds.get(guildId);
  if (!state) return;
  const next = state.queue.shift();
  if (!next) {
    state.current = null;
    return;
  }
  state.current = next;
  try {
    const resource = await makeResource(next);
    state.player.play(resource);
  } catch (e) {
    if (e.message === "streaming-unavailable") {
      // Can't produce audio — skip so the queue doesn't stall forever.
      console.warn("[music] streaming unavailable; skipping track:", next.title);
    } else {
      console.error("[music] play error:", e.message);
    }
    state.current = null;
    // Advance to the next track (guards against a poisoned queue entry).
    return playNext(guildId);
  }
}

// Public: join a voice channel (creates the session if needed).
function join(voiceChannel, textChannelId) {
  return ensureConnection(voiceChannel, textChannelId);
}

// Public: enqueue a resolved query. Joins `voiceChannel` if not already in one.
// Returns { track, position, startedNow } or an error shape.
async function play(voiceChannel, query, requestedBy, textChannelId) {
  if (!STREAMING_AVAILABLE) {
    return { error: "streaming-unavailable", detail: playdlError };
  }
  const track = await resolveQuery(query, requestedBy);
  if (!track) return { error: "not-found" };

  const state = ensureConnection(voiceChannel, textChannelId);
  if (state.queue.length >= MAX_QUEUE) return { error: "queue-full" };

  const idle = !state.current;
  state.queue.push(track);
  if (idle) {
    await playNext(voiceChannel.guild.id);
    return { track, position: 0, startedNow: true };
  }
  return { track, position: state.queue.length, startedNow: false };
}

// Public: skip the current track. Stopping the player fires Idle → playNext.
function skip(guildId) {
  const state = guilds.get(guildId);
  if (!state || !state.current) return null;
  const skipped = state.current;
  state.player.stop(true);
  return skipped;
}

function pause(guildId) {
  const state = guilds.get(guildId);
  if (!state || !state.current) return false;
  return state.player.pause();
}

function resume(guildId) {
  const state = guilds.get(guildId);
  if (!state || !state.current) return false;
  return state.player.unpause();
}

function nowPlaying(guildId) {
  const state = guilds.get(guildId);
  return state ? state.current : null;
}

function getQueue(guildId) {
  const state = guilds.get(guildId);
  return state ? state.queue.slice() : [];
}

function isPaused(guildId) {
  const state = guilds.get(guildId);
  return !!state && state.player?.state?.status === AudioPlayerStatus.Paused;
}

// Public: stop playback, clear the queue, and disconnect.
function stop(guildId) {
  return destroy(guildId);
}

// Tear down a guild's session entirely.
function destroy(guildId) {
  const state = guilds.get(guildId);
  if (!state) return false;
  try { state.player?.stop(true); } catch {}
  try {
    const conn = state.connection || getVoiceConnection(guildId);
    conn?.destroy();
  } catch (e) {
    console.error("[music] destroy:", e.message);
  }
  guilds.delete(guildId);
  return true;
}

// Read-only snapshot for the dashboard/API. Never exposes live Discord objects.
function getState(guildId) {
  const state = guilds.get(guildId);
  if (!state) {
    return {
      connected: false,
      streamingAvailable: STREAMING_AVAILABLE,
      current: null,
      paused: false,
      voiceChannelId: null,
      queue: [],
    };
  }
  return {
    connected: !!state.connection,
    streamingAvailable: STREAMING_AVAILABLE,
    current: state.current,
    paused: isPaused(guildId),
    voiceChannelId: state.voiceChannelId,
    queue: state.queue.slice(),
  };
}

module.exports = {
  STREAMING_AVAILABLE,
  join,
  play,
  skip,
  stop,
  pause,
  resume,
  nowPlaying,
  getQueue,
  isPaused,
  destroy,
  getState,
};
