import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface Tag { id: number; name: string; content: string; created_by?: string; uses: number; }
interface TagsData { guildId: string; hasGuild: boolean; tags: Tag[]; }

export default function TagsView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery<TagsData>({
    queryKey: ["tags", guildId],
    queryFn: () => get(guildPath("/api/tags", guildId)),
    enabled: !!guildId,
  });

  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const createMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/tags", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags", guildId] });
      setName(""); setContent("");
      toast.success("Tag saved");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (tagName: string) => del(guildPath(`/api/tags/${encodeURIComponent(tagName)}`, guildId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags", guildId] });
      toast.success("Tag deleted");
    },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;

  const nameValid = /^[a-z0-9_-]{1,32}$/.test(name.toLowerCase());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <Bookmark className="size-5 text-primary" /> Custom Tags
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Reusable snippets invoked in chat with <code className="text-xs">$tag &lt;name&gt;</code> or <code className="text-xs">/tag show</code>. Placeholders: {"{user}"} {"{server}"} {"{count}"}.</p>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Create / Edit Tag</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Name (a-z, 0-9, -, _)</label>
              <Input className="mt-1 text-xs font-mono" value={name} onChange={e => setName(e.target.value.toLowerCase().slice(0, 32))} placeholder="rules" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-muted-foreground">Content ({content.length}/2000)</label>
              <Textarea className="mt-1 text-xs font-mono h-16 resize-y" value={content} onChange={e => setContent(e.target.value.slice(0, 2000))} placeholder="Read the rules in #welcome, {user}!" />
            </div>
          </div>
          <Button size="sm" disabled={!nameValid || !content || createMutation.isPending} onClick={() => createMutation.mutate({ name: name.toLowerCase(), content })}>
            <Plus className="size-3.5 mr-1" /> Save Tag
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading tags...</div>
          ) : !data?.tags?.length ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No tags yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Content</TableHead>
                  <TableHead className="text-xs w-16">Uses</TableHead>
                  <TableHead className="text-xs w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tags.map(t => (
                  <TableRow key={t.id} className="border-b border-border/20">
                    <TableCell className="text-xs font-semibold font-mono">{t.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">{t.content}</TableCell>
                    <TableCell className="text-xs font-mono">{t.uses}</TableCell>
                    <TableCell className="text-xs">
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                        if (!await confirm({ title: `Delete tag "${t.name}"?`, description: "This permanently removes the tag.", confirmLabel: "Delete" })) return;
                        deleteMutation.mutate(t.name);
                      }}>
                        <Trash2 className="size-3.5" />
                      </Button>
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
