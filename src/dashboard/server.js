const express = require("express");
const crypto  = require("crypto");
const fs      = require("fs");
const path    = require("path");

const settings = require("../settings");
const features = require("../features");
const config   = require("../config");
const automod  = require("../automod");
const greet    = require("../greet");
const roles    = require("../roles");
const { loadModule, MODULES_DIR, ensureModulesDir } = require("../commands/modules");
const ai = require("../ai");

const AI_SETTING_KEYS = new Set([
  "aiEnabled", "aiProvider",
  "groqApiKey", "groqModel",
  "openaiApiKey", "openaiModel",
  "claudeApiKey", "claudeModel",
  "geminiApiKey", "geminiModel",
  "customApiKey", "customModel", "customBaseUrl", "customApiType",
  "aiSystemPrompt", "aiAllowedChannels", "aiIgnoredChannels",
]);

function getBotSettings() {
  const all = settings.getAll();
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (!AI_SETTING_KEYS.has(k)) out[k] = v;
  }
  return out;
}

// Valid data store names (whitelist — prevents arbitrary property access)
const DATA_STORES = ["stickies", "warnings", "reactionlogs", "afkUsers", "customRoles"];
const NAME_RE     = /^[a-zA-Z0-9_-]+$/;

// In-memory session tokens (cleared on restart)
const sessions = new Set();

// ─── Cookie helpers (no cookie-parser dependency)
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

// Constant-time password comparison
function passwordMatches(input, expected) {
  if (typeof input !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function startDashboard(ctx) {
  const PASSWORD = process.env.DASHBOARD_PASSWORD;
  const PORT     = parseInt(process.env.DASHBOARD_PORT, 10) || 3000;

  if (!PASSWORD) {
    console.warn("[dashboard] DASHBOARD_PASSWORD not set — dashboard disabled (refusing to expose an unprotected panel on 0.0.0.0).");
    return;
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // ─── Auth middleware for /api/*
  function requireAuth(req, res, next) {
    const token = parseCookies(req).dash_session;
    if (token && sessions.has(token)) return next();
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ─── Login / logout
  app.post("/login", (req, res) => {
    if (!passwordMatches(req.body?.password ?? "", PASSWORD)) {
      return res.status(401).json({ error: "Wrong password" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.add(token);
    res.setHeader("Set-Cookie", `dash_session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`);
    res.json({ ok: true });
  });

  app.post("/logout", (req, res) => {
    const token = parseCookies(req).dash_session;
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "dash_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict");
    res.json({ ok: true });
  });

  // Lets the UI know whether the current cookie is still valid
  app.get("/api/me", requireAuth, (req, res) => res.json({ ok: true }));

  // ─── Status
  app.get("/api/status", requireAuth, (req, res) => {
    const client = ctx.client;
    const activity = client.user?.presence?.activities?.[0] ?? null;
    res.json({
      tag:        client.user?.tag ?? null,
      uptimeMs:   client.uptime ?? 0,
      ping:       Math.round(client.ws.ping),
      guilds:     client.guilds.cache.size,
      users:      client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
      activity:   activity ? { name: activity.name, type: activity.type } : null,
    });
  });

  // ─── Presence
  app.post("/api/presence", requireAuth, (req, res) => {
    const { text, type } = req.body || {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text required" });
    const t = Number.isInteger(type) ? type : 3; // default WATCHING
    try {
      ctx.client.user.setActivity(text, { type: t });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Settings
  app.get("/api/settings", requireAuth, (req, res) => {
    res.json({ settings: getBotSettings(), defaults: settings.DEFAULTS });
  });

  app.post("/api/settings", requireAuth, (req, res) => {
    const { key, value } = req.body || {};
    if (typeof key !== "string" || !(key in settings.DEFAULTS))
      return res.status(400).json({ error: "Unknown setting key" });
    if (AI_SETTING_KEYS.has(key))
      return res.status(400).json({ error: "Use the AI tab to change this setting" });
    if (typeof value !== "string")
      return res.status(400).json({ error: "value must be a string" });
    if (key === "prefix" && (value.length < 1 || value.length > 3))
      return res.status(400).json({ error: "prefix must be 1–3 characters" });
    settings.set(key, value);
    res.json({ ok: true, settings: getBotSettings() });
  });

  app.post("/api/settings/reset", requireAuth, (req, res) => {
    for (const [k, v] of Object.entries(settings.DEFAULTS)) settings.set(k, v);
    res.json({ ok: true, settings: getBotSettings() });
  });

  // ─── AI
  app.get("/api/ai", requireAuth, async (req, res) => {
    try {
      res.json(await ai.getPublicSettingsAsync());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ai", requireAuth, (req, res) => {
    try {
      ai.updateSettings(req.body || {});
      res.json({ ok: true, ...ai.getPublicSettings() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Feature categories (Commands tab toggle cards)
  app.get("/api/features", requireAuth, (req, res) => {
    const cats = features.listCategories().map(cat => {
      const commands = [...ctx.commandMap.values()]
        .filter(c => c.category === cat.id)
        .map(c => c.name);
      return { id: cat.id, label: cat.label, description: cat.description, enabled: settings.get(cat.key) !== false, commands };
    });
    res.json({ features: cats });
  });

  app.post("/api/features", requireAuth, (req, res) => {
    const { id, enabled } = req.body || {};
    const cat = features.getCategory(typeof id === "string" ? id : "");
    if (!cat) return res.status(400).json({ error: "Unknown feature category" });
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
    settings.set(cat.key, enabled);
    res.json({ ok: true, id, enabled });
  });

  // ─── Per-command config
  // The dashboard manages config for the bot's primary (first) guild.
  function primaryGuildId() {
    return ctx.client.guilds.cache.first()?.id ?? null;
  }

  app.get("/api/commands", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    const guild = guildId ? ctx.client.guilds.cache.get(guildId) : null;
    const channels = guild ? [...guild.channels.cache.filter(c => c.type === 0).values()].map(c => ({ id: c.id, name: c.name })) : [];
    const roles    = guild ? [...guild.roles.cache.filter(r => r.id !== guild.id).values()].map(r => ({ id: r.id, name: r.name })) : [];
    const seen = new Set();
    const commands = [];
    for (const def of ctx.commandMap.values()) {
      if (!def.name || def._dynamic || seen.has(def.name)) continue;
      seen.add(def.name);
      commands.push({
        name: def.name,
        description: def.description || "",
        category: def.category || null,
        config: config.resolve(guildId, def.name, def),
      });
    }
    commands.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ guildId, hasGuild: Boolean(guild), guildName: guild?.name ?? null, permLevels: config.PERM_ORDER, permLabels: config.PERM_LABELS, channels, roles, commands });
  });

  app.post("/api/commands/:name", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    const name = req.params.name;
    const def = ctx.commandMap.get(name);
    if (!def || def._dynamic) return res.status(404).json({ error: "Unknown command" });

    const body = req.body || {};
    if (body.reset === true) { config.reset(guildId, name); return res.json({ ok: true, config: config.resolve(guildId, name, def) }); }

    const patch = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.permission === "string" && config.PERM_ORDER.includes(body.permission)) patch.permission = body.permission;
    if (Number.isInteger(body.cooldown) && body.cooldown >= 0 && body.cooldown <= 86400) patch.cooldown = body.cooldown;
    if (Array.isArray(body.allowedChannels)) patch.allowedChannels = body.allowedChannels.filter(x => /^\d{17,20}$/.test(x));
    if (Array.isArray(body.blockedChannels)) patch.blockedChannels = body.blockedChannels.filter(x => /^\d{17,20}$/.test(x));
    if (Array.isArray(body.allowedRoles))    patch.allowedRoles    = body.allowedRoles.filter(x => /^\d{17,20}$/.test(x));
    if (body.settings && typeof body.settings === "object") patch.settings = body.settings;

    config.set(guildId, name, patch);
    res.json({ ok: true, config: config.resolve(guildId, name, def) });
  });

  // ─── Automod
  app.get("/api/automod", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    const guild = guildId ? ctx.client.guilds.cache.get(guildId) : null;
    const channels = guild ? [...guild.channels.cache.filter(c => c.type === 0).values()].map(c => ({ id: c.id, name: c.name })) : [];
    const roles    = guild ? [...guild.roles.cache.filter(r => r.id !== guild.id).values()].map(r => ({ id: r.id, name: r.name })) : [];
    res.json({ guildId, hasGuild: Boolean(guild), guildName: guild?.name ?? null, channels, roles, config: guildId ? automod.getConfig(guildId) : automod.getConfig("_none") });
  });

  app.post("/api/automod", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    const body = req.body || {};
    const patch = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.logChannelId === null || /^\d{17,20}$/.test(body.logChannelId || "")) patch.logChannelId = body.logChannelId || null;
    if (Array.isArray(body.ignoredChannels)) patch.ignoredChannels = body.ignoredChannels.filter(x => /^\d{17,20}$/.test(x));
    if (Array.isArray(body.ignoredRoles))    patch.ignoredRoles    = body.ignoredRoles.filter(x => /^\d{17,20}$/.test(x));
    if (body.rules && typeof body.rules === "object") patch.rules = body.rules;
    const next = automod.setConfig(guildId, patch);
    res.json({ ok: true, config: next });
  });

  // ─── Welcome / leave / logs
  app.get("/api/greet", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    const guild = guildId ? ctx.client.guilds.cache.get(guildId) : null;
    const channels = guild ? [...guild.channels.cache.filter(c => c.type === 0).values()].map(c => ({ id: c.id, name: c.name })) : [];
    res.json({ guildId, hasGuild: Boolean(guild), guildName: guild?.name ?? null, channels, config: greet.getConfig(guildId || "_none") });
  });

  app.post("/api/greet", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    const b = req.body || {};
    const clean = {};
    const okChan = v => v === null || /^\d{17,20}$/.test(v || "");
    if (b.welcome) clean.welcome = {
      enabled: !!b.welcome.enabled,
      channelId: okChan(b.welcome.channelId) ? (b.welcome.channelId || null) : null,
      message: String(b.welcome.message || "").slice(0, 1500),
    };
    if (b.leave) clean.leave = {
      enabled: !!b.leave.enabled,
      channelId: okChan(b.leave.channelId) ? (b.leave.channelId || null) : null,
      message: String(b.leave.message || "").slice(0, 1500),
    };
    if (b.logs) clean.logs = {
      enabled: !!b.logs.enabled,
      channelId: okChan(b.logs.channelId) ? (b.logs.channelId || null) : null,
      memberEvents: !!b.logs.memberEvents,
      messageEvents: !!b.logs.messageEvents,
    };
    const next = greet.setConfig(guildId, clean);
    res.json({ ok: true, config: next });
  });

  // ─── Roles (autorole + reaction-role viewer)
  app.get("/api/roles", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    const guild = guildId ? ctx.client.guilds.cache.get(guildId) : null;
    const allRoles = guild ? [...guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).values()].map(r => ({ id: r.id, name: r.name })) : [];
    const g = guildId ? roles.getGuild(guildId) : { autoroles: [], reactionRoles: {} };
    res.json({ guildId, hasGuild: Boolean(guild), guildName: guild?.name ?? null, roles: allRoles, autoroles: g.autoroles, reactionRoles: g.reactionRoles });
  });

  app.post("/api/roles/autoroles", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!Array.isArray(req.body?.autoroles)) return res.status(400).json({ error: "autoroles must be an array" });
    const next = roles.setAutoroles(guildId, req.body.autoroles);
    res.json({ ok: true, autoroles: next });
  });

  app.post("/api/roles/reaction/remove", requireAuth, (req, res) => {
    const guildId = primaryGuildId();
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    const { messageId, key } = req.body || {};
    if (!messageId || !key) return res.status(400).json({ error: "messageId and key required" });
    roles.removeReactionRole(guildId, messageId, key);
    res.json({ ok: true });
  });

  // ─── Modules
  app.get("/api/modules", requireAuth, (req, res) => {
    ensureModulesDir();
    const files = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith(".js"));
    const list = files.map(f => {
      const name = f.replace(/\.js$/, "");
      return { name, loaded: ctx.commandMap.has(name) };
    });
    res.json({ modules: list });
  });

  app.get("/api/modules/:name", requireAuth, (req, res) => {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: "Invalid module name" });
    const filePath = path.join(MODULES_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    res.json({ name, code: fs.readFileSync(filePath, "utf8"), loaded: ctx.commandMap.has(name) });
  });

  // Create or overwrite, then hot-load (mirrors src/commands/modules.js)
  app.post("/api/modules", requireAuth, (req, res) => {
    const { name, code } = req.body || {};
    if (typeof name !== "string" || !NAME_RE.test(name)) return res.status(400).json({ error: "Invalid module name" });
    if (typeof code !== "string" || !code.trim())        return res.status(400).json({ error: "Code required" });
    ensureModulesDir();
    const filePath = path.join(MODULES_DIR, `${name}.js`);
    const existed  = fs.existsSync(filePath);
    const backup   = existed ? fs.readFileSync(filePath, "utf8") : null;
    try {
      fs.writeFileSync(filePath, code, "utf8");
      const mod = loadModule(name, ctx.commandMap);
      if (!mod) throw new Error("Module loaded as null — check your code.");
      res.json({ ok: true, name: mod.name ?? name });
    } catch (err) {
      // Restore previous version (or remove the bad new file)
      if (existed) fs.writeFileSync(filePath, backup, "utf8");
      else if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch {} }
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/modules/:name/reload", requireAuth, (req, res) => {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: "Invalid module name" });
    try {
      const mod = loadModule(name, ctx.commandMap);
      if (!mod) return res.status(404).json({ error: "No module file found" });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/modules/:name", requireAuth, (req, res) => {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: "Invalid module name" });
    const filePath = path.join(MODULES_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    fs.unlinkSync(filePath);
    try { delete require.cache[require.resolve(filePath)]; } catch {}
    ctx.commandMap.delete(name);
    res.json({ ok: true });
  });

  // ─── Data stores
  app.get("/api/data/:store", requireAuth, (req, res) => {
    const { store } = req.params;
    if (!DATA_STORES.includes(store)) return res.status(400).json({ error: "Unknown store" });
    res.json({ store, data: ctx.data[store] ?? {} });
  });

  // ─── Static UI (served last so /api routes win)
  app.use(express.static(path.join(__dirname, "public")));

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Dashboard on http://0.0.0.0:${PORT}`);
  });
}

module.exports = { startDashboard };
