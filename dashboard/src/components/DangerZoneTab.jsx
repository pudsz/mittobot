import { useState, useEffect } from "react";
import { Flame, Trash2, Save, Plus, X, Clock, ShieldOff } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";

import Panel from "./Panel.jsx";
import ChannelSelect from "./ChannelSelect.jsx";
import DropdownSelect from "./DropdownSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";
import ErrorRetry from "./ErrorRetry.jsx";

const ACTION_OPTIONS = [
  { value: "kick", label: "👢 Kick", desc: "Kick the user from the server" },
  { value: "ban", label: "🔨 Ban", desc: "Ban the user permanently" },
  { value: "timeout", label: "🔇 Timeout", desc: "Temporarily mute the user" },
];

function formatDuration(ms) {
  if (!ms) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function parseDuration(str) {
  if (!str) return null;
  const m = str.match(/^(\d+)\s*(m|min|h|hr|d|day)s?$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("m")) return n * 60_000;
  if (unit.startsWith("h") || unit.startsWith("hr")) return n * 3600_000;
  if (unit.startsWith("d")) return n * 86400_000;
  return null;
}

const ACTION_COLORS = { kick: { bg: "var(--orange-subtle)", border: "var(--orange)", color: "var(--orange)" }, ban: { bg: "var(--red-subtle)", border: "var(--red)", color: "var(--red)" }, timeout: { bg: "var(--accent-subtle)", border: "var(--accent)", color: "var(--accent-hover)" } };

function ChannelCard({ channelId, cfg, channels, roles, onEdit, onRemove, guildId }) {
  const channelName = channels.find((c) => c.id === channelId)?.name || channelId;
  const ac = ACTION_COLORS[cfg.action] || ACTION_COLORS.kick;

  return (
    <div className="dangerzone-card">
      <div className="dangerzone-card-header">
        <span className="dangerzone-card-name">
          <span className="dangerzone-channel-tag">#{channelName}</span>
        </span>
        <span className="dangerzone-action-badge" style={{ background: ac.bg, border: `1px solid ${ac.border}`, color: ac.color }}>
          {ACTION_OPTIONS.find(a => a.value === cfg.action)?.label || cfg.action}
        </span>
      </div>

      <div className="muted dangerzone-meta">
        {cfg.action === "timeout" && (
          <span className="dangerzone-duration">
            <Clock style={{ width: 12, height: 12 }} /> Duration: {formatDuration(cfg.timeoutMs)}
          </span>
        )}
        {cfg.logChannelId && (
          <span className="dangerzone-log-ref">Log: #{channels.find(c => c.id === cfg.logChannelId)?.name || cfg.logChannelId.slice(0, 8)}</span>
        )}
        {cfg.exemptRoles?.length > 0 && (
          <span className="dangerzone-exempt-block">
            Exempt: {cfg.exemptRoles.map(r => roles.find(ro => ro.id === r)?.name || r.slice(0, 8)).join(", ")}
          </span>
        )}
      </div>

      {cfg.reason && (
        <div className="dangerzone-reason-box">
          {cfg.reason}
        </div>
      )}

      <div className="row">
        <button className="btn sm" onClick={() => onEdit(channelId)}>
          Edit
        </button>
        <button className="btn danger sm" onClick={() => onRemove(channelId)}>
          <Trash2 style={{ width: 12, height: 12 }} /> Remove
        </button>
      </div>
    </div>
  );
}

function ChannelForm({ channelId, initial, channels, roles, onSave, onCancel, saving }) {
  const [selectedChannel, setSelectedChannel] = useState(channelId || "");
  const [action, setAction] = useState(initial?.action || "kick");
  const [durationStr, setDurationStr] = useState(initial?.durationStr || (initial?.timeoutMs ? formatDuration(initial.timeoutMs) : "10m"));
  const [logChannelId, setLogChannelId] = useState(initial?.logChannelId || "");
  const [exemptRoles, setExemptRoles] = useState(() => new Set(initial?.exemptRoles || []));
  const [reason, setReason] = useState(initial?.reason || "");

  // When channel changes via props (editing existing), sync form
  useEffect(() => {
    if (initial) {
      setAction(initial.action || "kick");
      setDurationStr(initial.timeoutMs ? formatDuration(initial.timeoutMs) : "10m");
      setLogChannelId(initial.logChannelId || "");
      setExemptRoles(new Set(initial.exemptRoles || []));
      setReason(initial.reason || "");
    }
  }, [initial]);

  async function handleSave() {
    const chId = channelId || selectedChannel;
    if (!chId) { alert("Select a channel first."); return; }
    let timeoutMs = 5 * 60_000;
    if (action === "timeout") {
      const parsed = parseDuration(durationStr);
      if (!parsed) { alert("Invalid duration. Use format like 10m, 1h, 1d."); return; }
      timeoutMs = parsed;
    }
    onSave(chId, { action, timeoutMs, logChannelId: logChannelId || null, exemptRoles: [...exemptRoles], reason, durationStr });
  }

  function toggleExempt(roleId) {
    setExemptRoles((prev) => {
      const next = new Set(prev);
      next.has(roleId) ? next.delete(roleId) : next.add(roleId);
      return next;
    });
  }

  return (
    <div className="cmd-row open dangerzone-form">
      <div className="cmd-head dangerzone-form-head">
        <span className="cmd-name">
          {channelId ? `Editing #${channels.find(c => c.id === channelId)?.name || channelId}` : "New Dangerzone Channel"}
        </span>
      </div>
      <div className="cmd-body dangerzone-form-body">
        {!channelId && (
          <ChannelSelect label="Channel" value={selectedChannel} onChange={setSelectedChannel} channels={channels} noneLabel="— select a channel —" />
        )}
        <div className="field">
          <label>Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {action === "timeout" && (
          <div className="field">
            <label>Duration (e.g. 10m, 1h, 1d)</label>
            <input value={durationStr} onChange={(e) => setDurationStr(e.target.value)} placeholder="10m" className="dangerzone-input-duration" />
            <div className="hint">Max timeout is 28 days (28d)</div>
          </div>
        )}
        <ChannelSelect label="Log Channel" value={logChannelId} onChange={setLogChannelId} channels={channels} noneLabel="— no log channel —" />
        <div className="field">
          <label>Exempt Roles</label>
          <DropdownSelect items={roles || []} selected={exemptRoles} onToggle={toggleExempt} prefix="@" placeholder="Select exempt roles..." />
        </div>
        <div className="field">
          <label>Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Dangerzone: message sent in monitored channel"
            className="dangerzone-textarea-reason"
          />
          <div className="hint">This reason is shown in the punishment log and audit log.</div>
        </div>
        <div className="row">
          <button className="btn green" onClick={handleSave} disabled={saving}>
            <Save /> {saving ? "Saving..." : "Save"}
          </button>
          <button className="btn" onClick={onCancel}>
            <X /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DangerZoneTab({ guildId }) {
  const toast = useToast();
  const { data, loading, error, refetch } = useGuildData(guildId, "/api/dangerzone");
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const channels = data?.channels || [];
  const roles = data?.roles || [];
  const dzChannels = data?.config?.channels || {};

  async function handleSave(channelId, opts) {
    setSaving(true);
    try {
      await api("POST", "/api/dangerzone", { guildId, channelId, ...opts });
      await refetch();
      setEditingId(null);
      setAdding(false);
      toast("Dangerzone channel saved");
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(channelId) {
    if (!window.confirm(`Remove the dangerzone from #${channels.find(c => c.id === channelId)?.name || channelId}?`)) return;
    try {
      await api("POST", "/api/dangerzone/remove", { guildId, channelId });
      await refetch();
      if (editingId === channelId) setEditingId(null);
      toast("Dangerzone channel removed");
    } catch (e) {
      toast(e.message, true);
    }
  }

  function startEdit(channelId) {
    setEditingId(channelId);
    setAdding(false);
  }

  function startAdd() {
    setAdding(true);
    setEditingId(null);
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel>
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-text dangerzone-skel-text" />
        </Panel>
        <Panel>
          {[1, 2].map((i) => <div className="skeleton skeleton-card dangerzone-skel-card" key={i} />)}
        </Panel>
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

  const entries = Object.entries(dzChannels);

  return (
    <div className="tab active">
      <Panel icon={Flame} title="Dangerzone Channels">
        <p className="muted mb-3">
          {data?.hasGuild
            ? `Trap channels for ${data.guildName} — any non-exempt user who sends a message here gets auto-punished.`
            : "Bot isn't in a server yet."}
        </p>

        {entries.length === 0 && !adding && (
          <div className="muted dangerzone-empty">
            <ShieldOff style={{ width: 32, height: 32, margin: "0 auto 8px", display: "block", opacity: 0.4 }} />
            No dangerzone channels configured yet.
          </div>
        )}

        {entries.map(([chId, cfg]) => (
          editingId === chId ? (
            <ChannelForm
              key={chId}
              channelId={chId}
              initial={{ ...cfg, logChannelId: cfg.logChannelId || "" }}
              channels={channels}
              roles={roles}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          ) : (
            <ChannelCard
              key={chId}
              channelId={chId}
              cfg={cfg}
              channels={channels}
              roles={roles}
              onEdit={startEdit}
              onRemove={handleRemove}
              guildId={guildId}
            />
          )
        ))}

        {adding && (
          <ChannelForm
            channelId={null}
            initial={{ action: "kick", timeoutMs: 300000, logChannelId: "", exemptRoles: [], reason: "" }}
            channels={channels}
            roles={roles}
            onSave={handleSave}
            onCancel={() => setAdding(false)}
            saving={saving}
          />
        )}

        {!adding && (
          <button className="btn green mt-1" onClick={startAdd}>
            <Plus /> Add Dangerzone Channel
          </button>
        )}
      </Panel>
    </div>
  );
}
