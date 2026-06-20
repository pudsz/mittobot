const { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder } = require("discord.js");
const fs   = require("fs");
const path = require("path");
require("dotenv").config();

const data     = require("./src/data");
const utils    = require("./src/utils");
const settings = require("./src/settings");
const features = require("./src/features");
const config   = require("./src/config");
const automod  = require("./src/automod");
const greet    = require("./src/greet");
const roles    = require("./src/roles");
const { loadModule, MODULES_DIR, ensureModulesDir } = require("./src/commands/modules");

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
  "./src/commands/info",
  "./src/commands/config",
  "./src/commands/reactionrole",
  "./src/commands/autorole",
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
const ctx = { client: null, data, utils, commandMap, slashMap, config, features, automod, greet, roles };

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
  if (!message.guild || message.author.bot) return;

  // Automod runs first; if it removed the message, stop processing.
  try {
    if (await automod.checkMessage(message)) return;
  } catch (err) { console.error("Automod error:", err.message); }

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
        message.reply({ embeds: [utils.errorEmbed(denyMessage(access.reason, access.remain))] }).catch(() => null);
      }
      return;
    }
    try {
      await handler.prefix(message, args, ctx);
    } catch (err) {
      console.error(`Error executing command ${command}:`, err);
      message.reply({ embeds: [utils.errorEmbed("An unexpected error occurred.")] }).catch(() => null);
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
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const execute = slashMap.get(interaction.commandName);
      if (!execute) return;
      const def = commandMap.get(interaction.commandName);
      const access = checkAccess(def, interaction.commandName, {
        member: interaction.member, userId: interaction.user.id, channelId: interaction.channelId,
      });
      if (!access.ok) {
        return interaction.reply({
          embeds: [utils.errorEmbed(denyMessage(access.reason, access.remain))],
          ephemeral: true,
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
  if (reaction.partial) { if (!await reaction.fetch().catch(() => null)) return; }
  let msg = reaction.message;
  if (msg.partial) { msg = await msg.fetch().catch(() => null); if (!msg) return; }

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

  ch.send({ embeds: [embed] }).catch(() => null);
}

client.on("messageReactionAdd", (reaction, user) => {
  logReaction(reaction, user, true);
  roles.onReaction(reaction, user, true).catch(() => null);
});
client.on("messageReactionRemove", (reaction, user) => {
  logReaction(reaction, user, false);
  roles.onReaction(reaction, user, false).catch(() => null);
});

// ─── Welcome / leave / audit logs / autorole
client.on("guildMemberAdd",    member => {
  greet.onMemberAdd(member).catch(err => console.error("greet add:", err.message));
  roles.onMemberAdd(member).catch(err => console.error("autorole:", err.message));
});
client.on("guildMemberRemove", member => greet.onMemberRemove(member).catch(err => console.error("greet remove:", err.message)));
client.on("messageDelete",     message => greet.onMessageDelete(message).catch(() => null));
client.on("messageUpdate",     (oldMsg, newMsg) => greet.onMessageUpdate(oldMsg, newMsg).catch(() => null));

client.once("ready", async () => {
  settings.load();
  settings.hydrateAiKeysFromEnv();
  data.load();
  config.load();
  automod.load();
  greet.load();
  roles.load();
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

  // Start the web dashboard (non-fatal if it fails)
  try {
    require("./src/dashboard/server").startDashboard(ctx);
  } catch (err) {
    console.error("Failed to start dashboard:", err);
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

client.login(process.env.BOT_TOKEN);
