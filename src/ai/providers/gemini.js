const { contentToGeminiParts } = require("../images");

function safeJsonParse(str, toolName) {
  try { return JSON.parse(str); } catch (e) {
    throw new Error(`Tool "${toolName}" arguments truncated or malformed (${str?.length || 0} chars) — try increasing aiMaxTokens. ${e.message}`);
  }
}

const DEFAULT_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

function convertMessagesToGemini(messages) {
  let systemInstruction = null;
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];

    if (msg.role === "tool") {
      parts.push({
        functionResponse: {
          name: msg.name || "tool_result",
          response: { result: msg.content || "" }
        }
      });
      contents.push({ role: "user", parts });
    } else {
      // Handle both string content and array content (text + images)
      if (msg.content) {
        if (Array.isArray(msg.content)) {
          parts.push(...contentToGeminiParts(msg.content));
        } else {
          parts.push({ text: msg.content });
        }
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function?.name || tc.name,
              args: typeof tc.function?.arguments === "string" 
                ? safeJsonParse(tc.function.arguments, tc.function?.name || tc.name) 
                : (tc.function?.arguments || tc.args || {})
            }
          });
        }
      }
      contents.push({ role, parts });
    }
  }

  return { systemInstruction, contents };
}

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools, thinkingEnabled }) {
  if (!apiKey) throw new Error("Gemini API key is not configured.");

  const modelId = model || DEFAULT_MODELS[0];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { systemInstruction, contents } = convertMessagesToGemini(messages);
  const body = {
    contents,
    generationConfig: {
      temperature: temperature !== undefined ? temperature : 0.7,
      maxOutputTokens: maxTokens || 4096,
    }
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (topP !== undefined) body.generationConfig.topP = topP;

  if (modelId.includes("thinking")) {
    body.generationConfig.thinkingConfig = {
      thinkingBudget: thinkingEnabled ? 2048 : 0
    };
  }

  if (tools && tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        }))
      }
    ];
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini API error (${res.status})`;
    throw new Error(msg);
  }

  const toolCalls = [];
  let text = "";

  for (const candidate of data?.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.text) {
        text += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini-${Date.now()}-${Math.random()}`,
          name: part.functionCall.name,
          args: part.functionCall.args
        });
      }
    }
  }

  return {
    text: text.trim(),
    toolCalls: toolCalls.length ? toolCalls : undefined
  };
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
