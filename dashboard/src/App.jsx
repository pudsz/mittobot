import { useEffect, useState, useCallback, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Disc, RefreshCw, KeyRound } from "lucide-react";
import { api, setToken, clearToken, onUnauthorized, BASE } from "./api.js";
import { ToastProvider } from "./components/Toast.jsx";
import HomePage from "./pages/HomePage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";

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

function AppRoutes({ user, onLogout, isAdminMode, onToggleMode }) {
  return (
    <Routes>
      <Route path="/" element={<HomePage user={user} onLogout={onLogout} />} />
      <Route
        path="/dashboard"
        element={
          <DashboardPage
            user={user}
            onLogout={onLogout}
            isAdminMode={isAdminMode}
            onToggleMode={onToggleMode}
          />
        }
      />
    </Routes>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(null);    // null=loading, true=logged in, false=show login
  const [user, setUser] = useState(null);        // user info from /api/me
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const showLogin = useCallback(() => setAuthed(false), []);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const MAX_RETRIES = 8;

  // Handle Discord OAuth callback
  useEffect(() => {
    let token = null;
    let error = null;
    const hash = window.location.hash.slice(1);
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      token = hashParams.get("token");
      error = hashParams.get("error");
    }
    if (!token && !error) {
      const params = new URLSearchParams(window.location.search);
      token = params.get("token");
      error = params.get("error");
    }
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
    navigate("/");
  }

  const toggleMode = useCallback(() => {
    setIsAdminMode((prev) => !prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ToastProvider>
      {authed === null ? (
        <ConnectingScreen
          retryCount={retryCount}
          maxRetries={MAX_RETRIES}
          onRetry={retry}
        />
      ) : authed ? (
        <AppRoutes
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
