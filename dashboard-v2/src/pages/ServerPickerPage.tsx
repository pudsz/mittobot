import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Users, Hash, ShieldCheck, Crown, Server, ArrowRight, Search, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useBotStatus } from "@/hooks/useGuild";
import { avatarUrl, guildIconUrl, guildAcronym } from "@/lib/utils";

export default function ServerPickerPage() {
  const { user, guilds, logout } = useAuth();
  const { data: status } = useBotStatus();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const filteredGuilds = guilds.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalMembers = guilds.reduce((acc, g) => acc + (g.memberCount || 0), 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg border border-primary/20">
              <Server className="size-5 text-primary" />
            </div>
            <span className="font-semibold text-lg tracking-tight">ggboi</span>
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded font-mono">
              Control Panel
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className={`size-2 rounded-full ${status?.online !== false ? "bg-success animate-pulse" : "bg-destructive"}`} />
              <span className="text-muted-foreground">
                {status?.tag || "offline"} {status?.ping ? `· ${status.ping}ms` : ""}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Column: Profile & Global Stats */}
        <div className="lg:col-span-1 space-y-6">
          {/* Profile Card */}
          {user && (
            <Card className="border-border/40 bg-card/60 overflow-hidden">
              <div className="h-16 bg-gradient-to-r from-primary/30 to-indigo-600/30" />
              <CardContent className="pt-0 relative px-5 pb-5">
                <img
                  src={avatarUrl(user)}
                  alt={user.tag}
                  className="size-16 rounded-full border-4 border-card absolute -top-8 left-5 bg-background"
                  referrerPolicy="no-referrer"
                />
                <div className="pt-10 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base tracking-tight">{user.tag}</span>
                    {user.isOwner && (
                      <span className="inline-flex items-center gap-1 bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase">
                        <Crown className="size-2.5" />
                        Owner
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">ID: {user.id}</p>
                </div>

                <div className="pt-6">
                  <Button variant="outline" size="sm" className="w-full text-muted-foreground hover:text-foreground" onClick={logout}>
                    <LogOut className="size-4 mr-2" />
                    Log out
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick Stats */}
          <Card className="border-border/40 bg-card/40">
            <CardHeader className="p-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Telemetry
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <div className="flex items-center gap-2">
                  <Server className="size-4 text-muted-foreground" />
                  <span className="text-sm">Servers</span>
                </div>
                <span className="font-mono font-semibold text-foreground">{guilds.length}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/20 pb-3">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="text-sm">Total Members</span>
                </div>
                <span className="font-mono font-semibold text-foreground">{totalMembers.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  <span className="text-sm">Status</span>
                </div>
                <span className="font-mono font-semibold text-success">Active</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Server List */}
        <div className="lg:col-span-3 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Select a Server</h2>
              <p className="text-sm text-muted-foreground">Select a server to manage its configuration.</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search servers..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {filteredGuilds.length === 0 ? (
            <Card className="border-border/40 bg-card/20 py-16 text-center">
              <CardContent className="flex flex-col items-center justify-center space-y-4">
                <div className="bg-muted p-4 rounded-full">
                  <Server className="size-8 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-base">No Servers Found</h3>
                  <p className="text-sm text-muted-foreground">
                    {search ? `No servers matched "${search}"` : "You don't have access to any servers."}
                  </p>
                </div>
                {search && (
                  <Button variant="outline" size="sm" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredGuilds.map((g) => {
                const icon = guildIconUrl(g);
                return (
                  <Card
                    key={g.id}
                    className="border-border/40 hover:border-primary/50 hover:bg-primary/5/10 transition-all cursor-pointer group"
                    onClick={() => navigate(`/g/${g.id}`)}
                  >
                    <CardHeader className="flex flex-row items-center gap-4 p-5">
                      <div className="size-12 rounded-lg bg-secondary flex items-center justify-center overflow-hidden border border-border/40 group-hover:border-primary/20 transition-all shrink-0">
                        {icon ? (
                          <img src={icon} alt={g.name} className="size-full object-cover" />
                        ) : (
                          <span className="font-bold text-sm tracking-tight text-muted-foreground font-mono">
                            {guildAcronym(g.name)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base font-bold truncate group-hover:text-primary transition-colors">
                          {g.name}
                        </CardTitle>
                        <CardDescription className="font-mono text-xs flex items-center gap-3 mt-1.5">
                          <span className="flex items-center gap-1">
                            <Users className="size-3.5" />
                            {g.memberCount?.toLocaleString() || "0"}
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Hash className="size-3.5" />
                            {g.channelCount || "0"} ch
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Shield className="size-3.5" />
                            {g.roleCount || "0"} roles
                          </span>
                        </CardDescription>
                      </div>
                      <ArrowRight className="size-5 text-muted-foreground group-hover:text-primary transition-all group-hover:translate-x-1" />
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
