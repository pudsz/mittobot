const {
  EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
  ActionRowBuilder, RoleSelectMenuBuilder,
} = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const roles = require("../roles");
const ui = require("../ui");

const BLURPLE = 0x5865f2;

function usage(ctx, text) {
  return `\`${ctx?.utils?.PREFIX || "$"}${text}\``;
}

function listEmbed(guild) {
  const ids = roles.getAutoroles(guild.id);
  const desc = ids.length ? ids.map(id => `<@&${id}>`).join("\n") : "No autoroles set. New members receive none.";
  return new EmbedBuilder().setColor(BLURPLE).setTitle("🪄 Autoroles (assigned on join)").setDescription(desc);
}

function toggleRole(guildId, roleId) {
  const list = [...roles.getAutoroles(guildId)];
  const idx = list.indexOf(roleId);
  if (idx >= 0) list.splice(idx, 1); else list.push(roleId);
  roles.setAutoroles(guildId, list);
  return idx < 0; // true if added
}

// ─── Interactive panel: one role-select sets the whole autorole list ──────
ui.registerPanel("autorole", {
  level: "admin",
  render(session) {
    const guild = session.state.guild;
    const current = roles.getAutoroles(guild.id);
    const embed = listEmbed(guild)
      .setDescription(
        (current.length ? current.map(id => `<@&${id}>`).join("\n") : "No autoroles set. New members receive none.") +
        "\n\nUse the menu below to set the full list — selected roles are assigned to every new member."
      );
    const select = new RoleSelectMenuBuilder()
      .setCustomId("autorole:set")
      .setPlaceholder("Select autoroles (empty = none)")
      .setMinValues(0).setMaxValues(25)
      .setDefaultRoles(current.slice(0, 25));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
  },
  handlers: {
    async set(interaction, session, { repaint }) {
      const guild = session.state.guild;
      const me = guild.members.me;
      const ok = [];
      const skipped = [];
      for (const id of interaction.values) {
        const role = guild.roles.cache.get(id);
        if (!role || role.managed || role.position >= me.roles.highest.position) skipped.push(role ? role.name : id);
        else ok.push(id);
      }
      roles.setAutoroles(guild.id, ok);
      await repaint();
      if (skipped.length) {
        await ui.ephemeralNote(interaction, `Skipped (above my highest role or managed): ${skipped.map(n => `\`${n}\``).join(", ")}`);
      }
    },
  },
});

async function handleAutorole(message, args, ctx) {
  const sub = args[0]?.toLowerCase();
  if (!sub) {
    return ui.openPanel(message, "autorole", {
      ownerId: message.author.id,
      state: { guild: message.guild },
      ephemeral: true,
    });
  }
  if (sub === "list") return message.reply({ embeds: [listEmbed(message.guild)], allowedMentions: { parse: [] } });

  if (sub === "add" || sub === "remove" || sub === "toggle") {
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]) || message.guild.roles.cache.find(r => r.name.toLowerCase() === args.slice(1).join(" ").toLowerCase());
    if (!role) return message.reply({ embeds: [errorEmbed("Role not found. Mention it or give an ID/name.")] });
    if (role.position >= message.guild.members.me.roles.highest.position)
      return message.reply({ embeds: [errorEmbed("That role is higher than my highest role — I can't assign it on join.")] });
    const added = toggleRole(message.guild.id, role.id);
    return message.reply({ embeds: [successEmbed(`${role} ${added ? "added to" : "removed from"} autoroles.`)], allowedMentions: { parse: [] } });
  }

  return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🪄 Autorole").setDescription([
    `${usage(ctx, "autorole add <@role>")} — give this role to new members`,
    `${usage(ctx, "autorole remove <@role>")} — stop giving this role`,
    `${usage(ctx, "autorole list")} — show current autoroles`,
  ].join("\n"))] });
}

module.exports = [
  {
    name: "autorole",
    description: "Roles automatically assigned to new members",
    defaultPermission: "admin",
    prefix: handleAutorole,
    slash: new SlashCommandBuilder()
      .setName("autorole")
      .setDescription("Manage roles assigned to new members (admin only)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName("action").setDescription("add, remove, or list").setRequired(false)
        .addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }, { name: "list", value: "list" }))
      .addRoleOption(o => o.setName("role").setDescription("Role to add/remove").setRequired(false)),
    execute: async (interaction, ctx) => {
      const action = interaction.options.getString("action");
      if (!action) {
        return ui.openPanel(interaction, "autorole", {
          ownerId: interaction.user.id,
          state: { guild: interaction.guild },
          ephemeral: true,
        });
      }
      if (action === "list") return interaction.reply({ embeds: [listEmbed(interaction.guild)], allowedMentions: { parse: [] } });
      const role = interaction.options.getRole("role");
      if (!role) return interaction.reply({ embeds: [errorEmbed("Provide a role.")], flags: MessageFlags.Ephemeral });
      if (role.position >= interaction.guild.members.me.roles.highest.position)
        return interaction.reply({ embeds: [errorEmbed("That role is higher than my highest role.")], flags: MessageFlags.Ephemeral });
      // add/remove explicitly rather than toggle for slash clarity
      const list = [...roles.getAutoroles(interaction.guild.id)];
      const idx = list.indexOf(role.id);
      if (action === "add" && idx < 0) list.push(role.id);
      if (action === "remove" && idx >= 0) list.splice(idx, 1);
      roles.setAutoroles(interaction.guild.id, list);
      return interaction.reply({ embeds: [successEmbed(`${role} ${action === "add" ? "added to" : "removed from"} autoroles.`)], allowedMentions: { parse: [] } });
    },
  },
];
