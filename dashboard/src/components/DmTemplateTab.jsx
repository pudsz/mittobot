import { useEffect, useState } from "react";
import { FileText, Save, RotateCw, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import Panel from "./Panel.jsx";
import { guildQuery } from "../utils.js";

const DM_TEMPLATE_ACTIONS = [
  { id: "warn", label: "Warn", desc: "Sent when a user is warned" },
  { id: "mute", label: "Mute", desc: "Sent when a user is timed out" },
  { id: "kick", label: "Kick", desc: "Sent when a user is kicked" },
  { id: "ban", label: "Ban", desc: "Sent when a user is banned" },
  { id: "unmute", label: "Unmute", desc: "Sent when a user is unmuted" },
  { id: "unban", label: "Unban", desc: "Sent when a user is unbanned" },
];

const DEFAULT_TEMPLATES = {
  warn:   "⚠️ You've been warned in **{server}**. Reason: {reason}",
  mute:   "🔇 You've been muted in **{server}** for {duration}. Reason: {reason}",
  kick:   "👢 You've been kicked from **{server}**. Reason: {reason}",
  ban:    "🔨 You've been banned from **{server}**. Reason: {reason}",
  unmute: "🔊 You've been unmuted in **{server}**.",
  unban:  "You've been unbanned from **{server}**.",
};

const PLACEHOLDER_TIPS = [
  ["{user}", "User mention"], ["{username}", "Username"], ["{server}", "Server name"],
  ["{reason}", "Punishment reason"], ["{duration}", "Duration (for mutes)"], ["{mod}", "Moderator name"],
];

export default function DmTemplateTab({ guildId }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState({});
  const [saving, setSaving] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { templates: tmpls } = await api("GET", `/api/dm-templates${guildQuery(guildId)}`);
      setTemplates(tmpls || {});
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [guildId]);

  function getTemplate(action) {
    return templates[action] || { message: DEFAULT_TEMPLATES[action] || "", enabled: true };
  }

  function updTemplate(action, patch) {
    setTemplates((prev) => ({
      ...prev,
      [action]: { ...(prev[action] || { message: DEFAULT_TEMPLATES[action] || "", enabled: true }), ...patch },
    }));
  }

  async function saveTemplate(action) {
    setSaving(action);
    try {
      const tpl = getTemplate(action);
      await api("POST", "/api/dm-templates", { guildId, action, message: tpl.message, enabled: tpl.enabled });
      toast(`Saved ${action} template`);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(null);
    }
  }

  async function resetTemplate(action) {
    updTemplate(action, { message: DEFAULT_TEMPLATES[action] || "", enabled: true });
    try {
      await api("POST", "/api/dm-templates", { guildId, action, message: DEFAULT_TEMPLATES[action] || "", enabled: true });
      toast(`Reset ${action} template to default`);
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" style={{ width: "70%" }} /></Panel>
        {[1, 2, 3].map((i) => <Panel key={i}><div className="skeleton skeleton-heading" style={{ width: "25%" }} /><div className="skeleton skeleton-text" /><div className="skeleton" style={{ height: 100, borderRadius: "var(--radius-sm)" }} /></Panel>)}
      </div>
    );
  }

  return (
    <div className="tab active">
      <Panel icon={FileText} title="DM Notification Templates">
        <p className="muted" style={{ marginBottom: 14 }}>
          Customize the direct messages users receive when they are warned, muted, kicked, or banned.
          Leave messages empty to send no DM. DM failures (e.g. user has DMs closed) are silently ignored.
        </p>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Available placeholders</label>
          <div className="row gap-4">
            {PLACEHOLDER_TIPS.map(([ph, desc]) => <code key={ph} title={desc} style={{ cursor: "help" }}>{ph}</code>)}
          </div>
        </div>
        <button className="btn secondary" onClick={load}><RefreshCw /> Refresh</button>
      </Panel>

      {DM_TEMPLATE_ACTIONS.map(({ id, label, desc }) => {
        const tpl = getTemplate(id);
        return (
          <Panel key={id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <h2 style={{ margin: 0, flex: 1 }}>{label}</h2>
              <Toggle checked={tpl.enabled} onChange={(v) => updTemplate(id, { enabled: v })} />
              <span className="muted" style={{ fontSize: 12 }}>enabled</span>
            </div>
            <p className="muted" style={{ marginBottom: 10 }}>{desc}</p>
            <div className="field">
              <label>DM Message</label>
              <textarea style={{ minHeight: 80 }} placeholder={DEFAULT_TEMPLATES[id] || ""} value={tpl.message || ""} onChange={(e) => updTemplate(id, { message: e.target.value })} />
              <div className="hint">Leave empty to disable DM for this action. Supports Discord markdown.</div>
            </div>
            <div className="row">
              <button className="btn green" onClick={() => saveTemplate(id)} disabled={saving === id}><Save /> {saving === id ? "Saving..." : "Save"}</button>
              <button className="btn secondary" onClick={() => resetTemplate(id)}><RotateCw /> Reset to default</button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
