// NVIDIA NIM — OpenAI-compatible API for NVIDIA-hosted LLMs and self-hosted NIM instances.
// Primary endpoint: https://integrate.api.nvidia.com/v1
// Custom endpoint: configurable via baseUrl (for self-hosted NIM or alternative NVIDIA endpoints)
// Auth: Bearer token (NVIDIA_API_KEY)
// Model format: vendor/model-name (e.g. mistralai/ministral-14b-instruct-2512)

const { safeJsonParse } = require("../parse");

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";

const DEFAULT_MODELS = [
  // Mistral
  "mistralai/ministral-14b-instruct-2512",
  "mistralai/mistral-large-3-instruct",
  "mistralai/mistral-small-4-119b",
  // Meta Llama
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  // NVIDIA Nemotron
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "nvidia/nemotron-4-340b-instruct",
  "nvidia/nemotron-3-super-120b-a12b",
  // DeepSeek
  "deepseek-ai/deepseek-r1",
  "deepseek-ai/deepseek-v3-0324",
  // Qwen
  "qwen/qwen3-32b",
  "qwen/qwq-32b",
  // Google / Microsoft / other
  "google/gemma-3-27b-it",
  "microsoft/phi-3-mini-4k-instruct",
  // Community / research
  "z-ai/glm-5.1",
  "minimax/minimax-m2.5",
  "moonshotai/kimi-k2.5",
  "google/recurrentgemma-2-9b-it",
];

const FALLBACK_ENDPOINTS = [
  // Primary NVIDIA cloud endpoint
  "https://integrate.api.nvidia.com/v1",
];

function normalizeBase(base) {
  if (!base) return null;
  return String(base).trim().replace(/\/+$/, "");
}

function isChatModel(id) {
  return !/(whisper|tts|embed|embedding|rerank|guard|image|dall|stable-diffusion|vlm|vision)/i.test(id);
}

async function listModels(apiKey, { baseUrl } = {}) {
  const base = normalizeBase(baseUrl) || FALLBACK_ENDPOINTS[0];
  const url = `${base}/models`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `NVIDIA models API error (${res.status})`);

  const raw = Array.isArray(body) ? body
    : Array.isArray(body.data) ? body.data
    : [];

  const ids = raw
    .map(m => (typeof m === "string" ? m : m.id))
    .filter(Boolean)
    .filter(isChatModel)
    .sort();

  return ids.length ? ids : DEFAULT_MODELS;
}

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools, baseUrl }) {
  if (!apiKey) throw new Error("NVIDIA API key is not configured.");

  const base = normalizeBase(baseUrl) || FALLBACK_ENDPOINTS[0];
  const url = `${base}/chat/completions`;
  const resolvedModel = model || DEFAULT_MODELS[0];

  const body = {
    model: resolvedModel,
    messages,
    max_tokens: maxTokens || 4096,
    temperature: temperature !== undefined ? temperature : 0.7,
  };
  if (topP !== undefined) body.top_p = topP;
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  // Retry logic: retry up to 2 times on 429 (rate limit) or 5xx server errors
  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMsg = data?.error?.message || `NVIDIA API error (${res.status})`;

        // Retry on rate limits (429) or server errors (5xx)
        if (attempt < MAX_RETRIES && (res.status === 429 || (res.status >= 500 && res.status < 600))) {
          const retryAfter = res.status === 429
            ? parseInt(res.headers.get("retry-after") || "3", 10)
            : Math.min(2 + attempt * 2, 10);
          console.warn(`[nvidia] ${res.status} on attempt ${attempt + 1}, retrying in ${retryAfter}s: ${errMsg}`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          lastError = new Error(errMsg);
          continue;
        }

        throw new Error(errMsg);
      }

      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error("Empty response from NVIDIA NIM.");

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
      // Only retry on network/connection errors (HTTP statuses are handled above)
      if (attempt < MAX_RETRIES && (
        err.message.includes("fetch") ||
        err.message.includes("network") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ETIMEDOUT") ||
        err.message.includes("rate limit")
      )) {
        const delay = Math.min(2 + attempt * 2, 10);
        console.warn(`[nvidia] Retry ${attempt + 1}/${MAX_RETRIES} after error: ${err.message}`);
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("NVIDIA API request failed after retries.");
}

module.exports = {
  id: "nvidia",
  label: "NVIDIA NIM",
  envVar: "NVIDIA_API_KEY",
  keyField: "nvidiaApiKey",
  modelField: "nvidiaModel",
  baseUrlField: "nvidiaBaseUrl",
  defaultModel: "mistralai/ministral-14b-instruct-2512",
  defaultModels: DEFAULT_MODELS,
  listModels,
  chat,
};
