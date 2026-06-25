import { useState } from "react";
import { StickyNote, Search, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import { formatTimestamp, guildQuery } from "../utils.js";

export default function UserNotesTab({ guildId }) {
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);

  async function loadNotes(uid) {
    if (!uid.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const { notes: list } = await api("GET", `/api/modnotes/${encodeURIComponent(uid.trim())}${guildQuery(guildId)}`);
      setNotes(list || []);
    } catch (e) {
      toast(e.message, true);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }

  async function addNote() {
    if (!userId.trim() || !newContent.trim()) return toast("Enter a user ID and note content", true);
    setSaving(true);
    try {
      await api("POST", `/api/modnotes/${encodeURIComponent(userId.trim())}`, { guildId, content: newContent.trim(), by: "dashboard" });
      toast("Note added");
      setNewContent("");
      await loadNotes(userId);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(noteId) {
    if (!window.confirm("Delete this note?")) return;
    try {
      await api("DELETE", `/api/modnotes/${noteId}`);
      toast("Note deleted");
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (e) {
      toast(e.message, true);
    }
  }

  return (
    <div className="tab active">
      <Panel icon={StickyNote} title="User Notes">
        <p className="muted" style={{ marginBottom: 14 }}>
          Add and view free-form moderation notes attached to Discord users. Notes are visible to anyone
          with dashboard access and persist across restarts.
        </p>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Discord User ID</label>
          <div className="row">
            <input
              placeholder="Enter a Discord user ID..."
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadNotes(userId); }}
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn primary" onClick={() => loadNotes(userId)} disabled={!userId.trim() || loading}>
              <Search /> {loading ? "Loading..." : "Look up"}
            </button>
          </div>
        </div>
      </Panel>

      {searched && !loading && (
        <Panel compact>
          <h3 style={{ marginBottom: 12 }}>
            Notes for <code>{userId}</code>
            <span className="badge" style={{ marginLeft: 8 }}>{notes.length} note{notes.length !== 1 ? "s" : ""}</span>
          </h3>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, marginBottom: 14 }}>
            <div className="field" style={{ marginBottom: 8 }}>
              <label>New Note</label>
              <textarea style={{ minHeight: 60 }} placeholder="Enter note content..." value={newContent} onChange={(e) => setNewContent(e.target.value)} />
            </div>
            <button className="btn green" onClick={addNote} disabled={!newContent.trim() || saving}>
              <Plus /> {saving ? "Adding..." : "Add Note"}
            </button>
          </div>
          {notes.length === 0 ? (
            <div className="muted" style={{ textAlign: "center", padding: 20 }}>No notes for this user.</div>
          ) : (
            notes.map((note) => (
              <div key={note.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 12px", marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "var(--text)", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{note.content}</div>
                    <div style={{ marginTop: 6, display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)" }}>
                      <span>By: <code>{note.by || "unknown"}</code></span>
                      <span>{formatTimestamp(note.timestamp)}</span>
                    </div>
                  </div>
                  <button className="btn danger" style={{ padding: "4px 8px", flexShrink: 0 }} onClick={() => deleteNote(note.id)}><Trash2 /></button>
                </div>
              </div>
            ))
          )}
        </Panel>
      )}
    </div>
  );
}
