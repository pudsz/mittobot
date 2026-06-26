const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

function safeJsonParse(str, toolName) {
  try { return JSON.parse(str); } catch (e) {
    throw new Error(`Tool "${toolName}" arguments truncated or malformed (${str?.length || 0} chars) — try increasing aiMaxTokens. ${e.message}`);
  }
}

const DEFAULT_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
  "moonshotai/kimi-k2-instruct-0905",
];

const DEPRECATED_MODELS = {
  "mixtral-8x7b-32768":       "llama-3.3-70b-versatile",
  "gemma2-9b-it":             "llama-3.1-8b-instant",
  "llama-3.1-70b-versatile":  "llama-3.3-70b-versatile",
  "llama-3.1-70b-specdec":    "llama-3.3-70b-versatile",
  "llama3-70b-8192":          "llama-3.3-70b-versatile",
  "llama3-8b-8192":           "llama-3.1-8b-instant",
};

function resolveModel(model) {
  const id = String(model || "").trim();
  return DEPRECATED_MODELS[id] || id || DEFAULT_MODELS[0];
}

function isChatModel(id) {
  return !/(whisper|tts|guard|distil-whisper)/i.test(id);
}

async function listModels(apiKey) {
  const res = await fetch(GROQ_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Groq models API error (${res.status})`);

  const ids = (body.data || [])
    .filter(m => m.active !== false && isChatModel(m.id))
    .map(m => m.id)
    .sort();

  return ids.length ? ids : DEFAULT_MODELS;
}

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools }) {
  if (!apiKey) throw new Error("Groq API key is not configured.");

  const resolved = resolveModel(model);

  const body = {
    model: resolved,
    messages,
    max_completion_tokens: maxTokens || 4096,
    temperature: temperature !== undefined ? temperature : 0.7,
  };
  if (topP !== undefined) body.top_p = topP;
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Groq API error (${res.status})`);
  }

  const msg = data?.choices?.[0]?.message;
  if (!msg) throw new Error("Empty response from Groq.");

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
  id: "groq",
  label: "Groq",
  envVar: "GROQ_API_KEY",
  keyField: "groqApiKey",
  modelField: "groqModel",
  defaultModel: "llama-3.3-70b-versatile",
  defaultModels: DEFAULT_MODELS,
  resolveModel,
  listModels,
  chat,
};
