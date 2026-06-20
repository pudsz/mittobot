const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

const DEFAULT_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1",
  "o3-mini",
];

function isChatModel(id) {
  return /^(gpt-|o[134]|chatgpt-)/i.test(id);
}

async function listModels(apiKey) {
  const res = await fetch(OPENAI_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `OpenAI models API error (${res.status})`);

  const ids = (body.data || [])
    .map(m => m.id)
    .filter(isChatModel)
    .sort();

  return ids.length ? ids : DEFAULT_MODELS;
}

async function chat(messages, { apiKey, model }) {
  if (!apiKey) throw new Error("OpenAI API key is not configured.");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS[0],
      messages,
      max_completion_tokens: 1024,
      temperature: 0.7,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message || `OpenAI API error (${res.status})`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI.");
  return content.trim();
}

module.exports = {
  id: "openai",
  label: "OpenAI",
  envVar: "OPENAI_API_KEY",
  keyField: "openaiApiKey",
  modelField: "openaiModel",
  defaultModel: "gpt-4o-mini",
  defaultModels: DEFAULT_MODELS,
  listModels,
  chat,
};
