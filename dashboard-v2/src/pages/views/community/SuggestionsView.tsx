import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { SaveBar } from "@/components/app/SaveBar";

interface SuggestionsConfig {
  enabled: boolean;
  channelId?: string | null;
  anonymous: boolean;
}
interface SuggestionRow {
  id: number;
  user_id: string;
  content: string;
  status: "pending" | "approved" | "rejected" | "implemented";
  upvotes: number;
  downvotes: number;
  staff_note?: string | null;
  created_at: number;
}
interface SuggestionsData {
  guildId: string;
  hasGuild: boolean;
  channels: { id: string; name: string }[];
  config: SuggestionsConfig;
  recent: SuggestionRow[];
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-primary/15 text-primary",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  implemented: "bg-accent/15 text-accent",
};
const DECISIONS: { label: string; status: string }[] = [
  { label: "Approve", status: "approved" },
  { label: "Reject", status: "rejected" },
  { label: "Implement", status: "implemented" },
];

export default function SuggestionsView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SuggestionsData>({
    queryKey: ["suggestions", guildId],
    queryFn: () => get(guildPath("/api/suggestions", guildId)),
    enabled: !!guildId,
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/suggestions", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suggestions", guildId] });
      toast.success("Suggestions configuration saved");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      post(guildPath(`/api/suggestions/${id}/status`, guildId), { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suggestions", guildId] });
      toast.success("Suggestion updated");
    },
    onError: (e: any) => toast.error(e.message || "Update failed"),
  });

  const cfg = data?.config;
  const [enabled, setEnabled] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [anonymous, setAnonymous] = useState(false);

  useEffect(() => {
    if (cfg) {
      setEnabled(cfg.enabled);
      setChannelId(cfg.channelId || "");
      setAnonymous(cfg.anonymous);
    }
  }, [data]);

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading suggestions config...</div>;

  const dirty =
    enabled !== cfg!.enabled ||
    channelId !== (cfg!.channelId || "") ||
    anonymous !== cfg!.anonymous;

  const handleSave = () => saveMutation.mutate({ enabled, channelId: channelId || null, anonymous });
  const handleReset = () => {
    if (cfg) {
      setEnabled(cfg.enabled);
      setChannelId(cfg.channelId || "");
      setAnonymous(cfg.anonymous);
      toast("Changes discarded");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <MessageCircle className="size-5 text-primary" /> Suggestions Board
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Let members submit suggestions with 👍/👎 voting and staff review.</p>
      </div>

      <SaveBar dirty={dirty} saving={saveMutation.isPending} onSave={handleSave} onReset={handleReset} />

      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Suggestions</CardTitle>
            <CardDescription className="text-xs">Members use <code>/suggest</code> to post to the board channel</CardDescription>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Board Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">— None —</option>
                {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-6 pt-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={anonymous} onCheckedChange={setAnonymous} /> Anonymous submissions
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Recent Suggestions</CardTitle></CardHeader>
        <CardContent>
          {!data.recent?.length ? (
            <p className="text-xs text-muted-foreground">No suggestions submitted yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Suggestion</TableHead>
                  <TableHead className="w-24">Votes</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-56 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.id}</TableCell>
                    <TableCell className="text-xs max-w-xs truncate">{s.content}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">👍 {s.upvotes} 👎 {s.downvotes}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLES[s.status] || ""} variant="secondary">{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {DECISIONS.map(d => (
                        <Button
                          key={d.status}
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={s.status === d.status || statusMutation.isPending}
                          onClick={() => statusMutation.mutate({ id: s.id, status: d.status })}
                        >
                          {d.label}
                        </Button>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
