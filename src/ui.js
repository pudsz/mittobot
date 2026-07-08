// Reusable component-UI toolkit: sessions, pagination, confirm dialogs, and
// a panel/wizard engine with central interaction dispatch.
//
// CustomId conventions (≤100 chars — rich state lives in the session Map):
//   ui:<widget>:<action>              toolkit widgets (ui:page:next, ui:confirm:yes)
//   <featureId>:<action>[:<arg>]      registered panels (theme:tone)
//   <featureId>_modal:<action>        panel modals (theme_modal:colors)
//
// IMPORTANT: the router's checkAccess never runs for component interactions,
// so every mutating handler must self-guard (guardLevel / guardOwner).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const theme = require("./theme");
const tone = require("./tone");
const config = require("./config");

const MAX_SESSIONS = 500;
const DEFAULT_TTL = 300_000;

// ── Sessions ──────────────────────────────────────────────────────────────
// Map<messageId, { kind, ownerId, guildId, state, expiresAt, timer, onExpire, message }>
const sessions = new Map();

function evictOldest() {
  if (sessions.size < MAX_SESSIONS) return;
  const oldest = sessions.keys().next().value;
  endSession(oldest);
}

function createSession(message, { ownerId, kind, guildId = null, state = {}, ttlMs = DEFAULT_TTL, onExpire = null }) {
  evictOldest();
  endSession(message.id); // replace any prior session on the same message
  const session = {
    kind, ownerId, state,
    guildId: guildId ?? message.guildId ?? null,
    message,
    onExpire,
    ttlMs,
    timer: null,
  };
  session.timer = setTimeout(() => expireSession(message.id), ttlMs);
  session.timer.unref?.();
  sessions.set(message.id, session);
  return session;
}

function getSession(messageId, kind = null) {
  const s = sessions.get(messageId);
  if (!s) return null;
  if (kind && s.kind !== kind) return null;
  return s;
}

// Reset the TTL (call on every interaction with the panel).
function touchSession(messageId) {
  const s = sessions.get(messageId);
  if (!s) return;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => expireSession(messageId), s.ttlMs);
  s.timer.unref?.();
}

function endSession(messageId) {
  const s = sessions.get(messageId);
  if (!s) return;
  clearTimeout(s.timer);
  sessions.delete(messageId);
}

async function expireSession(messageId) {
  const s = sessions.get(messageId);
  if (!s) return;
  sessions.delete(messageId);
  try {
    if (s.onExpire) {
      await s.onExpire(s);
    } else if (s.message?.editable !== false) {
      // Default: disable all components so the panel visibly goes dormant.
      const rows = s.message.components?.length ? disableAll(s.message.components) : [];
      await s.message.edit({ components: rows }).catch(() => {});
    }
  } catch { /* message may be gone; nothing to do */ }
}

// Rebuild component rows with everything disabled. Accepts either builders or
// raw API components from message.components.
function disableAll(rows) {
  return rows.map(row => {
    const json = typeof row.toJSON === "function" ? row.toJSON() : row;
    const rebuilt = ActionRowBuilder.from(json);
    for (const comp of rebuilt.components) comp.setDisabled?.(true);
    return rebuilt;
  });
}

// ── Guards ────────────────────────────────────────────────────────────────
async function ephemeralNote(interaction, msg) {
  const payload = { embeds: [theme.error(interaction, msg)], flags: MessageFlags.Ephemeral };
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch { /* interaction may be dead */ }
}

// Only the session owner may drive owned widgets.
async function guardOwner(interaction, session) {
  if (!session || interaction.user.id === session.ownerId) return true;
  await ephemeralNote(interaction, tone.t(interaction.guildId, "ui.notyours"));
  return false;
}

// Permission-level guard (everyone|booster|mod|admin|owner) — required on
// every mutating component handler since the router never covers components.
async function guardLevel(interaction, level) {
  const needed = config.PERM_LEVELS[level] ?? 0;
  const have = config.memberLevel(interaction.member, interaction.user.id);
  if (have >= needed) return true;
  await ephemeralNote(interaction, tone.t(interaction.guildId, "ui.noperm"));
  return false;
}

async function expiredNote(interaction) {
  await ephemeralNote(interaction, tone.t(interaction.guildId, "ui.expired"));
}

// ── Reply plumbing ────────────────────────────────────────────────────────
// Send a payload as a reply to either a Message (prefix cmd) or an
// Interaction (slash cmd) and return the resulting Message object.
async function respond(source, payload, { ephemeral = false } = {}) {
  const isInteraction = typeof source.isRepliable === "function" ? source.isRepliable() : Boolean(source.reply && source.user);
  if (isInteraction) {
    const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
    if (source.replied || source.deferred) {
      return await source.followUp({ ...payload, flags, withResponse: true });
    }
    const res = await source.reply({ ...payload, flags, withResponse: true });
    return res?.resource?.message ?? await source.fetchReply();
  }
  return await source.reply(payload);
}

// ── Pagination ────────────────────────────────────────────────────────────
// pages: array of EmbedBuilders, or render(pageIdx) → EmbedBuilder.
function pageButtons(page, total) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ui:page:first").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId("ui:page:prev").setEmoji("◀️").setStyle(ButtonStyle.Primary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId("ui:page:label").setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId("ui:page:next").setEmoji("▶️").setStyle(ButtonStyle.Primary).setDisabled(page >= total - 1),
    new ButtonBuilder().setCustomId("ui:page:last").setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1),
  );
}

async function renderPage(session) {
  const { pages, render, page, extraRows } = session.state;
  const total = pages ? pages.length : session.state.totalPages;
  const embedForPage = pages ? pages[page] : await render(page);
  const rows = [pageButtons(page, total), ...(extraRows || [])];
  return { embeds: [embedForPage], components: rows };
}

async function paginate(source, { pages = null, render = null, totalPages = null, ownerId, ephemeral = false, ttlMs = DEFAULT_TTL, extraRows = null }) {
  const total = pages ? pages.length : totalPages;
  if (!total || total < 1) throw new Error("paginate: no pages");
  const state = { pages, render, totalPages: total, page: 0, extraRows };
  const fakeSession = { state };
  const payload = await renderPage(fakeSession);
  const message = await respond(source, payload, { ephemeral });
  if (total > 1 && message?.id) {
    createSession(message, { ownerId, kind: "paginate", state, ttlMs });
  }
  return message;
}

async function handlePageButton(interaction) {
  const session = getSession(interaction.message.id, "paginate");
  if (!session) return expiredNote(interaction);
  if (!(await guardOwner(interaction, session))) return;
  const total = session.state.pages ? session.state.pages.length : session.state.totalPages;
  const action = interaction.customId.split(":")[2];
  const cur = session.state.page;
  session.state.page =
    action === "first" ? 0 :
    action === "prev"  ? Math.max(0, cur - 1) :
    action === "next"  ? Math.min(total - 1, cur + 1) :
    action === "last"  ? total - 1 : cur;
  touchSession(interaction.message.id);
  const payload = await renderPage(session);
  await interaction.update(payload);
}

// ── Confirm dialog ────────────────────────────────────────────────────────
async function confirm(source, { embed, ownerId, confirmLabel = "Confirm", cancelLabel = "Cancel", ephemeral = false, ttlMs = 60_000, onConfirm, onCancel = null }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ui:confirm:yes").setLabel(confirmLabel).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ui:confirm:no").setLabel(cancelLabel).setStyle(ButtonStyle.Secondary),
  );
  const message = await respond(source, { embeds: [embed], components: [row] }, { ephemeral });
  if (message?.id) {
    createSession(message, { ownerId, kind: "confirm", state: { onConfirm, onCancel }, ttlMs });
  }
  return message;
}

async function handleConfirmButton(interaction) {
  const session = getSession(interaction.message.id, "confirm");
  if (!session) return expiredNote(interaction);
  if (!(await guardOwner(interaction, session))) return;
  endSession(interaction.message.id);
  const yes = interaction.customId === "ui:confirm:yes";
  const cb = yes ? session.state.onConfirm : session.state.onCancel;
  if (cb) {
    await cb(interaction, session);
  } else {
    await interaction.update({
      embeds: [theme.say(interaction, yes ? "success" : "info", yes ? "ui.confirmed" : "ui.cancelled")],
      components: [],
    });
  }
}

// ── Panels ────────────────────────────────────────────────────────────────
// panelDef = {
//   render(session) → { embeds, components },        // full panel repaint
//   handlers: { [action]: async (interaction, session) },   // component clicks
//   modals:   { [action]: async (interaction, session) },   // modal submits
//   level: "admin",                                  // auto guardLevel (optional)
// }
const panels = new Map(); // featureId → panelDef

function registerPanel(featureId, panelDef) {
  panels.set(featureId, panelDef);
}

async function openPanel(source, featureId, { ownerId, guildId = null, state = {}, ephemeral = true, ttlMs = 600_000 }) {
  const def = panels.get(featureId);
  if (!def) throw new Error(`openPanel: unknown panel "${featureId}"`);
  const session = { kind: `panel:${featureId}`, ownerId, guildId: guildId ?? source.guildId ?? source.guild?.id ?? null, state };
  const payload = await def.render(session);
  const message = await respond(source, payload, { ephemeral });
  if (message?.id) {
    session.message = message;
    const real = createSession(message, { ownerId, kind: session.kind, guildId: session.guildId, state, ttlMs });
    real.message = message;
  }
  return message;
}

// Repaint a panel in place from a component interaction.
async function repaint(interaction, session) {
  const featureId = session.kind.slice("panel:".length);
  const def = panels.get(featureId);
  const payload = await def.render(session);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(() => {});
  } else {
    await interaction.update(payload);
  }
}

function parsePanelId(customId) {
  // "<feature>:<action>[:<arg>]" or "<feature>_modal:<action>[:<arg>]"
  const [head, action, ...rest] = customId.split(":");
  if (!action) return null;
  const isModal = head.endsWith("_modal");
  const featureId = isModal ? head.slice(0, -"_modal".length) : head;
  return { featureId, action, arg: rest.length ? rest.join(":") : null, isModal };
}

async function dispatchPanel(interaction, parsed) {
  const def = panels.get(parsed.featureId);
  if (!def) return false;
  const session = getSession(interaction.message?.id, `panel:${parsed.featureId}`);
  // Modal submits may arrive without a message session (interaction.message can
  // be the panel message) — fall back to a stateless session bound to the guild.
  const effective = session || {
    kind: `panel:${parsed.featureId}`,
    ownerId: interaction.user.id,
    guildId: interaction.guildId,
    state: {},
    message: interaction.message ?? null,
  };
  if (session) {
    if (!(await guardOwner(interaction, session))) return true;
    touchSession(interaction.message.id);
  } else if (!parsed.isModal) {
    // Button/select on a message we no longer track → expired.
    await expiredNote(interaction);
    return true;
  }
  if (def.level && !(await guardLevel(interaction, def.level))) return true;
  const table = parsed.isModal ? def.modals : def.handlers;
  const handler = table?.[parsed.action];
  if (!handler) return false;
  await handler(interaction, effective, { repaint: () => repaint(interaction, effective), arg: parsed.arg });
  return true;
}

// ── Central dispatch — call from interactionCreate; returns true if handled.
async function dispatch(interaction) {
  const customId = interaction.customId;
  if (!customId) return false;

  if (interaction.isButton() && customId.startsWith("ui:page:")) {
    await handlePageButton(interaction);
    return true;
  }
  if (interaction.isButton() && customId.startsWith("ui:confirm:")) {
    await handleConfirmButton(interaction);
    return true;
  }
  if (interaction.isButton() || interaction.isAnySelectMenu?.() || interaction.isModalSubmit()) {
    const parsed = parsePanelId(customId);
    if (parsed && panels.has(parsed.featureId)) {
      return await dispatchPanel(interaction, parsed);
    }
  }
  return false;
}

module.exports = {
  createSession, getSession, touchSession, endSession,
  disableAll, respond,
  paginate, confirm,
  registerPanel, openPanel, repaint,
  guardOwner, guardLevel, ephemeralNote, expiredNote,
  dispatch,
};
