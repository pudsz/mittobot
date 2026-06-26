import { useEffect, useState } from "react";
import { ToggleLeft, SlidersHorizontal } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import DropdownSelect from "./DropdownSelect.jsx";
import Panel from "./Panel.jsx";
import useToggleSet from "../hooks/useToggleSet.js";
import { guildQuery } from "../utils.js";

function FeatureGrid() {
  const toast = useToast();
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const { features } = await api("GET", "/api/features");
      setFeatures(features);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function toggleFeature(id, enabled) {
    setFeatures((fs) => fs.map((f) => (f.id === id ? { ...f, enabled } : f)));
    try {
      await api("POST", "/api/features", { id, enabled });
      toast((enabled ? "Enabled " : "Disabled ") + id);
    } catch (e) {
      toast(e.message, true);
      load();
    }
  }

  if (loading) {
    return (
      <div className="feature-grid">
        {[1, 2, 3].map((i) => (
          <div className="feature-card" key={i} style={{ border: "1px solid var(--border)" }}>
            <div className="skeleton skeleton-heading" style={{ width: "60%" }} />
            <div className="skeleton skeleton-text" />
            <div className="skeleton skeleton-text" style={{ width: "80%" }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="feature-grid">
      {features.map((f, i) => (
        <div className="feature-card" key={f.id} style={{ animationDelay: `${i * 0.06}s` }}>
          <div className="fc-head">
            <span className="fc-name">{f.label}</span>
            <Toggle checked={f.enabled} onChange={(c) => toggleFeature(f.id, c)} />
          </div>
          <div className="fc-desc">{f.description}</div>
          <div className="fc-cmds">
            {(f.commands || []).length
              ? (f.commands || []).map((c) => <code key={c}>${c}</code>)
              : <span className="muted">no commands</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function LadderEditor({ ladder, setLadder, roles }) {
  if (!ladder.length) {
    return <span className="muted">No steps — warnings won't auto-escalate.</span>;
  }
  const threshold = (s) => s.threshold ?? s.count ?? 1;
  const upd = (i, patch) => setLadder(ladder.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const del = (i) => setLadder(ladder.filter((_, j) => j !== i));
  return (
    <>
      {ladder.map((step, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="muted" style={{ width: 48, fontSize: 12 }}>type:</span>
            <select value={step.type || "count"} style={{ width: 100 }} onChange={(e) => upd(i, { type: e.target.value })}>
              <option value="count">warns</option>
              <option value="points">points</option>
            </select>
            <span className="muted" style={{ width: 52, fontSize: 12 }}>at:</span>
            <input type="number" min="1" value={threshold(step)} style={{ width: 70 }} onChange={(e) => upd(i, { threshold: parseInt(e.target.value, 10) || 1 })} />
            <select value={step.action} style={{ width: 110 }} onChange={(e) => upd(i, { action: e.target.value })}>
              {["none", "mute", "kick", "ban", "probation"].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {(step.action !== "probation") && (
              <input value={step.duration || ""} placeholder="10m" style={{ width: 80 }} onChange={(e) => upd(i, { duration: e.target.value.trim() })} />
            )}
            <button className="btn danger" onClick={() => del(i)} style={{ padding: "6px 10px" }}>✕</button>
          </div>
          {step.action === "probation" && (
            <div className="row" style={{ marginLeft: 0, alignItems: "flex-start" }}>
              <span className="muted" style={{ fontSize: 11, width: 48, marginTop: 6, flexShrink: 0 }}>role:</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <DropdownSelect
                  items={roles || []}
                  selected={step.probationRoleId ? new Set([step.probationRoleId]) : new Set()}
                  onToggle={(roleId) => {
                    upd(i, { probationRoleId: step.probationRoleId === roleId ? "" : roleId });
                  }}
                  prefix="@"
                  placeholder="Select probation role..."
                />
              </div>
              <span className="muted" style={{ fontSize: 11, marginTop: 6, flexShrink: 0 }}>duration:</span>
              <input
                value={step.probationDuration || ""}
                placeholder="7d"
                style={{ width: 80, fontSize: 12 }}
                onChange={(e) => upd(i, { probationDuration: e.target.value.trim() })}
              />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function CommandBody({ cmd, data, onSaved }) {
  const toast = useToast();
  const c = cmd.config;
  const [enabled, setEnabled] = useState(c.enabled);
  const [permission, setPermission] = useState(c.permission);
  const [cooldown, setCooldown] = useState(c.cooldown || 0);
  const [saving, setSaving] = useState(false);
  const [allowed, toggleAllowed] = useToggleSet(c.allowedChannels);
  const [blocked, toggleBlocked] = useToggleSet(c.blockedChannels);
  const [roles, toggleRoles] = useToggleSet(c.allowedRoles);
  const hasLadder = Array.isArray(c.settings && c.settings.ladder);
  const [ladder, setLadder] = useState(hasLadder ? c.settings.ladder.map((s) => ({ ...s })) : null);

  async function save() {
    setSaving(true);
    const body = {
      enabled, permission,
      cooldown: parseInt(cooldown, 10) || 0,
      allowedChannels: [...allowed], blockedChannels: [...blocked], allowedRoles: [...roles],
    };
    if (ladder) body.settings = { ladder: ladder.filter((s) => (s.threshold ?? s.count) >= 1) };
    try {
      const r = await api("POST", "/api/commands/" + encodeURIComponent(cmd.name), { guildId: data.guildId, ...body });
      onSaved(cmd.name, r.config);
      toast("Saved $" + cmd.name);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    try {
      const r = await api("POST", "/api/commands/" + encodeURIComponent(cmd.name), { guildId: data.guildId, reset: true });
      onSaved(cmd.name, r.config);
      toast("Reset $" + cmd.name);
    } catch (e) {
      toast(e.message, true);
    }
  }

  return (
    <div className="cmd-body">
      <div className="field">
        <label>Enabled</label>
        <div className="row"><Toggle checked={enabled} onChange={setEnabled} /></div>
      </div>
      <div className="field">
        <label>Permission level</label>
        <select value={permission} onChange={(e) => setPermission(e.target.value)}>
          {data.permLevels.map((p) => <option key={p} value={p}>{data.permLabels[p] || p}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Cooldown (seconds, per user — 0 = none)</label>
        <input type="number" min="0" max="86400" value={cooldown} style={{ width: 120 }} onChange={(e) => setCooldown(e.target.value)} />
      </div>
      <div className="field">
        <label>Allowed channels (none = all)</label>
        <DropdownSelect items={data.channels} selected={allowed} onToggle={toggleAllowed} prefix="#" placeholder="Select allowed channels..." />
      </div>
      <div className="field">
        <label>Blocked channels</label>
        <DropdownSelect items={data.channels} selected={blocked} onToggle={toggleBlocked} prefix="#" variant="block" placeholder="Select blocked channels..." />
      </div>
      <div className="field">
        <label>Extra allowed roles (bypass permission level)</label>
        <DropdownSelect items={data.roles} selected={roles} onToggle={toggleRoles} prefix="@" placeholder="Select allowed roles..." />
      </div>
      {ladder && (
        <div className="field">
          <label>Warn escalation ladder — auto-punish at each warning count</label>
          <div className="muted" style={{ marginBottom: 8 }}>action: none / mute / kick / ban. Duration (e.g. 10m, 1h, 1d) applies to mute only.</div>
          <LadderEditor ladder={ladder} setLadder={setLadder} roles={data.roles} />
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setLadder([...ladder, { type: "count", threshold: ladder.length + 1, action: "mute", duration: "10m" }])}>+ Add step</button>
        </div>
      )}
      <div className="row" style={{ marginTop: 15 }}>
        <button className="btn green" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</button>
        <button className="btn secondary" onClick={reset}>Reset to Defaults</button>
      </div>
    </div>
  );
}

function CommandList({ guildId }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);

  async function load() {
    try {
      setData(await api("GET", "/api/commands" + guildQuery(guildId)));
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [guildId]);

  function onSaved(name, config) {
    setData((d) => ({ ...d, commands: d.commands.map((c) => (c.name === name ? { ...c, config } : c)) }));
  }

  if (loading) {
    return (
      <div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div className="cmd-row" key={i} style={{ animationDelay: `${i * 0.04}s` }}>
            <div className="cmd-head" style={{ cursor: "default" }}>
              <div className="skeleton skeleton-text" style={{ width: 100, margin: 0 }} />
              <div className="skeleton skeleton-text" style={{ width: "40%", margin: 0 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const q = query.toLowerCase();
  const hint = data?.hasGuild ? `Editing config for: ${data.guildName}` : "Bot isn't in a server yet — config will apply once it joins one.";

  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>{hint}</p>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="Search commands…" style={{ flex: 1, minWidth: 200 }} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div>
        {data.commands.map((cmd) => {
          if (q && !cmd.name.includes(q) && !(cmd.description || "").toLowerCase().includes(q)) return null;
          const c = cmd.config;
          const isOpen = open === cmd.name;
          return (
            <div className={"cmd-row" + (isOpen ? " open" : "")} key={cmd.name}>
              <div className="cmd-head" onClick={() => setOpen(isOpen ? null : cmd.name)}>
                <span className="cmd-name">${cmd.name}</span>
                {cmd.category && <span className="badge cat">{cmd.category}</span>}
                {!c.enabled && <span className="badge off">disabled</span>}
                <span className="cmd-desc">{cmd.description || ""}</span>
                <span className="badge">{data.permLabels[c.permission] || c.permission}</span>
              </div>
              {isOpen && <CommandBody cmd={cmd} data={data} onSaved={onSaved} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function CommandsTab({ guildId }) {
  return (
    <div className="tab active">
      <Panel icon={ToggleLeft} title="Command Categories">
        <p className="muted" style={{ marginBottom: 16 }}>
          Toggle whole command groups on or off. Disabled commands stop responding in Discord. Core
          utility &amp; real-moderation commands are always active.
        </p>
        <FeatureGrid />
      </Panel>
      <Panel icon={SlidersHorizontal} title="Per-Command Settings">
        <CommandList guildId={guildId} />
      </Panel>
    </div>
  );
}
