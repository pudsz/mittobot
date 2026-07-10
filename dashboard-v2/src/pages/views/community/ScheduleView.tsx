import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Clock, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface ScheduleEntry {
  id: number; guild_id: string; channel_id: string;
  content: string; scheduled_at: string; recurrence: string | null;
  created_by: string; created_at: string; last_sent_at?: string | null;
}

interface ScheduleData {
  schedules: ScheduleEntry[];
  channels: { id: string; name: string }[];
  guildId: string; hasGuild: boolean; guildName: string;
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Daily", weekly: "Weekly", monthly: "Monthly",
};

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function ScheduleView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showNew, setShowNew] = useState(false);
  const [newChannelId, setNewChannelId] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newRecurrence, setNewRecurrence] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery<ScheduleData>({
    queryKey: ["schedule", guildId],
    queryFn: () => get(guildPath("/api/schedule", guildId)),
    enabled: !!guildId,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/schedule", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule", guildId] });
      setShowNew(false);
      setNewChannelId("");
      setNewContent("");
      setNewScheduledAt("");
      setNewRecurrence("");
      toast.success("Scheduled message created");
    },
    onError: (e: any) => toast.error(e.message || "Create failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(guildPath(`/api/schedule/${id}`, guildId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule", guildId] });
      toast.success("Scheduled message deleted");
    },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading scheduled messages...</div>;

  const schedules = data.schedules || [];

  const handleCreate = () => {
    if (!newChannelId || !newContent || !newScheduledAt) {
      toast.error("Channel, content, and scheduled time are required");
      return;
    }
    createMutation.mutate({
      channelId: newChannelId,
      content: newContent,
      scheduledAt: newScheduledAt,
      recurrence: newRecurrence || null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Scheduled Messages</h1>
            <p className="text-xs text-muted-foreground">{schedules.length} message{schedules.length !== 1 ? "s" : ""} scheduled</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShowNew(!showNew)}>
            <Plus className="size-3.5 mr-1" /> {showNew ? "Cancel" : "New Schedule"}
          </Button>
        </div>
      </div>

      {showNew && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">New Scheduled Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Channel</label>
                <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={newChannelId} onChange={e => setNewChannelId(e.target.value)}>
                  <option value="">— Select channel —</option>
                  {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Scheduled At</label>
                <Input type="datetime-local" className="mt-1 text-xs font-mono" value={newScheduledAt} onChange={e => setNewScheduledAt(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Recurrence</label>
                <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={newRecurrence} onChange={e => setNewRecurrence(e.target.value)}>
                  <option value="">— One-time —</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Message Content</label>
              <textarea className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono h-24 resize-y" value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Enter the message to send..." />
            </div>
            <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Schedule"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-0">
          {schedules.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No scheduled messages yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs">Content</TableHead>
                  <TableHead className="text-xs">Scheduled At</TableHead>
                  <TableHead className="text-xs">Recurrence</TableHead>
                  <TableHead className="text-xs">Created By</TableHead>
                  <TableHead className="text-xs w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map(s => {
                  const channel = data.channels.find(c => c.id === s.channel_id);
                  return (
                    <TableRow key={s.id} className="border-b border-border/20">
                      <TableCell className="text-xs font-mono">#{channel?.name || s.channel_id}</TableCell>
                      <TableCell className="text-xs max-w-xs truncate" title={s.content}>{s.content}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(s.scheduled_at)}</TableCell>
                      <TableCell className="text-xs">
                        {s.recurrence ? <Badge variant="outline" className="text-[10px]">{RECURRENCE_LABELS[s.recurrence] || s.recurrence}</Badge> : <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.created_by}</TableCell>
                      <TableCell className="text-xs">
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                          if (!await confirm({
                            title: "Delete scheduled message?",
                            description: s.recurrence
                              ? `This ${s.recurrence} recurring message will be permanently removed.`
                              : "This scheduled message will be permanently removed.",
                            confirmLabel: "Delete",
                          })) return;
                          deleteMutation.mutate(s.id);
                        }}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
