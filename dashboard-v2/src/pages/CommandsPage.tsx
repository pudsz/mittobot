import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Search, Save, RotateCcw, Plus, X, Terminal, Clock, Shield } from "lucide-react";
import { toast } from "sonner";
import { useGuild } from "@/hooks/useGuild";
import { useAuth } from "@/hooks/useAuth";
import { guildPath } from "@/lib/api";

interface CommandConfig {
  enabled: boolean;
  permission: string;
  cooldown: number;
  allowedChannels: string[];
  blockedChannels: string[];
  allowedRoles: string[];
  settings?: Record<string, any>;
}
interface CommandDef {
  name: string;
  description: string;
  category: string | null;
  aliases: string[];
  config: CommandConfig;
}
interface CommandsData {
  guildId: string;
  commands: CommandDef[];
  prefix: string;
  permLabels: Record<string, string>;
  permLevels: string[];
  channels: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}

// Aliases: lowercase, 1-32 chars, [a-z0-9_-], max 10. Matches the backend's
// COMMAND_ALIAS_RE + slice(0,10) so we reject invalid input before sending.
const ALIAS_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_ALIASES = 10;

export default function CommandsPage() {
  const { guildId } = useGuild();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  // Per-command edit state: name → { enabled?, permission?, cooldown?, aliases? }
  const [edits, setEdits] = useState<Record<string, { enabled?: boolean; permission?: string; cooldown?: number; aliases?: string[] }>>({});
  // Per-card alias input draft
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<CommandsData>({
    queryKey: ["commands", guildId],
    queryFn: () => get(guildPath("/api/commands", guildId)),
    enabled: !!guildId,
  });

  const saveMutation = useMutation({
    mutationFn: ({ name, body }: { name: string; body: any }) => post(`/api/commands/${name}`, { ...body, guildId }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["commands", guildId] });
      setEdits(prev => { const next = { ...prev }; delete next[vars.name]; return next; });
      setAliasDraft(prev => { const next = { ...prev }; delete next[vars.name]; return next; });
      toast.success(`Saved ${vars.name}`);
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const resetMutation = useMutation({
    mutationFn: (name: string) => post(`/api/commands/${name}`, { guildId, reset: true }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commands", guildId] }); toast.success("Command reset to defaults"); },
    onError: (e: any) => toast.error(e.message || "Reset failed"),
  });

  // Prefix edit (owner-only, via /api/settings — 1-3 chars).
  const [prefixDraft, setPrefixDraft] = useState<string | null>(null);
  const prefixMutation = useMutation({
    mutationFn: (value: string) => post("/api/settings", { key: "prefix", value }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["commands", guildId] }); setPrefixDraft(null); toast.success("Prefix updated"); },
    onError: (e: any) => toast.error(e.message || "Prefix must be 1–3 characters"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading commands...</div>;

  const prefix = data.prefix || "$";
  const permLabels = data.permLabels || {};
  const categories = useMemo(() => {
    return [...new Set(data.commands.map(c => c.category || "uncategorized").filter(Boolean))];
  }, [data]);

  const filtered = data.commands.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.description.toLowerCase().includes(search.toLowerCase()) && !(c.aliases || []).some(a => a.includes(search.toLowerCase()))) return false;
    if (catFilter !== "all" && (c.category || "uncategorized") !== catFilter) return false;
    return true;
  });

  // ── Per-command helpers ──────────────────────────────────────────────────
  const getEdit = (name: string) => edits[name] || {};
  const isDirty = (name: string) => edits[name] !== undefined;
  const setField = (name: string, field: "enabled" | "permission" | "cooldown", value: any) =>
    setEdits(prev => ({ ...prev, [name]: { ...(prev[name] || {}), [field]: value } }));

  // Aliases: the effective list = edit draft (if dirty) else the command's stored aliases.
  const getAliases = (cmd: CommandDef) => getEdit(cmd.name).aliases ?? cmd.aliases ?? [];
  const setAliases = (name: string, aliases: string[]) =>
    setEdits(prev => ({ ...prev, [name]: { ...(prev[name] || {}), aliases } }));

  const addAlias = (cmd: CommandDef) => {
    const draft = (aliasDraft[cmd.name] || "").trim().toLowerCase();
    if (!draft) return;
    if (!ALIAS_RE.test(draft)) { toast.error("Alias may only use lowercase letters, numbers, _ and - (1–32 chars)"); return; }
    const current = getAliases(cmd);
    if (current.includes(draft)) { toast.error("That alias already exists"); return; }
    if (draft === cmd.name) { toast.error("Alias can't be the same as the command name"); return; }
    if (current.length >= MAX_ALIASES) { toast.error(`Max ${MAX_ALIASES} aliases`); return; }
    // Conflict check against other commands' names + aliases (client-side; backend re-checks).
    const conflicts = data.commands.some(c => c.name === draft || (c.aliases || []).includes(draft));
    if (conflicts) { toast.error(`"${draft}" is already a command or alias`); return; }
    setAliases(cmd.name, [...current, draft]);
    setAliasDraft(prev => { const next = { ...prev }; delete next[cmd.name]; return next; });
  };
  const removeAlias = (cmd: CommandDef, alias: string) =>
    setAliases(cmd.name, getAliases(cmd).filter(a => a !== alias));

  const handleSave = (cmd: CommandDef) => {
    const edit = getEdit(cmd.name);
    if (!edit) return;
    const body: any = {};
    if (edit.enabled !== undefined) body.enabled = edit.enabled;
    if (edit.permission !== undefined) body.permission = edit.permission;
    if (edit.cooldown !== undefined) body.cooldown = edit.cooldown;
    if (edit.aliases !== undefined) body.aliases = edit.aliases;
    saveMutation.mutate({ name: cmd.name, body });
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Commands & Config" description="Per-command permissions, aliases, cooldowns, and channel limits" />

      {/* ── Prefix banner (from settings) ── */}
      <Card className="border-border/40 bg-card/40">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Terminal className="size-5 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">Command prefix <span className="text-[10px]">(from bot settings)</span></div>
              <div className="text-lg font-bold font-mono">{prefix}</div>
            </div>
          </div>
          {user?.isOwner ? (
            <div className="flex items-center gap-2">
              {prefixDraft !== null ? (
                <>
                  <Input
                    className="w-20 font-mono text-sm"
                    value={prefixDraft}
                    maxLength={3}
                    onChange={e => setPrefixDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && prefixDraft.length >= 1 && prefixDraft.length <= 3) prefixMutation.mutate(prefixDraft);
                      if (e.key === "Escape") setPrefixDraft(null);
                    }}
                    placeholder={prefix}
                  />
                  <Button size="sm" disabled={prefixMutation.isPending || prefixDraft.length < 1} onClick={() => prefixMutation.mutate(prefixDraft)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPrefixDraft(null)}>Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setPrefixDraft(prefix)}>Edit prefix</Button>
              )}
            </div>
          ) : (
            <Badge variant="outline" className="text-[10px]">owner-only edit</Badge>
          )}
        </CardContent>
      </Card>

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search commands or aliases..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="bg-background-alt/50 border border-border/40 rounded-lg px-3 py-2 text-xs font-mono" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-muted-foreground font-mono">{filtered.length} commands</span>
      </div>

      {/* ── Command cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(cmd => {
          const edit = getEdit(cmd.name);
          const dirty = isDirty(cmd.name);
          const enabled = edit.enabled !== undefined ? edit.enabled : cmd.config.enabled;
          const permission = edit.permission ?? cmd.config.permission;
          const cooldown = edit.cooldown ?? cmd.config.cooldown;
          const aliases = getAliases(cmd);
          const cat = cmd.category || "uncategorized";

          return (
            <Card key={cmd.name} className={`border-border/40 transition-colors ${!enabled ? "bg-card/20 opacity-70" : "bg-card/40"} ${dirty ? "ring-1 ring-primary/40" : ""}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 py-3 px-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold font-mono">{prefix}{cmd.name}</span>
                    {cmd.category && <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground">{cat}</Badge>}
                    {!enabled && <Badge className="text-[9px] bg-muted text-muted-foreground">off</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{cmd.description}</p>
                </div>
                <Switch checked={enabled} onCheckedChange={v => setField(cmd.name, "enabled", v)} />
              </CardHeader>

              <CardContent className="px-4 pb-3 space-y-3">
                {/* Aliases */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Aliases</span>
                    <span className="text-[9px] text-muted-foreground/60">{aliases.length}/{MAX_ALIASES}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {aliases.map(a => (
                      <span key={a} className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary text-[10px] font-mono px-1.5 py-0.5">
                        {prefix}{a}
                        <button className="text-primary/60 hover:text-destructive" onClick={() => removeAlias(cmd, a)}><X className="size-2.5" /></button>
                      </span>
                    ))}
                    {aliases.length < MAX_ALIASES && (
                      <div className="inline-flex items-center gap-1">
                        <input
                          className="w-16 bg-background-alt/50 border border-border/40 rounded px-1.5 py-0.5 text-[10px] font-mono focus:outline-none focus:border-primary"
                          placeholder="add"
                          value={aliasDraft[cmd.name] || ""}
                          onChange={e => setAliasDraft(prev => ({ ...prev, [cmd.name]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") addAlias(cmd); }}
                        />
                        <button className="text-muted-foreground hover:text-primary" onClick={() => addAlias(cmd)}><Plus className="size-3" /></button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Permission + cooldown row */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Shield className="size-2.5" /> Permission</label>
                    <select className="w-full mt-0.5 bg-background-alt/50 border border-border/40 rounded px-1.5 py-1 text-[10px] font-mono" value={permission} onChange={e => setField(cmd.name, "permission", e.target.value)}>
                      {data.permLevels.map(p => <option key={p} value={p}>{permLabels[p] || p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="size-2.5" /> Cooldown (s)</label>
                    <Input type="number" min={0} max={86400} className="mt-0.5 text-[10px] font-mono h-7" value={cooldown} onChange={e => setField(cmd.name, "cooldown", parseInt(e.target.value) || 0)} placeholder="0" />
                  </div>
                </div>

                {/* Save / reset row */}
                <div className="flex items-center justify-end gap-1 pt-1 border-t border-border/20">
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive px-2" onClick={() => resetMutation.mutate(cmd.name)} title="Reset to defaults">
                    <RotateCcw className="size-3" />
                  </Button>
                  <Button size="sm" className="h-6 text-[10px] px-3" disabled={!dirty || saveMutation.isPending} onClick={() => handleSave(cmd)}>
                    <Save className="size-3 mr-1" /> Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">No commands match your search.</div>
      )}
    </div>
  );
}
