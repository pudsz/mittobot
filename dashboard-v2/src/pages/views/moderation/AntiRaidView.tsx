import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild, useGuildMeta } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldBan, Lock, Unlock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { SaveBar } from "@/components/app/SaveBar";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface AntiraidConfig {
  enabled: boolean;
  joinRate: { maxJoins: number; windowSeconds: number };
  accountAge: { minAccountAgeHours: number; gateAction: "kick" | "quarantine" | "notify" };
  raidAction: "lockdown" | "kick_new" | "quarantine" | "notify";
  alertChannelId: string | null;
  cooldownMinutes: number;
  quarantineRoleId: string | null;
  exemptRoles: string[];
}

interface AntiraidData {
  guildId: string; hasGuild: boolean; guildName: string;
  config: AntiraidConfig; locked: boolean;
}

const RAID_ACTIONS: { value: AntiraidConfig["raidAction"]; label: string; desc: string }[] = [
  { value: "lockdown", label: "Lockdown", desc: "Deny SendMessages in all text channels, auto-unlock after cooldown" },
  { value: "kick_new", label: "Kick new joins", desc: "Kick everyone who joined in the raid window" },
  { value: "quarantine", label: "Quarantine new joins", desc: "Apply the quarantine role to new joins in the window" },
  { value: "notify", label: "Notify only", desc: "Alert the alert channel, take no automatic action" },
];

const GATE_ACTIONS: { value: AntiraidConfig["accountAge"]["gateAction"]; label: string }[] = [
  { value: "notify", label: "Notify only" },
  { value: "kick", label: "Kick" },
  { value: "quarantine", label: "Quarantine" },
];

export default function AntiRaidView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: meta } = useGuildMeta(guildId);

  const { data, isLoading } = useQuery<AntiraidData>({
    queryKey: ["antiraid", guildId],
    queryFn: () => get(guildPath("/api/antiraid", guildId)),
    enabled: !!guildId,
  });

  // Edits hold native types so the save payload matches what the API validates.
  const [edits, setEdits] = useState<Partial<AntiraidConfig> | null>(null);

  const cfg = data?.config;
  const current: AntiraidConfig = { ...(cfg || ({} as AntiraidConfig)), ...(edits || {}) } as AntiraidConfig;

  const dirty = edits !== null && Object.keys(edits).length > 0;

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => post(guildPath("/api/antiraid", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["antiraid", guildId] });
      setEdits(null);
      toast.success("Anti-raid config saved");
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Save failed"),
  });

  const unlockMutation = useMutation({
    mutationFn: () => post(guildPath("/api/antiraid", guildId), { unlock: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["antiraid", guildId] });
      toast.success("Lockdown lifted");
    },
    onError: (e: { message?: string }) => toast.error(e.message || "Unlock failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading anti-raid config...</div>;

  const set = <K extends keyof AntiraidConfig>(key: K, value: AntiraidConfig[K]) =>
    setEdits(prev => ({ ...(prev || {}), [key]: value }));

  const setJoinRate = (patch: Partial<AntiraidConfig["joinRate"]>) =>
    setEdits(prev => ({ ...(prev || {}), joinRate: { ...current.joinRate, ...patch } }));

  const setAccountAge = (patch: Partial<AntiraidConfig["accountAge"]>) =>
    setEdits(prev => ({ ...(prev || {}), accountAge: { ...current.accountAge, ...patch } }));

  const channels = meta?.channels || [];

  const handleSave = () => {
    if (!edits) return;
    saveMutation.mutate(edits as Record<string, unknown>);
  };

  return (
    <div className="space-y-4">
      <SaveBar dirty={dirty} saving={saveMutation.isPending} onSave={handleSave} onReset={() => setEdits(null)} />

      <div className="flex items-center gap-3">
        <ShieldBan className="size-5 text-destructive" />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight">Anti-raid</h1>
          <p className="text-xs text-muted-foreground">Join-rate detection, account-age gate, and lockdown — runs before welcomes/autoroles.</p>
        </div>
        <Switch checked={current.enabled} onCheckedChange={v => set("enabled", v)} />
      </div>

      {/* Lockdown status */}
      {data.locked && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Lock className="size-5 text-destructive" />
              <div>
                <div className="text-sm font-semibold text-destructive">Lockdown active</div>
                <div className="text-xs text-muted-foreground">SendMessages denied in all text channels. Auto-unlocks when the cooldown elapses.</div>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={async () => {
              if (!await confirm({ title: "Lift the lockdown now?", description: "This restores SendMessages in all locked channels immediately.", confirmLabel: "Lift lockdown" })) return;
              unlockMutation.mutate();
            }} disabled={unlockMutation.isPending}>
              <Unlock className="size-3.5 mr-1" /> Lift now
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Join-rate detection */}
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Join-rate detection</CardTitle>
            <CardDescription className="text-xs">If more than this many members join in the window, it's a raid.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Max joins</label>
              <Input type="number" min={2} max={100} className="mt-1 text-xs font-mono"
                value={current.joinRate?.maxJoins ?? 10}
                onChange={e => setJoinRate({ maxJoins: parseInt(e.target.value) || 10 })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Window (seconds)</label>
              <Input type="number" min={3} max={600} className="mt-1 text-xs font-mono"
                value={current.joinRate?.windowSeconds ?? 10}
                onChange={e => setJoinRate({ windowSeconds: parseInt(e.target.value) || 10 })} />
            </div>
          </CardContent>
        </Card>

        {/* Account-age gate */}
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Account-age gate</CardTitle>
            <CardDescription className="text-xs">Act on brand-new Discord accounts the moment they join.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Min account age (hours)</label>
                <Input type="number" min={0} max={720} className="mt-1 text-xs font-mono"
                  value={current.accountAge?.minAccountAgeHours ?? 0}
                  onChange={e => setAccountAge({ minAccountAgeHours: parseInt(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Gate action</label>
                <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono"
                  value={current.accountAge?.gateAction ?? "notify"}
                  onChange={e => setAccountAge({ gateAction: e.target.value as AntiraidConfig["accountAge"]["gateAction"] })}>
                  {GATE_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/70">0 hours = gate disabled. Owners and admins are always exempt.</p>
          </CardContent>
        </Card>
      </div>

      {/* Raid action */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Raid response</CardTitle>
          <CardDescription className="text-xs">What to do the instant the join-rate threshold is crossed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {RAID_ACTIONS.map(a => (
              <button key={a.value}
                onClick={() => set("raidAction", a.value)}
                className={`text-left p-3 rounded-lg border transition-colors ${current.raidAction === a.value ? "border-primary bg-primary/5" : "border-border/40 hover:bg-card/20"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{a.label}</span>
                  {current.raidAction === a.value && <Badge className="text-[9px]">selected</Badge>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{a.desc}</p>
              </button>
            ))}
          </div>
          {current.raidAction === "lockdown" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs text-muted-foreground">Auto-unlock cooldown (minutes)</label>
                <Input type="number" min={1} max={1440} className="mt-1 text-xs font-mono"
                  value={current.cooldownMinutes ?? 30}
                  onChange={e => set("cooldownMinutes", parseInt(e.target.value) || 30)} />
              </div>
            </div>
          )}
          {(current.raidAction === "quarantine" || current.accountAge?.gateAction === "quarantine") && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="size-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground">
                Quarantine requires a quarantine role set below, positioned below the bot's highest role.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Channels + roles */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Alerts &amp; quarantine</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Alert channel</label>
            <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono"
              value={current.alertChannelId ?? ""}
              onChange={e => set("alertChannelId", e.target.value || null)}>
              <option value="">— None —</option>
              {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Quarantine role (for quarantine actions)</label>
            <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono"
              value={current.quarantineRoleId ?? ""}
              onChange={e => set("quarantineRoleId", e.target.value || null)}>
              <option value="">— None —</option>
              {(meta?.roles || []).map(r => <option key={r.id} value={r.id}>@{r.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Exempt role IDs (comma-separated — bypass the account-age gate)</label>
            <Input className="mt-1 text-xs font-mono"
              value={(current.exemptRoles || []).join(", ")}
              onChange={e => set("exemptRoles", e.target.value.split(/[,\s]+/).filter(Boolean))}
              placeholder="role_id1, role_id2" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
