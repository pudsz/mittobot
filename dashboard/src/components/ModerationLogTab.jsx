import { useEffect, useState, useMemo } from "react";
import { ScrollText, Search, RotateCw, ChevronDown, ChevronUp, Shield, Ban, DoorOpen, VolumeX, AlertTriangle, Clock } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import { formatTimestamp, guildQuery } from "../utils.js";

const ACTION_META = {
  warn:    { color: "var(--orange)", Icon: AlertTriangle, label: "Warn" },
  mute:    { color: "var(--accent)",  Icon: VolumeX,       label: "Mute" },
  kick:    { color: "#f0883e",        Icon: DoorOpen,      label: "Kick" },
  ban:     { color: "var(--red)",     Icon: Ban,           label: "Ban" },
  softban: { color: "var(--red)",     Icon: Ban,           label: "Softban" },
  tempban: { color: "var(--red)",     Icon: Clock,         label: "Tempban" },
  unmute:  { color: "var(--green)",   Icon: VolumeX,       label: "Unmute" },
  unban:   { color: "var(--green)",   Icon: Ban,           label: "Unban" },
};

function StatPill({ label, value, color }) {
  return (
    <div className="stat-pill" style={{ borderLeftColor: color }}>
      <span className="stat-pill-value" style={{ color }}>{value}</span>
      <span className="stat-pill-label">{label}</span>
    </div>
  );
}

function LogRow({ entry, index, isExpanded, onToggle }) {
  const meta = ACTION_META[entry.action] || { color: "var(--text-muted)", Icon: Shield, label: entry.action || "?" };
  const Icon = meta.Icon;
  const hasDetails = !!(entry.details || entry.proof || entry.reason?.length > 80);

  return (
    <>
      <div className="mod-log-row visible" onClick={hasDetails ? onToggle : undefined} style={{ animationDelay: `${index * 25}ms`, ...(hasDetails ? { cursor: "pointer" } : {}) }}>
        <div className="mod-log-cell mod-log-action" style={{ color: meta.color }}>
          <Icon className="modlog-icon" />
          <span>{meta.label}</span>
        </div>
        <div className="mod-log-cell mod-log-users">
          <span className="mod-log-user-row">👤 <code>{entry.user_id?.slice(0, 10)}…</code></span>
          <span className="mod-log-user-row modlog-muted-by">by <code>{entry.mod_id?.slice(0, 10)}…</code></span>
        </div>
        <div className="mod-log-cell mod-log-reason">
          {entry.reason ? entry.reason.slice(0, 60) : <span className="muted modlog-no-reason">No reason</span>}
          {entry.reason?.length > 60 && <span className="muted">…</span>}
        </div>
        <div className="mod-log-cell mod-log-time">{formatTimestamp(entry.timestamp)}</div>
        <div className="mod-log-cell mod-log-expand">
          {hasDetails && (isExpanded ? <ChevronUp className="modlog-icon" /> : <ChevronDown className="modlog-icon" />)}
        </div>
      </div>
      {isExpanded && hasDetails && (
        <div className="mod-log-detail">
          {entry.reason && <div><strong>Reason:</strong> {entry.reason}</div>}
          {entry.details && <div><strong>Details:</strong> {(() => { try { return JSON.stringify(JSON.parse(entry.details), null, 2); } catch { return entry.details; } })()}</div>}
          {entry.proof && <div><strong>Proof:</strong> {(() => { try { return JSON.stringify(JSON.parse(entry.proof), null, 2); } catch { return entry.proof; } })()}</div>}
          {entry.id && <div className="muted modlog-entry-id">Entry #{entry.id}</div>}
        </div>
      )}
    </>
  );
}

export default function ModerationLogTab({ guildId }) {
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("");
  const [dateRange, setDateRange] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

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

  const dateRangeMs = useMemo(() => {
    switch (dateRange) {
      case "24h": return 86400000;
      case "7d": return 604800000;
      case "30d": return 2592000000;
      case "90d": return 7776000000;
      default: return null;
    }
  }, [dateRange]);

  const filtered = useMemo(() => {
    return (entries || []).filter((entry) => {
      if (actionFilter !== "all" && entry.action !== actionFilter) return false;
      if (dateRangeMs && (Date.now() - Number(entry.timestamp || 0)) > dateRangeMs) return false;
      const q = search.toLowerCase().trim();
      if (!q) return true;
      return (entry.user_id || "").includes(q) ||
        (entry.mod_id || "").includes(q) ||
        (entry.reason || "").toLowerCase().includes(q);
    });
  }, [entries, actionFilter, dateRangeMs, search]);

  // Compute aggregate stats from ALL entries (unfiltered)
  const stats = useMemo(() => ({
    total: entries.length,
    bans: entries.filter(e => ["ban", "softban"].includes(e.action)).length,
    kicks: entries.filter(e => e.action === "kick").length,
    warns: entries.filter(e => e.action === "warn").length,
    mutes: entries.filter(e => e.action === "mute").length,
  }), [entries]);

  const uniqueActions = [...new Set((entries || []).map((e) => e.action).filter(Boolean))];

  return (
    <div className="tab active">
      {/* Stats row */}
      <div className="mod-stats-row">
        <StatPill label="Total" value={stats.total} color="var(--text-muted)" />
        <StatPill label="Bans" value={stats.bans} color="var(--red)" />
        <StatPill label="Kicks" value={stats.kicks} color="#f0883e" />
        <StatPill label="Warns" value={stats.warns} color="var(--orange)" />
        <StatPill label="Mutes" value={stats.mutes} color="var(--accent)" />
      </div>

      <Panel icon={ScrollText} title="Moderation Log">
        <p className="muted modlog-panel-desc">
          Full audit trail of all moderation actions. Click any entry to expand details.
        </p>

        {/* Filters */}
        <div className="row modlog-filters-row">
          <div className="field modlog-filter-field">
            <input placeholder="Search by ID or reason..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field modlog-filter-action">
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">All actions</option>
              {uniqueActions.map((a) => <option key={a} value={a}>{ACTION_META[a]?.label || a}</option>)}
            </select>
          </div>
          <div className="field modlog-filter-date">
            <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
              <option value="all">All time</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </div>
        </div>

        <div className="row modlog-user-search-row">
          <div className="field modlog-user-search-field">
            <div className="row">
              <input placeholder="User ID..." value={userFilter} onChange={(e) => setUserFilter(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchByUser(); }} />
              <button className="btn secondary" onClick={searchByUser}><Search className="modlog-icon" /> Find</button>
              <button className="btn secondary" onClick={load}><RotateCw className="modlog-icon" /> All</button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        {filtered.length === 0 ? (
          <div className="muted modlog-empty">
            {loading ? "Loading..." : entries?.length === 0
              ? "No moderation actions logged yet. Actions are recorded when you use real moderation commands."
              : "No entries match the current filters."}
          </div>
        ) : (
          <div className="mod-log-list">
            {filtered.slice(0, 300).map((entry, i) => (
              <LogRow
                key={entry.id}
                entry={entry}
                index={i}
                isExpanded={expandedId === entry.id}
                onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              />
            ))}
            {filtered.length > 300 && (
              <div className="muted modlog-truncated-note">
                Showing 300 of {filtered.length} matching entries
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
