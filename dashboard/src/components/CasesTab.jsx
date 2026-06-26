import { useEffect, useState } from "react";
import { FolderOpen, Search, RotateCw, Image, MessageSquare, ExternalLink } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import { formatTimestamp, guildQuery } from "../utils.js";

const ACTION_COLORS = {
  warn: "warn", mute: "mute", kick: "kick", ban: "ban",
  softban: "ban", tempban: "ban", unmute: "unmute", unban: "unban",
};

function parseProof(raw) {
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { return null; }
}

function AttachmentThumb({ att }) {
  const isImage = att.type?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(att.url);
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      title={att.name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 8px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        textDecoration: "none",
        color: "var(--text)",
        fontSize: 12,
      }}
    >
      {isImage ? (
        <img
          src={att.url}
          alt={att.name}
          style={{ width: 60, height: 36, objectFit: "cover", borderRadius: 3 }}
          loading="lazy"
        />
      ) : (
        <Image style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
      )}
      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {att.name}
      </span>
    </a>
  );
}

function ProofSection({ proof }) {
  if (!proof) return null;
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      {proof.repliedMessage && (
        <div style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderLeft: "3px solid var(--accent)",
          borderRadius: "var(--radius-sm)",
          padding: "8px 10px",
          fontSize: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <MessageSquare style={{ width: 12, height: 12, color: "var(--accent)" }} />
            <span style={{ fontWeight: 600, color: "var(--accent-hover)", fontSize: 11 }}>
              Replied to {proof.repliedMessage.author}
            </span>
            <code style={{ fontSize: 10, background: "none", padding: 0, color: "var(--text-muted)" }}>
              {proof.repliedMessage.authorId}
            </code>
          </div>
          {proof.repliedMessage.content ? (
            <div style={{
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 120,
              overflowY: "auto",
              lineHeight: 1.4,
            }}>
              {proof.repliedMessage.content}
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>[no text content]</span>
          )}
          {proof.repliedMessage.attachments?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {proof.repliedMessage.attachments.map((a, i) => (
                <AttachmentThumb key={i} att={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {proof.attachments?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {proof.attachments.map((a, i) => (
            <AttachmentThumb key={i} att={a} />
          ))}
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

  // Only show entries that have proof
  const casesWithProof = (entries || []).filter(e => parseProof(e.proof));

  const filtered = casesWithProof.filter((entry) => {
    if (actionFilter !== "all" && entry.action !== actionFilter) return false;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (entry.user_id || "").includes(q) ||
      (entry.mod_id || "").includes(q) ||
      (entry.reason || "").toLowerCase().includes(q);
  });

  const actions = [...new Set(casesWithProof.map((e) => e.action).filter(Boolean))];

  return (
    <div className="tab active">
      <Panel icon={FolderOpen} title="Cases">
        <p className="muted" style={{ marginBottom: 14 }}>
          Moderation actions with attached proof — images, files, and replied-to messages.
          Use <code>$realwarn @user reason</code> while replying to a message or attaching files.
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
          <button className="btn secondary" onClick={load} style={{ alignSelf: "flex-end" }}>
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
          <div>
            {filtered.map((entry) => {
              const proof = parseProof(entry.proof);
              return (
                <div
                  key={entry.id}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "12px 14px",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                    <span
                      className={"action-label " + (ACTION_COLORS[entry.action] || "")}
                      style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase" }}
                    >
                      {entry.action}
                    </span>
                    <span style={{ fontSize: 12 }}>
                      <strong>User:</strong> <code style={{ fontSize: 11 }}>{entry.user_id}</code>
                    </span>
                    <span style={{ fontSize: 12 }}>
                      <strong>Mod:</strong> <code style={{ fontSize: 11 }}>{entry.mod_id}</code>
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11, marginLeft: "auto" }}>
                      {formatTimestamp(entry.timestamp)}
                    </span>
                  </div>

                  {entry.reason && (
                    <div style={{ marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                      {entry.reason}
                    </div>
                  )}

                  <ProofSection proof={proof} />

                  {entry.details && (
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
                      {entry.details}
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
