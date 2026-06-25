const BASE = import.meta.env.VITE_BOT_API_URL || "";
const TOKEN_KEY = "ggboi_token";

export { BASE };

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Called by api() on a 401 so the app can drop back to the login screen.
let _onUnauthorized = null;
export function onUnauthorized(fn) {
  _onUnauthorized = fn;
}

export async function api(method, path, body) {
  const opts = { method, headers: {} };
  const token = getToken();
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, opts);
  if (res.status === 401) {
    clearToken();
    if (_onUnauthorized) _onUnauthorized();
    throw new Error("Unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
