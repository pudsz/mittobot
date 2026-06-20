const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

const DEFAULT_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
];

function splitMessages(messages) {
  let system = "";
  const out = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      system = system ? `${system}\n\n${msg.content}` : msg.content;
    } else {
      out.push({ role: msg.role, content: msg.content });
    }
  }
  return { system, messages: out };
}

async function chat(messages, { apiKey, model }) {
  if (!apiKey) throw new Error("Claude API key is not configured.");

  const { system, messages: chatMessages } = splitMessages(messages);
  const body = {
    model: model || DEFAULT_MODELS[0],
    max_tokens: 1024,
    messages: chatMessages,
  };
  if (system) body.system = system;

  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Claude API error (${res.status})`;
    throw new Error(msg);
  }

  const content = data?.content?.[0]?.text;
  if (!content) throw new Error("Empty response from Claude.");
  return content.trim();
}

module.exports = {
  id: "claude",
  label: "Claude",
  envVar: "ANTHROPIC_API_KEY",
  keyField: "claudeApiKey",
  modelField: "claudeModel",
  defaultModel: "claude-sonnet-4-20250514",
  defaultModels: DEFAULT_MODELS,
  chat,
};
