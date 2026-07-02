import { useState } from "react";
import { HardDrive, Plus, Trash2, RotateCcw, Info } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import useGuildData from "../hooks/useGuildData.js";

export default function BackupTab({ guildId }) {
  const toast = useToast();
  const { data, loading, refetch } = useGuildData(guildId, "/api/backup", {
    extract: (res) => res.backups || [],
  });
  // Override: data is the backups array itself
  const backups = Array.isArray(data) ? data : (data?.backups || []);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [infoId, setInfoId] = useState(null);
  const [infoData, setInfoData] = useState(null);
  const [restoring, setRestoring] = useState(null);

  async function handleCreate() {
    try {
      await api("POST", "/api/backup", { guildId, name: name.trim() || undefined });
      toast("Backup created");
      setShowForm(false);
      setName("");
      refetch();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this backup?")) return;
    try {
      await api("DELETE", `/api/backup/${id}?guildId=${guildId}`);
      toast("Backup deleted");
      refetch();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function handleRestore(id, backupName) {
    if (!window.confirm(`Restore backup "${backupName}"? This will create roles and channels from the backup. Existing items with the same name will be skipped.`)) return;
    setRestoring(id);
    try {
      const result = await api("POST", `/api/backup/${id}/restore`, { guildId });
      const s = result.summary;
      toast(`Restored: ${s.rolesCreated} roles, ${s.categoriesCreated} categories, ${s.channelsCreated} channels${s.errors?.length ? ` (${s.errors.length} errors)` : ""}`);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setRestoring(null);
    }
  }

  async function handleInfo(id) {
    if (infoId === id) { setInfoId(null); setInfoData(null); return; }
    try {
      const { backup } = await api("GET", `/api/backup/${id}`);
      setInfoId(id);
      setInfoData(backup);
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text skeleton-w70" /></Panel>
        {[1, 2].map(i => <Panel key={i}><div className="skeleton skeleton-heading skeleton-w40" /><div className="skeleton skeleton-text" /></Panel>)}
      </div>
    );
  }

  return (
    <div className="tab active">
      <Panel icon={HardDrive} title="Server Backups">
        <p className="muted backup-desc-mb">
          Backup your server structure: roles (with permissions), categories, channels (with permissions & settings).
          Restore backs up roles, categories, and channels to a new state. Existing items with the same name are skipped.
        </p>
        <button className="btn green" onClick={() => setShowForm(true)}><Plus /> New Backup</button>
      </Panel>

      {showForm && (
        <Panel>
          <h2>Create Backup</h2>
          <div className="field">
            <label>Backup name (optional)</label>
            <input
              placeholder={`Backup ${new Date().toLocaleDateString()}`}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
            />
          </div>
          <div className="row backup-actions-mt">
            <button className="btn green" onClick={handleCreate}><Plus /> Create</button>
            <button className="btn secondary" onClick={() => { setShowForm(false); setName(""); }}>Cancel</button>
          </div>
        </Panel>
      )}

      {!backups.length ? (
        <Panel><div className="panel-empty">No backups yet. Create one to save your server structure.</div></Panel>
      ) : (
        backups.map(b => (
          <Panel compact key={b.id}>
            <div className="backup-item-row">
              <HardDrive size={16} className="backup-item-icon" />
              <span className="badge info">#{b.id}</span>
              <span className="backup-item-name flex-1">{b.name}</span>
              <span className="muted flex-shrink-0">
                {new Date(b.created_at).toLocaleDateString()} by {b.created_by || "unknown"}
              </span>
              <button className="btn secondary sm" onClick={() => handleInfo(b.id)}>
                <Info size={14} />
              </button>
              <button className="btn sm" onClick={() => handleRestore(b.id, b.name)} disabled={restoring === b.id}>
                <RotateCcw size={14} /> {restoring === b.id ? "..." : "Restore"}
              </button>
              <button className="btn danger sm" onClick={() => handleDelete(b.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            {infoId === b.id && infoData && (
              <div className="backup-info-box">
                <strong>Backup contents:</strong>{" "}
                {infoData.data?.roles?.length ?? 0} roles · {infoData.data?.categories?.length ?? 0} categories · {infoData.data?.channels?.length ?? 0} channels
                {infoData.data?.roles?.length > 0 && (
                  <div className="muted mt-1">
                    Roles: {infoData.data.roles.slice(0, 10).map(r => r.name).join(", ")}{infoData.data.roles.length > 10 ? ` +${infoData.data.roles.length - 10} more` : ""}
                  </div>
                )}
              </div>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
