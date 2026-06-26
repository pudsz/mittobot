import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderSync, ListChecks, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import DropdownSelect from "./DropdownSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";
import useToggleSet from "../hooks/useToggleSet.js";
import ErrorRetry from "./ErrorRetry.jsx";

function ResultList({ title, icon: Icon, items }) {
  if (!items?.length) return null;
  return (
    <div className="sync-result-list">
      <div className="sync-result-title"><Icon /> <span>{title}</span></div>
      {items.map((item) => (
        <div className="sync-result-item" key={(item.id || item.name) + title}>
          <span>{item.name}</span>
          {item.reason && <small>{item.reason}</small>}
        </div>
      ))}
    </div>
  );
}

export default function ChannelsTab({ guildId }) {
  const toast = useToast();
  const { data, loading, error, refetch } = useGuildData(guildId, "/api/channels");

  const [scope, setScope] = useState("category");
  const [categoryId, setCategoryId] = useState("");
  const [selected, toggleSelected, setSelected] = useToggleSet();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (data && !categoryId && data.categories?.length) {
      setCategoryId(data.categories[0].id);
    }
  }, [data, categoryId]);

  const categoriesById = useMemo(() => {
    const map = new Map();
    for (const c of data?.categories || []) map.set(c.id, c);
    return map;
  }, [data]);

  const channelItems = useMemo(() => {
    return (data?.channels || []).map((channel) => {
      const category = categoriesById.get(channel.parentId);
      return { ...channel, name: `${channel.name} · ${category?.name || "No category"}` };
    });
  }, [categoriesById, data]);

  const previewChannels = useMemo(() => {
    if (!data) return [];
    if (scope === "all") return data.channels || [];
    if (scope === "category") return (data.channels || []).filter((ch) => ch.parentId === categoryId);
    return (data.channels || []).filter((ch) => selected.has(ch.id));
  }, [categoryId, data, scope, selected]);

  function selectCategoryChildren() {
    const ids = (data?.channels || [])
      .filter((ch) => ch.parentId === categoryId)
      .map((ch) => ch.id);
    setSelected((prev) => new Set([...prev, ...ids]));
  }

  async function sync() {
    if (scope === "all" && !window.confirm("Sync every categorized channel?")) return;
    const body = { scope, reason };
    if (scope === "category") body.categoryId = categoryId;
    if (scope === "selected") body.channelIds = [...selected];

    setBusy(true);
    setResult(null);
    try {
      const r = await api("POST", "/api/channels/sync", { guildId, ...body });
      setResult(r);
      toast(`Synced ${r.counts.synced}/${r.total} channel(s)`);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-text" style={{ width: "60%" }} /><div className="skeleton skeleton-card" style={{ height: 80 }} /></Panel>
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" /><div className="skeleton skeleton-card" style={{ height: 100 }} /></Panel>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tab active">
        <Panel>
          <ErrorRetry message={error} onRetry={refetch} />
        </Panel>
      </div>
    );
  }

  if (!data) return <div className="tab active" />;

  return (
    <div className="tab active">
      <Panel icon={FolderSync} title="Channel Permissions">
        <p className="muted" style={{ marginBottom: 16 }}>
          {data.hasGuild ? `Editing for: ${data.guildName}` : "Bot isn't in a server yet."}
        </p>
        <div className="field">
          <label>Scope</label>
          <div className="segmented">
            {[["category", "Category"], ["selected", "Selected"], ["all", "All"]].map(([id, label]) => (
              <button key={id} className={scope === id ? "active" : ""} onClick={() => setScope(id)}>{label}</button>
            ))}
          </div>
        </div>
        {(scope === "category" || scope === "selected") && (
          <div className="field">
            <label>Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {(data.categories || []).map((category) => (
                <option key={category.id} value={category.id}>{category.name} ({category.children})</option>
              ))}
            </select>
          </div>
        )}
        {scope === "selected" && (
          <div className="field">
            <label>Channels</label>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn secondary" onClick={selectCategoryChildren}><ListChecks /> <span>Select Category</span></button>
              <button className="btn secondary" onClick={() => setSelected(new Set())}><RotateCcw /> <span>Clear</span></button>
            </div>
            <DropdownSelect items={channelItems} selected={selected} onToggle={toggleSelected} prefix="#" placeholder="Select channels..." max={8} />
          </div>
        )}
        <div className="field">
          <label>Audit Log Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Dashboard sync" maxLength={400} />
        </div>
        <div className="row">
          <button className="btn green" onClick={sync} disabled={busy || !data.hasGuild || (scope === "category" && !categoryId) || (scope === "selected" && !selected.size)}>
            <FolderSync /> {busy ? "Syncing..." : "Sync Permissions"}
          </button>
          <button className="btn secondary" onClick={refetch} disabled={busy}><RefreshCw /> Refresh</button>
        </div>
      </Panel>
      <Panel icon={ListChecks} title="Preview">
        <div className="channel-preview">
          {!previewChannels.length ? (
            <div className="muted">No channels selected.</div>
          ) : (
            previewChannels.map((channel) => {
              const category = categoriesById.get(channel.parentId);
              return (
                <div className="channel-preview-row" key={channel.id}>
                  <span>#{channel.name}</span>
                  <small>{category?.name || "No category"} · {channel.type}</small>
                  <span className={"badge " + (channel.permissionsLocked ? "ok" : "warn")}>
                    {channel.permissionsLocked ? "synced" : "custom"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Panel>
      {result && (
        <Panel icon={CheckCircle2} title="Last Sync">
          <div className="sync-counts">
            <div><strong>{result.counts.synced}</strong><span>Synced</span></div>
            <div><strong>{result.counts.failed}</strong><span>Failed</span></div>
            <div><strong>{result.counts.skipped}</strong><span>Skipped</span></div>
          </div>
          <ResultList title="Synced" icon={CheckCircle2} items={result.synced} />
          <ResultList title="Failed" icon={AlertTriangle} items={result.failed} />
          <ResultList title="Skipped" icon={AlertTriangle} items={result.skipped} />
        </Panel>
      )}
    </div>
  );
}
