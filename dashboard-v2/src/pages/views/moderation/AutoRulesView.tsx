import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Zap, Plus, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

// Action types the backend's executeAction (src/autoexec.js) actually handles.
// The previous list offered send_message/warn_member/mute_member/kick_member,
// none of which the backend executes — a rule using them silently no-ops.
const TRIGGERS = ["message", "join", "leave", "reaction_added"];
const ACTION_TYPES = ["dm_user", "dm_mod", "log_channel", "add_role", "remove_role", "send_channel"];

interface Rule {
  id: number; trigger_event: string; enabled: number; priority: number;
  conditions: Record<string, any>; actions: any[];
}

export default function AutoRulesView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading } = useQuery<{ rules: Rule[] }>({
    queryKey: ["autoexec", guildId],
    queryFn: () => get(guildPath("/api/autoexec", guildId)),
    enabled: !!guildId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(guildPath(`/api/autoexec/${id}`, guildId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoexec", guildId] });
      toast.success("Rule deleted");
    },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  const toggleMutation = useMutation({
    mutationFn: async (rule: Rule) => {
      await post(guildPath("/api/autoexec", guildId), {
        id: rule.id,
        trigger_event: rule.trigger_event,
        enabled: !rule.enabled,
        priority: rule.priority,
        conditions: rule.conditions,
        actions: rule.actions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoexec", guildId] });
    },
    onError: (e: any) => toast.error(e.message || "Update failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading rules...</div>;

  const rules = data.rules || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Auto Rules</h1>
            <p className="text-xs text-muted-foreground">Event-triggered automation: event → conditions → actions</p>
          </div>
        </div>
        <Button size="sm" onClick={() => { setShowNew(true); setEditingId(null); }}>
          <Plus className="size-3.5 mr-1" /> New Rule
        </Button>
      </div>

      {rules.length === 0 && !showNew ? (
        <Card className="border-border/40 bg-card/30">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No auto rules yet. Create one to automate responses to events.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map(rule => (
            <Card key={rule.id} className="border-border/40 bg-card/40">
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Switch checked={!!rule.enabled} onCheckedChange={() => toggleMutation.mutate(rule)} />
                  <div>
                    <CardTitle className="text-sm font-semibold">Rule #{rule.id}</CardTitle>
                    <CardDescription className="text-xs">
                      <Badge variant="outline" className="mr-2 text-[10px]">{rule.trigger_event}</Badge>
                      <span className="text-muted-foreground">priority: {rule.priority}</span>
                    </CardDescription>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(rule.id); setShowNew(true); }}>
                    <Edit className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                    if (!await confirm({
                      title: `Delete rule #${rule.id}?`,
                      description: "This automation rule (its trigger, conditions, and actions) will be permanently deleted. Cannot be undone.",
                      confirmLabel: "Delete",
                    })) return;
                    deleteMutation.mutate(rule.id);
                  }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Conditions</h4>
                    <pre className="bg-background-alt/30 p-2 rounded text-[10px] font-mono overflow-auto max-h-24">
                      {JSON.stringify(rule.conditions, null, 2) || "{}"}
                    </pre>
                  </div>
                  <div>
                    <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Actions</h4>
                    <pre className="bg-background-alt/30 p-2 rounded text-[10px] font-mono overflow-auto max-h-24">
                      {JSON.stringify(rule.actions, null, 2) || "[]"}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showNew && (
        <RuleEditor
          guildId={guildId}
          editingId={editingId}
          onClose={() => { setShowNew(false); setEditingId(null); }}
        />
      )}
    </div>
  );
}

function RuleEditor({ guildId, editingId, onClose }: { guildId: string; editingId: number | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const existing = useQuery<{ rules: Rule[] }>({
    queryKey: ["autoexec", guildId],
    queryFn: () => get(guildPath("/api/autoexec", guildId)),
    enabled: !!guildId,
  });
  const initial = editingId ? existing.data?.rules.find(r => r.id === editingId) : null;

  const [trigger, setTrigger] = useState(initial?.trigger_event || "message");
  const [enabled, setEnabled] = useState(initial?.enabled !== 0);
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [conditionsJson, setConditionsJson] = useState(JSON.stringify(initial?.conditions || {}, null, 2));
  const [actionsJson, setActionsJson] = useState(JSON.stringify(initial?.actions || [{ type: "send_message", channelId: "", content: "" }], null, 2));

  const saveMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/autoexec", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoexec", guildId] });
      toast.success(editingId ? "Rule updated" : "Rule created");
      onClose();
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const handleSave = () => {
    try {
      const conditions = JSON.parse(conditionsJson || "{}");
      const actions = JSON.parse(actionsJson || "[]");
      saveMutation.mutate({
        ...(editingId ? { id: editingId } : {}),
        trigger_event: trigger,
        enabled: enabled ? 1 : 0,
        priority: parseInt(priority) || 0,
        conditions,
        actions,
      });
    } catch (e: any) {
      toast.error("JSON parse error: " + e.message);
    }
  };

  return (
    <Card className="border-border/40 bg-card/40">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">{editingId ? `Edit Rule #${editingId}` : "New Rule"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Trigger</label>
            <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={trigger} onChange={e => setTrigger(e.target.value)}>
              {TRIGGERS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Priority</label>
            <Input type="number" className="mt-1 text-xs font-mono" value={priority} onChange={e => setPriority(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-xs">Enabled</span>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Conditions (JSON object)</label>
          <textarea className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono h-20 resize-y" value={conditionsJson} onChange={e => setConditionsJson(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Actions (JSON array — types: {ACTION_TYPES.join(", ")})</label>
          <textarea className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono h-28 resize-y" value={actionsJson} onChange={e => setActionsJson(e.target.value)} />
        </div>
        <div className="flex gap-2 pt-2">
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving…" : editingId ? "Save Changes" : "Create Rule"}</Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
