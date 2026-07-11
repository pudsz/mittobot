import { useQuery } from "@tanstack/react-query";
import { get, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Music, Pause, Play, ListMusic } from "lucide-react";

interface Track {
  title: string;
  url: string | null;
  duration: number; // seconds; 0 = unknown/live
  requestedBy: { id: string; tag: string } | null;
  thumbnail: string | null;
}

interface MusicState {
  connected: boolean;
  streamingAvailable: boolean;
  current: Track | null;
  paused: boolean;
  voiceChannelId: string | null;
  queue: Track[];
}

interface MusicData {
  guildId: string;
  hasGuild: boolean;
  state: MusicState;
}

function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return "live";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function MusicView() {
  const { guildId } = useGuild();

  // Poll — playback state changes outside the dashboard, so refresh often.
  const { data, isLoading } = useQuery<MusicData>({
    queryKey: ["music", guildId],
    queryFn: () => get(guildPath("/api/music", guildId)),
    enabled: !!guildId,
    refetchInterval: 5000,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading music state...</div>;

  const st = data.state;
  const current = st.current;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <Music className="size-5 text-primary" /> Music Stream
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Live view of the voice-channel playback queue.</p>
      </div>

      {!st.streamingAvailable && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="py-3 text-xs text-warning">
            Audio streaming is not available on this instance (the <code>play-dl</code> library isn't installed).
            Commands and the queue still work, but audio can't be streamed.
          </CardContent>
        </Card>
      )}

      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {st.paused ? <Pause className="size-4 text-primary" /> : <Play className="size-4 text-primary" />}
              Now Playing
            </CardTitle>
            <CardDescription className="text-xs">
              {st.connected ? "Connected to a voice channel" : "Not connected"}
            </CardDescription>
          </div>
          {current && (
            <Badge variant={st.paused ? "secondary" : "default"}>{st.paused ? "Paused" : "Playing"}</Badge>
          )}
        </CardHeader>
        <CardContent>
          {!current ? (
            <p className="text-xs text-muted-foreground">Nothing is playing right now.</p>
          ) : (
            <div className="flex items-center gap-3">
              {current.thumbnail ? (
                <img src={current.thumbnail} alt="" className="size-14 rounded-lg object-cover border border-border/40" />
              ) : (
                <div className="size-14 rounded-lg bg-background-alt/50 border border-border/40 flex items-center justify-center">
                  <Music className="size-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{current.title}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtDuration(current.duration)}
                  {current.requestedBy ? ` • requested by ${current.requestedBy.tag}` : ""}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ListMusic className="size-4 text-primary" /> Up Next ({st.queue.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!st.queue.length ? (
            <p className="text-xs text-muted-foreground">The queue is empty.</p>
          ) : (
            <ul className="space-y-1.5">
              {st.queue.map((t, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                  <span className="truncate">{t.title}</span>
                  <span className="text-muted-foreground font-mono ml-auto shrink-0">{fmtDuration(t.duration)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
