const { PermissionFlagsBits } = require("discord.js");
const safe = require("../safe");
const aiMemory = require("./memory");

// Resolve tool permissions from settings. Returns "all" | "mod" | "admin" | "owner".
// Default: moderation tools require at least "mod", non-moderation tools "all".
function getToolPermission(toolName) {
  try {
    const settings = require("../settings");
    const raw = settings.get("aiToolPermissions");
    if (!raw || typeof raw !== "string" || !raw.trim()) return null;
    const map = JSON.parse(raw);
    return map[toolName] || null;
  } catch { return null; }
}

function checkToolAccess(toolName, member) {
  // Guard: member may be null in DM channels or partial contexts
  if (!member) return false;
  const perm = getToolPermission(toolName);
  if (!perm) {
    // Moderation tools default to requiring at least mod
    const modTools = new Set(["warn_member", "mute_member", "kick_member", "ban_member", "add_role", "remove_role", "purge_messages", "slowmode_set", "create_invite", "pin_message", "unpin_message"]);
    const adminTools = new Set(["create_channel"]);
    if (adminTools.has(toolName)) {
      const { OWNER_IDS } = require("../utils");
      if (OWNER_IDS.has(member.id)) return true;
      return member.permissions.has(PermissionFlagsBits.Administrator);
    }
    if (modTools.has(toolName)) {
      const { OWNER_IDS } = require("../utils");
      if (OWNER_IDS.has(member.id)) return true;
      return member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
             member.permissions.has(PermissionFlagsBits.Administrator);
    }
    return true; // non-mod tools are always allowed
  }

  switch (perm) {
    case "all": return true;
    case "mod":
      return member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
             member.permissions.has(PermissionFlagsBits.Administrator);
    case "admin":
      return member.permissions.has(PermissionFlagsBits.Administrator);
    case "owner": {
      const { OWNER_IDS } = require("../utils");
      return OWNER_IDS.has(member.id);
    }
    default: return false;
  }
}

const TOOL_SCHEMAS = [
  {
    name: "send_message",
    description: "Send a message to a specific Discord channel in the server.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The ID of the text channel." },
        content: { type: "string", description: "The message text to send." }
      },
      required: ["channelId", "content"]
    }
  },
  {
    name: "get_channel_history",
    description: "Retrieve recent messages from a channel to understand the conversation history or context.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The ID of the text channel." },
        limit: { type: "integer", description: "Number of messages to retrieve (default 10, max 50).", minimum: 1, maximum: 50 }
      },
      required: ["channelId"]
    }
  },
  {
    name: "get_user_info",
    description: "Retrieve detailed information about a server member, including roles, creation date, join date, and warning history.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The Discord user ID." }
      },
      required: ["userId"]
    }
  },
  {
    name: "warn_member",
    description: "Issue a warning to a member. This updates the bot warning count and logs it.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The Discord user ID." },
        reason: { type: "string", description: "The reason for the warning." }
      },
      required: ["userId", "reason"]
    }
  },
  {
    name: "mute_member",
    description: "Timeout/mute a member for a specified duration in minutes.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The Discord user ID." },
        durationMinutes: { type: "integer", description: "The duration of the mute in minutes (default 10).", minimum: 1 },
        reason: { type: "string", description: "The reason for the mute." }
      },
      required: ["userId", "reason"]
    }
  },
  {
    name: "kick_member",
    description: "Kick a member from the server.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The Discord user ID." },
        reason: { type: "string", description: "The reason for kicking the member." }
      },
      required: ["userId", "reason"]
    }
  },
  {
    name: "ban_member",
    description: "Ban a member from the server.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The Discord user ID." },
        reason: { type: "string", description: "The reason for banning the member." }
      },
      required: ["userId", "reason"]
    }
  },
  {
    name: "add_memory",
    description: "Save a fact/preference about a specific user or about the server. Omit userId to save a general server fact.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact to remember (e.g. 'Prefers JavaScript' or 'Server rules have changed')." },
        userId: { type: "string", description: "Optional Discord user ID if the fact is about a specific member." }
      },
      required: ["content"]
    }
  },
  {
    name: "forget_memory",
    description: "Delete/forget a saved memory fact by its ID.",
    parameters: {
      type: "object",
      properties: {
        memoryId: { type: "integer", description: "The ID of the memory fact to delete." }
      },
      required: ["memoryId"]
    }
  },
  {
    name: "search_web",
    description: "Search the web for information using a search query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The web search query." }
      },
      required: ["query"]
    }
  },
  {
    name: "scrape_web_page",
    description: "Scrape text content from a web URL/page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The web page URL." }
      },
      required: ["url"]
    }
  },
  {
    name: "list_channels",
    description: "List all text channels in the server, including their IDs, names, and parent categories.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "list_roles",
    description: "List all roles in the server with names, IDs, colors, and member counts.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "get_server_info",
    description: "Get general server info: member count, channel count, role count, server owner, creation date, verification level.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "create_invite",
    description: "Create an invite link to a specific channel or the current channel. Returns the invite URL.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Optional channel ID. If omitted, creates invite for the current channel." },
        maxAgeSeconds: { type: "integer", description: "Invite duration in seconds (default 86400 = 24h, 0 = never expires).", minimum: 0 },
        maxUses: { type: "integer", description: "Max uses before invite expires (default 0 = unlimited).", minimum: 0 }
      },
      required: []
    }
  },
  {
    name: "pin_message",
    description: "Pin a message in a channel by message ID.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The channel ID where the message is." },
        messageId: { type: "string", description: "The message ID to pin." }
      },
      required: ["channelId", "messageId"]
    }
  },
  {
    name: "unpin_message",
    description: "Unpin a message in a channel by message ID.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The channel ID where the message is." },
        messageId: { type: "string", description: "The message ID to unpin." }
      },
      required: ["channelId", "messageId"]
    }
  },
  {
    name: "add_role",
    description: "Add a role to a server member.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The Discord user ID." },
        roleId: { type: "string", description: "The role ID to add." }
      },
      required: ["userId", "roleId"]
    }
  },
  {
    name: "remove_role",
    description: "Remove a role from a server member.",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "The Discord user ID." },
        roleId: { type: "string", description: "The role ID to remove." }
      },
      required: ["userId", "roleId"]
    }
  },
  {
    name: "create_channel",
    description: "Create a new text channel in the server.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The channel name (lowercase, hyphens)." },
        categoryId: { type: "string", description: "Optional parent category ID." },
        topic: { type: "string", description: "Optional channel topic." },
        nsfw: { type: "boolean", description: "Whether the channel is NSFW (default false)." }
      },
      required: ["name"]
    }
  },
  {
    name: "purge_messages",
    description: "Bulk delete recent messages in a channel (max 100, restricted to last 14 days per Discord limits).",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The channel ID to purge messages from." },
        count: { type: "integer", description: "Number of messages to delete (1-100, default 10).", minimum: 1, maximum: 100 }
      },
      required: ["channelId"]
    }
  },
  {
    name: "slowmode_set",
    description: "Set the slowmode for a text channel (seconds between messages). Set to 0 to disable.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The channel ID." },
        seconds: { type: "integer", description: "Seconds between messages (0 = off, max 21600 = 6 hours).", minimum: 0, maximum: 21600 }
      },
      required: ["channelId", "seconds"]
    }
  },
  {
    name: "edit_message",
    description: "Edit a message previously sent by the bot in a channel.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The channel ID where the message is." },
        messageId: { type: "string", description: "The message ID to edit." },
        content: { type: "string", description: "The new message content." }
      },
      required: ["channelId", "messageId", "content"]
    }
  },
  {
    name: "react_to_message",
    description: "React to a message with an emoji. Use standard Unicode emoji or custom emoji ID.",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The channel ID where the message is." },
        messageId: { type: "string", description: "The message ID to react to." },
        emoji: { type: "string", description: "The emoji to react with (Unicode emoji like 👍 or custom emoji ID)." }
      },
      required: ["channelId", "messageId", "emoji"]
    }
  },
  {
    name: "browse_page",
    description: "Open a URL in a real headless browser (Playwright) and return the rendered page text and title. Use for JavaScript-heavy sites where basic scraping fails (SPAs, dynamic content). Falls back to basic scraping if Playwright is unavailable.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The web page URL to browse (must be a full http:// or https:// URL)." }
      },
      required: ["url"]
    }
  }
];

function getOpenAiTools() {
  return TOOL_SCHEMAS.map(s => ({
    type: "function",
    function: s
  }));
}

function getAnthropicTools() {
  return TOOL_SCHEMAS.map(s => ({
    name: s.name,
    description: s.description,
    input_schema: s.parameters
  }));
}

const FETCH_TIMEOUT = 15_000; // 15s timeout for all tool fetch calls

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWeb(query) {
  try {
    const res = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) return `Search failed: HTTP ${res.status}`;
    const text = await res.text();
    const results = [];
    const sections = text.split('class="result__body"');
    for (let i = 1; i < Math.min(sections.length, 6); i++) {
      const sec = sections[i];
      const titleMatch = sec.match(/<a class="result__url"[^>]*>([\s\S]*?)<\/a>/i);
      const linkMatch = sec.match(/href="([^"]+)"/i);
      const snippetMatch = sec.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
      if (linkMatch) {
        const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : "Link";
        const link = linkMatch[1];
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : "";
        results.push(`- **${title}** (${link})\n  ${snippet}`);
      }
    }
    return results.length ? results.join("\n\n") : "No search results found.";
  } catch (err) {
    return `Search failed: ${err.message}`;
  }
}

async function scrapeWebPage(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) return `Failed to fetch page: HTTP ${res.status}`;
    const html = await res.text();
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 2000);
  } catch (err) {
    return `Failed to scrape page: ${err.message}`;
  }
}

// Playwright-based browser rendering for JavaScript-heavy pages.
// Falls back to basic scrape if Playwright is unavailable or fails.
async function browsePage(url) {
  // Validate URL
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  let browser = null;
  try {
    const { chromium } = require("playwright");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // Navigate with a 20s timeout
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });

    // Wait a moment for any JS to render
    await page.waitForTimeout(2000);

    const title = await page.title();

    // Extract visible text content from the body
    const text = await page.evaluate(() => {
      // Remove script, style, nav, footer elements
      const elements = document.querySelectorAll("script, style, nav, footer, header, [aria-hidden='true']");
      elements.forEach(el => el.remove());
      return (document.body?.innerText || "").replace(/\s{3,}/g, "\n\n").trim();
    });

    let result = `**Page Title:** ${title || "(no title)"}\n\n**Content:**\n${text.slice(0, 3000)}`;

    await context.close();
    await browser.close();
    return result;
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    // Fall back to basic scrape if Playwright fails
    if (err.message?.includes("Cannot find module") || err.message?.includes("Executable doesn't exist")) {
      console.warn("[tools] Playwright not available for browse_page — falling back to basic scrape");
      return scrapeWebPage(url);
    }
    return `Browser failed: ${err.message}`;
  }
}

async function executeTool(name, args, ctx, message) {
  const { client, data } = ctx;
  const guild = message.guild;

  // DM guard: block guild-only tools in direct messages
  const DM_SAFE_TOOLS = new Set(["search_web", "scrape_web_page", "browse_page"]);
  if (!guild && !DM_SAFE_TOOLS.has(name)) {
    return `Error: the "${name}" tool requires a server context and is not available in direct messages.`;
  }

  switch (name) {
    case "send_message": {
      const channel = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch channel for send");
      if (!channel || channel.type !== 0) return `Error: channel ${args.channelId} is not a valid text channel.`;
      const perms = channel.permissionsFor(guild.members.me);
      if (!perms?.has(PermissionFlagsBits.SendMessages)) return `Error: bot lacks permission to send messages in channel ${args.channelId}.`;
      await channel.send(args.content);
      return `Successfully sent message to #${channel.name}.`;
    }

    case "get_channel_history": {
      const channel = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch channel history");
      if (!channel || channel.type !== 0) return `Error: channel ${args.channelId} is not a valid text channel.`;
      const perms = channel.permissionsFor(guild.members.me);
      if (!perms?.has(PermissionFlagsBits.ReadMessageHistory) || !perms?.has(PermissionFlagsBits.ViewChannel)) {
        return `Error: bot lacks permission to read message history in channel ${args.channelId}.`;
      }
      const limit = Math.min(args.limit || 10, 50);
      const fetched = await safe.orNull(channel.messages.fetch({ limit }), "tool: fetch channel messages");
      if (!fetched) return `Error: failed to fetch messages.`;
      const list = Array.from(fetched.values()).map(m => ({
        id: m.id,
        author: m.author.tag,
        content: m.content,
        timestamp: m.createdAt.toISOString()
      })).reverse();
      return JSON.stringify(list, null, 2);
    }

    case "get_user_info": {
      const member = await safe.orNull(guild.members.fetch(args.userId), `tool: fetch user ${args.userId}`);
      if (!member) return `Error: User with ID ${args.userId} not found in this guild.`;
      const warnings = data.getWarnings(guild.id, args.userId);
      return JSON.stringify({
        username: member.user.username,
        displayName: member.displayName,
        id: member.id,
        joinedAt: member.joinedAt,
        createdAt: member.user.createdAt,
        roles: member.roles.cache.map(r => r.name),
        isBot: member.user.bot,
        warningCount: warnings.length,
        warnings: warnings.map(w => ({ reason: w.reason, by: w.by, timestamp: new Date(w.timestamp).toISOString() }))
      }, null, 2);
    }

    case "warn_member": {
      if (!checkToolAccess("warn_member", message.member)) return "Permission denied: You need moderator permissions to warn members via AI.";
      const member = await safe.orNull(guild.members.fetch(args.userId), `tool: warn member ${args.userId}`);
      if (!member) return `Error: Member not found.`;
      data.addWarning(guild.id, member.id, { reason: args.reason, by: `${message.author.tag} (via AI)`, timestamp: Date.now() });
      const count = data.getWarnings(guild.id, member.id).length;
      return `Successfully warned member ${member.user.tag} (total warnings: ${count}). Reason: ${args.reason}`;
    }

    case "mute_member": {
      if (!checkToolAccess("mute_member", message.member)) return "Permission denied: You need moderator permissions to mute members via AI.";
      const member = await safe.orNull(guild.members.fetch(args.userId), `tool: mute member ${args.userId}`);
      if (!member) return `Error: Member not found.`;
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers) || !member.moderatable) {
        return `Error: bot lacks permission or member is not moderatable.`;
      }
      const durMinutes = args.durationMinutes || 10;
      await member.timeout(durMinutes * 60_000, args.reason);
      return `Successfully muted ${member.user.tag} for ${durMinutes} minutes. Reason: ${args.reason}`;
    }

    case "kick_member": {
      if (!checkToolAccess("kick_member", message.member)) return "Permission denied: You need admin permissions to kick members via AI.";
      const member = await safe.orNull(guild.members.fetch(args.userId), `tool: kick member ${args.userId}`);
      if (!member) return `Error: Member not found.`;
      if (!guild.members.me.permissions.has(PermissionFlagsBits.KickMembers) || !member.kickable) {
        return `Error: bot lacks permission or member is not kickable.`;
      }
      await member.kick(args.reason);
      return `Successfully kicked member ${member.user.tag}. Reason: ${args.reason}`;
    }

    case "ban_member": {
      if (!checkToolAccess("ban_member", message.member)) return "Permission denied: You need admin permissions to ban members via AI.";
      const member = await safe.orNull(guild.members.fetch(args.userId), `tool: ban member ${args.userId}`);
      if (!member) return `Error: Member not found.`;
      if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers) || !member.bannable) {
        return `Error: bot lacks permission or member is not bannable.`;
      }
      await member.ban({ reason: args.reason, deleteMessageSeconds: 24 * 60 * 60 });
      return `Successfully banned member ${member.user.tag}. Reason: ${args.reason}`;
    }

    case "add_memory": {
      const mem = await aiMemory.add(guild.id, args.userId || null, args.content);
      if (!mem) return "Error: failed to add memory.";
      return `Successfully added memory fact: [Fact #${mem.id}] ${args.userId ? `for user <@${args.userId}>` : "for server"}: ${args.content}`;
    }

    case "forget_memory": {
      // Verify the memory belongs to this guild before deleting
      const memsForGuild = aiMemory.forGuild(guild.id);
      const target = memsForGuild.find(m => m.id === args.memoryId);
      if (!target) return `Error: memory fact #${args.memoryId} not found in this server.`;
      const deleted = await aiMemory.forget(args.memoryId);
      return deleted ? `Successfully deleted memory fact #${args.memoryId}.` : `Error: memory fact #${args.memoryId} not found.`;
    }

    case "search_web": {
      return searchWeb(args.query);
    }

    case "scrape_web_page": {
      return scrapeWebPage(args.url);
    }

    case "list_channels": {
      const textChannels = [...guild.channels.cache.values()]
        .filter(c => c.type === 0 || c.type === 5 || c.type === 15)
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));
      return JSON.stringify(textChannels.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        category: c.parent?.name || null,
        topic: c.topic || null,
      })), null, 2);
    }

    case "list_roles": {
      const rolesList = [...guild.roles.cache.values()]
        .filter(r => r.name !== "@everyone")
        .sort((a, b) => b.position - a.position);
      return JSON.stringify(rolesList.map(r => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        hoist: r.hoist,
        mentionable: r.mentionable,
        memberCount: r.members.size,
      })), null, 2);
    }

    case "get_server_info": {
      const owner = await safe.orNull(guild.fetchOwner(), "tool: fetch owner");
      return JSON.stringify({
        name: guild.name,
        id: guild.id,
        owner: owner?.user?.tag || "Unknown",
        memberCount: guild.memberCount,
        channelCount: guild.channels.cache.size,
        roleCount: guild.roles.cache.size,
        createdAt: guild.createdAt,
        verificationLevel: guild.verificationLevel,
        explicitContentFilter: guild.explicitContentFilter,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        premiumTier: guild.premiumTier,
      }, null, 2);
    }

    case "create_invite": {
      const ch = args.channelId ? await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch invite channel") : message.channel;
      if (!ch || typeof ch.createInvite !== "function") return "Error: invalid channel for invite.";
      const invite = await ch.createInvite({
        maxAge: args.maxAgeSeconds ?? 86400,
        maxUses: args.maxUses ?? 0,
        reason: "Created via AI tool",
      });
      return `Invite created: ${invite.url} (expires in ${invite.maxAge ? `${invite.maxAge}s` : "never"}, max uses: ${invite.maxUses || "unlimited"})`;
    }

    case "pin_message": {
      const pinCh = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch pin channel");
      if (!pinCh) return "Error: channel not found.";
      const pinMsg = await safe.orNull(pinCh.messages.fetch(args.messageId), "tool: fetch pin message");
      if (!pinMsg) return "Error: message not found.";
      await pinMsg.pin().catch(() => {});
      return `Pinned message ${args.messageId} in #${pinCh.name}.`;
    }

    case "unpin_message": {
      const unpinCh = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch unpin channel");
      if (!unpinCh) return "Error: channel not found.";
      const unpinMsg = await safe.orNull(unpinCh.messages.fetch(args.messageId), "tool: fetch unpin message");
      if (!unpinMsg) return "Error: message not found.";
      await unpinMsg.unpin().catch(() => {});
      return `Unpinned message ${args.messageId} in #${unpinCh.name}.`;
    }

    case "add_role": {
      if (!checkToolAccess("add_role", message.member)) return "Permission denied: You need moderator permissions to manage roles via AI.";
      const addRoleMember = await safe.orNull(guild.members.fetch(args.userId), "tool: fetch member add_role");
      if (!addRoleMember) return "Error: member not found.";
      const addRoleObj = guild.roles.cache.get(args.roleId);
      if (!addRoleObj) return "Error: role not found.";
      if (addRoleObj.position >= guild.members.me.roles.highest.position) return "Error: role is above bot's highest role.";
      await addRoleMember.roles.add(addRoleObj, "Added via AI tool").catch(() => {});
      return `Added role "${addRoleObj.name}" to ${addRoleMember.user.tag}.`;
    }

    case "remove_role": {
      if (!checkToolAccess("remove_role", message.member)) return "Permission denied: You need moderator permissions to manage roles via AI.";
      const remRoleMember = await safe.orNull(guild.members.fetch(args.userId), "tool: fetch member remove_role");
      if (!remRoleMember) return "Error: member not found.";
      const remRoleObj = guild.roles.cache.get(args.roleId);
      if (!remRoleObj) return "Error: role not found.";
      if (remRoleObj.position >= guild.members.me.roles.highest.position) return "Error: role is above bot's highest role.";
      await remRoleMember.roles.remove(remRoleObj, "Removed via AI tool").catch(() => {});
      return `Removed role "${remRoleObj.name}" from ${remRoleMember.user.tag}.`;
    }

    case "create_channel": {
      if (!checkToolAccess("create_channel", message.member)) return "Permission denied: You need admin permissions to create channels via AI.";
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return "Error: bot lacks Manage Channels permission.";
      const chanOpts = { name: args.name, type: 0, reason: "Created via AI tool" };
      if (args.categoryId) chanOpts.parent = args.categoryId;
      if (args.topic) chanOpts.topic = args.topic;
      if (args.nsfw) chanOpts.nsfw = true;
      const newCh = await guild.channels.create(chanOpts).catch(err => null);
      if (!newCh) return "Error: failed to create channel.";
      return `Created text channel #${newCh.name} (ID: ${newCh.id}).`;
    }

    case "purge_messages": {
      if (!checkToolAccess("purge_messages", message.member)) return "Permission denied: You need moderator permissions to purge messages via AI.";
      const purgeCh = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch purge channel");
      if (!purgeCh || purgeCh.type !== 0) return "Error: invalid text channel.";
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) return "Error: bot lacks Manage Messages permission.";
      const count = Math.min(args.count || 10, 100);
      const deleted = await purgeCh.bulkDelete(count, true).catch(err => null);
      if (!deleted) return "Error: failed to purge messages.";
      return `Purged ${deleted.size} messages from #${purgeCh.name}.`;
    }

    case "slowmode_set": {
      if (!checkToolAccess("slowmode_set", message.member)) return "Permission denied: You need moderator permissions to set slowmode via AI.";
      const slowCh = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch slowmode channel");
      if (!slowCh || typeof slowCh.setRateLimitPerUser !== "function") return "Error: invalid text channel.";
      await slowCh.setRateLimitPerUser(args.seconds, "Set via AI tool");
      return args.seconds > 0 ? `Set slowmode to ${args.seconds}s in #${slowCh.name}.` : `Disabled slowmode in #${slowCh.name}.`;
    }

    case "edit_message": {
      const editCh = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch edit channel");
      if (!editCh) return "Error: channel not found.";
      const editMsg = await safe.orNull(editCh.messages.fetch(args.messageId), "tool: fetch edit message");
      if (!editMsg) return "Error: message not found.";
      if (editMsg.author.id !== client.user.id) return "Error: can only edit messages sent by the bot.";
      await editMsg.edit({ content: args.content }).catch(() => {});
      return `Edited message ${args.messageId} in #${editCh.name}.`;
    }

    case "react_to_message": {
      const reactCh = await safe.orNull(guild.channels.fetch(args.channelId), "tool: fetch react channel");
      if (!reactCh) return "Error: channel not found.";
      const reactMsg = await safe.orNull(reactCh.messages.fetch(args.messageId), "tool: fetch react message");
      if (!reactMsg) return "Error: message not found.";
      await reactMsg.react(args.emoji).catch(() => {});
      return `Reacted with ${args.emoji} to message ${args.messageId}.`;
    }

    case "browse_page": {
      return browsePage(args.url);
    }

    default:
      return `Error: Unknown tool "${name}".`;
  }
}

module.exports = {
  getOpenAiTools,
  getAnthropicTools,
  executeTool
};
