import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Share2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/app/ConfirmProvider";

type Platform = "rss" | "youtube" | "twitch";

interface Connector {
  id: number;
  guild_id: string;
  platform: Platform;
  target: string;
  announce_channel_id: string;
  message_template: string | null;
  last_seen: string | null;
  enabled: number;
  created_at: number;
}

interface SocialData {
  guildId: string;
  hasGuild: boolean;
  channels: { id: string; name: string }[];
  connectors: Connector[];
  twitchReady: boolean;
}

const PLATFORM_LABEL: Record<Platform, string> = { rss: "RSS Feed", youtube: "YouTube", twitch: "Twitch" };
const TARGET_HINT: Record<Platform, string> = {
  rss: "Feed URL (https://…/feed.xml)",
  youtube: "Channel ID (UC…)",
  twitch: "Twitch login (e.g. ninja)",
};

export default function SocialView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery<SocialData>({
    queryKey: ["social", guildId],
    queryFn: () => get(guildPath("/api/social", guildId)),
    enabled: !!guildId,
  });

  const [platform, setPlatform] = useState<Platform>("rss");
  const [target, setTarget] = useState("");
  const [channelId, setChannelId] = useState("");
  const [template, setTemplate] = useState("");

  const createMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/social", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social", guildId] });
      setTarget(""); setTemplate("");
      toast.success("Connector added");
    },
    onError: (e: any) => toast.error(e.message || "Failed to add connector"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(guildPath(`/api/social/${id}`, guildId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social", guildId] });
      toast.success("Connector removed");
    },
    onError: (e: any) => toast.error(e.message || "Failed to remove connector"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading social connectors...</div>;

  const connectors = data.connectors || [];
  const canAdd = !!target.trim() && !!channelId;

  const handleAdd = () => {
    if (!canAdd) return;
    createMutation.mutate({ platform, target: target.trim(), announceChannelId: channelId, messageTemplate: template.trim() || undefined });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <Share2 className="size-5 text-primary" /> Social Connectors
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Announce new RSS, YouTube, or Twitch posts to a channel. Polls every ~5 minutes.</p>
      </div>

      {!data.twitchReady && (
        <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
          Twitch connectors require <span className="font-mono">twitchClientId</span> / <span className="font-mono">twitchClientSecret</span> to be configured. RSS &amp; YouTube work without any keys.
        </div>
      )}

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Add Connector</CardTitle>
          <CardDescription className="text-xs">Pick a platform, its target, and where to announce.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Platform</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs" value={platform} onChange={e => setPlatform(e.target.value as Platform)}>
                <option value="rss">RSS Feed</option>
                <option value="youtube">YouTube</option>
                <option value="twitch">Twitch</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Target</label>
              <Input className="mt-1 text-xs font-mono" value={target} onChange={e => setTarget(e.target.value)} placeholder={TARGET_HINT[platform]} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Announce Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">— Select —</option>
                {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Message Template <span className="text-muted-foreground/60">(optional — {"{title}"}, {"{link}"}, {"{platform}"})</span></label>
            <Input className="mt-1 text-xs" value={template} onChange={e => setTemplate(e.target.value)} placeholder="📢 New post: {title} — {link}" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={!canAdd || createMutation.isPending} onClick={handleAdd}>
              <Plus className="size-3.5 mr-1" /> Add Connector
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">Connectors ({connectors.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {connectors.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No connectors yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/30">
                  <TableHead className="text-xs w-12">ID</TableHead>
                  <TableHead className="text-xs">Platform</TableHead>
                  <TableHead className="text-xs">Target</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.map(c => {
                  const channel = data.channels.find(ch => ch.id === c.announce_channel_id);
                  return (
                    <TableRow key={c.id} className="border-b border-border/20">
                      <TableCell className="text-xs font-mono text-muted-foreground">#{c.id}</TableCell>
                      <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{PLATFORM_LABEL[c.platform] || c.platform}</Badge></TableCell>
                      <TableCell className="text-xs font-mono max-w-xs truncate" title={c.target}>{c.target}</TableCell>
                      <TableCell className="text-xs font-mono">#{channel?.name || c.announce_channel_id}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={deleteMutation.isPending} onClick={async () => {
                            if (!await confirm({
                              title: "Remove connector?",
                              description: `Stop announcing ${PLATFORM_LABEL[c.platform] || c.platform} "${c.target}".`,
                              confirmLabel: "Remove",
                            })) return;
                            deleteMutation.mutate(c.id);
                          }}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
