import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Plus, Trash2, FlaskConical, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { useGuild } from "@/hooks/useGuild";
import { guildPath } from "@/lib/api";
import { SaveBar } from "@/components/app/SaveBar";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface HeatThreshold { heat: number; action: "warn" | "mute" | "kick" | "ban"; duration?: string }
interface HeatConfig { enabled: boolean; decayPerMinute: number; thresholds: HeatThreshold[] }

interface AutomodConfig {
  guildId: string; hasGuild: boolean; guildName: string;
  channels: { id: string; name: string }[]; roles: { id: string; name: string }[];
  config: { enabled?: boolean; logChannelId?: string | null; ignoredChannels?: string[]; ignoredRoles?: string[]; rules?: Record<string, any>; heat?: HeatConfig };
}

const RULE_LABELS: Record<string, string> = { invites: "Invites", bannedWords: "Banned Words", spam: "Spam", massMention: "Mass Mention", caps: "All Caps", links: "Links", attachments: "Attachments", duplicates: "Duplicates", zalgo: "Zalgo", emoji: "Emoji", newlines: "Newlines", mentions_roles: "Role Mentions" };
const RULE_ACTIONS = ["delete", "warn", "mute"];
const HEAT_ACTIONS: HeatThreshold["action"][] = ["warn", "mute", "kick", "ban"];

export default function AutomodView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery<AutomodConfig>({
    queryKey: ["automod", guildId],
    queryFn: () => get(guildPath("/api/automod", guildId)),
    enabled: !!guildId,
  });

  // Trigger stats (BOT_SPEC §3.4)
  const { data: statsData, refetch: refetchStats } = useQuery<{ stats: { rule: string; day: string; count: number }[]; days: number }>({
    queryKey: ["automod-stats", guildId],
    queryFn: () => get(guildPath("/api/automod/stats", guildId) + "&days=30"),
    enabled: !!guildId,
  });

  const clearStatsMutation = useMutation({
    mutationFn: () => del(guildPath("/api/automod/stats", guildId)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["automod-stats", guildId] }); toast.success("Stats cleared"); },
    onError: (e: any) => toast.error(e.message || "Clear failed"),
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/automod", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automod", guildId] });
      toast.success("Automod configuration saved successfully");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const cfg: AutomodConfig["config"] = data?.config || {};
  const rules = cfg.rules || {};
  const [enabled, setEnabled] = useState(true);
  const [logCh, setLogCh] = useState("");
  const [ignoredCh, setIgnoredCh] = useState("");
  const [ignoredRoles, setIgnoredRoles] = useState("");
  const [ruleActions, setRuleActions] = useState<Record<string, string>>({});
  // Heat state (BOT_SPEC §3.2)
  const [heatEnabled, setHeatEnabled] = useState(false);
  const [heatDecay, setHeatDecay] = useState(5);
  const [heatThresholds, setHeatThresholds] = useState<HeatThreshold[]>([]);
  // Test mode state (BOT_SPEC §3.4)
  const [testInput, setTestInput] = useState("");
  const [testMentions, setTestMentions] = useState(0);
  const [testResult, setTestResult] = useState<{ hits: { rule: string; action: string }[]; enabled: boolean; notes: string[] } | null>(null);

  const testMutation = useMutation({
    mutationFn: (body: { content: string; mentionCount: number }) => post(guildPath("/api/automod/test", guildId), body),
    onSuccess: (r: any) => setTestResult(r),
    onError: (e: any) => { setTestResult(null); toast.error(e.message || "Test failed"); },
  });

  // Sync state when data is loaded/updated
  useEffect(() => {
    if (data?.config) {
      setEnabled(cfg.enabled ?? true);
      setLogCh(cfg.logChannelId || "");
      setIgnoredCh((cfg.ignoredChannels || []).join(", "));
      setIgnoredRoles((cfg.ignoredRoles || []).join(", "));
      const r: Record<string, string> = {};
      for (const key of Object.keys(RULE_LABELS)) {
        r[key] = rules[key]?.action || "delete";
      }
      setRuleActions(r);
      setHeatEnabled(cfg.heat?.enabled ?? false);
      setHeatDecay(cfg.heat?.decayPerMinute ?? 5);
      setHeatThresholds(cfg.heat?.thresholds?.length ? cfg.heat.thresholds : [{ heat: 20, action: "warn" }, { heat: 40, action: "mute", duration: "10m" }, { heat: 80, action: "kick" }]);
    }
  }, [data]);

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading automod...</div>;

  const rulesDirty = Object.keys(RULE_LABELS).some(key => {
    const originalAction = rules[key]?.action || "delete";
    const currentAction = ruleActions[key] || "delete";
    return originalAction !== currentAction;
  });

  // Heat dirty: compare current heat state against stored (or defaults).
  const storedHeat = cfg.heat;
  const heatDefaults: HeatConfig = { enabled: false, decayPerMinute: 5, thresholds: [{ heat: 20, action: "warn" }, { heat: 40, action: "mute", duration: "10m" }, { heat: 80, action: "kick" }] };
  const baseHeat = storedHeat ?? heatDefaults;
  const heatDirty =
    heatEnabled !== (baseHeat.enabled ?? false) ||
    heatDecay !== (baseHeat.decayPerMinute ?? 5) ||
    JSON.stringify(heatThresholds) !== JSON.stringify(baseHeat.thresholds ?? heatDefaults.thresholds);

  const dirty =
    enabled !== (cfg.enabled ?? true) ||
    logCh !== (cfg.logChannelId || "") ||
    ignoredCh !== (cfg.ignoredChannels || []).join(", ") ||
    ignoredRoles !== (cfg.ignoredRoles || []).join(", ") ||
    rulesDirty ||
    heatDirty;

  const handleSave = () => {
    const patch: any = {
      enabled,
      logChannelId: logCh || null,
      ignoredChannels: ignoredCh.split(/[,\s]+/).filter(Boolean),
      ignoredRoles: ignoredRoles.split(/[,\s]+/).filter(Boolean),
      rules: {},
      heat: { enabled: heatEnabled, decayPerMinute: heatDecay, thresholds: heatThresholds },
    };
    for (const key of Object.keys(RULE_LABELS)) {
      const existing = rules[key] || {};
      patch.rules[key] = { ...existing, enabled: existing.enabled !== false, action: ruleActions[key] || "delete" };
    }
    saveMutation.mutate(patch);
  };

  const handleReset = () => {
    if (data) {
      setEnabled(cfg.enabled ?? true);
      setLogCh(cfg.logChannelId || "");
      setIgnoredCh((cfg.ignoredChannels || []).join(", "));
      setIgnoredRoles((cfg.ignoredRoles || []).join(", "));
      const r: Record<string, string> = {};
      for (const key of Object.keys(RULE_LABELS)) {
        r[key] = rules[key]?.action || "delete";
      }
      setRuleActions(r);
      setHeatEnabled(baseHeat.enabled ?? false);
      setHeatDecay(baseHeat.decayPerMinute ?? 5);
      setHeatThresholds(baseHeat.thresholds ?? heatDefaults.thresholds);
      toast("Changes discarded");
    }
  };

  return (
    <div className="space-y-4">
      <SaveBar
        dirty={dirty}
        saving={saveMutation.isPending}
        onSave={handleSave}
        onReset={handleReset}
      />

      <div className="flex items-center gap-3">
        <button
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            enabled ? "bg-success/20 text-success border border-success/30" : "bg-muted text-muted-foreground border border-border/40"
          }`}
          onClick={() => setEnabled(!enabled)}
        >
          {enabled ? "ENABLED" : "DISABLED"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">Settings</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs text-muted-foreground">Log Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={logCh} onChange={e => setLogCh(e.target.value)}>
                <option value="">— None —</option>
                {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-muted-foreground">Ignored Channels (IDs)</label>
              <Input className="mt-1 text-xs font-mono" value={ignoredCh} onChange={e => setIgnoredCh(e.target.value)} placeholder="channel_id1, channel_id2" />
            </div>
            <div><label className="text-xs text-muted-foreground">Ignored Roles (IDs)</label>
              <Input className="mt-1 text-xs font-mono" value={ignoredRoles} onChange={e => setIgnoredRoles(e.target.value)} placeholder="role_id1, role_id2" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">Rules</CardTitle><CardDescription className="text-xs">Per-rule action settings</CardDescription></CardHeader>
          <CardContent className="space-y-3 max-h-72 overflow-y-auto">
            {Object.entries(RULE_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2"><ShieldAlert className="size-3.5 text-primary" /><span className="text-xs">{label}</span></div>
                <select className="bg-background-alt/50 border border-border/40 rounded px-2 py-1 text-xs font-mono" value={ruleActions[key] || "delete"} onChange={e => setRuleActions(prev => ({ ...prev, [key]: e.target.value }))}>
                  {RULE_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Heat system (BOT_SPEC §3.2) */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Heat system</CardTitle>
            <CardDescription className="text-xs">Every rule violation adds heat; actions trigger at thresholds. Escalates repeat offenders automatically.</CardDescription>
          </div>
          <Switch checked={heatEnabled} onCheckedChange={setHeatEnabled} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Decay per minute</label>
              <Input type="number" min={0} max={100} step={1} className="mt-1 text-xs font-mono" value={heatDecay} onChange={e => setHeatDecay(parseInt(e.target.value) || 0)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Thresholds (highest-first on save)</span>
              <Button size="sm" variant="outline" onClick={() => setHeatThresholds(t => [...t, { heat: 100, action: "ban" }])}>
                <Plus className="size-3.5 mr-1" /> Add threshold
              </Button>
            </div>
            {heatThresholds.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No thresholds — heat will accumulate but never act. Add at least one.</p>
            )}
            {heatThresholds.map((th, i) => (
              <div key={i} className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 items-center">
                <Input type="number" min={1} max={10000} className="text-xs font-mono" value={th.heat}
                  onChange={e => setHeatThresholds(t => t.map((x, idx) => idx === i ? { ...x, heat: parseInt(e.target.value) || 0 } : x))} />
                <select className="bg-background-alt/50 border border-border/40 rounded p-2 text-xs font-mono" value={th.action}
                  onChange={e => setHeatThresholds(t => t.map((x, idx) => idx === i ? { ...x, action: e.target.value as HeatThreshold["action"] } : x))}>
                  {HEAT_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <Input className="text-xs font-mono" placeholder='e.g. "10m"' value={th.duration || ""}
                  disabled={th.action !== "mute"}
                  onChange={e => setHeatThresholds(t => t.map((x, idx) => idx === i ? { ...x, duration: e.target.value || undefined } : x))} />
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setHeatThresholds(t => t.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground/70 pt-1">Heat is off by default. Durations (for mute) use the standard format: <code className="font-mono">30s</code>, <code className="font-mono">5m</code>, <code className="font-mono">2h</code>, <code className="font-mono">1d</code> (max 28d).</p>
          </div>
        </CardContent>
      </Card>

      {/* Test mode (BOT_SPEC §3.4) */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><FlaskConical className="size-4 text-primary" /> Test mode</CardTitle>
          <CardDescription className="text-xs">Dry-run every rule against a candidate message. Nothing is enforced, deleted, or counted.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col md:flex-row gap-2">
            <Input className="flex-1 text-xs font-mono" placeholder="Paste a message to test against your rules…" value={testInput}
              onKeyDown={e => { if (e.key === "Enter" && testInput.trim() && guildId) testMutation.mutate({ content: testInput, mentionCount: testMentions }); }}
              onChange={e => setTestInput(e.target.value)} />
            <div className="flex gap-2">
              <Input type="number" min={0} max={100} className="w-24 text-xs font-mono" placeholder="mentions"
                value={testMentions} onChange={e => setTestMentions(parseInt(e.target.value) || 0)} />
              <Button size="sm" disabled={!testInput.trim() || testMutation.isPending}
                onClick={() => testMutation.mutate({ content: testInput, mentionCount: testMentions })}>
                {testMutation.isPending ? "Testing…" : "Test"}
              </Button>
            </div>
          </div>

          {testResult && (
            <div className="rounded-lg border border-border/40 bg-background-alt/30 p-3 space-y-2">
              {!testResult.enabled && <p className="text-[10px] text-warning">⚠️ Automod is disabled in this guild — no rules would fire regardless.</p>}
              {testResult.hits.length === 0 ? (
                <p className="text-xs text-muted-foreground">✅ No rules would fire on this message.</p>
              ) : (
                <>
                  <p className="text-xs font-semibold">{testResult.hits.length} rule(s) would fire:</p>
                  <div className="flex flex-wrap gap-2">
                    {testResult.hits.map((h, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{h.rule} → {h.action}</Badge>
                    ))}
                  </div>
                </>
              )}
              {testResult.notes?.length > 0 && (
                <div className="space-y-1 pt-1">
                  {testResult.notes.map((n, i) => <p key={i} className="text-[10px] text-muted-foreground/60">{n}</p>)}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trigger stats (BOT_SPEC §3.4) */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="size-4 text-primary" /> Trigger stats (last 30 days)</CardTitle>
            <CardDescription className="text-xs">Per-rule violation counts, updated live as the bot enforces.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => refetchStats()}>Refresh</Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={clearStatsMutation.isPending || !statsData?.stats?.length}
              onClick={async () => {
                if (!await confirm({ title: "Clear all automod stats?", description: "This permanently deletes the trigger counters for this guild. Cannot be undone.", confirmLabel: "Clear stats" })) return;
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
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 px-4 text-muted-foreground font-medium">Rule</th>
                    <th className="text-left py-2 px-4 text-muted-foreground font-medium">Day</th>
                    <th className="text-right py-2 px-4 text-muted-foreground font-medium">Triggers</th>
                  </tr>
                </thead>
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
