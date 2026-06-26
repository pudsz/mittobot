// Generic provider for any OpenAI-compatible or Anthropic-compatible endpoint.
// The user supplies a base URL (e.g. https://api.together.xyz/v1 or
// http://0.0.0.0:11434/v1) and picks the wire format. Models are fetched
// live from the endpoint's /models route.

const { contentToAnthropicBlocks } = require("../images");

function safeJsonParse(str, toolName) {
  try { return JSON.parse(str); } catch (e) {
    throw new Error(`Tool "${toolName}" arguments truncated or malformed (${str?.length || 0} chars) — try increasing aiMaxTokens. ${e.message}`);
  }
}

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

// ─── OpenAI-compatible chat (with tool calling)
async function chatOpenAI(messages, { apiKey, model, base, temperature, maxTokens, topP, tools }) {
  const body = {
    model,
    messages,
    max_completion_tokens: maxTokens || 4096,
    temperature: temperature !== undefined ? temperature : 0.7
  };
  if (topP !== undefined) body.top_p = topP;
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const bodyData = await res.json().catch(() => ({}));
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "3", 10);
    throw new Error(`Custom API rate limited — retry after ${retryAfter}s`);
  }
  if (!res.ok) throw new Error(bodyData?.error?.message || bodyData?.error || `Custom API error (${res.status})`);
  const msg = bodyData?.choices?.[0]?.message;
  if (!msg) throw new Error("Empty response from custom endpoint.");
  return {
    text: (msg.content || "").trim(),
    toolCalls: msg.tool_calls ? msg.tool_calls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      args: safeJsonParse(tc.function.arguments, tc.function.name)
    })) : undefined
  };
}

// ─── Anthropic-compatible chat (with tool calling)
async function chatAnthropic(messages, { apiKey, model, base, temperature, maxTokens, topP, tools }) {
  let system = "";
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") {
      system = system ? `${system}\n\n${msg.content}` : msg.content;
      continue;
    }
    if (msg.role === "assistant") {
      const contentBlocks = [];
      if (msg.content) contentBlocks.push({ type: "text", text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function?.name || tc.name,
            input: typeof tc.function?.arguments === "string"              ? safeJsonParse(tc.function.arguments, tc.function?.name || tc.name) 
              : (tc.function?.arguments || tc.args || {})
          });
        }
      }
      out.push({
        role: "assistant",
        content: contentBlocks.length === 1 && contentBlocks[0].type === "text" ? contentBlocks[0].text : contentBlocks
      });
    } else if (msg.role === "tool") {
      // Group consecutive tool messages into a single user message
      const toolBlocks = [];
      let j = i;
      while (j < messages.length && messages[j].role === "tool") {
        const tm = messages[j];
        toolBlocks.push({
          type: "tool_result",
          tool_use_id: tm.tool_call_id,
          content: tm.content || ""
        });
        j++;
      }
      i = j - 1;
      out.push({ role: "user", content: toolBlocks });
    } else {
      // Handle array content (text + images from vision support)
      out.push({ role: msg.role, content: contentToAnthropicBlocks(msg.content) });
    }
  }
  const payload = {
    model,
    max_tokens: maxTokens || 4096,
    messages: out,
    temperature: temperature !== undefined ? temperature : 0.7
  };
  if (system) payload.system = system;
  if (topP !== undefined) payload.top_p = topP;
  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
    payload.tool_choice = { type: "auto" };
  }

  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const bodyData = await res.json().catch(() => ({}));
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "3", 10);
    throw new Error(`Custom API rate limited — retry after ${retryAfter}s`);
  }
  if (!res.ok) throw new Error(bodyData?.error?.message || bodyData?.error || `Custom API error (${res.status})`);

  const toolCalls = [];
  let text = "";
  for (const block of (bodyData?.content || [])) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input });
  }
  return {
    text: text.trim(),
    toolCalls: toolCalls.length ? toolCalls : undefined
  };
}

async function chat(messages, { apiKey, model, baseUrl, apiType, temperature, maxTokens, topP, tools }) {
  const base = normalizeBase(baseUrl);
  if (!model) throw new Error("Custom provider: no model selected.");
  return apiType === "anthropic"
    ? chatAnthropic(messages, { apiKey, model, base, temperature, maxTokens, topP, tools })
    : chatOpenAI(messages, { apiKey, model, base, temperature, maxTokens, topP, tools });
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
