// Music commands — join the caller's voice channel and control playback.
// Thin command layer over `src/music.js` (all voice/queue logic lives there).
// Category "fun" so it can be toggled off with the other fun features.
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const music = require("../music");
const theme = require("../theme");

// Format seconds as m:ss / h:mm:ss. 0 (unknown/live) → "live".
function fmtDuration(sec) {
  if (!sec || sec <= 0) return "live";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = n => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Resolve the caller's current voice channel, or null. Works for both message
// and interaction sources (both carry a GuildMember at `.member`).
function callerVoiceChannel(member) {
  return member?.voice?.channel || null;
}

function botCanJoin(voiceChannel, meId) {
  const perms = voiceChannel.permissionsFor(meId);
  if (!perms) return true; // be permissive if we can't compute
  return perms.has(PermissionFlagsBits.Connect) && perms.has(PermissionFlagsBits.Speak);
}

// Shared handlers, source-agnostic. `reply(embed)` abstracts message vs slash.
async function doPlay(guild, member, query, textChannelId, reply) {
  const vc = callerVoiceChannel(member);
  if (!vc) return reply(theme.error(guild.id, "You need to be in a voice channel first."));
  if (!query) return reply(theme.error(guild.id, "What should I play? `$play <song name or url>`"));
  if (!botCanJoin(vc, guild.members.me?.id || member.client.user.id))
    return reply(theme.error(guild.id, `I need **Connect** and **Speak** permissions in **${vc.name}**.`));

  const res = await music.play(vc, query, { id: member.id, tag: member.user.tag }, textChannelId);
  if (res.error === "streaming-unavailable")
    return reply(theme.error(guild.id, "Music streaming isn't available on this instance (the `play-dl` library isn't installed). The queue and controls work, but audio can't be streamed."));
  if (res.error === "not-found")
    return reply(theme.error(guild.id, "Couldn't find anything for that query."));
  if (res.error === "queue-full")
    return reply(theme.error(guild.id, "The queue is full (100 tracks). Try again later."));

  const t = res.track;
  if (res.startedNow)
    return reply(theme.success(guild.id, `▶️ Now playing **${t.title}** \`[${fmtDuration(t.duration)}]\``));
  return reply(theme.success(guild.id, `➕ Queued **${t.title}** \`[${fmtDuration(t.duration)}]\` — position **${res.position}**`));
}

function doSkip(guild, member, reply) {
  if (!callerVoiceChannel(member)) return reply(theme.error(guild.id, "You need to be in a voice channel."));
  const skipped = music.skip(guild.id);
  if (!skipped) return reply(theme.error(guild.id, "Nothing is playing."));
  return reply(theme.success(guild.id, `⏭️ Skipped **${skipped.title}**.`));
}

function doStop(guild, member, reply) {
  if (!callerVoiceChannel(member)) return reply(theme.error(guild.id, "You need to be in a voice channel."));
  const ok = music.stop(guild.id);
  if (!ok) return reply(theme.error(guild.id, "I'm not connected to a voice channel."));
  return reply(theme.success(guild.id, "⏹️ Stopped playback, cleared the queue, and left the channel."));
}

function doPause(guild, member, reply) {
  if (!callerVoiceChannel(member)) return reply(theme.error(guild.id, "You need to be in a voice channel."));
  const ok = music.pause(guild.id);
  return reply(ok ? theme.success(guild.id, "⏸️ Paused.") : theme.error(guild.id, "Nothing is playing."));
}

function doResume(guild, member, reply) {
  if (!callerVoiceChannel(member)) return reply(theme.error(guild.id, "You need to be in a voice channel."));
  const ok = music.resume(guild.id);
  return reply(ok ? theme.success(guild.id, "▶️ Resumed.") : theme.error(guild.id, "Nothing is paused."));
}

function nowPlayingEmbed(guild) {
  const current = music.nowPlaying(guild.id);
  if (!current) return theme.info(guild.id, "Nothing is playing right now.");
  const by = current.requestedBy ? ` • requested by ${current.requestedBy.tag}` : "";
  const e = theme.embed(guild.id, "accent",
    `**${current.title}**\n\`[${fmtDuration(current.duration)}]\`${by}`).setTitle("🎵 Now Playing");
  if (current.thumbnail) e.setThumbnail(current.thumbnail);
  if (current.url) e.setURL?.(current.url);
  return e;
}

function queueEmbed(guild) {
  const current = music.nowPlaying(guild.id);
  const queue = music.getQueue(guild.id);
  if (!current && !queue.length) return theme.info(guild.id, "The queue is empty. Add something with `$play <query>`.");
  const lines = [];
  if (current) lines.push(`**Now:** ${current.title} \`[${fmtDuration(current.duration)}]\``);
  queue.slice(0, 15).forEach((t, i) => lines.push(`\`${i + 1}.\` ${t.title} \`[${fmtDuration(t.duration)}]\``));
  if (queue.length > 15) lines.push(`…and **${queue.length - 15}** more`);
  return theme.embed(guild.id, "info", lines.join("\n")).setTitle(`🎶 Queue (${queue.length})`);
}

// Prefix commands stay as individual `$play` / `$skip` / … entries (so their
// short aliases keep working); the slash surface is consolidated into a single
// `/music` subcommand group below to stay under Discord's 100 global-command cap.
module.exports = [
  {
    name: "play",
    description: "Play a song or add it to the queue",
    aliases: ["p"],
    category: "fun",
    prefix: async (m, args) => {
      const reply = embed => m.reply({ embeds: [embed] });
      return doPlay(m.guild, m.member, args.join(" "), m.channel.id, reply);
    },
  },
  {
    name: "skip",
    description: "Skip the current track",
    category: "fun",
    prefix: async (m) => doSkip(m.guild, m.member, e => m.reply({ embeds: [e] })),
  },
  {
    name: "stop",
    description: "Stop playback, clear the queue, and leave the voice channel",
    category: "fun",
    prefix: async (m) => doStop(m.guild, m.member, e => m.reply({ embeds: [e] })),
  },
  {
    name: "pause",
    description: "Pause playback",
    category: "fun",
    prefix: async (m) => doPause(m.guild, m.member, e => m.reply({ embeds: [e] })),
  },
  {
    name: "resume",
    description: "Resume playback",
    aliases: ["unpause"],
    category: "fun",
    prefix: async (m) => doResume(m.guild, m.member, e => m.reply({ embeds: [e] })),
  },
  {
    name: "queue",
    description: "Show the music queue",
    aliases: ["q"],
    category: "fun",
    prefix: async (m) => m.reply({ embeds: [queueEmbed(m.guild)] }),
  },
  {
    name: "nowplaying",
    description: "Show the currently playing track",
    aliases: ["np"],
    category: "fun",
    prefix: async (m) => m.reply({ embeds: [nowPlayingEmbed(m.guild)] }),
  },
  {
    // Consolidated slash surface: `/music play|skip|stop|pause|resume|queue|nowplaying`.
    name: "music",
    description: "Music player controls",
    category: "fun",
    slash: new SlashCommandBuilder().setName("music").setDescription("Music player controls")
      .addSubcommand(c => c.setName("play").setDescription("Play a song or add it to the queue")
        .addStringOption(o => o.setName("query").setDescription("Song name or URL").setRequired(true)))
      .addSubcommand(c => c.setName("skip").setDescription("Skip the current track"))
      .addSubcommand(c => c.setName("stop").setDescription("Stop playback and leave the voice channel"))
      .addSubcommand(c => c.setName("pause").setDescription("Pause playback"))
      .addSubcommand(c => c.setName("resume").setDescription("Resume playback"))
      .addSubcommand(c => c.setName("queue").setDescription("Show the music queue"))
      .addSubcommand(c => c.setName("nowplaying").setDescription("Show the currently playing track")),
    execute: async (i) => {
      const sub = i.options.getSubcommand();
      if (sub === "play") {
        await i.deferReply();
        return doPlay(i.guild, i.member, i.options.getString("query"), i.channel.id, e => i.editReply({ embeds: [e] }));
      }
      const reply = e => i.reply({ embeds: [e] });
      switch (sub) {
        case "skip": return doSkip(i.guild, i.member, reply);
        case "stop": return doStop(i.guild, i.member, reply);
        case "pause": return doPause(i.guild, i.member, reply);
        case "resume": return doResume(i.guild, i.member, reply);
        case "queue": return reply(queueEmbed(i.guild));
        case "nowplaying": return reply(nowPlayingEmbed(i.guild));
      }
    },
  },
];
