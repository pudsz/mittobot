import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Plus, Trash2, FlaskConical, BarChart3, Link2, AtSign, Image as ImageIcon, Hash, Regex, Zap } from "lucide-react";
import { toast } from "sonner";
import { useGuild } from "@/hooks/useGuild";
import { guildPath } from "@/lib/api";
import { SaveBar } from "@/components/app/SaveBar";
import { useConfirm } from "@/components/app/ConfirmProvider";

// ─── Types: the full unified automod config shape ───────────────────────────
interface BaseRule { enabled?: boolean; action: string; [k: string]: any }
interface HeatThreshold { heat: number; action: "warn" | "mute" | "kick" | "ban"; duration?: string }
interface ExtendedConfig {
  link_blacklist: string[]; link_whitelist: string[]; link_action: string;
  repeated_text: boolean; repeated_text_count: number; repeated_text_action: string;
  emoji_spam: boolean; emoji_max: number; emoji_action: string;
  blocked_emojis_enabled: boolean; blocked_emojis: string[]; blocked_emojis_action: string;
  blocked_reaction_emojis_enabled: boolean; blocked_reaction_emojis: string[]; blocked_reaction_action: string;
  zalgo_enabled: boolean; zalgo_action: string;
  regex_enabled: boolean; regex_patterns: string[]; regex_action: string;
  attachments_enabled: boolean; attachments_blocked_exts: string[]; attachments_max_size_mb: number; attachments_action: string;
  newlines_enabled: boolean; newlines_max: number; newlines_action: string;
  mentions_roles_enabled: boolean; mentions_roles_max: number; mentions_roles_action: string;
}
interface UnifiedConfig {
  enabled: boolean; logChannelId: string | null; ignoredChannels: string[]; ignoredRoles: string[];
  rules: Record<string, BaseRule>;
  heat: { enabled: boolean; decayPerMinute: number; thresholds: HeatThreshold[] };
  extended: ExtendedConfig;
}
interface AutomodData {
  guildId: string; hasGuild: boolean; guildName: string;
  channels: { id: string; name: string }[]; roles: { id: string; name: string }[];
  config: UnifiedConfig;
}

const RULE_ACTIONS = ["delete", "warn", "mute"];
const HEAT_ACTIONS: HeatThreshold["action"][] = ["warn", "mute", "kick", "ban"];

const BASE_RULES: { key: string; label: string }[] = [
  { key: "invites", label: "Invites" },
  { key: "bannedWords", label: "Banned Words" },
  { key: "spam", label: "Spam" },
  { key: "massMention", label: "Mass Mention" },
  { key: "caps", label: "All Caps" },
];

const DEFAULT_THRESHOLDS: HeatThreshold[] = [
  { heat: 20, action: "warn" },
  { heat: 40, action: "mute", duration: "10m" },
  { heat: 80, action: "kick" },
];

// A small labelled toggle row used across the extended-rule cards.
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ActionSelect({ value, onChange, options = RULE_ACTIONS }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  return (
    <select className="bg-background-alt/50 border border-border/40 rounded px-2 py-1 text-xs font-mono" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(a => <option key={a} value={a}>{a}</option>)}
    </select>
  );
}

export default function AutomodV2View() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery<AutomodData>({
    queryKey: ["automod-v2", guildId],
    queryFn: () => get(guildPath("/api/automod", guildId)),
    enabled: !!guildId,
  });

  const { data: statsData, refetch: refetchStats } = useQuery<{ stats: { rule: string; day: string; count: number }[]; days: number }>({
    queryKey: ["automod-stats-v2", guildId],
    queryFn: () => get(guildPath("/api/automod/stats", guildId) + "&days=30"),
    enabled: !!guildId,
  });

  // ── Edit state: one big draft object mirroring the unified config ────────
  const [draft, setDraft] = useState<{ base?: Partial<UnifiedConfig>; extended?: Partial<ExtendedConfig> }>({});

  const saveMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/automod", guildId), body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["automod-v2", guildId] }); setDraft({}); toast.success("Automod v2 config saved"); },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });
  const clearStatsMutation = useMutation({
    mutationFn: () => del(guildPath("/api/automod/stats", guildId)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["automod-stats-v2", guildId] }); toast.success("Stats cleared"); },
    onError: (e: any) => toast.error(e.message || "Clear failed"),
  });

  const cfg = data?.config;
  const base = { ...cfg, ...draft.base } as UnifiedConfig;
  const ext = { ...(cfg?.extended || {} as ExtendedConfig), ...draft.extended } as ExtendedConfig;

  useEffect(() => { if (data) setDraft({}); }, [data]);

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading automod v2...</div>;

  // ── Patch helpers ────────────────────────────────────────────────────────
  const setBase = (patch: Partial<UnifiedConfig>) => setDraft(d => ({ ...d, base: { ...(d.base || {}), ...patch } }));
  const setExt = (patch: Partial<ExtendedConfig>) => setDraft(d => ({ ...d, extended: { ...(d.extended || {}), ...patch } }));
  const setRule = (key: string, patch: Partial<BaseRule>) => {
    const rules = { ...(base.rules || {}), [key]: { ...(base.rules?.[key] || {}), ...patch } };
    setBase({ rules });
  };
  const setHeat = (patch: Partial<UnifiedConfig["heat"]>) => setBase({ heat: { ...base.heat, ...patch } });

  const dirty = Object.keys(draft.base || {}).length > 0 || Object.keys(draft.extended || {}).length > 0;

  const handleSave = () => {
    const payload: any = {};
    if (draft.base) payload.rules = base.rules; // always send full rules for consistency
    if (draft.base) Object.assign(payload, draft.base);
    if (draft.extended) payload.extended = draft.extended;
    // Ensure rules always present if we're sending base at all
    if (payload.enabled !== undefined || payload.rules || payload.heat) {
      payload.rules = base.rules;
      payload.heat = base.heat;
    }
    saveMutation.mutate(payload);
  };

  // ── Test mode ────────────────────────────────────────────────────────────
  const [testInput, setTestInput] = useState("");
  const [testMentions, setTestMentions] = useState(0);
  const [testResult, setTestResult] = useState<{ hits: { rule: string; action: string }[]; enabled: boolean; notes: string[] } | null>(null);
  const testMutation = useMutation({
    mutationFn: (body: { content: string; mentionCount: number }) => post(guildPath("/api/automod/test", guildId), body),
    onSuccess: (r: any) => setTestResult(r),
    onError: (e: any) => { setTestResult(null); toast.error(e.message || "Test failed"); },
  });

  return (
    <div className="space-y-4">
      <SaveBar dirty={dirty} saving={saveMutation.isPending} onSave={handleSave} onReset={() => setDraft({})} />

      <div className="flex items-center gap-3">
        <ShieldAlert className="size-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight">Automod v2</h1>
          <p className="text-xs text-muted-foreground">Unified moderation: base rules, extended rules, heat escalation, test mode, and trigger stats.</p>
        </div>
        <Switch checked={base.enabled} onCheckedChange={v => setBase({ enabled: v })} />
      </div>

      {/* ── Base settings ── */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">General</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Log channel</label>
            <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={base.logChannelId ?? ""} onChange={e => setBase({ logChannelId: e.target.value || null })}>
              <option value="">— None —</option>
              {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ignored channels (IDs)</label>
            <Input className="mt-1 text-xs font-mono" value={(base.ignoredChannels || []).join(", ")} onChange={e => setBase({ ignoredChannels: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="id1, id2" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ignored roles (IDs)</label>
            <Input className="mt-1 text-xs font-mono" value={(base.ignoredRoles || []).join(", ")} onChange={e => setBase({ ignoredRoles: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="id1, id2" />
          </div>
        </CardContent>
      </Card>

      {/* ── Base rules ── */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Base rules</CardTitle><CardDescription className="text-xs">The 5 built-in rules. Each adds heat when heat is enabled.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {BASE_RULES.map(r => {
            const rule = base.rules?.[r.key] || { action: "delete" };
            return (
              <div key={r.key} className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Switch checked={rule.enabled !== false} onCheckedChange={v => setRule(r.key, { enabled: v })} /><span className="text-xs font-semibold">{r.label}</span></div>
                  <ActionSelect value={rule.action || "delete"} onChange={v => setRule(r.key, { action: v })} />
                </div>
                {r.key === "bannedWords" && (
                  <Input className="text-xs font-mono" placeholder="comma-separated banned words" value={(rule.words || []).join(", ")} onChange={e => setRule(r.key, { words: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
                )}
                {r.key === "spam" && (
                  <div className="grid grid-cols-3 gap-2">
                    <div><label className="text-[10px] text-muted-foreground">Max msgs</label><Input type="number" className="text-xs font-mono" value={rule.maxMessages ?? 5} onChange={e => setRule(r.key, { maxMessages: parseInt(e.target.value) || 5 })} /></div>
                    <div><label className="text-[10px] text-muted-foreground">Per seconds</label><Input type="number" className="text-xs font-mono" value={rule.perSeconds ?? 5} onChange={e => setRule(r.key, { perSeconds: parseInt(e.target.value) || 5 })} /></div>
                    <div><label className="text-[10px] text-muted-foreground">Mute (ms)</label><Input type="number" className="text-xs font-mono" value={rule.muteMs ?? 300000} onChange={e => setRule(r.key, { muteMs: parseInt(e.target.value) || 300000 })} /></div>
                  </div>
                )}
                {r.key === "massMention" && (
                  <div><label className="text-[10px] text-muted-foreground">Max mentions</label><Input type="number" className="text-xs font-mono" value={rule.maxMentions ?? 5} onChange={e => setRule(r.key, { maxMentions: parseInt(e.target.value) || 5 })} /></div>
                )}
                {r.key === "caps" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-[10px] text-muted-foreground">Min length</label><Input type="number" className="text-xs font-mono" value={rule.minLength ?? 10} onChange={e => setRule(r.key, { minLength: parseInt(e.target.value) || 10 })} /></div>
                    <div><label className="text-[10px] text-muted-foreground">Caps %</label><Input type="number" className="text-xs font-mono" value={rule.percent ?? 70} onChange={e => setRule(r.key, { percent: parseInt(e.target.value) || 70 })} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Extended rules (content-based) ── */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><Link2 className="size-4 text-primary" /> Content rules</CardTitle><CardDescription className="text-xs">Links, duplicates, emoji, zalgo, regex, newlines.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {/* Links */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold">Link filtering</span><span className="text-[10px] text-muted-foreground">blocklist / allowlist mode</span></div>
            <Input className="text-xs font-mono" placeholder="blacklisted domains (comma-sep)" value={ext.link_blacklist.join(", ")} onChange={e => setExt({ link_blacklist: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
            <Input className="text-xs font-mono" placeholder="whitelisted domains (exempts all links from these)" value={ext.link_whitelist.join(", ")} onChange={e => setExt({ link_whitelist: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
            <ActionSelect value={ext.link_action} onChange={v => setExt({ link_action: v })} />
          </div>
          {/* Repeated text */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <ToggleRow label="Repeated text" checked={ext.repeated_text} onChange={v => setExt({ repeated_text: v })} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-muted-foreground">Threshold (×)</label><Input type="number" className="text-xs font-mono" value={ext.repeated_text_count} onChange={e => setExt({ repeated_text_count: parseInt(e.target.value) || 3 })} /></div>
              <div className="flex items-end"><ActionSelect value={ext.repeated_text_action} onChange={v => setExt({ repeated_text_action: v })} /></div>
            </div>
          </div>
          {/* Emoji spam */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <ToggleRow label="Emoji spam" checked={ext.emoji_spam} onChange={v => setExt({ emoji_spam: v })} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-muted-foreground">Max emoji</label><Input type="number" className="text-xs font-mono" value={ext.emoji_max} onChange={e => setExt({ emoji_max: parseInt(e.target.value) || 5 })} /></div>
              <div className="flex items-end"><ActionSelect value={ext.emoji_action} onChange={v => setExt({ emoji_action: v })} /></div>
            </div>
          </div>
          {/* Blocked emojis */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <ToggleRow label="Blocked emojis (in messages)" checked={ext.blocked_emojis_enabled} onChange={v => setExt({ blocked_emojis_enabled: v })} />
            <Input className="text-xs font-mono" placeholder="emoji tokens (unicode or custom id), comma-sep" value={ext.blocked_emojis.join(", ")} onChange={e => setExt({ blocked_emojis: e.target.value.split(/[,]+/).map(s => s.trim()).filter(Boolean) })} />
            <ActionSelect value={ext.blocked_emojis_action} onChange={v => setExt({ blocked_emojis_action: v })} />
          </div>
          {/* Zalgo */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <ToggleRow label="Zalgo / unicode abuse" checked={ext.zalgo_enabled} onChange={v => setExt({ zalgo_enabled: v })} />
            <ActionSelect value={ext.zalgo_action} onChange={v => setExt({ zalgo_action: v })} />
          </div>
          {/* Regex (§3.1) */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <div className="flex items-center gap-2"><Regex className="size-3.5 text-primary" /><span className="text-xs font-semibold">Regex patterns</span><span className="text-[10px] text-muted-foreground">(max 10, tested on first 2k chars)</span></div>
            <ToggleRow label="Enabled" checked={ext.regex_enabled} onChange={v => setExt({ regex_enabled: v })} />
            <textarea className="w-full bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono h-20 resize-y" placeholder="one pattern per line, e.g. \bcoin\b" value={ext.regex_patterns.join("\n")} onChange={e => setExt({ regex_patterns: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })} />
            <ActionSelect value={ext.regex_action} onChange={v => setExt({ regex_action: v })} />
          </div>
          {/* Newlines (§3.1) */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <div className="flex items-center gap-2"><Hash className="size-3.5 text-primary" /><span className="text-xs font-semibold">Newline spam (wall-of-text)</span></div>
            <ToggleRow label="Enabled" checked={ext.newlines_enabled} onChange={v => setExt({ newlines_enabled: v })} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-muted-foreground">Max newlines</label><Input type="number" className="text-xs font-mono" value={ext.newlines_max} onChange={e => setExt({ newlines_max: parseInt(e.target.value) || 10 })} /></div>
              <div className="flex items-end"><ActionSelect value={ext.newlines_action} onChange={v => setExt({ newlines_action: v })} /></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Extended rules (message-based) ── */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><ImageIcon className="size-4 text-primary" /> Message rules</CardTitle><CardDescription className="text-xs">Attachments + role mentions (need the message object — not in test mode).</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {/* Attachments (§3.1) */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <ToggleRow label="Attachment filtering" checked={ext.attachments_enabled} onChange={v => setExt({ attachments_enabled: v })} />
            <Input className="text-xs font-mono" placeholder="blocked extensions (e.g. exe, bat, scr), comma-sep" value={ext.attachments_blocked_exts.join(", ")} onChange={e => setExt({ attachments_blocked_exts: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-muted-foreground">Max size (MB, 0 = no cap)</label><Input type="number" className="text-xs font-mono" value={ext.attachments_max_size_mb} onChange={e => setExt({ attachments_max_size_mb: parseFloat(e.target.value) || 0 })} /></div>
              <div className="flex items-end"><ActionSelect value={ext.attachments_action} onChange={v => setExt({ attachments_action: v })} /></div>
            </div>
          </div>
          {/* Role mentions (§3.1) */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <div className="flex items-center gap-2"><AtSign className="size-3.5 text-primary" /><span className="text-xs font-semibold">Mass role mention</span></div>
            <ToggleRow label="Enabled" checked={ext.mentions_roles_enabled} onChange={v => setExt({ mentions_roles_enabled: v })} />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-muted-foreground">Max role mentions</label><Input type="number" className="text-xs font-mono" value={ext.mentions_roles_max} onChange={e => setExt({ mentions_roles_max: parseInt(e.target.value) || 3 })} /></div>
              <div className="flex items-end"><ActionSelect value={ext.mentions_roles_action} onChange={v => setExt({ mentions_roles_action: v })} /></div>
            </div>
          </div>
          {/* Blocked reaction emojis */}
          <div className="rounded-lg border border-border/30 bg-background-alt/20 p-3 space-y-2">
            <ToggleRow label="Blocked reaction emojis" checked={ext.blocked_reaction_emojis_enabled} onChange={v => setExt({ blocked_reaction_emojis_enabled: v })} />
            <Input className="text-xs font-mono" placeholder="emoji tokens, comma-sep" value={ext.blocked_reaction_emojis.join(", ")} onChange={e => setExt({ blocked_reaction_emojis: e.target.value.split(/[,]+/).map(s => s.trim()).filter(Boolean) })} />
            <ActionSelect value={ext.blocked_reaction_action} onChange={v => setExt({ blocked_reaction_action: v })} options={["delete", "warn", "mute", "kick", "ban"]} />
          </div>
        </CardContent>
      </Card>

      {/* ── Heat system ── */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="size-4 text-primary" /> Heat system</CardTitle><CardDescription className="text-xs">Every violation adds heat; actions trigger at thresholds. Escalates repeat offenders.</CardDescription></div>
          <Switch checked={base.heat?.enabled} onCheckedChange={v => setHeat({ enabled: v })} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Decay per minute</label>
              <Input type="number" min={0} max={100} className="mt-1 text-xs font-mono" value={base.heat?.decayPerMinute ?? 5} onChange={e => setHeat({ decayPerMinute: parseInt(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Thresholds</span>
              <Button size="sm" variant="outline" onClick={() => setHeat({ thresholds: [...(base.heat?.thresholds || []), { heat: 100, action: "ban" }] })}><Plus className="size-3.5 mr-1" /> Add</Button>
            </div>
            {(base.heat?.thresholds || DEFAULT_THRESHOLDS).map((th, i) => {
              const thresholds = base.heat?.thresholds || DEFAULT_THRESHOLDS;
              return (
                <div key={i} className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 items-center">
                  <Input type="number" min={1} max={10000} className="text-xs font-mono" value={th.heat} onChange={e => setHeat({ thresholds: thresholds.map((x, idx) => idx === i ? { ...x, heat: parseInt(e.target.value) || 0 } : x) })} />
                  <select className="bg-background-alt/50 border border-border/40 rounded p-2 text-xs font-mono" value={th.action} onChange={e => setHeat({ thresholds: thresholds.map((x, idx) => idx === i ? { ...x, action: e.target.value as HeatThreshold["action"] } : x) })}>
                    {HEAT_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <Input className="text-xs font-mono" placeholder='e.g. "10m"' value={th.duration || ""} disabled={th.action !== "mute"} onChange={e => setHeat({ thresholds: thresholds.map((x, idx) => idx === i ? { ...x, duration: e.target.value || undefined } : x) })} />
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setHeat({ thresholds: thresholds.filter((_, idx) => idx !== i) })}><Trash2 className="size-3.5" /></Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Test mode ── */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><FlaskConical className="size-4 text-primary" /> Test mode</CardTitle><CardDescription className="text-xs">Dry-run all content rules. Nothing is enforced or counted.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col md:flex-row gap-2">
            <Input className="flex-1 text-xs font-mono" placeholder="Paste a message to test…" value={testInput} onKeyDown={e => { if (e.key === "Enter" && testInput.trim()) testMutation.mutate({ content: testInput, mentionCount: testMentions }); }} onChange={e => setTestInput(e.target.value)} />
            <div className="flex gap-2">
              <Input type="number" min={0} max={100} className="w-24 text-xs font-mono" placeholder="mentions" value={testMentions} onChange={e => setTestMentions(parseInt(e.target.value) || 0)} />
              <Button size="sm" disabled={!testInput.trim() || testMutation.isPending} onClick={() => testMutation.mutate({ content: testInput, mentionCount: testMentions })}>{testMutation.isPending ? "Testing…" : "Test"}</Button>
            </div>
          </div>
          {testResult && (
            <div className="rounded-lg border border-border/40 bg-background-alt/30 p-3 space-y-2">
              {!testResult.enabled && <p className="text-[10px] text-warning">⚠️ Automod is disabled — no rules would fire regardless.</p>}
              {testResult.hits.length === 0 ? <p className="text-xs text-muted-foreground">✅ No rules would fire.</p> : (
                <>
                  <p className="text-xs font-semibold">{testResult.hits.length} rule(s) would fire:</p>
                  <div className="flex flex-wrap gap-2">{testResult.hits.map((h, i) => <Badge key={i} variant="outline" className="text-[10px]">{h.rule} → {h.action}</Badge>)}</div>
                </>
              )}
              {testResult.notes?.length > 0 && <div className="space-y-1 pt-1">{testResult.notes.map((n, i) => <p key={i} className="text-[10px] text-muted-foreground/60">{n}</p>)}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Trigger stats ── */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="size-4 text-primary" /> Trigger stats (30 days)</CardTitle><CardDescription className="text-xs">Per-rule violation counts.</CardDescription></div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetchStats()}>Refresh</Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={clearStatsMutation.isPending || !statsData?.stats?.length} onClick={async () => {
              if (!await confirm({ title: "Clear all automod stats?", description: "Permanently deletes the trigger counters for this guild.", confirmLabel: "Clear stats" })) return;
              clearStatsMutation.mutate();
            }}>Clear</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!statsData?.stats?.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No automod triggers recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border/30">
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">Rule</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">Day</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Triggers</th>
                </tr></thead>
                <tbody>
                  {statsData.stats.slice(0, 50).map((s, i) => (
                    <tr key={i} className="border-b border-border/20">
                      <td className="py-1.5 px-4 font-mono">{s.rule}</td>
                      <td className="py-1.5 px-4 text-muted-foreground font-mono">{s.day}</td>
                      <td className="py-1.5 px-4 text-right font-mono font-semibold">{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
