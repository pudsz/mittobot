import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Error display with a retry button. Use when an API call fails.
 *
 * Props:
 *   message – Error description
 *   onRetry – Callback to re-attempt the operation
 */
export default function ErrorRetry({ message = "Failed to load data.", onRetry }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        textAlign: "center",
        animation: "fadeSlideIn 0.25s ease",
      }}
    >
      <AlertTriangle style={{ width: 24, height: 24, color: "var(--orange)", marginBottom: 8 }} />
      <p className="muted" style={{ margin: "0 0 12px", maxWidth: 360, fontSize: 13 }}>
        {message}
      </p>
      {onRetry && (
        <button className="btn primary" onClick={onRetry}>
          <RefreshCw style={{ width: 14, height: 14 }} />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}
