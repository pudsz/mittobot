import { useEffect, useRef, useState } from "react";
import { Cpu, Tv, Save, Activity, Server, Users, Clock } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";

const ICONS = { activity: Activity, server: Server, users: Users, clock: Clock };

export default function StatusTab({ onStatus, admin }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [presText, setPresText] = useState("");
  const [presType, setPresType] = useState("3");
  const [saving, setSaving] = useState(false);
  const presFocused = useRef(false);

  async function refreshStatus() {
    try {
      const s = await api("GET", "/api/status");
      setStatus(s);
      if (onStatus) onStatus(s);
      if (s.activity && !presFocused.current) {
        setPresText(s.activity.name || "");
        setPresType(String(s.activity.type ?? 3));
      }
    } catch { /* ignore polling errors */ }
  }

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 5000);
    return () => clearInterval(t);
  }, []);

  async function setPresence() {
    setSaving(true);
    try {
      await api("POST", "/api/presence", { text: presText, type: parseInt(presType, 10) });
      toast("Presence updated");
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(false);
    }
  }

  let stats = [];
  if (status) {
    const mins = Math.floor(status.uptimeMs / 60000);
    const up = mins < 60 ? mins + "m" : Math.floor(mins / 60) + "h " + (mins % 60) + "m";
    stats = [
      ["WS Ping", status.ping + "ms", "activity"],
      ["Guilds", status.guilds, "server"],
      ["Users", (status.users || 0).toLocaleString(), "users"],
      ["Uptime", up, "clock"],
    ];
  }

  return (
    <div className="tab active">
      <Panel icon={Cpu} title="Live Status">
        {!status ? (
          <div className="stat-grid">
            {[1, 2, 3, 4].map((i) => (
              <div className="stat" key={i}>
                <div className="skeleton skeleton-stat" style={{ height: 80, margin: 0 }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="stat-grid">
            {stats.map(([l, n, icon]) => {
              const I = ICONS[icon];
              return (
                <div className="stat" key={l}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="lbl">{l}</div>
                    <I className="stat-icon" />
                  </div>
                  <div className="num">{n}</div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      {admin && (
        <Panel icon={Tv} title="Presence">
          <div className="field">
            <label>Activity Text</label>
            <div className="row">
              <input
                placeholder="$help | mambo"
                value={presText}
                onChange={(e) => setPresText(e.target.value)}
                onFocus={() => (presFocused.current = true)}
                onBlur={() => (presFocused.current = false)}
              />
              <select value={presType} onChange={(e) => setPresType(e.target.value)}>
                <option value="0">Playing</option>
                <option value="1">Streaming</option>
                <option value="2">Listening</option>
                <option value="3">Watching</option>
                <option value="5">Competing</option>
              </select>
              <button className="btn" onClick={setPresence} disabled={saving}>
                <Save className={saving ? "spinning" : ""} /> {saving ? "Saving..." : "Set Presence"}
              </button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
