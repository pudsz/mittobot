import { useEffect, useState } from "react";
import { Cog, Check, RefreshCcw, Wrench } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";
import Panel from "./Panel.jsx";

export default function SettingsTab({ onReset }) {
  const toast = useToast();
  const [values, setValues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  async function load() {
    try {
      const { settings } = await api("GET", "/api/settings");
      setValues({ ...settings });
    } catch (e) { toast(e.message, true); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function saveSetting(key) {
    setSaving(key);
    try {
      // Booleans are sent as "true"/"false" strings (the API normalises them back)
      const val = values[key];
      await api("POST", "/api/settings", { key, value: typeof val === "boolean" ? String(val) : val });
      toast("Saved " + key);
    } catch (e) { toast(e.message, true); } finally { setSaving(null); }
  }

  async function resetSettings() {
    if (!window.confirm("Reset all settings to defaults?")) return;
    try {
      await api("POST", "/api/settings/reset");
      await load();
      if (onReset) onReset();
      toast("Settings reset");
    } catch (e) { toast(e.message, true); }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel>
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-text" style={{ width: "70%" }} />
          <div className="skeleton skeleton-text" style={{ width: "50%" }} />
          <div style={{ marginTop: 20 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div className="skeleton skeleton-text" style={{ width: "20%", height: 10, marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 40, borderRadius: "var(--radius-sm)" }} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  if (!values) return <div className="tab active" />;

  return (
    <div className="tab active">
      <Panel icon={Cog} title="Bot Settings">
        <div className="card" style={{ marginBottom: 20, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <strong><Wrench style={{ width: 16, height: 16, marginRight: 6 }} />Maintenance Mode</strong>
              <div className="muted" style={{ fontSize: 13 }}>When enabled, all commands and AI responses are blocked. Only bot owners can use the bot.</div>
            </div>
            <Toggle
              checked={values.maintenanceMode === true}
              onChange={(checked) => { setValues({ ...values, maintenanceMode: checked }); setTimeout(() => saveSetting("maintenanceMode"), 0); }}
            />
          </div>
          {(values.maintenanceMode === true) && (
            <div>
              <label style={{ fontSize: 13, marginBottom: 4, display: "block" }}>Custom Maintenance Message</label>
              <div className="row">
                <input
                  value={values.maintenanceMessage || ""}
                  onChange={(e) => setValues({ ...values, maintenanceMessage: e.target.value })}
                  onBlur={() => { if (values.maintenanceMessage !== undefined) saveSetting("maintenanceMessage"); }}
                  placeholder="🔧 The bot is currently under maintenance. Please try again later."
                  style={{ flex: 1 }}
                />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>This message will be shown to users when they try to use commands during maintenance. Auto-saves when you click away.</div>
            </div>
          )}
        </div>

        <div className="muted" style={{ marginBottom: 14 }}>
          Variables for fake-mod messages: <code>{"{user}"}</code> <code>{"{reason}"}</code> <code>{"{channel}"}</code>
        </div>
        <div>
          {Object.entries(values).filter(([k]) => k !== "maintenanceMode" && k !== "maintenanceMessage").map(([key, val]) => (
            <div className="field" key={key}>
              <label>{key}</label>
              <div className="row">
                <input value={String(val)} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
                <button className="btn" onClick={() => saveSetting(key)} disabled={saving === key}><Check />{saving === key ? "Saving..." : "Save"}</button>
              </div>
            </div>
          ))}
        </div>
        <hr />
        <button className="btn danger" onClick={resetSettings}><RefreshCcw /> Reset all to defaults</button>
      </Panel>
    </div>
  );
}
