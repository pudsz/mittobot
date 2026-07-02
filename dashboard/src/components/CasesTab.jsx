import { useEffect, useState } from "react";
import { FolderOpen, Search, RotateCw, Image, MessageSquare, Ban, Shield, VolumeX, UserX, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import { formatTimestamp, guildQuery } from "../utils.js";

const ACTION_META = {
  warn:     { color: "var(--orange)", Icon: AlertTriangle, label: "Warn", severity: 1 },
  mute:     { color: "var(--accent)", Icon: VolumeX,       label: "Mute", severity: 2 },
  kick:     { color: "var(--orange)", Icon: UserX,         label: "Kick", severity: 3 },
  softban:  { color: "var(--red)",    Icon: Ban,           label: "Softban", severity: 4 },
  tempban:  { color: "var(--red)",    Icon: Ban,           label: "Temp Ban", severity: 4 },
  ban:      { color: "var(--red)",    Icon: Ban,           label: "Ban", severity: 5 },
};

function parseProof(raw) {
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { return null; }
}

function AttachmentThumb({ att }) {
  const isImage = att.type?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(att.url);
  return (
    <a href={att.url} target="_blank" rel="noopener noreferrer" title={att.name} className="cases-attach-thumb">
      {isImage ? (
        <img src={att.url} alt={att.name} className="cases-attach-thumb-img" loading="lazy" />
      ) : (
        <Image style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
      )}
      <span className="cases-attach-thumb-name">{att.name}</span>
    </a>
  );
}

function ProofSection({ proof }) {
  if (!proof) return null;
  return (
    <div className="cases-proof-section">
      {proof.repliedMessage && (
        <div className="cases-proof-replied">
          <div className="cases-proof-replied-header">
            <MessageSquare />
            <span className="cases-proof-replied-author">Replied to {proof.repliedMessage.author}</span>
            <code className="cases-proof-replied-id">{proof.repliedMessage.authorId}</code>
          </div>
          {proof.repliedMessage.content ? (
            <div className="cases-proof-replied-content">{proof.repliedMessage.content}</div>
          ) : <span className="muted" style={{ fontSize: 11 }}>[no text content]</span>}
          {proof.repliedMessage.attachments?.length > 0 && (
            <div className="cases-proof-attachments-row">
              {proof.repliedMessage.attachments.map((a) => <AttachmentThumb key={a.id || a.url} att={a} />)}
            </div>
          )}
        </div>
      )}
      {proof.attachments?.length > 0 && (
        <div className="cases-proof-attachments">
          {proof.attachments.map((a) => <AttachmentThumb key={a.id || a.url} att={a} />)}
        </div>
      )}
    </div>
  );
}

export default function CasesTab({ guildId }) {
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [expanded, setExpanded] = useState(new Set());
  const [prefix, setPrefix] = useState("$");

  async function load() {
    setLoading(true);
    try {
      const { entries: list, prefix: commandPrefix } = await api("GET", `/api/modlog${guildQuery(guildId)}`);
      setEntries(list || []);
      setPrefix(commandPrefix || "$");
    } catch (e) {
      toast(e.message, true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  const casesWithProof = (entries || []).filter(e => parseProof(e.proof));

  const filtered = casesWithProof.filter((entry) => {
    if (actionFilter !== "all" && entry.action !== actionFilter) return false;
    const meta = ACTION_META[entry.action];
    if (severityFilter !== "all" && String(meta?.severity || 0) !== severityFilter) return false;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (entry.user_id || "").includes(q) || (entry.mod_id || "").includes(q) || (entry.reason || "").toLowerCase().includes(q);
  });

  // Stats
  const stats = casesWithProof.reduce((acc, e) => {
    acc.total++;
    acc[e.action] = (acc[e.action] || 0) + 1;
    return acc;
  }, { total: 0 });

  const actions = [...new Set(casesWithProof.map((e) => e.action).filter(Boolean))];
  const hasImages = casesWithProof.some(e => {
    const proof = parseProof(e.proof);
    return proof?.attachments?.some(a => a.type?.startsWith("image/")) ||
           proof?.repliedMessage?.attachments?.some(a => a.type?.startsWith("image/"));
  });

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="tab active">
      <Panel icon={FolderOpen} title="Cases">
        <p className="muted mb-4">
          Moderation actions with attached proof — images, files, and replied-to messages.
          Use <code>{prefix}realwarn @user reason</code> while replying to a message or attaching files.
        </p>

        {stats.total > 0 && (
          <div className="mod-stats-row" style={{ marginBottom: 14 }}>
            <div className="stat-pill"><div className="stat-pill-value">{stats.total}</div><div className="stat-pill-label">Total Cases</div></div>
            {stats.warn > 0 && <div className="stat-pill cases-stat-pill cases-stat-pill--warn"><div className="stat-pill-value">{stats.warn}</div><div className="stat-pill-label">Warns</div></div>}
            {stats.mute > 0 && <div className="stat-pill cases-stat-pill cases-stat-pill--mute"><div className="stat-pill-value">{stats.mute}</div><div className="stat-pill-label">Mutes</div></div>}
            {stats.kick > 0 && <div className="stat-pill cases-stat-pill cases-stat-pill--kick"><div className="stat-pill-value">{stats.kick}</div><div className="stat-pill-label">Kicks</div></div>}
            {(stats.ban || stats.softban || stats.tempban) > 0 && <div className="stat-pill cases-stat-pill cases-stat-pill--ban"><div className="stat-pill-value">{(stats.ban || 0) + (stats.softban || 0) + (stats.tempban || 0)}</div><div className="stat-pill-label">Bans</div></div>}
            {hasImages && <div className="stat-pill cases-stat-pill cases-stat-pill--images"><div className="stat-pill-value">📸</div><div className="stat-pill-label">With Images</div></div>}
          </div>
        )}

        <div className="row cases-filter-row">
          <div className="field cases-filter-field">
            <label>Search</label>
            <input placeholder="User ID, moderator ID, or reason..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field cases-filter-action">
            <label>Action</label>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="all">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field cases-filter-severity">
            <label>Severity</label>
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="all">All severities</option>
              <option value="1">⚠ Low (Warn)</option>
              <option value="2">🔵 Med (Mute)</option>
              <option value="3">🟠 High (Kick)</option>
              <option value="4">🔴 Critical (Temp Ban)</option>
              <option value="5">⛔ Severe (Ban)</option>
            </select>
          </div>
          <button className="btn secondary cases-refresh-btn" onClick={load}>
            <RotateCw /> Refresh
          </button>
        </div>
      </Panel>

      <Panel>
        {loading ? (
          <div className="muted" style={{ textAlign: "center", padding: 30 }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="muted" style={{ textAlign: "center", padding: 30 }}>
            {casesWithProof.length === 0
              ? "No cases with proof yet. Proof is saved when you use moderation commands while replying to a message or attaching files."
              : "No cases match the current filters."}
          </div>
        ) : (
          <div className="mod-log-list">
            {filtered.map((entry) => {
              const proof = parseProof(entry.proof);
              const meta = ACTION_META[entry.action] || { color: "var(--text-muted)", Icon: Shield, label: entry.action || "?", severity: 0 };
              const Icon = meta.Icon;
              const isOpen = expanded.has(entry.id);
              return (
                <div key={entry.id}>
                  <div
                    className="mod-log-row visible"
                    onClick={() => toggleExpand(entry.id)}
                    style={{ cursor: "pointer", gridTemplateColumns: "100px 1fr 100px 30px" }}
                  >
                    <div className="mod-log-cell" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div className="cases-dot" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}66` }} />
                      <span className="mod-log-action cases-action-label" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="mod-log-cell" style={{ fontSize: 12 }}>
                      <code style={{ fontSize: 11 }}>{entry.user_id}</code>
                      {entry.reason && <div className="mod-log-reason">{entry.reason.slice(0, 80)}{entry.reason.length > 80 ? "…" : ""}</div>}
                    </div>
                    <div className="mod-log-cell mod-log-time" style={{ textAlign: "right" }}>
                      {formatTimestamp(entry.timestamp)}
                    </div>
                    <div className="mod-log-cell" style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>
                      {isOpen ? "▲" : "▼"}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="mod-log-detail">
                      <div><strong>User:</strong> <code>{entry.user_id}</code></div>
                      <div><strong>Moderator:</strong> <code>{entry.mod_id}</code></div>
                      <div><strong>Action:</strong> <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span> (Severity: {meta.severity})</div>
                      {entry.reason && <div><strong>Reason:</strong> {entry.reason}</div>}
                      {entry.details && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{entry.details}</div>}
                      <ProofSection proof={proof} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
