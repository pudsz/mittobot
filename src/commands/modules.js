const { EmbedBuilder, SlashCommandBuilder, MessageFlags } = require("discord.js");
const { isOwner, errorEmbed, successEmbed, noPermEmbed } = require("../utils");
const fs   = require("fs");
const path = require("path");

const MODULES_DIR = path.join(__dirname, "..", "..", "modules");

// Module names must be alphanumeric + underscore/hyphen, 1–32 chars. This is
// the same shape the dashboard's POST /api/modules enforces (NAME_RE). It
// rejects path separators (/ \), dots (so ".." and ".env" can't traverse or
// hit hidden files), and anything else that could let `name` escape
// MODULES_DIR via path.join — which would turn `modules delete ../../index`
// into arbitrary file deletion (fs.unlinkSync) or `modules reload X` into
// arbitrary require()/RCE. Owner-gated, but a compromised owner account or a
// typo shouldn't be able to nuke the repo.
const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

function ensureModulesDir() {
  if (!fs.existsSync(MODULES_DIR)) fs.mkdirSync(MODULES_DIR, { recursive: true });
}

// Reject names that could traverse out of MODULES_DIR. Returns the cleaned
// name or null if invalid.
function safeName(raw) {
  const name = String(raw || "").trim().toLowerCase();
  return NAME_RE.test(name) ? name : null;
}

// Extract code from a Discord code block (```js ... ``` or ``` ... ```)
function extractCode(content) {
  const match = content.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

function loadModule(name, commandMap) {
  // Validate the name before touching the filesystem — a traversal payload
  // here would make require() load an arbitrary file. This guards reload,
  // the dashboard's POST /api/modules/:name/reload, and the index.js bootstrap.
  const safe = safeName(name);
  if (!safe) return null;
  const filePath = path.join(MODULES_DIR, `${safe}.js`);
  if (!fs.existsSync(filePath)) return null;
  // Belt-and-suspenders: confirm the resolved path is still inside MODULES_DIR
  // (defends against any future bypass of NAME_RE, e.g. URL-encoded separators).
  const resolved = path.resolve(filePath);
  const dirResolved = path.resolve(MODULES_DIR) + path.sep;
  if (!resolved.startsWith(dirResolved)) {
    console.error(`[modules] refused to load "${name}" — resolved path escapes MODULES_DIR`);
    return null;
  }
  // Bust require cache so reload works
  delete require.cache[require.resolve(filePath)];
  const mod = require(filePath);
  // Mark as dynamic so $help can list them
  mod._dynamic = true;
  commandMap.set(mod.name ?? safe, mod);
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
    const safe = safeName(name);
    if (!safe) return message.reply({ embeds: [errorEmbed(`Invalid module name. Use only letters, numbers, \`_\`, and \`-\` (1–32 chars).`)] });
    const filePath = path.join(MODULES_DIR, `${safe}.js`);
    if (!fs.existsSync(filePath)) return message.reply({ embeds: [errorEmbed(`No module named \`${safe}\` found.`)] });
    fs.unlinkSync(filePath);
    delete require.cache[require.resolve(filePath)];
    commandMap.delete(safe);
    return message.reply({ embeds: [successEmbed(`Module \`${safe}\` deleted and unloaded.`)] });
  }

  // ── reload
  if (sub === "reload") {
    if (!name) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "modules", "reload <name>")}`)] });
    const safe = safeName(name);
    if (!safe) return message.reply({ embeds: [errorEmbed(`Invalid module name. Use only letters, numbers, \`_\`, and \`-\` (1–32 chars).`)] });
    const mod = loadModule(safe, commandMap);
    if (!mod) return message.reply({ embeds: [errorEmbed(`No module file found for \`${safe}\`.`)] });
    return message.reply({ embeds: [successEmbed(`Module \`${safe}\` reloaded.`)] });
  }

  // ── create
  if (sub === "create") {
    if (!name) return message.reply({ embeds: [errorEmbed(`Usage: ${usage(ctx, "modules", "create <name>")} with a JS code block`)] });
    const safe = safeName(name);
    if (!safe) return message.reply({ embeds: [errorEmbed(`Invalid module name. Use only letters, numbers, \`_\`, and \`-\` (1–32 chars).`)] });
    const code = extractCode(message.content);
    if (!code) {
      return message.reply({ embeds: [errorEmbed(
        `Attach a JS code block after the command.\nExample:\n\`\`\`\n${prefix(ctx)}modules create hello\n\\\`\\\`\\\`js\nmodule.exports = {\n  name: 'hello',\n  prefix: async (message) => { await message.reply('Hello!'); }\n}\n\\\`\\\`\\\`\n\`\`\``
      )] });
    }
    const filePath = path.join(MODULES_DIR, `${safe}.js`);
    try {
      fs.writeFileSync(filePath, code, "utf8");
      const mod = loadModule(safe, commandMap);
      if (!mod) throw new Error("Module loaded as null — check your code.");
      return message.reply({ embeds: [successEmbed(`Module \`${safe}\` created and loaded as ${usage(ctx, mod.name ?? safe)}.`)] });
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
