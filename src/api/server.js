const express = require("express");
const https   = require("https");
const cors    = require("cors");
const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const fs      = require("fs");
const os      = require("os");
const path    = require("path");
const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getProvider } = require("../ai/providers");

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
  "nvidiaApiKey", "nvidiaModel", "nvidiaBaseUrl",
  "deepseekApiKey", "deepseekModel",
  "togetherApiKey", "togetherModel",
  "requestyApiKey", "requestyModel",
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
const COMMAND_ALIAS_RE = /^[a-z0-9_-]{1,32}$/;

function passwordMatches(input, expected) {
  if (typeof input !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function startApi(ctx) {
  const PASSWORD = process.env.DASHBOARD_PASSWORD;
  // Port resolution: API_PORT → PORT → SERVER_PORT (injected by Pterodactyl) → 3432
  const PORT = parseInt(process.env.API_PORT, 10) || parseInt(process.env.PORT, 10) || parseInt(process.env.SERVER_PORT, 10) || 3432;

  // Command rate tracking (rolling window for dashboard display)
  const cmdTimes = [];
  const CMD_TIMES_MAX_SIZE = 1000; // Maximum number of command timestamps to track
  ctx.commandRate = () => {
    const now = Date.now();
    const cutoff = now - 60_000;
    while (cmdTimes.length && cmdTimes[0] < cutoff) cmdTimes.shift();
    return cmdTimes.length;
  };
  ctx.trackCommand = () => {
    cmdTimes.push(Date.now());
    // Size-based eviction: if we exceed max size, remove oldest entries
    if (cmdTimes.length > CMD_TIMES_MAX_SIZE) {
      cmdTimes.splice(0, cmdTimes.length - CMD_TIMES_MAX_SIZE);
    }
  };
  // Periodic cleanup to ensure array doesn't grow unbounded (every 5 minutes)
  setInterval(() => {
    const now = Date.now();
    const cutoff = now - 60_000;
    while (cmdTimes.length && cmdTimes[0] < cutoff) cmdTimes.shift();
  }, 5 * 60_000).unref();    // JWT secret - required in production for stable sessions across restarts
    let JWT_SECRET = process.env.DASHBOARD_JWT_SECRET;
    if (!JWT_SECRET) {
      if (process.env.NODE_ENV === "production") {
        console.error("[api] DASHBOARD_JWT_SECRET is required in production. Set it to a stable 64-character hex string.");
        console.error("[api] Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
        return; // Disable API if no secret in production
      }
      JWT_SECRET = crypto.randomBytes(32).toString("hex");
      console.warn("[api] DASHBOARD_JWT_SECRET not set - using ephemeral secret (tokens will be invalidated on restart). Set it for production.");
    }
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
  app.set('trust proxy', 1);

  // Check if the dashboard is built and can be served locally (same-origin).
  // This is checked early so we can relax the DASHBOARD_ORIGIN requirement:
  // same-origin requests don't need CORS at all.
  const dashboardPath = path.resolve(__dirname, "../../dashboard-v2/dist");
  const servingDashboard = fs.existsSync(dashboardPath);

  // CORS: restrict to the dashboard origin(s). DASHBOARD_ORIGIN may be a
  // comma-separated list; required in production when the dashboard is NOT
  // served from the same origin (e.g. hosted on Vercel).
  const originList = (process.env.DASHBOARD_ORIGIN || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!originList.length) {
    if (process.env.NODE_ENV === "production" && !servingDashboard) {
      console.error("[api] DASHBOARD_ORIGIN is required in production for CORS security. Set it to your dashboard URL(s).");
      console.error("[api] Example: DASHBOARD_ORIGIN=https://your-dashboard.vercel.app,https://localhost:5173");
      return; // Disable API if no origin whitelist in production
    }
    if (servingDashboard) {
      console.log("[api] Dashboard served locally — CORS not needed for same-origin requests.");
    } else {
      console.warn("[api] DASHBOARD_ORIGIN not set — allowing all origins (DEV ONLY). Set it for production.");
    }
  }
  app.use(cors({
    origin: originList.length ? originList : true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
  const API_RATE_MAX_SIZE = 1000;  // Maximum number of IPs to track

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
    // Size-based eviction: if we exceed max size, remove oldest entries
    if (apiRateMap.size > API_RATE_MAX_SIZE) {
      const entries = Array.from(apiRateMap.entries()).sort((a, b) => a[1].windowStart - b[1].windowStart);
      const toRemove = entries.slice(0, apiRateMap.size - API_RATE_MAX_SIZE);
      for (const [ip] of toRemove) apiRateMap.delete(ip);
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

  // ── Simple in-memory rate limiter for login ──
  const loginAttempts = new Map();
  const LOGIN_RATE_LIMIT = 10; // max attempts
  const LOGIN_RATE_WINDOW = 60_000; // per 60 seconds
  const LOGIN_RATE_MAX_SIZE = 500; // Maximum number of IPs to track

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
    // Size-based eviction: if we exceed max size, remove oldest entries
    if (loginAttempts.size > LOGIN_RATE_MAX_SIZE) {
      const entries = Array.from(loginAttempts.entries()).sort((a, b) => a[1].windowStart - b[1].windowStart);
      const toRemove = entries.slice(0, loginAttempts.size - LOGIN_RATE_MAX_SIZE);
      for (const [ip] of toRemove) loginAttempts.delete(ip);
    }
  }, 2 * 60_000).unref();

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    if (!JWT_SECRET) {
      return res.status(500).json({ error: "Server configuration error" });
    }
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
      icon: g.icon,
      channelCount: g.channels.cache.size,
      roleCount: Math.max(0, g.roles.cache.size - 1), // exclude @everyone
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
    if (!JWT_SECRET) {
      return res.status(500).json({ error: "Server configuration error - JWT secret not set" });
    }
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

  // OAuth state store for CSRF protection
  const oauthStateStore = new Map();
  const OAUTH_STATE_TTL = 600_000; // 10 minutes
  const OAUTH_STATE_MAX_SIZE = 200; // Maximum number of OAuth states to track

  // Discord OAuth — redirect user to Discord's consent screen
  app.get("/api/auth/discord", (req, res) => {
    if (!HAS_DISCORD_OAUTH) {
      return res.status(501).json({ error: "Discord OAuth not configured" });
    }
    const state = crypto.randomBytes(16).toString("hex");
    oauthStateStore.set(state, { createdAt: Date.now() });
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("client_id", DISCORD_CLIENT_ID);
    url.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify guilds");
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  // Periodic cleanup of expired OAuth states
  setInterval(() => {
    const cutoff = Date.now() - OAUTH_STATE_TTL;
    for (const [s, entry] of oauthStateStore) {
      if (entry.createdAt < cutoff) oauthStateStore.delete(s);
    }
    // Size-based eviction: if we exceed max size, remove oldest entries
    if (oauthStateStore.size > OAUTH_STATE_MAX_SIZE) {
      const entries = Array.from(oauthStateStore.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toRemove = entries.slice(0, oauthStateStore.size - OAUTH_STATE_MAX_SIZE);
      for (const [s] of toRemove) oauthStateStore.delete(s);
    }
  }, 120_000).unref();

  // Discord OAuth callback — exchange code for token, fetch user, issue JWT
  app.get("/api/auth/discord/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    const dashOrigin = originList[0] || "http://0.0.0.0:5173";

    if (oauthError || !code) {
      return res.redirect(`${dashOrigin}#error=${encodeURIComponent(oauthError || "No authorization code received")}`);
    }

    // Verify state to prevent CSRF
    if (!state || !oauthStateStore.has(state)) {
      return res.redirect(`${dashOrigin}#error=${encodeURIComponent("Invalid OAuth state — try logging in again")}`);
    }
    oauthStateStore.delete(state);

    if (!JWT_SECRET) {
      return res.redirect(`${dashOrigin}#error=${encodeURIComponent("Server configuration error - JWT secret not set")}`);
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
      res.redirect(`${dashOrigin}#token=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error("[api] Discord OAuth callback error:", err.message);
      res.redirect(`${dashOrigin}#error=${encodeURIComponent(err.message)}`);
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
      prefix:   settings.get("prefix") || "$",
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
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM ai_memories WHERE id = ?", Number(req.params.id));
      if (!row || !userCanAccessGuild(req.user.sub, row.guild_id, req.user.isOwner))
        return res.status(404).json({ error: "Not found" });
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

  // Bulk-memory wiper. Owner-only since it can drop every learned fact.
  // Body shape: { guildId?, scope: "all" | "server" | "user", userId? }
  //   - scope="all"   → wipe every memory (across all guilds) that matches guildId (if any)
  //   - scope="server"→ wipe only `user_id IS NULL` rows (server-wide context)
  //   - scope="user"  → wipe only that user's memories (userId required)
  //
  // ⚠️ scope="all" with no guildId wipes EVERY guild's ai_memories rows in one
  //    shot. Owner-only is the only safeguard; intentional, worth knowing
  //    when wiring UI affordances to this endpoint.
  app.post("/api/ai/memories/clear", requireAuth, requireOwner, async (req, res) => {
    try {
      const { scope, userId, guildId: bodyGuild } = req.body || {};
      if (!["all", "server", "user"].includes(scope)) {
        return res.status(400).json({ error: "scope must be all|server|user" });
      }
      if (scope === "user" && !(userId && String(userId).trim())) {
        return res.status(400).json({ error: "userId required when scope=user" });
      }
      const db = require("../db");
      let userFilter;
      if (scope === "all") userFilter = undefined;
      else if (scope === "server") userFilter = null;
      else userFilter = String(userId).trim();
      // Optional guild scoping — falls back to reqGuildId() so per-guild wipes
      // are still possible from the dashboard.
      const guildId = bodyGuild || reqGuildId(req) || null;
      const cleared = await db.clearAiMemories({ guildId, userId: userFilter });
      res.json({ ok: true, cleared });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });  // ─── AI Model List (per-provider) ──────────────────────────────────────
  // Owner-only — fetches available models for any registered provider.
  app.get("/api/ai/models/:providerId", requireAuth, requireOwner, async (req, res) => {
    try {
      const { providerId } = req.params;
      const provider = getProvider(providerId);
      if (!provider) return res.status(400).json({ error: `Unknown provider: ${providerId}` });

      if (typeof provider.listModels !== "function") {
        return res.json({ models: provider.defaultModels || [] });
      }

      const key = settings.getAiApiKey(providerId);
      const hasBaseUrl = provider.baseUrlField && settings.get(provider.baseUrlField);

      if (!key && !hasBaseUrl) {
        return res.json({ models: provider.defaultModels || [] });
      }

      const opts = {};
      if (provider.baseUrlField) opts.baseUrl = settings.get(provider.baseUrlField);

      const models = await provider.listModels(key, opts);
      res.json({ models: models || provider.defaultModels || [] });
    } catch (err) {
      console.error("[api] Failed to fetch models for", req.params.providerId, ":", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── AI Chat (SSE streaming endpoint) ────────────────────────────────────
  // Owner-only — streams AI responses token-by-token with a typewriter effect.
  app.post("/api/ai/chat", requireAuth, requireOwner, async (req, res) => {
    const { message, history, thinkingEnabled, guildId, model: modelOverride } = req.body || {};

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

    let clientClosed = false;
    res.on("close", () => { clientClosed = true; });

    const send = (data) => {
      if (clientClosed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { chatWithProvider, parseFallbackList, cleanResponse } = require("../ai");
      const db = require("../db");
      const guild = guildId ? resolveGuild(guildId) : null;
      const resolvedPrompt = await db.resolvePrompt({ guildId: guild?.id || guildId || null, channelId: null });
      const system = resolvedPrompt?.prompt || settings.get("aiSystemPrompt") || "You are a helpful assistant.";
      const sanitizedHistory = Array.isArray(history)
        ? history
          .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map(m => ({ role: m.role, content: m.content.trim().slice(0, 2000) }))
          .filter(m => m.content)
          .slice(-12)
        : [];
      const dashboardContext = [
        "Dashboard playground context:",
        guild ? `- Selected guild: ${guild.name} (${guild.id})` : "- No selected guild.",
        "- This is a private admin playground chat, not a live Discord channel.",
        "- Use the transcript above as this playground's local conversation history.",
      ].join("\n");
      const messages = [
        { role: "system", content: `${system}\n\n${dashboardContext}` },
        ...sanitizedHistory,
        { role: "user", content: `[Dashboard Admin]: ${message.trim()}` },
      ];

      const primaryId = settings.get("aiProvider") || "groq";
      const fallbackIds = parseFallbackList(settings.get("aiFallbackProviders"));
      const providerIds = [primaryId, ...fallbackIds].filter((id, i, arr) => arr.indexOf(id) === i);
      const overrideModel = typeof modelOverride === "string" && modelOverride.trim()
        ? modelOverride.trim()
        : null;

      const result = await chatWithProvider(providerIds, messages, {
        providerId: overrideModel ? primaryId : null,
        model: overrideModel,
        disableTools: true,
      });
      const response = result.result;
      const think = typeof thinkingEnabled === "boolean"
        ? thinkingEnabled
        : settings.get("aiThinkingEnabled") === true;

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
        send({ type: "meta", providerId: result.providerId, model: result.model, promptSource: resolvedPrompt?.source || "settings" });
        // Stream the response in small chunks with a typewriter effect
        const chunkSize = 3;
        for (let i = 0; i < fullText.length; i += chunkSize) {
          if (clientClosed) break;
          const chunk = fullText.slice(i, i + chunkSize);
          send({ type: "token", text: chunk });
          // Small delay for typewriter feel (faster for longer texts)
          await new Promise(r => setTimeout(r, 15 + Math.random() * 10));
        }
        send({ type: "done", fullText, providerId: result.providerId, model: result.model });
      }
    } catch (err) {
      console.error("[api] AI chat error:", err.message);
      send({ type: "error", error: err.message });
    } finally {
      if (!clientClosed && !res.writableEnded) res.end();
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

  // ─── AI Conversation Logs (per-user chat history viewer) ────────────────
  app.get("/api/ai/conversations/logs", requireAuth, async (req, res) => {
    try {
      const guildId = reqGuildId(req);
      const scope = req.query.scope || null;
      const channelId = req.query.channelId || null;
      const userId = req.query.userId || null;
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

      if (!guildId) return res.json({ logs: [], users: [], scope });
      if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) {
        return res.status(403).json({ error: "You don't have access to this guild" });
      }

      const db = require("../db");
      // When scope is "private", DMs are global to the bot (no guild affiliation).
      // Skip the guild filter so all DM users surface regardless of selected guild.
      // When scope is "global", only match the selected guild's channel threads.
      // When no scope is set, include both guild threads and DM users for this guild.
      const effectiveGuildId = (scope === "private") ? null : guildId;
      const userRows = db.getConversationUsers({ guildId: effectiveGuildId, scope });
      const guild = resolveGuild(guildId);

      // Enrich user/channel list with display names; channel rows fall back to #name.
      const enrichedUsers = userRows.map(u => {
        const channel = u.channel_id && guild ? guild.channels.cache.get(u.channel_id) : null;
        let displayName = channel?.name || u.user_id || u.channel_id || "channel";
        let avatarUrl = null;
        if (u.user_id && guild) {
          const member = guild.members.cache.get(u.user_id);
          if (member) {
            displayName = member.displayName || member.user?.username || u.user_id;
            try {
              avatarUrl = member.user.displayAvatarURL({ size: 128, forceStatic: false }) || null;
            } catch { /* keep null */ }
          }
        }
        return {
          scope: u.scope,
          guildId: u.guild_id,
          channelId: u.channel_id,
          channelName: channel?.name || null,
          userId: u.user_id,
          displayName,
          avatarUrl,
          lastActive: u.last_active,
        };
      });

      // Fetch logs by scope + thread filter; otherwise most recent in this guild.
      let logs = [];
      if (scope === "private" && userId) {
        const asc = db.getConversationHistory("private", { userId }, limit);
        logs = asc.reverse();
      } else if (scope === "global" && channelId) {
        const asc = db.getConversationHistory("global", { guildId, channelId }, limit);
        logs = asc.reverse();
      } else {
        // When scope is "private", don't pass guildId since DMs have no guild.
        // For "global" or no scope, pass guildId to scope the results.
        logs = db.getConversationLogs({ scope, guildId: effectiveGuildId, channelId, userId, limit });
      }

      const enrichedLogs = logs.map(row => {
        const channel = row.channel_id && guild ? guild.channels.cache.get(row.channel_id) : null;
        let displayName = channel?.name || row.user_id || row.channel_id || "channel";
        if (row.user_id && guild) {
          const member = guild.members.cache.get(row.user_id);
          if (member) displayName = member.displayName || member.user?.username || row.user_id;
        }
        return {
          id: row.id,
          scope: row.scope,
          guildId: row.guild_id,
          channelId: row.channel_id,
          channelName: channel?.name || null,
          userId: row.user_id,
          displayName,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
        };
      });

      res.json({ logs: enrichedLogs, users: enrichedUsers, guildId, scope: scope || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Owner-only diagnostic: distribution of ai_conversations rows so an admin
  // can verify whether their data is actually persisted (and where). Useful
  // when the dashboard shows empty but the DB claims to have rows. NULL is
  // returned as JSON null rather than a string sentinel so it remains
  // unambiguous for downstream consumers.
  app.get("/api/ai/conversations/diag", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      // Bare SELECTs already return JS `null` for SQL NULL columns, so the
      // rows can be sent through unchanged — no COALESCE mapping needed.
      const total = db.db.prepare("SELECT COUNT(*) as count FROM ai_conversations").get().count;
      const byScope = db.db.prepare(
        "SELECT scope, COUNT(*) as count FROM ai_conversations GROUP BY scope ORDER BY count DESC"
      ).all();
      const byGuild = db.db.prepare(
        "SELECT guild_id, COUNT(*) as count FROM ai_conversations GROUP BY guild_id ORDER BY count DESC LIMIT 10"
      ).all();
      const byThread = db.db.prepare(
        `SELECT scope, guild_id, channel_id, user_id, COUNT(*) as count, MAX(timestamp) as last_active
         FROM ai_conversations
         GROUP BY scope, guild_id, channel_id, user_id
         ORDER BY last_active DESC
         LIMIT 10`
      ).all();
      const sample = db.db.prepare(
        "SELECT id, scope, guild_id, channel_id, user_id, role, length(content) as content_length, timestamp FROM ai_conversations ORDER BY timestamp DESC LIMIT 3"
      ).all();
      res.json({ total, byScope, byGuild, byThread, sample });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Layered system prompts (default -> guild -> channel); most specific tier wins.
  app.get("/api/ai/prompts", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      const rows = await db.listPrompts();
      const guild = reqGuildId(req) ? resolveGuild(reqGuildId(req)) : null;
      const channelsByName = {};
      if (guild) {
        for (const c of guild.channels.cache.values()) {
          if (typeof c.lockPermissions === "function") {
            channelsByName[c.id] = { id: c.id, name: c.name };
          }
        }
      }
      const resolved = guild
        ? await db.resolvePrompt({ guildId: guild.id, channelId: null })
        : { prompt: null, source: null };
      const fallback = settings.get("aiSystemPrompt") || null;
      const out = { default: null, guild: null, channels: {}, resolved, fallback, raw: rows };
      for (const r of rows) {
        if (r.scope === "default" && r.target_id === "*") out.default = r.prompt;
        else if (r.scope === "guild") out.guild = { targetId: r.target_id, prompt: r.prompt, updatedAt: r.updated_at };
        else if (r.scope === "channel") {
          out.channels[r.target_id] = {
            targetId: r.target_id,
            prompt: r.prompt,
            updatedAt: r.updated_at,
            channel: channelsByName[r.target_id] || null,
          };
        }
      }
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/ai/prompts", requireAuth, requireOwner, async (req, res) => {
    try {
      const { scope, targetId, prompt } = req.body || {};
      if (!["default", "guild", "channel"].includes(scope)) {
        return res.status(400).json({ error: "scope must be default|guild|channel" });
      }
      if (scope === "guild" && (!targetId || !resolveGuild(targetId))) {
        return res.status(400).json({ error: "Invalid guild targetId" });
      }
      if (scope === "channel" && targetId) {
        let found = false;
        for (const g of ctx.client?.guilds?.cache?.values() || []) {
          if (g.channels.cache.get(targetId)) { found = true; break; }
        }
        if (!found) return res.status(400).json({ error: "Invalid channel targetId" });
      }
      const db = require("../db");
      await db.upsertPrompt(scope, targetId, prompt || "");
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/ai/prompts", requireAuth, requireOwner, async (req, res) => {
    try {
      const { scope, targetId } = req.query;
      if (!["default", "guild", "channel"].includes(scope)) {
        return res.status(400).json({ error: "scope must be default|guild|channel" });
      }
      const db = require("../db");
      await db.deletePrompt(scope, targetId);
      res.json({ ok: true });
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
    res.json({ features: cats, prefix: settings.get("prefix") || "$" });
  });

  app.post("/api/features", requireAuth, requireOwner, (req, res) => {
    const { id, enabled } = req.body || {};
    const cat = features.getCategory(typeof id === "string" ? id : "");
    if (!cat) return res.status(400).json({ error: "Unknown feature category" });
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be a boolean" });
    settings.set(cat.key, enabled);
    res.json({ ok: true, id, enabled });
  });

  // ─── Per-command config ──────────────────────────────────────────────────
  function cleanCommandAliases(value) {
    if (Array.isArray(value)) {
      return value.map(x => String(x).trim().toLowerCase()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    }
    return [];
  }

  function validateCommandAliases(guildId, name, aliases) {
    const seen = new Set();
    const cleaned = [];
    for (const alias of aliases) {
      if (!COMMAND_ALIAS_RE.test(alias)) {
        return { error: "aliases may only use lowercase letters, numbers, _ and - and must be 1-32 chars" };
      }
      if (alias === name) continue;
      const direct = ctx.commandMap.get(alias);
      if (direct && direct.name !== name) return { error: `alias conflicts with existing command: ${alias}` };
      if (seen.has(alias)) continue;
      for (const def of ctx.commandMap.values()) {
        if (!def?.name || def.name === name || typeof ctx.commandAliases !== "function") continue;
        if (ctx.commandAliases(def, guildId).includes(alias)) {
          return { error: `alias already belongs to command: ${def.name}` };
        }
      }
      seen.add(alias);
      cleaned.push(alias);
    }
    return { aliases: cleaned.slice(0, 10) };
  }

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
        aliases: typeof ctx.commandAliases === "function" ? ctx.commandAliases(def, guildId) : (def.aliases || []),
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
      prefix: settings.get("prefix") || "$",
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
    if (body.reset === true) {
      config.reset(guildId, name);
      return res.json({
        ok: true,
        aliases: typeof ctx.commandAliases === "function" ? ctx.commandAliases(def, guildId) : (def.aliases || []),
        config: config.resolve(guildId, name, def),
      });
    }

    const patch = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.permission === "string" && config.PERM_ORDER.includes(body.permission)) patch.permission = body.permission;
    if (Number.isInteger(body.cooldown) && body.cooldown >= 0 && body.cooldown <= 86400) patch.cooldown = body.cooldown;
    if (Array.isArray(body.allowedChannels)) patch.allowedChannels = body.allowedChannels.filter(x => /^\d{17,20}$/.test(x));
    if (Array.isArray(body.blockedChannels)) patch.blockedChannels = body.blockedChannels.filter(x => /^\d{17,20}$/.test(x));
    if (Array.isArray(body.allowedRoles))    patch.allowedRoles    = body.allowedRoles.filter(x => /^\d{17,20}$/.test(x));
    if (body.settings && typeof body.settings === "object") patch.settings = body.settings;
    if (body.aliases !== undefined) {
      const validated = validateCommandAliases(guildId, name, cleanCommandAliases(body.aliases));
      if (validated.error) return res.status(400).json({ error: validated.error });
      patch.settings = { ...(patch.settings || config.resolve(guildId, name, def).settings || {}), aliases: validated.aliases };
    }

    config.set(guildId, name, patch);
    res.json({
      ok: true,
      aliases: typeof ctx.commandAliases === "function" ? ctx.commandAliases(def, guildId) : [],
      config: config.resolve(guildId, name, def),
    });
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
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const body = req.body || {};
    const patch = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.logChannelId === null || /^\d{17,20}$/.test(body.logChannelId || "")) patch.logChannelId = body.logChannelId || null;
    if (Array.isArray(body.ignoredChannels)) patch.ignoredChannels = body.ignoredChannels.filter(x => /^\d{17,20}$/.test(x));
    if (Array.isArray(body.ignoredRoles))    patch.ignoredRoles    = body.ignoredRoles.filter(x => /^\d{17,20}$/.test(x));
    if (body.rules && typeof body.rules === "object") patch.rules = body.rules;
    // Heat config (BOT_SPEC §3.2). Deep-merged by setConfig so partial patches
    // are safe; here we validate + clamp the shape.
    if (body.heat && typeof body.heat === "object") {
      const heat = {};
      if (typeof body.heat.enabled === "boolean") heat.enabled = body.heat.enabled;
      if (typeof body.heat.decayPerMinute === "number") heat.decayPerMinute = Math.min(Math.max(body.heat.decayPerMinute, 0), 100);
      if (Array.isArray(body.heat.thresholds)) {
        heat.thresholds = body.heat.thresholds
          .filter(t => t && typeof t === "object" && typeof t.heat === "number")
          .map(t => ({
            heat: Math.min(Math.max(t.heat, 1), 10_000),
            action: ["warn", "mute", "kick", "ban"].includes(t.action) ? t.action : "warn",
            ...(typeof t.duration === "string" ? { duration: t.duration.slice(0, 8) } : {}),
          }))
          .slice(0, 10);
      }
      patch.heat = heat;
    }
    const next = automod.setConfig(guildId, patch);
    res.json({ ok: true, config: next });
  });

  // ─── Automod test mode + trigger stats (BOT_SPEC §3.4) ─────────────────────
  // Dry-run all rules against a candidate message string. Returns which would
  // fire + their actions WITHOUT enforcing, deleting, heat, or stats.
  app.post("/api/automod/test", requireAuth, (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const b = req.body || {};
    const content = typeof b.content === "string" ? b.content.slice(0, 4000) : "";
    if (!content.trim()) return res.status(400).json({ error: "content is required" });
    const mentionCount = Math.min(Math.max(parseInt(b.mentionCount, 10) || 0, 0), 100);
    try {
      res.json(automod.testRules(guildId, content, { mentionCount }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/automod/stats", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.json({ stats: [] });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    try {
      const db = require("../db");
      res.json({ stats: await db.getAutomodStats(guildId, days), days });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/automod/stats", requireOwner, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    try {
      const db = require("../db");
      await db.clearAutomodStats(guildId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  // ─── Theme (per-guild colors / footer / tone pack) ───────────────────────
  app.get("/api/theme", requireAuth, (req, res) => {
    const themeMod = require("../theme");
    const tone = require("../tone");
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (guildInfo.guildId && !userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
    res.json({
      guildId: guildInfo.guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
      config: themeMod.getTheme(guildInfo.guildId),
      packs: tone.listPacks(),
      emojiStyles: themeMod.EMOJI_STYLES,
    });
  });

  app.post("/api/theme", requireAuth, (req, res) => {
    const themeMod = require("../theme");
    const tone = require("../tone");
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const b = req.body || {};
    if (b.reset === true) {
      return res.json({ ok: true, config: themeMod.resetTheme(guildId) });
    }
    const patch = {};
    if (typeof b.tone === "string" && tone.PACKS[b.tone]) patch.tone = b.tone;
    if (typeof b.emojiStyle === "string" && themeMod.EMOJI_STYLES.includes(b.emojiStyle)) patch.emojiStyle = b.emojiStyle;
    if (b.colors && typeof b.colors === "object") {
      patch.colors = {};
      for (const kind of themeMod.COLOR_KINDS) {
        const v = b.colors[kind];
        if (typeof v === "number" && v >= 0 && v <= 0xffffff) patch.colors[kind] = v;
        else if (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v)) patch.colors[kind] = parseInt(v.replace("#", ""), 16);
      }
    }
    if (b.footer && typeof b.footer === "object") {
      patch.footer = {
        enabled: !!b.footer.enabled,
        text: b.footer.text ? String(b.footer.text).slice(0, 200) : null,
      };
    }
    res.json({ ok: true, config: themeMod.setTheme(guildId, patch) });
  });

  // ─── Anti-raid ───────────────────────────────────────────────────────────
  app.get("/api/antiraid", requireAuth, (req, res) => {
    const antiraidMod = require("../antiraid");
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (guildInfo.guildId && !userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) {
      return res.status(403).json({ error: "You don't have access to this guild" });
    }
    res.json({
      guildId: guildInfo.guildId,
      hasGuild: guildInfo.hasGuild,
      guildName: guildInfo.guildName,
      config: antiraidMod.getConfig(guildInfo.guildId),
      locked: guildInfo.guildId ? antiraidMod.isLocked(guildInfo.guildId) : false,
    });
  });

  app.post("/api/antiraid", requireAuth, (req, res) => {
    const antiraidMod = require("../antiraid");
    const guildInfo = getGuildInfo(reqGuildId(req));
    const guildId = guildInfo.guildId;
    if (!guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const b = req.body || {};
    if (b.reset === true) {
      return res.json({ ok: true, config: antiraidMod.resetConfig(guildId) });
    }
    if (b.unlock === true) {
      antiraidMod.manualUnlock(guildId).catch(err => console.error("[api] antiraid unlock:", err.message));
      return res.json({ ok: true, locked: false });
    }
    const patch = {};
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (b.joinRate && typeof b.joinRate === "object") {
      patch.joinRate = {
        maxJoins: Math.min(Math.max(parseInt(b.joinRate.maxJoins, 10) || 10, 2), 100),
        windowSeconds: Math.min(Math.max(parseInt(b.joinRate.windowSeconds, 10) || 10, 3), 600),
      };
    }
    if (b.accountAge && typeof b.accountAge === "object") {
      patch.accountAge = {
        minAccountAgeHours: Math.min(Math.max(parseInt(b.accountAge.minAccountAgeHours, 10) || 0, 0), 720),
        gateAction: ["kick", "quarantine", "notify"].includes(b.accountAge.gateAction) ? b.accountAge.gateAction : "notify",
      };
    }
    if (typeof b.raidAction === "string" && ["lockdown", "kick_new", "quarantine", "notify"].includes(b.raidAction)) patch.raidAction = b.raidAction;
    if (typeof b.alertChannelId === "string") patch.alertChannelId = b.alertChannelId.trim() || null;
    if (typeof b.quarantineRoleId === "string") patch.quarantineRoleId = b.quarantineRoleId.trim() || null;
    if (typeof b.cooldownMinutes === "number") patch.cooldownMinutes = Math.min(Math.max(b.cooldownMinutes, 1), 1440);
    if (Array.isArray(b.exemptRoles)) patch.exemptRoles = b.exemptRoles.filter(r => typeof r === "string").slice(0, 25);
    res.json({ ok: true, config: antiraidMod.setConfig(guildId, patch) });
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
      prefix: settings.get("prefix") || "$",
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
    const full = ctx.data[store] ?? {};
    // Scope guild-keyed stores to the selected guild when ?guildId= is present,
    // so the dashboard only sees this guild's data. stickies (channel-keyed)
    // and afkUsers (user-keyed, with an inner guildId field) aren't guild-keyed
    // at the top level, so they're returned whole.
    const guildId = reqGuildId(req);
    let scoped = full;
    if (guildId && (store === "warnings" || store === "reactionlogs" || store === "customRoles")) {
      scoped = full[guildId] ?? {};
    }
    res.json({ store, data: scoped });
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
    if (!guildInfo.guildId) return res.json({ entries: [], prefix: settings.get("prefix") || "$" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner)) return res.status(403).json({ error: "You don't have access to this guild" });
    const limit = parseInt(req.query.limit, 10) || 100;
    try {
      const db = require("../db");
      const entries = await db.getModLog(guildInfo.guildId, Math.min(limit, 500));
      res.json({ entries, prefix: settings.get("prefix") || "$" });
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
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM mod_notes WHERE id = ?", parseInt(req.params.id, 10));
      if (!row || !userCanAccessGuild(req.user.sub, row.guild_id, req.user.isOwner))
        return res.status(404).json({ error: "Not found" });
      await dbMod.deleteModNote(parseInt(req.params.id, 10));
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
      if (entry.guild_id !== guildInfo.guildId) return res.status(403).json({ error: "Backup does not belong to this guild" });
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
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM server_backups WHERE id = ?", parseInt(req.params.id, 10));
      if (!row || row.guild_id !== guildInfo.guildId) return res.status(404).json({ error: "Not found" });
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
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM scheduled_messages WHERE id = ?", parseInt(req.params.id, 10));
      if (!row || row.guild_id !== guildInfo.guildId) return res.status(404).json({ error: "Not found" });
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
      res.json({ rules: rules.map(r => ({ ...r, conditions: db.safeJsonParse(r.conditions, {}), actions: db.safeJsonParse(r.actions, []) })) });
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
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM autoexec_rules WHERE id = ?", parseInt(req.params.id, 10));
      if (!row || !userCanAccessGuild(req.user.sub, row.guild_id, req.user.isOwner))
        return res.status(404).json({ error: "Not found" });
      await dbMod.deleteAutoExecRule(parseInt(req.params.id, 10));
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
  // ─── Economy ──────────────────────────────────────────────────────────────
  // Get economy config for a guild
  app.get("/api/economy/config", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ config: null, hasGuild: false });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const economy = require("../economy");
      const cfg = await economy.getConfig(guildInfo.guildId);
      res.json({ config: cfg, defaults: economy.DEFAULTS, hasGuild: true, guildId: guildInfo.guildId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update economy config (payouts, rates, odds)
  app.post("/api/economy/config", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const economy = require("../economy");
      const body = req.body || {};
      const patch = {};
      if (Number.isInteger(body.dailyAmount) && body.dailyAmount >= 1) patch.dailyAmount = body.dailyAmount;
      if (Number.isInteger(body.workMin) && body.workMin >= 1) patch.workMin = body.workMin;
      if (Number.isInteger(body.workMax) && body.workMax >= body.workMin) patch.workMax = body.workMax;
      if (Number.isFinite(body.interestRate) && body.interestRate >= 0 && body.interestRate <= 100) patch.interestRate = body.interestRate;
      if (Number.isFinite(body.taxRate) && body.taxRate >= 0 && body.taxRate <= 100) patch.taxRate = body.taxRate;
      if (Number.isFinite(body.gambleOdds) && body.gambleOdds >= 0 && body.gambleOdds <= 1) patch.gambleOdds = body.gambleOdds;
      const cfg = await economy.saveConfig(guildInfo.guildId, patch);
      res.json({ ok: true, config: cfg });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Economy stats
  app.get("/api/economy/stats", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ stats: null, hasGuild: false });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const economy = require("../economy");
      const stats = await economy.getStats(guildInfo.guildId);
      const guild = resolveGuild(guildInfo.guildId);
      let richestName = null;
      if (stats.richestUserId && guild) {
        const member = guild.members.cache.get(stats.richestUserId);
        if (member) richestName = member.displayName || member.user?.username || null;
      }
      res.json({ stats: { ...stats, richestName }, guildId: guildInfo.guildId, hasGuild: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reset economy
  app.post("/api/economy/reset", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const economy = require("../economy");
      await economy.resetEconomy(guildInfo.guildId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Economy shop items
  app.get("/api/economy/shop", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ items: [], hasGuild: false });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const economy = require("../economy");
      const items = await economy.getShopItems(guildInfo.guildId);
      const guild = resolveGuild(guildInfo.guildId);
      const enriched = items.map(item => {
        let roleName = null;
        if (item.role_id && guild) {
          const role = guild.roles.cache.get(item.role_id);
          if (role) roleName = role.name;
        }
        return { id: item.id, guildId: item.guild_id, name: item.name, description: item.description, price: item.price, roleId: item.role_id, roleName, stock: item.stock };
      });
      res.json({ items: enriched, roles: guildInfo.roles, guildId: guildInfo.guildId, hasGuild: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/economy/shop", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    const { name, description, price, roleId, stock } = req.body || {};
    if (!name || !price || price < 1) return res.status(400).json({ error: "name and price (>= 1) are required" });
    try {
      const economy = require("../economy");
      const id = await economy.addShopItem(guildInfo.guildId, name.slice(0, 100), description?.slice(0, 500) || "", price, roleId || null, stock ?? -1);
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/economy/shop/:id", requireAuth, async (req, res) => {
    try {
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM economy_shop WHERE id = ?", parseInt(req.params.id, 10));
      if (!row || !userCanAccessGuild(req.user.sub, row.guild_id, req.user.isOwner))
        return res.status(404).json({ error: "Not found" });
      const economy = require("../economy");
      await economy.deleteShopItem(parseInt(req.params.id, 10));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/economy/shop/:id", requireAuth, async (req, res) => {
    try {
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM economy_shop WHERE id = ?", parseInt(req.params.id, 10));
      if (!row || !userCanAccessGuild(req.user.sub, row.guild_id, req.user.isOwner))
        return res.status(404).json({ error: "Not found" });
      const economy = require("../economy");
      const patch = {};
      const body = req.body || {};
      if (body.name !== undefined) patch.name = String(body.name).slice(0, 100);
      if (body.description !== undefined) patch.description = String(body.description).slice(0, 500);
      if (Number.isInteger(body.price) && body.price >= 1) patch.price = body.price;
      if (body.roleId !== undefined) patch.role_id = body.roleId || null;
      if (Number.isInteger(body.stock) && body.stock >= -1) patch.stock = body.stock;
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid fields to update" });
      await economy.updateShopItem(parseInt(req.params.id, 10), patch);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

  // ─── Embed Templates ──────────────────────────────────────────────────────
  app.get("/api/embeds", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.json({ templates: [], hasGuild: false });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    try {
      const db = require("../db");
      const templates = await db.getEmbedTemplates(guildInfo.guildId);
      res.json({ templates: templates.map(t => ({ ...t, embed: db.safeJsonParse(t.embed_json, {}) })), hasGuild: true, guildId: guildInfo.guildId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/embeds", requireAuth, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    if (!userCanAccessGuild(req.user.sub, guildInfo.guildId, req.user.isOwner))
      return res.status(403).json({ error: "You don't have access to this guild" });
    const { name, embed, id } = req.body || {};
    if (!name || !embed) return res.status(400).json({ error: "name and embed are required" });
    try {
      const db = require("../db");
      const savedId = await db.saveEmbedTemplate(guildInfo.guildId, name.slice(0, 100), JSON.stringify(embed), id || null);
      res.json({ ok: true, id: savedId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/embeds/:id", requireAuth, async (req, res) => {
    try {
      const dbMod = require("../db");
      const row = dbMod.get("SELECT guild_id FROM embed_templates WHERE id = ?", parseInt(req.params.id, 10));
      if (!row || !userCanAccessGuild(req.user.sub, row.guild_id, req.user.isOwner))
        return res.status(404).json({ error: "Not found" });
      const db = require("../db");
      await db.deleteEmbedTemplate(parseInt(req.params.id, 10));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/embeds/send", requireAuth, requireOwner, async (req, res) => {
    const guildInfo = getGuildInfo(reqGuildId(req));
    if (!guildInfo.guildId) return res.status(400).json({ error: "Bot is not in any guild yet" });
    const guild = resolveGuild(guildInfo.guildId);
    if (!guild) return res.status(400).json({ error: "Guild not found" });
    const { channelId, content, embed } = req.body || {};
    if (!channelId) return res.status(400).json({ error: "channelId required" });
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return res.status(400).json({ error: "Channel not found" });
      const payload = { content: content?.slice(0, 2000) || null };
      if (embed && Object.keys(embed).length > 0) {
        payload.embeds = [embed];
      }
      const msg = await channel.send(payload);
      res.json({ ok: true, messageId: msg.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Alpha Experiments ────────────────────────────────────────────────
  app.get("/api/alpha/codes", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      const codes = await db.getAllAlphaCodes();
      res.json({ codes });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/alpha/generate", requireAuth, requireOwner, async (req, res) => {
    try {
      const crypto = require("crypto");
      const code = crypto.randomBytes(12).toString("hex").toUpperCase();
      const db = require("../db");
      await db.createAlphaCode(code, req.user.sub);
      res.json({ code });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/alpha/users", requireAuth, async (req, res) => {
    try {
      const db = require("../db");
      const users = await db.getAllAlphaUsers();
      res.json({ users });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/alpha/users/:userId/toggle-telemetry", requireAuth, requireOwner, async (req, res) => {
    try {
      const { userId } = req.params;
      const db = require("../db");
      const user = await db.getAlphaUser(userId, req.body.guildId);
      if (!user) return res.status(404).json({ error: "User not found" });
      const newOpt = user.telemetry_opt_out === 1 ? 0 : 1;
      await db.setAlphaUser(userId, req.body.guildId, {
        activatedAt: user.activated_at,
        codeUsed: user.code_used,
        telemetryOptOut: newOpt === 1,
      });
      const data = require("../data");
      data.setAlphaTelemetryOptOut(userId, req.body.guildId, newOpt === 1);
      res.json({ ok: true, telemetryOptOut: newOpt === 1 });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/alpha/telemetry", requireAuth, async (req, res) => {
    try {
      const db = require("../db");
      const { guildId, userId, success, limit, offset } = req.query;
      const entries = await db.getAlphaTelemetry({
        guildId: guildId || null,
        userId: userId || null,
        success: success !== undefined ? (success === "true" || success === "1") : null,
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0,
      });
      res.json({ entries });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/alpha/telemetry", requireAuth, requireOwner, async (req, res) => {
    try {
      const db = require("../db");
      await db.purgeAlphaTelemetry();
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Serve built dashboard (SPA) ──────────────────────────────────────
  // The Vite build output sits at dashboard/dist/. The Express server serves
  // the static files AND handles SPA fallback so the entire application
  // (bot API + dashboard UI) runs on a single port.
  // Note: dashboardPath & servingDashboard are already resolved above.
  if (servingDashboard) {
    console.log(`[api] Serving dashboard from ${dashboardPath}`);
    app.use(express.static(dashboardPath, {
      maxAge: "1y",
      immutable: true,
      setHeaders: (res, filePath) => {
        // HTML must never be cached so SPA routing always works
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }));
    // SPA fallback: any non-API, non-login GET route returns index.html so
    // React Router can handle the client-side route.
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/") || req.path === "/login") {
        return res.status(404).json({ error: "Not found" });
      }
      res.sendFile(path.join(dashboardPath, "index.html"));
    });
  } else {
    console.warn(`[api] Dashboard build not found at ${dashboardPath} — dashboard UI will not be served. Run: cd dashboard && npm run build`);
  }

  // Global error handler (catch-all for thrown errors in routes)
  app.use((err, req, res, _next) => {
    console.error("[api] Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  // ── HTTP / HTTPS ────────────────────────────────────────────────────
  // Default: plain HTTP on PORT. The recommended production setup is to put a
  // reverse proxy (Caddy/nginx) in front of the bot to terminate TLS — in that
  // case the bot stays on plain HTTP. Real HTTPS is opt-in: set both
  // SSL_CERT_PATH and SSL_KEY_PATH to serve TLS directly (no self-signed cert,
  // which browsers reject and which breaks reverse-proxy chaining).
  const certPath = process.env.SSL_CERT_PATH;
  const keyPath  = process.env.SSL_KEY_PATH;
  const useHttps = Boolean(certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath));

  const onListening = () => {
    const schedCount = (() => { try { return require("../scheduler").count(); } catch { return 0; } })();
    const scheme = useHttps ? "https" : "http";
    console.log(`[api] Bot dashboard API on ${scheme}://0.0.0.0:${PORT} (${schedCount} schedules loaded)`);
    if (servingDashboard) {
      console.log(`[api] Dashboard available at ${scheme}://0.0.0.0:${PORT}/`);
    }
  };

  if (useHttps) {
    console.log("[api] Using SSL certificate from:", certPath);
    https
      .createServer({ cert: fs.readFileSync(certPath, "utf8"), key: fs.readFileSync(keyPath, "utf8") }, app)
      .listen(PORT, "0.0.0.0", onListening);
  } else {
    if (certPath || keyPath) {
      console.warn("[api] SSL_CERT_PATH/SSL_KEY_PATH set but one is missing or unreadable — serving HTTP instead.");
    }
    app.listen(PORT, "0.0.0.0", onListening);
  }
}

module.exports = { startApi };
