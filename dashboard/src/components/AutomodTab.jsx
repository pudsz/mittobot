import { useState, useEffect } from "react";
import { ShieldCheck, ListTodo, Save } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import Panel from "./Panel.jsx";
import ChannelSelect from "./ChannelSelect.jsx";
import DropdownSelect from "./DropdownSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";
import useToggleSet from "../hooks/useToggleSet.js";

const AM_RULE_META = {
  invites: { label: "Anti-Invite", desc: "Delete Discord invite links.", fields: [] },
  bannedWords: { label: "Banned Words", desc: "Delete messages containing blocked words.", fields: [{ key: "words", type: "csv", label: "Words (comma separated)" }] },
  spam: { label: "Anti-Spam", desc: "Act when a user sends too many messages too fast.", fields: [{ key: "maxMessages", type: "num", label: "Max messages" }, { key: "perSeconds", type: "num", label: "Per seconds" }] },
  massMention: { label: "Mass Mention", desc: "Act on messages mentioning many users.", fields: [{ key: "maxMentions", type: "num", label: "Max mentions" }] },
  caps: { label: "Excessive Caps", desc: "Act on messages that are mostly uppercase.", fields: [{ key: "minLength", type: "num", label: "Min length" }, { key: "percent", type: "num", label: "Caps %" }] },
};
const AM_ACTIONS = ["delete", "warn", "mute"];

export default function AutomodTab({ guildId }) {
  const toast = useToast();
  const { data, loading } = useGuildData(guildId, "/api/automod");

  const [enabled, setEnabled] = useState(false);
  const [logChannelId, setLogChannelId] = useState("");
  const [ignoredChannels, toggleIgnoredChannels, setIgnoredChannels] = useToggleSet();
  const [ignoredRoles, toggleIgnoredRoles, setIgnoredRoles] = useToggleSet();
  const [rules, setRules] = useState({});

  // Sync local state from fetched config on guild change
  useEffect(() => {
    if (!data) return;
    const c = data.config || {};
    setEnabled(!!c.enabled);
    setLogChannelId(c.logChannelId || "");
    setIgnoredChannels(new Set(c.ignoredChannels || []));
    setIgnoredRoles(new Set(c.ignoredRoles || []));
    setRules(c.rules || {});
  }, [data, setIgnoredChannels, setIgnoredRoles]);

  const updRule = (key, patch) =>
    setRules((r) => ({ ...r, [key]: { ...(r[key] || {}), ...patch } }));

  async function save() {
    const outRules = {};
    for (const [key, meta] of Object.entries(AM_RULE_META)) {
      const r = rules[key] || {};
      const rule = { enabled: !!r.enabled, action: r.action || "delete" };
      for (const f of meta.fields) {
        if (f.type === "num") rule[f.key] = parseInt(r[f.key], 10) || 0;
        else if (f.type === "csv") {
          rule[f.key] = Array.isArray(r[f.key])
            ? r[f.key]
            : String(r[f.key] || "").split(",").map((s) => s.trim()).filter(Boolean);
        }
      }
      outRules[key] = rule;
    }
    const body = {
      enabled,
      logChannelId: logChannelId || null,
      ignoredChannels: [...ignoredChannels],
      ignoredRoles: [...ignoredRoles],
      rules: outRules,
    };
    try {
      await api("POST", "/api/automod", { guildId, ...body });
      toast("Automod saved");
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "70%" }} /></Panel>
        <Panel>{[1, 2, 3].map((i) => <div className="skeleton skeleton-card" key={i} style={{ height: 60, marginBottom: 8 }} />)}</Panel>
      </div>
    );
  }

  return (
    <div className="tab active">
      <Panel icon={ShieldCheck} title="Automod">
        <p className="muted" style={{ marginBottom: 14 }}>
          {data?.hasGuild ? `Editing automod for: ${data.guildName}` : "Bot isn't in a server yet."}
        </p>
        <div className="field">
          <label>Master switch</label>
          <div className="row">
            <Toggle checked={enabled} onChange={setEnabled} />
            <span className="muted">Enable automod for this server</span>
          </div>
        </div>
        <ChannelSelect
          label="Log channel"
          value={logChannelId}
          onChange={setLogChannelId}
          channels={data?.channels || []}
        />
        <div className="field">
          <label>Ignored channels (automod skips these)</label>
          <DropdownSelect items={data?.channels || []} selected={ignoredChannels} onToggle={toggleIgnoredChannels} prefix="#" placeholder="Select ignored channels..." />
        </div>
        <div className="field">
          <label>Ignored roles</label>
          <DropdownSelect items={data?.roles || []} selected={ignoredRoles} onToggle={toggleIgnoredRoles} prefix="@" placeholder="Select ignored roles..." />
        </div>
      </Panel>
      <Panel icon={ListTodo} title="Rules">
        <div>
          {Object.entries(AM_RULE_META).map(([key, meta]) => {
            const r = rules[key] || {};
            return (
              <div className="cmd-row open" key={key}>
                <div className="cmd-head" style={{ cursor: "default" }}>
                  <Toggle checked={r.enabled} onChange={(c) => updRule(key, { enabled: c })} />
                  <span className="cmd-name" style={{ marginLeft: 10 }}>{meta.label}</span>
                  <span className="cmd-desc">{meta.desc}</span>
                </div>
                <div className="cmd-body" style={{ display: "block" }}>
                  <div className="field">
                    <label>Action</label>
                    <select value={r.action || "delete"} onChange={(e) => updRule(key, { action: e.target.value })}>
                      {AM_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {meta.fields.map((f) => {
                    const val = f.type === "csv"
                      ? (Array.isArray(r[f.key]) ? r[f.key].join(", ") : (r[f.key] || ""))
                      : (r[f.key] ?? "");
                    return (
                      <div className="field" key={f.key}>
                        <label>{f.label}</label>
                        <input
                          value={val}
                          type={f.type === "num" ? "number" : "text"}
                          style={f.type === "num" ? { width: 120 } : undefined}
                          onChange={(e) =>
                            updRule(key, {
                              [f.key]: f.type === "csv"
                                ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                                : e.target.value,
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <button className="btn green" onClick={save} style={{ marginTop: 8 }}>
          <Save /> <span>Save automod settings</span>
        </button>
      </Panel>
    </div>
  );
}
