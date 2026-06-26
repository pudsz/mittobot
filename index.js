const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, MessageFlags } = require("discord.js");
const fs   = require("fs");
const path = require("path");
require("dotenv").config();

const db       = require("./src/db");
const data     = require("./src/data");
const utils    = require("./src/utils");
const settings = require("./src/settings");
const features = require("./src/features");
const config   = require("./src/config");
const automod     = require("./src/automod");
const greet       = require("./src/greet");
const roles       = require("./src/roles");
const dangerzone  = require("./src/dangerzone");
const { loadModule, MODULES_DIR, ensureModulesDir } = require("./src/commands/modules");
const aiMemory    = require("./src/ai/memory");
const autoexec    = require("./src/autoexec");
const safe        = require("./src/safe");
const roletracker = require("./src/roletracker");
const femboyify   = require("./src/femboyify");
const scheduler   = require("./src/scheduler");

// ─── Command loading
// commandMap: name -> { prefix, execute, _dynamic? }
// slashMap:   name -> execute fn
const commandMap = new Map();
const slashMap   = new Map();
const slashDefs  = [];

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
];
for (const file of COMMAND_FILES) {
  const defs = require(file);
  registerCommands(Array.isArray(defs) ? defs : [defs]);
}

// Load dynamic modules from modules/
ensureModulesDir();
const moduleFiles = fs.existsSync(MODULES_DIR)
  ? fs.readdirSync(MODULES_DIR).filter(f => f.endsWith(".js"))
  : [];
for (const file of moduleFiles) {
  const name = file.replace(".js", "");
  try { loadModule(name, commandMap); } catch (err) { console.error(`Failed to load module ${name}:`, err.message); }
}

// ─── ctx passed to every handler
const ctx = { client: null, data, utils, commandMap, slashMap, slashDefs, config, features, automod, greet, roles, dangerzone, autoexec, roletracker, femboyify };

// ─── Central access control: category toggle + per-command config.
// Returns { ok } or { ok:false, reason, remain?, cfg }.
function checkAccess(def, command, { member, userId, channelId }) {
  if (!def) return { ok: false, reason: "unknown" };
  // Category master switch first (cheap, guild-independent).
  if (def.category && !features.isEnabled(def.category)) return { ok: false, reason: "category" };
  return config.evaluate({
    guildId: member?.guild?.id ?? null,
    command, def, member, userId, channelId, now: Date.now(),
  });
}

function denyMessage(reason, remain) {
  switch (reason) {
    case "disabled": return "That command is disabled here.";
    case "category": return "That command category is currently disabled.";
    case "channel":  return "That command can't be used in this channel.";
    case "permission": return settings.get("noPermMsg");
    case "cooldown": return `⏳ Slow down — try again in **${remain}s**.`;
    default:         return "You can't use that command right now.";
  }
}

// ─── Helpers pulled from utility module (event-level handlers)
const { handleAfkChecks }   = require("./src/commands/utility");
const { handleStickyRepost } = require("./src/commands/sticky");
const { handleSettingsButton, handleSettingsModal } = require("./src/commands/settings");
const { handleAiMessage } = require("./src/ai");

// ─── Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
ctx.client = client;

// ─── Events
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
        message,
        content: message.content,
        channel: message.channel,
      });
    } catch (err) { console.error("Autoexec message error:", err.message); }
  }

  // Maintenance mode — block everything for non-owners
  const mm = settings.get("maintenanceMode");
  if (mm && !utils.isOwner(message.author.id)) {
    // Notify the user if they obviously tried to interact (prefix / ping),
    // but stay silent otherwise to avoid spamming casual chat channels.
    if (message.content.startsWith(utils.PREFIX) || message.mentions.has(client.user.id)) {
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

  if (!message.content.startsWith(utils.PREFIX)) return;

  const [cmd, ...args] = message.content.slice(utils.PREFIX.length).trim().split(/\s+/);
  const command = cmd.toLowerCase();
  const handler = commandMap.get(command);

  if (handler?.prefix) {
    const access = checkAccess(handler, command, {
      member: message.member, userId: message.author.id, channelId: message.channel.id,
    });
    if (!access.ok) {
      // Stay quiet for disabled/category/unknown to avoid spam; tell the user for perm/channel/cooldown.
      if (access.reason === "permission" || access.reason === "channel" || access.reason === "cooldown") {
        safe.reply(message, { embeds: [utils.errorEmbed(denyMessage(access.reason, access.remain))] }, "access denied message");
      }
      return;
    }
    try {
      await handler.prefix(message, args, ctx);
    } catch (err) {
      console.error(`Error executing command ${command}:`, err);
      safe.reply(message, { embeds: [utils.errorEmbed("An unexpected error occurred.")] }, "command error");
    }
  }
});

client.on("interactionCreate", async interaction => {
  try {
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
    // Slash commands
    if (interaction.isChatInputCommand()) {
      // Maintenance mode — block slash commands for non-owners
      const mm = settings.get("maintenanceMode");
      if (mm && !utils.isOwner(interaction.user.id)) {
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
          embeds: [utils.errorEmbed(denyMessage(access.reason, access.remain))],
          flags: MessageFlags.Ephemeral,
        });
      }
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
    const reply = { embeds: [utils.errorEmbed("An unexpected error occurred.")], flags: 64 }; // 64 = Ephemeral
    try {
      interaction.replied || interaction.deferred
        ? await interaction.followUp(reply)
        : await interaction.reply(reply);
    } catch {}
  }
});

// ─── Advanced reaction logger: handles unicode, custom, animated & external emojis
async function logReaction(reaction, user, added) {
  if (user.bot) return;

  // Hydrate partials so we always have full emoji/message/author data.
  if (reaction.partial) { if (!await safe.orNull(reaction.fetch(), "fetch partial reaction")) return; }
  let msg = reaction.message;
  if (msg.partial) { msg = await safe.orNull(msg.fetch(), "fetch partial message for reaction log"); if (!msg) return; }

  const guild = msg.guild; if (!guild) return;
  const entry = data.reactionlogs[guild.id]; if (!entry) return;
  const ch = guild.channels.cache.get(entry.channelId); if (!ch) return;

  const emoji = reaction.emoji;
  const isCustom = Boolean(emoji.id);
  const isExternal = isCustom && !guild.emojis.cache.has(emoji.id);
  // Custom emoji render as <:name:id> / <a:name:id> in embeds even when external.
  const display = isCustom
    ? `<${emoji.animated ? "a" : ""}:${emoji.name || "_"}:${emoji.id}>`
    : emoji.name;
  const imageUrl = isCustom
    ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=96&quality=lossless`
    : null;

  // Compact emoji identity line for custom emojis.
  let emojiInfo = isCustom
    ? `\`:${emoji.name || "unknown"}:\` • ID \`${emoji.id}\`${emoji.animated ? " • animated" : ""}${isExternal ? " • **external**" : ""}`
    : `\`${emoji.name}\``;

  const author = msg.author;
  const snippet = msg.content
    ? (msg.content.length > 120 ? msg.content.slice(0, 117) + "…" : msg.content)
    : (msg.attachments?.size ? "*[attachment]*" : "*[no text content]*");

  const embed = new EmbedBuilder()
    .setColor(added ? 0x57f287 : 0xed4245)
    .setAuthor({ name: `${user.tag} (${user.id})`, iconURL: user.displayAvatarURL?.() })
    .setTitle(added ? "✅ Reaction Added" : "❌ Reaction Removed")
    .setDescription(
      `${display} ${added ? "added by" : "removed by"} <@${user.id}> on [a message](${msg.url}) in <#${msg.channel.id}>`
    )
    .addFields(
      { name: "Emoji", value: emojiInfo, inline: false },
      { name: "Message Author", value: author ? `${author.tag} (<@${author.id}>)` : "Unknown", inline: true },
      { name: "Total Now", value: `${reaction.count ?? "?"}`, inline: true },
      { name: "Content", value: snippet, inline: false },
    )
    .setFooter({ text: `#${msg.channel.name} • msg ${msg.id}` })
    .setTimestamp();

  if (imageUrl) embed.setThumbnail(imageUrl);

  safe.send(ch, { embeds: [embed] }, "reaction log");
}

client.on("messageReactionAdd", async (reaction, user) => {
  logReaction(reaction, user, true);
  roles.onReaction(reaction, user, true).catch(err => console.error("[safe] reaction role add:", err.message));
  // Auto-exec: hydrate partials first so emoji data is complete
  if (reaction.message?.guild) {
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
    autoexec.executeTrigger(reaction.message.guild.id, "reaction_added", {
      guild: reaction.message.guild,
      user,
      member: reaction.message.guild.members.cache.get(user.id) ?? await reaction.message.guild.members.fetch(user.id).catch(() => null),
      message: reaction.message,
      channel: reaction.message.channel,
      content: reaction.message.content || "",
      emoji: reaction.emoji,
    }).catch(err => console.error("autoexec reaction_added:", err.message));
  }
});
client.on("messageReactionRemove", (reaction, user) => {
  logReaction(reaction, user, false);
  roles.onReaction(reaction, user, false).catch(err => console.error("[safe] reaction role remove:", err.message));
});

// ─── Welcome / leave / audit logs / autorole
client.on("guildMemberAdd",    member => {
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
client.on("messageDelete",     message => greet.onMessageDelete(message).catch(err => console.error("[safe] greet.onMessageDelete:", err.message)));
client.on("messageUpdate",     (oldMsg, newMsg) => greet.onMessageUpdate(oldMsg, newMsg).catch(err => console.error("[safe] greet.onMessageUpdate:", err.message)));

// ─── Live role tracker — auto-edits tracked role-list messages on role changes
// ─── Femboyify nickname lock — reverts manual nickname changes
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

client.once("clientReady", async () => {
  ctx.client = client;
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

// ─── Graceful shutdown ────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} received — shutting down gracefully...`);
  try {
    // Stop timers
    const automod = require("./src/automod");
    automod.stopSpamCleanup();
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

// ─── Bootstrap: initialize SQLite + hydrate all in-memory caches BEFORE
// connecting to Discord, so the first event is never served against empty state.
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
      aiMemory.load(),
      autoexec.load(),
      roletracker.load(),
      femboyify.load(),
    ]);
    // Load scheduled messages after settings are ready
    await scheduler.load(client).catch(err => console.error("[scheduler] Load error:", err.message));
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
