import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StickyNote, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Note { id: number; guild_id: string; user_id: string; content: string; by: string; timestamp: number; }

export default function UserNotesView() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [newNote, setNewNote] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery<{ notes: Note[] }>({
    queryKey: ["modnotes", userId],
    queryFn: () => get(`/api/modnotes/${userId}`),
    enabled: !!userId,
  });

  const addMutation = useMutation({
    mutationFn: (body: { content: string }) => post(`/api/modnotes/${userId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modnotes", userId] });
      setNewNote("");
      toast.success("Note added");
    },
    onError: (e: any) => toast.error(e.message || "Failed to add note"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(`/api/modnotes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modnotes", userId] });
      toast.success("Note deleted");
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete note"),
  });

  const handleAdd = () => {
    const content = newNote.trim();
    if (!content) return;
    addMutation.mutate({ content: content.slice(0, 500) });
  };

  const notes = data?.notes || [];
  const formatTs = (ts: number) => new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts).toLocaleString();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StickyNote className="size-5 text-primary" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">User Moderator Notes</h1>
          <p className="text-xs text-muted-foreground">Private notes that moderators attach to users</p>
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Lookup</CardTitle>
          <CardDescription className="text-xs">Enter a Discord user ID to fetch notes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input placeholder="User ID (e.g. 231721808868331520)" value={userId} onChange={e => setUserId(e.target.value.trim())} className="font-mono text-xs" />
            <Button onClick={() => refetch()} disabled={!userId || isFetching}>
              {isFetching ? "Loading…" : "Load Notes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {userId && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Add Note</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input placeholder="What should other moderators know about this user?" value={newNote} onChange={e => setNewNote(e.target.value)} className="text-xs" />
              <Button onClick={handleAdd} disabled={!newNote.trim() || addMutation.isPending}>
                <Plus className="size-3.5 mr-1" /> Add
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {userId && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span>Notes ({notes.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-xs text-muted-foreground py-4">Loading…</div>
            ) : notes.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">No notes for this user yet.</div>
            ) : (
              <div className="space-y-2">
                {notes.map(note => (
                  <div key={note.id} className="rounded-lg border border-border/40 bg-background-alt/30 p-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-2 mb-1">
                        <span>by {note.by}</span>
                        <span>·</span>
                        <span>{formatTs(note.timestamp)}</span>
                      </div>
                      <p className="text-xs whitespace-pre-wrap">{note.content}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="text-destructive shrink-0" onClick={() => deleteMutation.mutate(note.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
