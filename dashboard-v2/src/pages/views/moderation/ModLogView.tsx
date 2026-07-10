import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollText, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ModlogResponse {
  entries: Array<{
    id: number; guild_id: string; user_id: string; mod_id: string;
    action: string; reason: string; timestamp: number; details?: string;
  }>;
  prefix: string;
}

const ACTION_COLORS: Record<string, string> = {
  warn: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
  mute: "bg-orange-500/20 text-orange-500 border-orange-500/30",
  timeout: "bg-orange-500/20 text-orange-500 border-orange-500/30",
  kick: "bg-red-500/20 text-red-500 border-red-500/30",
  ban: "bg-red-700/20 text-red-700 border-red-700/30",
  unban: "bg-green-500/20 text-green-500 border-green-500/30",
  unmute: "bg-green-500/20 text-green-500 border-green-500/30",
};

const formatTs = (ts: number) => {
  const ms = typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
};

export default function ModLogView() {
  const { guildId } = useGuild();
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery<ModlogResponse>({
    queryKey: ["modlog", guildId, limit],
    queryFn: () => get(guildPath("/api/modlog", guildId) + `&limit=${limit}`),
    enabled: !!guildId,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading mod log...</div>;

  const filtered = data.entries.filter(e =>
    !search ||
    e.user_id.includes(search) ||
    e.mod_id.includes(search) ||
    e.reason.toLowerCase().includes(search.toLowerCase()) ||
    e.action.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Moderation Log</h1>
            <p className="text-xs text-muted-foreground">All moderation actions taken in this server</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { refetch(); toast.success("Refreshed"); }} disabled={isFetching}>
            <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Filter</CardTitle>
          <CardDescription className="text-xs">{data.entries.length} total entries, showing {filtered.length}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px]">
            <Input placeholder="Search by user ID, mod ID, reason, or action…" value={search} onChange={e => setSearch(e.target.value)} className="text-xs font-mono" />
          </div>
          <div>
            <select className="bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={limit} onChange={e => setLimit(parseInt(e.target.value))}>
              <option value={50}>Last 50</option>
              <option value={100}>Last 100</option>
              <option value={250}>Last 250</option>
              <option value={500}>Last 500</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? "No entries match your search." : "No moderation actions logged yet."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">When</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">User</TableHead>
                  <TableHead className="text-xs">Moderator</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(entry => (
                  <TableRow key={entry.id} className="border-b border-border/20">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTs(entry.timestamp)}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className={ACTION_COLORS[entry.action?.toLowerCase()] || "bg-muted text-foreground"}>{entry.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{entry.user_id}</TableCell>
                    <TableCell className="text-xs font-mono">{entry.mod_id}</TableCell>
                    <TableCell className="text-xs max-w-md truncate" title={entry.reason}>{entry.reason || <span className="text-muted-foreground/40">—</span>}</TableCell>
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
