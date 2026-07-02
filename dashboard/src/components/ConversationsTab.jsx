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

function AvatarCircle({ url, name, size = 40, fontSize = 16, selected = false }) {
  const initial = (name || "?").slice(0, 1).toUpperCase();
  return (
    <div
      className={`conv-avatar-circle${selected ? " conv-avatar-circle--selected" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize,
        background: url
          ? `url(${url}) center/cover no-repeat`
          : "linear-gradient(135deg, var(--accent), var(--green))",
      }}
      title={name}
    >
      {!url && initial}
    </div>
  );
}

function PrivateUserCard({ user, onClick }) {
  return (
    <button onClick={onClick} className="conv-user-card">
      <AvatarCircle url={user.avatarUrl} name={user.displayName} />
      <div className="conv-user-body">
        <div className="conv-user-card-name">{user.displayName}</div>
        <div className="conv-user-card-meta"
          title="The user's most recent message across all of their DM threads, not just the one you'll open.">
          Last turn (across DMs) {formatTime(user.lastActive)}
        </div>
      </div>
      <span className="conv-user-card-chevron">›</span>
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
    <div onClick={onClose} className="conv-diag-overlay">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI conversations DB stats"
        onClick={(e) => e.stopPropagation()}
        className="conv-diag-modal"
      >
        <div className="conv-diag-header">
          <h3>AI conversations — DB stats</h3>
          <button className="btn secondary sm" onClick={onClose}>Close</button>
        </div>
        {loading ? (
          <div className="muted">Loading...</div>
        ) : err ? (
          <div className="muted" style={{ color: "var(--danger, #d44)" }}>{err}</div>
        ) : !data ? null : (
          <>
            <div className="conv-diag-badge-row">
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
            <h4 className="conv-diag-section-title">Top active threads</h4>
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
                <h4 className="conv-diag-section-title" style={{ marginTop: 16 }}>Recent 3 rows</h4>
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
      <div className="conv-empty-ctas">
        <button className="btn secondary" onClick={onSwitchToAll}>Switch to "All scopes"</button>
        <button className="btn secondary" onClick={onShowDiag}>DB stats</button>
      </div>
    ) : null;

  let body;
  let ctas;
  if (fetchError) {
    body = `Failed to load logs: ${fetchError}`;
    ctas = (
      <div className="conv-empty-ctas">
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
      <p className="muted conv-empty-text">{body}</p>
      {ctas}
    </Panel>
  );
}

function ChatBubbleView({ logs, user, emptyText }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  return (
    <>
      <div className="conv-chat-header">
        <AvatarCircle url={user?.avatarUrl} name={user?.displayName} size={40} fontSize={15} />
        <div className="conv-chat-header-info">
          <div className="conv-chat-header-name">{user?.displayName || "Thread"}</div>
          <div className="conv-chat-header-meta">
            {logs.length} message{logs.length === 1 ? "" : "s"} in this thread
          </div>
        </div>
      </div>
      <div ref={scrollRef} className="conv-chat-scroll">
        {logs.length === 0 && (
          <div className="muted" style={{ textAlign: "center", padding: 20 }}>
            {emptyText || "No conversation turns yet for this thread."}
          </div>
        )}
        {logs.map((entry) => {
          const isUser = entry.role === "user";
          return (
            <div key={entry.id} className={`conv-bubble-row conv-bubble-row--${isUser ? "user" : "bot"}`}>
              <div className={`conv-bubble conv-bubble--${isUser ? "user" : "bot"}`}>
                <div className={`conv-bubble-label conv-bubble-label--${isUser ? "user" : "bot"}`}>
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
        <p className="muted mb-3">
          AI conversation history. Pick a scope to filter:
        </p>
        <div className="row conv-toolbar">
          <button
            className={`btn ${selectedScope === "" ? "" : "secondary"}`}
            onClick={() => selectScope("")}
          >All scopes</button>
          <button
            className={`btn ${selectedScope === "global" ? "green" : "secondary"} conv-scope-btn`}
            onClick={() => selectScope("global")}
          >
            <Globe style={{ width: 14, height: 14 }} /> Global (per-channel threads)
          </button>
          <button
            className={`btn ${selectedScope === "private" ? "green" : "secondary"} conv-scope-btn`}
            onClick={() => selectScope("private")}
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

        {selectedScope === "global" && users.length > 0 && (
          <div className="row conv-chip-bar">
            <span className="conv-chip-label">Channels:</span>
            <button
              className={`badge${selectedThread === "" ? " ok" : ""} conv-chip`}
              onClick={() => selectThread("")}
            >All channels</button>
            {users.map((u) => {
              const tid = u.channelId;
              if (!tid) return null;
              return (
                <button
                  key={`${u.scope}:${tid}`}
                  className={`badge${selectedThread === tid ? " ok" : ""} conv-chip`}
                  onClick={() => selectThread(tid)}
                  title={tid}
                >
                  #{u.displayName}
                </button>
              );
            })}
          </div>
        )}

        {selectedScope === "private" && !selectedThread && users.length > 0 && (
          <div className="conv-userlist">
            <span className="conv-userlist-header">
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

        {isThreadChatMode && (
          <button
            className="btn secondary conv-back-btn"
            onClick={() => selectThread("")}
          >
            <ArrowLeft style={{ width: 14, height: 14 }} /> Back to {selectedScope === "global" ? "channel list" : "user list"}
          </button>
        )}
      </Panel>

      {loading ? (
        <Panel>
          <div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" style={{ width: "70%" }} />
          {[1, 2, 3].map((i) => (
            <div key={i} className="mt-3">
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
        <div className="conv-log-list">
          {logs.map((entry) => {
            const isUser = entry.role === "user";
            const isExpanded = expanded.has(entry.id);
            const scopeTag = entry.scope === "global"
              ? { icon: Globe, label: "Global", color: "var(--accent)" }
              : { icon: Lock, label: "Private", color: "var(--muted)" };
            return (
              <div key={entry.id} className="conv-log-card">
                <div
                  className="conv-log-row"
                  style={{ cursor: isUser ? "pointer" : "default" }}
                  onClick={() => isUser && entry.content && toggleExpand(entry.id)}
                >
                  <div className={`conv-log-badge conv-log-badge--${isUser ? "user" : "bot"}`}>
                    {isUser ? <User style={{ width: 12, height: 12 }} /> : <Bot style={{ width: 12, height: 12 }} />}
                    {isUser ? "User" : "Bot"}
                  </div>
                  <div
                    title={`Scope: ${scopeTag.label}${entry.channelId ? ` (#${entry.channelId})` : ""}${entry.userId ? ` <@${entry.userId}>` : ""}`}
                    className="conv-scope-tag"
                    style={{ border: `1px solid ${scopeTag.color}`, color: scopeTag.color }}
                  >
                    <scopeTag.icon style={{ width: 10, height: 10 }} />
                    {scopeTag.label}
                  </div>
                  <div className="conv-log-text" style={{ color: isUser ? "var(--text)" : "var(--text-secondary)" }}>
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
                  <div className="conv-log-timestamp">
                    <Clock style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
                    <span className="muted" style={{ fontSize: 10, whiteSpace: "nowrap" }}>
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
                  <div className="conv-log-expanded" style={{ animation: "slideDown 0.15s ease" }}>
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
