import { PackageOpen } from "lucide-react";

export default function EmptyState({
  icon: Icon = PackageOpen,
  title = "Nothing here yet",
  message = "",
  action,
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {message && <p className="empty-state-message">{message}</p>}
      {action}
    </div>
  );
}
