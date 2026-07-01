// DeepSeek — OpenAI-compatible API for DeepSeek LLMs.
// Endpoint: https://api.deepseek.com/v1
// Auth: Bearer token (DEEPSEEK_API_KEY)
// Known for ultra-cheap pricing and strong reasoning models.

const { safeJsonParse } = require("../parse");

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/v1/models";

const DEFAULT_MODELS = [
  "deepseek-chat",
  "deepseek-reasoner",
];

function isChatModel(id) {
  return !/(whisper|tts|embed|embedding|rerank|image|dall)/i.test(id);
}

async function listModels(apiKey) {
  const res = await fetch(DEEPSEEK_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `DeepSeek models API error (${res.status})`);

  const ids = (body.data || [])
    .map(m => m.id)
    .filter(isChatModel)
    .sort();

  return ids.length ? ids : DEFAULT_MODELS;
}

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools }) {
  if (!apiKey) throw new Error("DeepSeek API key is not configured.");

  const body = {
    model: model || DEFAULT_MODELS[0],
    messages,
    max_tokens: maxTokens || 8192,
    temperature: temperature !== undefined ? temperature : 0.7,
  };
  if (topP !== undefined) body.top_p = topP;
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  // Retry on 429 / 5xx (up to 2 retries)
  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error?.message || `DeepSeek API error (${res.status})`;
        if (attempt < MAX_RETRIES && (res.status === 429 || (res.status >= 500 && res.status < 600))) {
          const retryAfter = res.headers.get("retry-after")
            ? parseInt(res.headers.get("retry-after"), 10)
            : Math.min(2 + attempt * 2, 10);
          console.warn(`[deepseek] ${res.status} on attempt ${attempt + 1}, retrying in ${retryAfter}s`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          lastError = new Error(errMsg);
          continue;
        }
        throw new Error(errMsg);
      }

      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error("Empty response from DeepSeek.");

      return {
        text: msg.content || "",
        toolCalls: msg.tool_calls ? msg.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          args: safeJsonParse(tc.function.arguments, tc.function.name)
        })) : undefined
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && (
        err.message.includes("fetch") ||
        err.message.includes("network") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ETIMEDOUT") ||
        err.message.includes("rate limit")
      )) {
        const delay = Math.min(2 + attempt * 2, 10);
        console.warn(`[deepseek] Retry ${attempt + 1}/${MAX_RETRIES} after: ${err.message}`);
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("DeepSeek API request failed after retries.");
}

module.exports = {
  id: "deepseek",
  label: "DeepSeek",
  envVar: "DEEPSEEK_API_KEY",
  keyField: "deepseekApiKey",
  modelField: "deepseekModel",
  defaultModel: "deepseek-chat",
  defaultModels: DEFAULT_MODELS,
  listModels,
  chat,
};
