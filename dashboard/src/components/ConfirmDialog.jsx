import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "normal",
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => confirmRef.current?.focus(), 50);

    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handler);
    };
  }, [open, onCancel]);

  if (!open) return null;

  const confirmClass = variant === "danger" ? "btn danger" : variant === "warning" ? "btn warning" : "btn primary";

  return (
    <div
      className="palette-overlay"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="palette-box"
        style={{ width: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 8px" }}>
          <h2 id="confirm-dialog-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h2>
          <button
            onClick={onCancel}
            className="confirm-close-btn"
            aria-label="Close"
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div style={{ padding: "8px 20px 16px" }}>
          <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>{message}</p>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button className="btn secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={confirmClass} ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
