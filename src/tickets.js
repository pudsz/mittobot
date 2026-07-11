// Tickets — support ticket system. Members open a private ticket channel from a
// panel button; staff (the configured support role) can see and respond, and
// closing a ticket archives a text transcript to a log channel before the
// channel is deleted.
//
// Follows the house per-guild config pattern: an in-memory `store` that is
// authoritative at runtime (async load() once at startup), reads are sync, and
// writes update the cache synchronously then persist to SQLite in the
// background. Open/closed ticket rows live in the `tickets` table (source of
// truth for the dashboard's open-ticket list and the per-user open cap).
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");
const db = require("./db");
const theme = require("./theme");
const safe = require("./safe");

// Only one open ticket per member keeps the honeypot of channels bounded and
// stops trivial spam from a single user.
const MAX_OPEN_PER_USER = 1;

let store = {}; // guildId → config

function defaults() {
  return {
    enabled: false,
    categoryId: null,
    supportRoleId: null,
    panelChannelId: null,
    transcriptChannelId: null,
    openMessage: "Thanks for reaching out! A member of staff will be with you shortly. Describe your issue below.",
    buttonLabel: "Create Ticket",
  };
}

async function load() {
  try {
    store = {};
    for (const row of await db.getAllTicketConfigs()) {
      store[row.guild_id] = {
        enabled: row.enabled === 1,
        categoryId: row.category_id,
        supportRoleId: row.support_role_id,
        panelChannelId: row.panel_channel_id,
        transcriptChannelId: row.transcript_channel_id,
        openMessage: row.open_message,
        buttonLabel: row.button_label,
      };
    }
  } catch (e) {
    console.error("[tickets] load:", e.message);
    store = {};
  }
}

function getConfig(guildId) {
  return { ...defaults(), ...(store[guildId] || {}) };
}

function setConfig(guildId, patch) {
  const next = { ...getConfig(guildId), ...patch };
  store[guildId] = next;
  db.setTicketConfig(guildId, {
    enabled: next.enabled,
    category_id: next.categoryId,
    support_role_id: next.supportRoleId,
    panel_channel_id: next.panelChannelId,
    transcript_channel_id: next.transcriptChannelId,
    open_message: next.openMessage,
    button_label: next.buttonLabel,
  }).catch(e => console.error("[tickets] persist:", e.message));
  return next;
}

// ─── UI builders ───

// The public panel: an embed plus a single "Create Ticket" button
// (customId ticket:create) that any member can press to open a ticket.
function buildPanel(guildId, cfg) {
  const embed = theme.embed(guildId, "info",
    "Need help? Press the button below to open a private support ticket. Only you and the support team will be able to see it.")
    .setTitle("🎫 Support Tickets");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:create")
      .setLabel((cfg.buttonLabel || "Create Ticket").slice(0, 80))
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎫"),
  );
  return { embeds: [embed], components: [row] };
}

// Posts the panel to `channel`. Returns the sent message (or null on failure).
function postPanel(channel, guildId) {
  const cfg = getConfig(guildId);
  return safe.send(channel, buildPanel(guildId, cfg), "tickets panel");
}

// ─── Interaction routing ───

// Central button router, called from index.js interactionCreate for any
// customId starting with "ticket:". Returns true if it handled the interaction.
async function handleButton(interaction) {
  if (!interaction.isButton?.()) return false;
  const id = interaction.customId;
  if (id === "ticket:create") return openTicket(interaction);
  if (id === "ticket:close") return promptClose(interaction);
  if (id === "ticket:closeconfirm") return confirmClose(interaction);
  if (id === "ticket:closecancel") return cancelClose(interaction);
  return false;
}

// ticket:create — spin up a private channel for the presser.
async function openTicket(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) {
    await safe.orNull(interaction.reply({ embeds: [theme.error(guild.id, "The ticket system is not enabled on this server.")], flags: 64 }), "tickets reply disabled");
    return true;
  }

  // Enforce the per-user open cap.
  const open = db.getOpenTicketCountForUser(guild.id, interaction.user.id);
  if (open >= MAX_OPEN_PER_USER) {
    await safe.orNull(interaction.reply({ embeds: [theme.error(guild.id, "You already have an open ticket. Please use your existing ticket.")], flags: 64 }), "tickets reply cap");
    return true;
  }

  // Defer since channel creation + a follow-up message can exceed 3s.
  await safe.orNull(interaction.deferReply({ flags: 64 }), "tickets defer create");

  const everyoneId = guild.roles.everyone.id;
  const overwrites = [
    { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
  ];
  if (cfg.supportRoleId && guild.roles.cache.has(cfg.supportRoleId)) {
    overwrites.push({ id: cfg.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] });
  }

  const safeName = `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9\-]/g, "").slice(0, 90) || `ticket-${interaction.user.id}`;
  const channel = await safe.orNull(guild.channels.create({
    name: safeName,
    type: ChannelType.GuildText,
    parent: (cfg.categoryId && guild.channels.cache.has(cfg.categoryId)) ? cfg.categoryId : undefined,
    permissionOverwrites: overwrites,
    reason: `Ticket opened by ${interaction.user.tag}`,
  }), "tickets create channel");

  if (!channel) {
    await safe.orNull(interaction.editReply({ embeds: [theme.error(guild.id, "I couldn't create a ticket channel. Check my **Manage Channels** permission and the configured category.")] }), "tickets editReply fail");
    return true;
  }

  // Persist the open ticket row (source of truth for the dashboard + cap).
  try {
    db.createTicket(guild.id, channel.id, interaction.user.id);
  } catch (e) {
    console.error("[tickets] createTicket:", e.message);
  }

  // Opening message inside the ticket, with a Close button for staff/opener.
  const openEmbed = theme.embed(guild.id, "info", cfg.openMessage || defaults().openMessage)
    .setTitle("🎫 Ticket Opened")
    .setFooter({ text: `Opened by ${interaction.user.tag}` });
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:close").setLabel("Close Ticket").setStyle(ButtonStyle.Danger).setEmoji("🔒"),
  );
  const mention = cfg.supportRoleId ? `<@${interaction.user.id}> <@&${cfg.supportRoleId}>` : `<@${interaction.user.id}>`;
  await safe.send(channel, { content: mention, embeds: [openEmbed], components: [closeRow], allowedMentions: { users: [interaction.user.id], roles: cfg.supportRoleId ? [cfg.supportRoleId] : [] } }, "tickets open message");

  await safe.orNull(interaction.editReply({ embeds: [theme.success(guild.id, `Your ticket has been created: <#${channel.id}>`)] }), "tickets editReply success");
  return true;
}

// ticket:close — ask for confirmation before archiving/deleting.
async function promptClose(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;
  const row = db.getOpenTicketByChannel(guild.id, interaction.channel.id);
  if (!row) {
    await safe.orNull(interaction.reply({ embeds: [theme.error(guild.id, "This channel is not an open ticket.")], flags: 64 }), "tickets reply notticket");
    return true;
  }
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket:closeconfirm").setLabel("Confirm Close").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket:closecancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await safe.orNull(interaction.reply({ embeds: [theme.warn(guild.id, "Are you sure you want to close this ticket? A transcript will be archived and the channel deleted.")], components: [confirmRow], flags: 64 }), "tickets reply confirm");
  return true;
}

async function cancelClose(interaction) {
  await safe.orNull(interaction.update({ embeds: [theme.info(interaction.guild.id, "Close cancelled.")], components: [] }), "tickets cancel close");
  return true;
}

// ticket:closeconfirm — perform the actual archive + delete.
async function confirmClose(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;
  await safe.orNull(interaction.update({ embeds: [theme.info(guild.id, "Closing ticket and archiving transcript…")], components: [] }), "tickets ack close");
  await closeChannel(interaction.channel, interaction.user.id);
  return true;
}

// Shared close routine used by both the button flow and `$ticket close`.
// Builds a transcript, posts it to the configured log channel, marks the row
// closed, then deletes the channel after a short grace delay.
async function closeChannel(channel, closedById) {
  const guild = channel.guild;
  const cfg = getConfig(guild.id);
  const row = db.getOpenTicketByChannel(guild.id, channel.id);
  if (!row) return false;

  // Mark closed first so a failed transcript post can't leave a zombie-open row.
  try {
    db.closeTicket(row.id, closedById, Date.now());
  } catch (e) {
    console.error("[tickets] closeTicket:", e.message);
  }

  // Build a plain-text transcript from the channel history (newest DiscordAPI
  // returns messages newest-first, so we reverse for chronological order).
  const transcript = await buildTranscript(channel, row);
  if (cfg.transcriptChannelId) {
    const logChannel = guild.channels.cache.get(cfg.transcriptChannelId);
    if (logChannel) {
      const file = new AttachmentBuilder(Buffer.from(transcript, "utf8"), { name: `ticket-${row.id}-transcript.txt` });
      const embed = theme.embed(guild.id, "info",
        `**Ticket #${row.id}** closed.\n**Opened by:** <@${row.user_id}>\n**Closed by:** <@${closedById}>\n**Channel:** #${channel.name}`)
        .setTitle("🎫 Ticket Closed")
        .setTimestamp();
      await safe.send(logChannel, { embeds: [embed], files: [file] }, "tickets transcript");
    }
  }

  // Grace delay so anyone watching sees the "closing" notice before deletion.
  setTimeout(() => {
    safe.orNull(channel.delete("Ticket closed"), "tickets delete channel");
  }, 5000);
  return true;
}

// Fetch up to 100 messages and render a readable text transcript.
async function buildTranscript(channel, row) {
  const header =
    `Transcript for ticket #${row.id}\n` +
    `Channel: #${channel.name} (${channel.id})\n` +
    `Opened by user: ${row.user_id}\n` +
    `Opened at: ${new Date(row.created_at).toISOString()}\n` +
    `Closed at: ${new Date().toISOString()}\n` +
    "".padEnd(60, "─") + "\n\n";

  const fetched = await safe.orNull(channel.messages.fetch({ limit: 100 }), "tickets fetch transcript");
  if (!fetched) return header + "[transcript unavailable — could not fetch messages]\n";

  const lines = [...fetched.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(m => {
      const ts = new Date(m.createdTimestamp).toISOString();
      const author = m.author ? `${m.author.tag}` : "Unknown";
      let content = m.content || "";
      if (m.attachments?.size) content += ` [attachments: ${[...m.attachments.values()].map(a => a.url).join(", ")}]`;
      if (m.embeds?.length && !content) content = "[embed]";
      return `[${ts}] ${author}: ${content}`;
    });

  return header + (lines.length ? lines.join("\n") : "[no messages]") + "\n";
}

module.exports = {
  load,
  getConfig,
  setConfig,
  postPanel,
  buildPanel,
  handleButton,
  closeChannel,
  MAX_OPEN_PER_USER,
};
