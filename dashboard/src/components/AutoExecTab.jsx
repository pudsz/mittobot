import { useEffect, useState } from "react";
import { Zap, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import Panel from "./Panel.jsx";
import { guildQuery } from "../utils.js";

const TRIGGER_EVENTS = [
  { id: "warn", label: "On Warn", desc: "When a user is warned" },
  { id: "mute", label: "On Mute", desc: "When a user is muted" },
  { id: "kick", label: "On Kick", desc: "When a user is kicked" },
  { id: "ban", label: "On Ban", desc: "When a user is banned" },
  { id: "join", label: "On Member Join", desc: "When a new member joins" },
  { id: "leave", label: "On Member Leave", desc: "When a member leaves" },
  { id: "message", label: "On Message", desc: "When a message is sent" },
  { id: "reaction_added", label: "On Reaction", desc: "When a reaction is added (emoji filter)" },
];

const ACTION_TYPES = [
  { id: "dm_user", label: "DM User", desc: "Send a direct message to the affected user" },
  { id: "dm_mod", label: "DM Moderator", desc: "Send a DM to the executing moderator" },
  { id: "log_channel", label: "Log to Channel", desc: "Send a message to the configured log channel" },
  { id: "add_role", label: "Add Role", desc: "Assign a role to the user" },
  { id: "remove_role", label: "Remove Role", desc: "Remove a role from the user" },
  { id: "send_channel", label: "Send to Channel", desc: "Send a message + optional role/@everyone ping to a specific channel" },
];

function newEmptyRule() {
  return { trigger_event: "warn", conditions: {}, actions: [{ type: "dm_user", message: "" }], enabled: true, priority: 0, _isNew: true };
}

// Dropdown rows that pair a list of guild channels with bot SendMessages perm
function ChannelSelectField({ guildId, value, onChange, placeholder = "Channel ID" }) {
  // Side-by-side freeform input + dropdown of channels, using the shared api helper
  const [channels, setChannels] = useState([]);
  useEffect(() => {
    if (!guildId) return;
    api("GET", `/api/channels${guildQuery(guildId)}`)
      .then((d) => setChannels((d && d.channels) || []))
      .catch(() => setChannels([]));
  }, [guildId]);
  return (
    <div className="row">
      <input
        className="autoexec-channel-input"
        placeholder={placeholder}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
      <select
        className="flex-1"
        value=""
        onChange={(e) => e.target.value && onChange(e.target.value)}
      >
        <option value="">— pick a text channel —</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>#{c.name}</option>
        ))}
      </select>
    </div>
  );
}

function EmojiConditionField({ value, onChange }) {
  // Comma-separated emoji input — supports unicode ("🟢") or "name:id" for custom.
  const raw = Array.isArray(value) ? value.join(", ") : (value || "");
  return (
    <input
      placeholder="Emoji triggers, comma-separated (e.g. 🟢,✅,👍)"
      value={raw}
      onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
    />
  );
}

export default function AutoExecTab({ guildId }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState([]);
  const [editRule, setEditRule] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { rules: list } = await api("GET", `/api/autoexec${guildQuery(guildId)}`);
      setRules(list || []);
    } catch (e) {
      toast(e.message, true);
      setRules([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [guildId]);

  function startNew() { setEditRule(newEmptyRule()); }

  function startEdit(idx) {
    const rule = rules[idx];
    if (rule) {
      setEditRule({ ...rule, conditions: rule.conditions || {}, actions: (rule.actions || []).map((a) => ({ ...a })), _isNew: false });
    }
  }

  function cancelEdit() { setEditRule(null); }

  function updRule(patch) { setEditRule((prev) => (prev ? { ...prev, ...patch } : prev)); }

  function updAction(idx, patch) {
    setEditRule((prev) => {
      if (!prev) return prev;
      const actions = prev.actions.map((a, i) => (i === idx ? { ...a, ...patch } : a));
      return { ...prev, actions };
    });
  }

  function addAction() { setEditRule((prev) => (prev ? { ...prev, actions: [...prev.actions, { type: "dm_user", message: "" }] } : prev)); }

  function removeAction(idx) { setEditRule((prev) => (prev ? { ...prev, actions: prev.actions.filter((_, i) => i !== idx) } : prev)); }

  async function saveRule() {
    if (!editRule) return;
    if (!editRule.trigger_event) return toast("Select a trigger event", true);
    try {
      await api("POST", "/api/autoexec", {
        guildId, trigger_event: editRule.trigger_event, conditions: editRule.conditions || {},
        actions: editRule.actions || [], enabled: editRule.enabled !== false, priority: editRule.priority || 0,
      });
      toast("Auto-exec rule saved");
      setEditRule(null);
      await load();
    } catch (e) { toast(e.message, true); }
  }

  async function deleteRule(ruleId) {
    if (!window.confirm("Delete this auto-exec rule?")) return;
    try {
      await api("DELETE", `/api/autoexec/${ruleId}`);
      toast("Rule deleted");
      setEditRule(null);
      await load();
    } catch (e) { toast(e.message, true); }
  }

  async function toggleRule(ruleId, enabled) {
    try {
      const existing = (rules || []).find((r) => r.id === ruleId);
      if (existing) {
        await api("POST", "/api/autoexec", { guildId, ...existing, conditions: existing.conditions || {}, actions: existing.actions || [], enabled });
        await load();
      }
    } catch (e) { toast(e.message, true); }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" style={{ width: "70%" }} /></Panel>
        {[1, 2].map((i) => <Panel key={i}><div className="skeleton skeleton-heading" style={{ width: "40%" }} /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "80%" }} /><div className="skeleton" style={{ height: 100, borderRadius: "var(--radius-sm)" }} /></Panel>)}
      </div>
    );
  }

  return (
    <div className="tab active">
      <Panel icon={Zap} title="Auto-Execute Rules">
        <p className="muted autoexec-panel-copy">
          Define trigger → condition → action rules that run automatically when moderation events occur.
          Rules are evaluated in priority order. <strong>Note:</strong> The runtime engine is now active —
          rules will fire when triggered.
        </p>
        <button className="btn green" onClick={startNew}><Plus /> New Rule</button>
      </Panel>

      {!rules?.length && !editRule ? (
        <Panel><div className="muted autoexec-empty-state">No auto-exec rules configured yet. Click "New Rule" to create one.</div></Panel>
      ) : (
        rules?.map((rule, idx) => (
          <Panel compact key={rule.id || idx}>
            <div className="row autoexec-rule-row">
              <Toggle checked={rule.enabled} onChange={(v) => toggleRule(rule.id, v)} />
              <span className="cmd-name autoexec-trigger-name">{TRIGGER_EVENTS.find((e) => e.id === rule.trigger_event)?.label || rule.trigger_event}</span>
              <span className="badge info">#{rule.priority || 0}</span>
              <span className="muted flex-1">{rule.actions?.length || 0} action{(rule.actions?.length || 0) !== 1 ? "s" : ""}</span>
              <button className="btn secondary" onClick={() => startEdit(idx)}>Edit</button>
              <button className="btn danger" onClick={() => deleteRule(rule.id)}><Trash2 /> Delete</button>
            </div>
          </Panel>
        ))
      )}

      {editRule && (
        <Panel>
          <h2>{editRule._isNew ? "New Rule" : "Edit Rule"}</h2>
          <div className="field">
            <label>Trigger Event</label>
            <select value={editRule.trigger_event} onChange={(e) => updRule({ trigger_event: e.target.value })}>
              {TRIGGER_EVENTS.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
            </select>
            <div className="hint">{TRIGGER_EVENTS.find((e) => e.id === editRule.trigger_event)?.desc || ""}</div>
          </div>

          {editRule.trigger_event === "reaction_added" && (
            <div className="field">
              <label>Trigger Emojis</label>
              <EmojiConditionField
                value={editRule.conditions?.emojis}
                onChange={(emojis) => updRule({ conditions: { ...(editRule.conditions || {}), emojis } })}
              />
              <div className="hint">Only fire when the reacted emoji matches one of these. Supports unicode (🟢) or custom ("name:id").</div>
            </div>
          )}
          <div className="field">
            <label>Priority (lower = runs first)</label>
            <input type="number" min="0" max="1000" value={editRule.priority || 0} className="autoexec-priority-input" onChange={(e) => updRule({ priority: parseInt(e.target.value, 10) || 0 })} />
          </div>
          <div className="field">
            <label>Actions (all actions in a rule are executed when triggered)</label>
            {editRule.actions.map((action, idx) => (
              <div key={idx} className="autoexec-action-card mb-2">
                <div className="row mb-2">
                  <select value={action.type} className="flex-1" onChange={(e) => updAction(idx, { type: e.target.value })}>
                    {ACTION_TYPES.map((at) => <option key={at.id} value={at.id}>{at.label}</option>)}
                  </select>
                  <button className="btn danger sm" onClick={() => removeAction(idx)}><Trash2 /> Remove</button>
                </div>
                <div className="hint autoexec-hint-mb">{ACTION_TYPES.find((a) => a.id === action.type)?.desc || ""}</div>
                {(action.type === "dm_user" || action.type === "dm_mod" || action.type === "log_channel") && (
                  <textarea className="autoexec-action-msg" placeholder="Message content (supports {user}, {reason}, {server}, etc.)" value={action.message || ""} onChange={(e) => updAction(idx, { message: e.target.value })} />
                )}
                {(action.type === "add_role" || action.type === "remove_role") && (
                  <input placeholder="Role ID" value={action.roleId || ""} onChange={(e) => updAction(idx, { roleId: e.target.value })} />
                )}
                {action.type === "send_channel" && (
                  <>
                    <div className="hint autoexec-hint-mt">Destination channel + optional ping.</div>
                    <ChannelSelectField
                      guildId={guildId}
                      value={action.channelId}
                      onChange={(channelId) => updAction(idx, { channelId })}
                      placeholder="Destination channel ID"
                    />
                    <input
                      className="autoexec-field-mt"
                      placeholder='Mention: "everyone", "here", or a role ID'
                      value={action.mention || ""}
                      onChange={(e) => updAction(idx, { mention: e.target.value })}
                    />
                    <textarea
                      className="autoexec-channel-msg"
                      placeholder="Message content (supports {user}, {emoji}, {message}, etc.)"
                      value={action.message || ""}
                      onChange={(e) => updAction(idx, { message: e.target.value })}
                    />
                  </>
                )}
              </div>
            ))}
            <button className="btn secondary autoexec-add-action-btn" onClick={addAction}><Plus /> Add Action</button>
          </div>
          <div className="field">
            <label>Enabled</label>
            <Toggle checked={editRule.enabled !== false} onChange={(v) => updRule({ enabled: v })} />
          </div>
          <div className="row autoexec-btn-row-mt">
            <button className="btn green" onClick={saveRule}><Save /> Save Rule</button>
            <button className="btn secondary" onClick={cancelEdit}>Cancel</button>
            {!editRule._isNew && editRule.id && <button className="btn danger" onClick={() => deleteRule(editRule.id)}><Trash2 /> Delete</button>}
          </div>
        </Panel>
      )}
    </div>
  );
}
