import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Blocks, RefreshCw, Trash2, Play, Eye } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

export default function ModulesView() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const { data, isLoading } = useQuery<{ modules: { name: string; loaded: boolean }[] }>({
    queryKey: ["modules"], queryFn: () => get("/api/modules"),
    refetchInterval: 15_000,
  });

  const { data: moduleCode } = useQuery<{ name: string; code: string; loaded: boolean }>({
    queryKey: ["modules", expanded],
    queryFn: () => get(`/api/modules/${expanded}`),
    enabled: !!expanded,
  });

  const reloadMutation = useMutation({
    mutationFn: (name: string) => post(`/api/modules/${name}/reload`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["modules"] }); toast.success("Module reloaded"); },
    onError: (e: any) => toast.error(e.message || "Reload failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => del(`/api/modules/${name}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["modules"] }); if (expanded) setExpanded(null); toast.success("Module deleted"); },
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; code: string }) => post("/api/modules", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["modules"] }); setCode(""); toast.success("Module created"); },
    onError: (e: any) => toast.error(e.message || "Create failed"),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading modules...</div>;

  const modules = data?.modules || [];

  return (
    <div className="space-y-4">
      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Custom Modules ({modules.length})</CardTitle><CardDescription className="text-xs">Hot-reloadable command modules</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {modules.length === 0 && <p className="text-sm text-muted-foreground font-mono">No modules created yet. Use <code className="text-primary">$modules create name</code> in Discord.</p>}
          {modules.map(m => (
            <div key={m.name} className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-card/30">
              <div className="flex items-center gap-3">
                <Blocks className="size-4 text-primary" />
                <div>
                  <span className="text-sm font-semibold font-mono">{m.name}</span>
                  <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${m.loaded ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                    {m.loaded ? "loaded" : "unloaded"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setExpanded(expanded === m.name ? null : m.name)}>
                  <Eye className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" onClick={() => reloadMutation.mutate(m.name)}>
                  <RefreshCw className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={async () => {
                  if (!await confirm({
                    title: `Delete module "${m.name}"?`,
                    description: "This permanently removes the module's code and unregisters it. Any commands it provided will stop working. Cannot be undone.",
                    confirmLabel: "Delete",
                  })) return;
                  deleteMutation.mutate(m.name);
                }}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {expanded && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold font-mono">{expanded}</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs font-mono text-foreground/80 bg-background-alt/50 p-4 rounded-lg overflow-x-auto max-h-96">{moduleCode?.code || "Loading..."}</pre>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Create Module</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="w-full h-32 bg-background-alt/50 border border-border/40 rounded-lg p-3 text-xs font-mono text-foreground/80 resize-none"
            placeholder="module.exports = { name: 'ping', prefix: (msg, args, ctx) => msg.reply('Pong!') }"
            value={code} onChange={e => setCode(e.target.value)}
          />
          <Button size="sm" onClick={() => {
            const nameMatch = code.match(/name:\s*['"]([^'"]+)['"]/);
            if (!nameMatch) { toast.error("Could not parse module name"); return; }
            createMutation.mutate({ name: nameMatch[1], code });
          }}>
            <Play className="size-3.5 mr-2" />Create & Load
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
