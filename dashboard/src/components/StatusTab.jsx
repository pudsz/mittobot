import { useEffect, useRef, useState } from "react";
import { Cpu, Tv, Save, Activity, Server, Users, Clock, HardDrive, MessageSquare, Zap, Gauge } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";

const ICONS = { activity: Activity, server: Server, users: Users, clock: Clock, memory: HardDrive, ai: MessageSquare, cmd: Zap };

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
    const mins = Math.floor((status.uptimeMs || 0) / 60000);
    const upH = Math.floor(mins / 60);
    const upM = mins % 60;
    const uptimeStr = upH > 0 ? `${upH}h ${upM}m` : `${upM}m`;

    // Memory usage (estimate from the API)
    const memUsed = status.memoryUsedMb || 0;
    const memTotal = status.memoryTotalMb || 512;
    const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

    stats = [
      ["WS Ping", (status.ping || 0) + "ms", "activity", null, status.ping < 100 ? "var(--green)" : status.ping < 200 ? "var(--orange)" : "var(--red)"],
      ["Guilds", status.guilds || 0, "server", null, null],
      ["Users", (status.users || 0).toLocaleString(), "users", null, null],
      ["Uptime", uptimeStr, "clock", null, null],
      ["Memory", `${memUsed} MB / ${memTotal} MB`, "memory", memPct, memPct > 80 ? "var(--red)" : "var(--accent)"],
      ["AI Active", (status.activeAiConversations || 0).toLocaleString(), "ai", null, null],
      ["Cmd Rate", (status.commandsPerMin || 0) + "/min", "cmd", null, null],
    ];
  }

  return (
    <div className="tab active">
      <Panel icon={Cpu} title="Live Status">
        {!status ? (
          <div className="stat-grid">
            {[1, 2, 3, 4].map((i) => (
              <div className="stat" key={i}>
                <div className="skeleton skeleton-stat status-skeleton" />
              </div>
            ))}
          </div>
        ) : (
          <div className="stat-grid">
            {stats.map(([l, n, icon, pct, color]) => {
              const I = ICONS[icon];
              return (
                <div className="stat" key={l}>
                  <div className="stat-head">
                    <div className="lbl">{l}</div>
                    <I className="stat-icon" />
                  </div>
                  <div className="num" style={color ? { color } : {}}>{n}</div>
                  {pct != null && (
                    <div className="stat-meter-wrap">
                      <div className="stat-meter">
                        <div className="stat-meter-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color || "var(--accent)" }} />
                      </div>
                      <div className="stat-meter-label">{pct}% used</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      {admin && status && (
        <Panel icon={Gauge} title="Process Health">
          <div className="process-health-grid">
            {/* CPU Load */}
            <div className="process-card">
              <div className="process-card-title">
                CPU Load Average
              </div>
              <div className="process-stat-grid">
                {[
                  { label: "1m", value: status.cpuLoad?.load1 },
                  { label: "5m", value: status.cpuLoad?.load5 },
                  { label: "15m", value: status.cpuLoad?.load15 },
                ].map(({ label, value }) => {
                  const loadPct = status.cpuLoad?.cpuCount
                    ? Math.round((Math.min(value ?? 0, status.cpuLoad.cpuCount) / status.cpuLoad.cpuCount) * 100)
                    : 0;
                  const color = loadPct > 80 ? "var(--red)" : loadPct > 50 ? "var(--orange)" : "var(--green)";
                  return (
                    <div key={label} className="process-stat-block">
                      <div className="process-stat-value" style={{ color }}>{value?.toFixed(1) ?? "—"}</div>
                      <div className="process-stat-label">{label}</div>
                      <div className="process-stat-meter">
                        <div className="process-stat-meter-fill" style={{ width: `${loadPct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="process-card-meta">
                {status.cpuLoad?.cpuCount ?? "?"} logical cores
              </div>
            </div>
            {/* Process Uptime */}
            <div className="process-card">
              <div className="process-card-title">
                Process Uptime
              </div>
              <div className="process-stat-value">
                {(() => {
                  const sec = status.processUptimeSec ?? 0;
                  const d = Math.floor(sec / 86400);
                  const h = Math.floor((sec % 86400) / 3600);
                  const m = Math.floor((sec % 3600) / 60);
                  if (d > 0) return `${d}d ${h}h ${m}m`;
                  if (h > 0) return `${h}h ${m}m`;
                  return `${m}m ${sec % 60}s`;
                })()}
              </div>
              <div className="process-card-meta">
                Since last restart
              </div>
            </div>
            {/* Node.js Process Info */}
            <div className="process-card">
              <div className="process-card-title">
                Node.js Runtime
              </div>
              <div className="process-runtime-list">
                <div>Version: <code className="process-runtime-code">{status.nodeRuntime?.version || "?"}</code></div>
                <div>Platform: <code className="process-runtime-code">{status.nodeRuntime?.platform} {status.nodeRuntime?.arch}</code></div>
                <div>PID: <code className="process-runtime-code">{status.nodeRuntime?.pid}</code></div>
              </div>
            </div>
          </div>
        </Panel>
      )}
      {admin && (
        <Panel icon={Tv} title="Presence">
          <div className="field">
            <label>Activity Text</label>
            <div className="row">
              <input
                placeholder={`${status?.prefix || "$"}help | mambo`}
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
