import { useEffect } from "react";
import { UserPlus, Fingerprint, Save } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import DropdownSelect from "./DropdownSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";
import useToggleSet from "../hooks/useToggleSet.js";

export default function RolesTab({ guildId }) {
  const toast = useToast();
  const { data, loading } = useGuildData(guildId, "/api/roles");
  const [autoSel, toggleAuto, setAutoSel] = useToggleSet();

  // Sync autoroles from fetched data
  useEffect(() => {
    if (data) setAutoSel(new Set(data.autoroles || []));
  }, [data, setAutoSel]);

  async function saveAutoroles() {
    try {
      await api("POST", "/api/roles/autoroles", { guildId, autoroles: [...autoSel] });
      toast("Autoroles saved");
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function removeReactionRole(messageId, key) {
    try {
      await api("POST", "/api/roles/reaction/remove", { guildId, messageId, key });
      toast("Removed");
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "80%" }} /><div className="skeleton skeleton-text" style={{ width: "40%" }} /></Panel>
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "60%" }} /></Panel>
      </div>
    );
  }

  if (!data) return <div className="tab active" />;
  const map = data.reactionRoles || {};
  const msgIds = Object.keys(map);

  function roleName(id) {
    return (data.roles.find((r) => r.id === id) || {}).name || id;
  }

  return (
    <div className="tab active">
      <Panel icon={UserPlus} title="Autoroles">
        <p className="muted" style={{ marginBottom: 12 }}>
          {data.hasGuild ? `Editing for: ${data.guildName}` : "Bot isn't in a server yet."}
        </p>
        <p className="muted" style={{ marginBottom: 10 }}>
          Click roles to toggle. Selected roles are granted to every new member on join.
        </p>
        <DropdownSelect items={data.roles} selected={autoSel} onToggle={toggleAuto} prefix="@" placeholder="Select autoroles..." />
        <button className="btn green" onClick={saveAutoroles} style={{ marginTop: 12 }}>
          <Save /> <span>Save autoroles</span>
        </button>
      </Panel>
      <Panel icon={Fingerprint} title="Reaction Roles">
        <p className="muted" style={{ marginBottom: 10 }}>
          Set these up in Discord with <code>$reactionrole add &lt;messageId&gt; &lt;emoji&gt; &lt;@role&gt;</code>. Existing bindings are listed below.
        </p>
        <div>
          {!msgIds.length ? (
            <div className="muted">No reaction roles set up yet.</div>
          ) : (
            msgIds.flatMap((mid) =>
              Object.entries(map[mid]).map(([key, rid]) => {
                const emoji = /^\d+$/.test(key) ? "(custom emoji)" : key;
                return (
                  <div className="mod-item" key={mid + ":" + key}>
                    <span className="name">{emoji} → @{roleName(rid)}</span>
                    <small>msg {mid.slice(0, 12)}…</small>
                    <button className="btn danger" onClick={() => removeReactionRole(mid, key)}>Remove</button>
                  </div>
                );
              })
            )
          )}
        </div>
      </Panel>
    </div>
  );
}
