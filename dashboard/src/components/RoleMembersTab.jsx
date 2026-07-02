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
        <p className="muted mb-3">
          Select one or more roles to see their member lists. No pings are sent — members are shown by username only.
        </p>
        <div className="row mb-3 rolemembers-row-end">
          <div className="flex-1">
            <DropdownSelect items={roles} selected={selected} onToggle={toggleSelected} prefix="@" placeholder="Select roles to view..." label="Roles" />
          </div>
          <button className="btn primary rolemembers-btn-end" onClick={fetchMembers} disabled={selected.size === 0 || loading}>
            <RefreshCw className={loading ? "spinning" : ""} />{loading ? "Loading..." : "Show Members"}
          </button>
        </div>
      </Panel>

      {loading && (
        <Panel>
          {[1, 2].map((i) => (
            <div key={i} className="mb-3">
              <div className="skeleton skeleton-heading" style={{ width: "30%" }} />
              {[1, 2, 3].map((j) => <div className="skeleton skeleton-text" key={j} style={{ width: `${60 + j * 10}%` }} />)}
            </div>
          ))}
        </Panel>
      )}

      {loaded && data && data.roles.length === 0 && <Panel><p className="muted">No members found for the selected roles.</p></Panel>}

      {loaded && data && data.roles.length > 0 && (
        <Panel>
          <div className="row rolemembers-mb-14">
            <div className="flex-1 rolemembers-search-wrap">
              <Search className="rolemembers-search-icon" />
              <input className="rolemembers-search-input" placeholder="Filter by role name or member name..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <span className="muted">{filteredRoles.reduce((sum, r) => sum + r.members.length, 0)} member(s) in {filteredRoles.length} role(s)</span>
          </div>
          {filteredRoles.length === 0 ? (
            <div className="muted rolemembers-filter-empty">No roles match your filter.</div>
          ) : (
            filteredRoles.map((role) => (
              <Panel compact key={role.id} className="mb-2" style={{ borderLeft: `3px solid ${role.color !== "#000000" ? role.color : "var(--border)"}` }}>
                <h3 className="row mb-2 rolemembers-role-header">
                  <span className="rolemembers-role-name">{role.name}</span>
                  <span className="badge info">{role.memberCount} member{role.memberCount !== 1 ? "s" : ""}</span>
                </h3>
                <div className="rolemembers-member-grid">
                  {role.members.length === 0 ? (
                    <span className="muted">No members</span>
                  ) : (
                    role.members.map((mem) => (
                      <div key={mem.id} className="rolemembers-member-item">
                        <img src={mem.avatarURL} alt="" className="rolemembers-member-avatar" />
                        <span className="rolemembers-member-name">{mem.displayName}</span>
                        {mem.isBot && <span className="badge rolemembers-bot-badge">BOT</span>}
                        <span className="muted rolemembers-member-id">{mem.id.slice(0, 6)}…</span>
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
          <div className="muted rolemembers-empty-state">
            <UserCircle className="rolemembers-empty-icon" />
            <div>Select one or more roles above and click "Show Members"</div>
          </div>
        </Panel>
      )}
    </div>
  );
}
