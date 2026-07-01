// Together AI — OpenAI-compatible API for Together-hosted LLMs.
// Endpoint: https://api.together.xyz/v1
// Auth: Bearer token (TOGETHER_API_KEY)
// Known for wide model selection, generous free tier credits, and high throughput.

const { safeJsonParse } = require("../parse");

const TOGETHER_URL = "https://api.together.xyz/v1/chat/completions";
const TOGETHER_MODELS_URL = "https://api.together.xyz/v1/models";

const DEFAULT_MODELS = [
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
  "meta-llama/Llama-3.1-8B-Instruct-Turbo",
  "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
  "mistralai/Mixtral-8x22B-Instruct-v0.1",
  "deepseek-ai/DeepSeek-R1",
  "deepseek-ai/DeepSeek-V3",
  "Qwen/Qwen3-32B",
  "google/gemma-3-27b-it",
  "microsoft/Phi-3.5-mini-instruct",
];

function isChatModel(id) {
  return !/(whisper|tts|embed|embedding|rerank|image|dall|stable-diffusion)/i.test(id);
}

async function listModels(apiKey) {
  const res = await fetch(TOGETHER_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Together models API error (${res.status})`);

  // Together returns { data: [{ id, ... }] }
  const ids = (body.data || [])
    .filter(m => m.id && isChatModel(m.id))
    .map(m => m.id)
    .sort();

  return ids.length ? ids : DEFAULT_MODELS;
}

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools }) {
  if (!apiKey) throw new Error("Together AI API key is not configured.");

  const body = {
    model: model || DEFAULT_MODELS[0],
    messages,
    max_tokens: maxTokens || 4096,
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
      const res = await fetch(TOGETHER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error?.message || `Together API error (${res.status})`;
        if (attempt < MAX_RETRIES && (res.status === 429 || (res.status >= 500 && res.status < 600))) {
          const retryAfter = res.headers.get("retry-after")
            ? parseInt(res.headers.get("retry-after"), 10)
            : Math.min(2 + attempt * 2, 10);
          console.warn(`[together] ${res.status} on attempt ${attempt + 1}, retrying in ${retryAfter}s`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          lastError = new Error(errMsg);
          continue;
        }
        throw new Error(errMsg);
      }

      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error("Empty response from Together AI.");

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
        console.warn(`[together] Retry ${attempt + 1}/${MAX_RETRIES} after: ${err.message}`);
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Together AI request failed after retries.");
}

module.exports = {
  id: "together",
  label: "Together AI",
  envVar: "TOGETHER_API_KEY",
  keyField: "togetherApiKey",
  modelField: "togetherModel",
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  defaultModels: DEFAULT_MODELS,
  listModels,
  chat,
};
