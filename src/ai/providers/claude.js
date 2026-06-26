const { contentToAnthropicBlocks } = require("../images");

function safeJsonParse(str, toolName) {
  try { return JSON.parse(str); } catch (e) {
    throw new Error(`Tool "${toolName}" arguments truncated or malformed (${str?.length || 0} chars) — try increasing aiMaxTokens. ${e.message}`);
  }
}

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

const DEFAULT_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
];

function convertMessagesToAnthropic(messages) {
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
      if (msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function?.name || tc.name,
            input: typeof tc.function?.arguments === "string" 
              ? safeJsonParse(tc.function.arguments, tc.function?.name || tc.name) 
              : (tc.function?.arguments || tc.args || {})
          });
        }
      }
      out.push({
        role: "assistant",
        content: contentBlocks.length === 1 && contentBlocks[0].type === "text" ? contentBlocks[0].text : contentBlocks
      });
    } else if (msg.role === "tool") {
      const contentBlocks = [];
      let j = i;
      while (j < messages.length && messages[j].role === "tool") {
        const toolMsg = messages[j];
        contentBlocks.push({
          type: "tool_result",
          tool_use_id: toolMsg.tool_call_id,
          content: toolMsg.content || ""
        });
        j++;
      }
      i = j - 1;
      out.push({
        role: "user",
        content: contentBlocks
      });
    } else {
      // Handle array content (text + images from vision support)
      out.push({
        role: "user",
        content: contentToAnthropicBlocks(msg.content)
      });
    }
  }

  return { system, messages: out };
}

async function chat(messages, { apiKey, model, temperature, maxTokens, topP, tools }) {
  if (!apiKey) throw new Error("Claude API key is not configured.");

  const { system, messages: chatMessages } = convertMessagesToAnthropic(messages);
  const body = {
    model: model || DEFAULT_MODELS[0],
    max_tokens: maxTokens || 4096,
    messages: chatMessages,
    temperature: temperature !== undefined ? temperature : 0.7,
  };
  if (system) body.system = system;
  if (topP !== undefined) body.top_p = topP;
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
    body.tool_choice = { type: "auto" };
  }

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

  const toolCalls = [];
  let text = "";

  for (const block of data.content || []) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: block.input
      });
    }
  }

  return {
    text: text.trim(),
    toolCalls: toolCalls.length ? toolCalls : undefined
  };
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
