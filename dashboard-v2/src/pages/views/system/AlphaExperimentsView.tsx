import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { FlaskConical, Plus, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface AlphaCode { code: string; created_by: string; created_at: number; used_by?: string | null; used_at?: number | null; }
interface AlphaUser { user_id: string; guild_id: string; activated_at: number; code_used?: string | null; telemetry_opt_out: number; }
interface TelemetryEntry { id: number; user_id: string; guild_id: string; tool_name: string; success: number; error_msg?: string | null; duration_ms: number; timestamp: number; }

function fmtDate(ts?: number | null) {
  if (!ts) return "—";
  return new Date(Number(ts)).toLocaleString();
}

export default function AlphaExperimentsView() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data: codesData, isLoading: codesLoading } = useQuery<{ codes: AlphaCode[] }>({
    queryKey: ["alpha-codes"], queryFn: () => get("/api/alpha/codes"),
  });
  const { data: usersData } = useQuery<{ users: AlphaUser[] }>({
    queryKey: ["alpha-users"], queryFn: () => get("/api/alpha/users"),
  });
  const { data: telemetryData } = useQuery<{ entries: TelemetryEntry[] }>({
    queryKey: ["alpha-telemetry"], queryFn: () => get("/api/alpha/telemetry?limit=50"),
  });

  const generateMutation = useMutation({
    mutationFn: () => post("/api/alpha/generate", {}),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["alpha-codes"] });
      toast.success(`Code generated: ${r.code}`);
    },
    onError: (e: any) => toast.error(e.message || "Generation failed (owner only)"),
  });

  const toggleMutation = useMutation({
    mutationFn: (u: AlphaUser) => post(`/api/alpha/users/${u.user_id}/toggle-telemetry`, { guildId: u.guild_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alpha-users"] });
      toast.success("Telemetry preference updated");
    },
    onError: (e: any) => toast.error(e.message || "Update failed (owner only)"),
  });

  const purgeMutation = useMutation({
    mutationFn: () => del("/api/alpha/telemetry"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alpha-telemetry"] });
      toast.success("Telemetry purged");
    },
    onError: (e: any) => toast.error(e.message || "Purge failed (owner only)"),
  });

  const codes = codesData?.codes || [];
  const unusedCodes = codes.filter(c => !c.used_by);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <FlaskConical className="size-5 text-primary" /> Alpha Experiments
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Generate activation codes for experimental AI server-management tools, and review usage telemetry. Owner-only actions.</p>
      </div>

      {/* Activation codes */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Activation Codes</CardTitle>
            <CardDescription className="text-xs">{unusedCodes.length} unused · {codes.length} total</CardDescription>
          </div>
          <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            <Plus className="size-3.5 mr-1" /> Generate Code
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {codesLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading codes...</div>
          ) : !codes.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No codes yet. Generate one to invite an alpha tester.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map(c => (
                  <TableRow key={c.code} className="border-b border-border/20">
                    <TableCell className="text-xs font-mono">{c.code}</TableCell>
                    <TableCell className="text-xs">
                      {c.used_by
                        ? <Badge variant="outline" className="text-[10px]">used by {c.used_by}</Badge>
                        : <Badge className="text-[10px] bg-success/20 text-success border-success/30">available</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(c.created_at)}</TableCell>
                    <TableCell className="text-xs">
                      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(c.code); toast.success("Code copied"); }}>
                        <Copy className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Activated users */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Activated Users</CardTitle>
          <CardDescription className="text-xs">Members with experimental tools enabled</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!usersData?.users?.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No activated users yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">User ID</TableHead>
                  <TableHead className="text-xs">Guild</TableHead>
                  <TableHead className="text-xs">Activated</TableHead>
                  <TableHead className="text-xs">Telemetry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersData.users.map(u => (
                  <TableRow key={`${u.guild_id}:${u.user_id}`} className="border-b border-border/20">
                    <TableCell className="text-xs font-mono">{u.user_id}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{u.guild_id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(u.activated_at)}</TableCell>
                    <TableCell className="text-xs">
                      <Button size="sm" variant={u.telemetry_opt_out === 1 ? "outline" : "default"} className="text-[10px] h-6"
                        onClick={() => toggleMutation.mutate(u)}>
                        {u.telemetry_opt_out === 1 ? "🔴 Opted out" : "🟢 Enabled"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Telemetry */}
      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Tool Telemetry</CardTitle>
            <CardDescription className="text-xs">Recent experimental tool calls (latest 50)</CardDescription>
          </div>
          {!!telemetryData?.entries?.length && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
              if (!await confirm({ title: "Purge all telemetry?", description: "This permanently deletes every recorded tool-call entry.", confirmLabel: "Purge" })) return;
              purgeMutation.mutate();
            }}>
              <Trash2 className="size-3.5 mr-1" /> Purge
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!telemetryData?.entries?.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No telemetry recorded yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">Tool</TableHead>
                  <TableHead className="text-xs">Result</TableHead>
                  <TableHead className="text-xs">Duration</TableHead>
                  <TableHead className="text-xs">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {telemetryData.entries.map(e => (
                  <TableRow key={e.id} className="border-b border-border/20">
                    <TableCell className="text-xs font-mono">{e.tool_name}</TableCell>
                    <TableCell className="text-xs">
                      {e.success === 1
                        ? <span className="text-success">✓ ok</span>
                        : <span className="text-destructive" title={e.error_msg || ""}>✕ error</span>}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{e.duration_ms}ms</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(e.timestamp)}</TableCell>
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
