import { useEffect, useState } from "react";
import { Sparkles, Save, Trash2, RotateCw, Database } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";

const AI_KEY_PLACEHOLDERS = {
  groq: "gsk_...",
  openai: "sk-...",
  claude: "sk-ant-...",
  gemini: "AIza...",
  custom: "api key (leave blank if not required, e.g. local Ollama)",
};

function AiSkeleton() {
  return (
    <div className="tab active">
      <div className="panel">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-text" style={{ width: "80%" }} />
        <div className="skeleton skeleton-text" style={{ width: "60%" }} />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div className="skeleton skeleton-text" style={{ width: "15%", height: 10, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 40, borderRadius: "var(--radius-sm)" }} />
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="skeleton skeleton-heading" style={{ width: "50%" }} />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    </div>
  );
}

export default function AiTab() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiType, setCustomApiType] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [allowedChannels, setAllowedChannels] = useState("");
  const [ignoredChannels, setIgnoredChannels] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelHint, setModelHint] = useState("");

  // Advanced parameters
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [topP, setTopP] = useState(1.0);
  const [contextLimit, setContextLimit] = useState(8);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  // Memories
  const [memories, setMemories] = useState([]);
  const [newMemContent, setNewMemContent] = useState("");
  const [newMemUserId, setNewMemUserId] = useState("");
  const [memSearch, setMemSearch] = useState("");

  function applyState(d) {
    setS(d);
    setEnabled(!!d.aiEnabled);
    setApiKey("");
    setAllowedChannels(d.aiAllowedChannels || "");
    setIgnoredChannels(d.aiIgnoredChannels || "");
    setSystemPrompt(d.aiSystemPrompt || "");
    setProvider(d.aiProvider || (d.providers && d.providers[0] && d.providers[0].id) || "");
    setCustomBaseUrl(d.customBaseUrl || "");
    setCustomApiType(d.customApiType || "openai");

    const models = [...(d.models || [])];
    const current = d.model || "";
    if (current && !models.includes(current)) models.unshift(current);
    if (current) setModel(current);
    else if (models.length) setModel(models[0]);
    else setModel("");
    setCustomModel("");

    // Advanced parameters
    setTemperature(d.aiTemperature ?? 0.7);
    setMaxTokens(d.aiMaxTokens ?? 1024);
    setTopP(d.aiTopP ?? 1.0);
    setContextLimit(d.aiContextLimit ?? 8);
    setToolsEnabled(d.aiToolsEnabled !== false);
    setMemoryEnabled(d.aiMemoryEnabled !== false);
    setThinkingEnabled(!!d.aiThinkingEnabled);
  }

  async function loadMemories() {
    try {
      const res = await api("GET", "/api/ai/memories");
      setMemories(res.memories || []);
    } catch (e) {
      console.error("Failed to load memories:", e);
    }
  }

  async function load() {
    try {
      applyState(await api("GET", "/api/ai"));
      await loadMemories();
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const meta = (s?.providers || []).find((p) => p.id === provider);
  const label = meta?.label || provider;
  const isCustom = Boolean(meta?.baseUrlField) || provider === "custom";

  // model dropdown options (current model prepended if missing)
  let modelOptions = [];
  if (s) {
    modelOptions = [...(s.models || [])];
    const current = s.model || "";
    if (current && !modelOptions.includes(current)) modelOptions.unshift(current);
  }

  function buildBody() {
    const selModel = model.trim();
    const cust = customModel.trim();
    const finalModel = cust || selModel;
    const body = {
      aiEnabled: enabled,
      aiProvider: provider,
      aiAllowedChannels: allowedChannels.trim(),
      aiIgnoredChannels: ignoredChannels.trim(),
      aiSystemPrompt: systemPrompt,
      aiTemperature: Number(temperature),
      aiMaxTokens: Number(maxTokens),
      aiTopP: Number(topP),
      aiContextLimit: Number(contextLimit),
      aiToolsEnabled: toolsEnabled,
      aiMemoryEnabled: memoryEnabled,
      aiThinkingEnabled: thinkingEnabled,
    };
    if (finalModel) body.model = finalModel;
    if (isCustom) {
      body.customBaseUrl = customBaseUrl.trim();
      body.customApiType = customApiType;
    }
    const key = apiKey.trim();
    if (key) body.apiKey = key;
    return { body, finalModel };
  }

  async function saveAi() {
    const { body, finalModel } = buildBody();
    if (!finalModel && !isCustom) return toast("Select a model from the list", true);
    try {
      await api("POST", "/api/ai", body);
      toast("AI settings saved");
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function refreshModels() {
    setModelHint("Fetching models\u2026");
    const { body, finalModel } = buildBody();
    if (!finalModel && !isCustom) {
      setModelHint("");
      return toast("Select a model from the list", true);
    }
    try {
      const d = await api("POST", "/api/ai", body);
      applyState(d);
      const n = (d.models || []).length;
      setModelHint(n ? `Loaded ${n} model${n === 1 ? "" : "s"}.` : "No models returned \u2014 check the base URL / key.");
    } catch (e) {
      toast(e.message, true);
      setModelHint("");
    }
  }

  async function clearAiKey() {
    if (!window.confirm(`Remove the stored ${label} API key?`)) return;
    try {
      await api("POST", "/api/ai", { clearApiKey: true, aiProvider: provider });
      toast("API key cleared");
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function onProviderChange(id) {
    setProvider(id);
    try {
      const d = await api("POST", "/api/ai", { aiProvider: id });
      applyState(d);
    } catch (e) {
      toast(e.message, true);
    }
  }

  // Memory actions
  async function addMemory() {
    if (!newMemContent.trim()) return toast("Enter memory content first", true);
    try {
      await api("POST", "/api/ai/memories", {
        content: newMemContent.trim(),
        userId: newMemUserId.trim() || null
      });
      toast("Memory fact added");
      setNewMemContent("");
      setNewMemUserId("");
      await loadMemories();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function deleteMemory(id) {
    if (!window.confirm("Delete this memory fact?")) return;
    try {
      await api("DELETE", `/api/ai/memories/${id}`);
      toast("Memory fact deleted");
      await loadMemories();
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) return <AiSkeleton />;
  if (!s) return <div className="tab active" />;

  const baseHint = isCustom
    ? "Set the base URL (and key if required), Save, then \u21BB Fetch models."
    : "";

  const filteredMemories = memories.filter(m => {
    const q = memSearch.toLowerCase().trim();
    if (!q) return true;
    return m.content.toLowerCase().includes(q) || (m.userId && m.userId.includes(q));
  });

  return (
    <div className="tab active">
      <div className="panel">
        <h2><Sparkles /> AI assistant Config</h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          The bot replies with AI when pinged (<code>@bot message</code>) or when someone replies to a bot message.
          Channel lists use Discord channel IDs (comma or space separated). Leave allowed empty to permit all channels except ignored ones.
        </p>
        <div className="field">
          <label>Enabled</label>
          <div className="row">
            <Toggle checked={enabled} onChange={setEnabled} />
            <span className="muted">Respond to pings and replies</span>
          </div>
        </div>
        <div className="field">
          <label>Provider</label>
          <select value={provider} onChange={(e) => onProviderChange(e.target.value)}>
            {(s.providers || []).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        {isCustom && (
          <div className="field">
            <label>Custom endpoint</label>
            <div className="row">
              <input
                placeholder="https://api.example.com/v1"
                style={{ flex: 2, minWidth: 220 }}
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
              />
              <select
                style={{ flex: 1, minWidth: 140 }}
                value={customApiType}
                onChange={(e) => setCustomApiType(e.target.value)}
              >
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic-compatible</option>
              </select>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              Base URL of the API. Models are fetched from <code>&lt;base&gt;/models</code>; chat uses
              <code>/chat/completions</code> (OpenAI) or <code>/messages</code> (Anthropic).
            </div>
          </div>
        )}
        <div className="field">
          <label>{label} API Key</label>
          <div className="row">
            <input
              type="password"
              autoComplete="off"
              placeholder={AI_KEY_PLACEHOLDERS[provider] || ""}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button className="btn" onClick={saveAi}>
              <Save /> <span>Save</span>
            </button>
            <button className="btn danger" onClick={clearAiKey}>
              <Trash2 /> <span>Clear key</span>
            </button>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {s.hasApiKey ? `Current key: ${s.apiKeyPreview} (enter a new key to replace)` : "No API key set"}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            API key can also be set via .env ({meta?.envVar || "API key env var"})
          </div>
        </div>
        <div className="field">
          <label>{label} Model</label>
          <div className="row">
            <select value={model} onChange={(e) => { setModel(e.target.value); setCustomModel(""); }}>
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              id="aiModelCustom"
              placeholder="Or custom model id"
              style={{ flex: 1, minWidth: 180 }}
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
            />
            <button className="btn secondary" onClick={refreshModels}>
              <RotateCw /> <span>Fetch models</span>
            </button>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>{modelHint || baseHint}</div>
        </div>
        <div className="field">
          <label>Allowed channels (optional)</label>
          <input
            placeholder="123456789, 987654321"
            value={allowedChannels}
            onChange={(e) => setAllowedChannels(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Ignored channels</label>
          <input
            placeholder="123456789, 987654321"
            value={ignoredChannels}
            onChange={(e) => setIgnoredChannels(e.target.value)}
          />
        </div>
        <div className="field">
          <label>System prompt</label>
          <textarea
            style={{ minHeight: 140 }}
            spellCheck={false}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>

        <hr />
        <h3>Advanced Agentic Parameters</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Fine-tune LLM responses, context windows, and enable active tools/agentic traits.
        </p>

        <div className="grid-2">
          <div className="field">
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Temperature</span>
              <span style={{ color: "var(--accent)", fontWeight: "bold" }}>{temperature}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              style={{ padding: 0 }}
            />
            <div className="muted" style={{ marginTop: 4 }}>Controls random creativity. Higher = more chaotic.</div>
          </div>
          <div className="field">
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Top P</span>
              <span style={{ color: "var(--accent)", fontWeight: "bold" }}>{topP}</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={topP}
              onChange={(e) => setTopP(parseFloat(e.target.value))}
              style={{ padding: 0 }}
            />
            <div className="muted" style={{ marginTop: 4 }}>Nucleus sampling probability threshold.</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Max Completion Tokens</label>
            <input
              type="number"
              min="1"
              max="4096"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
            />
            <div className="muted" style={{ marginTop: 4 }}>Maximum tokens the AI will generate in a reply.</div>
          </div>
          <div className="field">
            <label>Context Message Limit</label>
            <input
              type="number"
              min="0"
              max="50"
              value={contextLimit}
              onChange={(e) => setContextLimit(parseInt(e.target.value, 10))}
            />
            <div className="muted" style={{ marginTop: 4 }}>Number of past channel messages to load as history.</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Agentic Tools Execution</label>
            <div className="row">
              <Toggle checked={toolsEnabled} onChange={setToolsEnabled} />
              <span className="muted">Allow AI to run channel, moderation, and web tools</span>
            </div>
          </div>
          <div className="field">
            <label>Persistent memories</label>
            <div className="row">
              <Toggle checked={memoryEnabled} onChange={setMemoryEnabled} />
              <span className="muted">Inject user/server memories and enable learning</span>
            </div>
          </div>
          <div className="field">
            <label>Reasoning / Thinking Mode</label>
            <div className="row">
              <Toggle checked={thinkingEnabled} onChange={setThinkingEnabled} />
              <span className="muted">Permit long-reasoning thinking blocks</span>
            </div>
          </div>
        </div>

        <button className="btn green" onClick={saveAi} style={{ marginTop: 14 }}>
          <Save /> <span>Save AI settings</span>
        </button>
      </div>

      <div className="panel">
        <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}><Database /> Persistent Memories Manager</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Display, add, and manage user-specific or server-wide memories learned or set for the AI assistant.
        </p>

        <div className="row" style={{ marginBottom: 16 }}>
          <input
            placeholder="Search memories by content or user ID..."
            style={{ flex: 1, minWidth: 200 }}
            value={memSearch}
            onChange={(e) => setMemSearch(e.target.value)}
          />
          <button className="btn secondary" onClick={loadMemories}>
            <RotateCw style={{ width: 16, height: 16 }} /> <span>Refresh</span>
          </button>
        </div>

        <div className="field" style={{ background: "rgba(255, 255, 255, 0.02)", padding: 16, borderRadius: 8, border: "1px solid var(--border)", marginBottom: 16 }}>
          <label style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: "block" }}>Add Memory Fact Manually</label>
          <div className="row">
            <input
              placeholder="Memory content (e.g. 'Prefers Node.js', 'Likes pizza')"
              style={{ flex: 3, minWidth: 240 }}
              value={newMemContent}
              onChange={(e) => setNewMemContent(e.target.value)}
            />
            <input
              placeholder="User ID (optional, blank = server fact)"
              style={{ flex: 1.2, minWidth: 150 }}
              value={newMemUserId}
              onChange={(e) => setNewMemUserId(e.target.value)}
            />
            <button className="btn" onClick={addMemory}>Add Fact</button>
          </div>
        </div>

        <div style={{ maxHeight: 350, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          {filteredMemories.length === 0 ? (
            <div className="muted" style={{ padding: 30, textAlign: "center" }}>No memories match the filter criteria.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Scope</th>
                  <th>Content</th>
                  <th>Added</th>
                  <th style={{ width: 80, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMemories.map(m => (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)" }}>#{m.id}</td>
                    <td>
                      {m.userId ? (
                        <span className="badge warn" style={{ display: "inline-block" }}>User: {m.userId}</span>
                      ) : (
                        <span className="badge ok" style={{ display: "inline-block" }}>Server</span>
                      )}
                    </td>
                    <td>{m.content}</td>
                    <td style={{ color: "var(--muted)" }}>
                      {new Date(m.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button className="btn danger" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => deleteMemory(m.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
