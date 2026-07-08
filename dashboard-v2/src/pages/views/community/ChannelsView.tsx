import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { FolderSync, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const TYPE_LABEL: Record<number, string> = {
  0: "Text", 2: "Voice", 4: "Category", 5: "News", 13: "Stage", 14: "Directory", 15: "Forum",
};

export default function ChannelsView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["channels", guildId],
    queryFn: () => get(guildPath("/api/channels", guildId)),
    enabled: !!guildId,
  });

  const syncMutation = useMutation({
    mutationFn: () => post(guildPath("/api/channels/sync", guildId), {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", guildId] });
      toast.success("Channel sync complete");
    },
    onError: (e: any) => toast.error(e.message || "Sync failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading channels...</div>;

  const channels = data.channels || [];
  const categories = channels.filter((c: any) => c.type === 4);
  const grouped: Record<string, any[]> = {};
  channels.filter((c: any) => c.type !== 4).forEach((c: any) => {
    const parent = c.parentId || "NO_CATEGORY";
    if (!grouped[parent]) grouped[parent] = [];
    grouped[parent].push(c);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderSync className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Channels</h1>
            <p className="text-xs text-muted-foreground">{channels.length} channels in this server</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? "Syncing…" : "Sync Now"}
          </Button>
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Categories ({categories.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <div className="text-xs text-muted-foreground">No categories.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">ID</TableHead>
                  <TableHead className="text-xs">Children</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c: any) => (
                  <TableRow key={c.id} className="border-b border-border/20">
                    <TableCell className="text-xs font-semibold">📁 {c.name}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{c.id}</TableCell>
                    <TableCell className="text-xs">{(grouped[c.id] || []).length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">All Channels ({channels.length})</CardTitle>
          <CardDescription className="text-xs">Sorted by position</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/30">
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((c: any) => (
                <TableRow key={c.id} className="border-b border-border/20">
                  <TableCell className="text-xs"># {c.name}</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{TYPE_LABEL[c.type] || `type:${c.type}`}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.parentId ? (categories.find((cat: any) => cat.id === c.parentId)?.name || c.parentId) : "—"}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{c.id}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
