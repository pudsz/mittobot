import { useEffect, useState, useCallback } from "react";
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
 * @returns {{ data, loading, refetch }}
 */
export default function useGuildData(guildId, endpoint, { extract, lazy } = {}) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!lazy);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const qs = guildId ? `?guildId=${guildId}` : "";
      const result = await api("GET", `${endpoint}${qs}`);
      setData(extract ? extract(result) : result);
    } catch (e) {
      toast(e.message, true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [guildId, endpoint, extract, toast]);

  useEffect(() => {
    if (!lazy) refetch();
  }, [refetch, lazy]);

  return { data, loading, refetch };
}
