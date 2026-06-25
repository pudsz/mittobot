import { useEffect, useState } from "react";
import { ScrollText, Search, RotateCw } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import { formatTimestamp, guildQuery } from "../utils.js";

const ACTION_COLORS = {
  warn: "warn", mute: "mute", kick: "kick", ban: "ban",
  softban: "ban", tempban: "ban", unmute: "unmute", unban: "unban",
};

export default function ModerationLogTab({ guildId }) {
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const { entries: list } = await api("GET", `/api/modlog${guildQuery(guildId)}`);
      setEntries(list || []);
    } catch (e) {
      toast(e.message, true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function searchByUser() {
    const uid = userFilter.trim();
    if (!uid) return load();
    setLoading(true);
    try {
      const { entries: list } = await api("GET", `/api/modlog/${encodeURIComponent(uid)}${guildQuery(guildId)}`);
      setEntries(list || []);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }

  const filtered = (entries || []).filter((entry) => {
    if (actionFilter !== "all" && entry.action !== actionFilter) return false;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (entry.user_id || "").includes(q) ||
      (entry.mod_id || "").includes(q) ||
      (entry.reason || "").toLowerCase().includes(q);
  });

  const actions = [...new Set((entries || []).map((e) => e.action).filter(Boolean))];

  return (
    <div className="tab active">
      <Panel icon={ScrollText} title="Moderation Log">
        <p className="muted" style={{ marginBottom: 14 }}>
          Full audit trail of all moderation actions. Search by user/moderator ID or filter by action type.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="field" style={{ flex: 1, margin: 0, minWidth: 200 }}>
            <label>Search in entries</label>
            <input placeholder="User ID, moderator ID, or reason..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 0.5, margin: 0, minWidth: 120 }}>
            <label>Action filter</label>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="field" style={{ flex: 0.6, margin: 0, minWidth: 180 }}>
            <label>Look up by user ID</label>
            <div className="row">
              <input placeholder="User ID..." value={userFilter} onChange={(e) => setUserFilter(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchByUser(); }} />
              <button className="btn secondary" onClick={searchByUser}><Search /> Find</button>
              <button className="btn secondary" onClick={load}><RotateCw /> All</button>
            </div>
          </div>
        </div>
      </Panel>
      <Panel>
        {filtered.length === 0 ? (
          <div className="muted" style={{ textAlign: "center", padding: 30 }}>
            {loading ? "Loading..." : entries?.length === 0
              ? "No moderation actions logged yet. Actions are recorded when you use real moderation commands."
              : "No entries match the current filters."}
          </div>
        ) : (
          <div>
            {filtered.slice(0, 200).map((entry) => (
              <div className="mod-log-row" key={entry.id}>
                <div><strong>User:</strong> <code style={{ fontSize: 11 }}>{entry.user_id}</code></div>
                <div><strong>Mod:</strong> <code style={{ fontSize: 11 }}>{entry.mod_id}</code></div>
                <div className={"action-label " + (ACTION_COLORS[entry.action] || "")}>
                  {entry.action.toUpperCase()}
                  <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>{entry.reason ? `— ${entry.reason.slice(0, 80)}` : ""}</span>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{formatTimestamp(entry.timestamp)}</div>
                <div>{entry.details ? <span className="badge info" title={entry.details}>details</span> : null}</div>
              </div>
            ))}
            {entries?.length > 200 && <div className="muted" style={{ textAlign: "center", padding: 12, fontSize: 12 }}>Showing first 200 of {entries.length} entries</div>}
          </div>
        )}
      </Panel>
    </div>
  );
}
