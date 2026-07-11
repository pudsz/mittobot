// Social Connectors — announce new RSS / YouTube / Twitch posts to a channel.
// A single setInterval tick (index.js) calls poll(client) every few minutes; it
// walks every connector row, checks the source for something newer than the
// stored `last_seen`, and posts to the connector's announce channel. State is
// DB-only (no in-memory cache needed): the tick is infrequent and reads are
// cheap, and keeping last_seen in SQLite makes announcements idempotent across
// restarts. Each connector is polled inside its own try/catch so one broken
// feed never stalls the rest of the loop.
const { EmbedBuilder } = require("discord.js");
const db = require("./db");
const safe = require("./safe");
const settings = require("./settings");

const DEFAULT_TEMPLATE = "📢 New post: **{title}**\n{link}";

// ── HTTP helper (global fetch + timeout; no new deps) ─────────────────────
async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Tiny RSS/Atom parser ──────────────────────────────────────────────────
// We only need the newest entry, so pull the first <item> (RSS) or <entry>
// (Atom) and read a stable id + title + link out of it with light regex. This
// intentionally avoids an XML dependency; feeds we target (generic RSS +
// YouTube's Atom feed) are well-formed enough for this.
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeEntities(stripCdata(m[1]).trim()) : "";
}
function stripCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Returns { id, title, link } for the newest feed entry, or null.
function parseFirstFeedItem(xml) {
  const itemMatch = xml.match(/<item[\s>][\s\S]*?<\/item>/i) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/i);
  if (!itemMatch) return null;
  const block = itemMatch[0];

  const title = tag(block, "title") || "(untitled)";

  // Link: RSS uses <link>url</link>; Atom uses <link href="url"/> (prefer the
  // alternate/text-html rel, falling back to the first href we find).
  let link = tag(block, "link");
  if (!link) {
    const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
      || block.match(/<link[^>]*href=["']([^"']+)["']/i);
    if (alt) link = decodeEntities(alt[1]);
  }

  // Stable id: prefer explicit guid/id, then a platform-specific video id, then
  // fall back to the link so we can still de-dupe.
  const id = tag(block, "guid")
    || tag(block, "yt:videoId")
    || tag(block, "id")
    || link
    || title;

  return { id: id || null, title, link: link || "" };
}

// ── Twitch (Helix) ─────────────────────────────────────────────────────────
// App access token cached in-memory until shortly before expiry. Credentials
// come from settings (twitchClientId/twitchClientSecret) or the matching env
// vars; if neither is present, twitch connectors are skipped silently.
let _twitchToken = { value: null, expiresAt: 0 };

function twitchCreds() {
  const clientId = settings.get("twitchClientId") || process.env.TWITCH_CLIENT_ID || "";
  const clientSecret = settings.get("twitchClientSecret") || process.env.TWITCH_CLIENT_SECRET || "";
  return { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() };
}

async function getTwitchToken() {
  const { clientId, clientSecret } = twitchCreds();
  if (!clientId || !clientSecret) return null; // not configured — caller skips
  if (_twitchToken.value && Date.now() < _twitchToken.expiresAt) return _twitchToken.value;

  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}`
    + `&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
  const res = await fetchWithTimeout(url, { method: "POST" });
  if (!res.ok) throw new Error(`twitch token HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("twitch token missing");
  // Refresh a minute early to avoid using a just-expired token mid-request.
  _twitchToken = { value: json.access_token, expiresAt: Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000 };
  return _twitchToken.value;
}

// Returns the live stream object ({ id, title, ... }) for a login, or null when
// offline / not configured.
async function fetchTwitchStream(login) {
  const { clientId } = twitchCreds();
  const token = await getTwitchToken();
  if (!token) return null;
  const res = await fetchWithTimeout(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { "Client-ID": clientId, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`twitch streams HTTP ${res.status}`);
  const json = await res.json();
  return (json.data && json.data[0]) || null;
}

// ── Announcement rendering ─────────────────────────────────────────────────
function renderTemplate(template, fields) {
  return String(template || DEFAULT_TEMPLATE)
    .replace(/\{title\}/g, fields.title || "")
    .replace(/\{link\}/g, fields.link || "")
    .replace(/\{url\}/g, fields.link || "")
    .replace(/\{platform\}/g, fields.platform || "")
    .replace(/\{target\}/g, fields.target || "");
}

async function announce(client, connector, fields) {
  const channel = client.channels.cache.get(connector.announce_channel_id);
  if (!channel || typeof channel.send !== "function") return;
  const content = renderTemplate(connector.message_template, fields);
  await safe.send(channel, { content, allowedMentions: { parse: ["roles", "users"] } }, `social announce (${connector.platform})`);
}

// ── Per-connector handlers ─────────────────────────────────────────────────
// Each returns the new last_seen value to persist, or null for "nothing new".
async function pollRss(client, connector, feedUrl) {
  const res = await fetchWithTimeout(feedUrl, { headers: { "User-Agent": "mittobot-social/1.0" } });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const xml = await res.text();
  const item = parseFirstFeedItem(xml);
  if (!item || !item.id) return null;

  // First time we see this connector: seed last_seen silently so we don't
  // announce an already-old post the moment the connector is created.
  if (!connector.last_seen) return item.id;
  if (item.id === connector.last_seen) return null;

  await announce(client, connector, {
    title: item.title,
    link: item.link,
    platform: connector.platform,
    target: connector.target,
  });
  return item.id;
}

async function pollTwitch(client, connector) {
  const stream = await fetchTwitchStream(connector.target);
  if (!stream) {
    // Offline — clear the stored stream id so the next go-live announces again.
    return connector.last_seen ? "" : null;
  }
  if (stream.id === connector.last_seen) return null; // already announced this stream

  const link = `https://twitch.tv/${connector.target}`;
  await announce(client, connector, {
    title: stream.title || `${connector.target} is live!`,
    link,
    platform: connector.platform,
    target: connector.target,
  });
  return stream.id;
}

// ── Poll tick (index.js setInterval) ───────────────────────────────────────
async function poll(client) {
  let connectors;
  try {
    connectors = db.getAllSocialConnectors();
  } catch (e) {
    console.error("[social] load connectors:", e.message);
    return;
  }

  for (const c of connectors) {
    if (c.enabled !== 1) continue;
    try {
      let nextSeen = null;
      if (c.platform === "rss") {
        nextSeen = await pollRss(client, c, c.target);
      } else if (c.platform === "youtube") {
        nextSeen = await pollRss(client, c, `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(c.target)}`);
      } else if (c.platform === "twitch") {
        // Skip silently when Twitch app credentials aren't configured.
        const { clientId, clientSecret } = twitchCreds();
        if (!clientId || !clientSecret) continue;
        nextSeen = await pollTwitch(client, c);
      }
      if (nextSeen !== null && nextSeen !== c.last_seen) {
        db.setSocialConnectorLastSeen(c.id, nextSeen);
      }
    } catch (e) {
      console.error(`[social] connector #${c.id} (${c.platform}:${c.target}):`, e.message);
    }
  }
}

// Small embed used by the $social list command.
function listEmbed(guildId) {
  const rows = db.getSocialConnectors(guildId);
  const embed = new EmbedBuilder().setColor(0x9146ff).setTitle("📡 Social Connectors");
  if (!rows.length) {
    embed.setDescription("No connectors yet. Add one from the dashboard **Community → Social** tab.");
    return embed;
  }
  embed.setDescription(rows.map(r =>
    `**#${r.id}** \`${r.platform}\` → <#${r.announce_channel_id}>\n\`${r.target}\`${r.enabled ? "" : " *(disabled)*"}`
  ).join("\n\n"));
  return embed;
}

module.exports = { poll, listEmbed, DEFAULT_TEMPLATE };
