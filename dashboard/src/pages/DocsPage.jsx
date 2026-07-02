import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Search, Command,
  BookOpen, Terminal,
} from "lucide-react";
import { api } from "../api.js";

// ─── Category emoji + color mapping ────────────────────────────────────
const CATEGORY_STYLES = {
  utility:   { emoji: "🛠️",  color: "#5865F2" },
  info:      { emoji: "ℹ️",   color: "#57F287" },
  fun:       { emoji: "🎉",   color: "#EB459E" },
  fakemod:   { emoji: "🎭",   color: "#FEE75C" },
  realmod:   { emoji: "🛡️",   color: "#ED4245" },
  admin:     { emoji: "⚙️",   color: "#949CF7" },
  dynamic:   { emoji: "📦",   color: "#F0B232" },
};

function catStyle(catId) {
  return CATEGORY_STYLES[catId] || { emoji: "❓", color: "#B5BAC1" };
}

const PERM_LABELS = {
  everyone: "Everyone",
  booster:  "Server Booster",
  mod:      "Moderator",
  admin:    "Administrator",
  owner:    "Bot Owner",
};

export default function DocsPage() {
  const navigate = useNavigate();
  const [commands, setCommands] = useState([]);
  const [prefix, setPrefix] = useState("$");
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api("GET", "/api/commands");
        if (!alive) return;
        setCommands(data.commands || []);
        setPrefix(data.prefix || "$");
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []);

  // Group commands by category
  const groups = {};
  for (const cmd of commands) {
    const catId = cmd.category || "utility";
    (groups[catId] ??= []).push(cmd);
  }
  // Sort within groups
  for (const id of Object.keys(groups)) {
    groups[id].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Category order
  const catOrder = ["utility", "info", "fun", "fakemod", "realmod", "admin", "dynamic"]
    .filter(id => groups[id]);

  // Filter commands by search query
  const q = query.trim().toLowerCase();
  let filteredGroups = groups;
  if (q) {
    filteredGroups = {};
    for (const [catId, cmds] of Object.entries(groups)) {
      const matching = cmds.filter(c =>
        c.name.includes(q) ||
        (c.description || "").toLowerCase().includes(q) ||
        (c.aliases || []).some(a => a.includes(q))
      );
      if (matching.length) filteredGroups[catId] = matching;
    }
  }

  // Active category commands
  const activeCmds = activeCategory ? (filteredGroups[activeCategory] || []) : [];

  // Stats
  const totalCommands = commands.length;
  const totalCategories = catOrder.length;

  return (
    <div className="docs-page">
      {/* Header */}
      <header className="home-header">
        <div className="home-header-inner">
          <div className="home-brand">
            <button
              className="btn secondary docs-back-btn"
              onClick={() => navigate("/")}
            >
              <ArrowLeft style={{ width: 14, height: 14 }} />
              <span>Back</span>
            </button>
            <span className="home-brand-title docs-brand-title">
              <BookOpen style={{ width: 18, height: 18 }} /> Command Reference
            </span>
          </div>
          <div className="home-header-status">
            <span className="muted">{totalCommands} commands · {totalCategories} categories</span>
          </div>
        </div>
      </header>

      <main className="home-main">
        {loading ? (
          <div className="home-loading">
            <div className="spinner" />
            <span className="muted">Loading command reference...</span>
          </div>
        ) : error ? (
          <div className="panel docs-error-panel">
            <div className="muted docs-error-title">
              ⚠️ Failed to load commands
            </div>
            <div className="muted docs-error-message">{error}</div>
            <button className="btn secondary" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Search bar */}
            <div className="server-navigator-search docs-search-shell">
              <div className="docs-search-wrap">
                <Search className="docs-search-icon" />
                <input
                  className="docs-search-input"
                  type="text"
                  placeholder="Search commands, categories, aliases..."
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActiveCategory(null); }}
                />
              </div>
            </div>

            {/* Category pills */}
            <div className="row docs-filter-row">
              {!activeCategory && !q && (
                <span className="badge info docs-filter-badge">
                  All categories
                </span>
              )}
              {catOrder.map(catId => {
                const cs = catStyle(catId);
                const count = (filteredGroups[catId] || []).length;
                return (
                  <button
                    key={catId}
                    className={`btn docs-filter-btn ${activeCategory === catId ? "primary" : "secondary"}`}
                    style={{ "--category-color": cs.color }}
                    onClick={() => setActiveCategory(activeCategory === catId ? null : catId)}
                  >
                    {cs.emoji} {CATEGORY_STYLES[catId]?.label || catId}
                    <span className="muted docs-filter-count">({count})</span>
                  </button>
                );
              })}
              {activeCategory && (
                <button
                  className="btn secondary docs-filter-btn"
                  onClick={() => setActiveCategory(null)}
                >
                  ✕ Clear filter
                </button>
              )}
            </div>

            {/* ─── Category view (when no active category, show overview) ─── */}
            {!activeCategory && !q && (
              <div className="feature-grid docs-category-grid">
                {catOrder.map(catId => {
                  const cmds = groups[catId];
                  const cs = catStyle(catId);
                  return (
                    <div
                      key={catId}
                      className="feature-card docs-category-card"
                      style={{ "--category-color": cs.color }}
                      onClick={() => setActiveCategory(catId)}
                    >
                      <div className="fc-head">
                        <span className="fc-name docs-category-title">
                          {cs.emoji} {CATEGORY_STYLES[catId]?.label || catId}
                        </span>
                      </div>
                      <div className="fc-desc">
                        {cmds.length} command{cmds.length !== 1 ? "s" : ""}
                      </div>
                      <div className="fc-cmds">
                        {cmds.slice(0, 6).map(c => (
                          <code key={c.name} className="docs-code-link" onClick={(e) => { e.stopPropagation(); setExpanded(expanded === c.name ? null : c.name); }}>
                            {prefix}{c.name}
                          </code>
                        ))}
                        {cmds.length > 6 && <code>+{cmds.length - 6} more</code>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ─── Search results / category commands ─── */}
            {(activeCategory || q) && (
              <div className="docs-results">
                {activeCmds.length === 0 ? (
                  <div className="panel docs-empty-panel">
                    <div className="muted">No commands found.</div>
                  </div>
                ) : (
                  <div>
                    {activeCmds.map((cmd, i) => {
                      const cs = catStyle(cmd.category || "utility");
                      const isOpen = expanded === cmd.name;
                      const aliases = cmd.aliases || [];

                      return (
                        <div
                          key={cmd.name}
                          className={`cmd-row ${isOpen ? "open" : ""}`}
                          style={{ "--command-delay": `${0.03 * i}s` }}
                        >
                          <div
                            className="cmd-head"
                            onClick={() => setExpanded(isOpen ? null : cmd.name)}
                          >
                            <span className="cmd-name docs-command-name" style={{ "--category-color": cs.color }}>
                              {prefix}{cmd.name}
                            </span>
                            {cmd.category && <span className="badge cat docs-command-category" style={{ "--category-color": cs.color }}>{cs.emoji} {CATEGORY_STYLES[cmd.category]?.label || cmd.category}</span>}
                            {aliases.slice(0, 3).map(a => <span className="badge" key={a}>{prefix}{a}</span>)}
                            {aliases.length > 3 && <span className="badge">+{aliases.length - 3}</span>}
                            {cmd.config && !cmd.config.enabled && <span className="badge off">disabled</span>}
                            <span className="cmd-desc">{cmd.description || "—"}</span>
                            {cmd.config && <span className="badge">{PERM_LABELS[cmd.config.permission] || cmd.config.permission}</span>}
                          </div>
                          <div className="cmd-body">
                            <div className="grid-2">
                              <div className="field">
                                <label>Category</label>
                                <div className="docs-field-value">
                                  {cs.emoji} {CATEGORY_STYLES[cmd.category]?.label || cmd.category || "Built-in"}
                                </div>
                              </div>
                              <div className="field">
                                <label>Permission Level</label>
                                <div className="docs-field-value">
                                  <span className="badge docs-permission-badge">
                                    {PERM_LABELS[cmd.config?.permission] || cmd.config?.permission || "Everyone"}
                                  </span>
                                </div>
                              </div>
                              {aliases.length > 0 && (
                                <div className="field">
                                  <label>Aliases</label>
                                  <div className="docs-field-value docs-alias-list">
                                    {aliases.map(a => <code key={a}>{prefix}{a}</code>)}
                                  </div>
                                </div>
                              )}
                              <div className="field">
                                <label>Cooldown</label>
                                <div className="docs-field-value">
                                  {cmd.config?.cooldown ? `${cmd.config.cooldown}s` : "None"}
                                </div>
                              </div>
                            </div>
                            {cmd.config?.settings && Object.keys(cmd.config.settings).length > 0 && (
                              <div className="field">
                                <label>Settings</label>
                                <pre className="docs-settings-pre">
                                  {JSON.stringify(cmd.config.settings, null, 2)}
                                </pre>
                              </div>
                            )}
                            <div className="row docs-command-meta">
                              <span className="muted docs-command-meta-item">
                                <Terminal style={{ width: 12, height: 12, verticalAlign: "middle" }} />{" "}
                                Prefix: <code>{prefix}{cmd.name}</code>
                              </span>
                              <span className="muted docs-command-meta-item">
                                <Command style={{ width: 12, height: 12, verticalAlign: "middle" }} />{" "}
                                Slash: <code>/{cmd.name}</code>
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ─── Quick overview when nothing filtered ─── */}
            {!activeCategory && !q && (
              <div className="panel">
                <h2>📋 How to Use</h2>
                <div className="muted docs-overview-copy">
                  <p>
                    <strong>Prefix commands</strong> — Type <code>{prefix}command</code> in any allowed channel.
                    For example, <code>{prefix}help ping</code> shows details for the ping command.
                  </p>
                  <p>
                    <strong>Slash commands</strong> — Most commands are available as slash commands.
                    Type <code>/</code> in Discord to browse available slash commands.
                  </p>
                  <p>
                    <strong>Configuration</strong> — Use <code>{prefix}config &lt;command&gt;</code> to change
                    permissions, cooldowns, allowed channels, and aliases for any command.
                  </p>
                  <p>
                    <strong>Dashboard</strong> — Visit the <strong>Commands</strong> tab in the dashboard
                    for a visual configuration interface.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>

    </div>
  );
}
