import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Flame, Trash2, Plus } from "lucide-react";
import { SaveBar } from "@/components/app/SaveBar";
import { useConfirm } from "@/components/app/ConfirmProvider";

const ACTIONS = ["kick", "ban", "timeout"];
const TIMEOUT_PRESETS = [
  { value: 600000, label: "10 minutes" },
  { value: 3600000, label: "1 hour" },
  { value: 86400000, label: "1 day" },
  { value: 604800000, label: "1 week" },
];

interface DangerzoneConfig {
  guildId: string; hasGuild: boolean; guildName: string;
  channels: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  config: {
    channels: Record<string, {
      action: string; timeoutMs: number; logChannelId?: string | null;
      exemptRoles: string[]; reason: string;
    }>;
  };
}

export default function DangerzoneView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery<DangerzoneConfig>({
    queryKey: ["dangerzone", guildId],
    queryFn: () => get(guildPath("/api/dangerzone", guildId)),
    enabled: !!guildId,
  });

  const [edits, setEdits] = useState<Record<string, any>>({});
  const [selectedCh, setSelectedCh] = useState("");
  const [newAction, setNewAction] = useState("kick");
  const [newTimeout, setNewTimeout] = useState("3600000");

  // Only reseed edits when the set of configured channel IDs actually changes
  // (add/remove server-side, or after an add/remove mutation). The previous
  // effect reseeded on every `data` change — including a refetch-on-focus —
  // which silently discarded a user's in-progress edits whenever they
  // Alt-Tabbed away and back.
  const lastChannelIds = useRef<string>("");
  useEffect(() => {
    if (!data?.config) return;
    const ids = Object.keys(data.config.channels || {}).sort().join(",");
    if (ids !== lastChannelIds.current) {
      lastChannelIds.current = ids;
      setEdits(data.config.channels || {});
    }
  }, [data]);

  const addMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/dangerzone", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dangerzone", guildId] });
      toast.success("Dangerzone channel added");
      setSelectedCh("");
    },
    onError: (e: any) => toast.error(e.message || "Add failed"),
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/dangerzone", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dangerzone", guildId] });
      toast.success("Dangerzone updated");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const removeMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/dangerzone/remove", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dangerzone", guildId] });
      toast.success("Channel removed");
    },
    onError: (e: any) => toast.error(e.message || "Remove failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading dangerzone config...</div>;

  const channelEntries = Object.entries(edits || {});
  const dirty = JSON.stringify(channelEntries) !== JSON.stringify(Object.entries(data.config.channels || {}));

  const handleAdd = () => {
    if (!selectedCh) return;
    if (channelEntries.some(([id]) => id === selectedCh)) {
      toast.error("Channel already configured");
      return;
    }
    addMutation.mutate({
      channelId: selectedCh,
      action: newAction,
      timeoutMs: newAction === "timeout" ? parseInt(newTimeout) : 0,
      exemptRoles: [],
      reason: "Posted in dangerzone",
    });
  };

  const updateChannelField = (channelId: string, field: string, value: any) => {
    setEdits((prev: any) => ({
      ...prev,
      [channelId]: { ...(prev[channelId] || {}), [field]: value },
    }));
  };

  const handleSave = () => {
    for (const [channelId, cfg] of channelEntries) {
      updateMutation.mutate({ channelId, ...cfg });
    }
  };

  return (
    <div className="space-y-4">
      <SaveBar dirty={dirty} saving={updateMutation.isPending} onSave={handleSave} onReset={() => setEdits(data.config.channels || {})} />

      <div className="flex items-center gap-3">
        <Flame className="size-5 text-destructive" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dangerzone Trap Channels</h1>
          <p className="text-xs text-muted-foreground">Channels that auto-punish any message posted in them (catches hacked accounts).</p>
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Add Trap Channel</CardTitle><CardDescription className="text-xs">Pick a channel and the punishment that triggers when anyone posts in it</CardDescription></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={selectedCh} onChange={e => setSelectedCh(e.target.value)}>
                <option value="">— Select channel —</option>
                {data.channels.filter(c => !channelEntries.some(([id]) => id === c.id)).map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Action</label>
              <select className="mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={newAction} onChange={e => setNewAction(e.target.value)}>
                {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {newAction === "timeout" && (
              <div>
                <label className="text-xs text-muted-foreground">Duration</label>
                <select className="mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={newTimeout} onChange={e => setNewTimeout(e.target.value)}>
                  {TIMEOUT_PRESETS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            )}
            <Button size="sm" onClick={handleAdd} disabled={!selectedCh || addMutation.isPending}>
              <Plus className="size-3.5 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {channelEntries.length === 0 ? (
        <Card className="border-border/40 bg-card/30">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No dangerzone channels configured yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {channelEntries.map(([channelId, cfg]) => {
            const channel = data.channels.find(c => c.id === channelId);
            return (
              <Card key={channelId} className="border-border/40 bg-card/40">
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <div className="flex items-center gap-2">
                    <Flame className="size-4 text-destructive" />
                    <CardTitle className="text-sm font-semibold">#{channel?.name || channelId}</CardTitle>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                    if (!await confirm({
                      title: `Remove trap channel #${channel?.name || channelId}?`,
                      description: "This disables dangerzone protection for the channel. Any message posted there will no longer be auto-punished.",
                      confirmLabel: "Remove",
                    })) return;
                    removeMutation.mutate({ channelId });
                  }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Action</label>
                    <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={cfg.action || "kick"} onChange={e => updateChannelField(channelId, "action", e.target.value)}>
                      {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Timeout (ms)</label>
                    <Input className="mt-1 text-xs font-mono" type="number" value={cfg.timeoutMs || 0} onChange={e => updateChannelField(channelId, "timeoutMs", parseInt(e.target.value) || 0)} disabled={cfg.action !== "timeout"} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Log Channel</label>
                    <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={cfg.logChannelId || ""} onChange={e => updateChannelField(channelId, "logChannelId", e.target.value || null)}>
                      <option value="">— None —</option>
                      {data.channels.filter(c => c.id !== channelId).map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Exempt Role IDs</label>
                    <Input className="mt-1 text-xs font-mono" value={(cfg.exemptRoles || []).join(", ")} onChange={e => updateChannelField(channelId, "exemptRoles", e.target.value.split(/[,\s]+/).filter(Boolean))} placeholder="role_id1, role_id2" />
                  </div>
                  <div className="col-span-2 md:col-span-4">
                    <label className="text-xs text-muted-foreground">Reason</label>
                    <Input className="mt-1 text-xs font-mono" value={cfg.reason || ""} onChange={e => updateChannelField(channelId, "reason", e.target.value)} placeholder="Posted in dangerzone" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
