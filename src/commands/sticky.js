const { EmbedBuilder, SlashCommandBuilder, MessageFlags } = require("discord.js");
const safe = require("../safe");
const { isAuthorized, noPermEmbed, errorEmbed, successEmbed } = require("../utils");

function stickyEmbed(text, pinnedBy) {
  return new EmbedBuilder().setColor(0xfee75c).setTitle("📌 Sticky").setDescription(text).setFooter({ text: `Pinned by ${pinnedBy}` });
}

async function repostSticky(channel, data) {
  const entry = data.stickies[channel.id]; if (!entry) return;
  if (entry.messageId) {
    const old = await safe.orNull(channel.messages.fetch(entry.messageId), "sticky: fetch old");
    if (old) await safe.delete(old, "sticky: delete old");
  }
  const msg = await channel.send({ embeds: [stickyEmbed(entry.text, entry.pinnedBy)] });
  entry.messageId = msg.id;
  data.saveStickies();
}

const stickyDebounce = new Map();

function clearStickyDebounce(channelId) {
  if (stickyDebounce.has(channelId)) {
    clearTimeout(stickyDebounce.get(channelId));
    stickyDebounce.delete(channelId);
  }
}

async function handleStickyRepost(channel, data) {
  if (!data.stickies[channel.id]) return;
  clearStickyDebounce(channel.id);
  stickyDebounce.set(channel.id, setTimeout(async () => {
    stickyDebounce.delete(channel.id);
    await repostSticky(channel, data).catch(console.error);
  }, 1500));
}

async function prefixSticky(message, args, ctx) {
  const { data } = ctx;
  const sub = args[0]?.toLowerCase();
  if (sub === "set") {
    const text = args.slice(1).join(" ");
    if (!text) return message.reply({ embeds: [errorEmbed("Usage: $sticky set <text>")] });
    data.stickies[message.channel.id] = { text, pinnedBy: message.author.tag, messageId: null };
    await repostSticky(message.channel, data);
    await message.reply({ embeds: [successEmbed("Sticky set.")] });
  } else if (sub === "remove" || sub === "clear") {
    clearStickyDebounce(message.channel.id);
    const entry = data.stickies[message.channel.id];
    if (entry?.messageId) {
      const old = await safe.orNull(message.channel.messages.fetch(entry.messageId), "sticky: fetch old to remove");
      if (old) await safe.delete(old, "sticky: delete old on remove");
    }
    delete data.stickies[message.channel.id];
    data.saveStickies();
    await message.reply({ embeds: [successEmbed("Sticky removed.")] });
  } else {
    await message.reply({ embeds: [errorEmbed("Usage: `$sticky set <text>` or `$sticky remove`")] });
  }
}

async function slashSticky(interaction, ctx) {
  const { data } = ctx;
  const sub  = interaction.options.getString("action");
  const text = interaction.options.getString("text");
  if (sub === "set") {
    if (!text) return interaction.reply({ embeds: [errorEmbed("Provide text for the sticky.")], flags: MessageFlags.Ephemeral });
    data.stickies[interaction.channel.id] = { text, pinnedBy: interaction.user.tag, messageId: null };
    await repostSticky(interaction.channel, data);
    await interaction.reply({ embeds: [successEmbed("Sticky set.")], flags: MessageFlags.Ephemeral });
  } else {
    clearStickyDebounce(interaction.channel.id);
    const entry = data.stickies[interaction.channel.id];
    if (entry?.messageId) {
      const old = await safe.orNull(interaction.channel.messages.fetch(entry.messageId), "sticky: fetch old slash");
      if (old) await safe.delete(old, "sticky: delete old slash");
    }
    delete data.stickies[interaction.channel.id];
    data.saveStickies();
    await interaction.reply({ embeds: [successEmbed("Sticky removed.")], flags: MessageFlags.Ephemeral });
  }
}

module.exports = [
  {
    name: "sticky",
    description: "Set or remove a sticky message",
    defaultPermission: "mod",
    prefix: prefixSticky,
    slash: new SlashCommandBuilder()
      .setName("sticky")
      .setDescription("Set or remove a sticky message in this channel")
      .addStringOption(o => o.setName("action").setDescription("set or remove").setRequired(true).addChoices({ name: "set", value: "set" }, { name: "remove", value: "remove" }))
      .addStringOption(o => o.setName("text").setDescription("Sticky message text").setRequired(false)),
    execute: slashSticky,
  },
];

module.exports.handleStickyRepost = handleStickyRepost;
