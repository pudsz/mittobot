import { useEffect, useState, useCallback, useRef } from "react";
import {
  Activity, Terminal, ShieldAlert, MessageSquareCode, ShieldCheck,
  Settings, Sparkles, Blocks, Database, KeyRound, LogOut, FolderSync,
  Gauge, ScrollText, StickyNote, Zap, ShieldPlus, Mail, RefreshCw,
  Users, Cpu, Disc, Flame, FolderOpen, MessageSquare, TrendingUp,
} from "lucide-react";
import { api, setToken, clearToken, onUnauthorized, BASE } from "./api.js";
import { ToastProvider } from "./components/Toast.jsx";
import StatusTab from "./components/StatusTab.jsx";
import CommandsTab from "./components/CommandsTab.jsx";
import AutomodTab from "./components/AutomodTab.jsx";
import GreetTab from "./components/GreetTab.jsx";
import RolesTab from "./components/RolesTab.jsx";
import ChannelsTab from "./components/ChannelsTab.jsx";
import SettingsTab from "./components/SettingsTab.jsx";
import AiTab from "./components/AiTab.jsx";
import ModulesTab from "./components/ModulesTab.jsx";
import DataTab from "./components/DataTab.jsx";
import ModerationLogTab from "./components/ModerationLogTab.jsx";
import DmTemplateTab from "./components/DmTemplateTab.jsx";
import AutoExecTab from "./components/AutoExecTab.jsx";
import UserNotesTab from "./components/UserNotesTab.jsx";
import ExtendedAutomodTab from "./components/ExtendedAutomodTab.jsx";
import CasesTab from "./components/CasesTab.jsx";
import RoleMembersTab from "./components/RoleMembersTab.jsx";
import DangerZoneTab from "./components/DangerZoneTab.jsx";
import AiChatTab from "./components/AiChatTab.jsx";
import AnalyticsTab from "./components/AnalyticsTab.jsx";

// ─── Guild-management tabs — available to any guild admin ────────────────────
const USER_TABS = [
  { id: "status",     label: "Status",     Icon: Activity },
  { id: "commands",   label: "Commands",   Icon: Terminal },
  { id: "automod",    label: "Automod",    Icon: ShieldAlert },
  { id: "extautomod", label: "Ext. Automod", Icon: ShieldPlus },
  { id: "greet",      label: "Greeting & Logs", Icon: MessageSquareCode },
  { id: "roles",      label: "Roles",      Icon: ShieldCheck },
  { id: "rolemembers",label: "Role Members",Icon: Users },
  { id: "channels",   label: "Channels",   Icon: FolderSync },
  { id: "cases",      label: "Cases",      Icon: FolderOpen },
  { id: "modlog",     label: "Mod Log",    Icon: ScrollText },
  { id: "modnotes",   label: "User Notes", Icon: StickyNote },
  { id: "dmtemplates",label: "DM Templates",Icon: Mail },
  { id: "autoexec",   label: "Auto Rules", Icon: Zap },
  { id: "dangerzone", label: "Dangerzone", Icon: Flame },
];

// ─── Global/critical admin tabs — only visible to bot owners ─────────────────
const ADMIN_TABS = [
  { id: "settings", label: "Settings", Icon: Gauge },
  { id: "ai",       label: "AI Assistant", Icon: Sparkles },
  { id: "aichat",   label: "AI Chat", Icon: MessageSquare },
  { id: "analytics", label: "AI Analytics", Icon: TrendingUp },
  { id: "modules",  label: "Modules",  Icon: Blocks },
  { id: "data",     label: "Data",     Icon: Database },
];

// ─── Login ───────────────────────────────────────────────────────────────────
function Login({ onLoggedIn }) {
  const [err, setErr] = useState("");
  const [pwMode, setPwMode] = useState(false);
  const [pw, setPw] = useState("");

  const [hasDiscordOAuth, setHasDiscordOAuth] = useState(true);
  useEffect(() => {
    fetch(BASE + "/api/auth/discord", { method: "GET", redirect: "manual" })
      .then((res) => {
        if (res.status === 501) setHasDiscordOAuth(false);
      })
      .catch(() => setHasDiscordOAuth(false));
  }, []);

  async function passwordLogin() {
    setErr("");
    try {
      const data = await api("POST", "/login", { password: pw });
      if (data.token) setToken(data.token);
      onLoggedIn();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div id="login">
      <div className="card">
        <div className="login-header">
          <h1>ggboi</h1>
        </div>
        <div className="muted">Control Panel</div>
        <div className="login-divider" />

        {hasDiscordOAuth && !pwMode ? (
          <>
            <a
              href={BASE + "/api/auth/discord"}
              className="btn primary"
              style={{
                width: "100%",
                justifyContent: "center",
                padding: "10px 16px",
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              <Disc style={{ width: 18, height: 18 }} />
              <span>Login with Discord</span>
            </a>
            {err && <div style={{ color: "var(--red)", fontSize: 12, textAlign: "center" }}>{err}</div>}
            <div className="muted" style={{ fontSize: 11, textAlign: "center" }}>
              Admins can manage their servers. Bot owners see all servers.
            </div>
            <hr style={{ margin: "4px 0" }} />
            <button
              className="btn"
              onClick={() => setPwMode(true)}
              style={{ width: "100%", justifyContent: "center" }}
            >
              <KeyRound /> <span>Password login (fallback)</span>
            </button>
          </>
        ) : (
          <>
            <input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") passwordLogin(); }}
            />
            <button className="btn primary" onClick={passwordLogin} style={{ width: "100%", justifyContent: "center" }}>
              <KeyRound /> <span>Log in</span>
            </button>
            {hasDiscordOAuth && (
              <button
                className="btn"
                onClick={() => { setPwMode(false); setErr(""); }}
                style={{ width: "100%", justifyContent: "center" }}
              >
                <Disc /> <span>Back to Discord login</span>
              </button>
            )}
            <div style={{ color: "var(--red)", fontSize: 12, minHeight: 16, textAlign: "center" }}>{err}</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard shell (used by both user and admin views) ─────────────────────
function Dashboard({ user, onLogout, isAdminMode, onToggleMode }) {
  const [tab, setTab] = useState("status");
  const [headerStatus, setHeaderStatus] = useState("loading...");
  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");

  const activeTabs = isAdminMode ? [...USER_TABS, ...ADMIN_TABS] : USER_TABS;

  // Ctrl+K / Cmd+K command palette
  useEffect(() => {
    function onKey(e) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
        setPaletteQuery("");
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = activeTabs.map(t => ({ type: "tab", label: t.label, id: t.id, Icon: t.Icon }));
  const filteredPalette = paletteQuery.trim()
    ? paletteItems.filter(t => t.label.toLowerCase().includes(paletteQuery.toLowerCase()))
    : paletteItems;

  async function fetchGuilds() {
    try {
      const { guilds: list } = await api("GET", "/api/guilds");
      setGuilds(list);
      if (list.length > 0 && !guildId) setGuildId(list[0].id);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const s = await api("GET", "/api/status");
        if (alive) setHeaderStatus((s.tag || "offline") + " · " + s.ping + "ms");
      } catch { /* ignore */ }
    }
    tick();
    fetchGuilds();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const [aiKey, setAiKey] = useState(0);

  // When switching between admin/user mode, reset to a tab that exists in both
  useEffect(() => {
    const currentExists = activeTabs.some(t => t.id === tab);
    if (!currentExists) setTab("status");
  }, [isAdminMode]);

  return (
    <div id="app">
      <aside>
        <div className="brand-header">
          <span className="brand-title">ggboi</span>
          {isAdminMode && <span className="badge owner" style={{ fontSize: 9, padding: "1px 5px" }}>admin</span>}
        </div>
        <div className="status-container">
          <span className="status-dot"></span>
          <span>{headerStatus}</span>
        </div>

        {user && (
          <div className="user-info">
            <img
              className="user-avatar"
              src={
                user.avatar
                  ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                  : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`
              }
              alt=""
              referrerPolicy="no-referrer"
            />
            <div className="user-details">
              <span className="user-name">{user.tag}</span>
              {user.isOwner && <span className="badge owner">owner</span>}
            </div>
          </div>
        )}

        {guilds.length > 1 && (
          <div className="guild-selector">
            <select value={guildId} onChange={(e) => setGuildId(e.target.value)}>
              {guilds.map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>
              ))}
            </select>
          </div>
        )}
        {guilds.length === 1 && (
          <div className="guild-selector muted" style={{ padding: "0 8px", fontSize: 11 }}>
            {guilds[0].name}
          </div>
        )}

        <nav>
          <div className="nav-section-label">Guild</div>
          {USER_TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon /> <span>{label}</span>
            </button>
          ))}
          {isAdminMode && (
            <>
              <hr style={{ margin: "8px 0" }} />
              <div className="nav-section-label">Admin</div>
              {ADMIN_TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={tab === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  <Icon /> <span>{label}</span>
                </button>
              ))}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          {user?.isOwner && (
            <button
              className="btn"
              onClick={onToggleMode}
              style={{ width: "100%", justifyContent: "center", marginBottom: 4, fontSize: 12 }}
            >
              <Cpu style={{ width: 14, height: 14 }} />
              <span>{isAdminMode ? "Switch to User View" : "Switch to Admin View"}</span>
            </button>
          )}
          <button className="btn" onClick={onLogout} style={{ width: "100%", justifyContent: "center" }}>
            <LogOut /> <span>Log out</span>
          </button>
        </div>
      </aside>

      <div className="content-area">
        <header>
          <h1>ggboi / {activeTabs.find(t => t.id === tab)?.label || tab}</h1>
          <div className="spacer"></div>
        </header>
        <main>
          {tab === "status" && <StatusTab onStatus={(s) => setHeaderStatus((s.tag || "offline") + " · " + s.ping + "ms")} admin={isAdminMode} />}
          {tab === "commands" && <CommandsTab guildId={guildId} />}
          {tab === "automod" && <AutomodTab guildId={guildId} />}
          {tab === "greet" && <GreetTab guildId={guildId} />}
          {tab === "roles" && <RolesTab guildId={guildId} />}
          {tab === "rolemembers" && <RoleMembersTab guildId={guildId} />}
          {tab === "channels" && <ChannelsTab guildId={guildId} />}
          {tab === "cases" && <CasesTab guildId={guildId} />}
          {tab === "modlog" && <ModerationLogTab guildId={guildId} />}
          {tab === "modnotes" && <UserNotesTab guildId={guildId} />}
          {tab === "dmtemplates" && <DmTemplateTab guildId={guildId} />}
          {tab === "autoexec" && <AutoExecTab guildId={guildId} />}
          {tab === "dangerzone" && <DangerZoneTab guildId={guildId} />}
          {tab === "extautomod" && <ExtendedAutomodTab guildId={guildId} />}
          {tab === "settings" && <SettingsTab onReset={() => setAiKey((k) => k + 1)} />}
          {tab === "ai" && <AiTab key={aiKey} />}
          {tab === "aichat" && <AiChatTab guildId={guildId} />}
          {tab === "analytics" && <AnalyticsTab />}
          {tab === "modules" && <ModulesTab />}
          {tab === "data" && <DataTab />}
        </main>
      </div>

      {/* ─── Command Palette (Ctrl+K) ─── */}
      {paletteOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(0,0,0,0.6)", display: "flex", justifyContent: "center",
            paddingTop: "15vh",
          }}
          onClick={() => setPaletteOpen(false)}
        >
          <div
            style={{
              background: "var(--bg-alt)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)", width: 520, maxWidth: "90vw",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden",
              animation: "scaleIn 0.15s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
              <input
                autoFocus
                placeholder="Search tabs and actions..."
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                style={{ flex: 1, border: "none", background: "none", fontSize: 14, padding: 4, outline: "none" }}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>↵</span>
            </div>
            <div style={{ maxHeight: 360, overflowY: "auto", padding: "4px 0" }}>
              {filteredPalette.length === 0 ? (
                <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 13 }}>No results</div>
              ) : (
                filteredPalette.map((item, i) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
                      cursor: "pointer", fontSize: 13, transition: "background 0.1s",
                      background: i === 0 ? "var(--surface)" : "transparent",
                    }}
                    className="palette-item"
                    onClick={() => { setTab(item.id); setPaletteOpen(false); }}
                    onMouseEnter={(e) => {
                      [...e.currentTarget.parentElement.children].forEach(el => el.style.background = "transparent");
                      e.currentTarget.style.background = "var(--surface)";
                    }}
                  >
                    <item.Icon style={{ width: 16, height: 16, color: "var(--text-muted)" }} />
                    <span>{item.label}</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ borderTop: "1px solid var(--border)", padding: "6px 16px", fontSize: 10, color: "var(--text-muted)", display: "flex", gap: 12 }}>
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>Esc close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectingScreen({ retryCount, onRetry, maxRetries }) {
  const pct = Math.min(retryCount / maxRetries, 1);
  const isFailed = retryCount >= maxRetries;

  return (
    <div id="login">
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <div className="login-header" style={{ justifyContent: "center" }}>
          <h1>ggboi</h1>
        </div>
        <div className="login-divider" />

        {!isFailed ? (
          <>
            <div className="spinner" />
            <div className="muted">Connecting to bot API...</div>
            <div style={{ width: "100%", background: "var(--surface)", borderRadius: 4, height: 4, marginTop: 4 }}>
              <div
                style={{
                  width: `${pct * 100}%`,
                  background: "var(--accent)",
                  borderRadius: 4,
                  height: 4,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              Attempt {retryCount + 1} of {maxRetries}...
            </div>
          </>
        ) : (
          <>
            <div className="muted" style={{ color: "var(--orange)", marginBottom: 4 }}>
              ⚠️ Could not connect to bot API
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Make sure the bot is running and the API server is accessible on port 3001.
            </div>
            <button className="btn primary" onClick={onRetry} style={{ width: "100%", justifyContent: "center" }}>
              <RefreshCw /> <span>Retry connection</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);    // null=loading, true=logged in, false=show login
  const [user, setUser] = useState(null);        // user info from /api/me
  const [isAdminMode, setIsAdminMode] = useState(false); // admin vs user view toggle
  const [retryCount, setRetryCount] = useState(0);
  const showLogin = useCallback(() => setAuthed(false), []);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const MAX_RETRIES = 8;

  // Handle Discord OAuth callback — extract token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const error = params.get("error");
    if (token) {
      setToken(token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (error) {
      console.error("Login error:", error);
      alert("Login failed: " + decodeURIComponent(error));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const attemptConnect = useCallback(() => {
    api("GET", "/api/me")
      .then((data) => {
        if (mountedRef.current) {
          setUser(data.user);
          setIsAdminMode(data.user?.isOwner === true);
          setAuthed(true);
        }
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setRetryCount((prev) => {
          const next = prev + 1;
          if (next < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(1.5, next), 16000);
            timerRef.current = setTimeout(attemptConnect, delay);
          }
          return next;
        });
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    onUnauthorized(showLogin);
    attemptConnect();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [showLogin, attemptConnect]);

  function retry() {
    setRetryCount(0);
    attemptConnect();
  }

  function logout() {
    clearToken();
    setAuthed(false);
  }

  function toggleMode() {
    setIsAdminMode((prev) => !prev);
  }

  return (
    <ToastProvider>
      {authed === null ? (
        <ConnectingScreen
          retryCount={retryCount}
          maxRetries={MAX_RETRIES}
          onRetry={retry}
        />
      ) : authed ? (
        <Dashboard
          user={user}
          onLogout={logout}
          isAdminMode={isAdminMode}
          onToggleMode={toggleMode}
        />
      ) : (
        <Login onLoggedIn={() => attemptConnect()} />
      )}
    </ToastProvider>
  );
}
