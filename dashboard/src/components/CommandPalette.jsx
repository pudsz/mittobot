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
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <div className="palette-header">
          <input
            className="palette-input"
            ref={inputRef}
            autoFocus
            placeholder="Search tabs and actions..."
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="palette-enter-hint">↵</span>
        </div>
        <div ref={listRef} className="palette-list">
          {filtered.length === 0 ? (
            <div className="muted palette-empty">No results</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                data-id={item.id}
                tabIndex={-1}
                role="option"
                className="palette-item"
                onClick={() => { onSelect(item.id); onClose(); }}
              >
                <item.Icon style={{ width: 16, height: 16, color: "var(--text-muted)" }} />
                <span>{item.label}</span>
              </div>
            ))
          )}
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
