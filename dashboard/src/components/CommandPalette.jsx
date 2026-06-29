import { useEffect, useRef } from "react";

export default function CommandPalette({ open, onClose, items, onSelect, query, onQuery }) {
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = query.trim()
    ? items.filter(t => t.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  if (!open) return null;

  function handleKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = filtered.findIndex(el => el.id === document.activeElement?.dataset?.id);
      const next = e.key === "ArrowDown"
        ? (idx + 1) % filtered.length
        : (idx - 1 + filtered.length) % filtered.length;
      const el = listRef.current?.children[next];
      if (el) el.focus();
    }
  }

  return (
    <div
      className="palette-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(0,0,0,0.6)", display: "flex", justifyContent: "center",
        paddingTop: "15vh",
      }}
      onClick={onClose}
    >
      <div
        className="palette-box"
        style={{
          background: "var(--bg-alt)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", width: 520, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden",
          animation: "scaleIn 0.15s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <input
            ref={inputRef}
            autoFocus
            placeholder="Search tabs and actions..."
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ flex: 1, border: "none", background: "none", fontSize: 14, padding: 4, outline: "none", color: "var(--text)" }}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>↵</span>
        </div>
        <div ref={listRef} style={{ maxHeight: 360, overflowY: "auto", padding: "4px 0" }}>
          {filtered.length === 0 ? (
            <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 13 }}>No results</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                data-id={item.id}
                tabIndex={-1}
                role="option"
                className="palette-item"
                onClick={() => { onSelect(item.id); onClose(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
                  cursor: "pointer", fontSize: 13, transition: "background 0.1s",
                  background: i === 0 ? "var(--surface)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  [...e.currentTarget.parentElement.children].forEach(el => el.style.background = "transparent");
                  e.currentTarget.style.background = "var(--surface)";
                }}
              >
                <item.Icon style={{ width: 16, height: 16, color: "var(--text-muted)" }} />
                <span>{item.label}</span>
              </div>
            ))
          )}
        </div>
        <div style={{ borderTop: "1px solid var(--border)", padding: "6px 16px", fontSize: 10, color: "var(--text-muted)", display: "flex", gap: 12 }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
