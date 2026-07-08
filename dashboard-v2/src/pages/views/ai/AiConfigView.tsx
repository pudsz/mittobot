import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { SaveBar } from "@/components/app/SaveBar";

const PROVIDER_META: Record<string, { label: string; keyField: string; modelField: string; models: string[] }> = {
  groq: { label: "Groq", keyField: "groqApiKey", modelField: "groqModel", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"] },
  openai: { label: "OpenAI", keyField: "openaiApiKey", modelField: "openaiModel", models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"] },
  claude: { label: "Claude (Anthropic)", keyField: "claudeApiKey", modelField: "claudeModel", models: ["claude-sonnet-4-20250514", "claude-3-5-haiku-latest", "claude-3-opus-latest"] },
  gemini: { label: "Gemini", keyField: "geminiApiKey", modelField: "geminiModel", models: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"] },
  custom: { label: "Custom", keyField: "customApiKey", modelField: "customModel", models: [] },
  nvidia: { label: "NVIDIA", keyField: "nvidiaApiKey", modelField: "nvidiaModel", models: ["mistralai/ministral-14b-instruct-2512"] },
  deepseek: { label: "DeepSeek", keyField: "deepseekApiKey", modelField: "deepseekModel", models: ["deepseek-chat"] },
  together: { label: "Together AI", keyField: "togetherApiKey", modelField: "togetherModel", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
  requesty: { label: "Requesty", keyField: "requestyApiKey", modelField: "requestyModel", models: ["openai/gpt-4o-mini", "openai/gpt-4o", "openai/o3-mini", "anthropic/claude-sonnet-4-20250514", "anthropic/claude-3-5-haiku-latest", "google/gemini-2.0-flash-001", "deepseek/deepseek-chat-v3-2", "meta-llama/llama-3.3-70b-instruct"] },
};

export default function AiConfigView() {
  const queryClient = useQueryClient();
  // edits stores NATIVE types (number | boolean | string) so the save payload
  // matches what ai.js updateSettings type-gates on: numeric settings require
  // `typeof === "number"`, booleans `typeof === "boolean"`. The previous
  // String() coercion silently dropped every numeric edit (temperature, topP,
  // maxTokens, contextLimit, chattyCooldown) with a misleading "saved" toast.
  const [edits, setEdits] = useState<Record<string, string | number | boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery<any>({ queryKey: ["ai"], queryFn: () => get("/api/ai") });

  const saveMutation = useMutation({
    mutationFn: (body: any) => post("/api/ai", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai"] });
      setEdits({});
      toast.success("AI config saved");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading AI config...</div>;

  const provider = data.aiProvider || "groq";
  const meta = PROVIDER_META[provider] || PROVIDER_META.groq;

  // Numeric AI settings — coerced to real numbers so they persist.
  const NUMERIC_KEYS = new Set(["aiTemperature", "aiTopP", "aiMaxTokens", "aiContextLimit", "aiChattyCooldown"]);

  // Store a native value: numbers stay numbers (NaN→0 guard), booleans stay
  // booleans, strings stay strings.
  const set = (key: string, value: string | number | boolean) => {
    if (NUMERIC_KEYS.has(key)) {
      const n = typeof value === "number" ? value : Number(value);
      setEdits(prev => ({ ...prev, [key]: Number.isNaN(n) ? 0 : n }));
    } else {
      setEdits(prev => ({ ...prev, [key]: value }));
    }
  };

  // String form for controlled input `value` props. Stringifies the native
  // value (boolean true→"true", number 1.5→"1.5"); "" for missing data so
  // inputs never render "undefined".
  const current = (key: string): string => {
    const v = edits[key] !== undefined ? edits[key] : data[key];
    return v === undefined || v === null ? "" : String(v);
  };

  // Native-vs-native: edits holds numbers/booleans, data holds the same.
  const dirty = Object.keys(edits).some(key => edits[key] !== data[key]);

  const handleSave = () => {
    // Send only changed keys, as native types (number/boolean/string) — no
    // String() coercion, so ai.js updateSettings accepts every field.
    const payload = Object.fromEntries(
      Object.entries(edits).filter(([k, v]) => v !== data[k])
    );
    saveMutation.mutate(payload);
  };

  const handleReset = () => {
    setEdits({});
    toast("Changes discarded");
  };

  return (
    <div className="space-y-4">
      <SaveBar dirty={dirty} saving={saveMutation.isPending} onSave={handleSave} onReset={handleReset} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Provider */}
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">Provider</CardTitle><CardDescription className="text-xs">Which AI backend to use</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs text-muted-foreground">Active Provider</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={current("aiProvider")} onChange={e => set("aiProvider", e.target.value)}>
                {Object.entries(PROVIDER_META).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-muted-foreground">API Key ({meta.label})</label>
              <div className="relative mt-1">
                <Input className="font-mono text-xs pr-9" type={showKey[meta.keyField] ? "text" : "password"} value={current(meta.keyField)} onChange={e => set(meta.keyField, e.target.value)} placeholder="sk-..." />
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowKey(prev => ({ ...prev, [meta.keyField]: !prev[meta.keyField] }))}>
                  {showKey[meta.keyField] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div><label className="text-xs text-muted-foreground">Model</label>
              <div className="flex gap-2 mt-1">
                <select className="flex-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={current(meta.modelField)} onChange={e => set(meta.modelField, e.target.value)}>
                  {/* Prefer the live model list from GET /api/ai (fetched by
                      getPublicSettingsAsync when the provider key is set);
                      fall back to PROVIDER_META's static list when no key is
                      configured so the dropdown is never empty. */}
                  {(Array.isArray(data.models) && data.models.length ? data.models : meta.models).map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
                <Input className="w-1/3 font-mono text-xs" value={current(meta.modelField)} onChange={e => set(meta.modelField, e.target.value)} placeholder="Custom model" />
              </div>
            </div>
            {provider === "custom" && (
              <>
                <div><label className="text-xs text-muted-foreground">Base URL</label>
                  <Input className="mt-1 font-mono text-xs" value={current("customBaseUrl")} onChange={e => set("customBaseUrl", e.target.value)} placeholder="https://api.example.com/v1" />
                </div>
                <div><label className="text-xs text-muted-foreground">API Type</label>
                  <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={current("customApiType")} onChange={e => set("customApiType", e.target.value)}>
                    <option value="openai">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic-compatible</option>
                  </select>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Parameters */}
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">Parameters</CardTitle><CardDescription className="text-xs">Response generation settings</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div><label className="text-xs text-muted-foreground">Temperature ({current("aiTemperature")})</label>
              <input type="range" min="0" max="2" step="0.05" className="w-full mt-1 accent-indigo-500" value={current("aiTemperature")} onChange={e => set("aiTemperature", e.target.value)} />
              <div className="flex justify-between text-[10px] text-muted-foreground/60"><span>Precise (0)</span><span>Creative (2)</span></div>
            </div>
            <div><label className="text-xs text-muted-foreground">Top P ({current("aiTopP")})</label>
              <input type="range" min="0" max="1" step="0.05" className="w-full mt-1 accent-indigo-500" value={current("aiTopP")} onChange={e => set("aiTopP", e.target.value)} />
              <div className="flex justify-between text-[10px] text-muted-foreground/60"><span>Narrow (0)</span><span>Broad (1)</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground">Max Tokens</label>
                <Input className="mt-1 font-mono text-xs" value={current("aiMaxTokens")} onChange={e => set("aiMaxTokens", e.target.value)} placeholder="4096" />
              </div>
              <div><label className="text-xs text-muted-foreground">Context Turns</label>
                <Input className="mt-1 font-mono text-xs" value={current("aiContextLimit")} onChange={e => set("aiContextLimit", e.target.value)} placeholder="8" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feature Flags */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Features</CardTitle><CardDescription className="text-xs">Toggle AI capabilities</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              ["aiEnabled", "AI Enabled", "Respond to mentions and keyword triggers"],
              ["aiToolsEnabled", "Tools", "Agent mode"],
              ["aiMemoryEnabled", "Memory", "Persist user/server memories"],
              ["aiThinkingEnabled", "Thinking", "It does what it says"],
              ["aiBrowserEnabled", "Web Browsing", "Web search"],
              ["aiChattyMode", "Chatty Mode", "auto respond to messages without a trigger"],
              ["aiDmEnabled", "DM Support", "Respond to direct messages"],
            ].map(([key, label, desc]) => (
              <div key={key} className="flex items-start gap-3 p-3 rounded-lg bg-background-alt/30 border border-border/20">
                <Switch checked={current(key) === "true"} onCheckedChange={v => set(key, v)} />
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-foreground">{label}</span>
                  {desc && <p className="text-[10px] text-muted-foreground">{desc}</p>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Prompt */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">System Prompt</CardTitle><CardDescription className="text-xs">The AI's base personality and instructions</CardDescription></CardHeader>
        <CardContent>
          <div className="relative">
            <textarea className="w-full h-32 bg-background-alt/50 border border-border/40 rounded-lg p-3 text-xs font-mono resize-y" value={current("aiSystemPrompt")} onChange={e => set("aiSystemPrompt", e.target.value)} />
            <span className="absolute bottom-2 right-2 text-[10px] text-muted-foreground/60 font-mono">{current("aiSystemPrompt").length} chars</span>
          </div>
        </CardContent>
      </Card>

      {/* Advanced */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Advanced</CardTitle><CardDescription className="text-xs">Filtering, keywords, and fallback config</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="text-xs text-muted-foreground">Keyword Trigger</label>
              <Input className="mt-1 font-mono text-xs" value={current("aiKeyword")} onChange={e => set("aiKeyword", e.target.value)} placeholder="mitto" />
            </div>
            <div><label className="text-xs text-muted-foreground">Chatty Cooldown (seconds)</label>
              <Input className="mt-1 font-mono text-xs" value={current("aiChattyCooldown")} onChange={e => set("aiChattyCooldown", e.target.value)} placeholder="60" />
            </div>
            <div><label className="text-xs text-muted-foreground">Personality</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={current("aiPersonality")} onChange={e => set("aiPersonality", e.target.value)}>
                <option value="neutral">Neutral</option>
                <option value="playful">Playful</option>
                <option value="serious">Serious</option>
                <option value="warm">Warm</option>
                <option value="quirky">Quirky</option>
              </select>
            </div>
            <div><label className="text-xs text-muted-foreground">Fallback Providers</label>
              <Input className="mt-1 font-mono text-xs" value={current("aiFallbackProviders")} onChange={e => set("aiFallbackProviders", e.target.value)} placeholder="e.g. openai, claude" />
            </div>
            <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Allowed Channels (IDs, comma-separated)</label>
              <Input className="mt-1 font-mono text-xs" value={current("aiAllowedChannels")} onChange={e => set("aiAllowedChannels", e.target.value)} placeholder="channel_id1, channel_id2" />
            </div>
            <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Ignored Channels (IDs, comma-separated)</label>
              <Input className="mt-1 font-mono text-xs" value={current("aiIgnoredChannels")} onChange={e => set("aiIgnoredChannels", e.target.value)} placeholder="channel_id1, channel_id2" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
