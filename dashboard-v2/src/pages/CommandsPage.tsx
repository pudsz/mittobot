import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useGuild } from "@/hooks/useGuild";
import { guildPath } from "@/lib/api";

interface CommandDef {
  name: string; description: string; category: string | null;
  aliases: string[];
  config: { enabled: boolean; permission: string; cooldown: number; allowedChannels: string[]; blockedChannels: string[]; allowedRoles: string[]; settings?: Record<string, any> };
}

export default function CommandsPage() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [edits, setEdits] = useState<Record<string, { enabled?: boolean; permission?: string; cooldown?: number }>>({});

  const { data, isLoading } = useQuery<{ guildId: string; commands: CommandDef[]; prefix: string; permLabels: Record<string, string>; channels: { id: string; name: string }[]; roles: { id: string; name: string }[] }>({
    queryKey: ["commands", guildId],
    queryFn: () => get(guildPath("/api/commands", guildId)),
    enabled: !!guildId,
  });

  const saveMutation = useMutation({
    mutationFn: ({ name, body }: { name: string; body: any }) => post(`/api/commands/${name}`, { ...body, guildId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commands", guildId] }); toast.success("Command config saved"); },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const resetMutation = useMutation({
    mutationFn: (name: string) => post(`/api/commands/${name}`, { guildId, reset: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commands", guildId] }); toast.success("Command reset to defaults"); },
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading commands...</div>;

  const prefix = data.prefix || "$";
  const permLabels = data.permLabels || {};
  const categories = [...new Set(data.commands.map(c => c.category || "uncategorized").filter(Boolean))];

  const filtered = data.commands.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (catFilter !== "all" && (c.category || "uncategorized") !== catFilter) return false;
    return true;
  });

  const handleToggle = (name: string, field: string, value: any) => {
    setEdits(prev => ({ ...prev, [name]: { ...prev[name], [field]: value } }));
  };

  const handleSave = (name: string) => {
    const edit = edits[name];
    if (!edit) return;
    saveMutation.mutate({ name, body: edit });
    setEdits(prev => { const next = { ...prev }; delete next[name]; return next; });
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Commands & Config" description="Manage prefix/slash permissions, command aliases, channel limits" />

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search commands..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="bg-background-alt/50 border border-border/40 rounded-lg px-3 py-2 text-xs font-mono" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-muted-foreground font-mono">{filtered.length} commands</span>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Command Permission Manager</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/20 max-h-[600px] overflow-y-auto">
            {filtered.map(cmd => {
              const edit = edits[cmd.name] || {};
              const enabled = edit.enabled !== undefined ? edit.enabled : cmd.config.enabled;
              const permission = edit.permission || cmd.config.permission;
              const cooldown = edit.cooldown ?? cmd.config.cooldown;
              const isChanged = edits[cmd.name] !== undefined;

              return (
                <div key={cmd.name} className={`px-5 py-3 hover:bg-card/20 transition-colors ${isChanged ? "bg-primary/5" : ""}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold font-mono">{prefix}{cmd.name}</span>
                        {cmd.category && <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">{cmd.category}</Badge>}
                        {cmd.aliases.length > 0 && <span className="text-[10px] text-muted-foreground font-mono">({cmd.aliases.join(", ")})</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{cmd.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button className={`px-2.5 py-1 rounded text-[10px] font-bold ${enabled === false ? "bg-destructive/20 text-destructive border border-destructive/30" : "bg-success/20 text-success border border-success/30"}`}
                        onClick={() => handleToggle(cmd.name, "enabled", enabled === false ? true : false)}>
                        {enabled === false ? "OFF" : "ON"}
                      </button>
                      <select className="bg-background-alt/50 border border-border/40 rounded px-2 py-1 text-[10px] font-mono" value={permission} onChange={e => handleToggle(cmd.name, "permission", e.target.value)}>
                        {Object.entries(permLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <Input className="w-16 h-7 text-[10px] font-mono" type="number" min={0} max={86400} value={cooldown} onChange={e => handleToggle(cmd.name, "cooldown", parseInt(e.target.value) || 0)} placeholder="0s" />
                      <Button variant="ghost" size="icon" className="size-7" disabled={!isChanged} onClick={() => handleSave(cmd.name)}><Save className={`size-3 ${isChanged ? "text-primary" : "text-muted-foreground"}`} /></Button>
                      <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => resetMutation.mutate(cmd.name)}><RotateCcw className="size-3" /></Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
