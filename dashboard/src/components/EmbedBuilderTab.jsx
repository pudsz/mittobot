import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import EmbedPreview from "./EmbedPreview.jsx";
import ChannelSelect from "./ChannelSelect.jsx";
import Panel from "./Panel.jsx";
import { Palette, Send, Save, Download, Upload, Trash2, Plus, X, Clock } from "lucide-react";

const COLOR_PRESETS = [
  { label: "Blurple", color: 0x5865F2 },
  { label: "Green",   color: 0x23A55A },
  { label: "Red",     color: 0xED4245 },
  { label: "Orange",  color: 0xF0B232 },
  { label: "Grey",    color: 0x4E5058 },
  { label: "Yellow",  color: 0xFEE75C },
  { label: "Pink",    color: 0xEB459E },
  { label: "Cyan",    color: 0x00AFF4 },
];

const EMPTY_EMBED = {
  title: "",
  description: "",
  url: "",
  color: 0x5865F2,
  author: { name: "", icon_url: "", url: "" },
  footer: { text: "", icon_url: "" },
  thumbnail: { url: "" },
  image: { url: "" },
  fields: [],
  timestamp: true,
};

// Strip empty values so Discord accepts the embed JSON
function cleanEmbed(embed) {
  const out = {};
  if (embed.title) out.title = embed.title;
  if (embed.description) out.description = embed.description;
  if (embed.url) out.url = embed.url;
  if (embed.color != null) out.color = embed.color;
  if (embed.author?.name) out.author = { name: embed.author.name, icon_url: embed.author.icon_url || undefined, url: embed.author.url || undefined };
  if (embed.footer?.text) out.footer = { text: embed.footer.text, icon_url: embed.footer.icon_url || undefined };
  if (embed.thumbnail?.url) out.thumbnail = { url: embed.thumbnail.url };
  if (embed.image?.url) out.image = { url: embed.image.url };
  if (embed.fields?.length) out.fields = embed.fields.filter(f => f.name || f.value).map(f => ({ name: f.name || "\u200b", value: f.value || "\u200b", inline: !!f.inline }));
  if (embed.timestamp) out.timestamp = new Date().toISOString();
  return out;
}

export default function EmbedBuilderTab({ guildId }) {
  const toast = useToast();

  const [embed, setEmbed] = useState({ ...EMPTY_EMBED });
  const [content, setContent] = useState("");

  // Templates
  const [templates, setTemplates] = useState([]);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  // Channels (for send)
  const [channels, setChannels] = useState([]);
  const [sendChannel, setSendChannel] = useState("");
  const [sending, setSending] = useState(false);

  // JSON import/export
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");

  const loadTemplates = useCallback(async () => {
    if (!guildId) return;
    try {
      setTemplateLoading(true);
      const data = await api("GET", `/api/embeds?guildId=${guildId}`);
      setTemplates(data.templates || []);
    } catch { /* ignore */ }
    finally { setTemplateLoading(false); }
  }, [guildId]);

  const loadChannels = useCallback(async () => {
    if (!guildId) return;
    try {
      const data = await api("GET", `/api/channels?guildId=${guildId}`);
      if (data.channels) setChannels(data.channels);
    } catch { /* ignore */ }
  }, [guildId]);

  useEffect(() => { loadTemplates(); loadChannels(); }, [loadTemplates, loadChannels]);

  // Reset state on guild change
  useEffect(() => { setSendChannel(""); setContent(""); setEmbed({ ...EMPTY_EMBED }); }, [guildId]);

  // ─── Field helpers ──────────────────────────────────────────────────
  function addField() {
    setEmbed({ ...embed, fields: [...(embed.fields || []), { _key: crypto.randomUUID(), name: "", value: "", inline: false }] });
  }
  function updateField(k, patch) {
    setEmbed({ ...embed, fields: (embed.fields || []).map((f) => (f._key === k ? { ...f, ...patch } : f)) });
  }
  function removeField(k) {
    setEmbed({ ...embed, fields: (embed.fields || []).filter((f) => f._key !== k) });
  }

  // ─── Template operations ────────────────────────────────────────────
  async function saveTemplate() {
    if (!saveName.trim()) { toast("Template name required", true); return; }
    try {
      const cleaned = cleanEmbed(embed);
      await api("POST", `/api/embeds?guildId=${guildId}`, { name: saveName.trim(), embed: cleaned });
      toast(`Saved "${saveName.trim()}"`);
      setSaveName("");
      setShowSave(false);
      await loadTemplates();
    } catch (e) { toast(e.message, true); }
  }

  function loadTemplate(t) {
    const e = { ...EMPTY_EMBED, ...t.embed };
    setEmbed(e);
    toast(`Loaded "${t.name}"`);
  }

  async function deleteTemplate(t) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api("DELETE", `/api/embeds/${t.id}`);
      toast(`Deleted "${t.name}"`);
      await loadTemplates();
    } catch (e) { toast(e.message, true); }
  }

  // ─── Send test ──────────────────────────────────────────────────────
  async function sendTest() {
    if (!sendChannel) { toast("Select a channel first", true); return; }
    setSending(true);
    try {
      const cleaned = cleanEmbed(embed);
      const body = { channelId: sendChannel, content: content || undefined, embed: cleaned };
      await api("POST", `/api/embeds/send?guildId=${guildId}`, body);
      toast("Embed sent!");
    } catch (e) { toast(e.message, true); }
    finally { setSending(false); }
  }

  // ─── JSON ───────────────────────────────────────────────────────────
  function openJsonExport() {
    const cleaned = cleanEmbed(embed);
    setJsonText(JSON.stringify(cleaned, null, 2));
    setJsonError("");
    setShowJson(true);
  }

  function importJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object");
      setEmbed({ ...EMPTY_EMBED, ...parsed });
      setShowJson(false);
      toast("Embed imported");
    } catch (e) {
      setJsonError(e.message);
    }
  }

  function copyJson() {
    navigator.clipboard.writeText(jsonText).then(() => toast("Copied!")).catch(() => toast("Copy failed", true));
  }

  if (!guildId) {
    return <div className="muted" style={{ padding: 24, textAlign: "center" }}>Select a guild to build embeds.</div>;
  }

  const colorHex = `#${(embed.color || 0x5865F2).toString(16).padStart(6, "0").toUpperCase()}`;

  const cleaned = cleanEmbed(embed);

  return (
    <div>
      <h2>🎨 Embed Builder</h2>
      <p className="muted">Design Discord embeds visually with a live preview. Save templates for reuse.</p>

      <div className="embed-grid">
        <div className="embed-sticky">
          <Panel title="Preview" icon={Palette}>
            <EmbedPreview embed={cleaned} />
            {(cleaned.description || cleaned.fields?.length > 0) && (
              <div className="embed-actions">
                <button className="btn secondary text-sm" onClick={openJsonExport}><Download style={{ width: 14 }} /> JSON</button>
                {sendChannel && (
                  <button className="btn primary text-sm" onClick={sendTest} disabled={sending}>
                    <Send style={{ width: 14 }} /> {sending ? "Sending..." : "Send Test"}
                  </button>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div>
          <Panel title="Color" icon={Palette}>
            <div className="row mb-2">
              {COLOR_PRESETS.map((p) => (
                <button
                  key={p.color}
                  className={`btn ${embed.color === p.color ? "primary" : "secondary"}`}
                  style={{ padding: "4px 10px", fontSize: 11 }}
                  onClick={() => setEmbed({ ...embed, color: p.color })}
                >
                  <span className="embed-color-swatch" style={{ background: `#${p.color.toString(16).padStart(6, "0")}` }} />
                  {p.label}
                </button>
              ))}
            </div>
            <div className="field">
              <label>Custom Color (hex)</label>
              <div className="row">
                <input
                  type="color"
                  value={colorHex.toLowerCase()}
                  onChange={(e) => setEmbed({ ...embed, color: parseInt(e.target.value.slice(1), 16) })}
                  className="embed-color-input"
                />
                <code>{colorHex}</code>
              </div>
            </div>
          </Panel>

          <Panel title="Content">
            {["author.name", "author.icon_url", "title", "url"].map(f => {
              const [group, field] = f.includes(".") ? f.split(".") : [null, f];
              const labels = { author: { name: "Author Name", icon_url: "Author Icon URL" }, title: "Title", url: "Title URL" };
              const label = group ? labels[group]?.[field] : labels[f];
              const phs = { author: { name: "e.g. Server Welcome", icon_url: "https://..." }, title: "Embed title", url: "https://..." };
              const ph = group ? phs[group]?.[field] : phs[f];
              const val = group ? embed[group]?.[field] || "" : embed[f];
              const onChange = group
                ? (v) => setEmbed({ ...embed, [group]: { ...embed[group], [field]: v } })
                : (v) => setEmbed({ ...embed, [f]: v });
              return (
                <div className="field" key={f}>
                  <label>{label}</label>
                  <input value={val} onChange={(e) => onChange(e.target.value)} placeholder={ph} />
                </div>
              );
            })}
            <div className="field">
              <label>Description</label>
              <textarea
                value={embed.description}
                onChange={(e) => setEmbed({ ...embed, description: e.target.value })}
                placeholder="Embed description text..."
                style={{ minHeight: 100 }}
              />
            </div>
          </Panel>

          <Panel title="Fields" icon={Plus}>
            {(embed.fields || []).map((f) => (
              <div key={f._key} className="embed-field-card">
                <div className="row embed-field-header">
                  <span className="muted text-sm">Field {(embed.fields || []).indexOf(f) + 1}</span>
                  <button className="btn danger sm" onClick={() => removeField(f._key)}><X style={{ width: 12 }} /></button>
                </div>
                <div className="grid-2">
                  <div className="field">
                    <label>Name</label>
                    <input value={f.name} onChange={(e) => updateField(f._key, { name: e.target.value })} placeholder="Field name" />
                  </div>
                  <div className="field">
                    <label>Value</label>
                    <input value={f.value} onChange={(e) => updateField(f._key, { value: e.target.value })} placeholder="Field value" />
                  </div>
                </div>
                <label className="row" style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={f.inline || false} onChange={(e) => updateField(f._key, { inline: e.target.checked })} className="embed-checkbox" />
                  Inline
                </label>
              </div>
            ))}
            <button className="btn secondary" onClick={addField}>+ Add Field</button>
          </Panel>

          <Panel title="Images">
            <div className="field">
              <label>Thumbnail URL</label>
              <input value={embed.thumbnail.url} onChange={(e) => setEmbed({ ...embed, thumbnail: { url: e.target.value } })} placeholder="https://..." />
            </div>
            <div className="field">
              <label>Image URL (large)</label>
              <input value={embed.image.url} onChange={(e) => setEmbed({ ...embed, image: { url: e.target.value } })} placeholder="https://..." />
            </div>
          </Panel>

          <Panel title="Footer">
            <div className="field">
              <label>Footer Text</label>
              <input value={embed.footer.text} onChange={(e) => setEmbed({ ...embed, footer: { ...embed.footer, text: e.target.value } })} placeholder="Footer text" />
            </div>
            <div className="field">
              <label>Footer Icon URL</label>
              <input value={embed.footer.icon_url} onChange={(e) => setEmbed({ ...embed, footer: { ...embed.footer, icon_url: e.target.value } })} placeholder="https://..." />
            </div>
            <label className="row embed-switch-label">
              <input type="checkbox" checked={embed.timestamp !== false} onChange={(e) => setEmbed({ ...embed, timestamp: e.target.checked })} className="embed-checkbox" />
              <Clock style={{ width: 14 }} /> Show timestamp
            </label>
          </Panel>

          <Panel title="Send Test" icon={Send}>
            <div className="field">
              <label>Message Content (optional)</label>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Text above the embed..." style={{ minHeight: 60 }} />
            </div>
            <div className="field">
              <label>Channel</label>
              <ChannelSelect value={sendChannel} onChange={setSendChannel} channels={channels} noneLabel="— Select channel —" label="" />
            </div>
            <button className="btn primary" onClick={sendTest} disabled={sending || !sendChannel}>
              <Send style={{ width: 14 }} /> {sending ? "Sending..." : "Send Test"}
            </button>
          </Panel>

          <Panel title="Saved Templates" icon={Save}>
            {templateLoading ? (
              <div className="skeleton skeleton-card" style={{ height: 60 }} />
            ) : templates.length === 0 ? (
              <p className="muted">No templates saved yet. Save your embed below.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                {templates.map((t) => (
                  <div key={t.id} className="row embed-template-row">
                    <span className="embed-template-name">{t.name}</span>
                    <div className="row gap-4">
                      <button className="btn secondary sm" onClick={() => loadTemplate(t)}>Load</button>
                      <button className="btn danger sm" onClick={() => deleteTemplate(t)}><Trash2 style={{ width: 12 }} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showSave ? (
              <div className="row mt-2">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Template name..."
                  className="flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") saveTemplate(); }}
                  autoFocus
                />
                <button className="btn primary" onClick={saveTemplate}><Save style={{ width: 14 }} /> Save</button>
                <button className="btn" onClick={() => setShowSave(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn secondary" onClick={() => setShowSave(true)}><Save style={{ width: 14 }} /> Save As Template</button>
            )}
          </Panel>

          <Panel title="JSON" icon={Download}>
            {showJson ? (
              <div>
                <textarea
                  value={jsonText}
                  onChange={(e) => { setJsonText(e.target.value); setJsonError(""); }}
                  className="embed-json-textarea"
                />
                {jsonError && <div className="embed-json-error">{jsonError}</div>}
                <div className="row mt-2">
                  <button className="btn primary" onClick={importJson}><Upload style={{ width: 14 }} /> Import</button>
                  <button className="btn" onClick={copyJson}>Copy</button>
                  <button className="btn" onClick={() => setShowJson(false)}>Close</button>
                </div>
              </div>
            ) : (
              <button className="btn secondary" onClick={openJsonExport}><Download style={{ width: 14 }} /> Edit as JSON</button>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
