const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const roles = require("../roles");

const safe = require("../safe");

const BLURPLE = 0x5865f2;

// Parse an emoji argument into a key usable for lookup: custom -> id, unicode -> char.
function parseEmojiArg(arg) {
  if (!arg) return null;
  const custom = arg.match(/^<a?:\w+:(\d+)>$/);
  if (custom) return { key: custom[1], raw: arg };
  return { key: arg, raw: arg }; // unicode emoji
}

async function resolveMessage(channel, messageId) {
  return safe.orNull(channel.messages.fetch(messageId), `reaction role fetch msg ${messageId}`);
}

async function handleReactionRole(message, args, ctx) {
  const sub = args[0]?.toLowerCase();

  if (sub === "list") {
    const map = roles.getReactionRoles(message.guild.id);
    const ids = Object.keys(map);
    if (!ids.length) return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("No reaction roles set up.")] });
    const lines = ids.map(mid => {
      const pairs = Object.entries(map[mid]).map(([k, rid]) => `${/^\d+$/.test(k) ? `<:e:${k}>` : k} → <@&${rid}>`).join(", ");
      return `**Message \`${mid}\`:** ${pairs}`;
    });
    return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🎭 Reaction Roles").setDescription(lines.join("\n").slice(0, 4000))], allowedMentions: { parse: [] } });
  }

  if (sub === "add") {
    // $reactionrole add <messageId> <emoji> <@role|roleId>
    const messageId = args[1];
    const emoji = parseEmojiArg(args[2]);
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[3]);
    if (!messageId || !emoji || !role)
      return message.reply({ embeds: [errorEmbed("Usage: `$reactionrole add <messageId> <emoji> <@role>`")] });

    const target = await resolveMessage(message.channel, messageId);
    if (!target) return message.reply({ embeds: [errorEmbed("Message not found in this channel. Run the command in the same channel as the target message.")] });
    if (role.position >= message.guild.members.me.roles.highest.position)
      return message.reply({ embeds: [errorEmbed("That role is higher than my highest role — I can't assign it.")] });

    await safe.react(target, emoji.raw, "prefix reaction role add");
    roles.addReactionRole(message.guild.id, messageId, emoji.key, role.id);
    return message.reply({ embeds: [successEmbed(`Bound ${emoji.raw} → ${role} on message \`${messageId}\`.`)], allowedMentions: { parse: [] } });
  }

  if (sub === "remove") {
    const messageId = args[1];
    const emoji = parseEmojiArg(args[2]);
    if (!messageId || !emoji) return message.reply({ embeds: [errorEmbed("Usage: `$reactionrole remove <messageId> <emoji>`")] });
    const ok = roles.removeReactionRole(message.guild.id, messageId, emoji.key);
    return message.reply({ embeds: ok ? [successEmbed("Reaction role removed.")] : [errorEmbed("No such reaction role binding.")] });
  }

  return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🎭 Reaction Roles").setDescription([
    "`$reactionrole add <messageId> <emoji> <@role>` — bind an emoji to a role",
    "`$reactionrole remove <messageId> <emoji>` — remove a binding",
    "`$reactionrole list` — list all bindings",
    "",
    "Tip: enable Developer Mode to copy a message ID, and run the command in the same channel as that message.",
  ].join("\n"))] });
}

module.exports = [
  {
    name: "reactionrole",
    description: "Manage reaction roles",
    defaultPermission: "admin",
    prefix: handleReactionRole,
    slash: new SlashCommandBuilder()
      .setName("reactionrole")
      .setDescription("Manage reaction roles (admin only)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(s => s.setName("add").setDescription("Bind an emoji to a role")
        .addStringOption(o => o.setName("message_id").setDescription("Target message ID (same channel)").setRequired(true))
        .addStringOption(o => o.setName("emoji").setDescription("Emoji").setRequired(true))
        .addRoleOption(o => o.setName("role").setDescription("Role to grant").setRequired(true)))
      .addSubcommand(s => s.setName("remove").setDescription("Remove a binding")
        .addStringOption(o => o.setName("message_id").setDescription("Target message ID").setRequired(true))
        .addStringOption(o => o.setName("emoji").setDescription("Emoji").setRequired(true)))
      .addSubcommand(s => s.setName("list").setDescription("List bindings")),
    execute: async (interaction, ctx) => {
      const sub = interaction.options.getSubcommand();
      if (sub === "list") {
        const map = roles.getReactionRoles(interaction.guild.id);
        const ids = Object.keys(map);
        if (!ids.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("No reaction roles set up.")], ephemeral: true });
        const lines = ids.map(mid => `**\`${mid}\`:** ` + Object.entries(map[mid]).map(([k, rid]) => `${/^\d+$/.test(k) ? `<:e:${k}>` : k} → <@&${rid}>`).join(", "));
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🎭 Reaction Roles").setDescription(lines.join("\n").slice(0, 4000))], ephemeral: true, allowedMentions: { parse: [] } });
      }
      const messageId = interaction.options.getString("message_id");
      const emoji = parseEmojiArg(interaction.options.getString("emoji"));
      if (!emoji) return interaction.reply({ embeds: [errorEmbed("Invalid emoji.")], ephemeral: true });
      if (sub === "remove") {
        const ok = roles.removeReactionRole(interaction.guild.id, messageId, emoji.key);
        return interaction.reply({ embeds: ok ? [successEmbed("Reaction role removed.")] : [errorEmbed("No such binding.")], ephemeral: true });
      }
      // add
      const role = interaction.options.getRole("role");
      const target = await safe.orNull(interaction.channel.messages.fetch(messageId), `slash reaction role fetch msg ${messageId}`);
      if (!target) return interaction.reply({ embeds: [errorEmbed("Message not found in this channel.")], ephemeral: true });
      if (role.position >= interaction.guild.members.me.roles.highest.position)
        return interaction.reply({ embeds: [errorEmbed("That role is higher than my highest role.")], ephemeral: true });
      await safe.react(target, emoji.raw, "slash reaction role add reaction");
      roles.addReactionRole(interaction.guild.id, messageId, emoji.key, role.id);
      return interaction.reply({ embeds: [successEmbed(`Bound ${emoji.raw} → ${role}.`)], ephemeral: true, allowedMentions: { parse: [] } });
    },
  },
];
