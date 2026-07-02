import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { get, getToken, setToken, clearToken, onUnauthorized } from "@/lib/api";
import { queryClient } from "@/lib/query";
import type { User, Guild } from "@/lib/types";

interface AuthState {
  user: User | null;
  guilds: Guild[];
  loading: boolean;
  /** OAuth #error= message, if the redirect carried one. */
  authError: string | null;
  login: (token: string) => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Pull #token= / #error= out of the URL hash (Discord OAuth redirect). */
function consumeHashParams(): { token: string | null; error: string | null } {
  const hash = window.location.hash.slice(1);
  if (!hash) return { token: null, error: null };
  const params = new URLSearchParams(hash);
  const token = params.get("token");
  const error = params.get("error");
  if (token || error) {
    // Clean the hash so tokens never linger in the address bar / history.
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return { token, error };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setGuilds([]);
      setLoading(false);
      return;
    }
    try {
      const me = await get<{ user: User; guilds: Guild[] }>("/api/me");
      setUser(me.user);
      setGuilds(me.guilds || []);
    } catch {
      setUser(null);
      setGuilds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { token, error } = consumeHashParams();
    if (token) setToken(token);
    if (error) setAuthError(error);
    onUnauthorized(() => {
      setUser(null);
      setGuilds([]);
      queryClient.clear();
    });
    refresh();
  }, [refresh]);

  const login = useCallback(
    (token: string) => {
      setToken(token);
      setAuthError(null);
      setLoading(true);
      refresh();
    },
    [refresh]
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setGuilds([]);
    queryClient.clear();
  }, []);

  const value = useMemo(
    () => ({ user, guilds, loading, authError, login, logout, refresh }),
    [user, guilds, loading, authError, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
