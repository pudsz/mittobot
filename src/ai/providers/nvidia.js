// NVIDIA NIM — OpenAI-compatible API for NVIDIA-hosted LLMs.
// Endpoint: https://integrate.api.nvidia.com/v1
// Auth: Bearer token (NVIDIA_API_KEY)
// Model format: vendor/model-name (e.g. mistralai/ministral-14b-instruct-2512)

const { safeJsonParse } = require("../parse");

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";

const DEFAULT_MODELS = [
  "mistralai/ministral-14b-instruct-2512",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-8b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "qwen/qwen3-32b",
  "deepseek-ai/deepseek-r1",
];

function isChatModel(id) {
  return !/(whisper|tts|embed|embedding|rerank|guard|image|dall|stable-diffusion|vlm|vision)/i.test(id);
}

async function listModels(apiKey) {
  const res = await fetch(NVIDIA_MODELS_URL, {
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

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools }) {
  if (!apiKey) throw new Error("NVIDIA API key is not configured.");

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

  const res = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `NVIDIA API error (${res.status})`);
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
}

module.exports = {
  id: "nvidia",
  label: "NVIDIA NIM",
  envVar: "NVIDIA_API_KEY",
  keyField: "nvidiaApiKey",
  modelField: "nvidiaModel",
  defaultModel: "mistralai/ministral-14b-instruct-2512",
  defaultModels: DEFAULT_MODELS,
  listModels,
  chat,
};
