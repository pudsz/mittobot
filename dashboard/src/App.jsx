import { useEffect, useState, useCallback, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Disc, RefreshCw, KeyRound, X } from "lucide-react";
import { api, setToken, clearToken, onUnauthorized, BASE } from "./api.js";
import { ToastProvider } from "./components/Toast.jsx";
import { initTheme } from "./theme.js";
import HomePage from "./pages/HomePage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import DocsPage from "./pages/DocsPage.jsx";

initTheme();

// ─── Login ───────────────────────────────────────────────────────────────────
function Login({ onLoggedIn, onBack }) {
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
      <div className="card login-card">
        <button className="login-back-btn" onClick={onBack} aria-label="Back to landing">
          <X style={{ width: 16, height: 16 }} />
        </button>
        <div className="login-header">
          <h1>ggboi</h1>
        </div>
        <div className="muted">Control Panel</div>
        <div className="login-divider" />

        {hasDiscordOAuth && !pwMode ? (
          <>
            <a
              href={BASE + "/api/auth/discord"}
              className="btn primary auth-btn-full auth-btn-lg auth-link-btn"
            >
              <Disc style={{ width: 18, height: 18 }} />
              <span>Login with Discord</span>
            </a>
            {err && <div className="login-error">{err}</div>}
            <div className="muted auth-note">
              Admins can manage their servers. Bot owners see all servers.
            </div>
            <hr className="auth-divider" />
            <button
              className="btn auth-btn-full"
              onClick={() => setPwMode(true)}
            >
              <KeyRound /> <span>Password login (fallback)</span>
            </button>
          </>
        ) : (
          <>
            <input
              className="auth-input"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") passwordLogin(); }}
            />
            <button className="btn primary auth-btn-full" onClick={passwordLogin}>
              <KeyRound /> <span>Log in</span>
            </button>
            {hasDiscordOAuth && (
              <button
                className="btn auth-btn-full"
                onClick={() => { setPwMode(false); setErr(""); }}
              >
                <Disc /> <span>Back to Discord login</span>
              </button>
            )}
            <div className="login-error login-error-slot">{err}</div>
          </>
        )}
      </div>
    </div>
  );
}

function ConnectingScreen({ retryCount, onRetry, maxRetries, onBack }) {
  const pct = Math.min(retryCount / maxRetries, 1);
  const isFailed = retryCount >= maxRetries;

  return (
    <div id="login">
      <div className="card login-card connecting-card">
        <button className="login-back-btn" onClick={onBack} aria-label="Back">
          <X style={{ width: 16, height: 16 }} />
        </button>
        <div className="login-header login-header-centered">
          <h1>ggboi</h1>
        </div>
        <div className="login-divider" />

        {!isFailed ? (
          <>
            <div className="spinner" />
            <div className="muted">Connecting to bot API...</div>
            <div className="connect-progress">
              <div
                className="connect-progress-bar"
                style={{
                  width: `${pct * 100}%`,
                }}
              />
            </div>
            <div className="muted connect-attempt">
              Attempt {retryCount + 1} of {maxRetries}...
            </div>
          </>
        ) : (
          <>
            <div className="muted connect-warning">
              ⚠️ Could not connect to bot API
            </div>
            <div className="muted connect-help">
              Make sure the bot is running and the API server is accessible.
            </div>
            <button className="btn primary auth-btn-full" onClick={onRetry}>
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
      <Route path="/docs" element={<DocsPage />} />
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

  const [showLoginForm, setShowLoginForm] = useState(false);

  return (
    <ToastProvider>
      {authed === null ? (
        <ConnectingScreen
          retryCount={retryCount}
          maxRetries={MAX_RETRIES}
          onRetry={retry}
          onBack={() => setAuthed(false)}
        />
      ) : authed ? (
        <AppRoutes
          user={user}
          onLogout={logout}
          isAdminMode={isAdminMode}
          onToggleMode={toggleMode}
        />
      ) : showLoginForm ? (
        <Login onLoggedIn={() => attemptConnect()} onBack={() => setShowLoginForm(false)} />
      ) : (
        <LandingPage onGetStarted={() => setShowLoginForm(true)} />
      )}
    </ToastProvider>
  );
}
