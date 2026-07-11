import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Gift, RefreshCw, Square, Dices } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface Giveaway {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  prize: string;
  winners_count: number;
  ends_at: number;
  host_id: string;
  ended: number;
  entry_count: number;
}

interface GiveawaysData {
  guildId: string; hasGuild: boolean;
  channels: { id: string; name: string }[];
  giveaways: Giveaway[];
}

function formatEndsAt(ms: number) {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleString();
}

export default function GiveawaysView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading, refetch, isFetching } = useQuery<GiveawaysData>({
    queryKey: ["giveaways", guildId],
    queryFn: () => get(guildPath("/api/giveaways", guildId)),
    enabled: !!guildId,
  });

  const endMutation = useMutation({
    mutationFn: (id: number) => post(guildPath(`/api/giveaways/${id}/end`, guildId), {}),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["giveaways", guildId] });
      const count = res?.winners?.length || 0;
      toast.success(count ? `Giveaway ended — ${count} winner${count === 1 ? "" : "s"} drawn` : "Giveaway ended — no valid entries");
    },
    onError: (e: any) => toast.error(e.message || "End failed"),
  });

  const rerollMutation = useMutation({
    mutationFn: (id: number) => post(guildPath(`/api/giveaways/${id}/reroll`, guildId), {}),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["giveaways", guildId] });
      const count = res?.winners?.length || 0;
      toast.success(count ? `Rerolled — ${count} new winner${count === 1 ? "" : "s"}` : "Reroll failed — no valid entries");
    },
    onError: (e: any) => toast.error(e.message || "Reroll failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading giveaways...</div>;

  const giveaways = data.giveaways || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gift className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Giveaways</h1>
            <p className="text-xs text-muted-foreground">{giveaways.length} active giveaway{giveaways.length !== 1 ? "s" : ""} • start one with <span className="font-mono">/giveaway start</span></p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-0">
          {giveaways.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No active giveaways. Start one in Discord with <span className="font-mono">/giveaway start</span>.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs w-12">ID</TableHead>
                  <TableHead className="text-xs">Prize</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs">Winners</TableHead>
                  <TableHead className="text-xs">Entries</TableHead>
                  <TableHead className="text-xs">Ends At</TableHead>
                  <TableHead className="text-xs w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {giveaways.map(g => {
                  const channel = data.channels.find(c => c.id === g.channel_id);
                  return (
                    <TableRow key={g.id} className="border-b border-border/20">
                      <TableCell className="text-xs font-mono text-muted-foreground">#{g.id}</TableCell>
                      <TableCell className="text-xs max-w-xs truncate" title={g.prize}>{g.prize}</TableCell>
                      <TableCell className="text-xs font-mono">#{channel?.name || g.channel_id}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px]">{g.winners_count}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{g.entry_count}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatEndsAt(g.ends_at)}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="text-warning" disabled={endMutation.isPending} onClick={async () => {
                            if (!await confirm({
                              title: "End giveaway now?",
                              description: `Winners will be drawn immediately for "${g.prize}".`,
                              confirmLabel: "End",
                            })) return;
                            endMutation.mutate(g.id);
                          }}>
                            <Square className="size-3.5 mr-1" /> End
                          </Button>
                          <Button size="sm" variant="ghost" disabled={rerollMutation.isPending} onClick={async () => {
                            if (!await confirm({
                              title: "Reroll winners?",
                              description: `Draw new winners for "${g.prize}". The giveaway must already be ended.`,
                              confirmLabel: "Reroll",
                            })) return;
                            rerollMutation.mutate(g.id);
                          }}>
                            <Dices className="size-3.5 mr-1" /> Reroll
                          </Button>
                        </div>
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
