import { useState, useEffect } from "react";
import { PartyPopper, DoorOpen, FileText, Save } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import Panel from "./Panel.jsx";
import ChannelSelect from "./ChannelSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";

export default function GreetTab({ guildId }) {
  const toast = useToast();
  const { data, loading } = useGuildData(guildId, "/api/greet");

  const [welcome, setWelcome] = useState({ enabled: false, channelId: "", message: "" });
  const [leave, setLeave] = useState({ enabled: false, channelId: "", message: "" });
  const [logs, setLogs] = useState({ enabled: false, channelId: "", memberEvents: false, messageEvents: false });

  useEffect(() => {
    if (!data) return;
    const c = data.config || {};
    setWelcome({ enabled: !!c.welcome?.enabled, channelId: c.welcome?.channelId || "", message: c.welcome?.message || "" });
    setLeave({ enabled: !!c.leave?.enabled, channelId: c.leave?.channelId || "", message: c.leave?.message || "" });
    setLogs({
      enabled: !!c.logs?.enabled,
      channelId: c.logs?.channelId || "",
      memberEvents: !!c.logs?.memberEvents,
      messageEvents: !!c.logs?.messageEvents,
    });
  }, [data]);

  async function save() {
    const body = {
      welcome: { enabled: welcome.enabled, channelId: welcome.channelId || null, message: welcome.message },
      leave: { enabled: leave.enabled, channelId: leave.channelId || null, message: leave.message },
      logs: {
        enabled: logs.enabled,
        channelId: logs.channelId || null,
        memberEvents: logs.memberEvents,
        messageEvents: logs.messageEvents,
      },
    };
    try {
      await api("POST", "/api/greet", { guildId, ...body });
      toast("Welcome & logs saved");
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "60%" }} /></Panel>
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "50%" }} /></Panel>
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "70%" }} /></Panel>
      </div>
    );
  }

  const channels = data?.channels || [];

  return (
    <div className="tab active">
      <Panel icon={PartyPopper} title="Welcome Message">
        <p className="muted" style={{ marginBottom: 12 }}>
          {data?.hasGuild ? `Editing for: ${data.guildName}` : "Bot isn't in a server yet."}
        </p>
        <div className="muted" style={{ marginBottom: 12 }}>
          Placeholders: <code>{"{user}"}</code> <code>{"{tag}"}</code> <code>{"{username}"}</code> <code>{"{server}"}</code> <code>{"{count}"}</code>
        </div>
        <div className="field"><label>Enabled</label><div className="row"><Toggle checked={welcome.enabled} onChange={(v) => setWelcome({ ...welcome, enabled: v })} /></div></div>
        <ChannelSelect label="Channel" value={welcome.channelId} onChange={(v) => setWelcome({ ...welcome, channelId: v })} channels={channels} />
        <div className="field"><label>Message</label><textarea style={{ minHeight: 70 }} value={welcome.message} onChange={(e) => setWelcome({ ...welcome, message: e.target.value })} /></div>
      </Panel>
      <Panel icon={DoorOpen} title="Leave Message">
        <div className="field"><label>Enabled</label><div className="row"><Toggle checked={leave.enabled} onChange={(v) => setLeave({ ...leave, enabled: v })} /></div></div>
        <ChannelSelect label="Channel" value={leave.channelId} onChange={(v) => setLeave({ ...leave, channelId: v })} channels={channels} />
        <div className="field"><label>Message</label><textarea style={{ minHeight: 70 }} value={leave.message} onChange={(e) => setLeave({ ...leave, message: e.target.value })} /></div>
      </Panel>
      <Panel icon={FileText} title="Audit Logs">
        <div className="field"><label>Enabled</label><div className="row"><Toggle checked={logs.enabled} onChange={(v) => setLogs({ ...logs, enabled: v })} /></div></div>
        <ChannelSelect label="Log channel" value={logs.channelId} onChange={(v) => setLogs({ ...logs, channelId: v })} channels={channels} />
        <div className="field"><label>Log member joins/leaves</label><div className="row"><Toggle checked={logs.memberEvents} onChange={(v) => setLogs({ ...logs, memberEvents: v })} /></div></div>
        <div className="field"><label>Log message edits/deletes</label><div className="row"><Toggle checked={logs.messageEvents} onChange={(v) => setLogs({ ...logs, messageEvents: v })} /></div></div>
        <button className="btn green" onClick={save}>
          <Save /> <span>Save welcome &amp; log settings</span>
        </button>
      </Panel>
    </div>
  );
}
