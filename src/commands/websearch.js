const { EmbedBuilder, SlashCommandBuilder, MessageFlags } = require("discord.js");
const { errorEmbed } = require("../utils");
const safe = require("../safe");

const BLURPLE = 0x5865f2;

// Shared search logic — calls DuckDuckGo HTML endpoint, parses results
async function searchDuckDuckGo(query) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  const results = [];
  const sections = text.split('class="result__body"');
  for (let i = 1; i < Math.min(sections.length, 8); i++) {
    const sec = sections[i];
    const titleMatch = sec.match(/<a class="result__url"[^>]*>([\s\S]*?)<\/a>/i);
    const linkMatch = sec.match(/href="([^"]+)"/i);
    const snippetMatch = sec.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    if (linkMatch) {
      results.push({
        title: titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : "Link",
        url: linkMatch[1],
        snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : "",
      });
    }
  }
  return results;
}

// ─── Prefix command ─────────────────────────────────────────────────────────

async function prefixWebSearch(message, args, ctx) {
  const query = args.join(" ").trim();
  if (!query) return message.reply({ embeds: [errorEmbed("Usage: $websearch <query>")] });

  const status = await message.reply({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`🔍 Searching for: **${query.slice(0, 100)}**...`)] });

  try {
    const results = await searchDuckDuckGo(query);
    if (!results || !results.length) {
      return status.edit({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🔍 No results").setDescription(`No search results found for **${query.slice(0, 100)}**.`)] });
    }

    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(`🔍 Web Search: ${query.slice(0, 200)}`)
      .setDescription(results.slice(0, 5).map((r, i) =>
        `**${i + 1}.** [${r.title}](${r.url})\n${r.snippet || "*No description*"}`
      ).join("\n\n"))
      .setFooter({ text: `DuckDuckGo · ${results.length} results` })
      .setTimestamp();

    await status.edit({ embeds: [embed] });
  } catch (err) {
    await status.edit({ embeds: [errorEmbed(`Search failed: ${err.message}`)] });
  }
}

// ─── Slash command ──────────────────────────────────────────────────────────

async function slashWebSearch(interaction, ctx) {
  const query = interaction.options.getString("query");
  await interaction.deferReply();

  try {
    const results = await searchDuckDuckGo(query);
    if (!results || !results.length) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle("🔍 No results").setDescription(`No results for **${query.slice(0, 100)}**.`)] });
    }

    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(`🔍 ${query.slice(0, 200)}`)
      .setDescription(results.slice(0, 5).map((r, i) =>
        `**${i + 1}.** [${r.title}](${r.url})\n${r.snippet || "*No description*"}`
      ).join("\n\n"))
      .setFooter({ text: `DuckDuckGo · ${results.length} results` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ embeds: [errorEmbed(`Search failed: ${err.message}`)] });
  }
}

module.exports = [{
  name: "websearch",
  description: "Search the web via DuckDuckGo",
  prefix: prefixWebSearch,
  slash: new SlashCommandBuilder()
    .setName("websearch")
    .setDescription("Search the web via DuckDuckGo")
    .addStringOption(o => o.setName("query").setDescription("Search query").setRequired(true).setMaxLength(500)),
  execute: slashWebSearch,
}];
