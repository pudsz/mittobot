import { useEffect, useState } from "react";
import { Save, Trash2, RotateCw, Database, Plus, X, ArrowDown, Brain, Settings, Activity } from "lucide-react";
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
    </div>
  );
}

function ProviderDot({ status }) {
  if (!status) return null;
  const isBusy = status === "busy";
  const color = isBusy ? "#f0a020" : "#3fb950";
  return (
    <span
      title={isBusy ? "Busy — handling a request" : "Free — available"}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: color,
        flexShrink: 0,
        marginRight: 4,
        boxShadow: `0 0 6px ${color}66`,
      }}
    />
  );
}

function SectionCard({ icon: Icon, title, children, style }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: 16,
      marginBottom: 12,
      ...style,
    }}>
      <h3 style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 0, marginBottom: 12, fontSize: 14 }}>
        {Icon && <Icon style={{ width: 16, height: 16, color: "var(--accent)" }} />}
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatBadge({ label, value, variant }) {
  const colors = {
    default: { bg: "rgba(255,255,255,0.04)", color: "var(--text)" },
    accent: { bg: "rgba(99,179,237,0.1)", color: "var(--accent)" },
    success: { bg: "rgba(63,185,80,0.1)", color: "#3fb950" },
    warn: { bg: "rgba(240,160,32,0.1)", color: "#f0a020" },
  };
  const c = colors[variant] || colors.default;
  return (
    <div style={{
      background: c.bg,
      border: "1px solid var(--border)",
      borderRadius: 6,
      padding: "8px 14px",
      textAlign: "center",
      minWidth: 80,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
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

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [topP, setTopP] = useState(1.0);
  const [contextLimit, setContextLimit] = useState(8);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);

  const [personalities, setPersonalities] = useState([]);
  const [newPersName, setNewPersName] = useState("");
  const [memories, setMemories] = useState([]);
  const [newMemContent, setNewMemContent] = useState("");
  const [newMemUserId, setNewMemUserId] = useState("");
  const [memSearch, setMemSearch] = useState("");
  const [fallbackProviders, setFallbackProviders] = useState([]);
  const [chattyMode, setChattyMode] = useState(false);
  const [chattyCooldown, setChattyCooldown] = useState(60);

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

    setTemperature(d.aiTemperature ?? 0.7);
    setMaxTokens(d.aiMaxTokens ?? 1024);
    setTopP(d.aiTopP ?? 1.0);
    setContextLimit(d.aiContextLimit ?? 8);
    setToolsEnabled(d.aiToolsEnabled !== false);
    setMemoryEnabled(d.aiMemoryEnabled !== false);
    setThinkingEnabled(!!d.aiThinkingEnabled);

    const raw = (d.aiFallbackProviders || "").split(",").map(x => x.trim()).filter(Boolean);
    setFallbackProviders(raw.slice(0, 5));
    setChattyMode(!!d.aiChattyMode);
    setChattyCooldown(d.aiChattyCooldown ?? 60);
  }

  async function loadMemories() {
    try {
      const res = await api("GET", "/api/ai/memories");
      setMemories(res.memories || []);
    } catch (e) {
      console.error("Failed to load memories:", e);
    }
  }

  async function loadPersonalities() {
    try {
      const res = await api("GET", "/api/ai/personalities");
      setPersonalities(res.personalities || []);
    } catch { /* ignore */ }
  }

  async function savePersonality() {
    if (!newPersName.trim()) return toast("Enter a preset name", true);
    try {
      await api("POST", "/api/ai/personalities", { name: newPersName.trim(), prompt: systemPrompt });
      toast("Preset saved");
      setNewPersName("");
      await loadPersonalities();
    } catch (e) { toast(e.message, true); }
  }

  async function deletePersonality(id) {
    if (!window.confirm("Delete this preset?")) return;
    try {
      await api("DELETE", `/api/ai/personalities/${id}`);
      toast("Preset deleted");
      await loadPersonalities();
    } catch (e) { toast(e.message, true); }
  }

  async function load() {
    try {
      applyState(await api("GET", "/api/ai"));
      await loadMemories();
      await loadPersonalities();
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
      aiFallbackProviders: fallbackProviders.filter(id => id && id !== provider).join(","),
      aiChattyMode: chattyMode,
      aiChattyCooldown: Number(chattyCooldown),
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

  // Memory stats
  const serverMemCount = memories.filter(m => !m.userId).length;
  const userMemCount = memories.filter(m => !!m.userId).length;
  const uniqueUsers = new Set(memories.filter(m => m.userId).map(m => m.userId)).size;

  return (
    <div className="tab active">
      {/* ─── General Settings Card ─── */}
      <SectionCard icon={Settings} title="General">
        <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
          The bot replies with AI when pinged (<code>@bot message</code>), replied to, triggered by keyword, or in chatty mode.
          Channel lists use Discord channel IDs (comma or space separated). Leave allowed empty to permit all except ignored ones.
        </p>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Enabled</label>
          <div className="row">
            <Toggle checked={enabled} onChange={setEnabled} />
            <span className="muted">Respond to pings, replies, keyword, and chatty mode</span>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>💬 Chatty Mode</span>
            <span className="badge ok" style={{ fontSize: 10 }}>NEW</span>
          </label>
          <div className="row" style={{ marginBottom: 8 }}>
            <Toggle checked={chattyMode} onChange={setChattyMode} />
            <span className="muted">Respond to conversations naturally without being pinged</span>
          </div>
          {chattyMode && (
            <div style={{ marginTop: 8, padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6, border: "1px solid var(--border)" }}>
              <label style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Cooldown</span>
                <span style={{ color: "var(--accent)", fontWeight: "bold" }}>{chattyCooldown}s</span>
              </label>
              <input
                type="range"
                min="10"
                max="600"
                step="10"
                value={chattyCooldown}
                onChange={(e) => setChattyCooldown(parseInt(e.target.value, 10))}
                style={{ padding: 0 }}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Minimum seconds between responses in the same channel. Lower = more active.
              </div>
            </div>
          )}
        </div>

        <div className="field" style={{ marginBottom: 8 }}>
          <label>Allowed channels</label>
          <input
            placeholder="123456789, 987654321"
            value={allowedChannels}
            onChange={(e) => setAllowedChannels(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
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
            style={{ minHeight: 120 }}
            spellCheck={false}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Max 2000 chars — currently {systemPrompt.length}</div>
        </div>

        {/* Personality presets */}
        <div className="field">
          <label>Personality Presets</label>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Save and load system prompt presets for quick switching.</div>
          <div className="row" style={{ marginBottom: 8 }}>
            <select
              style={{ flex: 1 }}
              value=""
              onChange={(e) => {
                const p = personalities.find(x => x.id === Number(e.target.value));
                if (p) setSystemPrompt(p.prompt);
              }}
            >
              <option value="">— Load a preset —</option>
              {personalities.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              placeholder="Preset name..."
              style={{ flex: 1 }}
              value={newPersName}
              onChange={(e) => setNewPersName(e.target.value)}
            />
            <button className="btn" onClick={savePersonality}>Save Current</button>
          </div>
          {personalities.length > 0 && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {personalities.map(p => (
                <span key={p.id} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
                  onClick={() => setSystemPrompt(p.prompt)}>
                  {p.name}
                  <X style={{ width: 10, height: 10 }} onClick={(e) => { e.stopPropagation(); deletePersonality(p.id); }} />
                </span>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ─── Provider & Model Card ─── */}
      <SectionCard icon={Activity} title="Provider &amp; Model">
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Provider</label>
          <div className="row" style={{ alignItems: "center" }}>
            <ProviderDot status={(s.providerStatus || {})[provider]} />
            <select value={provider} onChange={(e) => onProviderChange(e.target.value)} style={{ flex: 1 }}>
              {(s.providers || []).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span><ArrowDown style={{ width: 14, height: 14 }} /> Fallback Providers</span>
          </label>
          <p className="muted" style={{ marginTop: 0, marginBottom: 8, fontSize: 12 }}>
            If the primary fails, the bot tries these in order. Configure API keys in each provider's settings.
          </p>
          {fallbackProviders.map((fbId, idx) => {
            const fbMeta = (s.providers || []).find(p => p.id === fbId);
            return (
              <div key={idx} className="row" style={{ marginBottom: 6, alignItems: "center" }}>
                <span className="muted" style={{ width: 28, fontSize: 12, flexShrink: 0 }}>#{idx + 1}</span>
                <ProviderDot status={fbId ? (s.providerStatus || {})[fbId] : null} />
                <select
                  style={{ flex: 1 }}
                  value={fbId}
                  onChange={(e) => {
                    const next = fallbackProviders.map((f, i) => i === idx ? e.target.value : f);
                    setFallbackProviders(next);
                  }}
                >
                  <option value="">— none —</option>
                  {(s.providers || []).filter(p => p.id !== provider).map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <button
                  className="btn danger"
                  style={{ padding: "4px 8px" }}
                  onClick={() => setFallbackProviders(fallbackProviders.filter((_, i) => i !== idx))}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>
            );
          })}
          {fallbackProviders.length < 5 && (
            <button className="btn secondary" style={{ marginTop: 4 }} onClick={() => setFallbackProviders([...fallbackProviders, ""])}>
              <Plus style={{ width: 14, height: 14 }} /> <span>Add fallback</span>
            </button>
          )}
        </div>

        {isCustom && (
          <div className="field" style={{ marginBottom: 12, padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
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
            <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
              Models fetched from <code>&lt;base&gt;/models</code>
            </div>
          </div>
        )}

        <div className="field" style={{ marginBottom: 12 }}>
          <label>{label} API Key</label>
          <div className="row">
            <input
              type="password"
              autoComplete="off"
              placeholder={AI_KEY_PLACEHOLDERS[provider] || ""}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button className="btn" onClick={saveAi}><Save /> <span>Save</span></button>
            <button className="btn danger" onClick={clearAiKey}><Trash2 /> <span>Clear</span></button>
          </div>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            {s.hasApiKey ? `Current: ${s.apiKeyPreview}` : "No API key set"} — also set via .env ({meta?.envVar || "env var"})
          </div>
        </div>

        <div className="field">
          <label>{label} Model</label>
          <div className="row">
            <select value={model} onChange={(e) => { setModel(e.target.value); setCustomModel(""); }}>
              {modelOptions.map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
            <input
              placeholder="Or custom model id"
              style={{ flex: 1, minWidth: 160 }}
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
            />
            <button className="btn secondary" onClick={refreshModels}><RotateCw /> <span>Fetch</span></button>
          </div>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{modelHint || baseHint}</div>
        </div>
      </SectionCard>

      {/* ─── Agentic Settings Card ─── */}
      <SectionCard icon={Brain} title="Agentic Parameters">
        <div className="grid-2" style={{ marginBottom: 8 }}>
          <div className="field">
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Temperature</span>
              <span style={{ color: "var(--accent)", fontWeight: "bold" }}>{temperature}</span>
            </label>
            <input type="range" min="0" max="2" step="0.1" value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))} style={{ padding: 0 }} />
            <div className="muted" style={{ fontSize: 11 }}>Creativity — higher = more chaotic</div>
          </div>
          <div className="field">
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Top P</span>
              <span style={{ color: "var(--accent)", fontWeight: "bold" }}>{topP}</span>
            </label>
            <input type="range" min="0" max="1" step="0.05" value={topP}
              onChange={(e) => setTopP(parseFloat(e.target.value))} style={{ padding: 0 }} />
            <div className="muted" style={{ fontSize: 11 }}>Nucleus sampling threshold</div>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 8 }}>
          <div className="field">
            <label>Max Tokens</label>
            <input type="number" min="1" max="32768" value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))} />
            <div className="muted" style={{ fontSize: 11 }}>Response length limit</div>
          </div>
          <div className="field">
            <label>Context Messages</label>
            <input type="number" min="0" max="50" value={contextLimit}
              onChange={(e) => setContextLimit(parseInt(e.target.value, 10))} />
            <div className="muted" style={{ fontSize: 11 }}>Channel history to load</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Tool Execution</label>
            <div className="row"><Toggle checked={toolsEnabled} onChange={setToolsEnabled} /><span className="muted">Moderation, web, channels</span></div>
          </div>
          <div className="field">
            <label>Memories</label>
            <div className="row"><Toggle checked={memoryEnabled} onChange={setMemoryEnabled} /><span className="muted">Learn & remember facts</span></div>
          </div>
          <div className="field">
            <label>Thinking Mode</label>
            <div className="row"><Toggle checked={thinkingEnabled} onChange={setThinkingEnabled} /><span className="muted">Long-reasoning blocks</span></div>
          </div>
        </div>

        <button className="btn green" onClick={saveAi} style={{ marginTop: 14 }}>
          <Save /> <span>Save AI settings</span>
        </button>
      </SectionCard>

      {/* ─── Memories Card ─── */}
      <SectionCard icon={Database} title="Memory Manager">
        {/* Stats row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <StatBadge label="Total Facts" value={memories.length} variant="accent" />
          <StatBadge label="Server Facts" value={serverMemCount} variant="default" />
          <StatBadge label="User Facts" value={userMemCount} variant="success" />
          <StatBadge label="Users Tracked" value={uniqueUsers} variant="warn" />
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <input placeholder="Search by content or user ID..." style={{ flex: 1 }}
            value={memSearch} onChange={(e) => setMemSearch(e.target.value)} />
          <button className="btn secondary" onClick={loadMemories}>
            <RotateCw style={{ width: 16, height: 16 }} /> <span>Refresh</span>
          </button>
        </div>

        <div className="field" style={{ background: "rgba(255, 255, 255, 0.02)", padding: 12, borderRadius: 6, border: "1px solid var(--border)", marginBottom: 16 }}>
          <label style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: "block" }}>Add Fact</label>
          <div className="row">
            <input placeholder="e.g. 'Prefers Node.js' or 'Server rules updated'" style={{ flex: 3 }}
              value={newMemContent} onChange={(e) => setNewMemContent(e.target.value)} />
            <input placeholder="User ID (optional)" style={{ flex: 1.2, minWidth: 130 }}
              value={newMemUserId} onChange={(e) => setNewMemUserId(e.target.value)} />
            <button className="btn" onClick={addMemory}>Add</button>
          </div>
        </div>

        <div style={{ maxHeight: 350, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          {filteredMemories.length === 0 ? (
            <div className="muted" style={{ padding: 30, textAlign: "center" }}>
              {memories.length === 0 ? "No memories yet. The AI will save facts as it learns about users and the server." : "No memories match your search."}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th style={{ width: 120 }}>Scope</th>
                  <th>Content</th>
                  <th style={{ width: 80 }}>Age</th>
                  <th style={{ width: 70, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMemories.map(m => {
                  const daysAgo = Math.floor((Date.now() - (m.createdAt || 0)) / 86400000);
                  return (
                    <tr key={m.id}>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>#{m.id}</td>
                      <td>
                        {m.userId ? (
                          <span className="badge warn" style={{ display: "inline-block", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            title={m.userId}>
                            👤 {m.displayName || m.userId}
                          </span>
                        ) : (
                          <span className="badge ok" style={{ display: "inline-block" }}>🌐 Server</span>
                        )}
                      </td>
                      <td>{m.content}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>
                        {daysAgo === 0 ? "today" : `${daysAgo}d ago`}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button className="btn danger" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => deleteMemory(m.id)}>
                          Del
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
