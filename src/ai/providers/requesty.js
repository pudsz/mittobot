// Requesty — OpenAI-compatible routing API for multi-model access.
// Endpoint: https://router.requesty.ai/v1
// Auth: Bearer token (REQUESTY_API_KEY)

const { safeJsonParse } = require("../parse");

const REQUESTY_URL = "https://router.requesty.ai/v1/chat/completions";
const REQUESTY_MODELS_URL = "https://router.requesty.ai/v1/models";

const DEFAULT_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1",
  "openai/o3-mini",
  "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-3-5-haiku-latest",
  "google/gemini-2.0-flash-001",
  "google/gemini-2.5-pro-preview-03-25",
  "meta-llama/llama-3.3-70b-instruct",
  "deepseek/deepseek-chat-v3-2",
];

function isChatModel(id) {
  return !/(whisper|tts|embed|embedding|rerank|image|dall|stable-diffusion)/i.test(id);
}

async function listModels(apiKey) {
  const res = await fetch(REQUESTY_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.error?.message || `Requesty models API error (${res.status})`);

  const ids = (body.data || [])
    .map(m => m.id)
    .filter(isChatModel)
    .sort();

  return ids.length ? ids : DEFAULT_MODELS;
}

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools }) {
  if (!apiKey) throw new Error("Requesty API key is not configured.");

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

  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(REQUESTY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error?.message || `Requesty API error (${res.status})`;
        if (attempt < MAX_RETRIES && (res.status === 429 || (res.status >= 500 && res.status < 600))) {
          const retryAfter = res.headers.get("retry-after")
            ? parseInt(res.headers.get("retry-after"), 10)
            : Math.min(2 + attempt * 2, 10);
          console.warn(`[requesty] ${res.status} on attempt ${attempt + 1}, retrying in ${retryAfter}s`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          lastError = new Error(errMsg);
          continue;
        }
        throw new Error(errMsg);
      }

      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error("Empty response from Requesty.");

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
        console.warn(`[requesty] Retry ${attempt + 1}/${MAX_RETRIES} after: ${err.message}`);
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Requesty API request failed after retries.");
}

module.exports = {
  id: "requesty",
  label: "Requesty",
  envVar: "REQUESTY_API_KEY",
  keyField: "requestyApiKey",
  modelField: "requestyModel",
  defaultModel: "openai/gpt-4o-mini",
  defaultModels: DEFAULT_MODELS,
  listModels,
  chat,
};
