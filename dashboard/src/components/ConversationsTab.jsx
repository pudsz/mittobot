import { useState, useEffect, useRef } from "react";
import { MessageSquare, User, Bot, Clock, ChevronDown, ChevronUp, Globe, Lock, ArrowLeft, Download } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(Number(ts));
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Avatar circle: Discord CDN image if available, otherwise gradient + initial letter.
function AvatarCircle({ url, name, size = 40, fontSize = 16, selected = false }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: url
          ? `url(${url}) center/cover no-repeat`
          : "linear-gradient(135deg, var(--accent), var(--green))",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        fontWeight: 700,
        flexShrink: 0,
        overflow: "hidden",
        border: selected ? "2px solid var(--accent)" : "none",
        boxShadow: selected ? "0 0 0 2px var(--accent-subtle)" : "none",
      }}
      title={name}
    >
      {!url && initial}
    </div>
  );
}

// Private-user list item: avatar + name + last-active time, hover affordant.
function PrivateUserCard({ user, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        cursor: "pointer",
        transition: "background var(--transition-fast), border-color var(--transition-fast)",
        textAlign: "left",
        width: "100%",
        color: "var(--text)",
        fontSize: 13,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.background = "var(--accent-subtle)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.background = "var(--surface)";
      }}
    >
      <AvatarCircle url={user.avatarUrl} name={user.displayName} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{user.displayName}</div>
        <div
          title="The user's most recent message across all of their DM threads, not just the one you'll open."
          style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, cursor: "help", borderBottom: "1px dotted var(--muted)" }}
        >
          Last turn (across DMs) {formatTime(user.lastActive)}
        </div>
      </div>
      <span style={{ color: "var(--muted)", fontSize: 20, flexShrink: 0 }}>›</span>
    </button>
  );
}

// Modal that surfaces the owner-only /api/ai/conversations/diag stats so the
// admin can verify what the DB actually contains without leaving the dashboard.
function DiagModal({ open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) {
      // Reset state on close so re-opening surfaces fresh stats immediately,
      // not the previous panel's snapshot for a frame.
      setData(null);
      setErr(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api("GET", "/api/ai/conversations/diag")
      .then((r) => { if (!cancelled) { setData(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(e.message || "Failed to load"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [open]);

  // Esc closes the modal — standard Dialog a11y. We intentionally do NOT trap
  // focus (this is an admin debug tool, not user-facing dialog).
  // Hold onClose in a ref so a fresh lambda from the parent doesn't force the
  // keydown listener to detach-and-reattach on every ConversationsTab render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI conversations DB stats"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
          padding: 20, maxWidth: 720, width: "92vw", maxHeight: "80vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, flex: 1 }}>AI conversations — DB stats</h3>
          <button className="btn secondary" onClick={onClose} style={{ padding: "4px 10px" }}>Close</button>
        </div>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : err ? (
          <div className="muted" style={{ color: "var(--danger, #d44)" }}>{err}</div>
        ) : !data ? null : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <span className="badge">Total rows: {data.total}</span>
              {data.byScope.map((s) => (
                <span key={s.scope ?? "null"} className="badge">
                  scope: {s.scope ?? "null"} ({s.count})
                </span>
              ))}
              {data.byGuild.map((g) => (
                <span key={g.guild_id ?? "null"} className="badge">
                  guild: {g.guild_id ?? "null"} ({g.count})
                </span>
              ))}
            </div>
            {/* The two tables below are rendered independently and intentionally do not
                cross-align — `byThread` is sorted by activity, `sample` by row recency. */}
            <h4 style={{ marginTop: 12, marginBottom: 6, fontSize: 13 }}>Top active threads</h4>
            <table>
              <thead>
                <tr><th>scope</th><th>guild</th><th>channel</th><th>user</th><th>count</th><th>last</th></tr>
              </thead>
              <tbody>
                {data.byThread.map((t) => (
                  <tr key={`${t.scope ?? "dm"}-${t.guild_id ?? ""}-${t.channel_id ?? ""}-${t.user_id ?? ""}`}>
                    <td>{t.scope ?? "null"}</td>
                    <td>{t.guild_id ?? "null"}</td>
                    <td>{t.channel_id ?? "null"}</td>
                    <td>{t.user_id ?? "null"}</td>
                    <td>{t.count}</td>
                    <td>{formatTime(t.last_active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.sample && data.sample.length > 0 && (
              <>
                <h4 style={{ marginTop: 16, marginBottom: 6, fontSize: 13 }}>Recent 3 rows</h4>
                <table>
                  <thead>
                    <tr><th>when</th><th>role</th><th>scope</th><th>guild</th><th>channel</th><th>user</th><th>len</th></tr>
                  </thead>
                  <tbody>
                    {data.sample.map((s) => (
                      <tr key={s.id}>
                        <td>{formatTime(s.timestamp)}</td>
                        <td>{s.role}</td>
                        <td>{s.scope ?? "null"}</td>
                        <td>{s.guild_id ?? "null"}</td>
                        <td>{s.channel_id ?? "null"}</td>
                        <td>{s.user_id ?? "null"}</td>
                        <td>{s.content_length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Empty-state panel for the conversations list. Different copy per scope
// selection; in scope-filtered views the user sees an inline note pointing
// at the cause (legacy rows are mislabeled as private under a NULL guild_id
// after the recent migrations, so Global scope can read empty even when
// there are hundreds of rows in the table).
function EmptyState({ fetchError, selectedScope, usersCount, onSwitchToAll, onShowDiag, onRetry }) {
  const filteredCtas =
    !fetchError && (selectedScope === "global" || selectedScope === "private") ? (
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
        <button className="btn secondary" onClick={onSwitchToAll}>Switch to “All scopes”</button>
        <button className="btn secondary" onClick={onShowDiag}>DB stats</button>
      </div>
    ) : null;

  let body;
  let ctas;
  if (fetchError) {
    body = `Failed to load logs: ${fetchError}`;
    ctas = (
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
        <button className="btn secondary" onClick={onRetry}>Retry</button>
        <button className="btn secondary" onClick={onShowDiag}>DB stats</button>
      </div>
    );
  } else if (selectedScope === "global") {
    body = "No channel-thread conversations for this guild.";
    ctas = filteredCtas;
  } else if (selectedScope === "private") {
    body = usersCount === 0
      ? "No DM threads for this guild yet."
      : "Pick a user above to open their chat thread.";
    ctas = filteredCtas;
  } else {
    body = "No conversation logs yet. Send a message to the bot to start building history.";
  }

  return (
    <Panel>
      <p className="muted" style={{ textAlign: "center", margin: 0 }}>{body}</p>
      {ctas}
    </Panel>
  );
}

// Chat-history bubble rendering for a selected thread. Auto-scrolls to bottom.
function ChatBubbleView({ logs, user, emptyText }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "4px 2px" }}>
        <AvatarCircle url={user?.avatarUrl} name={user?.displayName} size={40} fontSize={15} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{user?.displayName || "Thread"}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {logs.length} message{logs.length === 1 ? "" : "s"} in this thread
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          maxHeight: 540,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {logs.length === 0 && (
          <div className="muted" style={{ textAlign: "center", padding: 20 }}>
            {emptyText || "No conversation turns yet for this thread."}
          </div>
        )}
        {logs.map((entry) => {
          const isUser = entry.role === "user";
          return (
            <div
              key={entry.id}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                gap: 8,
              }}
            >
              <div
                style={{
                  maxWidth: "75%",
                  padding: "10px 14px",
                  borderRadius: 16,
                  background: isUser ? "var(--accent)" : "var(--surface)",
                  border: `1px solid ${isUser ? "var(--accent)" : "var(--border)"}`,
                  color: isUser ? "#fff" : "var(--text)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 13,
                  borderTopRightRadius: isUser ? 4 : 16,
                  borderTopLeftRadius: isUser ? 16 : 4,
                  lineHeight: 1.5,
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: isUser ? "rgba(255, 255, 255, 0.85)" : "var(--muted)",
                    marginBottom: 4,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    textTransform: "uppercase",
                  }}
                >
                  {isUser ? (entry.displayName || "User") : "Bot"} · {formatTime(entry.timestamp)}
                </div>
                {entry.content}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function ConversationsTab({ guildId }) {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedScope, setSelectedScope] = useState("");  // "global" | "private" | ""
  const [selectedThread, setSelectedThread] = useState(""); // channelId or userId depending on scope
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [showDiag, setShowDiag] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    if (!guildId) return;
    const seq = ++loadSeqRef.current;

    async function run() {
      setLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams({ guildId, limit: "200" });
        if (selectedScope) params.set("scope", selectedScope);
        if (selectedScope === "global" && selectedThread) params.set("channelId", selectedThread);
        if (selectedScope === "private" && selectedThread) params.set("userId", selectedThread);
        const result = await api("GET", `/api/ai/conversations/logs?${params.toString()}`);
        if (seq !== loadSeqRef.current) return;
        setLogs(result.logs || []);
        setUsers(result.users || []);
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        setFetchError(e.message || "Failed to load logs");
        toast(e.message, true);
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
      }
    }

    run();
  }, [guildId, selectedScope, selectedThread, refreshTick, toast]);

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectScope(scope) {
    setSelectedScope(scope === selectedScope ? "" : scope);
    setSelectedThread("");
  }

  function selectThread(id) {
    setSelectedThread(id === selectedThread ? "" : id);
  }

  function refreshLogs() {
    setRefreshTick((v) => v + 1);
  }

  function exportLogs() {
    if (!logs.length) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      guildId,
      scope: selectedScope || "all",
      threadId: selectedThread || null,
      logs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeThread = selectedThread ? `-${selectedThread}` : "";
    a.href = url;
    a.download = `ai-conversation-logs-${guildId}-${selectedScope || "all"}${safeThread}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast("Exported conversation logs");
  }

  if (!guildId) {
    return (
      <div className="tab active">
        <Panel icon={MessageSquare} title="AI Conversation Logs">
          <p className="muted">Select a guild to view conversation logs.</p>
        </Panel>
      </div>
    );
  }

  const isThreadChatMode = (selectedScope === "private" || selectedScope === "global") && !!selectedThread;
  const selectedThreadMeta = users.find((u) => (
    selectedScope === "private" ? u.userId === selectedThread : u.channelId === selectedThread
  )) || null;
  const fallbackThreadMeta = selectedScope === "global"
    ? { displayName: `#${logs.find((l) => l.channelName)?.channelName || selectedThread}`, avatarUrl: null }
    : { displayName: "User", avatarUrl: null };

  return (
    <div className="tab active">
      <Panel icon={MessageSquare} title="AI Conversation Logs">
        <p className="muted" style={{ marginBottom: 12 }}>
          AI conversation history. Pick a scope to filter:
        </p>
        <div className="row" style={{ marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
          <button
            className={`btn ${selectedScope === "" ? "" : "secondary"}`}
            onClick={() => selectScope("")}
          >All scopes</button>
          <button
            className={`btn ${selectedScope === "global" ? "green" : "secondary"}`}
            onClick={() => selectScope("global")}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <Globe style={{ width: 14, height: 14 }} /> Global (per-channel threads)
          </button>
          <button
            className={`btn ${selectedScope === "private" ? "green" : "secondary"}`}
            onClick={() => selectScope("private")}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <Lock style={{ width: 14, height: 14 }} /> Private (per-user DM threads)
          </button>
          <button className="btn secondary" onClick={refreshLogs} disabled={loading} style={{ marginLeft: "auto" }}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button className="btn secondary" onClick={exportLogs} disabled={loading || logs.length === 0}>
            <Download style={{ width: 14, height: 14 }} /> Export
          </button>
        </div>

        {/* Global chip filter (channels) */}
        {selectedScope === "global" && users.length > 0 && (
          <div className="row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 4 }}>
            <span className="muted" style={{ fontSize: 12, marginRight: 8 }}>Channels:</span>
            <button
              className={`badge ${selectedThread === "" ? "ok" : ""}`}
              style={{ cursor: "pointer", padding: "3px 10px", fontSize: 11 }}
              onClick={() => selectThread("")}
            >All channels</button>
            {users.map((u) => {
              const tid = u.channelId;
              if (!tid) return null;
              return (
                <button
                  key={`${u.scope}:${tid}`}
                  className={`badge ${selectedThread === tid ? "ok" : ""}`}
                  style={{ cursor: "pointer", padding: "3px 10px", fontSize: 11 }}
                  onClick={() => selectThread(tid)}
                  title={tid}
                >
                  #{u.displayName}
                </button>
              );
            })}
          </div>
        )}

        {/* Private user list with avatars — click to enter chat view */}
        {selectedScope === "private" && !selectedThread && users.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 12, padding: "0 4px" }}>
              {users.length} user{users.length === 1 ? "" : "s"} — click to open their chat:
            </span>
            {users.map((u) => (
              <PrivateUserCard
                key={u.userId}
                user={u}
                onClick={() => selectThread(u.userId)}
              />
            ))}
          </div>
        )}

        {/* Back button when in focused chat view */}
        {isThreadChatMode && (
          <button
            className="btn secondary"
            onClick={() => selectThread("")}
            style={{ marginBottom: 12, padding: "5px 12px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <ArrowLeft style={{ width: 14, height: 14 }} /> Back to {selectedScope === "global" ? "channel list" : "user list"}
          </button>
        )}
      </Panel>

      {/* Body: chat bubbles (focused thread) | loading | empty | thread list */}
      {loading ? (
        <Panel>
          <div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" style={{ width: "70%" }} />
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <div className="skeleton skeleton-text" style={{ width: "40%" }} />
              <div className="skeleton skeleton-text" />
            </div>
          ))}
        </Panel>
      ) : isThreadChatMode ? (
        <Panel>
          <ChatBubbleView
            logs={logs}
            user={selectedThreadMeta || fallbackThreadMeta}
            emptyText={selectedScope === "global" ? "No conversation turns yet for this channel." : "No conversation turns yet for this user."}
          />
        </Panel>
      ) : logs.length === 0 ? (
        <EmptyState
          fetchError={fetchError}
          selectedScope={selectedScope}
          usersCount={users.length}
          onSwitchToAll={() => selectScope("")}
          onShowDiag={() => setShowDiag(true)}
          onRetry={refreshLogs}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {logs.map((entry) => {
            const isUser = entry.role === "user";
            const isExpanded = expanded.has(entry.id);
            const scopeTag = entry.scope === "global"
              ? { icon: Globe, label: "Global", color: "var(--accent)" }
              : { icon: Lock, label: "Private", color: "var(--muted)" };
            return (
              <div
                key={entry.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                  transition: "border-color var(--transition-fast)",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 12px",
                    cursor: isUser ? "pointer" : "default",
                    fontSize: 12,
                  }}
                  onClick={() => isUser && entry.content && toggleExpand(entry.id)}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: isUser ? "var(--accent-subtle)" : "var(--green-subtle)",
                      border: `1px solid ${isUser ? "var(--accent)" : "var(--green)"}`,
                      borderRadius: 999,
                      padding: "2px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isUser ? <User style={{ width: 12, height: 12 }} /> : <Bot style={{ width: 12, height: 12 }} />}
                    {isUser ? "User" : "Bot"}
                  </div>
                  <div
                    title={`Scope: ${scopeTag.label}${entry.channelId ? ` (#${entry.channelId})` : ""}${entry.userId ? ` <@${entry.userId}>` : ""}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "transparent",
                      border: `1px solid ${scopeTag.color}`,
                      color: scopeTag.color,
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <scopeTag.icon style={{ width: 10, height: 10 }} />
                    {scopeTag.label}
                  </div>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: isUser ? "var(--text)" : "var(--text-secondary)",
                    }}
                  >
                    {isUser ? (
                      <span>
                        <strong>{entry.displayName}</strong>{" "}
                        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>({entry.userId})</span>
                        <span style={{ color: "var(--muted)" }}> — {entry.content}</span>
                      </span>
                    ) : (
                      <span>{entry.content}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <Clock style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
                    <span style={{ color: "var(--text-muted)", fontSize: 10, whiteSpace: "nowrap" }}>
                      {formatTime(entry.timestamp)}
                    </span>
                    {isUser && entry.content && (
                      <span style={{ color: "var(--text-muted)", marginLeft: 2 }}>
                        {isExpanded ? <ChevronUp style={{ width: 12, height: 12 }} /> : <ChevronDown style={{ width: 12, height: 12 }} />}
                      </span>
                    )}
                  </div>
                </div>
                {isExpanded && isUser && entry.content && (
                  <div
                    style={{
                      borderTop: "1px solid var(--border-light)",
                      padding: "8px 14px",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      background: "var(--bg)",
                      animation: "slideDown 0.15s ease",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 200,
                      overflowY: "auto",
                    }}
                  >
                    {entry.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <DiagModal open={showDiag} onClose={() => setShowDiag(false)} />
    </div>
  );
}
