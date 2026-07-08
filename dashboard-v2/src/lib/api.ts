// ─── API client ──────────────────────────────────────────────────────────────
// Same contract as dashboard v1: VITE_BOT_API_URL base (empty in dev — the
// Vite proxy forwards /api and /login), Bearer JWT from localStorage under
// the same "ggboi_token" key so existing sessions carry over to v2.

export const BASE = import.meta.env.VITE_BOT_API_URL || "";
const TOKEN_KEY = "ggboi_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Called by api() on a 401 so the app can drop back to the login screen.
let _onUnauthorized: (() => void) | null = null;
export function onUnauthorized(fn: () => void) {
  _onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T = any>(method: Method, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: {} as Record<string, string> };
  const token = getToken();
  const headers = opts.headers as Record<string, string>;
  if (token) headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, opts);
  if (res.status === 401) {
    clearToken();
    _onUnauthorized?.();
    throw new ApiError("Unauthorized", 401);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || "HTTP " + res.status, res.status);
  return data as T;
}

// Convenience wrappers so call sites read naturally with TanStack Query.
export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body?: unknown) => api<T>("POST", path, body);
export const put = <T = any>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const patch = <T = any>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const del = <T = any>(path: string) => api<T>("DELETE", path);

/** Append ?guildId= to an endpoint when a guild is selected. */
export function guildPath(endpoint: string, guildId?: string) {
  if (!guildId) return endpoint;
  return endpoint + (endpoint.includes("?") ? "&" : "?") + "guildId=" + guildId;
}
