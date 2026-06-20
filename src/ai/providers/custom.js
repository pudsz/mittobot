// Generic provider for any OpenAI-compatible or Anthropic-compatible endpoint.
// The user supplies a base URL (e.g. https://api.together.xyz/v1 or
// http://localhost:11434/v1) and picks the wire format. Models are fetched
// live from the endpoint's /models route.

const DEFAULT_MODELS = [];

function normalizeBase(baseUrl) {
  let base = String(baseUrl || "").trim();
  if (!base) throw new Error("Custom provider: base URL is not configured.");
  return base.replace(/\/+$/, ""); // strip trailing slashes
}

function isChatModel(id) {
  // Filter out obvious non-chat artifacts; keep everything else.
  return !/(whisper|tts|embed|embedding|moderation|rerank|guard|image|dall-?e|stable-diffusion|distil-whisper)/i.test(id);
}

// ─── Model listing (OpenAI: {data:[{id}]}, Anthropic: {data:[{id}]})
async function listModels(apiKey, { baseUrl, apiType } = {}) {
  const base = normalizeBase(baseUrl);
  const url = `${base}/models`;

  const headers = { "Content-Type": "application/json" };
  if (apiType === "anthropic") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || body?.error || `Models API error (${res.status}) at ${url}`);
  }

  // OpenAI-style { data: [{id}] }; some servers return a bare array or { models: [...] }.
  const raw = Array.isArray(body) ? body
    : Array.isArray(body.data) ? body.data
    : Array.isArray(body.models) ? body.models
    : [];

  const ids = raw
    .map(m => (typeof m === "string" ? m : m.id || m.name))
    .filter(Boolean)
    .filter(isChatModel)
    .sort();

  return [...new Set(ids)];
}

// ─── OpenAI-compatible chat
async function chatOpenAI(messages, { apiKey, model, base }) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.7 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.error || `Custom API error (${res.status})`);
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from custom endpoint.");
  return content.trim();
}

// ─── Anthropic-compatible chat
async function chatAnthropic(messages, { apiKey, model, base }) {
  let system = "";
  const out = [];
  for (const msg of messages) {
    if (msg.role === "system") system = system ? `${system}\n\n${msg.content}` : msg.content;
    else out.push({ role: msg.role, content: msg.content });
  }
  const payload = { model, max_tokens: 1024, messages: out };
  if (system) payload.system = system;

  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.error || `Custom API error (${res.status})`);
  const content = body?.content?.[0]?.text;
  if (!content) throw new Error("Empty response from custom endpoint.");
  return content.trim();
}

async function chat(messages, { apiKey, model, baseUrl, apiType }) {
  const base = normalizeBase(baseUrl);
  if (!model) throw new Error("Custom provider: no model selected.");
  return apiType === "anthropic"
    ? chatAnthropic(messages, { apiKey, model, base })
    : chatOpenAI(messages, { apiKey, model, base });
}

module.exports = {
  id: "custom",
  label: "Custom (OpenAI/Anthropic-compatible)",
  envVar: "CUSTOM_AI_API_KEY",
  keyField: "customApiKey",
  modelField: "customModel",
  defaultModel: "",
  defaultModels: DEFAULT_MODELS,
  // Extra config fields this provider reads from settings.
  baseUrlField: "customBaseUrl",
  apiTypeField: "customApiType",
  listModels,
  chat,
};
