// Starboard — when a message collects enough of a configured emoji reaction, it
// is reposted to a highlights channel. Per-guild config lives in memory (loaded
// once at startup); the source→board message mapping persists in SQLite so star
// counts can be updated and duplicates avoided across restarts.
const { EmbedBuilder } = require("discord.js");
const safe = require("./safe");
const db = require("./db");

let store = {}; // guildId → config

function defaults() {
  return {
    enabled: false,
    channelId: null,
    emoji: "⭐",
    threshold: 3,
    selfStar: false,
    ignoreNsfw: true,
    ignoredChannels: [],
  };
}

async function load() {
  try {
    store = {};
    for (const row of await db.getAllStarboardConfigs()) {
      store[row.guild_id] = {
        enabled: row.enabled === 1,
        channelId: row.channel_id,
        emoji: row.emoji || "⭐",
        threshold: row.threshold ?? 3,
        selfStar: row.self_star === 1,
        ignoreNsfw: row.ignore_nsfw === 1,
        ignoredChannels: db.safeJsonParse(row.ignored_channels, []),
      };
    }
  } catch (e) {
    console.error("[starboard] load:", e.message);
    store = {};
  }
}

function getConfig(guildId) {
  return { ...defaults(), ...(store[guildId] || {}) };
}

function setConfig(guildId, patch) {
  const next = { ...getConfig(guildId), ...patch };
  store[guildId] = next;
  db.setStarboardConfig(guildId, {
    enabled: next.enabled,
    channel_id: next.channelId,
    emoji: next.emoji,
    threshold: next.threshold,
    self_star: next.selfStar,
    ignore_nsfw: next.ignoreNsfw,
    ignored_channels: next.ignoredChannels,
  }).catch(e => console.error("[starboard] persist:", e.message));
  return next;
}

// Does this reaction's emoji match the guild's configured star emoji?
// Supports unicode (⭐) and custom emoji (matched by name or id).
function emojiMatches(reactionEmoji, configEmoji) {
  if (!configEmoji) return false;
  if (reactionEmoji.id) {
    // custom emoji — config may store "<:name:id>", "name:id", the bare id, or name
    return configEmoji.includes(reactionEmoji.id) || configEmoji === reactionEmoji.name || configEmoji === `:${reactionEmoji.name}:`;
  }
  return reactionEmoji.name === configEmoji;
}

function buildStarEmbed(message, count, emoji) {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setAuthor({ name: message.author?.tag || "Unknown", iconURL: message.author?.displayAvatarURL?.() })
    .setDescription(message.content ? message.content.slice(0, 2048) : "*[no text content]*")
    .addFields({ name: "Source", value: `[Jump to message](${message.url}) in <#${message.channel.id}>` })
    .setFooter({ text: `${emoji} ${count}` })
    .setTimestamp(message.createdTimestamp || Date.now());

  // Attach the first image if present.
  const img = message.attachments?.find?.(a => a.contentType?.startsWith?.("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url || ""));
  if (img) embed.setImage(img.url);
  return embed;
}

// Called from messageReactionAdd / messageReactionRemove. Recomputes the star
// count from the live reaction and creates/updates/removes the board post.
async function onReaction(reaction, user) {
  try {
    const message = reaction.message;
    const guild = message?.guild;
    if (!guild) return;

    const cfg = getConfig(guild.id);
    if (!cfg.enabled || !cfg.channelId) return;
    if (!emojiMatches(reaction.emoji, cfg.emoji)) return;

    // Never star messages already in the board channel, or in ignored channels.
    if (message.channel.id === cfg.channelId) return;
    if (cfg.ignoredChannels.includes(message.channel.id)) return;

    // Hydrate partials so author/content/count are complete.
    if (message.partial) { if (!await safe.orNull(message.fetch(), "starboard fetch message")) return; }
    if (message.author?.bot) return;
    if (cfg.ignoreNsfw && message.channel.nsfw) return;

    // Live star count (excludes the message author unless selfStar is allowed).
    const starReaction = message.reactions.cache.find(r => emojiMatches(r.emoji, cfg.emoji));
    let count = starReaction ? starReaction.count : 0;
    if (!cfg.selfStar && starReaction) {
      // Subtract a self-star if the author reacted.
      const reactors = await safe.orNull(starReaction.users.fetch(), "starboard fetch reactors");
      if (reactors && reactors.has(message.author.id)) count -= 1;
    }

    const board = guild.channels.cache.get(cfg.channelId);
    if (!board) return;

    const entry = db.getStarboardEntry(guild.id, message.id);

    if (count >= cfg.threshold) {
      const embed = buildStarEmbed(message, count, cfg.emoji);
      if (entry?.board_msg_id) {
        // Update the existing board post's count.
        const boardMsg = await safe.orNull(board.messages.fetch(entry.board_msg_id), "starboard fetch board msg");
        if (boardMsg) {
          await safe.orNull(boardMsg.edit({ embeds: [embed] }), "starboard edit board msg");
          db.upsertStarboardEntry(guild.id, message.id, message.channel.id, entry.board_msg_id, count);
        } else {
          // Board post was deleted — repost.
          const sent = await safe.send(board, { embeds: [embed] }, "starboard post");
          if (sent?.id) db.upsertStarboardEntry(guild.id, message.id, message.channel.id, sent.id, count);
        }
      } else {
        const sent = await safe.send(board, { embeds: [embed] }, "starboard post");
        if (sent?.id) db.upsertStarboardEntry(guild.id, message.id, message.channel.id, sent.id, count);
      }
    } else if (entry?.board_msg_id) {
      // Dropped below threshold — remove the board post.
      const boardMsg = await safe.orNull(board.messages.fetch(entry.board_msg_id), "starboard fetch board msg for delete");
      if (boardMsg) await safe.orNull(boardMsg.delete(), "starboard delete board msg");
      db.deleteStarboardEntry(guild.id, message.id);
    }
  } catch (e) {
    console.error("[starboard] onReaction:", e.message);
  }
}

module.exports = { load, getConfig, setConfig, onReaction, getTop: (g, n) => db.getTopStarboard(g, n) };
