import { useEffect, useState, useCallback } from "react";
import { FlaskConical, Users, Radio, Plus, RotateCw, Trash2, Check, X, Search } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";

export default function ExperimentsTab() {
  const toast = useToast();
  const [codes, setCodes] = useState([]);
  const [users, setUsers] = useState([]);
  const [telemetry, setTelemetry] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSuccess, setFilterSuccess] = useState("");
  const [filterUserId, setFilterUserId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, uRes, tRes] = await Promise.all([
        api("GET", "/api/alpha/codes").catch(() => ({ codes: [] })),
        api("GET", "/api/alpha/users").catch(() => ({ users: [] })),
        api("GET", "/api/alpha/telemetry").catch(() => ({ entries: [] })),
      ]);
      setCodes(cRes.codes || []);
      setUsers(uRes.users || []);
      setTelemetry(tRes.entries || []);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generateCode() {
    try {
      const { code } = await api("POST", "/api/alpha/generate");
      toast(`Generated code: ${code}`);
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function toggleTelemetry(userId, guildId, currentVal) {
    try {
      await api("POST", `/api/alpha/users/${userId}/toggle-telemetry`, { guildId });
      toast("Telemetry preference updated");
      load();
    } catch (e) { toast(e.message, true); }
  }

  async function purgeTelemetry() {
    if (!confirm("Purge all telemetry entries? This cannot be undone.")) return;
    try {
      await api("DELETE", "/api/alpha/telemetry");
      toast("Telemetry purged");
      load();
    } catch (e) { toast(e.message, true); }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton exper-skel-block" /></Panel>
      </div>
    );
  }

  return (
    <div className="tab active">

      {/* ── Codes Panel ── */}
      <Panel icon={FlaskConical} title="Alpha Codes">
        <div className="row exper-mb-14">
          <button className="btn primary" onClick={generateCode}><Plus /> Generate Code</button>
          <button className="btn secondary" onClick={load}><RotateCw /> Refresh</button>
        </div>
        <table>
          <thead><tr><th>Code</th><th>Created By</th><th>Created</th><th>Used By</th><th>Used At</th></tr></thead>
          <tbody>
            {codes.length === 0 ? (
              <tr><td colSpan={5} className="exper-empty-cell">No codes generated yet.</td></tr>
            ) : codes.map((c) => (
              <tr key={c.code}>
                <td><code>{c.code}</code></td>
                <td>{c.created_by}</td>
                <td>{new Date(c.created_at).toLocaleString()}</td>
                <td>{c.used_by || "—"}</td>
                <td>{c.used_at ? new Date(c.used_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* ── Users Panel ── */}
      <Panel icon={Users} title="Alpha Users">
        <table>
          <thead><tr><th>User ID</th><th>Guild ID</th><th>Activated</th><th>Code Used</th><th>Telemetry</th></tr></thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={5} className="exper-empty-cell">No alpha users yet.</td></tr>
            ) : users.map((u) => (
              <tr key={`${u.guild_id}:${u.user_id}`}>
                <td><code>{u.user_id}</code></td>
                <td><code>{u.guild_id}</code></td>
                <td>{new Date(u.activated_at).toLocaleString()}</td>
                <td><code>{u.code_used || "—"}</code></td>
                <td>
                  <button className={`btn ${u.telemetry_opt_out ? "secondary" : "primary"} exper-tele-btn`}
                    onClick={() => toggleTelemetry(u.user_id, u.guild_id, u.telemetry_opt_out)}>
                    {u.telemetry_opt_out ? <X size={14} /> : <Check size={14} />}
                    {u.telemetry_opt_out ? " Opt Out" : " Opt In"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* ── Telemetry Panel ── */}
      <Panel icon={Radio} title="Tool Telemetry">
        <div className="row exper-mb-14">
          <div className="exper-tele-row">
            <Search size={16} />
            <select value={filterSuccess} onChange={(e) => setFilterSuccess(e.target.value)}>
              <option value="">All Results</option>
              <option value="true">Success</option>
              <option value="false">Failure</option>
            </select>
            <input type="text" placeholder="Filter by User ID" value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)} className="exper-input-sm" />
          </div>
          <button className="btn danger" onClick={purgeTelemetry}><Trash2 /> Purge All</button>
        </div>
        <table>
          <thead><tr><th>Time</th><th>Tool</th><th>User</th><th>Guild</th><th>Result</th><th>Duration</th><th>Error</th></tr></thead>
          <tbody>
            {telemetry
              .filter((e) => filterSuccess === "" || String(e.success) === filterSuccess)
              .filter((e) => filterUserId === "" || (e.user_id || "").includes(filterUserId))
              .length === 0 ? (
              <tr><td colSpan={7} className="exper-empty-cell">No telemetry entries.</td></tr>
            ) : telemetry
              .filter((e) => filterSuccess === "" || String(e.success) === filterSuccess)
              .filter((e) => filterUserId === "" || (e.user_id || "").includes(filterUserId))
              .map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td><code>{e.tool_name}</code></td>
                <td><code>{e.user_id || "—"}</code></td>
                <td><code>{e.guild_id || "—"}</code></td>
                <td>{e.success ? <Check size={16} color="var(--green)" /> : <X size={16} color="var(--red)" />}</td>
                <td>{e.duration_ms}ms</td>
                <td className="exper-cell-ellipsis">{e.error_msg || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="row exper-row-end">
        <button className="btn secondary" onClick={load}><RotateCw /> Refresh All</button>
      </div>
    </div>
  );
}
