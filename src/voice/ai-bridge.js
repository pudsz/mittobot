// ─── AI Voice Bridge ────────────────────────────────────────────────────────
// Routes voice transcripts through the AI provider pipeline and returns the
// response text to be spoken via TTS.
//
// Reuses the existing AI infrastructure (providers, fallbacks, memories,
// conversation storage) but skips the text-channel-specific parts.

const settings = require("../settings");
const aiMemory = require("../ai/memory");
const db = require("../db");

/**
 * Process a voice transcript through the AI and return a spoken response.
 * @param {Object} opts
 * @param {string} opts.guildId - Discord guild ID
 * @param {string} opts.userId - Discord user ID
 * @param {string} opts.username - User's display name
 * @param {string} opts.transcript - Recognized speech text
 * @param {object} opts.guild - Discord guild object
 * @returns {Promise<{text: string, toolResults?: string}>}
 */
async function processVoiceInput({ guildId, userId, username, transcript, guild }) {
  if (!settings.get("aiEnabled")) {
    return { text: "AI is currently disabled." };
  }

  try {
    // 1. Get the active provider
    const { getProvider } = require("../ai/providers");
    const providerId = settings.get("aiProvider") || "groq";
    const model = settings.getAiModel(providerId);
    const provider = getProvider(providerId);
    if (!provider) {
      return { text: "AI provider not configured." };
    }

    // 2. Build system prompt
    const baseSystem = settings.get("aiSystemPrompt") || "";
    const systemPrompt = [
      baseSystem,
      "",
      "### VOICE MODE",
      "You are speaking to the user via voice chat. Important notes:",
      "- Keep responses concise — long text takes time to speak.",
      "- Use natural, conversational language suitable for speech.",
      "- Avoid markdown formatting, code blocks, and lists (they don't work in voice).",
      "- If you need to share code or complex info, mention you'll send it in text.",
      "- Pause between topics by letting the user respond.",
      "- You cannot hear tone or emphasis, so be clear and direct.",
      `- Speaker: ${username} (id:${userId})`,
    ].join("\n");

    // 3. Get relevant memories
    const recentMemories = aiMemory.forGuild(guildId).slice(0, 10);
    const userMemories = userId ? aiMemory.forUser(guildId, userId).slice(0, 5) : [];
    const allMemories = [...userMemories, ...recentMemories];
    const memoryBlock = allMemories.length
      ? `\nRelevant memories:\n${allMemories.map(m => `- ${m.content}`).join("\n")}`
      : "";

    // 4. Build conversation history from DB
    const history = await db.getAiConversations(guildId, null, userId, "dm");
    const recentHistory = (history || []).slice(-10).map(row => ({
      role: row.role,
      content: row.content,
    }));

    // 5. Build messages array for the provider
    const messages = [
      { role: "system", content: systemPrompt + memoryBlock },
      ...recentHistory,
      { role: "user", content: transcript },
    ];

    // 6. Call the provider (with fallback chain)
    const fallbackIds = (settings.get("aiFallbackProviders") || "").split(",").map(x => x.trim()).filter(Boolean);
    const allProviderIds = [providerId, ...fallbackIds];
    let response = null;
    for (const pid of allProviderIds) {
      const p = pid === providerId ? provider : getProvider(pid);
      if (!p || !p.chat) continue;
      const pmodel = pid === providerId ? model : settings.getAiModel(pid);
      try {
        response = await p.chat(messages, pmodel, guild, {
          tools: [],
          toolChoice: "none",
        });
        if (response?.text) break;
      } catch (fbErr) {
        console.warn("[voice:ai-bridge] Fallback", pid, "failed:", fbErr.message);
        continue;
      }
    }

    // 7. Auto-extract memories from the conversation (background, best-effort)
    try {
      const memMod = require("../ai/memory");
      if (typeof memMod.autoExtract === "function") {
        memMod.autoExtract(transcript, (response && response.text) || "", guildId, userId)
          .catch(e => console.warn("[voice:ai-bridge] Memory extraction:", e.message));
      }
    } catch { /* best-effort */ }

    // 8. Save conversation to DB
    try {
      await db.saveAiConversation(guildId, null, userId, "user", transcript);
      if (response?.text) {
        await db.saveAiConversation(guildId, null, userId, "assistant", response.text);
      }
    } catch { /* best-effort */ }

    return {
      text: response?.text || "I didn't catch that — could you repeat it?",
    };
  } catch (err) {
    console.error("[voice:ai-bridge]", err.message);
    return { text: "Sorry, I had trouble processing that. Try again?" };
  }
}

module.exports = { processVoiceInput };
