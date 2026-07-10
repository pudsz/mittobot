import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "lucide-react";
import { toast } from "sonner";
import { SaveBar } from "@/components/app/SaveBar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface BirthdayConfig {
  enabled: boolean; channelId?: string | null; message: string; roleId?: string | null; hour: number;
}
interface BirthdaysData {
  guildId: string; hasGuild: boolean;
  channels: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  config: BirthdayConfig;
  upcoming: { user_id: string; month: number; day: number; year?: number }[];
}

export default function BirthdaysView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<BirthdaysData>({
    queryKey: ["birthdays", guildId],
    queryFn: () => get(guildPath("/api/birthdays", guildId)),
    enabled: !!guildId,
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/birthdays", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["birthdays", guildId] });
      toast.success("Birthday configuration saved");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const cfg = data?.config;
  const [enabled, setEnabled] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const [roleId, setRoleId] = useState("");
  const [hour, setHour] = useState(9);

  useEffect(() => {
    if (cfg) {
      setEnabled(cfg.enabled);
      setChannelId(cfg.channelId || "");
      setMessage(cfg.message || "");
      setRoleId(cfg.roleId || "");
      setHour(cfg.hour ?? 9);
    }
  }, [data]);

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading birthday config...</div>;

  const dirty =
    enabled !== cfg!.enabled ||
    channelId !== (cfg!.channelId || "") ||
    message !== (cfg!.message || "") ||
    roleId !== (cfg!.roleId || "") ||
    hour !== (cfg!.hour ?? 9);

  const handleSave = () => saveMutation.mutate({
    enabled, channelId: channelId || null, message, roleId: roleId || null, hour,
  });
  const handleReset = () => {
    if (cfg) {
      setEnabled(cfg.enabled); setChannelId(cfg.channelId || ""); setMessage(cfg.message || "");
      setRoleId(cfg.roleId || ""); setHour(cfg.hour ?? 9);
      toast("Changes discarded");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <Calendar className="size-5 text-primary" /> Birthdays
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Automatically congratulate members on their birthday. Members register with <code className="text-xs">/birthday set</code>.</p>
      </div>

      <SaveBar dirty={dirty} saving={saveMutation.isPending} onSave={handleSave} onReset={handleReset} />

      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-semibold">Birthday Announcements</CardTitle><CardDescription className="text-xs">Posted once daily at the configured hour (UTC)</CardDescription></div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Announcement Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">— None —</option>
                {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Birthday Role (optional)</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={roleId} onChange={e => setRoleId(e.target.value)}>
                <option value="">— None —</option>
                {data.roles.map(r => <option key={r.id} value={r.id}>@{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Announce Hour (UTC 0–23)</label>
              <Input type="number" min={0} max={23} className="mt-1 text-xs font-mono" value={hour} onChange={e => setHour(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Message ({message.length}/1000) — {"{user}"} {"{server}"}</label>
            <Textarea className="mt-1 text-xs font-mono h-16 resize-y" value={message} onChange={e => setMessage(e.target.value.slice(0, 1000))} placeholder="🎉 Happy Birthday {user}! 🎂" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader><CardTitle className="text-sm font-semibold">🎂 Upcoming Birthdays</CardTitle></CardHeader>
        <CardContent>
          {!data.upcoming?.length ? (
            <p className="text-xs text-muted-foreground">No birthdays registered yet.</p>
          ) : (
            <ul className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
              {data.upcoming.map(b => (
                <li key={b.user_id} className="text-xs flex items-center gap-2">
                  <span className="text-primary font-medium">{MONTHS[b.month - 1]} {b.day}</span>
                  <span className="text-muted-foreground font-mono truncate">{b.user_id}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
