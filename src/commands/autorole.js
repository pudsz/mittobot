const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { errorEmbed, successEmbed } = require("../utils");
const roles = require("../roles");

const BLURPLE = 0x5865f2;

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

async function handleAutorole(message, args, ctx) {
  const sub = args[0]?.toLowerCase();
  if (!sub || sub === "list") return message.reply({ embeds: [listEmbed(message.guild)], allowedMentions: { parse: [] } });

  if (sub === "add" || sub === "remove" || sub === "toggle") {
    const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]) || message.guild.roles.cache.find(r => r.name.toLowerCase() === args.slice(1).join(" ").toLowerCase());
    if (!role) return message.reply({ embeds: [errorEmbed("Role not found. Mention it or give an ID/name.")] });
    if (role.position >= message.guild.members.me.roles.highest.position)
      return message.reply({ embeds: [errorEmbed("That role is higher than my highest role — I can't assign it on join.")] });
    const added = toggleRole(message.guild.id, role.id);
    return message.reply({ embeds: [successEmbed(`${role} ${added ? "added to" : "removed from"} autoroles.`)], allowedMentions: { parse: [] } });
  }

  return message.reply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🪄 Autorole").setDescription([
    "`$autorole add <@role>` — give this role to new members",
    "`$autorole remove <@role>` — stop giving this role",
    "`$autorole list` — show current autoroles",
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
      const action = interaction.options.getString("action") || "list";
      if (action === "list") return interaction.reply({ embeds: [listEmbed(interaction.guild)], allowedMentions: { parse: [] } });
      const role = interaction.options.getRole("role");
      if (!role) return interaction.reply({ embeds: [errorEmbed("Provide a role.")], ephemeral: true });
      if (role.position >= interaction.guild.members.me.roles.highest.position)
        return interaction.reply({ embeds: [errorEmbed("That role is higher than my highest role.")], ephemeral: true });
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
