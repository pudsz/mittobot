import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, RefreshCw, Download, X } from "lucide-react";
import { toast } from "sonner";

interface CaseEntry {
  id: number; guild_id: string; user_id: string; mod_id: string;
  action: string; reason: string; timestamp: number; details?: string; proof?: string;
}

interface CasesResponse {
  entries: CaseEntry[];
  prefix: string;
}

// Same palette as ModLogView so cases read consistently across the moderation hub.
const ACTION_COLORS: Record<string, string> = {
  warn: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
  mute: "bg-orange-500/20 text-orange-500 border-orange-500/30",
  timeout: "bg-orange-500/20 text-orange-500 border-orange-500/30",
  kick: "bg-red-500/20 text-red-500 border-red-500/30",
  ban: "bg-red-700/20 text-red-700 border-red-700/30",
  softban: "bg-red-700/20 text-red-700 border-red-700/30",
  tempban: "bg-red-700/20 text-red-700 border-red-700/30",
  unban: "bg-green-500/20 text-green-500 border-green-500/30",
  unmute: "bg-green-500/20 text-green-500 border-green-500/30",
};

const ACTION_OPTIONS = ["warn", "mute", "timeout", "kick", "ban", "softban", "tempban", "unban", "unmute"];

const formatTs = (ts: number) => {
  const ms = typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
};

// Parse a yyyy-mm-dd date input into a ms timestamp; `end` snaps to end-of-day.
const dateToMs = (value: string, end = false) => {
  if (!value) return undefined;
  const ms = new Date(value + (end ? "T23:59:59.999" : "T00:00:00")).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function CasesView() {
  const { guildId } = useGuild();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [modId, setModId] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(200);
  const [selected, setSelected] = useState<CaseEntry | null>(null);

  // Build the /api/cases query string from the active filters. Server does the
  // heavy filtering; the search box is also applied client-side for instant feedback.
  const queryUrl = useMemo(() => {
    let url = guildPath("/api/cases", guildId);
    const params: string[] = [];
    if (action) params.push(`action=${encodeURIComponent(action)}`);
    if (modId.trim()) params.push(`modId=${encodeURIComponent(modId.trim())}`);
    if (userId.trim()) params.push(`userId=${encodeURIComponent(userId.trim())}`);
    if (search.trim()) params.push(`search=${encodeURIComponent(search.trim())}`);
    const fromMs = dateToMs(from);
    const toMs = dateToMs(to, true);
    if (fromMs) params.push(`from=${fromMs}`);
    if (toMs) params.push(`to=${toMs}`);
    params.push(`limit=${limit}`);
    if (params.length) url += (url.includes("?") ? "&" : "?") + params.join("&");
    return url;
  }, [guildId, action, modId, userId, search, from, to, limit]);

  const { data, isLoading, refetch, isFetching } = useQuery<CasesResponse>({
    queryKey: ["cases", queryUrl],
    queryFn: () => get(queryUrl),
    enabled: !!guildId,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;

  const entries = data?.entries ?? [];

  const exportCsv = () => {
    if (!entries.length) { toast.error("Nothing to export"); return; }
    const header = ["id", "action", "user_id", "mod_id", "reason", "details", "timestamp", "when"];
    const rows = entries.map(e => [
      e.id, e.action, e.user_id, e.mod_id, e.reason, e.details || "", e.timestamp, formatTs(e.timestamp),
    ].map(csvCell).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cases-${guildId}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(`Exported ${entries.length} cases`);
  };

  const clearFilters = () => {
    setSearch(""); setAction(""); setModId(""); setUserId(""); setFrom(""); setTo("");
  };

  const hasFilters = !!(search || action || modId || userId || from || to);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderOpen className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Moderation Cases</h1>
            <p className="text-xs text-muted-foreground">Search and review every moderation action taken in this server</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!entries.length}>
            <Download className="size-3.5 mr-1" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => { refetch(); toast.success("Refreshed"); }} disabled={isFetching}>
            <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Filters</CardTitle>
            <CardDescription className="text-xs">{entries.length} cases match</CardDescription>
          </div>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              <X className="size-3.5 mr-1" /> Clear
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-3">
            <Input placeholder="Search reason or user…" value={search} onChange={e => setSearch(e.target.value)} className="text-xs font-mono" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Action</label>
            <select className="w-full bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono mt-1" value={action} onChange={e => setAction(e.target.value)}>
              <option value="">All actions</option>
              {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Moderator ID</label>
            <Input placeholder="mod user id" value={modId} onChange={e => setModId(e.target.value)} className="text-xs font-mono mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Target User ID</label>
            <Input placeholder="target user id" value={userId} onChange={e => setUserId(e.target.value)} className="text-xs font-mono mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-xs font-mono mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-xs font-mono mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Limit</label>
            <select className="w-full bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono mt-1" value={limit} onChange={e => setLimit(parseInt(e.target.value))}>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className={`border-border/40 bg-card/40 ${selected ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading cases…</div>
            ) : entries.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {hasFilters ? "No cases match your filters." : "No moderation actions logged yet."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/30">
                    <TableHead className="text-xs">Case</TableHead>
                    <TableHead className="text-xs">When</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">User</TableHead>
                    <TableHead className="text-xs">Moderator</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(entry => (
                    <TableRow
                      key={entry.id}
                      onClick={() => setSelected(entry)}
                      className={`border-b border-border/20 cursor-pointer hover:bg-muted/30 ${selected?.id === entry.id ? "bg-muted/40" : ""}`}
                    >
                      <TableCell className="text-xs font-mono text-muted-foreground">#{entry.id}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatTs(entry.timestamp)}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className={ACTION_COLORS[entry.action?.toLowerCase()] || "bg-muted text-foreground"}>{entry.action}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{entry.user_id}</TableCell>
                      <TableCell className="text-xs font-mono">{entry.mod_id}</TableCell>
                      <TableCell className="text-xs max-w-xs truncate" title={entry.reason}>{entry.reason || <span className="text-muted-foreground/40">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {selected && (
          <Card className="border-border/40 bg-card/40 lg:col-span-1 h-fit">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Case #{selected.id}</CardTitle>
                <CardDescription className="text-xs">{formatTs(selected.timestamp)}</CardDescription>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setSelected(null)}>
                <X className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Action</div>
                <Badge variant="outline" className={ACTION_COLORS[selected.action?.toLowerCase()] || "bg-muted text-foreground"}>{selected.action}</Badge>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Target User</div>
                <div className="font-mono">{selected.user_id || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Moderator</div>
                <div className="font-mono">{selected.mod_id || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Reason</div>
                <div className="whitespace-pre-wrap break-words">{selected.reason || <span className="text-muted-foreground/40">No reason recorded</span>}</div>
              </div>
              {selected.details && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Details</div>
                  <div className="whitespace-pre-wrap break-words">{selected.details}</div>
                </div>
              )}
              {selected.proof && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Proof</div>
                  <div className="whitespace-pre-wrap break-words font-mono">{selected.proof}</div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
