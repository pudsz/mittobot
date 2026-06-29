import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Search, X } from "lucide-react";

/**
 * Multi-select dropdown with search and keyboard navigation.
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef(null);
  const searchRef = useRef(null);
  const triggerRef = useRef(null);
  const itemsRef = useRef(null);
  // Use a ref so the keyboard handler doesn't re-register on every render
  const filteredRef = useRef([]);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const scrollActiveIntoViewRef = useRef();

  const filtered = search.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  // Keep ref in sync without triggering re-registration
  filteredRef.current = filtered;

  const scrollActiveIntoView = useCallback((idx) => {
    if (!itemsRef.current) return;
    const els = itemsRef.current.querySelectorAll(".dropdown-item");
    if (els[idx]) {
      els[idx].scrollIntoView({ block: "nearest" });
    }
  }, []);
  scrollActiveIntoViewRef.current = scrollActiveIntoView;

  // Reset activeIndex when search changes (list shrinks)
  useEffect(() => {
    setActiveIndex(-1);
  }, [search]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open && searchable && searchRef.current) {
      searchRef.current.focus();
      setActiveIndex(-1);
    }
  }, [open, searchable]);

  // Keyboard navigation — stable effect (only re-registers on open)
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      // Ignore nav keys when search input or trigger is focused
      const activeEl = document.activeElement;
      const isSearchFocused = activeEl === searchRef.current;
      const isTrigger = activeEl === triggerRef.current;

      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setSearch("");
        setActiveIndex(-1);
        triggerRef.current?.focus();
        return;
      }

      // Allow search input to handle its own keyboard events natively
      if (isSearchFocused) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = filteredRef.current;
        const maxIdx = list.length - 1;
        if (maxIdx < 0) return;
        setActiveIndex((prev) => {
          let next;
          if (prev < 0 || isTrigger) {
            next = e.key === "ArrowDown" ? 0 : maxIdx;
          } else if (e.key === "ArrowDown") {
            next = prev >= maxIdx ? 0 : prev + 1;
          } else {
            next = prev <= 0 ? maxIdx : prev - 1;
          }
          scrollActiveIntoViewRef.current(next);
          return next;
        });
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0 && activeIndex < filteredRef.current.length) {
        e.preventDefault();
        onToggleRef.current(filteredRef.current[activeIndex].id);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        if (filteredRef.current.length > 0) { setActiveIndex(0); scrollActiveIntoViewRef.current(0); }
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        const last = filteredRef.current.length - 1;
        if (last >= 0) { setActiveIndex(last); scrollActiveIntoViewRef.current(last); }
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, activeIndex]); // stable deps: open (boolean) and activeIndex (number)

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
        <div
          className={`dropdown-menu${isBlock ? " block" : ""}`}
          role="listbox"
          aria-activedescendant={activeIndex >= 0 && filtered[activeIndex] ? `dd-item-${filtered[activeIndex].id}` : undefined}
        >
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

          <div className="dropdown-items" ref={itemsRef} style={{ maxHeight: max * 36 }}>
            {filtered.length === 0 ? (
              <div className="dropdown-empty">No items found</div>
            ) : (
              filtered.map((item, i) => {
                const isOn = selected.has(item.id);
                const isActive = i === activeIndex;
                return (
                  <label
                    key={item.id}
                    id={`dd-item-${item.id}`}
                    className={`dropdown-item${isOn ? " on" : ""}${isActive ? " keyboard-active" : ""}`}
                    role="option"
                    aria-selected={isOn}
                    tabIndex={-1}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => onToggle(item.id)}
                      tabIndex={-1}
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
