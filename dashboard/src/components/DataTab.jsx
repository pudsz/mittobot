import { useEffect, useState } from "react";
import { Database, RotateCw } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";

const STORES = ["stickies", "warnings", "reactionlogs", "afkUsers", "customRoles"];

export default function DataTab() {
  const toast = useToast();
  const [store, setStore] = useState("stickies");
  const [view, setView] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData(s = store) {
    try {
      const { data } = await api("GET", "/api/data/" + s);
      setView(JSON.stringify(data, null, 2));
    } catch (e) {
      toast(e.message, true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="tab active">
        <Panel>
          <div className="skeleton skeleton-heading" />
          <div className="skeleton-row">
            <div className="skeleton" style={{ width: 200, height: 40, borderRadius: "var(--radius-sm)" }} />
            <div className="skeleton" style={{ width: 100, height: 40, borderRadius: "var(--radius-sm)" }} />
          </div>
          <div className="skeleton" style={{ height: 300, borderRadius: "var(--radius-sm)", marginTop: 16 }} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="tab active">
      <Panel icon={Database} title="Stored Data Explorer">
        <div className="row" style={{ marginBottom: 14 }}>
          <select value={store} onChange={(e) => { setStore(e.target.value); setLoading(true); loadData(e.target.value); }}>
            {STORES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn secondary" onClick={() => { setLoading(true); loadData(); }}>
            <RotateCw /> Refresh
          </button>
        </div>
        <pre>{view}</pre>
      </Panel>
    </div>
  );
}
