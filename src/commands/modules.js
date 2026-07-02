const { EmbedBuilder, SlashCommandBuilder, MessageFlags } = require("discord.js");
const { isOwner, errorEmbed, successEmbed, noPermEmbed } = require("../utils");
const fs   = require("fs");
const path = require("path");

const MODULES_DIR = path.join(__dirname, "..", "..", "modules");

function ensureModulesDir() {
  if (!fs.existsSync(MODULES_DIR)) fs.mkdirSync(MODULES_DIR, { recursive: true });
}

// Extract code from a Discord code block (```js ... ``` or ``` ... ```)
function extractCode(content) {
  const match = content.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

function loadModule(name, commandMap) {
  const filePath = path.join(MODULES_DIR, `${name}.js`);
  if (!fs.existsSync(filePath)) return null;
  // Bust require cache so reload works
  delete require.cache[require.resolve(filePath)];
  const mod = require(filePath);
  // Mark as dynamic so $help can list them
  mod._dynamic = true;
  commandMap.set(mod.name ?? name, mod);
  return mod;
}

function prefix(ctx) {
  return ctx?.utils?.PREFIX || "$";
}

function usage(ctx, name, rest = "") {
  return `\`${prefix(ctx)}${name}${rest ? ` ${rest}` : ""}\``;
}

async function handleModules(message, args, ctx) {
  if (!isOwner(message.author.id)) return message.reply({ embeds: [noPermEmbed()] });
  ensureModulesDir();
  const { commandMap } = ctx;
  const sub  = args[0]?.toLowerCase();
  const name = args[1]?.toLowerCase();

  // ── list
  if (sub === "list") {
    const files = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith(".js"));
    if (!files.length) return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("No dynamic modules loaded.")] });
    const lines = files.map(f => {
      const n = f.replace(".js", "");
      const loaded = commandMap.has(n);
      return `${loaded ? "🟢" : "🔴"} ${usage(ctx, n)}`;
    });
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📦 Dynamic Modules").setDescription(lines.join("\n"))] });
  }

  // ── delete
  if (sub === "delete" || sub === "remove") {
    if (!name) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "modules", "delete <name>")}`)] });
    const filePath = path.join(MODULES_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) return message.reply({ embeds: [errorEmbed(`No module named \`${name}\` found.`)] });
    fs.unlinkSync(filePath);
    delete require.cache[require.resolve(filePath)];
    commandMap.delete(name);
    return message.reply({ embeds: [successEmbed(`Module \`${name}\` deleted and unloaded.`)] });
  }

  // ── reload
  if (sub === "reload") {
    if (!name) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "modules", "reload <name>")}`)] });
    const mod = loadModule(name, commandMap);
    if (!mod) return message.reply({ embeds: [errorEmbed(`No module file found for \`${name}\`.`)] });
    return message.reply({ embeds: [successEmbed(`Module \`${name}\` reloaded.`)] });
  }

  // ── create
  if (sub === "create") {
    if (!name) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "modules", "create <name>")} with a JS code block`)] });
    const code = extractCode(message.content);
    if (!code) {
      return message.reply({ embeds: [errorEmbed(
        `Attach a JS code block after the command.\nExample:\n\`\`\`\n${prefix(ctx)}modules create hello\n\\\`\\\`\\\`js\nmodule.exports = {\n  name: 'hello',\n  prefix: async (message) => { await message.reply('Hello!'); }\n}\n\\\`\\\`\\\`\n\`\`\``
      )] });
    }
    const filePath = path.join(MODULES_DIR, `${name}.js`);
    try {
      fs.writeFileSync(filePath, code, "utf8");
      const mod = loadModule(name, commandMap);
      if (!mod) throw new Error("Module loaded as null — check your code.");
      return message.reply({ embeds: [successEmbed(`Module \`${name}\` created and loaded as ${usage(ctx, mod.name ?? name)}.`)] });
    } catch (err) {
      // Clean up bad file
      if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch {} }
      return message.reply({ embeds: [errorEmbed(`Failed to load module: \`${err.message}\``)] });
    }
  }

  // ── usage
  return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🧩 Modules Help").addFields(
    { name: "Create",  value: `${usage(ctx, "modules", "create <name>")} + JS code block in same message` },
    { name: "Delete",  value: usage(ctx, "modules", "delete <name>") },
    { name: "Reload",  value: usage(ctx, "modules", "reload <name>") },
    { name: "List",    value: usage(ctx, "modules", "list") },
    { name: "Example", value: `\`\`\`\n${prefix(ctx)}modules create hello\n\\\`\\\`\\\`js\nmodule.exports = {\n  name: 'hello',\n  prefix: async (message) => {\n    await message.reply('Hello!');\n  }\n}\n\\\`\\\`\\\`\n\`\`\`` },
  )] });
}

module.exports = [
  {
    name: "modules",
    description: "Manage dynamic command modules (owner only)",
    defaultPermission: "owner",
    prefix: handleModules,
    slash: new SlashCommandBuilder().setName("modules").setDescription("List dynamic modules (owner only)"),
    execute: async (interaction, ctx) => {
      if (!isOwner(interaction.user.id)) return interaction.reply({ embeds: [noPermEmbed()], flags: MessageFlags.Ephemeral });
      const { commandMap } = ctx;
      const files = fs.existsSync(MODULES_DIR) ? fs.readdirSync(MODULES_DIR).filter(f => f.endsWith(".js")) : [];
      if (!files.length) return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("No dynamic modules loaded.")] });
      const lines = files.map(f => {
        const n = f.replace(".js", "");
        return `${commandMap.has(n) ? "🟢" : "🔴"} ${usage(ctx, n)}`;
      });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📦 Dynamic Modules").setDescription(lines.join("\n"))] });
    },
  },
];

module.exports.loadModule      = loadModule;
module.exports.MODULES_DIR     = MODULES_DIR;
module.exports.ensureModulesDir = ensureModulesDir;
