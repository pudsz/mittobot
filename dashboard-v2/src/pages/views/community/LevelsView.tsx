import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { BarChart3, Plus, Trash2, Zap, Trophy } from "lucide-react";
import { toast } from "sonner";
import { SaveBar } from "@/components/app/SaveBar";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface RoleReward { level: number; roleId: string; removePrior: boolean }
interface LevelingConfig {
  enabled: boolean;
  minXp: number; maxXp: number; xpCooldownSeconds: number;
  levelUpMessage: string; levelUpDestination: string;
  channelMultipliers: Record<string, number>; roleMultipliers: Record<string, number>;
  roleRewards: RoleReward[]; stackRewards: boolean;
  ignoredChannels: string[]; ignoredRoles: string[];
  voiceXpPerMinute: number;
}
interface LevelingData {
  guildId: string; hasGuild: boolean; guildName: string;
  channels: { id: string; name: string }[]; roles: { id: string; name: string }[];
  config: LevelingConfig;
  leaderboard: { user_id: string; xp: number; level: number; messages: number; voice_minutes: number }[];
}

export default function LevelsView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery<LevelingData>({
    queryKey: ["leveling", guildId],
    queryFn: () => get(guildPath("/api/leveling", guildId)),
    enabled: !!guildId,
  });

  const [edits, setEdits] = useState<Partial<LevelingConfig> | null>(null);

  const cfg = data?.config;
  const current: LevelingConfig = { ...(cfg || {} as LevelingConfig), ...(edits || {}) } as LevelingConfig;
  const dirty = edits !== null && Object.keys(edits).length > 0;

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => post(guildPath("/api/leveling", guildId), body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leveling", guildId] }); setEdits(null); toast.success("Leveling config saved"); },
    onError: (e: { message?: string }) => toast.error(e.message || "Save failed"),
  });
  const resetMutation = useMutation({
    mutationFn: () => post(guildPath("/api/leveling/reset", guildId), {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["leveling", guildId] }); toast.success("All leveling data reset"); },
    onError: (e: { message?: string }) => toast.error(e.message || "Reset failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading leveling config...</div>;

  const set = <K extends keyof LevelingConfig>(key: K, value: LevelingConfig[K]) =>
    setEdits(prev => ({ ...(prev || {}), [key]: value }));

  const channels = data.channels || [];
  const roles = data.roles || [];
  const lb = data.leaderboard || [];

  const handleSave = () => { if (edits) saveMutation.mutate(edits); };

  // Channel/role multiplier editors — stored as { id: number } maps.
  const setChannelMult = (id: string, value: string) => {
    const num = parseFloat(value);
    setEdits(prev => ({ ...(prev || {}), channelMultipliers: { ...current.channelMultipliers, [id]: Number.isNaN(num) ? 0 : num } }));
  };
  const setRoleMult = (id: string, value: string) => {
    const num = parseFloat(value);
    setEdits(prev => ({ ...(prev || {}), roleMultipliers: { ...current.roleMultipliers, [id]: Number.isNaN(num) ? 0 : num } }));
  };

  // Role rewards ladder editor.
  const addReward = () => setEdits(prev => ({ ...(prev || {}), roleRewards: [...(current.roleRewards || []), { level: 5, roleId: "", removePrior: false }] }));
  const updateReward = (i: number, patch: Partial<RoleReward>) => setEdits(prev => ({ ...(prev || {}), roleRewards: (current.roleRewards || []).map((r, idx) => idx === i ? { ...r, ...patch } : r) }));
  const removeReward = (i: number) => setEdits(prev => ({ ...(prev || {}), roleRewards: (current.roleRewards || []).filter((_, idx) => idx !== i) }));

  return (
    <div className="space-y-4">
      <SaveBar dirty={dirty} saving={saveMutation.isPending} onSave={handleSave} onReset={() => setEdits(null)} />

      <div className="flex items-center gap-3">
        <BarChart3 className="size-5 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight">Leveling & XP</h1>
          <p className="text-xs text-muted-foreground">XP per message, level-up rewards, voice XP, leaderboard.</p>
        </div>
        <Switch checked={current.enabled} onCheckedChange={v => set("enabled", v)} />
      </div>

      {/* XP settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">XP settings</CardTitle><CardDescription className="text-xs">Per-message XP range + cooldown.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-muted-foreground">Min XP</label><Input type="number" min={0} max={1000} className="mt-1 text-xs font-mono" value={current.minXp} onChange={e => set("minXp", parseInt(e.target.value) || 0)} /></div>
            <div><label className="text-xs text-muted-foreground">Max XP</label><Input type="number" min={0} max={1000} className="mt-1 text-xs font-mono" value={current.maxXp} onChange={e => set("maxXp", parseInt(e.target.value) || 0)} /></div>
            <div><label className="text-xs text-muted-foreground">Cooldown (s)</label><Input type="number" min={0} max={3600} className="mt-1 text-xs font-mono" value={current.xpCooldownSeconds} onChange={e => set("xpCooldownSeconds", parseInt(e.target.value) || 0)} /></div>
            <div className="col-span-3"><label className="text-xs text-muted-foreground">Voice XP / minute (0 = off; needs ≥2 unmuted humans)</label><Input type="number" min={0} max={100} step={0.5} className="mt-1 text-xs font-mono" value={current.voiceXpPerMinute} onChange={e => set("voiceXpPerMinute", parseFloat(e.target.value) || 0)} /></div>
          </CardContent>
        </Card>

        {/* Level-up announcement */}
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">Level-up announcement</CardTitle><CardDescription className="text-xs">Where + what to say. Placeholders: {`{user} {username} {level} {server}`}.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs text-muted-foreground">Message</label><Input className="mt-1 text-xs font-mono" value={current.levelUpMessage} onChange={e => set("levelUpMessage", e.target.value)} placeholder="🎉 {user} reached level {level}!" /></div>
            <div>
              <label className="text-xs text-muted-foreground">Destination</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={current.levelUpDestination} onChange={e => set("levelUpDestination", e.target.value)}>
                <option value="channel">Same channel as the message</option>
                <option value="dm">Direct message</option>
                <option value="off">Off (no announcement)</option>
                {channels.map(c => <option key={c.id} value={`fixed:${c.id}`}>#{c.name} (fixed)</option>)}
              </select>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Multipliers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">Channel multipliers</CardTitle><CardDescription className="text-xs">0 disables XP in a channel. Default 1×.</CardDescription></CardHeader>
          <CardContent className="space-y-2 max-h-56 overflow-y-auto">
            {channels.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3">
                <span className="text-xs truncate">#{c.name}</span>
                <Input type="number" min={0} max={100} step={0.1} className="w-20 text-xs font-mono" value={current.channelMultipliers?.[c.id] ?? 1} onChange={e => setChannelMult(c.id, e.target.value)} />
              </div>
            ))}
            {!channels.length && <p className="text-xs text-muted-foreground">No channels.</p>}
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">Role multipliers</CardTitle><CardDescription className="text-xs">0 disables XP for members with the role.</CardDescription></CardHeader>
          <CardContent className="space-y-2 max-h-56 overflow-y-auto">
            {roles.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3">
                <span className="text-xs truncate">@{r.name}</span>
                <Input type="number" min={0} max={100} step={0.1} className="w-20 text-xs font-mono" value={current.roleMultipliers?.[r.id] ?? 1} onChange={e => setRoleMult(r.id, e.target.value)} />
              </div>
            ))}
            {!roles.length && <p className="text-xs text-muted-foreground">No roles.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Role rewards ladder */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="size-4 text-primary" /> Role rewards</CardTitle><CardDescription className="text-xs">Grant a role when a member reaches a level.</CardDescription></div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer"><Switch checked={current.stackRewards} onCheckedChange={v => set("stackRewards", v)} /> Stack rewards</label>
            <Button size="sm" variant="outline" onClick={addReward}><Plus className="size-3.5 mr-1" /> Add reward</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {(current.roleRewards || []).length === 0 && <p className="text-xs text-muted-foreground py-2">No reward roles configured. Members will earn levels with no role changes.</p>}
          {(current.roleRewards || []).map((rw, i) => (
            <div key={i} className="grid grid-cols-[70px_1fr_auto] gap-2 items-center">
              <div><label className="text-[10px] text-muted-foreground">Level</label><Input type="number" min={0} max={1000} className="text-xs font-mono" value={rw.level} onChange={e => updateReward(i, { level: parseInt(e.target.value) || 0 })} /></div>
              <div>
                <label className="text-[10px] text-muted-foreground">Role</label>
                <select className="w-full bg-background-alt/50 border border-border/40 rounded p-2 text-xs font-mono" value={rw.roleId} onChange={e => updateReward(i, { roleId: e.target.value })}>
                  <option value="">— Select role —</option>
                  {roles.map(r => <option key={r.id} value={r.id}>@{r.name}</option>)}
                </select>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive mt-4" onClick={() => removeReward(i)}><Trash2 className="size-3.5" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Leaderboard */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-semibold flex items-center gap-2"><Trophy className="size-4 text-primary" /> Leaderboard</CardTitle><CardDescription className="text-xs">Top members by XP (live).</CardDescription></div>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={resetMutation.isPending || !lb.length} onClick={async () => {
            if (!await confirm({ title: "Reset all leveling data?", description: "Permanently wipes XP, levels, and message counts for every member. Role rewards already granted are NOT removed. Cannot be undone.", confirmLabel: "Reset everything" })) return;
            resetMutation.mutate();
          }}>Reset all</Button>
        </CardHeader>
        <CardContent className="p-0">
          {!lb.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No one has earned XP yet. Enable leveling and members will appear here as they chat.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border/30">
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium w-12">#</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">User</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Level</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">XP</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Messages</th>
                </tr></thead>
                <tbody>
                  {lb.slice(0, 50).map((r, i) => (
                    <tr key={r.user_id} className="border-b border-border/20">
                      <td className="py-1.5 px-4 font-bold text-muted-foreground">{i + 1 <= 3 ? ["🥇","🥈","🥉"][i] : i + 1}</td>
                      <td className="py-1.5 px-4 font-mono text-muted-foreground">{r.user_id}</td>
                      <td className="py-1.5 px-4 text-right font-mono font-semibold">{r.level}</td>
                      <td className="py-1.5 px-4 text-right font-mono">{r.xp.toLocaleString()}</td>
                      <td className="py-1.5 px-4 text-right font-mono text-muted-foreground">{r.messages}</td>
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
