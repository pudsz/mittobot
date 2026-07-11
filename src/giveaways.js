// Giveaways — timed prize draws entered via a button. Each giveaway posts an
// embed with an "Enter" button; entries are stored per (giveaway,user). A
// periodic tick ends giveaways whose deadline has passed, picking N distinct
// random winners. Everything persists in SQLite so draws survive restarts.
//
// Unlike the per-guild config modules, giveaways have no in-memory config store —
// the rows themselves are the state and are queried directly from the DB. This
// keeps winner selection authoritative even across scaled instances.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const safe = require("./safe");
const db = require("./db");
const theme = require("./theme");

// Build the "Enter" action row for an active giveaway. customId carries the id
// so index.js's interactionCreate can route the click back to handleEnterButton.
function enterRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${id}`)
      .setLabel("Enter")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Primary),
  );
}

// Render the giveaway embed. `ended`/`winnerIds` switch it to the finished state.
function buildEmbed(gv, { ended = false, winnerIds = [] } = {}) {
  const endsUnix = Math.floor(Number(gv.ends_at) / 1000);
  if (ended) {
    const winnerText = winnerIds.length
      ? winnerIds.map(id => `<@${id}>`).join(", ")
      : "No valid entries — no winner drawn.";
    return theme.embed(gv.guild_id, "accent", `**Prize:** ${gv.prize}\n**Winner${winnerIds.length === 1 ? "" : "s"}:** ${winnerText}`)
      .setTitle("🎉 Giveaway Ended")
      .setFooter({ text: `Hosted by an admin • ID ${gv.id}` });
  }
  return theme.embed(gv.guild_id, "accent",
    `**Prize:** ${gv.prize}\n**Winners:** ${gv.winners_count}\n**Ends:** <t:${endsUnix}:R> (<t:${endsUnix}:f>)\n\nClick **Enter** below to join!`)
    .setTitle("🎉 Giveaway")
    .setFooter({ text: `ID ${gv.id} • Hosted by`, iconURL: undefined })
    .addFields({ name: "Host", value: `<@${gv.host_id}>`, inline: true });
}

// Create + post a giveaway. Returns the stored row (with message_id) or null on
// failure. We insert first so the row id can be embedded in the button customId,
// then patch message_id after the announcement is sent.
async function create(guild, channelId, prize, winnersCount, durationMs, hostId) {
  const channel = guild?.channels?.cache?.get(channelId);
  if (!channel) return null;
  const now = Date.now();
  const endsAt = now + durationMs;
  const id = db.createGiveaway({
    guild_id: guild.id,
    channel_id: channelId,
    prize,
    winners_count: winnersCount,
    ends_at: endsAt,
    host_id: hostId,
    created_at: now,
  });
  const gv = db.getGiveaway(id);
  const sent = await safe.send(channel, { embeds: [buildEmbed(gv)], components: [enterRow(id)] }, "giveaway post");
  if (!sent?.id) {
    // Couldn't announce — drop the orphan row so it never fires.
    db.deleteGiveaway(id);
    return null;
  }
  db.setGiveawayMessage(id, sent.id);
  return db.getGiveaway(id);
}

// Record an entry. Returns "added" for a fresh entry, "duplicate" if already in,
// or "closed"/"missing" when the giveaway can't be entered.
function addEntry(giveawayId, userId) {
  const gv = db.getGiveaway(giveawayId);
  if (!gv) return "missing";
  if (gv.ended) return "closed";
  return db.addGiveawayEntry(giveawayId, userId) ? "added" : "duplicate";
}

// Pick up to `count` distinct random winners from the entrant pool.
// Fisher-Yates partial shuffle — runtime code may use Math.random freely.
function pickWinners(giveawayId, count) {
  const pool = db.getGiveawayEntries(giveawayId).map(r => r.user_id);
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

// Fetch the live announcement message (if it still exists).
async function fetchMessage(client, gv) {
  const channel = client?.guilds?.cache?.get(gv.guild_id)?.channels?.cache?.get(gv.channel_id);
  if (!channel || !gv.message_id) return { channel, msg: null };
  const msg = await safe.orNull(channel.messages.fetch(gv.message_id), "giveaway fetch msg");
  return { channel, msg };
}

// End a giveaway: mark it done, edit the original embed to the finished state
// (removing the Enter button), and announce the winners in-channel.
async function endGiveaway(id, client) {
  const gv = db.getGiveaway(id);
  if (!gv) return { ok: false, error: "not_found" };
  if (gv.ended) return { ok: false, error: "already_ended" };
  const winners = pickWinners(id, gv.winners_count);
  db.markGiveawayEnded(id);

  const { channel, msg } = await fetchMessage(client, gv);
  if (msg) await safe.edit(msg, { embeds: [buildEmbed(gv, { ended: true, winnerIds: winners })], components: [] }, "giveaway end edit");
  if (channel) {
    const text = winners.length
      ? `🎉 Congratulations ${winners.map(w => `<@${w}>`).join(", ")}! You won **${gv.prize}**!`
      : `🎉 The giveaway for **${gv.prize}** ended with no valid entries.`;
    await safe.send(channel, { content: text, allowedMentions: { users: winners } }, "giveaway announce");
  }
  return { ok: true, winners };
}

// Reroll an already-ended giveaway: draw fresh winners from the same entrants.
async function reroll(id, client) {
  const gv = db.getGiveaway(id);
  if (!gv) return { ok: false, error: "not_found" };
  if (!gv.ended) return { ok: false, error: "not_ended" };
  const winners = pickWinners(id, gv.winners_count);
  const { channel } = await fetchMessage(client, gv);
  if (channel) {
    const text = winners.length
      ? `🎉 Reroll! New winner${winners.length === 1 ? "" : "s"} for **${gv.prize}**: ${winners.map(w => `<@${w}>`).join(", ")}!`
      : `🎉 Reroll for **${gv.prize}** failed — no valid entries to draw from.`;
    await safe.send(channel, { content: text, allowedMentions: { users: winners } }, "giveaway reroll announce");
  }
  return { ok: true, winners };
}

// Button handler routed from index.js interactionCreate for "giveaway:enter:<id>".
async function handleEnterButton(interaction) {
  const id = parseInt(interaction.customId.split(":")[2], 10);
  const guildId = interaction.guild?.id || "_none";
  if (!Number.isInteger(id)) {
    return interaction.reply({ embeds: [theme.error(guildId, "That giveaway is no longer valid.")], flags: 64 });
  }
  const result = addEntry(id, interaction.user.id);
  const msg = {
    added: "✅ You're entered! Good luck. 🍀",
    duplicate: "You're already entered in this giveaway.",
    closed: "This giveaway has already ended.",
    missing: "That giveaway no longer exists.",
  }[result];
  const kind = result === "added" ? "success" : "info";
  return interaction.reply({ embeds: [theme.embed(guildId, kind, msg)], flags: 64 });
}

// Periodic tick (setInterval in index.js). Ends every giveaway whose deadline
// has passed. Errors on one giveaway never block the rest.
async function tick(client) {
  let due;
  try { due = db.getDueGiveaways(Date.now()); } catch { return; }
  for (const gv of due) {
    try { await endGiveaway(gv.id, client); }
    catch (e) { console.error("[giveaways] tick end:", e.message); }
  }
}

// Active (not-yet-ended) giveaways for a guild, each with a live entry count.
function listActive(guildId) {
  return db.getActiveGiveaways(guildId);
}

module.exports = {
  create, addEntry, endGiveaway, reroll, tick,
  handleEnterButton, listActive,
  getGiveaway: (id) => db.getGiveaway(id),
};
