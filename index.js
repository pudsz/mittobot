const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, MessageFlags } = require("discord.js");
const fs = require("fs");
require("dotenv").config();

const db = require("./src/db");
const data = require("./src/data");
const utils = require("./src/utils");
const settings = require("./src/settings");
const features = require("./src/features");
const config = require("./src/config");
const automod = require("./src/automod");
const greet = require("./src/greet");
const roles = require("./src/roles");
const dangerzone = require("./src/dangerzone");
const antiraid = require("./src/antiraid");
const theme = require("./src/theme");
const ui = require("./src/ui");
const { loadModule, MODULES_DIR, ensureModulesDir } = require("./src/commands/modules");
const aiMemory = require("./src/ai/memory");
const autoexec = require("./src/autoexec");
const safe = require("./src/safe");
const roletracker = require("./src/roletracker");
const femboyify = require("./src/femboyify");
const scheduler = require("./src/scheduler");

const commandMap = new Map();
const slashMap = new Map();
const slashDefs = [];

function normalizeCommandName(name) {
  return String(name || "").trim().toLowerCase();
}

function commandAliases(def, guildId = null) {
  const aliases = new Set();
  for (const alias of def?.aliases || []) {
    const normalized = normalizeCommandName(alias);
    if (normalized) aliases.add(normalized);
  }
  const configured = config.resolve(guildId, def.name, def).settings?.aliases;
  if (Array.isArray(configured)) {
    for (const alias of configured) {
      const normalized = normalizeCommandName(alias);
      if (normalized) aliases.add(normalized);
    }
  }
  aliases.delete(normalizeCommandName(def?.name));
  return [...aliases];
}

function resolvePrefixCommand(input, guildId = null) {
  const name = normalizeCommandName(input);
  const direct = commandMap.get(name);
  if (direct) return { name, def: direct, usedAlias: null };
  for (const def of commandMap.values()) {
    if (!def?.name) continue;
    if (commandAliases(def, guildId).includes(name)) {
      return { name: def.name, def, usedAlias: name };
    }
  }
  return { name, def: null, usedAlias: null };
}

function registerCommands(defs) {
  for (const cmd of defs) {
    commandMap.set(cmd.name, cmd);
    if (cmd.slash && cmd.execute) {
      slashMap.set(cmd.name, cmd.execute);
      slashDefs.push(cmd.slash);
    }
  }
}

// Load all built-in command files
const COMMAND_FILES = [
  "./src/commands/utility",
  "./src/commands/sticky",
  "./src/commands/customrole",
  "./src/commands/mod",
  "./src/commands/scrape",
  "./src/commands/modules",
  "./src/commands/settings",
  "./src/commands/fun",
  "./src/commands/economy",
  "./src/commands/rpsmp",
  "./src/commands/info",
  "./src/commands/config",
  "./src/commands/reactionrole",
  "./src/commands/autorole",
  "./src/commands/dangerzone",
  "./src/commands/ai",
  "./src/commands/clearmemories",
  "./src/commands/schedule",
  "./src/commands/backup",
  "./src/commands/websearch",
  "./src/commands/theme",
  "./src/commands/voice",
];
for (const file of COMMAND_FILES) {
  const defs = require(file);
  registerCommands(Array.isArray(defs) ? defs : [defs]);
}

ensureModulesDir();
const moduleFiles = [];
if (fs.existsSync(MODULES_DIR)) {
  for (const entry of fs.readdirSync(MODULES_DIR)) {
    if (entry.endsWith(".js")) {
      moduleFiles.push(entry);
    }
  }
}

for (const file of moduleFiles) {
  const name = file.replace(".js", "");
  try {
    loadModule(name, commandMap);
  } catch (err) {
    console.error(`Failed to load module ${name}:`, err.message);
  }
}

let voiceManager = null;

const ctx = {
  client: null,
  data,
  utils,
  commandMap,
  slashMap,
  slashDefs,
  commandAliases,
  resolvePrefixCommand,
  config,
  features,
  automod,
  greet,
  roles,
  dangerzone,
  autoexec,
  roletracker,
  femboyify,
  get voiceManager() { return voiceManager; },
};

// Central access control for commands.
function checkAccess(def, command, { member, userId, channelId }) {
  if (!def) {
    return { ok: false, reason: "unknown" };
  }

  if (def.category && !features.isEnabled(def.category)) {
    return { ok: false, reason: "category" };
  }

  return config.evaluate({
    guildId: member?.guild?.id ?? null,
    command,
    def,
    member,
    userId,
    channelId,
    now: Date.now(),
  });
}

function denyMessage(guildId, reason, remain) {
  const tone = require("./src/tone");
  switch (reason) {
    case "disabled":
    case "category":
    case "channel":
    case "cooldown":
      return tone.t(guildId, `deny.${reason}`, { remain });
    case "permission": {
      // A customized global noPermMsg overrides the tone pack.
      const msg = settings.get("noPermMsg");
      if (msg && msg !== settings.DEFAULTS.noPermMsg) return msg;
      return tone.t(guildId, "deny.permission");
    }
    default:
      return tone.t(guildId, "deny.default");
  }
}

// Event helpers
const { handleAfkChecks, rememberDeletedMessage, handleHelpSelect, handleHelpBack, handleHelpSearchButton, handleHelpSearchModal, wireHelpContext } = require("./src/commands/utility");
const { handleStickyRepost } = require("./src/commands/sticky");
const { handleSettingsButton, handleSettingsModal } = require("./src/commands/settings");
const { handleAiMessage } = require("./src/ai");
const VoiceManager = require("./src/voice");

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    // Required to receive messageCreate events in DMs (DM AI). Without this the
    // bot never sees direct messages at all, regardless of aiDmEnabled.
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
ctx.client = client;

// Event handlers
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // DM support — route direct messages to AI if enabled
  if (!message.guild) {
    if (settings.get("aiDmEnabled") !== false) {
      await handleAiMessage(message, ctx);
    }
    return;
  }

  // Automod runs first; if it removed the message, stop processing.
  try {
    if (await automod.checkMessage(message)) return;
  } catch (err) { console.error("Automod error:", err.message); }

  // Dangerzone: if the channel is a trap, punish and stop.
  try {
    if (await dangerzone.checkMessage(message)) return;
  } catch (err) { console.error("Dangerzone error:", err.message); }

  // Auto-exec: fire any rules triggered by the "message" event (only if guild has rules)
  if (autoexec.hasRules(message.guild.id)) {
    try {
      await autoexec.executeTrigger(message.guild.id, "message", {
        guild: message.guild,
        user: message.author,
        member: message.member,
        username: message.author.username,
        userId: message.author.id,
        messageId: message.id,
        message,
        content: message.content,
        channel: message.channel,
      });
    } catch (err) { console.error("Autoexec message error:", err.message); }
  }

  // Maintenance mode — block everything for non-owners
  const maintenanceMode = settings.get("maintenanceMode");
  const prefix = utils.PREFIX;
  if (maintenanceMode && !utils.isOwner(message.author.id)) {
    if (message.content.startsWith(prefix) || message.mentions.has(client.user.id)) {
      const mainMsg = settings.get("maintenanceMessage") || "🔧 The bot is currently under maintenance. Please try again later.";
      safe.reply(message, { embeds: [utils.errorEmbed(mainMsg)] }, "maintenance mode");
    }
    return;
  }

  if (data.stickies[message.channel.id] && message.id !== data.stickies[message.channel.id]?.messageId) {
    await handleStickyRepost(message.channel, data);
  }

  await handleAfkChecks(message, ctx);

  await handleAiMessage(message, ctx);

  const content = message.content;
  if (!content.startsWith(prefix)) return;

  const parts = content.slice(prefix.length).trim().split(/\s+/);
  const rawCommand = parts.shift();
  const { name: command, def: handler } = resolvePrefixCommand(rawCommand, message.guild.id);
  const args = parts;

  if (!handler || !handler.prefix) return;

  const access = checkAccess(handler, command, {
    member: message.member,
    userId: message.author.id,
    channelId: message.channel.id,
  });

  if (!access.ok) {
    if (["permission", "channel", "cooldown"].includes(access.reason)) {
      safe.reply(message, { embeds: [utils.errorEmbed(denyMessage(message.guild.id, access.reason, access.remain), message)] }, "access denied message");
    }
    return;
  }

  try {
    if (typeof ctx.trackCommand === "function") {
      ctx.trackCommand();
    }
    await handler.prefix(message, args, ctx);
  } catch (err) {
    console.error(`Error executing command ${command}:`, err);
    safe.reply(message, { embeds: [theme.say(message, "error", "error.generic")] }, "command error");
  }
});

client.on("interactionCreate", async interaction => {
  try {
    // ui.js central dispatch — pagination, confirm dialogs, registered panels.
    if (interaction.customId && await ui.dispatch(interaction)) return;
    // Help system: category select menu
    if (interaction.isStringSelectMenu() && interaction.customId === "help:select") {
      return await handleHelpSelect(interaction);
    }
    // Help system: back button
    if (interaction.isButton() && interaction.customId === "help:back") {
      return await handleHelpBack(interaction);
    }
    // Help system: search button (opens modal)
    if (interaction.isButton() && interaction.customId === "help:search") {
      return await handleHelpSearchButton(interaction);
    }
    // Help system: search modal submit
    if (interaction.isModalSubmit() && interaction.customId === "help:search:modal") {
      return await handleHelpSearchModal(interaction);
    }
    // Settings GUI: buttons
    if (interaction.isButton() && interaction.customId.startsWith("settings:")) {
      return await handleSettingsButton(interaction);
    }
    // Settings GUI: modals
    if (interaction.isModalSubmit() && interaction.customId.startsWith("settings_modal:")) {
      return await handleSettingsModal(interaction);
    }
    // Multiplayer RPS button clicks
    if (interaction.isButton() && interaction.customId.startsWith("rpsmp_")) {
      const rpsmpMod = require("./src/commands/rpsmp");
      if (typeof rpsmpMod.handleRpsMpButton === "function") {
        return await rpsmpMod.handleRpsMpButton(interaction);
      }
    }
    // Alpha experiments: proceed button → open code modal
    if (interaction.isButton() && interaction.customId === "experiments:proceed") {
      const db = require("./src/db");
      const modal = new (require("discord.js").ModalBuilder)()
        .setCustomId("experiments:code")
        .setTitle("Alpha Experiments — Enter Code")
        .addComponents(
          new (require("discord.js").ActionRowBuilder)().addComponents(
            new (require("discord.js").TextInputBuilder)()
              .setCustomId("code")
              .setLabel("24-character activation code")
              .setStyle(require("discord.js").TextInputStyle.Short)
              .setPlaceholder("e.g. A1B2C3D4E5F6G7H8I9J0K1L2")
              .setRequired(true)
              .setMinLength(24)
              .setMaxLength(24),
          ),
        );
      return await interaction.showModal(modal);
    }
    // Alpha experiments: cancel button → just delete the ephemeral
    if (interaction.isButton() && interaction.customId === "experiments:cancel") {
      return await interaction.update({ components: [] });
    }
    // Alpha experiments: modal submit with code
    if (interaction.isModalSubmit() && interaction.customId === "experiments:code") {
      const code = interaction.fields.getTextInputValue("code").toUpperCase();
      const db = require("./src/db");
      const data = require("./src/data");
      const codeRow = await db.getAlphaCode(code);
      if (!codeRow || codeRow.used_by) {
        return await interaction.reply({ embeds: [new (require("discord.js").EmbedBuilder)().setColor(0xed4245).setDescription("❌ Invalid or already-used alpha code.")], ephemeral: true });
      }
      data.addAlphaUser(interaction.user.id, interaction.guildId, { codeUsed: code });
      await db.useAlphaCode(code, interaction.user.id);
      try {
        const user = await interaction.client.users.fetch(interaction.user.id);
        await user.send({ embeds: [new (require("discord.js").EmbedBuilder)().setColor(0x9b59b6).setDescription("🧪 **Alpha experiments activated!**\nYou now have access to experimental AI server management tools.\nUse `/experiments status` to check your status.")] });
      } catch {}
      return await interaction.reply({ embeds: [new (require("discord.js").EmbedBuilder)().setColor(0x57f287).setDescription("✅ **Alpha activated!** Check your DMs for confirmation.")], ephemeral: true });
    }
    // Slash commands
    if (interaction.isChatInputCommand()) {
      // Maintenance mode — block slash commands for non-owners
      const maintenanceMode = settings.get("maintenanceMode");
      if (maintenanceMode && !utils.isOwner(interaction.user.id)) {
        const mainMsg = settings.get("maintenanceMessage") || "🔧 The bot is currently under maintenance. Please try again later.";
        return interaction.reply({
          embeds: [utils.errorEmbed(mainMsg)],
          flags: MessageFlags.Ephemeral,
        });
      }
      const execute = slashMap.get(interaction.commandName);
      if (!execute) return;
      const def = commandMap.get(interaction.commandName);
      const access = checkAccess(def, interaction.commandName, {
        member: interaction.member, userId: interaction.user.id, channelId: interaction.channelId,
      });
      if (!access.ok) {
        return interaction.reply({
          embeds: [utils.errorEmbed(denyMessage(interaction.guildId, access.reason, access.remain), interaction)],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (typeof ctx.trackCommand === "function") ctx.trackCommand();
      await execute(interaction, ctx);
    }
  } catch (err) {
    // 10062 = Unknown interaction (token expired, >3s), 40060 = already acknowledged.
    // Both mean the interaction is dead — replying again just throws the same error,
    // so log quietly and bail instead of emitting a full stack + a doomed follow-up.
    if (err?.code === 10062 || err?.code === 40060) {
      console.warn(`Interaction expired (${interaction.commandName ?? interaction.customId}); skipping reply.`);
      return;
    }
    console.error(`Interaction error (${interaction.customId ?? interaction.commandName}):`, err);
    const reply = { embeds: [theme.say(interaction, "error", "error.generic")], flags: 64 }; // 64 = Ephemeral
    try {
      interaction.replied || interaction.deferred
        ? await interaction.followUp(reply)
        : await interaction.reply(reply);
    } catch {}
  }
});

async function logReaction(reaction, user, added) {
  if (user.bot) return;

  if (reaction.partial) {
    const fetched = await safe.orNull(reaction.fetch(), "fetch partial reaction");
    if (!fetched) return;
  }

  let msg = reaction.message;
  if (msg.partial) {
    msg = await safe.orNull(msg.fetch(), "fetch partial message for reaction log");
    if (!msg) return;
  }

  const guild = msg.guild;
  if (!guild) return;

  const entry = data.reactionlogs[guild.id];
  if (!entry) return;

  const ch = guild.channels.cache.get(entry.channelId);
  if (!ch) return;

  const emoji = reaction.emoji;
  const isCustom = Boolean(emoji.id);
  const isExternal = isCustom && !guild.emojis.cache.has(emoji.id);

  const display = isCustom
    ? `<${emoji.animated ? "a" : ""}:${emoji.name || "_"}:${emoji.id}>`
    : emoji.name;

  const imageUrl = isCustom
    ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=96&quality=lossless`
    : null;

  const emojiInfo = isCustom
    ? `\`:${emoji.name || "unknown"}:\` • ID \`${emoji.id}\`${emoji.animated ? " • animated" : ""}${isExternal ? " • **external**" : ""}`
    : `\`${emoji.name}\``;

  const author = msg.author;
  const snippet = msg.content
    ? (msg.content.length > 120 ? `${msg.content.slice(0, 117)}…` : msg.content)
    : (msg.attachments?.size ? "*[attachment]*" : "*[no text content]*");

  const embed = new EmbedBuilder()
    .setColor(added ? 0x57f287 : 0xed4245)
    .setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL?.() })
    .setDescription(`${display} ${added ? "added by" : "removed by"} <@${user.id}> on [a message](${msg.url}) in <#${msg.channel.id}>`)
    .addFields(
      { name: "Emoji", value: emojiInfo, inline: false },
      { name: "Message Author", value: author ? `${author.tag} (<@${author.id}>)` : "Unknown", inline: true },
      { name: "Total Now", value: `${reaction.count ?? "?"}`, inline: true },
      { name: "Content", value: snippet, inline: false },
    )
    .setFooter({ text: `#${msg.channel.name} • msg ${msg.id}` })
    .setTimestamp();

  if (imageUrl) {
    embed.setThumbnail(imageUrl);
  }

  safe.send(ch, { embeds: [embed] }, "reaction log");
}

// ─── Voice State Handler ───────────────────────────────────────────────────
client.on("voiceStateUpdate", (oldState, newState) => {
  if (voiceManager) {
    voiceManager.handleVoiceStateUpdate(oldState, newState);
  }
});

client.on("messageReactionAdd", async (reaction, user) => {
  logReaction(reaction, user, true).catch(err => console.error("[safe] reaction log:", err.message));
  roles.onReaction(reaction, user, true).catch(err => console.error("[safe] reaction role add:", err.message));
  // Auto-exec: hydrate partials first so emoji data is complete
  if (reaction.message?.guild) {
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
    automod.checkReaction(reaction, user).catch(err => console.error("[safe] automod reaction:", err.message));
    autoexec.executeTrigger(reaction.message.guild.id, "reaction_added", {
      guild: reaction.message.guild,
      user,
      member: reaction.message.guild.members.cache.get(user.id) ?? await reaction.message.guild.members.fetch(user.id).catch(() => null),
      messageId: reaction.message.id,
      message: reaction.message,
      channel: reaction.message.channel,
      content: reaction.message.content || "",
      emoji: reaction.emoji,
    }).catch(err => console.error("autoexec reaction_added:", err.message));
  }
});
client.on("messageReactionRemove", (reaction, user) => {
  logReaction(reaction, user, false).catch(err => console.error("[safe] reaction log:", err.message));
  roles.onReaction(reaction, user, false).catch(err => console.error("[safe] reaction role remove:", err.message));
});

// Welcome, leave, and autorole events
client.on("guildMemberAdd", member => {
  // Anti-raid runs FIRST — before greet/autoroles — so a raiding wave or a
  // too-new account is stopped before it gets roles or a welcome message.
  antiraid.onMemberAdd(member).catch(err => console.error("antiraid add:", err.message));
  greet.onMemberAdd(member).catch(err => console.error("greet add:", err.message));
  roles.onMemberAdd(member).catch(err => console.error("autorole:", err.message));
  // Auto-exec: fire any rules triggered by the "join" event
  autoexec.executeTrigger(member.guild.id, "join", {
    guild: member.guild,
    user: member.user,
    member,
    username: member.user.username,
    userId: member.id,
  }).catch(err => console.error("autoexec join:", err.message));
});
client.on("guildMemberRemove", member => {
  greet.onMemberRemove(member).catch(err => console.error("greet remove:", err.message));
  // Auto-exec: fire any rules triggered by the "leave" event
  autoexec.executeTrigger(member.guild.id, "leave", {
    guild: member.guild,
    user: member.user,
    username: member.user.username,
    userId: member.id,
  }).catch(err => console.error("autoexec leave:", err.message));
});
client.on("messageDelete", message => {
  try {
    rememberDeletedMessage(message);
  } catch (err) {
    console.error("[safe] rememberDeletedMessage:", err.message);
  }
  greet.onMessageDelete(message).catch(err => console.error("[safe] greet.onMessageDelete:", err.message));
});
client.on("messageUpdate",     (oldMsg, newMsg) => greet.onMessageUpdate(oldMsg, newMsg).catch(err => console.error("[safe] greet.onMessageUpdate:", err.message)));

// Live role tracker and nickname lock
client.on("guildMemberUpdate", (oldMember, newMember) => {
  try {
    roletracker.handleRoleUpdate(oldMember, newMember);
  } catch (err) {
    console.error("[roletracker] guildMemberUpdate error:", err.message);
  }
  try {
    femboyify.handleNicknameUpdate(oldMember, newMember);
  } catch (err) {
    console.error("[femboyify] guildMemberUpdate error:", err.message);
  }
});

client.once("ready", async () => {
  ctx.client = client;
  wireHelpContext(ctx);
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity(`${settings.get("prefix")}help | mambo`, { type: 3 });

  // Register slash commands globally
  try {
    const rest = new REST().setToken(process.env.BOT_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashDefs.map(s => s.toJSON()) });
    console.log(`Registered ${slashDefs.length} slash commands globally.`);
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }

  // Start the public HTTP API that the (separately hosted) dashboard talks to.
  try {
    require("./src/api/server").startApi(ctx);
  } catch (err) {
    console.error("Failed to start bot API:", err);
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} received — shutting down gracefully...`);
  try {
    // Stop timers
    const automod = require("./src/automod");
    automod.stopSpamCleanup();
    // Destroy all voice sessions
    if (voiceManager) voiceManager.destroy();
    try {
      const mod = require("./src/commands/mod");
      if (typeof mod.stopProbationCleanup === "function") mod.stopProbationCleanup();
    } catch { /* best-effort */ }
    // Clear all schedule timers
    try {
      const sched = require("./src/scheduler");
      if (typeof sched.reload === "function") {
        // reload() clears timers and resets; we're shutting down so just need clear
        // (no-op — timers are unref'd, so they won't block shutdown)
      }
    } catch { /* best-effort */ }
  } catch { /* best-effort */ }
  try {
    // Destroy Discord client
    await client.destroy();
    console.log("[shutdown] Discord client destroyed.");
  } catch (err) { console.error("[shutdown] Error destroying client:", err.message); }
  try {
    // Close SQLite
    const db = require("./src/db");
    db.close();
    console.log("[shutdown] SQLite connection closed.");
  } catch (err) { console.error("[shutdown] Error closing DB:", err.message); }
  console.log("[shutdown] Goodbye.");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Bootstrap initialization
(async () => {
  try {
    await db.init();
    await Promise.all([
      settings.load(),
      data.load(),
      config.load(),
      automod.load(),
      greet.load(),
      roles.load(),
      dangerzone.load(),
      antiraid.load(),
      theme.load(),
      aiMemory.load(),
      autoexec.load(),
      roletracker.load(),
      femboyify.load(),
    ]);
    // Load scheduled messages after settings are ready
    await scheduler.load(client).catch(err => console.error("[scheduler] Load error:", err.message));
    // Initialize VoiceManager after client is ready
    voiceManager = new VoiceManager(client);
    console.log("[voice] VoiceManager initialized");
    // Give antiraid the live client so it can lock/unlock channels and look
    // up guilds from guildMemberAdd / the periodic unlock sweep.
    antiraid.setClient(client);
    settings.hydrateAiKeysFromEnv();
    // Start probation cleanup timer
    try {
      const mod = require("./src/commands/mod");
      if (typeof mod.setClient === "function") mod.setClient(client);
      if (typeof mod.startProbationCleanup === "function") mod.startProbationCleanup();
      console.log("[probation] cleanup timer started");
    } catch (err) {
      console.error("[probation] failed to start cleanup:", err.message);
    }
  } catch (err) {
    console.error("Fatal: failed to initialize data layer:", err);
    process.exit(1);
  }
  client.login(process.env.BOT_TOKEN);
})();
