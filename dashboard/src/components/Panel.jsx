/**
 * Reusable panel wrapper with optional icon + title.
 *
 * Props:
 *   icon    – A lucide-react icon component (rendered inside h2)
 *   title   – Panel heading text
 *   compact – If true, apply `.panel.compact` class
 *   className – Additional CSS classes
 *   children  – Panel body content
 */
export default function Panel({ icon: Icon, title, compact, className = "", children }) {
  return (
    <div className={`panel${compact ? " compact" : ""} ${className}`.trim()}>
      {(Icon || title) && (
        <h2>
          {Icon && <Icon />}
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
