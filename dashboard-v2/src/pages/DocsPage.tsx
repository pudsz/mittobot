import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, Command, BookOpen, Terminal, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

const CATEGORY_STYLES: Record<string, { emoji: string; color: string; label: string }> = {
  utility:   { emoji: "🛠️",  color: "text-indigo-400 border-indigo-500/30", label: "Utility" },
  info:      { emoji: "ℹ️",   color: "text-emerald-400 border-emerald-500/30", label: "Info" },
  fun:       { emoji: "🎉",   color: "text-pink-400 border-pink-500/30", label: "Fun" },
  fakemod:   { emoji: "🎭",   color: "text-yellow-400 border-yellow-500/30", label: "Fake Mod" },
  realmod:   { emoji: "🛡️",   color: "text-rose-400 border-rose-500/30", label: "Moderation" },
  admin:     { emoji: "⚙️",   color: "text-purple-400 border-purple-500/30", label: "Admin" },
  dynamic:   { emoji: "📦",   color: "text-amber-400 border-amber-500/30", label: "Modules" },
};

function getCatStyle(catId: string) {
  return CATEGORY_STYLES[catId] || { emoji: "❓", color: "text-gray-400 border-gray-500/30", label: catId };
}

const PERM_LABELS: Record<string, string> = {
  everyone: "Everyone",
  booster:  "Server Booster",
  mod:      "Moderator",
  admin:    "Administrator",
  owner:    "Bot Owner",
};

interface CommandDef {
  name: string;
  category?: string;
  description?: string;
  aliases?: string[];
  config?: {
    enabled?: boolean;
    permission?: string;
    cooldown?: number;
    settings?: Record<string, any>;
  };
}

export default function DocsPage() {
  const navigate = useNavigate();
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [prefix, setPrefix] = useState("$");
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api("GET", "/api/commands");
        if (!alive) return;
        setCommands(data.commands || []);
        setPrefix(data.prefix || "$");
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const groups: Record<string, CommandDef[]> = {};
  for (const cmd of commands) {
    const catId = cmd.category || "utility";
    (groups[catId] ??= []).push(cmd);
  }
  for (const id of Object.keys(groups)) {
    groups[id].sort((a, b) => a.name.localeCompare(b.name));
  }

  const catOrder = ["utility", "info", "fun", "fakemod", "realmod", "admin", "dynamic"].filter(
    (id) => groups[id]
  );

  const q = query.trim().toLowerCase();
  let filteredGroups = groups;
  if (q) {
    filteredGroups = {};
    for (const [catId, cmds] of Object.entries(groups)) {
      const matching = cmds.filter(
        (c) =>
          c.name.includes(q) ||
          (c.description || "").toLowerCase().includes(q) ||
          (c.aliases || []).some((a) => a.includes(q))
      );
      if (matching.length) filteredGroups[catId] = matching;
    }
  }

  const activeCmds = activeCategory
    ? filteredGroups[activeCategory] || []
    : Object.values(filteredGroups).flat();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="size-4 mr-2" />
              Back
            </Button>
            <span className="font-semibold text-lg tracking-tight flex items-center gap-2">
              <BookOpen className="size-5 text-primary" /> Command Reference
            </span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {commands.length} commands · {catOrder.length} categories
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-3 size-5 text-muted-foreground" />
          <Input
            placeholder="Search commands, aliases, descriptions..."
            className="pl-10 py-6 text-base"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveCategory(null);
            }}
          />
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeCategory === null ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveCategory(null)}
            className="rounded-full"
          >
            All Categories
          </Button>
          {catOrder.map((catId) => {
            const cs = getCatStyle(catId);
            const count = (filteredGroups[catId] || []).length;
            return (
              <Button
                key={catId}
                variant={activeCategory === catId ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory(catId)}
                className="rounded-full"
              >
                <span>{cs.emoji}</span>
                <span>{cs.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono ml-1">({count})</span>
              </Button>
            );
          })}
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-4">
            <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span className="text-muted-foreground text-sm font-mono">Loading telemetry database...</span>
          </div>
        ) : error ? (
          <Card className="border-destructive/20 bg-destructive/5">
            <CardContent className="pt-6 text-center space-y-4">
              <p className="text-destructive font-mono">⚠️ Failed to connect to commands database: {error}</p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Retry connection
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {activeCmds.length === 0 ? (
              <Card className="border-border/40 bg-card/25 py-12 text-center text-muted-foreground">
                <p>No commands matched your search filter.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {activeCmds.map((cmd) => {
                  const cs = getCatStyle(cmd.category || "utility");
                  const isOpen = expanded === cmd.name;
                  return (
                    <Card
                      key={cmd.name}
                      className={`border-border/40 bg-card/30 hover:bg-card/50 transition-all overflow-hidden ${isOpen ? "ring-1 ring-primary/30" : ""}`}
                    >
                      <div
                        className="p-4 flex items-center justify-between cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : cmd.name)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <code className="font-mono font-bold text-primary text-sm sm:text-base">
                            {prefix}{cmd.name}
                          </code>
                          <Badge variant="outline" className={`font-mono text-[10px] ${cs.color}`}>
                            {cs.emoji} {cs.label}
                          </Badge>
                          {cmd.config?.enabled === false && (
                            <Badge variant="destructive" className="text-[10px]">
                              disabled
                            </Badge>
                          )}
                          <span className="text-sm text-muted-foreground truncate hidden md:inline ml-2">
                            {cmd.description}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <Badge variant="secondary" className="font-mono text-[10px] hidden sm:inline-block">
                            {PERM_LABELS[cmd.config?.permission || "everyone"] || cmd.config?.permission || "Everyone"}
                          </Badge>
                          {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </div>
                      </div>

                      {isOpen && (
                        <div className="px-4 pb-4 border-t border-border/20 pt-4 bg-background-alt/50 space-y-4 animate-fade-in">
                          <p className="text-sm text-foreground md:hidden">{cmd.description}</p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Usage formats</Label>
                              <div className="space-y-1 text-sm font-mono">
                                <div className="flex items-center gap-2">
                                  <Terminal className="size-3.5 text-muted-foreground" />
                                  <span>{prefix}{cmd.name} <span className="text-muted-foreground">[args]</span></span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Command className="size-3.5 text-muted-foreground" />
                                  <span>/{cmd.name}</span>
                                </div>
                              </div>
                            </div>

                            {cmd.aliases && cmd.aliases.length > 0 && (
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Aliases</Label>
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {cmd.aliases.map((a) => (
                                    <code key={a} className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono">
                                      {prefix}{a}
                                    </code>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Cooldown</Label>
                              <p className="text-sm font-mono">{cmd.config?.cooldown ? `${cmd.config.cooldown}s` : "No cooldown"}</p>
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Minimum Role Level</Label>
                              <p className="text-sm font-mono">
                                {PERM_LABELS[cmd.config?.permission || "everyone"] || cmd.config?.permission || "Everyone"}
                              </p>
                            </div>
                          </div>

                          {cmd.config?.settings && Object.keys(cmd.config.settings).length > 0 && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Advanced settings</Label>
                              <pre className="bg-background-alt border border-border/40 p-3 rounded-lg text-xs font-mono overflow-auto max-h-48 text-emerald-400">
                                {JSON.stringify(cmd.config.settings, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
