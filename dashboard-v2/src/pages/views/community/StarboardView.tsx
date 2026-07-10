import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { SaveBar } from "@/components/app/SaveBar";

interface StarboardConfig {
  enabled: boolean; channelId?: string | null; emoji: string; threshold: number;
  selfStar: boolean; ignoreNsfw: boolean; ignoredChannels: string[];
}
interface StarboardData {
  guildId: string; hasGuild: boolean;
  channels: { id: string; name: string }[];
  config: StarboardConfig;
  top: { source_msg_id: string; star_count: number; board_msg_id: string }[];
}

export default function StarboardView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<StarboardData>({
    queryKey: ["starboard", guildId],
    queryFn: () => get(guildPath("/api/starboard", guildId)),
    enabled: !!guildId,
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/starboard", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["starboard", guildId] });
      toast.success("Starboard configuration saved");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const cfg = data?.config;
  const [enabled, setEnabled] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [emoji, setEmoji] = useState("⭐");
  const [threshold, setThreshold] = useState(3);
  const [selfStar, setSelfStar] = useState(false);
  const [ignoreNsfw, setIgnoreNsfw] = useState(true);

  useEffect(() => {
    if (cfg) {
      setEnabled(cfg.enabled);
      setChannelId(cfg.channelId || "");
      setEmoji(cfg.emoji || "⭐");
      setThreshold(cfg.threshold ?? 3);
      setSelfStar(cfg.selfStar);
      setIgnoreNsfw(cfg.ignoreNsfw);
    }
  }, [data]);

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading starboard config...</div>;

  const dirty =
    enabled !== cfg!.enabled ||
    channelId !== (cfg!.channelId || "") ||
    emoji !== (cfg!.emoji || "⭐") ||
    threshold !== (cfg!.threshold ?? 3) ||
    selfStar !== cfg!.selfStar ||
    ignoreNsfw !== cfg!.ignoreNsfw;

  const handleSave = () => saveMutation.mutate({
    enabled, channelId: channelId || null, emoji, threshold, selfStar, ignoreNsfw,
  });
  const handleReset = () => {
    if (cfg) {
      setEnabled(cfg.enabled); setChannelId(cfg.channelId || ""); setEmoji(cfg.emoji || "⭐");
      setThreshold(cfg.threshold ?? 3); setSelfStar(cfg.selfStar); setIgnoreNsfw(cfg.ignoreNsfw);
      toast("Changes discarded");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <Star className="size-5 text-primary" /> Starboard Highlights
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Repost top-reacted messages to a highlights channel.</p>
      </div>

      <SaveBar dirty={dirty} saving={saveMutation.isPending} onSave={handleSave} onReset={handleReset} />

      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-semibold">Starboard</CardTitle><CardDescription className="text-xs">React with the star emoji to feature a message</CardDescription></div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Board Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">— None —</option>
                {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Star Emoji</label>
              <Input className="mt-1 text-xs font-mono" value={emoji} onChange={e => setEmoji(e.target.value.slice(0, 64))} placeholder="⭐ or :customname:" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Threshold (stars needed)</label>
              <Input type="number" min={1} max={100} className="mt-1 text-xs font-mono" value={threshold} onChange={e => setThreshold(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} />
            </div>
          </div>
          <div className="flex items-center gap-6 pt-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={selfStar} onCheckedChange={setSelfStar} /> Allow self-starring
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={ignoreNsfw} onCheckedChange={setIgnoreNsfw} /> Ignore NSFW channels
            </label>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">🏆 Top Starred</CardTitle></CardHeader>
        <CardContent>
          {!data.top?.length ? (
            <p className="text-xs text-muted-foreground">No starred messages yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.top.map((t, i) => (
                <li key={t.source_msg_id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-5">{i + 1}.</span>
                  <span className="text-primary">⭐ {t.star_count}</span>
                  <span className="text-muted-foreground font-mono truncate">msg {t.source_msg_id}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
