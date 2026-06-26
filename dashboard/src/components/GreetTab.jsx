import { useState, useEffect } from "react";
import { PartyPopper, DoorOpen, FileText, Save, Eye, Palette, Image } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import Panel from "./Panel.jsx";
import ChannelSelect from "./ChannelSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";

// Preview the message with placeholder substitution
function previewText(text) {
  if (!text) return text;
  return text
    .replace(/\{user\}/g, "@NewUser")
    .replace(/\{tag\}/g, "NewUser#1234")
    .replace(/\{username\}/g, "NewUser")
    .replace(/\{server\}/g, "Your Server")
    .replace(/\{count\}/g, "42");
}

export default function GreetTab({ guildId }) {
  const toast = useToast();
  const { data, loading } = useGuildData(guildId, "/api/greet");

  const [welcome, setWelcome] = useState({
    enabled: false, channelId: "", message: "",
    embedColor: "#57f287", imageUrl: "", authorName: "", title: "",
  });
  const [leave, setLeave] = useState({ enabled: false, channelId: "", message: "" });
  const [logs, setLogs] = useState({ enabled: false, channelId: "", memberEvents: false, messageEvents: false });
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!data) return;
    const c = data.config || {};
    setWelcome({
      enabled: !!c.welcome?.enabled,
      channelId: c.welcome?.channelId || "",
      message: c.welcome?.message || "",
      embedColor: c.welcome?.embedColor || "#57f287",
      imageUrl: c.welcome?.imageUrl || "",
      authorName: c.welcome?.authorName || "",
      title: c.welcome?.title || "",
    });
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
      welcome: {
        enabled: welcome.enabled,
        channelId: welcome.channelId || null,
        message: welcome.message,
        embedColor: welcome.embedColor,
        imageUrl: welcome.imageUrl,
        authorName: welcome.authorName,
        title: welcome.title,
      },
      leave: { enabled: leave.enabled, channelId: leave.channelId || null, message: leave.message },
      logs: { enabled: logs.enabled, channelId: logs.channelId || null, memberEvents: logs.memberEvents, messageEvents: logs.messageEvents },
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

        <div className="grid-2">
          <div>
            <div className="field"><label>Enabled</label><Toggle checked={welcome.enabled} onChange={(v) => setWelcome({ ...welcome, enabled: v })} /></div>
            <ChannelSelect label="Channel" value={welcome.channelId} onChange={(v) => setWelcome({ ...welcome, channelId: v })} channels={channels} />
            <div className="field">
              <label>Title (optional)</label>
              <input placeholder="Welcome {user}!" value={welcome.title} onChange={(e) => setWelcome({ ...welcome, title: e.target.value })} />
            </div>
            <div className="field">
              <label>Author name (optional)</label>
              <input placeholder="Your Server Staff" value={welcome.authorName} onChange={(e) => setWelcome({ ...welcome, authorName: e.target.value })} />
            </div>
          </div>
          <div>
            <div className="field">
              <label>
                <Palette style={{ width: 13, height: 13, marginRight: 4, verticalAlign: "middle" }} />
                Embed Color
              </label>
              <div className="row">
                <input
                  type="color"
                  value={welcome.embedColor}
                  onChange={(e) => setWelcome({ ...welcome, embedColor: e.target.value })}
                  style={{ width: 40, height: 32, padding: 2, cursor: "pointer", minWidth: 40 }}
                />
                <code style={{ fontSize: 12 }}>{welcome.embedColor}</code>
              </div>
            </div>
            <div className="field">
              <label>
                <Image style={{ width: 13, height: 13, marginRight: 4, verticalAlign: "middle" }} />
                Thumbnail Image URL (optional)
              </label>
              <input
                placeholder="https://i.imgur.com/xxx.png (leave empty for user avatar)"
                value={welcome.imageUrl}
                onChange={(e) => setWelcome({ ...welcome, imageUrl: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="field"><label>Message</label><textarea style={{ minHeight: 70 }} value={welcome.message} onChange={(e) => setWelcome({ ...welcome, message: e.target.value })} /></div>

        {/* Live Preview */}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={() => setShowPreview(!showPreview)} style={{ fontSize: 12 }}>
            <Eye style={{ width: 14, height: 14 }} />
            {showPreview ? "Hide Preview" : "Show Preview"}
          </button>
        </div>
        {showPreview && (
          <div style={{
            marginTop: 10,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${welcome.embedColor}`,
            borderRadius: "var(--radius-sm)",
            padding: "12px 14px",
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, fontSize: 11, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              💬 Live Preview
            </div>
            {welcome.title && (
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "var(--text)" }}>
                {previewText(welcome.title)}
              </div>
            )}
            {welcome.authorName && (
              <div style={{ fontSize: 12, marginBottom: 6, color: "var(--text-secondary)" }}>
                <img
                  src="https://cdn.discordapp.com/embed/avatars/0.png"
                  alt=""
                  style={{ width: 16, height: 16, borderRadius: "50%", marginRight: 6, verticalAlign: "middle", objectFit: "cover" }}
                />
                {previewText(welcome.authorName)}
              </div>
            )}
            <div style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
              {previewText(welcome.message)}
            </div>
            {welcome.imageUrl && (
              <img
                src={welcome.imageUrl}
                alt="preview"
                style={{ width: 60, height: 60, borderRadius: 4, marginTop: 8, objectFit: "cover", border: "1px solid var(--border)" }}
              />
            )}
          </div>
        )}
      </Panel>

      <Panel icon={DoorOpen} title="Leave Message">
        <div className="field"><label>Enabled</label><Toggle checked={leave.enabled} onChange={(v) => setLeave({ ...leave, enabled: v })} /></div>
        <ChannelSelect label="Channel" value={leave.channelId} onChange={(v) => setLeave({ ...leave, channelId: v })} channels={channels} />
        <div className="field"><label>Message</label><textarea style={{ minHeight: 70 }} value={leave.message} onChange={(e) => setLeave({ ...leave, message: e.target.value })} /></div>
      </Panel>

      <Panel icon={FileText} title="Audit Logs">
        <div className="field"><label>Enabled</label><Toggle checked={logs.enabled} onChange={(v) => setLogs({ ...logs, enabled: v })} /></div>
        <ChannelSelect label="Log channel" value={logs.channelId} onChange={(v) => setLogs({ ...logs, channelId: v })} channels={channels} />
        <div className="field"><label>Log member joins/leaves</label><Toggle checked={logs.memberEvents} onChange={(v) => setLogs({ ...logs, memberEvents: v })} /></div>
        <div className="field"><label>Log message edits/deletes</label><Toggle checked={logs.messageEvents} onChange={(v) => setLogs({ ...logs, messageEvents: v })} /></div>
        <button className="btn green" onClick={save}>
          <Save /> <span>Save welcome &amp; log settings</span>
        </button>
      </Panel>
    </div>
  );
}
