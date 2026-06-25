const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, REST, Routes } = require("discord.js");
const safe = require("../safe");
const utils = require("../utils");
const { MAX_PURGE, isAuthorized, noPermEmbed, errorEmbed, successEmbed } = utils;

// ─── Help
async function prefixHelp(message, args, ctx) {
  const dynamicSection = ctx.commandMap.size > 0
    ? [...ctx.commandMap.entries()]
        .filter(([, v]) => v._dynamic)
        .map(([name]) => `\`$${name}\``)
        .join(", ") || null
    : null;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 Bot Commands")
    .setDescription("Here are the available commands:")
    .addFields(
      { name: "🛠️ Utility",      value: "`$help`, `$ping`, `$purge <amount>`, `$sticky <set/remove>`, `$reactionlog <set/remove>`, `$afk [reason]`, `$reregister`" },
      { name: "ℹ️ Info",          value: "`$userinfo`, `$serverinfo`, `$roleinfo`, `$whohas <permission>`, `$avatar`, `$membercount`, `$botinfo`, `$listroles <@role> [@role...]`" },
      { name: "🎉 Fun",          value: "`$8ball`, `$coinflip`, `$roll`, `$rps`, `$choose`, `$ship`, `$meme`, `$joke`, `$dadjoke`, `$cat`, `$dog`, `$reverse`, `$mock`, `$pp`, `$iq`, `$howgay`" },
      { name: "🔍 Scrape",       value: ["`$scrapemessage <amount> <text>`", "Searches the last `<amount>` messages **across every channel** in the server (max 5,000 per channel).", "Lists every user who said `<text>` as a standalone word with a direct jump link.", "Example: `$scrapemessage 500 nig`"].join("\n") },
      { name: "🎨 Custom Roles", value: ['`$customrole create @user "Name" normal #FF0000`', '`$customrole create @user "Name" gradient #FF0000 #0000FF`', '`$customrole create @user "Name" holographic`', "`$customrole remove [@user]` — removes a custom role", "`$customrole list` — lists all custom roles (Admin only)"].join("\n") },
      { name: "🎭 Fake Mod",     value: "`$warn`, `$kick`, `$ban`, `$mute`, `$timeout`, `$softban`, `$tempban`, `$lock`, `$slowmode`" },
      { name: "🛡️ Real Mod",     value: "`$realwarn`, `$realkick`, `$realban`, `$realmute`, `$reallock`, `$realslowmode`, `$syncperms`" },
      { name: "🧩 Modules",      value: "`$modules create <name>`, `$modules delete <name>`, `$modules list`, `$modules reload <name>`" },
      { name: "⚙️ Config",        value: "`$config <command> [enable/disable/perm/cooldown/allow/block/reset]` — customize any command" },
      { name: "🪄 Roles",        value: "`$autorole add/remove <@role>`, `$reactionrole add <msgId> <emoji> <@role>`" },
    )
    .setFooter({ text: `Prefix: ${utils.PREFIX}` });

  if (dynamicSection) embed.addFields({ name: "📦 Dynamic Commands", value: dynamicSection });

  await message.reply({ embeds: [embed] });
}

async function slashHelp(interaction, ctx) {
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📖 Bot Commands").setDescription("Use `$help` in chat for the full command list.")] });
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
    return interaction.reply({ embeds: [errorEmbed("I need the `Manage Messages` permission.")], ephemeral: true });
  const amount = interaction.options.getInteger("amount");
  await interaction.deferReply({ ephemeral: true });
  try {
    const deleted = await interaction.channel.bulkDelete(amount, true);
    await interaction.editReply({ embeds: [successEmbed(`Deleted ${deleted.size} messages.`)] });
  } catch (err) {
    await interaction.editReply({ embeds: [errorEmbed(`Failed: ${err.message}`)] });
  }
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
  await interaction.reply({ content: `👋 ${interaction.user} I set your AFK: **${reason}**`, ephemeral: false });
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
    if (!logChannel) return message.reply({ embeds: [errorEmbed("Usage: $reactionlog set #channel")] });
    data.reactionlogs[message.guild.id] = { channelId: logChannel.id }; data.saveReactionlogs();
    await message.reply({ embeds: [successEmbed(`Reaction log set to ${logChannel}`)] });
  } else if (sub === "remove" || sub === "clear") {
    delete data.reactionlogs[message.guild.id]; data.saveReactionlogs();
    await message.reply({ embeds: [successEmbed("Reaction log removed.")] });
  } else {
    await message.reply({ embeds: [errorEmbed("Usage: `$reactionlog set #channel` or `$reactionlog remove`")] });
  }
}

async function slashReactionLog(interaction, ctx) {
  const { data } = ctx;
  const sub     = interaction.options.getString("action");
  const channel = interaction.options.getChannel("channel");
  if (sub === "set") {
    if (!channel) return interaction.reply({ embeds: [errorEmbed("Provide a channel.")], ephemeral: true });
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
    slash: new SlashCommandBuilder().setName("help").setDescription("Show bot commands"),
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

module.exports.handleAfkChecks = handleAfkChecks;
