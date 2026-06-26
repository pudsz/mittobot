const express = require("express");
const cors    = require("cors");
const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const fs      = require("fs");
const os      = require("os");
const path    = require("path");
const { ChannelType, PermissionFlagsBits } = require("discord.js");

const { OWNER_IDS } = require("../utils");
const settings = require("../settings");
const features = require("../features");
const config   = require("../config");
const automod  = require("../automod");
const greet    = require("../greet");
const roles    = require("../roles");
const { loadModule, MODULES_DIR, ensureModulesDir } = require("../commands/modules");
const ai = require("../ai");
const dangerzone = require("../dangerzone");

// ─── This is the bot's PUBLIC API. The dashboard is hosted separately (e.g. on
// Vercel) and is a pure client of these endpoints — it never touches the
// database directly. The bot process is the single source of truth: every write
// updates the bot's in-memory state AND Postgres, so changes are live.
//
// Auth is a stateless JWT (Bearer) rather than a cookie session, so it works
// cross-origin and survives horizontal scaling (multiple bot instances sharing
// DASHBOARD_JWT_SECRET).

const AI_SETTING_KEYS = new Set([
  "aiEnabled", "aiProvider",
  "groqApiKey", "groqModel",
  "openaiApiKey", "openaiModel",
  "claudeApiKey", "claudeModel",
  "geminiApiKey", "geminiModel",
  "customApiKey", "customModel", "customBaseUrl", "customApiType",
  "aiSystemPrompt", "aiAllowedChannels", "aiIgnoredChannels",
  "aiTemperature", "aiMaxTokens", "aiTopP", "aiContextLimit",
  "aiToolsEnabled", "aiMemoryEnabled", "aiThinkingEnabled",
  "aiFallbackProviders", "aiChattyMode", "aiChattyCooldown",
  "aiToolPermissions",
]);

function getBotSettings() {
  const all = settings.getAll();
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (!AI_SETTING_KEYS.has(k)) out[k] = v;
  }
  return out;
}

const DATA_STORES = ["stickies", "warnings", "reactionlogs", "afkUsers", "customRoles"];
const NAME_RE     = /^[a-zA-Z0-9_-]+$/;

function passwordMatches(input, expected) {
  if (typeof input !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function startApi(ctx) {
  const PASSWORD = process.env.DASHBOARD_PASSWORD;
  const PORT     = parseInt(process.env.API_PORT, 10) || parseInt(process.env.PORT, 10) || 3001;

  // Command rate tracking (rolling window for dashboard display)
  const cmdTimes = [];
  ctx.commandRate = () => {
    const now = Date.now();
    const cutoff = now - 60_000;
    while (cmdTimes.length && cmdTimes[0] < cutoff) cmdTimes.shift();
    return cmdTimes.length;
  };
  ctx.trackCommand = () => { cmdTimes.push(Date.now()); };
  // Allow the bot to share a process secret across instances; fall back to an
  // ephemeral one (fine for a single instance, tokens reset on restart).
  const JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || crypto.randomBytes(32).toString("hex");
  const TOKEN_TTL  = process.env.DASHBOARD_TOKEN_TTL || "7d";

  // Discord OAuth config
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
  const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
  const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "";
  const HAS_DISCORD_OAUTH = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);

  if (!PASSWORD && !HAS_DISCORD_OAUTH) {
    console.warn("[api] Neither DASHBOARD_PASSWORD nor DISCORD_CLIENT_ID set — dashboard API disabled.");
    return;
  }
  if (HAS_DISCORD_OAUTH) {
    console.log("[api] Discord OAuth enabled — password login disabled.");
  } else {
    console.warn("[api] DASHBOARD_PASSWORD set — password login active (set DISCORD_CLIENT_ID for Discord OAuth).");
  }
  if (!process.env.DASHBOARD_JWT_SECRET) {
    console.warn("[api] DASHBOARD_JWT_SECRET not set — using an ephemeral secret (set it for multi-instance / stable sessions).");
  }

  const app = express();

  // CORS: restrict to the dashboard origin(s). DASHBOARD_ORIGIN may be a
  // comma-separated list; if unset, allow all (dev only — warn loudly).
  const originList = (process.env.DASHBOARD_ORIGIN || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!originList.length) {
    console.warn("[api] DASHBOARD_ORIGIN not set — allowing all origins (set it to your Vercel URL in production).");
  }
  app.use(cors({
    origin: originList.length ? originList : true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));
  app.use(express.json({ limit: "1mb" }));

  // ── Security headers (no helmet dependency needed) ─────────────────────
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "0"); // deprecated but harmless; modern browsers ignore it
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.removeHeader("X-Powered-By");
    next();
  });

  // ── General API rate limiter (protects all endpoints, not just login) ──
  const apiRateMap = new Map();
  const API_RATE_MAX = 300;        // requests per window
  const API_RATE_WINDOW = 60_000;  // per 60 seconds

  function checkApiRateLimit(ip) {
    const now = Date.now();
    const entry = apiRateMap.get(ip);
    if (!entry || now - entry.windowStart > API_RATE_WINDOW) {
      apiRateMap.set(ip, { windowStart: now, count: 1 });
      return { allowed: true };
    }
    entry.count++;
    if (entry.count > API_RATE_MAX) {
      const retryAfter = Math.ceil((API_RATE_WINDOW - (now - entry.windowStart)) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  }

  // Periodic cleanup of stale rate-limit entries (every 5 minutes)
  setInterval(() => {
    const cutoff = Date.now() - API_RATE_WINDOW;
    for (const [ip, entry] of apiRateMap) {
      if (Date.now() - entry.windowStart > API_RATE_WINDOW) apiRateMap.delete(ip);
    }
  }, 5 * 60_000).unref();

  // Apply general rate limiter to all /api/* routes
  app.use("/api", (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const check = checkApiRateLimit(ip);
    if (!check.allowed) {
      return res.status(429).json({ error: `Rate limited. Try again in ${check.retryAfter}s.` });
    }
    next();
  });

  // Request timeout (30 seconds)
  app.use((req, res, next) => {
    res.setTimeout(30_000, () => {
      res.status(503).json({ error: "Request timed out" });
    });
    next();
  });

  // Global error handler (catch-all for thrown errors in routes)
  app.use((err, req, res, _next) => {
    console.error("[api] Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  // ── Simple in-memory rate limiter for login ──
  const loginAttempts = new Map();
  const LOGIN_RATE_LIMIT = 10; // max attempts
  const LOGIN_RATE_WINDOW = 60_000; // per 60 seconds

  function checkLoginRateLimit(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || now - entry.windowStart > LOGIN_RATE_WINDOW) {
      loginAttempts.set(ip, { windowStart: now, count: 1 });
      return { allowed: true };
    }
    entry.count++;
    if (entry.count > LOGIN_RATE_LIMIT) {
      const retryAfter = Math.ceil((LOGIN_RATE_WINDOW - (now - entry.windowStart)) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  }

  // Periodic cleanup of stale rate-limit entries (every 2 minutes)
  setInterval(() => {
    const cutoff = Date.now() - LOGIN_RATE_WINDOW;
    for (const [ip, entry] of loginAttempts) {
      if (Date.now() - entry.windowStart > LOGIN_RATE_WINDOW) loginAttempts.delete(ip);
    }
  }, 2 * 60_000).unref();

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload; // { sub: userId, tag, avatar, isOwner }
      return next();
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // Require bot-owner privileges (isOwner flag in JWT). Used for global/critical
  // settings that should not be managed by regular guild admins.
  function requireOwner(req, res, next) {
    if (!req.user?.isOwner) {
      return res.status(403).json({ error: "Bot owner privileges required" });
    }
    return next();
  }

  // Check if a user has access to a guild (Admin/ManageGuild). Bot owners and JWT
  // `isOwner` flags bypass (covers password fallback and bot owners).
  function userCanAccessGuild(userId, guildId, isOwner) {
    if (!userId || !guildId) return false;
    if (isOwner || OWNER_IDS.has(userId)) return true;
    const guild = resolveGuild(guildId);
    if (!guild) return false;
    const member = guild.members.cache.get(userId);
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.Administrator) ||
           member.permissions.has(PermissionFlagsBits.ManageGuild);
  }

  // Resolve a guild by ID, falling back to the first guild (backward compat).
  function resolveGuild(guildId) {
    if (!guildId) return ctx.client?.guilds?.cache?.first() || null;
    return ctx.client?.guilds?.cache?.get(guildId) || null;
  }

  // Extract guildId from a request: query string for GET, body for POST.
  function reqGuildId(req) {
    return req.query?.guildId || req.body?.guildId || null;
  }

  // List of guilds with summary info. When userId is provided, only returns guilds
  // the user has access to (Admin/ManageGuild). Bot owners see all guilds.
  function listGuilds(userId, isOwner) {
    if (!ctx.client) return [];
    const guilds = [...ctx.client.guilds.cache.values()]
      .sort((a, b) => a.name.localeCompare(b.name));

    const filtered = userId
      ? guilds.filter(g => userCanAccessGuild(userId, g.id, isOwner))
      : guilds;

    return filtered.map(g => ({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
      iconURL: g.iconURL({ size: 64 }),
    }));
  }

  // Live guild info, straight from the in-process Discord client.
  function getGuildInfo(guildId) {
    const guild = resolveGuild(guildId);
    if (!guild) return { hasGuild: false, guildId: null, guildName: null, channels: [], roles: [] };
    const channels = [...guild.channels.cache.filter(c => c.type === 0).values()].map(c => ({ id: c.id, name: c.name }));
    const roles = [...guild.roles.cache.filter(r => r.id !== guild.id && !r.managed).values()].map(r => ({ id: r.id, name: r.name }));
    return { hasGuild: true, guildId: guild.id, guildName: guild.name, channels, roles };
  }

  function channelKind(channel) {
    switch (channel.type) {
      case ChannelType.GuildText: return "Text";
      case ChannelType.GuildVoice: return "Voice";
      case ChannelType.GuildAnnouncement: return "Announcement";
      case ChannelType.GuildStageVoice: return "Stage";
      case ChannelType.GuildForum: return "Forum";
      case ChannelType.GuildMedia: return "Media";
      default: return "Channel";
    }
  }

  function sortedChannels(channels) {
    return [...channels].sort((a, b) => {
      const byParent = (a.parentId || "").localeCompare(b.parentId || "");
      if (byParent) return byParent;
      return (a.rawPosition ?? 0) - (b.rawPosition ?? 0);
    });
  }

  function getChannelInfo(guildId) {
    const guild = resolveGuild(guildId);
    if (!guild) return { hasGuild: false, guildId: null, guildName: null, categories: [], channels: [] };

    const categories = [...guild.channels.cache
      .filter(c => c.type === ChannelType.GuildCategory)
      .values()]
      .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
      .map(c => ({
        id: c.id,
        name: c.name,
        position: c.rawPosition ?? 0,
        children: guild.channels.cache.filter(ch => ch.parentId === c.id && typeof ch.lockPermissions === "function").size,
      }));

    const channels = sortedChannels(guild.channels.cache
      .filter(c => c.parentId && typeof c.lockPermissions === "function")
      .values())
      .map(c => ({
        id: c.id,
        name: c.name,
        type: channelKind(c),
        parentId: c.parentId,
        position: c.rawPosition ?? 0,
        permissionsLocked: c.permissionsLocked ?? false,
      }));

    return { hasGuild: true, guildId: guild.id, guildName: guild.name, categories, channels };
  }

  function compactSyncItems(items) {
    return items.slice(0, 50).map(item => ({
      id: item.channel?.id || item.id || null,
      name: item.channel?.name || item.name || item.label || "unknown",
      reason: item.reason || null,
    }));
  }

  function syncableCategoryChildren(guild, categoryId) {
    return sortedChannels(guild.channels.cache.filter(ch => ch.parentId === categoryId && typeof ch.lockPermissions === "function").values());
  }

  async function syncChannelPermissions(guild, targets, reason) {
    const synced = [];
    const failed = [];
    const skipped = [];

    for (const channel of targets) {
      if (!channel?.parent) {
        skipped.push({ channel, reason: "not inside a category" });
        continue;
      }
      if (typeof channel.lockPermissions !== "function") {
        skipped.push({ channel, reason: "channel type cannot sync permissions" });
        continue;
      }
      const botPerms = channel.permissionsFor(guild.members.me);
      if (!botPerms?.has(PermissionFlagsBits.ManageChannels)) {
        failed.push({ channel, reason: "bot lacks Manage Channels here" });
        continue;
      }
      try {
        const permissionOverwrites = channel.parent.permissionOverwrites.cache.map(overwrite => overwrite.toJSON());
        await channel.edit({ permissionOverwrites, reason });
        synced.push(channel);
      } catch (err) {
        failed.push({ channel, reason: err.message || "unknown error" });
      }
    }

    return { synced, failed, skipped };
  }

  // ─── Auth ──────────────────────────────────────────────────────────────
  // Password login (fallback when Discord OAuth is not configured)
  app.post("/login", (req, res) => {
    if (!PASSWORD) return res.status(501).json({ error: "Password login not configured" });
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const rateCheck = checkLoginRateLimit(ip);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: `Too many attempts. Retry in ${rateCheck.retryAfter}s.` });
    }
    if (!passwordMatches(req.body?.password ?? "", PASSWORD)) {
      return res.status(401).json({ error: "Wrong password" });
    }
    // Password users get full access (isOwner=true) since they share the single password
    const token = jwt.sign({ sub: "password-session", tag: "Admin (Password)", avatar: null, isOwner: true }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    res.json({ ok: true, token });
  });

  // Discord OAuth — redirect user to Discord's consent screen
  app.get("/api/auth/discord", (req, res) => {
    if (!HAS_DISCORD_OAUTH) {
      return res.status(501).json({ error: "Discord OAuth not configured" });
    }
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", DISCORD_CLIENT_ID);
    url.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify guilds");
    res.redirect(url.toString());
  });

  // Discord OAuth callback — exchange code for token, fetch user, issue JWT
  app.get("/api/auth/discord/callback", async (req, res) => {
    const { code, error: oauthError } = req.query;
    const dashOrigin = originList[0] || "http://0.0.0.0:5173";

    if (oauthError || !code) {
      return res.redirect(`${dashOrigin}?error=${encodeURIComponent(oauthError || "No authorization code received")}`);
    }

    try {
      // Exchange authorization code for access token
      const tokRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
      });
      const tokData = await tokRes.json();
      if (!tokRes.ok) throw new Error(tokData.error_description || `Token exchange failed (${tokRes.status})`);

      const accessToken = tokData.access_token;

      // Fetch user info
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = await userRes.json();
      if (!userRes.ok) throw new Error("Failed to fetch Discord user");

      const isOwner = OWNER_IDS.has(user.id);
      const tag = user.discriminator && user.discriminator !== "0"
        ? `${user.username}#${user.discriminator}`
        : user.global_name || user.username;

      const token = jwt.sign(
        { sub: user.id, tag, avatar: user.avatar, isOwner },
        JWT_SECRET,
        { expiresIn: TOKEN_TTL }
      );

      console.log(`[api] Discord OAuth login: ${tag} (${user.id}) isOwner=${isOwner}`);
      res.redirect(`${dashOrigin}?token=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error("[api] Discord OAuth callback error:", err.message);
      res.redirect(`${dashOrigin}?error=${encodeURIComponent(err.message)}`);
    }
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({
      ok: true,
      user: {
        id: req.user.sub,
        tag: req.user.tag,
        avatar: req.user.avatar,
        isOwner: req.user.isOwner,
      },
      guilds: listGuilds(req.user.sub, req.user.isOwner),
    });
  });

  // ─── Guilds (multi-guild selector) ─────────────────────────────────────
  app.get("/api/guilds", requireAuth, (req, res) => {
    res.json({ guilds: listGuilds(req.user.sub, req.user.isOwner) });
  });

  // ─── Status ────────────────────────────────────────────────────────────
  app.get("/api/status", requireAuth, (req, res) => {
    const client = ctx.client;
    if (!client || !client.user) {
      return res.json({ online: false, ping: 0, guilds: 0, users: 0, uptimeMs: 0, tag: "Offline", activity: null });
    }
    const activity = client.user.presence?.activities?.[0] ?? null;

    // Memory usage — system RAM (not just V8 heap)
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryUsedMb = Math.round((totalMem - freeMem) / 1024 / 1024);
    const memoryTotalMb = Math.round(totalMem / 1024 / 1024);

    // CPU load averages (1, 5, 15 min) and process uptime
    const cpuLoad = os.loadavg(); // [1min, 5min, 15min]
    const cpuCount = os.cpus().length;
    const processUptimeSec = Math.round(process.uptime());
    const nodeRuntime = {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    };

    // Active AI conversations (approximate from thread buffer size)
    let activeAiConversations = 0;
    try {
      const ai = require("../ai");
      activeAiConversations = typeof ai.getActiveConvoCount === "function" ? ai.getActiveConvoCount() : 0;
    } catch { /* ignore */ }

    // Commands per minute (rolling window)
    const cmdRate = typeof ctx.commandRate === "function" ? ctx.commandRate() : 0;

    res.json({
      online:   true,
      tag:      client.user.tag,
      uptimeMs: client.uptime ?? 0,
      ping:     Math.round(client.ws.ping || 0),
      guilds:   client.guilds.cache.size,
      users:    client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
      memoryUsedMb,
      memoryTotalMb,
      cpuLoad: { load1: cpuLoad[0], load5: cpuLoad[1], load15: cpuLoad[2], cpuCount },
      processUptimeSec,
      nodeRuntime,
      activeAiConversations,
      commandsPerMin: cmdRate,
      activity: activity ? { name: activity.name, type: activity.type } : null,
    });
  });

  // ─── Presence ──────────────────────────────────────────────────────────
  app.post("/api/presence", requireAuth, requireOwner, (req, res) => {
    const { text, type } = req.body || {};
    if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text required" });
    const t = Number.isInteger(type) ? type : 3;
    if (!ctx.client?.user) return res.status(503).json({ error: "Bot is offline" });
    try {
      ctx.client.user.setActivity(text, { type: t });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Settings (owner-only — global bot configuration) ───────────────────
  app.get("/api/settings", requireAuth, requireOwner, (req, res) => {
    res.json({ settings: getBotSettings(), defaults: settings.DEFAULTS });
  });

  app.post("/api/settings", requireAuth, requireOwner, (req, res) => {
    let { key, value } = req.body || {};
    if (typeof key !== "string" || !(key in settings.DEFAULTS))
      return res.status(400).json({ error: "Unknown setting key" });
    if (AI_SETTING_KEYS.has(key))
      return res.status(400).json({ error: "Use the AI tab to change this setting" });
    if (typeof value !== "string")
      return res.status(400).json({ error: "value must be a string" });
    // Normalise boolean-like strings to actual booleans so consumers
    // don't have to write `mm === true || mm === "true"` everywhere.
    if (value === "true") value = true;
    else if (value === "false") value = false;
    if (key === "prefix" && typeof value === "string" && (value.length < 1 || value.length > 3))
      return res.status(400).json({ error: "prefix must be 1–3 characters" });
    settings.set(key, value);
    res.json({ ok: true, settings: getBotSettings() });
  });

  app.post("/api/settings/reset", requireAuth, requireOwner, (req, res) => {
    for (const [k, v] of Object.entries(settings.DEFAULTS)) settings.set(k, v);
    res.json({ ok: true, settings: getBotSettings() });
  });

  // ─── AI (owner-only — global AI configuration) ─────────────────────────
  app.get("/api/ai", requireAuth, requireOwner, async (req, res) => {
    try {
      res.json(await ai.getPublicSettingsAsync());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ai", requireAuth, requireOwner, (req, res) => {
    try {
      ai.updateSettings(req.body || {});
      res.json({ ok: true, ...ai.getPublicSettings() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── AI Memories ────────────────────────────────────────────────────────
  app.get("/api/ai/memories", requireAuth, (req, res) => {
    try {
      const guildInfo = getGuildInfo(reqGuildId(req));
      const guildId = guildInfo.guildId;
      if (!guildId) {
        return res.json({ memories: [] });
      }
      if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
      const aiMemory = require("../ai/memory");
      const guild = resolveGuild(guildId);
      const raw = aiMemory.forGuild(guildId);
      // Enrich with cached display names from the Discord guild member cache
      const memories = raw.map(m => {
        let displayName = null;
        if (m.userId && guild) {
          const member = guild.members.cache.get(m.userId);
          if (member) displayName = member.displayName || member.user?.username || null;
        }
        return { ...m, displayName };
      });
      res.json({ memories });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ai/memories", requireAuth, async (req, res) => {
    try {
      const guildInfo = getGuildInfo(reqGuildId(req));
      const guildId = guildInfo.guildId;
      if (!guildId) {
        return res.status(400).json({ error: "Bot is not in any guild yet" });
      }
      if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
      const { userId, content } = req.body || {};
      if (!content) {
        return res.status(400).json({ error: "Missing content" });
      }
      const aiMemory = require("../ai/memory");
      const mem = await aiMemory.add(guildId, userId || null, content);
      res.json({ ok: true, memory: mem });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/ai/memories/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const aiMemory = require("../ai/memory");
      const deleted = await aiMemory.forget(id);
      if (!deleted) {
        return res.status(404).json({ error: "Memory not found" });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── AI Chat (SSE streaming endpoint) ────────────────────────────────────
  // Owner-only — streams AI responses token-by-token with a typewriter effect.
  app.post("/api/ai/chat", requireAuth, requireOwner, async (req, res) => {
    const { message, thinkingEnabled, guildId } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!settings.get("aiEnabled")) {
      return res.status(503).json({ error: "AI is currently disabled" });
    }

    // Set up SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    });

    const send = (data) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { chatWithProvider, parseFallbackList, cleanResponse, splitMessage } = require("../ai");
      const system = settings.get("aiSystemPrompt") || "You are a helpful assistant.";
      const messages = [
        { role: "system", content: system },
        { role: "user", content: `[Dashboard Admin]: ${message.trim()}` },
      ];

      const primaryId = settings.get("aiProvider") || "groq";
      const fallbackIds = parseFallbackList(settings.get("aiFallbackProviders"));
      const providerIds = [primaryId, ...fallbackIds].filter((id, i, arr) => arr.indexOf(id) === i);

      const result = await chatWithProvider(providerIds, messages);
      const response = result.result;
      const think = thinkingEnabled !== false;

      let fullText = "";

      if (typeof response === "string") {
        fullText = cleanResponse(response, think);
      } else {
        const { text } = response;
        fullText = cleanResponse(text || "", think);
      }

      if (!fullText) {
        send({ type: "error", error: "The AI returned an empty response." });
      } else {
        // Stream the response in small chunks with a typewriter effect
        const chunkSize = 3;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          const chunk = fullText.slice(i, i + chunkSize);
          send({ type: "token", text: chunk });
          // Small delay for typewriter feel (faster for longer texts)
          await new Promise(r => setTimeout(r, 15 + Math.random() * 10));
        }
        send({ type: "done", fullText });
      }
    } catch (err) {
      console.error("[api] AI chat error:", err.message);
      send({ type: "error", error: err.message });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // ─── AI Conversations (memories formatted as conversation history) ────────
  app.get("/api/ai/conversations", requireAuth, async (req, res) => {
    try {
      const guildInfo = getGuildInfo(reqGuildId(req));
      const guildId = guildInfo.guildId;
      if (!guildId) return res.json({ conversations: [] });
      if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) {
        return res.status(403).json({ error: "You don't have access to this guild" });
      }
      const aiMemory = require("../ai/memory");
      const memories = aiMemory.forGuild(guildId);
      // Sort most recent first, limit to 50
      const sorted = memories.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 50);
      res.json({ conversations: sorted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Feature categories ──────────────────────────────────────────────────
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

  // ─── Per-command config ──────────────────────────────────────────────────
  app.get("/api/commands", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (guildId && !userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
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
    res.json({
      guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
      permLevels: config.PERM_ORDER,
      permLabels: config.PERM_LABELS,
      channels: guildInfo.channels,
      roles: guildInfo.roles,
      commands,
    });
  });

  app.post("/api/commands/:name", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
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

  // ─── Channel permission sync ─────────────────────────────────────────────
  app.get("/api/channels", requireAuth, (req, res) => {
    const guildId = reqGuildId(req);
    if (guildId && !userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
    res.json(getChannelInfo(guildId));
  });

  app.post("/api/channels/sync", requireAuth, async (req, res) => {
    const guildId = reqGuildId(req);
    const guild = resolveGuild(guildId);
    if (!guild) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return res.status(403).json({ error: "Bot needs Manage Channels" });
    }

    const body = req.body || {};
    const scope = typeof body.scope === "string" ? body.scope : "category";
    const reasonText = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 400)
      : "Dashboard sync";
    const reason = `Dashboard permission sync: ${reasonText}`.slice(0, 512);
    const targets = new Map();
    const skipped = [];

    if (scope === "all") {
      for (const channel of sortedChannels(guild.channels.cache.filter(ch => ch.parentId && typeof ch.lockPermissions === "function").values())) {
        targets.set(channel.id, channel);
      }
    } else if (scope === "category") {
      const categoryId = String(body.categoryId || "");
      const category = guild.channels.cache.get(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        return res.status(400).json({ error: "Valid category required" });
      }
      const children = syncableCategoryChildren(guild, category.id);
      if (!children.length) skipped.push({ id: category.id, name: category.name, reason: "category has no child channels" });
      for (const channel of children) targets.set(channel.id, channel);
    } else if (scope === "selected") {
      const channelIds = Array.isArray(body.channelIds) ? body.channelIds : [];
      for (const id of channelIds.filter(x => /^\d{17,20}$/.test(String(x)))) {
        const channel = guild.channels.cache.get(String(id));
        if (!channel) {
          skipped.push({ id: String(id), name: String(id), reason: "channel not found" });
          continue;
        }
        targets.set(channel.id, channel);
      }
      if (!targets.size && !skipped.length) {
        return res.status(400).json({ error: "Select at least one channel" });
      }
    } else {
      return res.status(400).json({ error: "Unknown scope" });
    }

    const result = await syncChannelPermissions(guild, [...targets.values()], reason);
    const mergedSkipped = [...skipped, ...result.skipped];
    res.json({
      ok: true,
      total: result.synced.length + result.failed.length + mergedSkipped.length,
      synced: compactSyncItems(result.synced.map(channel => ({ channel }))),
      failed: compactSyncItems(result.failed),
      skipped: compactSyncItems(mergedSkipped),
      counts: {
        synced: result.synced.length,
        failed: result.failed.length,
        skipped: mergedSkipped.length,
      },
      channels: getChannelInfo(guild.id).channels,
    });
  });

  // ─── Automod ─────────────────────────────────────────────────────────────
  app.get("/api/automod", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (guildInfo.guildId && !userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
    res.json({
      guildId: guildInfo.guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
      channels: guildInfo.channels,
      roles: guildInfo.roles,
      config: guildInfo.guildId ? automod.getConfig(guildInfo.guildId) : automod.getConfig("_none"),
    });
  });

  app.post("/api/automod", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });    const body = req.body || {};
    const patch = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.logChannelId === null || /^\d{17,20}$/.test(body.logChannelId || "")) patch.logChannelId = body.logChannelId || null;
    if (Array.isArray(body.ignoredChannels)) patch.ignoredChannels = body.ignoredChannels.filter(x => /^\d{17,20}$/.test(x));
    if (Array.isArray(body.ignoredRoles))    patch.ignoredRoles    = body.ignoredRoles.filter(x => /^\d{17,20}$/.test(x));
    if (body.rules && typeof body.rules === "object") patch.rules = body.rules;
    const next = automod.setConfig(guildId, patch);
    res.json({ ok: true, config: next });
  });

  // ─── Welcome / leave / logs ──────────────────────────────────────────────
  app.get("/api/greet", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (guildInfo.guildId && !userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
    res.json({
      guildId: guildInfo.guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
      channels: guildInfo.channels,
      config: guildInfo.guildId ? greet.getConfig(guildInfo.guildId) : greet.getConfig("_none"),
    });
  });

  app.post("/api/greet", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const b = req.body || {};
    const clean = {};
    const okChan = v => v === null || /^\d{17,20}$/.test(v || "");
    if (b.welcome) clean.welcome = {
      enabled: !!b.welcome.enabled,
      channelId: okChan(b.welcome.channelId) ? (b.welcome.channelId || null) : null,
      message: String(b.welcome.message || "").slice(0, 1500),
      embedColor: String(b.welcome.embedColor || "#57f287").slice(0, 7),
      imageUrl: String(b.welcome.imageUrl || "").slice(0, 500),
      authorName: String(b.welcome.authorName || "").slice(0, 256),
      title: String(b.welcome.title || "").slice(0, 256),
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

  // ─── Roles (autorole + reaction-role viewer) ─────────────────────────────
  app.get("/api/roles", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (guildInfo.guildId && !userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
    const g = guildInfo.guildId ? roles.getGuild(guildInfo.guildId) : { autoroles: [], reactionRoles: {} };
    res.json({
      guildId: guildInfo.guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
      roles: guildInfo.roles,
      autoroles: g.autoroles,
      reactionRoles: g.reactionRoles,
    });
  });

  app.post("/api/roles/autoroles", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    if (!Array.isArray(req.body?.autoroles)) return res.status(400).json({ error: "autoroles must be an array" });
    const next = roles.setAutoroles(guildId, req.body.autoroles);
    res.json({ ok: true, autoroles: next });
  });

  app.post("/api/roles/reaction/remove", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const { messageId, key } = req.body || {};
    if (!messageId || !key) return res.status(400).json({ error: "messageId and key required" });
    roles.removeReactionRole(guildId, messageId, key);
    res.json({ ok: true });
  });

  // ─── Modules (owner-only — executes arbitrary JS on the bot) ────────────
  // NOTE: this lets an authenticated client write JS the bot will execute. Keep
  // DASHBOARD_PASSWORD strong and DASHBOARD_ORIGIN locked to your dashboard.
  app.get("/api/modules", requireAuth, requireOwner, (req, res) => {
    ensureModulesDir();
    const files = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith(".js"));
    const list = files.map(f => {
      const name = f.replace(/\.js$/, "");
      return { name, loaded: ctx.commandMap.has(name) };
    });
    res.json({ modules: list });
  });

  app.get("/api/modules/:name", requireAuth, requireOwner, (req, res) => {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: "Invalid module name" });
    const filePath = path.join(MODULES_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    res.json({ name, code: fs.readFileSync(filePath, "utf8"), loaded: ctx.commandMap.has(name) });
  });

  app.post("/api/modules", requireAuth, requireOwner, (req, res) => {
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
      if (existed) fs.writeFileSync(filePath, backup, "utf8");
      else if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch {} }
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/modules/:name/reload", requireAuth, requireOwner, (req, res) => {
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

  app.delete("/api/modules/:name", requireAuth, requireOwner, (req, res) => {
    const { name } = req.params;
    if (!NAME_RE.test(name)) return res.status(400).json({ error: "Invalid module name" });
    const filePath = path.join(MODULES_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });

    fs.unlinkSync(filePath);
    try { delete require.cache[require.resolve(filePath)]; } catch {}
    ctx.commandMap.delete(name);
    res.json({ ok: true });
  });

  // ─── Data stores (owner-only — read-only view of all in-memory state) ──
  app.get("/api/data/:store", requireAuth, requireOwner, async (req, res) => {
    const { store } = req.params;
    if (!DATA_STORES.includes(store)) return res.status(400).json({ error: "Unknown store" });
    try { await ctx.data.load(); } catch (err) { return res.status(500).json({ error: err.message }); }
    res.json({ store, data: ctx.data[store] ?? {} });
  });

  // ─── Dangerzone — Trap Channel Config ─────────────────────────────────────
  app.get("/api/dangerzone", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (guildInfo.guildId && !userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
    res.json({
      guildId: guildInfo.guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
      channels: guildInfo.channels,
      roles: guildInfo.roles,
      config: guildInfo.guildId ? dangerzone.getConfig(guildInfo.guildId) : { channels: {} },
    });
  });

  app.post("/api/dangerzone", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });

    const { channelId, action, timeoutMs, logChannelId, exemptRoles, reason } = req.body || {};
    if (!channelId) return res.status(400).json({ error: "channelId required" });

    dangerzone.addChannel(guildId, channelId, {
      action: action || "kick",
      timeoutMs: timeoutMs || 5 * 60_000,
      logChannelId: logChannelId || null,
      exemptRoles: exemptRoles || [],
      reason: reason || "Dangerzone: message sent in monitored channel",
    });

    res.json({ ok: true, config: dangerzone.getConfig(guildId) });
  });

  app.post("/api/dangerzone/remove", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });

    const { channelId } = req.body || {};
    if (!channelId) return res.status(400).json({ error: "channelId required" });

    dangerzone.removeChannel(guildId, channelId);
    res.json({ ok: true });
  });

  // ─── Extended Automod ─────────────────────────────────────────────────────
  app.get("/api/automod/extended", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ config: {} });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    res.json({ config: automod.getExtendedConfig(guildInfo.guildId) });
  });

  app.post("/api/automod/extended", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const next = automod.setExtendedConfig(guildInfo.guildId, req.body || {});
    res.json({ ok: true, config: next });
  });

  // ─── Moderation Log ──────────────────────────────────────────────────────
  app.get("/api/modlog", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ entries: [] });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const limit = parseInt(req.query.limit, 10) || 100;
    try {
      const db = require("../db");
      const entries = await db.getModLog(guildInfo.guildId, Math.min(limit, 500));
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/modlog/:userId", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ entries: [] });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const db = require("../db");
      const entries = await db.getModLogForUser(guildInfo.guildId, req.params.userId, 50);
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── DM Templates ────────────────────────────────────────────────────────
  app.get("/api/dm-templates", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ templates: {} });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const db = require("../db");
      const rows = await db.getAllDmTemplates(guildInfo.guildId);
      const templates = {};
      for (const row of rows) {
        templates[row.action] = { message: row.message, enabled: row.enabled === 1 };
      }
      res.json({ templates });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/dm-templates", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const { action, message, enabled } = req.body || {};
    if (!action) return res.status(400).json({ error: "action required" });
    try {
      const db = require("../db");
      await db.setDmTemplate(guildInfo.guildId, action, message || "", enabled !== false);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Mod Notes ───────────────────────────────────────────────────────────
  app.get("/api/modnotes/:userId", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ notes: [] });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const db = require("../db");
      const notes = await db.getModNotes(guildInfo.guildId, req.params.userId);
      res.json({ notes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/modnotes/:userId", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: "content required" });
    try {
      const db = require("../db");
      await db.addModNote(guildInfo.guildId, req.params.userId, content, req.body.by || "dashboard", Date.now());
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/modnotes/:id", requireAuth, async (req, res) => {
    try {
      const db = require("../db");
      await db.deleteModNote(parseInt(req.params.id, 10));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Server Backups ─────────────────────────────────────────────────────
  app.get("/api/backup", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ backups: [] });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const backupMod = require("../backup");
      const rows = await backupMod.get(guildInfo.guildId);
      // Return counts without full data JSON (for list view performance)
      res.json({ backups: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/backup", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    const guild = resolveGuild(guildInfo.guildId);
    if (!guild) return res.status(400).json({ error: "Guild not found" });
    try {
      const backupMod = require("../backup");
      const name = (req.body?.name || `Backup ${new Date().toLocaleDateString()}`).slice(0, 100);
      const result = await backupMod.create(guild, name, req.user.tag);
      res.json({ ok: true, backup: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/backup/:id", requireAuth, async (req, res) => {
    try {
      const backupMod = require("../backup");
      const entry = await backupMod.getById(parseInt(req.params.id, 10));
      if (!entry) return res.status(404).json({ error: "Backup not found" });
      // Verify guild access
      const guildInfo = getGuildInfo(reqGuildId(req));
      if (guildInfo.guildId && entry.guild_id !== guildInfo.guildId)
        return res.status(403).json({ error: "You don't have access to this backup" });
      if (guildInfo.guildId && !userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
        return res.status(403).json({ error: "You don't have access to this guild" });
      res.json({ backup: entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/backup/:id/restore", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    const guild = resolveGuild(guildInfo.guildId);
    if (!guild) return res.status(400).json({ error: "Guild not found" });
    try {
      const backupMod = require("../backup");
      const entry = await backupMod.getById(parseInt(req.params.id, 10));
      if (!entry) return res.status(404).json({ error: "Backup not found" });
      const result = await backupMod.restoreGuild(guild, entry.data);
      res.json({ ok: true, log: result.log.slice(0, 50), summary: result.summary });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/backup/:id", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const backupMod = require("../backup");
      await backupMod.remove(parseInt(req.params.id, 10));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Scheduled Messages ───────────────────────────────────────────────────
  app.get("/api/schedule", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ schedules: [], channels: [] });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    const schedMod = require("../scheduler");
    res.json({
      schedules: schedMod.getForGuild(guildInfo.guildId),
      channels: guildInfo.channels,
      guildId: guildInfo.guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
    });
  });

  app.post("/api/schedule", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    const { channelId, content, scheduledAt, recurrence, embedJson } = req.body || {};
    if (!channelId || !content || !scheduledAt)
      return res.status(400).json({ error: "channelId, content, and scheduledAt are required" });
    const iso = new Date(scheduledAt);
    if (isNaN(iso.getTime()) || iso <= new Date())
      return res.status(400).json({ error: "scheduledAt must be a valid future ISO datetime" });
    try {
      const schedMod = require("../scheduler");
      const entry = await schedMod.create(
        guildInfo.guildId, channelId, content.slice(0, 2000),
        iso.toISOString(), recurrence || null,
        req.user.tag, embedJson || null
      );
      res.json({ ok: true, schedule: entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/schedule/:id", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const schedMod = require("../scheduler");
      await schedMod.remove(parseInt(req.params.id, 10));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Auto-Execute Rules Engine ───────────────────────────────────────────
  app.get("/api/autoexec", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ rules: [] });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const db = require("../db");
      const rules = await db.getAutoExecRules(guildInfo.guildId);
      res.json({ rules: rules.map(r => ({ ...r, conditions: JSON.parse(r.conditions), actions: JSON.parse(r.actions) })) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/autoexec", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const rule = req.body || {};
    if (!rule.trigger_event) return res.status(400).json({ error: "trigger_event required" });
    try {
      const db = require("../db");
      const info = await db.setAutoExecRule(guildInfo.guildId, rule);
      // Invalidate runtime cache so the new rule applies immediately
      const autoexec = require("../autoexec");
      await autoexec.reloadGuild(guildInfo.guildId);
      res.json({ ok: true, id: info?.lastInsertRowid || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/autoexec/:id", requireAuth, async (req, res) => {
    try {
      const db = require("../db");
      await db.deleteAutoExecRule(parseInt(req.params.id, 10));
      // Invalidate runtime cache — reload all guilds (we don't know which guild the rule belonged to)
      const autoexec = require("../autoexec");
      await autoexec.reload();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Role Members (listroles view) ──────────────────────────────────────
  app.get("/api/roles/members", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) {
      return res.json({ roles: [], hasGuild: false });
    }
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const guild = resolveGuild(guildInfo.guildId);
    if (!guild) return res.json({ roles: [], hasGuild: false });

    const roleIds = (req.query.roleIds || "").split(",").map(s => s.trim()).filter(Boolean);
    const roles = roleIds
      .map(id => guild.roles.cache.get(id))
      .filter(Boolean)
      .sort((a, b) => b.position - a.position)
      .map(role => ({
        id: role.id,
        name: role.name,
        color: role.hexColor,
        memberCount: role.members.size,
        members: [...role.members.values()]
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map(m => ({
            id: m.id,
            username: m.user.username,
            displayName: m.displayName,
            avatarURL: m.user.displayAvatarURL({ size: 64 }),
            tag: m.user.tag,
            isBot: m.user.bot,
          })),
      }));

    res.json({
      hasGuild: true,
      guildId: guildInfo.guildId,
      guildName: guildInfo.guildName,
      roles,
    });
  });

  // ─── Probation ───────────────────────────────────────────────────────────
  app.get("/api/probation", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ probations: [] });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const db = require("../db");
      const rows = await db.getAllProbations();
      const filtered = rows.filter(r => r.guild_id === guildInfo.guildId);
      res.json({ probations: filtered });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/probation/:userId", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const db = require("../db");
      await db.removeProbation(guildInfo.guildId, req.params.userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── AI Analytics ─────────────────────────────────────────────────────────
  app.get("/api/ai/analytics", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      const guildId = reqGuildId(req) || ctx.client?.guilds?.cache?.first?.()?.id;
      const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
      if (!guildId) return res.json({ stats: [], topUsers: [] });
      const stats = await db.getAiAnalytics(guildId, days);
      const topUsers = await db.getAiTopUsers(guildId, days, 10);
      const daily = await db.getAiDailyAnalytics(guildId, days);
      res.json({ stats, topUsers, daily, days });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── AI Personalities ─────────────────────────────────────────────────────
  app.get("/api/ai/personalities", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      res.json({ personalities: await db.getPersonalities() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ai/personalities", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      const { name, prompt } = req.body || {};
      if (!name || !prompt) return res.status(400).json({ error: "name and prompt required" });
      const id = await db.addPersonality(name, prompt);
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/ai/personalities/:id", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      await db.deletePersonality(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Economy ──────────────────────────────────────────────────────────────
  app.get("/api/economy/leaderboard", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ leaderboard: [], hasGuild: false });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const economy = require("../economy");
      const lb = await economy.leaderboard(guildInfo.guildId, 20);
      const guild = resolveGuild(guildInfo.guildId);
      const enriched = lb.map(row => {
        let displayName = row.user_id;
        if (guild) {
          const member = guild.members.cache.get(row.user_id);
          if (member) displayName = member.displayName || member.user?.username || row.user_id;
        }
        return { ...row, displayName };
      });
      res.json({ leaderboard: enriched, guildId: guildInfo.guildId, hasGuild: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    const schedCount = (() => { try { return require("../scheduler").count(); } catch { return 0; } })();
    console.log(`[api] Bot dashboard API on http://0.0.0.0:${PORT} (${schedCount} schedules loaded)`);
  });
}

module.exports = { startApi };
