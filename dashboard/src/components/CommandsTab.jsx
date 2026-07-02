import { useEffect, useState } from "react";
import { ToggleLeft, SlidersHorizontal } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import DropdownSelect from "./DropdownSelect.jsx";
import Panel from "./Panel.jsx";
import useToggleSet from "../hooks/useToggleSet.js";
import { guildQuery } from "../utils.js";

function commandLabel(prefix, name) {
  return `${prefix || ""}${name}`;
}

function FeatureGrid() {
  const toast = useToast();
  const [features, setFeatures] = useState([]);
  const [prefix, setPrefix] = useState("$");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const { features, prefix } = await api("GET", "/api/features");
      setFeatures(features);
      setPrefix(prefix || "$");
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
          <div className="feature-card feature-card-loading" key={i}>
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
        <div className="feature-card" key={f.id} style={{ "--feature-delay": `${i * 0.06}s` }}>
          <div className="fc-head">
            <span className="fc-name">{f.label}</span>
            <Toggle checked={f.enabled} onChange={(c) => toggleFeature(f.id, c)} />
          </div>
          <div className="fc-desc">{f.description}</div>
          <div className="fc-cmds">
            {(f.commands || []).length
              ? (f.commands || []).map((c) => <code key={c}>{commandLabel(prefix, c)}</code>)
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
  const upd = (i, patch) => setLadder(ladder.map((s) => (s._key === i ? { ...s, ...patch } : s)));
  const del = (i) => setLadder(ladder.filter((s) => s._key !== i));
  return (
    <>
      {ladder.map((step) => (
        <div key={step._key} className="ladder-step">
          <div className="row ladder-step-row">
            <span className="muted ladder-label ladder-label-sm">type:</span>
            <select className="ladder-select ladder-select-type" value={step.type || "count"} onChange={(e) => upd(step._key, { type: e.target.value })}>
              <option value="count">warns</option>
              <option value="points">points</option>
            </select>
            <span className="muted ladder-label">at:</span>
            <input className="ladder-input ladder-input-threshold" type="number" min="1" value={threshold(step)} onChange={(e) => upd(step._key, { threshold: parseInt(e.target.value, 10) || 1 })} />
            <select className="ladder-select ladder-select-action" value={step.action} onChange={(e) => upd(step._key, { action: e.target.value })}>
              {["none", "mute", "kick", "ban", "probation"].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {(step.action !== "probation") && (
              <input className="ladder-input ladder-input-duration" value={step.duration || ""} placeholder="10m" onChange={(e) => upd(step._key, { duration: e.target.value.trim() })} />
            )}
            <button className="btn danger ladder-delete-btn" onClick={() => del(step._key)}>✕</button>
          </div>
          {step.action === "probation" && (
            <div className="row ladder-probation-row">
              <span className="muted ladder-label ladder-label-top">role:</span>
              <div className="ladder-probation-select">
                <DropdownSelect
                  items={roles || []}
                  selected={step.probationRoleId ? new Set([step.probationRoleId]) : new Set()}
                  onToggle={(roleId) => {
                    upd(step._key, { probationRoleId: step.probationRoleId === roleId ? "" : roleId });
                  }}
                  prefix="@"
                  placeholder="Select probation role..."
                />
              </div>
              <span className="muted ladder-label ladder-label-top">duration:</span>
              <input
                className="ladder-input ladder-input-probation"
                value={step.probationDuration || ""}
                placeholder="7d"
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
  const [aliases, setAliases] = useState((cmd.aliases || []).join(", "));
  const [saving, setSaving] = useState(false);
  const [allowed, toggleAllowed] = useToggleSet(c.allowedChannels);
  const [blocked, toggleBlocked] = useToggleSet(c.blockedChannels);
  const [roles, toggleRoles] = useToggleSet(c.allowedRoles);
  const hasLadder = Array.isArray(c.settings && c.settings.ladder);
  const [ladder, setLadder] = useState(hasLadder ? c.settings.ladder.map((s) => ({ ...s, _key: s._key || crypto.randomUUID() })) : null);
  const isReviveMessage = cmd.name === "revivemessage";
  const [includeBots, setIncludeBots] = useState(c.settings?.includeBots === true);

  async function save() {
    setSaving(true);
    const settings = { ...(c.settings || {}) };
    if (ladder) settings.ladder = ladder.filter((s) => (s.threshold ?? s.count) >= 1);
    if (isReviveMessage) settings.includeBots = includeBots;
    const body = {
      enabled, permission,
      cooldown: parseInt(cooldown, 10) || 0,
      aliases: aliases.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean),
      allowedChannels: [...allowed], blockedChannels: [...blocked], allowedRoles: [...roles],
    };
    body.settings = settings;
    try {
      const r = await api("POST", "/api/commands/" + encodeURIComponent(cmd.name), { guildId: data.guildId, ...body });
      onSaved(cmd.name, r.config, r.aliases);
      toast("Saved " + commandLabel(data.prefix, cmd.name));
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    try {
      const r = await api("POST", "/api/commands/" + encodeURIComponent(cmd.name), { guildId: data.guildId, reset: true });
      onSaved(cmd.name, r.config, r.aliases);
      setAliases((r.aliases || []).join(", "));
      setIncludeBots(r.config?.settings?.includeBots === true);
      toast("Reset " + commandLabel(data.prefix, cmd.name));
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
        <input className="command-number-input" type="number" min="0" max="86400" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
      </div>
      <div className="field">
        <label>Aliases</label>
        <input
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="comma or space separated"
        />
        <div className="muted command-help-text">
          Use lowercase letters, numbers, <code>_</code>, or <code>-</code>. Aliases share this command's permissions and cooldown.
        </div>
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
          <div className="muted command-ladder-hint">action: none / mute / kick / ban. Duration (e.g. 10m, 1h, 1d) applies to mute only.</div>
          <LadderEditor ladder={ladder} setLadder={setLadder} roles={data.roles} />
          <button className="btn secondary command-add-step-btn" onClick={() => setLadder([...ladder, { _key: crypto.randomUUID(), type: "count", threshold: ladder.length + 1, action: "mute", duration: "10m" }])}>+ Add step</button>
        </div>
      )}
      {isReviveMessage && (
        <div className="field">
          <label>Include deleted bot messages</label>
          <div className="row"><Toggle checked={includeBots} onChange={setIncludeBots} /></div>
          <div className="muted command-help-text">
            Off keeps revives limited to deleted messages from regular users.
          </div>
        </div>
      )}
      <div className="row command-actions-row">
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

  function onSaved(name, config, aliases) {
    setData((d) => ({
      ...d,
      commands: d.commands.map((c) => (c.name === name ? { ...c, config, aliases: aliases ?? c.aliases } : c)),
    }));
  }

  if (loading) {
    return (
      <div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div className="cmd-row" key={i} style={{ "--command-delay": `${i * 0.04}s` }}>
            <div className="cmd-head command-head-static">
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
      <p className="muted command-list-hint">{hint}</p>
      <div className="row command-search-row">
        <input className="command-search-input" placeholder="Search commands…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div>
        {data.commands.map((cmd) => {
          const aliasText = (cmd.aliases || []).join(" ");
          if (q && !cmd.name.includes(q) && !aliasText.includes(q) && !(cmd.description || "").toLowerCase().includes(q)) return null;
          const c = cmd.config;
          const isOpen = open === cmd.name;
          return (
            <div className={"cmd-row" + (isOpen ? " open" : "")} key={cmd.name}>
              <div className="cmd-head" onClick={() => setOpen(isOpen ? null : cmd.name)}>
                <span className="cmd-name">{commandLabel(data.prefix, cmd.name)}</span>
                {cmd.category && <span className="badge cat">{cmd.category}</span>}
                {(cmd.aliases || []).map((alias) => <span className="badge" key={alias}>{commandLabel(data.prefix, alias)}</span>)}
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
        <p className="muted command-section-copy">
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
