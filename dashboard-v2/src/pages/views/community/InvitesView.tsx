import { useQuery } from "@tanstack/react-query";
import { get, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link2 } from "lucide-react";

interface InviteRow {
  inviter_id: string;
  count: number;
}
interface InvitesData {
  guildId: string;
  hasGuild: boolean;
  leaderboard: InviteRow[];
}

export default function InvitesView() {
  const { guildId } = useGuild();

  const { data, isLoading } = useQuery<InvitesData>({
    queryKey: ["invites", guildId],
    queryFn: () => get(guildPath("/api/invites", guildId)),
    enabled: !!guildId,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading invite data...</div>;

  const rows = data.leaderboard || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <Link2 className="size-5 text-primary" /> Invite Tracking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">See which members brought the most people into the server.</p>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <div>
            <CardTitle className="text-sm font-semibold">🏆 Invite Leaderboard</CardTitle>
            <CardDescription className="text-xs">Ranked by attributed member joins</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {!rows.length ? (
            <p className="text-xs text-muted-foreground">No invites tracked yet. Members must join while the bot has the <span className="font-mono">Manage Server</span> permission.</p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r, i) => (
                <li key={r.inviter_id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-5">{i + 1}.</span>
                  <span className="text-primary font-semibold w-14">{r.count} inv</span>
                  <span className="text-muted-foreground font-mono truncate">user {r.inviter_id}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
