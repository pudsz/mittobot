import { useEffect, useState, useRef } from "react";
import { Box, RotateCw, Code2, Send, Eraser } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";

const DEFAULT_CODE = `module.exports = {
  name: 'hello',
  description: 'Say hello',
  prefix: async (message, args) => {
    await message.reply('Hello!');
  }
};`;

export default function ModulesTab() {
  const toast = useToast();
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState(DEFAULT_CODE);
  const editorRef = useRef(null);

  async function loadModules() {
    try {
      const { modules } = await api("GET", "/api/modules");
      setModules(modules);
    } catch (e) { toast(e.message, true); } finally { setLoading(false); }
  }
  useEffect(() => { loadModules(); }, []);

  function newModule() { setEditingName(null); setName(""); setCode(DEFAULT_CODE); }

  async function editModule(modName) {
    try {
      const m = await api("GET", "/api/modules/" + modName);
      setEditingName(modName);
      setName(modName);
      setCode(m.code);
      if (editorRef.current) editorRef.current.scrollIntoView({ behavior: "smooth" });
    } catch (e) { toast(e.message, true); }
  }

  async function saveModule() {
    if (!name.trim()) return toast("Name required", true);
    try {
      await api("POST", "/api/modules", { name: name.trim(), code });
      toast("Module $" + name.trim() + " saved & loaded");
      await loadModules();
    } catch (e) { toast(e.message, true); }
  }

  async function reloadModule(modName) {
    try {
      await api("POST", "/api/modules/" + modName + "/reload");
      toast("Reloaded " + modName);
      await loadModules();
    } catch (e) { toast(e.message, true); }
  }

  async function deleteModule(modName) {
    if (!window.confirm("Delete module $" + modName + "?")) return;
    try {
      await api("DELETE", "/api/modules/" + modName);
      toast("Deleted " + modName);
      await loadModules();
      if (editingName === modName) newModule();
    } catch (e) { toast(e.message, true); }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel>
          <div className="skeleton skeleton-heading" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton skeleton-circle" />
              <div className="skeleton skeleton-text" />
              <div className="skeleton" style={{ width: 60, height: 32, borderRadius: "var(--radius-sm)" }} />
              <div className="skeleton" style={{ width: 80, height: 32, borderRadius: "var(--radius-sm)" }} />
              <div className="skeleton" style={{ width: 70, height: 32, borderRadius: "var(--radius-sm)" }} />
            </div>
          ))}
        </Panel>
        <Panel>
          <div className="skeleton skeleton-heading" style={{ width: "35%" }} />
          <div className="skeleton skeleton-text" style={{ width: "25%" }} />
          <div className="skeleton" style={{ height: 320, borderRadius: "var(--radius-sm)" }} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="tab active">
      <Panel icon={Box} title="Dynamic Modules">
        <div className="mod-list">
          {!modules.length ? (
            <div className="muted">No dynamic modules.</div>
          ) : (
            modules.map((m) => (
              <div className="mod-item" key={m.name}>
                <span>{m.loaded ? "\uD83D\uDFE2" : "\uD83D\uDD34"}</span>
                <span className="name">${m.name}</span>
                <button className="btn secondary" onClick={() => editModule(m.name)}>Edit</button>
                <button className="btn secondary" onClick={() => reloadModule(m.name)}>Reload</button>
                <button className="btn danger" onClick={() => deleteModule(m.name)}>Delete</button>
              </div>
            ))
          )}
        </div>
        <button className="btn secondary" onClick={loadModules}><RotateCw /> Refresh</button>
      </Panel>
      <div className="panel" ref={editorRef}>
        <h2><Code2 /> {editingName ? "Editing: " + editingName : "New Module"}</h2>
        <div className="field">
          <label>Name (a–z, 0–9, _, -)</label>
          <input placeholder="hello" value={name} disabled={!!editingName} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Code (module.exports = {"{ name, prefix }"})</label>
          <textarea spellCheck={false} style={{ minHeight: 320 }} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn green" onClick={saveModule}><Send /> Save &amp; Load</button>
          <button className="btn secondary" onClick={newModule}><Eraser /> Clear</button>
        </div>
      </div>
    </div>
  );
}
