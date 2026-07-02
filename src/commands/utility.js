const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, REST, Routes, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const safe = require("../safe");
const utils = require("../utils");
const { MAX_PURGE, isAuthorized, noPermEmbed, errorEmbed, successEmbed } = utils;
const config = require("../config");

const deletedMessageCache = new Map();
const DELETED_MESSAGES_PER_CHANNEL = 25;
const MAX_REVIVED_DESCRIPTION = 4000;

function currentPrefix() {
  return utils.PREFIX || "$";
}

function commandUsage(name, usage = "") {
  return `\`${currentPrefix()}${name}${usage ? ` ${usage}` : ""}\``;
}

function rememberDeletedMessage(message) {
  if (!message?.guild || !message?.channel?.id || !message?.author || message.partial) return;
  const content = String(message.content || "").trim();
  const attachments = [...(message.attachments?.values?.() || [])].map(a => ({
    name: a.name || "attachment",
    url: a.url,
  })).filter(a => a.url);
  if (!content && attachments.length === 0) return;

  const authorName = message.member?.displayName || message.author.globalName || message.author.username || message.author.tag || "Unknown user";
  const entry = {
    id: message.id,
    guildId: message.guild.id,
    channelId: message.channel.id,
    content,
    attachments,
    createdTimestamp: message.createdTimestamp || Date.now(),
    deletedAt: Date.now(),
    author: {
      id: message.author.id,
      tag: message.author.tag || message.author.username || "Unknown user",
      name: authorName,
      bot: Boolean(message.author.bot),
      avatarUrl: message.author.displayAvatarURL?.({ size: 128 }) || null,
    },
  };

  const channelMessages = deletedMessageCache.get(message.channel.id) || [];
  channelMessages.unshift(entry);
  deletedMessageCache.set(message.channel.id, channelMessages.slice(0, DELETED_MESSAGES_PER_CHANNEL));
}

function getDeletedMessageForChannel(channelId, { includeBots = false } = {}) {
  const channelMessages = deletedMessageCache.get(channelId) || [];
  return channelMessages.find(entry => includeBots || !entry.author.bot) || null;
}

function deletedMessageDescription(entry) {
  const parts = [];
  if (entry.content) parts.push(entry.content);
  if (entry.attachments.length) {
    parts.push(entry.attachments.map(a => `[${a.name}](${a.url})`).join("\n"));
  }
  const description = parts.join("\n\n").trim() || "*Message had no text content.*";
  return description.length > MAX_REVIVED_DESCRIPTION
    ? `${description.slice(0, MAX_REVIVED_DESCRIPTION - 1)}…`
    : description;
}

// ═══════════════════════════════════════════════════════════════
// INTERACTIVE HELP SYSTEM — with category select menu & buttons
// ═══════════════════════════════════════════════════════════════

const HELP_CATEGORIES = {
  utility:      { emoji: "🛠️",  label: "Utility",        desc: "Core commands: help, ping, purge, afk, sticky, and more" },
  info:         { emoji: "ℹ️",   label: "Info",           desc: "userinfo, serverinfo, roleinfo, whohas, avatar, botinfo" },
  fun:          { emoji: "🎉",   label: "Fun & Economy",  desc: "Games, memes, economy, 8ball, ships, gambling" },
  fakemod:      { emoji: "🎭",   label: "Fake Mod",       desc: "Visual-only prank moderation commands" },
  realmod:      { emoji: "🛡️",   label: "Real Mod",       desc: "Actual moderation: warn, mute, kick, ban, lock" },
  admin:        { emoji: "⚙️",   label: "Admin & Setup",  desc: "Config, settings, modules, roles, backups, scrape" },
  dynamic:      { emoji: "📦",   label: "Dynamic Modules",desc: "Custom loaded command modules" },
};

// Default category mapping for commands without an explicit `category` field
const DEFAULT_COMMAND_CATEGORY = {
  help: "utility", ping: "utility", purge: "utility", revivemessage: "utility",
  afk: "utility", reactionlog: "utility", reregister: "utility",
  sticky: "utility", websearch: "utility",
  ai: "utility",
  customrole: "admin", scrape: "admin", modules: "admin", settings: "admin",
  config: "admin", reactionrole: "admin", autorole: "admin", dangerzone: "admin",
  resetglobalconversation: "admin", clearmemories: "admin",
  realwarn: "realmod", realkick: "realmod", realban: "realmod", realmute: "realmod",
  realunmute: "realmod", realunban: "realmod", realsoftban: "realmod", realtempban: "realmod",
  reallock: "realmod", realunlock: "realmod", realslowmode: "realmod", syncperms: "realmod",
  realwarnlist: "realmod", realwarnclear: "realmod",
};

function catMeta(id) {
  return HELP_CATEGORIES[id] || { emoji: "❓", label: id, desc: "" };
}

// Group all commands (from commandMap) by category
function groupCommands(commandMap) {
  const groups = {};
  for (const [name, def] of commandMap) {
    if (def._dynamic) {
      (groups.dynamic ??= []).push({ name, def, catId: "dynamic" });
      continue;
    }
    const catId = def.category || DEFAULT_COMMAND_CATEGORY[name] || "utility";
    (groups[catId] ??= []).push({ name, def, catId });
  }
  // Sort within each group
  for (const id of Object.keys(groups)) {
    groups[id].sort((a, b) => a.name.localeCompare(b.name));
  }
  return groups;
}

function getCommandGroups(ctx) {
  return groupCommands(ctx.commandMap);
}

// Return category IDs in the display order defined by HELP_CATEGORIES, with any extras appended
function orderedCategoryIds(groups) {
  const seen = new Set();
  const ordered = [];
  // Start with the canonical order from HELP_CATEGORIES
  for (const id of Object.keys(HELP_CATEGORIES)) {
    if (groups[id]) {
      ordered.push(id);
      seen.add(id);
    }
  }
  // Append any extra categories not in HELP_CATEGORIES
  for (const id of Object.keys(groups)) {
    if (!seen.has(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

// Build the overview embed + select menu
function helpOverview(groups, prefix) {
  const total = Object.values(groups).reduce((s, cmds) => s + cmds.length, 0);
  const catOrder = orderedCategoryIds(groups);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 Bot Commands")
    .setDescription(
      `Browse commands by category using the menu below, or run \`${prefix}help <command>\` for details on a specific command.\n\n` +
      `**${total} commands** across **${catOrder.length} categories**`
    )
    .setFooter({ text: `Prefix: ${prefix}  •  Slash commands also available for most commands` });

  // Add a quick summary of categories as fields
  for (const catId of catOrder) {
    const cmds = groups[catId];
    const meta = catMeta(catId);
    embed.addFields({
      name: `${meta.emoji} ${meta.label} (${cmds.length})`,
      value: meta.desc || cmds.slice(0, 5).map(c => `\`${prefix}${c.name}\``).join(", ") + (cmds.length > 5 ? `, *+${cmds.length - 5} more*` : ""),
      inline: true,
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("help:select")
    .setPlaceholder("Pick a category…")
    .addOptions(
      catOrder.map(catId => {
        const cmds = groups[catId];
        const meta = catMeta(catId);
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${meta.emoji} ${meta.label}`)
          .setDescription(`${cmds.length} commands — ${meta.desc.slice(0, 80)}`)
          .setValue(catId);
      })
    );

  const searchBtn = new ButtonBuilder()
    .setCustomId("help:search")
    .setLabel("🔍 Search commands")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(searchBtn),
    ],
  };
}

// Build an embed for a single category showing its commands
function helpCategoryEmbed(groups, catId, prefix) {
  const cmds = groups[catId];
  if (!cmds || !cmds.length) return null;
  const meta = catMeta(catId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${meta.emoji} ${meta.label} (${cmds.length})`)
    .setFooter({ text: `Prefix: ${prefix}  •  Select a command for details` });

  // Show up to 25 commands per page (Discord field limit)
  for (const cmd of cmds.slice(0, 25)) {
    const cmdAliases = cmd.def.aliases || [];
    const aliasesStr = cmdAliases.length ? ` *(${cmdAliases.map(a => `\`${prefix}${a}\``).join(", ")})*` : "";
    const permRequired = cmd.def.defaultPermission && cmd.def.defaultPermission !== "everyone"
      ? ` \`[${cmd.def.defaultPermission}]\``
      : "";
    embed.addFields({
      name: `\`${prefix}${cmd.name}\`${permRequired}`,
      value: `${cmd.def.description || "—"}${aliasesStr}`.slice(0, 1024),
    });
  }

  if (cmds.length > 25) {
    embed.addFields({ name: `…and ${cmds.length - 25} more`, value: "Use the dashboard or `$help <command>` for details on specific commands." });
  }

  // Back + select components
  const backBtn = new ButtonBuilder()
    .setCustomId("help:back")
    .setLabel("← Back to categories")
    .setStyle(ButtonStyle.Secondary);

  const catOrder = orderedCategoryIds(groups);
  const select = new StringSelectMenuBuilder()
    .setCustomId("help:select")
    .setPlaceholder("Jump to another category…")
    .addOptions(
      catOrder.map(gid => {
        const gcmds = groups[gid];
        const m = catMeta(gid);
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${m.emoji} ${m.label}`)
          .setDescription(`${gcmds.length} commands — ${m.desc.slice(0, 80)}`)
          .setValue(gid);
      })
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(backBtn),
      new ActionRowBuilder().addComponents(select),
    ],
  };
}

// Build an embed for a single command's detail
function helpCommandDetail(cmdName, def, prefix, guildId, ctx) {
  const aliases = typeof ctx.commandAliases === "function" ? ctx.commandAliases(def, guildId) : (def.aliases || []);
  const resolved = ctx.config && typeof ctx.config.resolve === "function"
    ? ctx.config.resolve(guildId, cmdName, def)
    : null;
  const catId = def.category || DEFAULT_COMMAND_CATEGORY[cmdName] || "utility";
  const meta = catMeta(catId);

  const embed = new EmbedBuilder()
    .setColor(resolved?.enabled ? 0x00c776 : 0xed4245)
    .setTitle(`${meta.emoji} \`${prefix}${cmdName}\``)
    .setDescription(def.description || "—");

  embed.addFields(
    { name: "Category", value: `${meta.emoji} ${meta.label}`, inline: true },
    { name: "Default Permission", value: def.defaultPermission ? (config.PERM_LABELS?.[def.defaultPermission] || def.defaultPermission) : "Everyone", inline: true },
    { name: "Slash Command", value: def.slash ? "✅ Available" : "❌ Prefix only", inline: true },
  );

  if (aliases.length) {
    embed.addFields({ name: "Aliases", value: aliases.map(a => `\`${prefix}${a}\``).join(", ") });
  }

  if (def.defaultSettings && Object.keys(def.defaultSettings).length) {
    embed.addFields({ name: "Settings", value: Object.entries(def.defaultSettings).map(([k, v]) => `\`${k}\`: ${JSON.stringify(v)}`).join("\n").slice(0, 1024) });
  }

  embed.addFields({ name: "Configure", value: `\`${prefix}config ${cmdName}\` — change permissions, cooldowns, channels, aliases` });

  embed.setFooter({ text: `Prefix: ${prefix}  •  Slash: /${cmdName}` });

  return embed;
}

// ─── Handlers ────────────────────────────────────────────────

async function prefixHelp(message, args, ctx) {
  const groups = getCommandGroups(ctx);
  const prefix = currentPrefix();

  // $help <command> — show detail for a specific command
  if (args.length > 0) {
    const query = args[0].toLowerCase();
    const resolved = ctx.resolvePrefixCommand
      ? ctx.resolvePrefixCommand(query, message.guild?.id)
      : { name: query, def: ctx.commandMap.get(query), usedAlias: null };
    const def = resolved.def;
    if (def && !def._dynamic) {
      const embed = helpCommandDetail(resolved.name, def, prefix, message.guild?.id, ctx);
      return message.reply({ embeds: [embed] });
    }
    // Not found — show a quick error before the overview
    const notFoundEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setDescription(`❌ Unknown command \`${query}\`. Browse categories below.`);
    await message.reply({ embeds: [notFoundEmbed] });
  }

  const payload = helpOverview(groups, prefix);
  await message.reply(payload);
}

async function slashHelp(interaction, ctx) {
  const groups = getCommandGroups(ctx);
  const prefix = currentPrefix();

  const query = interaction.options.getString("command");
  if (query) {
    const resolved = ctx.resolvePrefixCommand
      ? ctx.resolvePrefixCommand(query.toLowerCase(), interaction.guild?.id)
      : { name: query.toLowerCase(), def: ctx.commandMap.get(query.toLowerCase()), usedAlias: null };
    const def = resolved.def;
    if (def && !def._dynamic) {
      const embed = helpCommandDetail(resolved.name, def, prefix, interaction.guild?.id, ctx);
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  }

  const payload = helpOverview(groups, prefix);
  await interaction.reply(payload);
}

// ─── Interaction handlers (called from index.js) ─────────────

async function handleHelpSelect(interaction) {
  await interaction.deferUpdate();
  const ctx = interaction.client._helpCtx;
  if (!ctx) return;

  const catId = interaction.values[0];
  const groups = getCommandGroups(ctx);
  const payload = helpCategoryEmbed(groups, catId, currentPrefix());
  if (!payload) {
    return interaction.editReply({ content: "Category not found.", embeds: [], components: [] });
  }
  await interaction.editReply(payload);
}

async function handleHelpBack(interaction) {
  await interaction.deferUpdate();
  const ctx = interaction.client._helpCtx;
  if (!ctx) return;

  const groups = getCommandGroups(ctx);
  const payload = helpOverview(groups, currentPrefix());
  await interaction.editReply(payload);
}

// ─── Help search (modal-based) ──────────────────────────────

async function handleHelpSearchButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("help:search:modal")
    .setTitle("🔍 Search Commands")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Search query")
          .setPlaceholder("Type a command name, alias, or keyword…")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      )
    );
  await interaction.showModal(modal);
}

async function handleHelpSearchModal(interaction) {
  const query = interaction.fields.getTextInputValue("query").trim().toLowerCase();
  if (!query) {
    return interaction.reply({ content: "Please enter a search query.", flags: MessageFlags.Ephemeral });
  }

  const ctx = interaction.client._helpCtx;
  if (!ctx) {
    return interaction.reply({ content: "Help context not available. Try again.", flags: MessageFlags.Ephemeral });
  }

  const prefix = currentPrefix();
  const results = [];
  const seen = new Set();

  for (const [name, def] of ctx.commandMap) {
    if (def._dynamic) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const catId = def.category || DEFAULT_COMMAND_CATEGORY[name] || "utility";
    const aliases = typeof ctx.commandAliases === "function" ? ctx.commandAliases(def, interaction.guild?.id) : (def.aliases || []);
    const desc = (def.description || "").toLowerCase();

    if (name.includes(query)) {
      results.push({ name, def, aliases, catId, match: "name" });
    } else if (aliases.some(a => a.includes(query))) {
      results.push({ name, def, aliases, catId, match: "alias" });
    } else if (desc.includes(query)) {
      results.push({ name, def, aliases, catId, match: "description" });
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));

  const embed = new EmbedBuilder()
    .setColor(results.length ? 0x5865f2 : 0xed4245)
    .setTitle(`🔍 Search: "${query.slice(0, 50)}"`)
    .setDescription(
      results.length
        ? `Found **${results.length}** command${results.length !== 1 ? "s" : ""} matching your query. Use \`${prefix}help <command>\` for details.`
        : `No commands matched \`${query}\`. Try a different search term.`
    );

  for (const r of results.slice(0, 25)) {
    const meta = catMeta(r.catId);
    const badge = r.match === "name" ? "`[name]`" : r.match === "alias" ? "`[alias]`" : "`[desc]`";
    const aliasStr = r.aliases.length ? ` (${r.aliases.map(a => `\`${prefix}${a}\``).join(", ")})` : "";
    embed.addFields({
      name: `\`${prefix}${r.name}\``,
      value: `${meta.emoji} ${badge} ${r.def.description || "—"}${aliasStr}`.slice(0, 1024),
    });
  }

  if (results.length > 25) {
    embed.addFields({ name: `…and ${results.length - 25} more results`, value: "Refine your search to narrow it down." });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Wire this up from index.js once client is ready
function wireHelpContext(ctx) {
  if (ctx?.client) {
    ctx.client._helpCtx = ctx;
  }
}



// ─── Ping
async function prefixPing(message, args, ctx) {
  const sent = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("🏓 Pinging...")] });
  const latency = sent.createdTimestamp - message.createdTimestamp;
  const apiLatency = Math.round(ctx.client.ws.ping);
  await sent.edit({ embeds: [new EmbedBuilder().setColor(0x00c776).setDescription(`🏓 **Pong!**\nLatency: \`${latency}ms\`\nAPI Latency: \`${apiLatency}ms\``)] });
}

async function slashPing(interaction, ctx) {
  const sent = await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription("🏓 Pinging...")], fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  const apiLatency = Math.round(ctx.client.ws.ping);
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00c776).setDescription(`🏓 **Pong!**\nLatency: \`${latency}ms\`\nAPI Latency: \`${apiLatency}ms\``)] });
}

// ─── Purge
async function prefixPurge(message, args, ctx) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages))
    return message.reply({ embeds: [errorEmbed("I need the `Manage Messages` permission to purge.")] });
  const amount = parseInt(args[0], 10);
  if (isNaN(amount) || amount < 1 || amount > MAX_PURGE)
    return message.reply({ embeds: [errorEmbed(`Provide a number between 1 and ${MAX_PURGE}`)] });
  try {
    const deleted = await message.channel.bulkDelete(amount, true);
    await safe.delete(message, "purge command");
    const confirm = await message.channel.send({ embeds: [successEmbed(`Deleted ${deleted.size} messages.`)] });
    setTimeout(() => safe.delete(confirm, "purge confirmation"), 4000);
  } catch (err) {
    console.error(err);
    await message.channel.send({ embeds: [errorEmbed(`Failed: ${err.message}`)] });
  }
}

async function slashPurge(interaction, ctx) {
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages))
    return interaction.reply({ embeds: [errorEmbed("I need the `Manage Messages` permission.")], flags: MessageFlags.Ephemeral });
  const amount = interaction.options.getInteger("amount");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const deleted = await interaction.channel.bulkDelete(amount, true);
    await interaction.editReply({ embeds: [successEmbed(`Deleted ${deleted.size} messages.`)] });
  } catch (err) {
    await interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)] });
  }
}

async function prefixReviveMessage(message, args, ctx) {
  const settings = ctx.config?.resolve(message.guild.id, "revivemessage", ctx.commandMap?.get("revivemessage")).settings || {};
  const deleted = getDeletedMessageForChannel(message.channel.id, { includeBots: settings.includeBots === true });
  if (!deleted) {
    return message.reply({ embeds: [errorEmbed(settings.includeBots === true
      ? "No deleted messages have been cached in this channel yet."
      : "No deleted non-bot messages have been cached in this channel yet. Bot messages can be included from the dashboard.")] });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: deleted.author.name || deleted.author.tag, iconURL: deleted.author.avatarUrl || undefined })
    .setDescription(deletedMessageDescription(deleted))
    .setTimestamp(deleted.deletedAt);

  await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function slashReviveMessage(interaction, ctx) {
  const settings = ctx.config?.resolve(interaction.guild.id, "revivemessage", ctx.commandMap?.get("revivemessage")).settings || {};
  const deleted = getDeletedMessageForChannel(interaction.channel.id, { includeBots: settings.includeBots === true });
  if (!deleted) {
    return interaction.reply({
      embeds: [errorEmbed(settings.includeBots === true
        ? "No deleted messages have been cached in this channel yet."
        : "No deleted non-bot messages have been cached in this channel yet. Bot messages can be included from the dashboard.")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: deleted.author.name || deleted.author.tag, iconURL: deleted.author.avatarUrl || undefined })
    .setDescription(deletedMessageDescription(deleted))
    .setTimestamp(deleted.deletedAt);

  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

// ─── AFK
function timeAgo(ts) {
  const diff = Date.now() - ts, s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (s < 10) return "a few seconds ago"; if (s < 60) return `${s}s ago`;
  if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`; return `${d}d ago`;
}

async function prefixAfk(message, args, ctx) {
  const { data } = ctx;
  data.afkUsers[message.author.id] = { reason: args.join(" ") || "AFK", since: Date.now(), guildId: message.guild.id };
  data.saveAfk();
  await safe.delete(message, "afk command");
  const c = await message.channel.send(`👋 ${message.author} I set your AFK: **${args.join(" ") || "AFK"}**`);
  setTimeout(() => safe.delete(c, "afk confirmation"), 5000);
}

async function slashAfk(interaction, ctx) {
  const reason = interaction.options.getString("reason") || "AFK";
  const { data } = ctx;
  data.afkUsers[interaction.user.id] = { reason, since: Date.now(), guildId: interaction.guild.id };
  data.saveAfk();
  await interaction.reply({ content: `👋 ${interaction.user} I set your AFK: **${reason}**`, flags: 0 });
}

// Exported for use in the messageCreate handler
async function handleAfkChecks(message, ctx) {
  const { data } = ctx;
  if (data.afkUsers[message.author.id]) {
    delete data.afkUsers[message.author.id];
    data.saveAfk();
    const back = await message.channel.send(`👋 Welcome back ${message.author}, I removed your AFK.`);
    setTimeout(() => safe.delete(back, "afk welcome back"), 5000);
  }
  for (const [userId, user] of message.mentions.users) {
    if (userId === message.author.id) continue;
    const entry = data.afkUsers[userId]; if (!entry) continue;
    if (entry.guildId && entry.guildId !== message.guild.id) continue;
    const member = await safe.orNull(message.guild.members.fetch(userId), `afk check fetch member ${userId}`);
    await message.channel.send(`💤 **${member?.displayName ?? user.username}** is AFK: ${entry.reason} — ${timeAgo(entry.since)}`);
  }
}

// ─── Reregister (re-register slash commands) ──────────────────────────────
async function prefixReregister(message, args, ctx) {
  const { slashDefs, client } = ctx;
  if (!slashDefs || slashDefs.length === 0) {
    return message.reply({ embeds: [errorEmbed("No slash commands to register.")] });
  }
  if (!client?.user) {
    return message.reply({ embeds: [errorEmbed("Bot is not ready yet.")] });
  }
  const status = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`⏳ Registering **${slashDefs.length}** slash commands globally...`)] });

  try {
    const rest = new REST().setToken(process.env.BOT_TOKEN);
    const body = slashDefs.map(s => s.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    await status.edit({ embeds: [new EmbedBuilder().setColor(0x00c776).setDescription(`✅ Registered **${slashDefs.length}** slash commands globally. It may take a few minutes for Discord to propagate the changes.`)] });
  } catch (err) {
    console.error("Reregister error:", err);
    await status.edit({ embeds: [errorEmbed(`Failed: ${err.message}`)] });
  }
}

// ─── Reaction Log
async function prefixReactionLog(message, args, ctx) {
  const { data } = ctx;
  const sub = args[0]?.toLowerCase();
  if (sub === "set") {
    const logChannel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
    if (!logChannel) return message.reply({ embeds: [errorEmbed(`Usage: ${commandUsage("reactionlog", "set #channel")}`)] });
    data.reactionlogs[message.guild.id] = { channelId: logChannel.id }; data.saveReactionlogs();
    await message.reply({ embeds: [successEmbed(`Reaction log set to ${logChannel}`)] });
  } else if (sub === "remove" || sub === "clear") {
    delete data.reactionlogs[message.guild.id]; data.saveReactionlogs();
    await message.reply({ embeds: [successEmbed("Reaction log removed.")] });
  } else {
    await message.reply({ embeds: [errorEmbed(`Usage: ${commandUsage("reactionlog", "set #channel")} or ${commandUsage("reactionlog", "remove")}`)] });
  }
}

async function slashReactionLog(interaction, ctx) {
  const { data } = ctx;
  const sub     = interaction.options.getString("action");
  const channel = interaction.options.getChannel("channel");
  if (sub === "set") {
    if (!channel) return interaction.reply({ embeds: [errorEmbed("Provide a channel.")], flags: MessageFlags.Ephemeral });
    data.reactionlogs[interaction.guild.id] = { channelId: channel.id }; data.saveReactionlogs();
    await interaction.reply({ embeds: [successEmbed(`Reaction log set to ${channel}`)] });
  } else {
    delete data.reactionlogs[interaction.guild.id]; data.saveReactionlogs();
    await interaction.reply({ embeds: [successEmbed("Reaction log removed.")] });
  }
}

module.exports = [
  {
    name: "help",
    description: "Show bot commands",
    prefix: prefixHelp,
    slash: new SlashCommandBuilder()
      .setName("help")
      .setDescription("Browse bot commands interactively")
      .addStringOption(o => o.setName("command").setDescription("Get details for a specific command").setRequired(false)),
    execute: slashHelp,
  },
  {
    name: "ping",
    description: "Check latency",
    prefix: prefixPing,
    slash: new SlashCommandBuilder().setName("ping").setDescription("Check latency"),
    execute: slashPing,
  },
  {
    name: "purge",
    description: "Bulk delete messages",
    defaultPermission: "mod",
    prefix: prefixPurge,
    slash: new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Bulk delete messages")
      .addIntegerOption(o => o.setName("amount").setDescription("Number of messages to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(MAX_PURGE)),
    execute: slashPurge,
  },
  {
    name: "revivemessage",
    description: "Revive the latest deleted message in the current channel",
    aliases: ["revive"],
    defaultPermission: "mod",
    defaultSettings: { includeBots: false },
    prefix: prefixReviveMessage,
    slash: new SlashCommandBuilder()
      .setName("revivemessage")
      .setDescription("Revive the latest deleted message in this channel"),
    execute: slashReviveMessage,
  },
  {
    name: "afk",
    description: "Set AFK status",
    prefix: prefixAfk,
    slash: new SlashCommandBuilder()
      .setName("afk")
      .setDescription("Set AFK status")
      .addStringOption(o => o.setName("reason").setDescription("AFK reason").setRequired(false)),
    execute: slashAfk,
  },
  {
    name: "reactionlog",
    description: "Set/remove reaction log channel",
    defaultPermission: "mod",
    prefix: prefixReactionLog,
    slash: new SlashCommandBuilder()
      .setName("reactionlog")
      .setDescription("Set or remove the reaction log channel")
      .addStringOption(o => o.setName("action").setDescription("set or remove").setRequired(true).addChoices({ name: "set", value: "set" }, { name: "remove", value: "remove" }))
      .addChannelOption(o => o.setName("channel").setDescription("Channel to log to").setRequired(false)),
    execute: slashReactionLog,
  },
  {
    name: "reregister",
    description: "Re-register all slash commands globally",
    defaultPermission: "owner",
    prefix: prefixReregister,
  },
];

module.exports.handleAfkChecks        = handleAfkChecks;
module.exports.rememberDeletedMessage = rememberDeletedMessage;
module.exports.handleHelpSelect        = handleHelpSelect;
module.exports.handleHelpBack          = handleHelpBack;
module.exports.handleHelpSearchButton  = handleHelpSearchButton;
module.exports.handleHelpSearchModal   = handleHelpSearchModal;
module.exports.wireHelpContext         = wireHelpContext;
