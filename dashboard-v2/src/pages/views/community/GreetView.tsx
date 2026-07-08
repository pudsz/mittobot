import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useGuild } from "@/hooks/useGuild";
import { guildPath } from "@/lib/api";
import { SaveBar } from "@/components/app/SaveBar";

interface GreetConfig {
  guildId: string; hasGuild: boolean; guildName: string;
  channels: { id: string; name: string }[];
  config: {
    welcome?: { enabled: boolean; channelId?: string | null; message?: string };
    leave?: { enabled: boolean; channelId?: string | null; message?: string };
    logs?: { enabled: boolean; channelId?: string | null; memberEvents?: boolean; messageEvents?: boolean };
  };
}

export default function GreetView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<GreetConfig>({
    queryKey: ["greet", guildId],
    queryFn: () => get(guildPath("/api/greet", guildId)),
    enabled: !!guildId,
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/greet", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["greet", guildId] });
      toast.success("Greet configuration saved successfully");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const cfg: GreetConfig["config"] = data?.config || {};

  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeCh, setWelcomeCh] = useState("");
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [leaveEnabled, setLeaveEnabled] = useState(false);
  const [leaveCh, setLeaveCh] = useState("");
  const [leaveMsg, setLeaveMsg] = useState("");
  const [logsEnabled, setLogsEnabled] = useState(false);
  const [logsCh, setLogsCh] = useState("");
  const [memberEvents, setMemberEvents] = useState(true);
  const [messageEvents, setMessageEvents] = useState(true);

  // Sync state when data is loaded/updated
  useEffect(() => {
    if (data?.config) {
      setWelcomeEnabled(cfg.welcome?.enabled ?? false);
      setWelcomeCh(cfg.welcome?.channelId || "");
      setWelcomeMsg(cfg.welcome?.message || "");
      setLeaveEnabled(cfg.leave?.enabled ?? false);
      setLeaveCh(cfg.leave?.channelId || "");
      setLeaveMsg(cfg.leave?.message || "");
      setLogsEnabled(cfg.logs?.enabled ?? false);
      setLogsCh(cfg.logs?.channelId || "");
      setMemberEvents(cfg.logs?.memberEvents ?? true);
      setMessageEvents(cfg.logs?.messageEvents ?? true);
    }
  }, [data]);

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading greet config...</div>;

  const dirty =
    welcomeEnabled !== (cfg.welcome?.enabled ?? false) ||
    welcomeCh !== (cfg.welcome?.channelId || "") ||
    welcomeMsg !== (cfg.welcome?.message || "") ||
    leaveEnabled !== (cfg.leave?.enabled ?? false) ||
    leaveCh !== (cfg.leave?.channelId || "") ||
    leaveMsg !== (cfg.leave?.message || "") ||
    logsEnabled !== (cfg.logs?.enabled ?? false) ||
    logsCh !== (cfg.logs?.channelId || "") ||
    memberEvents !== (cfg.logs?.memberEvents ?? true) ||
    messageEvents !== (cfg.logs?.messageEvents ?? true);

  const handleSave = () => {
    saveMutation.mutate({
      welcome: { enabled: welcomeEnabled, channelId: welcomeCh || null, message: welcomeMsg },
      leave: { enabled: leaveEnabled, channelId: leaveCh || null, message: leaveMsg },
      logs: { enabled: logsEnabled, channelId: logsCh || null, memberEvents, messageEvents },
    });
  };

  const handleReset = () => {
    if (data) {
      setWelcomeEnabled(cfg.welcome?.enabled ?? false);
      setWelcomeCh(cfg.welcome?.channelId || "");
      setWelcomeMsg(cfg.welcome?.message || "");
      setLeaveEnabled(cfg.leave?.enabled ?? false);
      setLeaveCh(cfg.leave?.channelId || "");
      setLeaveMsg(cfg.leave?.message || "");
      setLogsEnabled(cfg.logs?.enabled ?? false);
      setLogsCh(cfg.logs?.channelId || "");
      setMemberEvents(cfg.logs?.memberEvents ?? true);
      setMessageEvents(cfg.logs?.messageEvents ?? true);
      toast("Changes discarded");
    }
  };

  return (
    <div className="space-y-4">
      <SaveBar
        dirty={dirty}
        saving={saveMutation.isPending}
        onSave={handleSave}
        onReset={handleReset}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border/40 bg-card/40">
          <CardHeader className="flex flex-row items-center justify-between">
            <div><CardTitle className="text-sm font-semibold">Welcome Messages</CardTitle><CardDescription className="text-xs">Sent when a member joins</CardDescription></div>
            <Switch checked={welcomeEnabled} onCheckedChange={setWelcomeEnabled} />
          </CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs text-muted-foreground">Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={welcomeCh} onChange={e => setWelcomeCh(e.target.value)}>
                <option value="">— None —</option>
                {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-muted-foreground">Message ({welcomeMsg.length}/1500)</label>
              <Textarea className="mt-1 text-xs font-mono h-20 resize-y" value={welcomeMsg} onChange={e => setWelcomeMsg(e.target.value.slice(0, 1500))} placeholder="Welcome {user} to {server}!" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/40">
          <CardHeader className="flex flex-row items-center justify-between">
            <div><CardTitle className="text-sm font-semibold">Leave Messages</CardTitle><CardDescription className="text-xs">Sent when a member leaves</CardDescription></div>
            <Switch checked={leaveEnabled} onCheckedChange={setLeaveEnabled} />
          </CardHeader>
          <CardContent className="space-y-3">
            <div><label className="text-xs text-muted-foreground">Channel</label>
              <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={leaveCh} onChange={e => setLeaveCh(e.target.value)}>
                <option value="">— None —</option>
                {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            </div>
            <div><label className="text-xs text-muted-foreground">Message ({leaveMsg.length}/1500)</label>
              <Textarea className="mt-1 text-xs font-mono h-20 resize-y" value={leaveMsg} onChange={e => setLeaveMsg(e.target.value.slice(0, 1500))} placeholder="{user} left {server}" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm font-semibold">Audit Logs</CardTitle><CardDescription className="text-xs">Member and message event logging</CardDescription></div>
          <Switch checked={logsEnabled} onCheckedChange={setLogsEnabled} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div><label className="text-xs text-muted-foreground">Log Channel</label>
            <select className="w-full mt-1 bg-background-alt/50 border border-border/40 rounded-lg p-2 text-xs font-mono" value={logsCh} onChange={e => setLogsCh(e.target.value)}>
              <option value="">— None —</option>
              {data.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={memberEvents} onCheckedChange={setMemberEvents} /> Member Events (join/leave)
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={messageEvents} onCheckedChange={setMessageEvents} /> Message Events (edit/delete)
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
