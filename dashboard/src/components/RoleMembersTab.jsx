import { useEffect, useState, useCallback } from "react";
import { Users, UserCircle, RefreshCw, Search } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import DropdownSelect from "./DropdownSelect.jsx";
import useToggleSet from "../hooks/useToggleSet.js";

export default function RoleMembersTab({ guildId }) {
  const toast = useToast();
  const [roles, setRoles] = useState([]);
  const [selected, toggleSelected, setSelected] = useToggleSet();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");

  // Fetch available roles on mount/guild change
  useEffect(() => {
    async function fetchRoles() {
      try {
        const qs = guildId ? `?guildId=${guildId}` : "";
        const d = await api("GET", `/api/roles${qs}`);
        setRoles(d.roles || []);
      } catch (e) { toast(e.message, true); }
    }
    fetchRoles();
  }, [guildId, toast]);

  const fetchMembers = useCallback(async () => {
    if (!selected.size || !guildId) return;
    setLoading(true);
    setLoaded(false);
    try {
      const roleIds = [...selected].join(",");
      const d = await api("GET", `/api/roles/members?guildId=${guildId}&roleIds=${roleIds}`);
      setData(d);
      setLoaded(true);
    } catch (e) { toast(e.message, true); } finally { setLoading(false); }
  }, [selected, guildId, toast]);

  const q = search.toLowerCase();
  const filteredRoles = data?.roles?.filter((r) => {
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.members.some((m) => m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q));
  }) || [];

  return (
    <div className="tab active">
      <Panel icon={Users} title="Role Members">
        <p className="muted" style={{ marginBottom: 12 }}>
          Select one or more roles to see their member lists. No pings are sent — members are shown by username only.
        </p>
        <div className="row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <DropdownSelect items={roles} selected={selected} onToggle={toggleSelected} prefix="@" placeholder="Select roles to view..." label="Roles" />
          </div>
          <button className="btn primary" onClick={fetchMembers} disabled={selected.size === 0 || loading} style={{ alignSelf: "flex-end", marginBottom: 0 }}>
            <RefreshCw className={loading ? "spinning" : ""} />{loading ? "Loading..." : "Show Members"}
          </button>
        </div>
      </Panel>

      {loading && (
        <Panel>
          {[1, 2].map((i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div className="skeleton skeleton-heading" style={{ width: "30%" }} />
              {[1, 2, 3].map((j) => <div className="skeleton skeleton-text" key={j} style={{ width: `${60 + j * 10}%` }} />)}
            </div>
          ))}
        </Panel>
      )}

      {loaded && data && data.roles.length === 0 && <Panel><p className="muted">No members found for the selected roles.</p></Panel>}

      {loaded && data && data.roles.length > 0 && (
        <Panel>
          <div className="row" style={{ marginBottom: 14 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--text-muted)", pointerEvents: "none" }} />
              <input placeholder="Filter by role name or member name..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 28, width: "100%" }} />
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{filteredRoles.reduce((sum, r) => sum + r.members.length, 0)} member(s) in {filteredRoles.length} role(s)</span>
          </div>
          {filteredRoles.length === 0 ? (
            <div className="muted" style={{ padding: 12 }}>No roles match your filter.</div>
          ) : (
            filteredRoles.map((role) => (
              <Panel compact key={role.id} style={{ marginBottom: 8, borderLeft: `3px solid ${role.color !== "#000000" ? role.color : "var(--border)"}` }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{role.name}</span>
                  <span className="badge info">{role.memberCount} member{role.memberCount !== 1 ? "s" : ""}</span>
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                  {role.members.length === 0 ? (
                    <span className="muted" style={{ fontSize: 12 }}>No members</span>
                  ) : (
                    role.members.map((mem) => (
                      <div key={mem.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12 }}>
                        <img src={mem.avatarURL} alt="" style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, background: "var(--bg)" }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{mem.displayName}</span>
                        {mem.isBot && <span className="badge" style={{ fontSize: 9, padding: "1px 4px" }}>BOT</span>}
                        <span className="muted" style={{ fontSize: 10 }}>{mem.id.slice(0, 6)}…</span>
                      </div>
                    ))
                  )}
                </div>
              </Panel>
            ))
          )}
        </Panel>
      )}

      {!loaded && !loading && (
        <Panel>
          <div className="muted" style={{ textAlign: "center", padding: 20 }}>
            <UserCircle style={{ width: 32, height: 32, margin: "0 auto 8px", opacity: 0.4 }} />
            <div>Select one or more roles above and click "Show Members"</div>
          </div>
        </Panel>
      )}
    </div>
  );
}
