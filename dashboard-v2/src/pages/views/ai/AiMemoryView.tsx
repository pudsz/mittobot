import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, del, post } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Brain, Trash2, RotateCcw, Plus } from "lucide-react";
import { toast } from "sonner";
import { useGuild } from "@/hooks/useGuild";
import { guildPath } from "@/lib/api";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface Memory { id: number; guild_id: string; userId: string | null; content: string; createdAt: number; displayName?: string | null; }

export default function AiMemoryView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [newContent, setNewContent] = useState("");
  const [newUserId, setNewUserId] = useState("");

  const { data, isLoading } = useQuery<{ memories: Memory[] }>({
    queryKey: ["ai", "memories", guildId],
    queryFn: () => get(guildPath("/api/ai/memories", guildId)),
    enabled: !!guildId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(`/api/ai/memories/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ai", "memories", guildId] }); toast.success("Memory deleted"); },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  const addMutation = useMutation({
    mutationFn: (body: { content: string; userId?: string }) => post(guildPath("/api/ai/memories", guildId), body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ai", "memories", guildId] }); setNewContent(""); toast.success("Memory added"); },
    onError: (e: any) => toast.error(e.message || "Add failed"),
  });

  const clearMutation = useMutation({
    mutationFn: () => post("/api/ai/memories/clear", { guildId, scope: "all" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ai", "memories", guildId] }); toast.success("Memory wiped"); },
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading memories...</div>;

  const memories = data?.memories || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={async () => {
          if (!await confirm({
            title: "Wipe all AI memories?",
            description: "This permanently deletes every server-wide and per-user memory for this guild. The bot will forget everything it has learned. Cannot be undone.",
            confirmLabel: "Wipe all memories",
          })) return;
          clearMutation.mutate();
        }} className="text-destructive border-destructive/30">
          <RotateCcw className="size-3.5 mr-2" />Wipe All
        </Button>
        <span className="text-xs text-muted-foreground font-mono">{memories.length} memories</span>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Add Memory</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input className="flex-1 text-xs font-mono" placeholder="User ID (leave empty for server-wide)" value={newUserId} onChange={e => setNewUserId(e.target.value)} />
          <Input className="flex-1 text-xs font-mono" placeholder="Memory content..." value={newContent} onChange={e => setNewContent(e.target.value)} onKeyDown={e => e.key === "Enter" && newContent.trim() && addMutation.mutate({ content: newContent, userId: newUserId || undefined })} />
          <Button size="sm" disabled={!newContent.trim()} onClick={() => addMutation.mutate({ content: newContent, userId: newUserId || undefined })}><Plus className="size-3.5" /></Button>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Memory Store</CardTitle></CardHeader>
        <CardContent className="space-y-2 max-h-96 overflow-y-auto">
          {memories.length === 0 ? <p className="text-sm text-muted-foreground font-mono">No memories stored.</p> : memories.map(m => (
            <div key={m.id} className="flex items-start justify-between p-3 rounded-lg border border-border/40 bg-card/30">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="size-3 text-primary shrink-0" />
                  <span className="text-xs font-semibold font-mono">{m.displayName || m.userId || "Server-wide"}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-xs font-mono text-foreground/80 truncate">{m.content}</p>
              </div>
              <Button variant="ghost" size="icon" className="size-7 shrink-0 text-destructive" onClick={async () => {
                if (!await confirm({
                  title: "Delete this memory?",
                  description: "This learned fact will be permanently removed.",
                  confirmLabel: "Delete",
                })) return;
                deleteMutation.mutate(m.id);
              }}><Trash2 className="size-3" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
