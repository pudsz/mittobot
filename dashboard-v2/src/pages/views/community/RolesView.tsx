import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface RolesData {
  guildId: string; hasGuild: boolean; guildName: string;
  prefix: string;
  roles: { id: string; name: string; color?: number; position?: number }[];
  autoroles: string[];
  reactionRoles: Record<string, Record<string, string>>;
}

export default function RolesView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const [newAutorole, setNewAutorole] = useState("");
  const [autorolesDirty, setAutorolesDirty] = useState<string[] | null>(null);

  const { data, isLoading } = useQuery<RolesData>({
    queryKey: ["roles", guildId],
    queryFn: () => get(guildPath("/api/roles", guildId)),
    enabled: !!guildId,
  });

  useEffect(() => {
    if (data?.autoroles) setAutorolesDirty(null);
  }, [data]);

  const saveAutoroles = useMutation({
    mutationFn: (body: { roleIds: string[] }) => post(guildPath("/api/roles/autoroles", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", guildId] });
      setAutorolesDirty(null);
      toast.success("Autoroles updated");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const removeRR = useMutation({
    mutationFn: (body: { messageId: string }) => post(guildPath("/api/roles/reaction/remove", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles", guildId] });
      toast.success("Reaction role mapping removed");
    },
    onError: (e: any) => toast.error(e.message || "Remove failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading roles...</div>;

  const currentAutoroles = autorolesDirty ?? data.autoroles ?? [];
  const dirty = (autorolesDirty !== null) && JSON.stringify(autorolesDirty) !== JSON.stringify(data.autoroles ?? []);

  const handleAddAutorole = () => {
    if (!newAutorole) return;
    if (currentAutoroles.includes(newAutorole)) {
      toast.error("Already in autoroles");
      return;
    }
    setAutorolesDirty([...currentAutoroles, newAutorole]);
    setNewAutorole("");
  };

  const handleRemoveAutorole = (id: string) => {
    setAutorolesDirty(currentAutoroles.filter(r => r !== id));
  };

  const rrEntries = Object.entries(data.reactionRoles || {});

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <UserCheck className="size-5 text-primary" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Roles Configuration</h1>
          <p className="text-xs text-muted-foreground">Autoroles for new members and reaction-role bindings</p>
        </div>
        {dirty && (
          <Button size="sm" className="ml-auto" disabled={saveAutoroles.isPending} onClick={() => saveAutoroles.mutate({ roleIds: currentAutoroles })}>
            {saveAutoroles.isPending ? "Saving…" : "Save Autoroles"}
          </Button>
        )}
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Autoroles</CardTitle>
          <CardDescription className="text-xs">Roles automatically granted to new members on join</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <select className="flex-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={newAutorole} onChange={e => setNewAutorole(e.target.value)}>
              <option value="">— Select role —</option>
              {data.roles.filter(r => !currentAutoroles.includes(r.id)).map(r => <option key={r.id} value={r.id}>@{r.name}</option>)}
            </select>
            <Button size="sm" disabled={!newAutorole} onClick={handleAddAutorole}>
              <Plus className="size-3.5 mr-1" /> Add
            </Button>
          </div>
          {currentAutoroles.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No autoroles configured.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {currentAutoroles.map(rid => {
                const role = data.roles.find(r => r.id === rid);
                return (
                  <Badge key={rid} variant="outline" className="flex items-center gap-1 px-2 py-1">
                    <span className="text-xs">@{role?.name || rid}</span>
                    <button className="text-destructive ml-1" onClick={() => handleRemoveAutorole(rid)}>×</button>
                  </Badge>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Reaction Roles</CardTitle>
          <CardDescription className="text-xs">Message-based: emoji → role bindings</CardDescription>
        </CardHeader>
        <CardContent>
          {rrEntries.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No reaction-role mappings configured.</div>
          ) : (
            <div className="space-y-3">
              {rrEntries.map(([msgId, emojis]) => (
                <div key={msgId} className="rounded-lg border border-border/40 bg-background-alt/30 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono">msg:{msgId}</span>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeRR.mutate({ messageId: msgId })}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(emojis).map(([emoji, rid]) => (
                      <Badge key={emoji} variant="outline" className="text-xs">
                        {emoji} → @{data.roles.find(r => r.id === rid)?.name || rid}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/60 mt-3">
            Use the <code className="font-mono">{data.prefix}reactionrole</code> command in Discord to create new mappings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
