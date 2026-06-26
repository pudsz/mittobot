import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api.js";
import { useToast } from "../components/Toast.jsx";

/**
 * Generic hook for fetching guild-scoped data from an API endpoint.
 *
 * @param {string} guildId  - Current guild ID (triggers refetch on change)
 * @param {string} endpoint - API path (e.g. "/api/automod")
 * @param {object} options
 * @param {function} [options.extract] - Transform the response before storing. Default identity.
 * @param {boolean} [options.lazy]     - If true, skip initial fetch (caller uses refetch).
 * @returns {{ data, loading, error, refetch }}
 */
export default function useGuildData(guildId, endpoint, { extract, lazy } = {}) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!lazy);
  const [error, setError] = useState(null);

  // Keep the latest extract/toast in refs so refetch is memoized on stable
  // inputs only. Without this, an inline `extract` (or a changing toast) would
  // recreate refetch on every render → useEffect re-fires → infinite refetch
  // loop that pins `loading=true`. Refs let us read the latest value inside
  // the stable refetch without making deps depend on referential identity.
  const extractRef = useRef(extract);
  extractRef.current = extract;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = guildId ? `?guildId=${guildId}` : "";
      const result = await api("GET", `${endpoint}${qs}`);
      setData(extractRef.current ? extractRef.current(result) : result);
    } catch (e) {
      setError(e.message || "Failed to load data");
      toastRef.current(e.message, true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [guildId, endpoint]);

  useEffect(() => {
    if (!lazy) refetch();
  }, [refetch, lazy]);

  return { data, loading, error, refetch };
}
