// Suggestions — members submit suggestions that are posted to a board channel
// with 👍/👎 vote buttons; staff approve/reject/implement them. Per-guild config
// is cached in memory (loaded once at startup); suggestions + votes live in
// SQLite so counts and statuses survive restarts and the button embeds can be
// re-edited later.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const safe = require("./safe");
const db = require("./db");

let store = {}; // guildId → config

// Per-status embed styling. Also used by the dashboard status controls.
const STATUS_META = {
  pending:     { color: 0x5865f2, emoji: "🕓", label: "Pending" },
  approved:    { color: 0x00c776, emoji: "✅", label: "Approved" },
  rejected:    { color: 0xed4245, emoji: "❌", label: "Rejected" },
  implemented: { color: 0xeb459e, emoji: "🚀", label: "Implemented" },
};
const STATUSES = Object.keys(STATUS_META);

function defaults() {
  return {
    enabled: false,
    channelId: null,
    anonymous: false, // hide the submitter's identity on the board post
  };
}

async function load() {
  try {
    store = {};
    for (const row of await db.getAllSuggestionConfigs()) {
      store[row.guild_id] = {
        enabled: row.enabled === 1,
        channelId: row.channel_id,
        anonymous: row.anonymous === 1,
      };
    }
  } catch (e) {
    console.error("[suggestions] load:", e.message);
    store = {};
  }
}

function getConfig(guildId) {
  return { ...defaults(), ...(store[guildId] || {}) };
}

function setConfig(guildId, patch) {
  const next = { ...getConfig(guildId), ...patch };
  store[guildId] = next;
  db.setSuggestionConfig(guildId, {
    enabled: next.enabled,
    channel_id: next.channelId,
    anonymous: next.anonymous,
  }).catch(e => console.error("[suggestions] persist:", e.message));
  return next;
}

// Vote buttons carry the suggestion id so index.js can route presses back here.
function buildButtons(id, upvotes, downvotes) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`suggestion:up:${id}`).setStyle(ButtonStyle.Success).setLabel(`👍 ${upvotes ?? 0}`),
    new ButtonBuilder().setCustomId(`suggestion:down:${id}`).setStyle(ButtonStyle.Danger).setLabel(`👎 ${downvotes ?? 0}`),
  );
}

// `s` is a suggestions row (or an equivalent shape). `cfg` gates anonymity.
function buildEmbed(s, cfg) {
  const meta = STATUS_META[s.status] || STATUS_META.pending;
  const e = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`Suggestion #${s.id}`)
    .setDescription(String(s.content || "").slice(0, 4000))
    .addFields(
      { name: "Status", value: `${meta.emoji} ${meta.label}`, inline: true },
      { name: "Votes", value: `👍 ${s.upvotes ?? 0}  👎 ${s.downvotes ?? 0}`, inline: true },
    );
  if (!cfg.anonymous && s.user_id) e.addFields({ name: "Submitted by", value: `<@${s.user_id}>`, inline: true });
  if (s.staff_note) e.addFields({ name: "Staff note", value: String(s.staff_note).slice(0, 1024) });
  return e.setFooter({ text: `ID ${s.id}` }).setTimestamp();
}

// Create a suggestion: insert first to obtain the id (needed for the button
// customIds), then post the embed, then backfill the message id for later edits.
async function create(guild, userId, content) {
  const cfg = getConfig(guild.id);
  if (!cfg.enabled || !cfg.channelId) return { error: "disabled" };
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel) return { error: "nochannel" };

  const id = db.insertSuggestion(guild.id, userId, content, Date.now());
  const row = { id, guild_id: guild.id, user_id: userId, content, status: "pending", upvotes: 0, downvotes: 0, staff_note: null };
  const embed = buildEmbed(row, cfg);
  const msg = await safe.send(channel, { embeds: [embed], components: [buildButtons(id, 0, 0)] }, "suggestion post");
  if (msg?.id) db.setSuggestionMessageId(id, msg.id);
  return { id, message: msg };
}

// Staff decision: persist the new status/note and re-edit the board embed color.
async function setStatus(id, status, note, client) {
  if (!STATUSES.includes(status)) return null;
  const s = db.getSuggestion(id);
  if (!s) return null;
  db.setSuggestionStatus(id, status, note ?? null);
  const updated = { ...s, status, staff_note: note != null ? note : s.staff_note };

  const cfg = getConfig(s.guild_id);
  if (client && s.message_id && cfg.channelId) {
    const guild = client.guilds?.cache?.get(s.guild_id);
    const channel = guild?.channels?.cache?.get(cfg.channelId);
    if (channel) {
      const msg = await safe.orNull(channel.messages.fetch(s.message_id), "suggestion fetch for status");
      if (msg) {
        const embed = buildEmbed(updated, cfg);
        await safe.orNull(msg.edit({ embeds: [embed], components: [buildButtons(id, updated.upvotes, updated.downvotes)] }), "suggestion edit status");
      }
    }
  }
  return updated;
}

// Button router (called from index.js interactionCreate). Records/toggles a vote
// and re-renders the embed + button counts. Returns true if it handled the id.
async function handleButton(interaction) {
  const parts = (interaction.customId || "").split(":");
  if (parts[0] !== "suggestion") return false;
  const action = parts[1];
  const id = parseInt(parts[2], 10);
  if (!id || (action !== "up" && action !== "down")) return false;

  const vote = action === "up" ? 1 : -1;
  const counts = await db.recordSuggestionVote(id, interaction.user.id, vote);
  const s = db.getSuggestion(id);
  if (!s) { await safe.orNull(interaction.deferUpdate(), "suggestion defer"); return true; }

  const cfg = getConfig(s.guild_id);
  const embed = buildEmbed({ ...s, upvotes: counts.upvotes, downvotes: counts.downvotes }, cfg);
  await safe.orNull(interaction.update({ embeds: [embed], components: [buildButtons(id, counts.upvotes, counts.downvotes)] }), "suggestion vote update");
  return true;
}

function recent(guildId, limit = 25) {
  return db.getSuggestionsByGuild(guildId, limit);
}

module.exports = { load, getConfig, setConfig, create, setStatus, handleButton, recent, STATUSES, STATUS_META };
