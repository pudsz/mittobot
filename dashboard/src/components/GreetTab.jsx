import { useState, useEffect } from "react";
import { PartyPopper, DoorOpen, FileText, Save, Eye, Palette, Image } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import Panel from "./Panel.jsx";
import ChannelSelect from "./ChannelSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";
import ErrorRetry from "./ErrorRetry.jsx";

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
  const { data, loading, error, refetch } = useGuildData(guildId, "/api/greet");

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
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text greet-skeleton-w60" /></Panel>
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text greet-skeleton-w50" /></Panel>
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text greet-skeleton-w70" /></Panel>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tab active">
        <Panel>
          <ErrorRetry message={error} onRetry={refetch} />
        </Panel>
      </div>
    );
  }

  const channels = data?.channels || [];

  return (
    <div className="tab active">
      <Panel icon={PartyPopper} title="Welcome Message">
        <p className="muted mb-3">
          {data?.hasGuild ? `Editing for: ${data.guildName}` : "Bot isn't in a server yet."}
        </p>
        <div className="muted mb-3">
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
                <Palette className="greet-icon-inline" />
                Embed Color
              </label>
              <div className="row">
                <input
                  type="color"
                  value={welcome.embedColor}
                  onChange={(e) => setWelcome({ ...welcome, embedColor: e.target.value })}
                  className="greet-color-input"
                />
                <code className="greet-color-code">{welcome.embedColor}</code>
              </div>
            </div>
            <div className="field">
              <label>
                <Image className="greet-icon-inline" />
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

        <div className="field"><label>Message</label><textarea className="greet-textarea" value={welcome.message} onChange={(e) => setWelcome({ ...welcome, message: e.target.value })} /></div>

        {/* Live Preview */}
        <div className="greet-preview-btn-wrap">
          <button className="btn secondary text-sm" onClick={() => setShowPreview(!showPreview)}>
            <Eye className="greet-icon-sm" />
            {showPreview ? "Hide Preview" : "Show Preview"}
          </button>
        </div>
        {showPreview && (
          <div className="greet-preview-panel" style={{ borderLeft: `3px solid ${welcome.embedColor}` }}>
            <div className="greet-preview-label">
              💬 Live Preview
            </div>
            {welcome.title && (
              <div className="greet-preview-title">
                {previewText(welcome.title)}
              </div>
            )}
            {welcome.authorName && (
              <div className="greet-preview-author-row">
                <img
                  src="https://cdn.discordapp.com/embed/avatars/0.png"
                  alt=""
                  className="greet-preview-avatar"
                />
                {previewText(welcome.authorName)}
              </div>
            )}
            <div className="greet-preview-message">
              {previewText(welcome.message)}
            </div>
            {welcome.imageUrl && (
              <img
                src={welcome.imageUrl}
                alt="preview"
                className="greet-preview-thumb"
              />
            )}
          </div>
        )}
      </Panel>

      <Panel icon={DoorOpen} title="Leave Message">
        <div className="field"><label>Enabled</label><Toggle checked={leave.enabled} onChange={(v) => setLeave({ ...leave, enabled: v })} /></div>
        <ChannelSelect label="Channel" value={leave.channelId} onChange={(v) => setLeave({ ...leave, channelId: v })} channels={channels} />
        <div className="field"><label>Message</label><textarea className="greet-textarea" value={leave.message} onChange={(e) => setLeave({ ...leave, message: e.target.value })} /></div>
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
