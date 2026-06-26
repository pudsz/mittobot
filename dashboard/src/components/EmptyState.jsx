import { PackageOpen } from "lucide-react";

/**
 * Reusable empty state placeholder. Shows when there's no data to display.
 *
 * Props:
 *   icon     – Lucide icon (defaults to PackageOpen)
 *   title    – Main heading (defaults to "Nothing here yet")
 *   message  – Subtitle / explanation
 *   action   – Optional React node for a CTA button
 */
export default function EmptyState({
  icon: Icon = PackageOpen,
  title = "Nothing here yet",
  message = "",
  action,
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        textAlign: "center",
        animation: "fadeSlideIn 0.3s ease",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "var(--surface)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        <Icon style={{ width: 24, height: 24, color: "var(--text-muted)" }} />
      </div>
      <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        {title}
      </h3>
      {message && (
        <p className="muted" style={{ maxWidth: 360, marginBottom: action ? 12 : 0 }}>
          {message}
        </p>
      )}
      {action}
    </div>
  );
}
