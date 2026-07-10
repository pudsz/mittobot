// Custom Tags — server-defined text snippets invoked by name. Admins/mods create
// and delete tags via `$tag create|delete`; anyone can invoke one via
// `$tag <name>` or the configured shortcut. Tags are per-guild and stored in
// SQLite. Placeholders {user}, {server}, {count} are substituted at call time.
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const db = require("../db");
const theme = require("../theme");
const { OWNER_IDS } = require("../utils");

const MAX_TAGS_PER_GUILD = 200;
const MAX_CONTENT = 2000;
const NAME_RE = /^[a-z0-9_-]{1,32}$/;

function canManage(member) {
  return member?.permissions?.has(PermissionFlagsBits.ManageMessages) || OWNER_IDS.has(member?.id);
}

function render(content, ctx) {
  return String(content || "")
    .replace(/\{user\}/g, `<@${ctx.userId}>`)
    .replace(/\{username\}/g, ctx.username)
    .replace(/\{server\}/g, ctx.serverName)
    .replace(/\{count\}/g, ctx.memberCount);
}

function invokeTag(guildId, name, ctx) {
  const tag = db.getTag(guildId, name);
  if (!tag) return null;
  db.incrementTagUses(guildId, name);
  return render(tag.content, ctx);
}

function listEmbed(guildId) {
  const tags = db.getTags(guildId);
  if (!tags.length) return theme.embed(guildId, "info", "No tags yet. Create one with `$tag create <name> <content>`.").setTitle("🏷️ Tags");
  const names = tags.map(t => `\`${t.name}\``).join(", ");
  return theme.embed(guildId, "info", names).setTitle(`🏷️ Tags (${tags.length})`);
}

module.exports = [
  {
    name: "tag",
    description: "Create, invoke, or manage custom tags",
    aliases: ["t"],
    category: "fun",
    prefix: async (m, args) => {
      const sub = (args[0] || "").toLowerCase();
      const ctx = { userId: m.author.id, username: m.author.username, serverName: m.guild.name, memberCount: m.guild.memberCount };

      if (!sub) return m.reply({ embeds: [listEmbed(m.guild.id)] });

      if (sub === "list") return m.reply({ embeds: [listEmbed(m.guild.id)] });

      if (sub === "create" || sub === "add" || sub === "edit") {
        if (!canManage(m.member)) return m.reply({ embeds: [theme.error(m.guild.id, "You need **Manage Messages** to manage tags.")] });
        const name = (args[1] || "").toLowerCase();
        const content = args.slice(2).join(" ");
        if (!NAME_RE.test(name)) return m.reply({ embeds: [theme.error(m.guild.id, "Tag name must be 1–32 chars: letters, numbers, `-`, `_`.")] });
        if (!content) return m.reply({ embeds: [theme.error(m.guild.id, "Provide tag content: `$tag create <name> <content>`.")] });
        if (content.length > MAX_CONTENT) return m.reply({ embeds: [theme.error(m.guild.id, `Content too long (max ${MAX_CONTENT}).`)] });
        const existing = db.getTag(m.guild.id, name);
        if (!existing && db.getTags(m.guild.id).length >= MAX_TAGS_PER_GUILD)
          return m.reply({ embeds: [theme.error(m.guild.id, `This server has reached the tag limit (${MAX_TAGS_PER_GUILD}).`)] });
        db.createTag(m.guild.id, name, content, m.author.id);
        return m.reply({ embeds: [theme.success(m.guild.id, `🏷️ Tag \`${name}\` ${existing ? "updated" : "created"}.`)] });
      }

      if (sub === "delete" || sub === "remove") {
        if (!canManage(m.member)) return m.reply({ embeds: [theme.error(m.guild.id, "You need **Manage Messages** to manage tags.")] });
        const name = (args[1] || "").toLowerCase();
        const ok = db.deleteTag(m.guild.id, name);
        return m.reply({ embeds: ok ? [theme.success(m.guild.id, `🗑️ Tag \`${name}\` deleted.`)] : [theme.error(m.guild.id, "No tag with that name.")] });
      }

      if (sub === "info") {
        const name = (args[1] || "").toLowerCase();
        const tag = db.getTag(m.guild.id, name);
        if (!tag) return m.reply({ embeds: [theme.error(m.guild.id, "No tag with that name.")] });
        return m.reply({ embeds: [theme.embed(m.guild.id, "info", `**Uses:** ${tag.uses}\n**Created by:** <@${tag.created_by}>`).setTitle(`🏷️ ${tag.name}`)] });
      }

      // Otherwise treat the first arg as a tag name to invoke.
      const out = invokeTag(m.guild.id, sub, ctx);
      if (out === null) return m.reply({ embeds: [theme.error(m.guild.id, `No tag named \`${sub}\`. Use \`$tag list\`.`)] });
      return m.reply({ content: out, allowedMentions: { parse: [] } });
    },
    slash: new SlashCommandBuilder().setName("tag").setDescription("Create, invoke, or manage custom tags")
      .addSubcommand(c => c.setName("show").setDescription("Show a tag")
        .addStringOption(o => o.setName("name").setDescription("Tag name").setRequired(true)))
      .addSubcommand(c => c.setName("list").setDescription("List all tags"))
      .addSubcommand(c => c.setName("create").setDescription("Create or edit a tag (Manage Messages)")
        .addStringOption(o => o.setName("name").setDescription("Tag name (a-z, 0-9, -, _)").setRequired(true))
        .addStringOption(o => o.setName("content").setDescription("Tag content").setRequired(true)))
      .addSubcommand(c => c.setName("delete").setDescription("Delete a tag (Manage Messages)")
        .addStringOption(o => o.setName("name").setDescription("Tag name").setRequired(true))),
    execute: async (i) => {
      const sub = i.options.getSubcommand();
      const ctx = { userId: i.user.id, username: i.user.username, serverName: i.guild.name, memberCount: i.guild.memberCount };

      if (sub === "list") return i.reply({ embeds: [listEmbed(i.guild.id)] });

      if (sub === "show") {
        const name = i.options.getString("name").toLowerCase();
        const out = invokeTag(i.guild.id, name, ctx);
        if (out === null) return i.reply({ embeds: [theme.error(i.guild.id, `No tag named \`${name}\`.`)], flags: 64 });
        return i.reply({ content: out, allowedMentions: { parse: [] } });
      }

      if (sub === "create") {
        if (!canManage(i.member)) return i.reply({ embeds: [theme.error(i.guild.id, "You need **Manage Messages** to manage tags.")], flags: 64 });
        const name = i.options.getString("name").toLowerCase();
        const content = i.options.getString("content");
        if (!NAME_RE.test(name)) return i.reply({ embeds: [theme.error(i.guild.id, "Tag name must be 1–32 chars: letters, numbers, `-`, `_`.")], flags: 64 });
        if (content.length > MAX_CONTENT) return i.reply({ embeds: [theme.error(i.guild.id, `Content too long (max ${MAX_CONTENT}).`)], flags: 64 });
        const existing = db.getTag(i.guild.id, name);
        if (!existing && db.getTags(i.guild.id).length >= MAX_TAGS_PER_GUILD)
          return i.reply({ embeds: [theme.error(i.guild.id, `This server has reached the tag limit (${MAX_TAGS_PER_GUILD}).`)], flags: 64 });
        db.createTag(i.guild.id, name, content, i.user.id);
        return i.reply({ embeds: [theme.success(i.guild.id, `🏷️ Tag \`${name}\` ${existing ? "updated" : "created"}.`)] });
      }

      // delete
      const name = i.options.getString("name").toLowerCase();
      if (!canManage(i.member)) return i.reply({ embeds: [theme.error(i.guild.id, "You need **Manage Messages** to manage tags.")], flags: 64 });
      const ok = db.deleteTag(i.guild.id, name);
      return i.reply({ embeds: ok ? [theme.success(i.guild.id, `🗑️ Tag \`${name}\` deleted.`)] : [theme.error(i.guild.id, "No tag with that name.")], flags: ok ? undefined : 64 });
    },
  },
];
