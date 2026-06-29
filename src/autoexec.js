const db = require("./db");
const safe = require("./safe");
const { EmbedBuilder } = require("discord.js");

// In-memory cache: { [guildId]: rule[] }
let rulesCache = {};

async function load() {
  try {
    const allRows = await db.query("SELECT * FROM autoexec_rules WHERE enabled = 1 ORDER BY guild_id, priority ASC");
    rulesCache = {};
    for (const row of allRows) {
      if (!rulesCache[row.guild_id]) rulesCache[row.guild_id] = [];
      rulesCache[row.guild_id].push({
        id: row.id,
        guild_id: row.guild_id,
        trigger_event: row.trigger_event,
        conditions: db.safeJsonParse(row.conditions, {}),
        actions: db.safeJsonParse(row.actions, []),
        enabled: row.enabled === 1,
        priority: row.priority || 0,
      });
    }
  } catch (err) {
    console.error("[autoexec] Failed to load rules:", err.message);
    rulesCache = {};
  }
}

function getRules(guildId) {
  return rulesCache[guildId] || [];
}

// Quick check: does this guild have any cached rules at all?
function hasRules(guildId) {
  return !!rulesCache[guildId]?.length;
}

// Reload rules for a specific guild (called after API writes)
async function reloadGuild(guildId) {
  try {
    const rows = await db.query(
      "SELECT * FROM autoexec_rules WHERE guild_id = ? AND enabled = 1 ORDER BY priority ASC",
      [guildId]
    );
    rulesCache[guildId] = rows.map(row => ({
      id: row.id,
      guild_id: row.guild_id,
      trigger_event: row.trigger_event,
      conditions: db.safeJsonParse(row.conditions, {}),
      actions: db.safeJsonParse(row.actions, []),
      enabled: row.enabled === 1,
      priority: row.priority || 0,
    }));
  } catch (err) {
    console.error(`[autoexec] Failed to reload rules for ${guildId}:`, err.message);
  }
}

// Full reload from DB (replaces entire cache)
async function reload() {
  await load();
}

// Evaluate conditions against the event context.
// All conditions must pass for the rule to fire.
function evaluateConditions(conditions, context) {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  // `min_warning_count` — only fire if user has at least N warnings
  if (conditions.min_warning_count !== undefined && context.warningCount !== undefined) {
    if (context.warningCount < conditions.min_warning_count) return false;
  }

  // `max_warning_count` — only fire if user has at most N warnings
  if (conditions.max_warning_count !== undefined && context.warningCount !== undefined) {
    if (context.warningCount > conditions.max_warning_count) return false;
  }

  // `has_role` — only fire if user has a specific role ID
  if (conditions.has_role && context.member) {
    if (!context.member.roles?.cache?.has(conditions.has_role)) return false;
  }

  // `not_has_role` — only fire if user does NOT have a specific role ID
  if (conditions.not_has_role && context.member) {
    if (context.member.roles?.cache?.has(conditions.not_has_role)) return false;
  }

  // `reason_contains` — only fire if reason contains a substring (case-insensitive)
  if (conditions.reason_contains && context.reason) {
    if (!context.reason.toLowerCase().includes(conditions.reason_contains.toLowerCase())) return false;
  }

  // `min_severity` — only fire if warning severity is at least N
  if (conditions.min_severity !== undefined && context.severity !== undefined) {
    if (context.severity < conditions.min_severity) return false;
  }

  // `emojis` — match against the reacted emoji's name, id, or "name:id" form.
  // Accepts a single string or an array. The reacted emoji can be either the user's
  // input (e.g. "🟢" or "✅") or have a custom ID like "name:1234567890".
  if (conditions.emojis && context.emoji) {
    const list = Array.isArray(conditions.emojis) ? conditions.emojis : [conditions.emojis];
    const target = context.emoji;
    const fullId = target.id ? `${target.name}:${target.id}` : target.name;
    const matched = list.some(raw => {
      const s = String(raw || "").trim();
      if (!s) return false;
      return s === target.name || s === fullId || (target.id && s === target.id);
    });
    if (!matched) return false;
  }

  return true;
}

// Format a message template with placeholders from the event context.
function formatMessage(template, context) {
  if (!template) return "";
  const userStr = context.user?.id
    ? `<@${context.user.id}>`
    : (context.userId ? `<@${context.userId}>` : "Unknown");
  const emojiStr = context.emoji?.id
    ? `<:${context.emoji.name}:${context.emoji.id}>`
    : (context.emoji?.name || "");
  return template
    .replace(/\{user\}/g, userStr)
    .replace(/\{username\}/g, context.username || "Unknown")
    .replace(/\{server\}/g, context.guild?.name || "Unknown")
    .replace(/\{reason\}/g, context.reason || "No reason")
    .replace(/\{duration\}/g, context.duration || "")
    .replace(/\{mod\}/g, context.moderator || "Moderator")
    .replace(/\{emoji\}/g, emojiStr)
    .replace(/\{channel\}/g, context.channel?.name || "Unknown")
    .replace(/\{messageId\}/g, context.message?.id || context.messageId || "")
    .replace(/\{message\}/g, context.content || context.message?.content || "");
}

// Execute a single action from a rule definition.
async function executeAction(action, context) {
  if (!action || !action.type) return;

  try {
    switch (action.type) {
      case "dm_user": {
        // context.user is the affected Discord user/member
        const target = context.user || (context.member?.user ? context.member.user : null);
        if (!target) break;
        const msg = formatMessage(action.message, context);
        if (msg) await safe.orNull(target.send(msg), "autoexec dm_user");
        break;
      }

      case "dm_mod": {
        if (!context.moderatorUserId || !context.guild) break;
        const modMember = await safe.orNull(
          context.guild.members.fetch(context.moderatorUserId).catch(() => null),
          "autoexec fetch mod"
        );
        if (modMember) {
          const msg = formatMessage(action.message, context);
          if (msg) await safe.orNull(modMember.send(msg), "autoexec dm_mod");
        }
        break;
      }

      case "log_channel": {
        if (!context.guild) break;
        // Prefer the guild's system channel; fall back to the first text channel the bot can write to
        let ch = context.guild.systemChannel;
        if (!ch || !ch.permissionsFor(context.guild.members.me)?.has("SendMessages")) {
          ch = context.guild.channels.cache.find(
            (c) => c.type === 0 && c.permissionsFor(context.guild.members.me)?.has("SendMessages")
          );
        }
        if (ch) {
          const msg = formatMessage(action.message, context);
          if (msg) await safe.send(ch, { content: msg }, "autoexec log_channel");
        }
        break;
      }

      case "add_role": {
        if (!context.member || !action.roleId) break;
        const role = context.guild?.roles?.cache?.get(action.roleId);
        if (!role) break;
        const botHighest = context.guild?.members?.me?.roles?.highest?.position || 0;
        if (role.position < botHighest) {
          await safe.addRole(context.member, role, "autoexec add_role");
        }
        break;
      }

      case "remove_role": {
        if (!context.member || !action.roleId) break;
        if (!context.member.roles?.cache?.has(action.roleId)) break;
        const role = context.guild?.roles?.cache?.get(action.roleId);
        if (!role) break;
        const botHighest = context.guild?.members?.me?.roles?.highest?.position || 0;
        if (role.position < botHighest) {
          await safe.removeRole(context.member, role, "autoexec remove_role");
        }
        break;
      }

      case "send_channel": {
        // Send a message to a specified channel, optionally with a role mention.
        // - channelId: required — destination channel ID
        // - mention:   optional — "everyone", "here", or a role ID (17-20 digits)
        // - message:   required — text content (supports {user}, {emoji}, etc.)
        if (!context.guild || !action.channelId) break;
        const ch = context.guild.channels.cache.get(action.channelId);
        if (!ch || typeof ch.send !== "function") break;
        const botPerms = ch.permissionsFor(context.guild.members.me);
        if (!botPerms?.has("SendMessages")) break;
        const msg = formatMessage(action.message, context);
        let prefix = "";
        const mention = String(action.mention || "").trim();
        if (mention === "everyone") prefix = "@everyone ";
        else if (mention === "here") prefix = "@here ";
        else if (/^\d{17,20}$/.test(mention) && context.guild.roles.cache.has(mention)) {
          prefix = `<@&${mention}> `;
        }
        const content = `${prefix}${msg}`.trim();
        if (!content) break;
        const allowedMentions = mention === "everyone"
          ? { parse: ["everyone"] }
          : (mention === "here")
            ? { parse: ["everyone"] } // "here" piggybacks on @everyone parsing
            : (/^\d{17,20}$/.test(mention) ? { parse: ["roles"] } : { parse: [] });
        await safe.send(ch, { content, allowedMentions }, "autoexec send_channel");
        break;
      }
    }
  } catch (err) {
    console.error(`[autoexec] Failed to execute action ${action.type}:`, err.message);
  }
}

// ─── Main entry: fire all matching rules for a given trigger event ────────
async function executeTrigger(guildId, event, context) {
  if (!guildId || !event) return;

  const rules = getRules(guildId);
  if (!rules.length) return;

  const matching = rules.filter((r) => r.trigger_event === event && r.enabled);
  if (!matching.length) return;

  // Sort by priority ascending
  matching.sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for (const rule of matching) {
    try {
      if (!evaluateConditions(rule.conditions, context)) continue;

      for (const action of rule.actions) {
        await executeAction(action, context);
      }
    } catch (err) {
      console.error(`[autoexec] Error executing rule #${rule.id}:`, err.message);
    }
  }
}

module.exports = {
  load,
  getRules,
  hasRules,
  reloadGuild,
  reload,
  executeTrigger,
  evaluateConditions,
};
