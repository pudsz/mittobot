import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, Wifi, Layers, Users, MemoryStick, Cpu, Clock, Bot } from "lucide-react";

interface BotStatus {
  online: boolean; prefix: string; tag: string; uptimeMs: number; ping: number;
  guilds: number; users: number; memoryUsedMb: number; memoryTotalMb: number;
  cpuLoad: { load1: number; load5: number; load15: number; cpuCount: number };
  processUptimeSec: number; nodeRuntime: { version: string; platform: string; arch: string; pid: number };
  activeAiConversations: number; commandsPerMin: number;
  activity: { name: string; type: number } | null;
}

function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h ${m % 60}m`;
}

function StatCard({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</CardTitle>
        <Icon className={`size-4 ${accent || "text-primary"}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight font-mono">{value}</div>
        {sub && <p className="text-[10px] text-muted-foreground font-mono mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function StatusView() {
  const { data, isLoading, error } = useQuery<BotStatus>({
    queryKey: ["status"], queryFn: () => get("/api/status"),
    refetchInterval: 10_000,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading telemetry...</div>;
  if (error || !data) return <div className="p-6 text-sm text-destructive">Failed to load status</div>;

  const memPct = data.memoryTotalMb > 0 ? Math.round((data.memoryUsedMb / data.memoryTotalMb) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Status" value={data.online ? "Online" : "Offline"} sub={data.tag} accent={data.online ? "text-success" : "text-destructive"} />
        <StatCard icon={Wifi} label="Latency" value={`${data.ping}ms`} sub="WebSocket heartbeat" accent="text-warning" />
        <StatCard icon={Layers} label="Guilds" value={String(data.guilds)} sub="Servers connected" />
        <StatCard icon={Users} label="Users" value={data.users.toLocaleString()} sub="Across all guilds" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="Bot Uptime" value={formatUptime(data.uptimeMs)} sub="Since last ready" />
        <StatCard icon={Cpu} label="Process Uptime" value={formatUptime(data.processUptimeSec * 1000)} sub="Node.js process" />
        <StatCard icon={MemoryStick} label="Memory" value={`${data.memoryUsedMb}MB / ${data.memoryTotalMb}MB`} sub={`${memPct}% of system RAM`} />
        <StatCard icon={Bot} label="Commands/min" value={String(data.commandsPerMin)} sub="Rolling 60s window" />
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">System Details</CardTitle><CardDescription className="text-xs">Node.js runtime & CPU metrics</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
            <div><span className="text-muted-foreground">Version</span><p className="text-foreground">{data.nodeRuntime.version}</p></div>
            <div><span className="text-muted-foreground">Platform</span><p className="text-foreground">{data.nodeRuntime.platform} ({data.nodeRuntime.arch})</p></div>
            <div><span className="text-muted-foreground">PID</span><p className="text-foreground">{data.nodeRuntime.pid}</p></div>
            <div><span className="text-muted-foreground">CPU</span><p className="text-foreground">{data.cpuLoad.cpuCount} cores (load: {data.cpuLoad.load1.toFixed(2)})</p></div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 text-xs font-mono">
            <div><span className="text-muted-foreground">CPU 1m</span><p className="text-foreground">{data.cpuLoad.load1.toFixed(2)}</p></div>
            <div><span className="text-muted-foreground">CPU 5m</span><p className="text-foreground">{data.cpuLoad.load5.toFixed(2)}</p></div>
            <div><span className="text-muted-foreground">CPU 15m</span><p className="text-foreground">{data.cpuLoad.load15.toFixed(2)}</p></div>
          </div>
          <div className="mt-4 text-xs font-mono">
            <span className="text-muted-foreground">Prefix</span><p className="text-foreground">{data.prefix || "$"}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
