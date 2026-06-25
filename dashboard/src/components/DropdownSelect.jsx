import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, X } from "lucide-react";

/**
 * Multi-select dropdown with search, replacing inline chip buttons.
 *
 * Props:
 *   items       – Array of { id, name }
 *   selected    – Set of selected IDs
 *   onToggle    – (id: string) => void
 *   placeholder – Text for trigger when nothing selected (default "Select...")
 *   prefix      – Optional "#" or "@" prefix before item names
 *   searchable  – Show search input (default true)
 *   max         – Optional max visible items before scrolling
 *   variant     – "normal" | "block" (red accent for blocked channels, default "normal")
 *   label       – Optional label shown above the dropdown trigger
 */
export default function DropdownSelect({
  items,
  selected,
  onToggle,
  placeholder = "Select...",
  prefix = "",
  searchable = true,
  max = 12,
  variant = "normal",
  label,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const searchRef = useRef(null);
  const triggerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open && searchable && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open, searchable]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSearch("");
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const filtered = search.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const count = selected.size;
  const isBlock = variant === "block";

  return (
    <div className={`dropdown-select${isBlock ? " block" : ""}`} ref={ref}>
      {label && <div className="dropdown-label">{label}</div>}
      <button
        ref={triggerRef}
        className={`btn dropdown-trigger${count > 0 && isBlock ? " has-block" : ""}${count > 0 && !isBlock ? " has-selection" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dropdown-trigger-text">
          {count === 0 ? (
            <span className="muted">{placeholder}</span>
          ) : count === 1 ? (
            <>
              {prefix}{items.find((i) => selected.has(i.id))?.name || "1 selected"}
            </>
          ) : (
            <>{count} selected</>
          )}
        </span>
        <ChevronDown className={`dropdown-chevron${open ? " open" : ""}`} />
      </button>

      {open && (
        <div className={`dropdown-menu${isBlock ? " block" : ""}`} role="listbox">
          {searchable && (
            <div className="dropdown-search">
              <Search className="dropdown-search-icon" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              {search && (
                <button
                  className="dropdown-search-clear"
                  onClick={() => setSearch("")}
                  tabIndex={-1}
                >
                  <X />
                </button>
              )}
            </div>
          )}

          <div className="dropdown-items" style={{ maxHeight: max * 36 }}>
            {filtered.length === 0 ? (
              <div className="dropdown-empty">No items found</div>
            ) : (
              filtered.map((item) => {
                const isOn = selected.has(item.id);
                return (
                  <label
                    key={item.id}
                    className={`dropdown-item${isOn ? " on" : ""}`}
                    role="option"
                    aria-selected={isOn}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => onToggle(item.id)}
                    />
                    <span className="dropdown-item-name">
                      {prefix}{item.name}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="dropdown-footer">
            <span className="muted">
              {count} selected{filtered.length !== items.length ? ` \u00b7 ${filtered.length} shown` : ""}
            </span>
            <button
              className={`btn ${isBlock ? "danger" : "secondary"}`}
              style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
