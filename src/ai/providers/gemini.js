const DEFAULT_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

function buildGeminiBody(messages) {
  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  return body;
}

async function chat(messages, { apiKey, model }) {
  if (!apiKey) throw new Error("Gemini API key is not configured.");

  const modelId = model || DEFAULT_MODELS[0];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...buildGeminiBody(messages),
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Gemini API error (${res.status})`;
    throw new Error(msg);
  }

  const content = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error("Empty response from Gemini.");
  return content.trim();
}

module.exports = {
  id: "gemini",
  label: "Gemini",
  envVar: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  keyField: "geminiApiKey",
  modelField: "geminiModel",
  defaultModel: "gemini-2.0-flash",
  defaultModels: DEFAULT_MODELS,
  chat,
};
