const {
  EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const roles = require("../roles");
const ui = require("../ui");

const safe = require("../safe");

const BLURPLE = 0x5865f2;

function usage(ctx, text) {
  return `\`${ctx?.utils?.PREFIX || "$"}${text}\``;
}

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

// ─── Interactive wizard ────────────────────────────────────────────────────
function emojiDisplay(key) {
  return /^\d+$/.test(key) ? `<:e:${key}>` : key;
}

function rrListView(session) {
  const guild = session.state.guild;
  const map = roles.getReactionRoles(guild.id);
  const bindings = [];
  for (const [mid, pairs] of Object.entries(map)) {
    for (const [key, rid] of Object.entries(pairs)) bindings.push({ mid, key, rid });
  }
  const lines = bindings.map(b => `\`${b.mid}\` ${emojiDisplay(b.key)} → <@&${b.rid}>`);
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle("🎭 Reaction Roles")
    .setDescription(
      (lines.length ? lines.join("\n").slice(0, 3800) : "No reaction roles set up yet.") +
      "\n\n**Add binding** walks you through it: paste a message link + emoji, then pick the role."
    );
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rr:add").setLabel("Add binding").setEmoji("➕").setStyle(ButtonStyle.Success),
  )];
  if (bindings.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("rr:remove")
        .setPlaceholder("Remove a binding…")
        .addOptions(bindings.slice(0, 25).map(b => ({
          label: `msg ${b.mid.slice(-6)} → ${session.state.guild.roles.cache.get(b.rid)?.name || b.rid}`,
          description: /^\d+$/.test(b.key) ? "custom emoji" : b.key,
          value: `${b.mid}|${b.key}`.slice(0, 100),
        }))),
    ));
  }
  return { embeds: [embed], components: rows };
}

function rrRoleView(session) {
  const { targetMessageId, emojiRaw } = session.state;
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle("🎭 Reaction Roles — pick the role")
    .setDescription(`Binding ${emojiRaw} on message \`${targetMessageId}\`.\nNow choose the role members get when they react:`);
  const rows = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId("rr:role").setPlaceholder("Role to grant…").setMinValues(1).setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("rr:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows };
}

ui.registerPanel("rr", {
  level: "admin",
  render(session) {
    return session.state.view === "role" ? rrRoleView(session) : rrListView(session);
  },
  handlers: {
    async add(interaction) {
      const modal = new ModalBuilder().setCustomId("rr_modal:target").setTitle("Reaction Role — target")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("msg").setLabel("Message link (or ID from this channel)")
              .setStyle(TextInputStyle.Short).setPlaceholder("https://discord.com/channels/…/…/…")
              .setMaxLength(120).setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("emoji").setLabel("Emoji — paste it (😀 or <:name:id>)")
              .setStyle(TextInputStyle.Short).setMaxLength(64).setRequired(true),
          ),
        );
      await interaction.showModal(modal);
    },
    async role(interaction, session, { repaint }) {
      const guild = session.state.guild;
      const role = guild.roles.cache.get(interaction.values[0]);
      if (!role) return ui.ephemeralNote(interaction, "Role not found.");
      if (role.position >= guild.members.me.roles.highest.position || role.managed) {
        return ui.ephemeralNote(interaction, "That role is higher than my highest role (or managed) — I can't assign it.");
      }
      const { targetMessage, emojiKey, emojiRaw } = session.state;
      await interaction.deferUpdate();
      await safe.react(targetMessage, emojiRaw, "wizard reaction role add");
      roles.addReactionRole(guild.id, targetMessage.id, emojiKey, role.id);
      session.state.view = "list";
      await repaint();
    },
    async cancel(interaction, session, { repaint }) {
      session.state.view = "list";
      await repaint();
    },
    async remove(interaction, session, { repaint }) {
      const [mid, key] = interaction.values[0].split("|");
      roles.removeReactionRole(session.guildId, mid, key);
      await repaint();
    },
  },
  modals: {
    async target(interaction, session, { repaint }) {
      const guild = session.state.guild;
      const rawMsg = interaction.fields.getTextInputValue("msg").trim();
      const emoji = parseEmojiArg(interaction.fields.getTextInputValue("emoji").trim());
      if (!emoji) return ui.ephemeralNote(interaction, "Invalid emoji.");

      // Accept a full message link or a bare ID (bare = the channel the panel was opened in).
      let channelId = session.state.channelId;
      let messageId = rawMsg;
      const link = rawMsg.match(/channels\/\d+\/(\d+)\/(\d+)/);
      if (link) { channelId = link[1]; messageId = link[2]; }
      if (!/^\d{17,20}$/.test(messageId)) return ui.ephemeralNote(interaction, "That doesn't look like a message link or ID.");

      await interaction.deferUpdate();
      const channel = guild.channels.cache.get(channelId);
      const target = channel ? await safe.orNull(channel.messages.fetch(messageId), "rr wizard fetch") : null;
      if (!target) return ui.ephemeralNote(interaction, "Couldn't find that message. Check the link, or use a message from this channel.");

      session.state.targetMessage = target;
      session.state.targetMessageId = messageId;
      session.state.emojiKey = emoji.key;
      session.state.emojiRaw = emoji.raw;
      session.state.view = "role";
      await repaint();
    },
  },
});

async function openReactionRolePanel(source, guild, channelId, userId) {
  await ui.openPanel(source, "rr", {
    ownerId: userId,
    state: { guild, channelId, view: "list" },
    ephemeral: true,
  });
}

async function handleReactionRole(message, args, ctx) {
  const sub = args[0]?.toLowerCase();
  if (!sub) return openReactionRolePanel(message, message.guild, message.channel.id, message.author.id);

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
      return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "reactionrole add <messageId> <emoji> <@role>")}`)] });

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
    if (!messageId || !emoji) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "reactionrole remove <messageId> <emoji>")}`)] });
    const ok = roles.removeReactionRole(message.guild.id, messageId, emoji.key);
    return message.reply({ embeds: ok ? [successEmbed("Reaction role removed.")] : [errorEmbed("No such reaction role binding.")] });
  }

  return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🎭 Reaction Roles").setDescription([
    `${usage(ctx, "reactionrole add <messageId> <emoji> <@role>")} — bind an emoji to a role`,
    `${usage(ctx, "reactionrole remove <messageId> <emoji>")} — remove a binding`,
    `${usage(ctx, "reactionrole list")} — list all bindings`,
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
      .addSubcommand(s => s.setName("list").setDescription("List bindings"))
      .addSubcommand(s => s.setName("panel").setDescription("Open the interactive reaction-role wizard")),
    execute: async (interaction, ctx) => {
      const sub = interaction.options.getSubcommand();
      if (sub === "panel") return openReactionRolePanel(interaction, interaction.guild, interaction.channelId, interaction.user.id);
      if (sub === "list") {
        const map = roles.getReactionRoles(interaction.guild.id);
        const ids = Object.keys(map);
        if (!ids.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setDescription("No reaction roles set up.")], flags: MessageFlags.Ephemeral });
        const lines = ids.map(mid => `**\`${mid}\`:** ` + Object.entries(map[mid]).map(([k, rid]) => `${/^\d+$/.test(k) ? `<:e:${k}>` : k} → <@&${rid}>`).join(", "));
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🎭 Reaction Roles").setDescription(lines.join("\n").slice(0, 4000))], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      }
      const messageId = interaction.options.getString("message_id");
      const emoji = parseEmojiArg(interaction.options.getString("emoji"));
      if (!emoji) return interaction.reply({ embeds: [errorEmbed("Invalid emoji.")], flags: MessageFlags.Ephemeral });
      if (sub === "remove") {
        const ok = roles.removeReactionRole(interaction.guild.id, messageId, emoji.key);
        return interaction.reply({ embeds: ok ? [successEmbed("Reaction role removed.")] : [errorEmbed("No such binding.")], flags: MessageFlags.Ephemeral });
      }
      // add
      const role = interaction.options.getRole("role");
      const target = await safe.orNull(interaction.channel.messages.fetch(messageId), `slash reaction role fetch msg ${messageId}`);
      if (!target) return interaction.reply({ embeds: [errorEmbed("Message not found in this channel.")], flags: MessageFlags.Ephemeral });
      if (role.position >= interaction.guild.members.me.roles.highest.position)
        return interaction.reply({ embeds: [errorEmbed("That role is higher than my highest role.")], flags: MessageFlags.Ephemeral });
      await safe.react(target, emoji.raw, "slash reaction role add reaction");
      roles.addReactionRole(interaction.guild.id, messageId, emoji.key, role.id);
      return interaction.reply({ embeds: [successEmbed(`Bound ${emoji.raw} → ${role}.`)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    },
  },
];
