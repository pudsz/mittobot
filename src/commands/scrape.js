const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { isAuthorized, noPermEmbed, errorEmbed } = require("../utils");

// Builds a word-boundary regex for the search term.
// Single words get strict non-alphanumeric boundaries; multi-word phrases do a plain substring match.
function buildSearchRegex(text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!/\s/.test(text)) return new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, "i");
  return new RegExp(escaped, "i");
}

async function runScrape(message, reply, editReply, channel, guild, authorUsername, perChannelLimit, displayText) {
  const MAX_ALLOWED  = 5000;
  const limit        = Math.min(perChannelLimit, MAX_ALLOWED);
  const searchRegex  = buildSearchRegex(displayText);

  const channels = guild.channels.cache.filter(ch => {
    if (ch.type !== 0) return false;
    const perms = ch.permissionsFor(guild.members.me);
    return perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.ReadMessageHistory);
  });

  if (channels.size === 0) return editReply({ embeds: [errorEmbed("I can't read any text channels in this server.")] });

  const foundUsers = new Map();
  let totalScanned = 0, channelsDone = 0;

  for (const [, ch] of channels) {
    let lastId = null, channelCount = 0;
    try {
      while (channelCount < limit) {
        const fetchLimit = Math.min(100, limit - channelCount);
        const options    = { limit: fetchLimit };
        if (lastId) options.before = lastId;
        const fetched = await ch.messages.fetch(options).catch(() => null);
        if (!fetched || fetched.size === 0) break;
        fetched.forEach(msg => {
          if (!msg.author || msg.author.bot || msg.system || !msg.content) return;
          if (searchRegex.test(msg.content)) {
            if (!foundUsers.has(msg.author.id)) {
              foundUsers.set(msg.author.id, { displayName: msg.member?.displayName || msg.author.globalName || msg.author.username, messageUrl: msg.url, count: 1, channelId: ch.id });
            } else { foundUsers.get(msg.author.id).count++; }
          }
        });
        lastId        = fetched.last().id;
        channelCount += fetched.size;
        totalScanned += fetched.size;
        if (fetched.size === 100) await new Promise(r => setTimeout(r, 1200));
      }
    } catch (err) { console.error(`Failed scanning #${ch.name}:`, err.message); }

    channelsDone++;
    if (channelsDone % 5 === 0 || channelsDone === channels.size) {
      await editReply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🔍 Scraping Server...").setDescription(`Searching for: \`${displayText}\`\n\n**Channels:** ${channelsDone} / ${channels.size} done\n**Messages scanned:** ${totalScanned.toLocaleString()}\n**Unique users found so far:** ${foundUsers.size}`)] }).catch(() => null);
    }
  }

  if (foundUsers.size === 0) {
    return editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("📜 No Results Found").setDescription(`Nobody was found saying \`${displayText}\` as a standalone word across **${channels.size}** channels (${totalScanned.toLocaleString()} messages scanned).`).setFooter({ text: `Requested by ${authorUsername}` })] }).catch(() => null);
  }

  const lines = Array.from(foundUsers.entries()).map(([id, data], index) =>
    `**${index + 1}.** ${data.displayName} (<@${id}>) — ${data.count === 1 ? "1x" : `${data.count}x`} | [jump ↗](${data.messageUrl}) in <#${data.channelId}>`
  );

  const EMBED_LIMIT = 3900;
  const headerText  = `Found **${foundUsers.size}** unique user(s) who said \`${displayText}\` across **${channels.size}** channels (${totalScanned.toLocaleString()} messages scanned):\n\n`;
  const embeds = [];
  let currentChunk = headerText, isFirstEmbed = true;

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > EMBED_LIMIT) {
      const e = new EmbedBuilder().setColor(0x00c776).setDescription(currentChunk);
      if (isFirstEmbed) { e.setTitle(`📜 Scrape Results — "${displayText}"`); isFirstEmbed = false; }
      embeds.push(e);
      currentChunk = line + "\n";
    } else { currentChunk += line + "\n"; }
  }
  if (currentChunk.trim()) {
    const e = new EmbedBuilder().setColor(0x00c776).setDescription(currentChunk);
    if (isFirstEmbed) e.setTitle(`📜 Scrape Results — "${displayText}"`);
    e.setFooter({ text: `Requested by ${authorUsername}` });
    embeds.push(e);
  } else { embeds[embeds.length - 1].setFooter({ text: `Requested by ${authorUsername}` }); }

  const BATCH = 10;
  let first = true;
  for (let i = 0; i < embeds.length; i += BATCH) {
    const batch = embeds.slice(i, i + BATCH);
    if (first) { await editReply({ embeds: batch }).catch(() => null); first = false; }
    else        { await channel.send({ embeds: batch }).catch(() => null); }
  }
}

async function prefixScrapeMessage(message, args, ctx) {
  const countArg = parseInt(args[0], 10);
  if (isNaN(countArg) || countArg < 1) return message.reply({ embeds: [errorEmbed("Usage: `$scrapemessage <amount> <text>`\nExample: `$scrapemessage 500 nig`\nMax per channel: **5,000**")] });
  const displayText = args.slice(1).join(" ");
  if (!displayText) return message.reply({ embeds: [errorEmbed("Provide the text to search for.\nUsage: `$scrapemessage <amount> <text>`")] });

  const searchMsg = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🔍 Scraping Server...").setDescription(`Searching the last **${Math.min(countArg, 5000).toLocaleString()}** messages in each channel for: \`${displayText}\`\n\n*This may take a while. Do not run the command again.*`)] });
  await runScrape(message, searchMsg, (opts) => searchMsg.edit(opts), message.channel, message.guild, message.author.username, countArg, displayText);
}

async function slashScrapeMessage(interaction, ctx) {
  const countArg   = interaction.options.getInteger("amount");
  const displayText = interaction.options.getString("text");
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("🔍 Scraping Server...").setDescription(`Searching the last **${Math.min(countArg, 5000).toLocaleString()}** messages in each channel for: \`${displayText}\`\n\n*This may take a while.*`)] });
  await runScrape(null, null, (opts) => interaction.editReply(opts), interaction.channel, interaction.guild, interaction.user.username, countArg, displayText);
}

module.exports = [
  {
    name: "scrapemessage",
    description: "Search message history across all channels",
    defaultPermission: "mod",
    prefix: prefixScrapeMessage,
    slash: new SlashCommandBuilder()
      .setName("scrapemessage")
      .setDescription("Search message history across all channels")
      .addIntegerOption(o => o.setName("amount").setDescription("Max messages per channel (1-5000)").setRequired(true).setMinValue(1).setMaxValue(5000))
      .addStringOption(o => o.setName("text").setDescription("Text to search for").setRequired(true)),
    execute: slashScrapeMessage,
  },
];
