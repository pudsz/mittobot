import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { HardDrive, Plus, Trash2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface BackupRow {
  id: number; guild_id: string; name: string;
  created_by: string; created_at: string;
  role_count?: number; channel_count?: number;
}

interface BackupDetail {
  id: number; guild_id: string; name: string;
  created_by: string; created_at: string;
  data: any;
}

interface BackupsData {
  backups: BackupRow[];
}

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function BackupsView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [backupName, setBackupName] = useState("");
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<BackupsData>({
    queryKey: ["backups", guildId],
    queryFn: () => get(guildPath("/api/backup", guildId)),
    enabled: !!guildId,
  });

  const detail = useQuery<{ backup: BackupDetail }>({
    queryKey: ["backup-detail", viewingId],
    queryFn: () => get(guildPath(`/api/backup/${viewingId}`, guildId)),
    enabled: !!viewingId,
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/backup", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups", guildId] });
      setBackupName("");
      toast.success("Backup created");
    },
    onError: (e: any) => toast.error(e.message || "Create failed"),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => post(guildPath(`/api/backup/${id}/restore`, guildId), {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["backups", guildId] });
      toast.success(`Restore complete — ${data.summary?.roles_created || 0} roles, ${data.summary?.channels_created || 0} channels`);
    },
    onError: (e: any) => toast.error(e.message || "Restore failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(guildPath(`/api/backup/${id}`, guildId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups", guildId] });
      setViewingId(null);
      toast.success("Backup deleted");
    },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading backups...</div>;

  const backups = data.backups || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Server Backups</h1>
            <p className="text-xs text-muted-foreground">{backups.length} backup{backups.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => createMutation.mutate({ name: backupName || undefined })} disabled={createMutation.isPending}>
            <Plus className="size-3.5 mr-1" /> {createMutation.isPending ? "Creating…" : "Create Backup"}
          </Button>
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-0">
          {backups.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No backups yet. Create one to save a snapshot of your server config.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs">By</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map(b => (
                  <TableRow key={b.id} className="border-b border-border/20">
                    <TableCell className="text-xs font-semibold">{b.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(b.created_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{b.created_by}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setViewingId(viewingId === b.id ? null : b.id)}>
                          {viewingId === b.id ? "Hide" : "View"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          if (!await confirm({
                            title: `Restore backup "${b.name}"?`,
                            description: "This recreates roles and channels from the snapshot into the live server. Existing matching roles may be reused. This mutates the live Discord server.",
                            confirmLabel: "Restore",
                          })) return;
                          restoreMutation.mutate(b.id);
                        }} disabled={restoreMutation.isPending}>
                          <Undo2 className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                          if (!await confirm({
                            title: `Delete backup "${b.name}"?`,
                            description: "This server-config snapshot will be permanently removed and can no longer be restored.",
                            confirmLabel: "Delete",
                          })) return;
                          deleteMutation.mutate(b.id);
                        }}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {viewingId && detail.data?.backup && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{detail.data.backup.name} — Full Data</CardTitle>
            <CardDescription className="text-xs">Created by {detail.data.backup.created_by} at {formatDate(detail.data.backup.created_at)}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-background-alt/30 p-3 rounded text-[10px] font-mono overflow-auto max-h-96 whitespace-pre-wrap">
              {JSON.stringify(detail.data.backup.data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
