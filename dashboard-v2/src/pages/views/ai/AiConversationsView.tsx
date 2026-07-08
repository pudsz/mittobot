import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, RefreshCw, MessageSquare, Bot } from "lucide-react";

interface ConversationUser {
  scope: string; guildId: string; channelId: string;
  channelName?: string; userId: string;
  displayName: string; avatarUrl?: string; lastActive: string;
}

interface LogEntry {
  id: number; scope: string; guildId: string;
  channelId: string; channelName?: string;
  userId: string; displayName: string;
  role: string; content: string; timestamp: number;
}

interface ConvData {
  logs: LogEntry[]; users: ConversationUser[];
  guildId: string; scope: string | null;
}

function formatTs(ts: number) {
  const ms = typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

export default function AiConversationsView() {
  const { guildId } = useGuild();
  const [scope, setScope] = useState("global");
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState("");

  const params = new URLSearchParams({ scope, limit: String(limit) });
  if (selectedUser && scope === "private") params.set("userId", selectedUser);
  if (selectedChannel && scope === "global") params.set("channelId", selectedChannel);

  const { data, isLoading, refetch, isFetching } = useQuery<ConvData>({
    queryKey: ["ai-conversations-logs", guildId, scope, selectedUser, selectedChannel, limit],
    queryFn: () => get(guildPath("/api/ai/conversations/logs", guildId) + `&${params.toString()}`),
    enabled: !!guildId,
  });

  const { data: memoriesData } = useQuery<{ conversations: any[] }>({
    queryKey: ["ai-conversations", guildId],
    queryFn: () => get(guildPath("/api/ai/conversations", guildId)),
    enabled: !!guildId,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;

  const users = data?.users || memoriesData?.conversations?.map((m: any) => ({
    userId: m.user_id || m.userId, displayName: m.user_id || m.userId,
    scope: m.scope, channelId: m.channel_id || m.channelId,
  })) || [];

  const logs = data?.logs || [];

  const uniqueUsers = Array.from(new Map(users.map(u => [u.userId + u.channelId + u.scope, u])).values());
  const uniqueChannels = Array.from(new Map(users.filter(u => u.channelId).map(u => [u.channelId, u])).values());

  const filteredLogs = logs.filter(l =>
    !search || l.content?.toLowerCase().includes(search.toLowerCase()) || l.displayName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Conversation Logs</h1>
            <p className="text-xs text-muted-foreground">{logs.length} messages · {uniqueUsers.length} threads</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground">Scope</label>
            <select className="mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={scope} onChange={e => { setScope(e.target.value); setSelectedUser(""); setSelectedChannel(""); }}>
              <option value="global">Global (channels)</option>
              <option value="private">Private (DMs)</option>
            </select>
          </div>
          {scope === "private" && (
            <div>
              <label className="text-[10px] text-muted-foreground">User</label>
              <select className="mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
                <option value="">All users</option>
                {uniqueUsers.filter(u => u.scope === "private").map(u => (
                  <option key={u.userId} value={u.userId}>{u.displayName}</option>
                ))}
              </select>
            </div>
          )}
          {scope === "global" && (
            <div>
              <label className="text-[10px] text-muted-foreground">Channel</label>
              <select className="mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)}>
                <option value="">All channels</option>
                {uniqueChannels.filter(u => u.scope === "global").map(u => (
                  <option key={u.channelId} value={u.channelId}>#{u.displayName}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] text-muted-foreground">Limit</label>
            <select className="mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={limit} onChange={e => setLimit(parseInt(e.target.value))}>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] text-muted-foreground">Search</label>
            <Input placeholder="Search messages…" className="mt-1 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading conversations...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? "No messages match your search." : "No conversation logs yet. The bot needs to have AI conversations first."}
            </div>
          ) : (
            <div className="space-y-1 max-h-[600px] overflow-y-auto">
              {filteredLogs.map(l => (
                <div key={l.id} className={`flex gap-2 p-2 rounded ${l.role === "assistant" ? "bg-primary/5" : ""}`}>
                  <div className="shrink-0 mt-0.5">
                    {l.role === "assistant" ? <Bot className="size-4 text-primary" /> : <MessageSquare className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-semibold">{l.displayName}</span>
                      <Badge variant="outline" className="text-[9px] px-1">{l.role}</Badge>
                      <span>{formatTs(l.timestamp)}</span>
                      {l.channelName && <span className="font-mono">#{l.channelName}</span>}
                    </div>
                    <p className="text-xs mt-0.5 whitespace-pre-wrap break-words">{l.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
