const { PermissionFlagsBits } = require("discord.js");
const safe = require("../safe");
const aiMemory = require("./memory");

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

async function executeTool(name, args, ctx, message) {
  const { client, data } = ctx;
  const guild = message.guild;

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
      const member = await safe.orNull(guild.members.fetch(args.userId), `tool: warn member ${args.userId}`);
      if (!member) return `Error: Member not found.`;
      data.addWarning(guild.id, member.id, { reason: args.reason, by: `AI Assistant (${client.user.tag})`, timestamp: Date.now() });
      const count = data.getWarnings(guild.id, member.id).length;
      return `Successfully warned member ${member.user.tag} (total warnings: ${count}). Reason: ${args.reason}`;
    }

    case "mute_member": {
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
      const member = await safe.orNull(guild.members.fetch(args.userId), `tool: kick member ${args.userId}`);
      if (!member) return `Error: Member not found.`;
      if (!guild.members.me.permissions.has(PermissionFlagsBits.KickMembers) || !member.kickable) {
        return `Error: bot lacks permission or member is not kickable.`;
      }
      await member.kick(args.reason);
      return `Successfully kicked member ${member.user.tag}. Reason: ${args.reason}`;
    }

    case "ban_member": {
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
      return `Successfully added memory fact: [Fact #${mem.id}] ${args.userId ? `for user <@${args.userId}>` : "for server"}: ${args.content}`;
    }

    case "forget_memory": {
      const deleted = await aiMemory.forget(args.memoryId);
      return deleted ? `Successfully deleted memory fact #${args.memoryId}.` : `Error: memory fact #${args.memoryId} not found.`;
    }

    case "search_web": {
      return searchWeb(args.query);
    }

    case "scrape_web_page": {
      return scrapeWebPage(args.url);
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
