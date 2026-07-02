import { useEffect, useMemo, useState } from "react";
import { Save, Trash2, RotateCw, Database, Plus, X, ArrowDown, Brain, Settings, Activity, Shield, Home } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";

const AI_KEY_PLACEHOLDERS = {
  groq: "gsk_...",
  openai: "sk-...",
  claude: "sk-ant-...",
  gemini: "AIza...",
  nvidia: "nvapi-...",
  deepseek: "sk-...",
  together: "api key (togetherai or together.xyz)",
  custom: "api key (leave blank if not required, e.g. local Ollama)",
};

const NVIDIA_PROVIDER_META = {
  id: "nvidia",
  label: "NVIDIA NIM",
  envVar: "NVIDIA_API_KEY",
  keyField: "nvidiaApiKey",
  modelField: "nvidiaModel",
  defaultModel: "mistralai/ministral-14b-instruct-2512",
  defaultModels: [
    "mistralai/ministral-14b-instruct-2512",
    "mistralai/mistral-large-3-instruct",
    "meta/llama-3.3-70b-instruct",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "deepseek-ai/deepseek-r1",
  ],
};

function withDashboardProviders(providers = []) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  byId.set(NVIDIA_PROVIDER_META.id, {
    ...NVIDIA_PROVIDER_META,
    ...(byId.get(NVIDIA_PROVIDER_META.id) || {}),
  });
  return [...byId.values()];
}

function normalizeAiSettings(d = {}) {
  const providers = withDashboardProviders(d.providers);
  const aiProvider = providers.some((p) => p.id === d.aiProvider)
    ? d.aiProvider
    : providers[0]?.id || "";
  const activeProvider = providers.find((p) => p.id === aiProvider);
  const model = d.model || activeProvider?.defaultModel || "";
  const models = [...(d.models || [])];
  if (models.length === 0 && activeProvider?.defaultModels) models.push(...activeProvider.defaultModels);
  if (model && !models.includes(model)) models.unshift(model);

  return {
    ...d,
    aiProvider,
    providers,
    model,
    models,
  };
}

// plural(n, "memory", "memories") → "1 memory" / "5 memories".
// `pluralForm` is mandatory: English has too many irregulars ("memory" →
// "memories", "person" → "people") to derive safely. We intentionally do NOT
// default to `${singular}s` because that would silently render "memorys".
function plural(n, singular, pluralForm) {
  const word = n === 1 ? singular : pluralForm;
  return `${n} ${word}`;
}

function AiSkeleton() {
  return (
    <div className="tab active">
      <div className="panel">
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-text" style={{ width: "80%" }} />
        <div className="skeleton skeleton-text" style={{ width: "60%" }} />
        {[1, 2, 3, 4].map((i) => (
          <div className="mb-4" key={i}>
            <div className="skeleton skeleton-text" style={{ width: "15%", height: 10 }} />
            <div className="skeleton skeleton-block" />
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
      className="aicfg-provider-dot"
      title={isBusy ? "Busy — handling a request" : "Free — available"}
      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}66` }}
    />
  );
}

function SectionCard({ icon: Icon, title, children, style }) {
  return (
    <div className="aicfg-section-card" style={style}>
      <h3>
        {Icon && <Icon />}
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatBadge({ label, value, variant }) {
  const cls = `aicfg-stat-badge${variant && variant !== "default" ? ` aicfg-stat-badge--${variant}` : ""}`;
  return (
    <div className={cls}>
      <div className="aicfg-stat-badge-value">{value}</div>
      <div className="aicfg-stat-badge-label">{label}</div>
    </div>
  );
}

export default function AiConfigTab({ guildId = "", guilds = [] }) {
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
  const [memClearScope, setMemClearScope] = useState("all"); // "all" | "server" | "user"
  const [memClearUserId, setMemClearUserId] = useState("");
  const [clearing, setClearing] = useState(false); // disables button mid-flight
  const [fallbackProviders, setFallbackProviders] = useState([]);
  const [fallbackApiKeys, setFallbackApiKeys] = useState({});
  const [fallbackModels, setFallbackModels] = useState({});
  const [fallbackModelLists, setFallbackModelLists] = useState({});
  const [fallbackFetching, setFallbackFetching] = useState({});
  const [chattyMode, setChattyMode] = useState(false);
  const [chattyCooldown, setChattyCooldown] = useState(60);
  const [dmEnabled, setDmEnabled] = useState(true);
  const [browserEnabled, setBrowserEnabled] = useState(true);

  // Tool permission states
  const [toolPerms, setToolPerms] = useState({});
  const TOOL_NAMES = ["warn_member", "mute_member", "kick_member", "ban_member"];
  const PERM_LEVELS = ["all", "mod", "admin", "owner"];
  const PERM_LABELS = { all: "Everyone", mod: "Mod (ModerateMembers)", admin: "Admin only", owner: "Owner only" };

  function applyState(d) {
    const nextState = normalizeAiSettings(d);
    setS(nextState);
    setEnabled(!!d.aiEnabled);
    setApiKey("");
    setAllowedChannels(d.aiAllowedChannels || "");
    setIgnoredChannels(d.aiIgnoredChannels || "");
    setSystemPrompt(d.aiSystemPrompt || "");

    const providers = nextState.providers;
    setProvider(nextState.aiProvider);
    setCustomBaseUrl(d.customBaseUrl || "");
    setCustomApiType(d.customApiType || "openai");

    const models = nextState.models;
    const current = nextState.model || "";
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

    const raw = (d.aiFallbackProviders || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 5);
    setFallbackProviders(raw);
    // Initialize per-fallback key/model state from saved settings
    const initKeys = {};
    const initModels = {};
    for (const fbId of raw) {
      if (!fbId) continue;
      initKeys[fbId] = ""; // don't prefill key (security)
      const fbMeta = providers.find((p) => p.id === fbId);
      if (fbMeta) initModels[fbId] = d[fbMeta.modelField] || "";
    }
    setFallbackApiKeys(initKeys);
    setFallbackModels(initModels);
    setChattyMode(!!d.aiChattyMode);
    setChattyCooldown(d.aiChattyCooldown ?? 60);
    setDmEnabled(d.aiDmEnabled !== false);
    setBrowserEnabled(d.aiBrowserEnabled !== false);

    // Tool permissions
    try {
      const tp = d.aiToolPermissions ? JSON.parse(d.aiToolPermissions) : {};
      setToolPerms(typeof tp === "object" ? tp : {});
    } catch { setToolPerms({}); }
  }

  async function loadMemories() {
    try {
      const res = await api("GET", "/api/ai/memories");
      setMemories(res.memories || []);
    } catch (e) {
      console.error("Failed to load memories:", e);
    }
  }

  async function fetchFallbackModels(fbId) {
    if (!fbId) return;
    const fbMeta = allProviders.find((p) => p.id === fbId);
    if (!fbMeta) return;
    setFallbackFetching(prev => ({ ...prev, [fbId]: true }));
    try {
      const res = await api("GET", `/api/ai/models/${fbId}`);
      if (res.models && res.models.length > 0) {
        setFallbackModelLists(prev => ({ ...prev, [fbId]: res.models }));
      }
      toast(`Loaded ${res.models?.length || 0} models for ${fbMeta.label}`);
    } catch (e) {
      toast(`Failed to fetch ${fbMeta.label} models: ${e.message}`, true);
    } finally {
      setFallbackFetching(prev => ({ ...prev, [fbId]: false }));
    }
  }

  // ── Layered system prompts (default → guild → channel) ────────────
  const [prompts, setPrompts] = useState({ default: null, guild: null, channels: {}, resolved: null, fallback: null });
  const [editPrompt, setEditPrompt] = useState(null); // { scope, targetId, prompt }
  const [promptsLoading, setPromptsLoading] = useState(false);

  async function loadPrompts() {
    setPromptsLoading(true);
    try {
      const res = await api("GET", "/api/ai/prompts");
      setPrompts(res || { default: null, guild: null, channels: {}, resolved: null, fallback: null });
    } catch (e) { /* ignore — keep prior state */ }
    finally { setPromptsLoading(false); }
  }

  async function savePromptLayer(scope, targetId, prompt) {
    try {
      await api("PUT", "/api/ai/prompts", { scope, targetId, prompt });
      toast(`Saved ${scope} override`);
      await loadPrompts();
      setEditPrompt(null);
    } catch (e) { toast(e.message, true); }
  }

  async function deletePromptLayer(scope, targetId) {
    if (!window.confirm(`Delete this ${scope} override?`)) return;
    try {
      await api("DELETE", `/api/ai/prompts?scope=${encodeURIComponent(scope)}&targetId=${encodeURIComponent(targetId || "")}`);
      toast("Override removed");
      await loadPrompts();
    } catch (e) { toast(e.message, true); }
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
      await loadPrompts();
      // NO loadGuildOptions() — guilds come from props (top-level App picker),
      // eliminating the duplicate `/api/guilds` fetch and the state divergence
      // between the sidebar guildId and the in-tab selectedGuildId.
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // If the operator switches away from "user" scope, drop the previously-
  // selected userId so re-selecting "user" later starts from a blank dropdown
  // (avoids surprise wipes of an old selection).
  useEffect(() => {
    if (memClearScope !== "user") setMemClearUserId("");
  }, [memClearScope]);

  // Distinct userIds with their memory counts — memoised so the dropdown
  // doesn't re-scan `memories` on every render of the parent component.
  const uniqueUserMemories = useMemo(() => {
    const map = new Map();
    for (const m of memories) {
      if (!m.userId) continue;
      const cur = map.get(m.userId) || { userId: m.userId, displayName: m.displayName || m.userId, count: 0 };
      cur.count += 1;
      map.set(m.userId, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [memories]);

  const allProviders = useMemo(() => {
    return withDashboardProviders(s?.providers);
  }, [s?.providers]);

  const meta = allProviders.find((p) => p.id === provider);
  const label = meta?.label || provider;
  const isCustom = Boolean(meta?.baseUrlField) || provider === "custom";

  const fallbackOptions = useMemo(() => {
    const options = allProviders.filter((p) => p.id !== provider);
    if (provider !== NVIDIA_PROVIDER_META.id && !options.some((p) => p.id === NVIDIA_PROVIDER_META.id)) {
      options.push(NVIDIA_PROVIDER_META);
    }
    return options;
  }, [allProviders, provider]);

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
      aiDmEnabled: dmEnabled,
      aiBrowserEnabled: browserEnabled,
      aiToolPermissions: JSON.stringify(toolPerms),
    };
    if (finalModel) body.model = finalModel;
    if (isCustom) {
      body.customBaseUrl = customBaseUrl.trim();
      body.customApiType = customApiType;
    }
    const key = apiKey.trim();
    if (key) body.apiKey = key;
    // Include per-fallback API keys and models
    for (const [fbId, fbKey] of Object.entries(fallbackApiKeys)) {
      if (fbKey && fbKey.trim()) {
        const fbMeta = allProviders.find((p) => p.id === fbId);
        if (fbMeta) body[fbMeta.keyField] = fbKey.trim();
      }
    }
    for (const [fbId, fbModel] of Object.entries(fallbackModels)) {
      if (fbModel && fbModel.trim()) {
        const fbMeta = allProviders.find((p) => p.id === fbId);
        if (fbMeta) body[fbMeta.modelField] = fbModel.trim();
      }
    }
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
      toast("Memory saved");
      setNewMemContent("");
      setNewMemUserId("");
      await loadMemories();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function deleteMemory(id) {
    if (!window.confirm("Delete this memory?")) return;
    try {
      await api("DELETE", `/api/ai/memories/${id}`);
      toast("Memory deleted");
      await loadMemories();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // Bulk wipe memories within a chosen scope. The scope chip row above the
  // table lets the owner target (a) everything, (b) server-wide facts only
  // (user_id IS NULL), or (c) a specific user's memories. A confirm dialog
  // summarises the count and intended target before the irreversible delete.
  async function clearMemories() {
    let targetCount = 0;
    let confirmMsg = "";
    if (memClearScope === "all") {
      targetCount = memories.length;
      confirmMsg = `Wipe ALL ${pluralize(targetCount, "memory")}? This cannot be undone.`;
    } else if (memClearScope === "server") {
      targetCount = memories.filter((m) => !m.userId).length;
      confirmMsg = `Wipe the ${pluralize(targetCount, "server-wide memory")}? (User-tied memories are kept.)`;
    } else {
      if (!memClearUserId) return toast("Pick a user first", true);
      const label = memories.find((m) => m.userId === memClearUserId)?.displayName || memClearUserId;
      targetCount = memories.filter((m) => m.userId === memClearUserId).length;
      confirmMsg = `Wipe all ${pluralize(targetCount, "memory")} for ${label}? This cannot be undone.`;
    }
    if (targetCount === 0) return toast("Nothing to clear in that scope", true);
    if (!window.confirm(confirmMsg)) return;
    // The button is `disabled={clearing}` so a fast double-click can't re-enter;
    // we don't need a stale-closure check on this function.
    setClearing(true);
    try {
      const body = { scope: memClearScope };
      if (memClearScope === "user") body.userId = memClearUserId;
      const r = await api("POST", "/api/ai/memories/clear", body);
      toast(`Cleared ${pluralize(r.cleared || 0, "memory")}`);
      await loadMemories();
    } catch (e) {
      toast(e.message, true);
    } finally {
      setClearing(false);
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
        <div className="field mb-3">
          <label>Enabled</label>
          <div className="row">
            <Toggle checked={enabled} onChange={setEnabled} />
            <span className="muted">Respond to pings, replies, keyword, and chatty mode</span>
          </div>
        </div>

        <div className="field mb-3">
          <label>💬 Direct Messages</label>
          <div className="row">
            <Toggle checked={dmEnabled} onChange={setDmEnabled} />
            <span className="muted">Respond to direct messages via AI</span>
          </div>
        </div>

        <div className="field mb-3">
          <label className="aicfg-label-icon-row">
            <span>🌐 Browser Mode</span>
            <span className="badge ok">NEW</span>
          </label>
          <div className="row">
            <Toggle checked={browserEnabled} onChange={setBrowserEnabled} />
            <span className="muted">Enable Playwright-powered browse_page tool (renders JS-heavy sites in a real browser)</span>
          </div>
        </div>

        <div className="field mb-3">
          <label className="aicfg-label-icon-row">
            <span>💬 Chatty Mode</span>
          </label>
          <div className="row mb-2">
            <Toggle checked={chattyMode} onChange={setChattyMode} />
            <span className="muted">Respond to conversations naturally without being pinged</span>
          </div>
          {chattyMode && (
            <div className="aicfg-chatty-panel">
              <label className="row-between">
                <span>Cooldown</span>
                <span className="accent bold">{chattyCooldown}s</span>
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
              <div className="muted text-xs mt-2">
                Minimum seconds between responses in the same channel. Lower = more active.
              </div>
            </div>
          )}
        </div>

        <div className="field mb-2">
          <label>Allowed channels</label>
          <input
            placeholder="123456789, 987654321"
            value={allowedChannels}
            onChange={(e) => setAllowedChannels(e.target.value)}
          />
        </div>
        <div className="field mb-2">
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
            className="textarea-md"
            spellCheck={false}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          <div className="muted text-xs mt-2">Max 2000 chars — currently {systemPrompt.length}</div>
        </div>

        {/* Personality presets */}
        <div className="field">
          <label>Personality Presets</label>
          <div className="muted text-sm mb-2">Save and load system prompt presets for quick switching.</div>
          <div className="row mb-2">
            <select
              className="flex-1"
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
          <div className="row gap-3">
            <input
              placeholder="Preset name..."
              className="flex-1"
              value={newPersName}
              onChange={(e) => setNewPersName(e.target.value)}
            />
            <button className="btn" onClick={savePersonality}>Save Current</button>
          </div>
          {personalities.length > 0 && (
            <div className="aicfg-personality-list">
              {personalities.map(p => (
                <span key={p.id} className="badge aicfg-personality-badge"
                  onClick={() => setSystemPrompt(p.prompt)}>
                  {p.name}
                  <X className="aicfg-personality-x" onClick={(e) => { e.stopPropagation(); deletePersonality(p.id); }} />
                </span>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ─── Provider & Model Card ─── */}
      <SectionCard icon={Activity} title="Provider &amp; Model">
        <div className="field mb-3">
          <label>Provider</label>
          <div className="row">
            <ProviderDot status={(s.providerStatus || {})[provider]} />
            <select value={provider} onChange={(e) => onProviderChange(e.target.value)} className="flex-1">
              {allProviders.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field mb-3">
          <label className="aicfg-label-icon-row">
            <span><ArrowDown style={{ width: 14, height: 14 }} /> Fallback Providers</span>
          </label>
          <p className="muted" style={{ marginTop: 0, marginBottom: 8, fontSize: 12 }}>
            If the primary fails, the bot tries these in order. Each fallback needs its own API key and model.
          </p>
          {fallbackProviders.map((fbId, idx) => {
            const fbMeta = allProviders.find((p) => p.id === fbId);
            const fbModels = fallbackModelLists[fbId] || null;
            const fetching = fallbackFetching[fbId];
            return (
              <div key={idx} className="aicfg-fallback-card">
                <div className="row mb-2">
                  <span className="muted" style={{ width: 28, fontSize: 12, flexShrink: 0 }}>#{idx + 1}</span>
                  <ProviderDot status={fbId ? (s.providerStatus || {})[fbId] : null} />
                  <select
                    className="flex-1"
                    value={fbId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      const next = fallbackProviders.map((f, i) => i === idx ? newId : f);
                      setFallbackProviders(next);
                      if (newId) {
                        setFallbackApiKeys(prev => {
                          if (prev[newId] === undefined) return { ...prev, [newId]: "" };
                          return prev;
                        });
                        setFallbackModels(prev => {
                          if (prev[newId] === undefined) {
                            const m = allProviders.find((p) => p.id === newId);
                            return { ...prev, [newId]: m && s[m.modelField] ? s[m.modelField] : "" };
                          }
                          return prev;
                        });
                      }
                    }}
                  >
                    <option value="">— none —</option>
                    {fallbackOptions.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <button
                    className="btn danger sm"
                    onClick={() => {
                      const next = fallbackProviders.filter((_, i) => i !== idx);
                      setFallbackProviders(next);
                      setFallbackApiKeys(prev => { const c = { ...prev }; delete c[fbId]; return c; });
                      setFallbackModels(prev => { const c = { ...prev }; delete c[fbId]; return c; });
                      setFallbackModelLists(prev => { const c = { ...prev }; delete c[fbId]; return c; });
                    }}
                  >
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
                {fbId && (
                  <div className="aicfg-fallback-row">
                    <div className="row" style={{ marginBottom: 6, gap: 6 }}>
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder={AI_KEY_PLACEHOLDERS[fbId] || "API key..."}
                        value={fallbackApiKeys[fbId] || ""}
                        onChange={(e) => setFallbackApiKeys(prev => ({ ...prev, [fbId]: e.target.value }))}
                        className="aicfg-fallback-input"
                      />
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {fbModels && fbModels.length > 0 ? (
                        <select
                          className="aicfg-fallback-input"
                          value={fallbackModels[fbId] || ""}
                          onChange={(e) => setFallbackModels(prev => ({ ...prev, [fbId]: e.target.value }))}
                        >
                          <option value="">— pick a model —</option>
                          {fbModels.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          placeholder="Model (e.g. mistralai/ministral-14b)"
                          value={fallbackModels[fbId] || ""}
                          onChange={(e) => setFallbackModels(prev => ({ ...prev, [fbId]: e.target.value }))}
                          className="aicfg-fallback-input"
                        />
                      )}
                      <button
                        className="btn secondary sm"
                        onClick={() => fetchFallbackModels(fbId)}
                        disabled={fetching}
                      >
                        {fetching ? "Loading..." : "Fetch"}
                      </button>
                    </div>
                    {fbModels && fbModels.length > 0 && (
                      <input
                        placeholder="Or type a custom model..."
                        value={fallbackModels[fbId] || ""}
                        onChange={(e) => setFallbackModels(prev => ({ ...prev, [fbId]: e.target.value }))}
                        style={{ width: "100%" }}
                        className="aicfg-fallback-input mt-1"
                      />
                    )}
                    <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                      {fbMeta?.envVar || ""} — saved on next Save
                    </div>
                  </div>
                )}
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
          <div className="aicfg-custom-endpoint">
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

        <div className="field mb-3">
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
          <div style={{ marginTop: 4 }} className="muted text-xs">{modelHint || baseHint}</div>
        </div>
      </SectionCard>

      {/* ─── Agentic Settings Card ─── */}
      <SectionCard icon={Brain} title="Agentic Parameters">
        <div className="grid-2 mb-2">
          <div className="field">
            <label className="row-between">
              <span>Temperature</span>
              <span className="accent bold">{temperature}</span>
            </label>
            <input type="range" min="0" max="2" step="0.1" value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))} style={{ padding: 0 }} />
            <div className="muted text-xs">Creativity — higher = more chaotic</div>
          </div>
          <div className="field">
            <label className="row-between">
              <span>Top P</span>
              <span className="accent bold">{topP}</span>
            </label>
            <input type="range" min="0" max="1" step="0.05" value={topP}
              onChange={(e) => setTopP(parseFloat(e.target.value))} style={{ padding: 0 }} />
            <div className="muted text-xs">Nucleus sampling threshold</div>
          </div>
        </div>

        <div className="grid-2 mb-2">
          <div className="field">
            <label>Max Tokens</label>
            <input type="number" min="1" max="32768" value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))} />
            <div className="muted text-xs">Response length limit</div>
          </div>
          <div className="field">
            <label>Context Messages</label>
            <input type="number" min="0" max="50" value={contextLimit}
              onChange={(e) => setContextLimit(parseInt(e.target.value, 10))} />
            <div className="muted text-xs">Channel history to load</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Tool Execution</label>
            <div className="row"><Toggle checked={toolsEnabled} onChange={setToolsEnabled} /><span className="muted">Moderation, web, channels</span></div>
          </div>
          <div className="field">
            <label>Memories</label>
            <div className="row"><Toggle checked={memoryEnabled} onChange={setMemoryEnabled} /><span className="muted">Learn & remember memories</span></div>
          </div>
          <div className="field">
            <label>Thinking Mode</label>
            <div className="row"><Toggle checked={thinkingEnabled} onChange={setThinkingEnabled} /><span className="muted">Long-reasoning blocks</span></div>
          </div>
        </div>

        {/* Tool Permissions */}
        <div className="aicfg-tool-perms-box">
          <label>
            <Shield />
            Moderation Tool Permissions
          </label>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Restrict who can trigger mod actions through the AI. Default: mod tools require ModerateMembers permission.
          </p>
          {TOOL_NAMES.map(tool => (
            <div key={tool} className="aicfg-tool-row">
              <code>{tool}</code>
              <select
                value={toolPerms[tool] || "mod"}
                onChange={(e) => {
                  const next = { ...toolPerms };
                  if (e.target.value === "mod") delete next[tool];
                  else next[tool] = e.target.value;
                  setToolPerms(next);
                }}
              >
                {PERM_LEVELS.map(lvl => (
                  <option key={lvl} value={lvl}>{PERM_LABELS[lvl]}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button className="btn green" style={{ marginTop: 14 }} onClick={saveAi}>
          <Save /> <span>Save AI settings</span>
        </button>
      </SectionCard>

      {/* ─── Personality Layers Card ─── */}
      <SectionCard icon={Brain} title="Personality Layers">
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
          System prompts are layered — most-specific tier wins: <strong>channel</strong> → <strong>guild</strong> → <strong>default</strong> → settings fallback.
          Currently active: <code>{prompts?.resolved?.source || "settings fallback"}</code>
        </p>

        <div className="aicfg-target-banner">
          <div className="aicfg-target-banner-label">
            <Home style={{ width: 11, height: 11, verticalAlign: "middle", marginRight: 4 }} /> Guild Override target
          </div>
          <div className="aicfg-target-banner-name">
            {guilds.find((g) => g.id === guildId)?.name || guildId || "(no guild selected)"}
          </div>
          <div className="aicfg-target-banner-hint">
            Switch the guild in the sidebar to target a different guild.
          </div>
        </div>

        {/* Default tier */}
        <div className="aicfg-prompt-tier aicfg-prompt-tier--default">
          <div className="row" style={{ alignItems: "center", marginBottom: 6 }}>
            <label style={{ flex: 1, fontSize: 13 }}>⭐ Default (applies everywhere unless overridden)</label>
            {prompts?.default !== null && prompts?.default !== undefined && (
              <button className="btn danger sm"
                onClick={() => deletePromptLayer("default", null)}>Remove</button>
            )}
          </div>
          {editPrompt?.scope === "default" ? (
            <div>
              <textarea className="textarea-full" style={{ minHeight: 100 }} spellCheck={false}
                value={editPrompt.prompt}
                onChange={(e) => setEditPrompt({ ...editPrompt, prompt: e.target.value })} />
              <div className="row mt-2">
                <button className="btn green" onClick={() => savePromptLayer("default", null, editPrompt.prompt)}>
                  <Save /> <span>Save Default</span>
                </button>
                <button className="btn secondary" onClick={() => setEditPrompt(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div className="aicfg-prompt-box">
                {prompts?.default || <span className="muted">No default prompt set. Use settings.aiSystemPrompt above as the fallback.</span>}
              </div>
              <button className="btn secondary" style={{ marginTop: 6 }}
                onClick={() => setEditPrompt({ scope: "default", targetId: null, prompt: prompts?.default || "" })}>
                Edit Default
              </button>
            </div>
          )}
        </div>

        {/* Guild tier */}
        <div className="aicfg-prompt-tier aicfg-prompt-tier--guild">
          <div className="row" style={{ alignItems: "center", marginBottom: 6 }}>
            <label style={{ flex: 1, fontSize: 13 }}>🏠 Guild Override (applies to all channels here)</label>
            {prompts?.guild && (
              <button className="btn danger sm"
                onClick={() => deletePromptLayer("guild", prompts.guild.targetId)}>Remove</button>
            )}
          </div>
          {editPrompt?.scope === "guild" ? (
            <div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                Saving to guild: <strong>{guilds.find((g) => g.id === guildId)?.name || "(none selected)"}</strong>
              </div>
              <textarea className="textarea-full" style={{ minHeight: 100 }} spellCheck={false}
                value={editPrompt.prompt}
                placeholder={guildId ? "Overrides the default for this guild only." : "Pick a guild in the sidebar first."}
                disabled={!guildId}
                onChange={(e) => setEditPrompt({ ...editPrompt, prompt: e.target.value })} />
              <div className="row mt-2">
                <button className="btn green"
                  disabled={!guildId}
                  onClick={() => savePromptLayer("guild", guildId, editPrompt.prompt)}>
                  <Save /> <span>Save Guild Override</span>
                </button>
                <button className="btn secondary" onClick={() => setEditPrompt(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div className="aicfg-prompt-box">
                {prompts?.guild?.prompt || <span className="muted">No guild override — falls through to default.</span>}
              </div>
              <button className="btn secondary" style={{ marginTop: 6 }}
                disabled={!guildId}
                onClick={() => setEditPrompt({ scope: "guild", targetId: guildId, prompt: prompts?.guild?.prompt || "" })}>
                {prompts?.guild ? "Edit" : "Set"} Guild Override
              </button>
            </div>
          )}
        </div>

        {/* Channel tier */}
        <div className="aicfg-prompt-tier aicfg-prompt-tier--channel" style={{ marginBottom: 0 }}>
          <div className="row" style={{ alignItems: "center", marginBottom: 6 }}>
            <label style={{ flex: 1, fontSize: 13 }}>📍 Channel Overrides</label>
          </div>
          {Object.keys(prompts?.channels || {}).length === 0 ? (
            <div className="muted" style={{ fontSize: 12, padding: 8 }}>
              No channel overrides yet. Add one for a specific channel that needs a unique persona.
            </div>
          ) : (
            <div style={{ marginBottom: 6 }}>
              {Object.entries(prompts.channels).map(([channelId, info]) => (
                <div key={channelId} className="aicfg-channel-override-row">
                  <code>#{info.channel?.name || channelId}</code>
                  <span className="aicfg-channel-override-text">
                    {String(info.prompt || "").slice(0, 80) || <span className="muted">(empty)</span>}
                  </span>
                  <button className="btn danger sm"
                    onClick={() => deletePromptLayer("channel", channelId)}>×</button>
                </div>
              ))}
            </div>
          )}
          {editPrompt?.scope === "channel" ? (
            <div>
              <select
                className="textarea-full"
                style={{ marginBottom: 6 }}
                value={editPrompt.targetId || ""}
                onChange={(e) => setEditPrompt({ ...editPrompt, targetId: e.target.value })}>
                <option value="">Pick a channel…</option>
                {(s?.channels || []).map(c => (
                  <option key={c.id} value={c.id}>#{c.name}</option>
                ))}
              </select>
              <textarea className="textarea-full" style={{ minHeight: 100 }} spellCheck={false}
                value={editPrompt.prompt}
                placeholder="Overrides the guild prompt for this channel only."
                onChange={(e) => setEditPrompt({ ...editPrompt, prompt: e.target.value })} />
              <div className="row mt-2">
                <button className="btn green"
                  disabled={!editPrompt.targetId}
                  onClick={() => savePromptLayer("channel", editPrompt.targetId, editPrompt.prompt)}>
                  <Save /> <span>Save Channel Override</span>
                </button>
                <button className="btn secondary" onClick={() => setEditPrompt(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn secondary" style={{ marginTop: 4 }}
              onClick={() => setEditPrompt({ scope: "channel", targetId: "", prompt: "" })}>
              <Plus /> <span>Add Channel Override</span>
            </button>
          )}
        </div>
      </SectionCard>

      {/* ─── Memories Card ─── */}
      <SectionCard icon={Database} title="Memory Manager">
        <div className="aicfg-stats-row">
          <StatBadge label="Total Memories" value={memories.length} variant="accent" />
          <StatBadge label="Server Memories" value={serverMemCount} variant="default" />
          <StatBadge label="User Memories" value={userMemCount} variant="success" />
          <StatBadge label="Users Tracked" value={uniqueUsers} variant="warn" />
        </div>

        <div className="row mb-3">
          <input placeholder="Search by content or user ID..." className="flex-1"
            value={memSearch} onChange={(e) => setMemSearch(e.target.value)} />
          <button className="btn secondary" onClick={loadMemories}>
            <RotateCw style={{ width: 16, height: 16 }} /> <span>Refresh</span>
          </button>
        </div>

        <div className="aicfg-mem-scope-row">
          <span className="aicfg-mem-scope-label">Clear scope:</span>
          {[
            { id: "all",    label: `All (${memories.length})` },
            { id: "server", label: `Server ${plural(serverMemCount, "memory", "memories")} (${serverMemCount})` },
            { id: "user",   label: "Per-user" },
          ].map((chip) => (
            <button
              key={chip.id}
              className={`badge${memClearScope === chip.id ? " ok" : ""}`}
              style={{ cursor: "pointer", padding: "3px 10px", fontSize: 11 }}
              onClick={() => setMemClearScope(chip.id)}
              title={
                chip.id === "all"    ? "Clear every memory across all scopes"
                : chip.id === "server" ? "Clear only server-tied memories (user_id IS NULL)"
                : "Clear memories for a specific user"
              }
            >{chip.label}</button>
          ))}
          {memClearScope === "user" && (
            <select
              style={{ padding: "3px 8px", fontSize: 11, minWidth: 160, maxWidth: 320 }}
              value={memClearUserId}
              onChange={(e) => setMemClearUserId(e.target.value)}
            >
              <option value="">— pick a user —</option>
              {uniqueUserMemories.map(({ userId, displayName, count }) => (
                <option key={userId} value={userId}>{displayName} ({count})</option>
              ))}
            </select>
          )}
          <button
            className="btn danger"
            style={{ padding: "4px 10px", fontSize: 12, marginLeft: "auto", opacity: clearing ? 0.6 : 1 }}
            disabled={clearing}
            onClick={clearMemories}
            title={clearing ? "Clearing…" : "Permanently delete memories in the selected scope"}
          >
            <Trash2 style={{ width: 12, height: 12 }} /> <span>{clearing ? "Clearing…" : "Clear scope"}</span>
          </button>
        </div>

        <div className="aicfg-mem-add-card">
          <label>Add Memory</label>
          <div className="row">
            <input placeholder="e.g. 'Prefers Node.js' or 'Server rules updated'" style={{ flex: 3 }}
              value={newMemContent} onChange={(e) => setNewMemContent(e.target.value)} />
            <input placeholder="User ID (optional)" style={{ flex: 1.2, minWidth: 130 }}
              value={newMemUserId} onChange={(e) => setNewMemUserId(e.target.value)} />
            <button className="btn" onClick={addMemory}>Add</button>
          </div>
        </div>

        <div className="aicfg-mem-table-wrap">
          {filteredMemories.length === 0 ? (
            <div className="muted" style={{ padding: 30, textAlign: "center" }}>
              {memories.length === 0 ? "No memories yet. The AI will save memories as it learns about users and the server." : "No memories match your search."}
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
                      <td className="muted-text" style={{ fontSize: 12 }}>#{m.id}</td>
                      <td>
                        {m.userId ? (
                          <span className="badge warn aicfg-mem-user-badge" title={m.userId}>
                            👤 {m.displayName || m.userId}
                          </span>
                        ) : (
                          <span className="badge ok">🌐 Server</span>
                        )}
                      </td>
                      <td>{m.content}</td>
                      <td className="muted-text" style={{ fontSize: 12 }}>
                        {daysAgo === 0 ? "today" : `${daysAgo}d ago`}
                      </td>
                      <td className="align-center">
                        <button className="btn danger sm" onClick={() => deleteMemory(m.id)}>Del</button>
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
