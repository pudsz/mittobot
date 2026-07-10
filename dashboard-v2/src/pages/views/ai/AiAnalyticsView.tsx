import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, RefreshCw } from "lucide-react";

// Mirrors the real /api/ai/analytics response (src/db.js: getAiAnalytics,
// getAiTopUsers, getAiDailyAnalytics). The backend has no cost or per-user
// token/displayName fields — those were invented by the previous version and
// rendered as zeros/undefined.
interface ProviderStat {
  provider: string;
  calls: number;
  tokens: number;
  successful: number;
  failed: number;
  avg_latency_ms: number;
}

interface TopUser {
  user_id: string;
  calls: number;
}

interface DailyPoint {
  provider: string;
  day_epoch: number; // days since epoch (timestamp / 86400000)
  calls: number;
  tokens: number;
  successful: number;
  failed: number;
}

interface AnalyticsData {
  stats: ProviderStat[];
  topUsers: TopUser[];
  daily: DailyPoint[];
  days: number;
}

const DAY_MS = 86_400_000;

export default function AiAnalyticsView() {
  const { guildId } = useGuild();
  const [days, setDays] = useState(7);

  const { data, isLoading, refetch, isFetching } = useQuery<AnalyticsData>({
    queryKey: ["ai-analytics", guildId, days],
    queryFn: () => get(guildPath(`/api/ai/analytics`, guildId) + `&days=${days}`),
    enabled: !!guildId,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading AI analytics...</div>;

  // Aggregate the per-provider stats into overall totals.
  const stats = data.stats || [];
  const totalCalls = stats.reduce((s, p) => s + (p.calls || 0), 0);
  const totalTokens = stats.reduce((s, p) => s + (p.tokens || 0), 0);
  const totalSuccessful = stats.reduce((s, p) => s + (p.successful || 0), 0);
  const totalFailed = stats.reduce((s, p) => s + (p.failed || 0), 0);
  const successRate = totalCalls > 0 ? Math.round((totalSuccessful / totalCalls) * 100) : 0;
  // Weighted average latency across providers (by call count).
  const avgLatency = totalCalls > 0
    ? Math.round(stats.reduce((s, p) => s + (p.avg_latency_ms || 0) * (p.calls || 0), 0) / totalCalls)
    : 0;

  // Collapse the per-provider daily rows into one series per day.
  const dailyByDay = new Map<number, { calls: number; tokens: number; successful: number; failed: number }>();
  for (const d of data.daily || []) {
    const cur = dailyByDay.get(d.day_epoch) || { calls: 0, tokens: 0, successful: 0, failed: 0 };
    cur.calls += d.calls || 0;
    cur.tokens += d.tokens || 0;
    cur.successful += d.successful || 0;
    cur.failed += d.failed || 0;
    dailyByDay.set(d.day_epoch, cur);
  }
  const dailyRows = [...dailyByDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day_epoch, v]) => ({
      date: new Date(day_epoch * DAY_MS).toLocaleDateString(),
      ...v,
    }));

  const hasData = totalCalls > 0 || (data.topUsers?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">AI Analytics</h1>
            <p className="text-xs text-muted-foreground">Usage statistics for the last {data.days} days</p>
          </div>
        </div>
        <div className="flex gap-2">
          <select className="bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={days} onChange={e => setDays(parseInt(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/40 bg-card/40">
          <CardContent className="py-4 px-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">AI Calls</div>
            <div className="text-xl font-bold mt-1">{totalCalls.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/40">
          <CardContent className="py-4 px-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Tokens</div>
            <div className="text-xl font-bold mt-1">{totalTokens.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/40">
          <CardContent className="py-4 px-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Success Rate</div>
            <div className="text-xl font-bold mt-1">{successRate}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{totalSuccessful} ok · {totalFailed} failed</div>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/40">
          <CardContent className="py-4 px-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Avg Latency</div>
            <div className="text-xl font-bold mt-1">{avgLatency}ms</div>
          </CardContent>
        </Card>
      </div>

      {stats.length > 0 && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader><CardTitle className="text-sm font-semibold">By Provider</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 px-4 text-muted-foreground font-medium">Provider</th>
                    <th className="text-right py-2 px-4 text-muted-foreground font-medium">Calls</th>
                    <th className="text-right py-2 px-4 text-muted-foreground font-medium">Tokens</th>
                    <th className="text-right py-2 px-4 text-muted-foreground font-medium">Success</th>
                    <th className="text-right py-2 px-4 text-muted-foreground font-medium">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(p => (
                    <tr key={p.provider} className="border-b border-border/20">
                      <td className="py-1.5 px-4 font-mono">{p.provider}</td>
                      <td className="py-1.5 px-4 text-right font-mono">{p.calls.toLocaleString()}</td>
                      <td className="py-1.5 px-4 text-right font-mono">{(p.tokens || 0).toLocaleString()}</td>
                      <td className="py-1.5 px-4 text-right font-mono">{p.calls > 0 ? Math.round((p.successful / p.calls) * 100) : 0}%</td>
                      <td className="py-1.5 px-4 text-right font-mono">{p.avg_latency_ms || 0}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {(data.topUsers?.length ?? 0) > 0 && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Top Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {data.topUsers.map(u => (
                <div key={u.user_id} className="flex items-center justify-between rounded-lg border border-border/40 bg-background-alt/30 p-3">
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{u.user_id}</div>
                  <div className="text-xs font-mono shrink-0 ml-3">{u.calls} calls</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {dailyRows.length > 0 && (
        <Card className="border-border/40 bg-card/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Daily Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 text-muted-foreground font-medium">Date</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Calls</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Tokens</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Success</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.map(d => (
                    <tr key={d.date} className="border-b border-border/20">
                      <td className="py-1.5">{d.date}</td>
                      <td className="py-1.5 text-right font-mono">{d.calls}</td>
                      <td className="py-1.5 text-right font-mono">{d.tokens.toLocaleString()}</td>
                      <td className="py-1.5 text-right font-mono">{d.calls > 0 ? Math.round((d.successful / d.calls) * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!hasData && (
        <Card className="border-border/40 bg-card/30">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No analytics data available yet.</CardContent>
        </Card>
      )}
    </div>
  );
}
