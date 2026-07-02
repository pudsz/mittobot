import { ChevronLeft } from 'lucide-react';

/**
 * Professional page header with breadcrumb, title, description, and actions.
 *
 * Props:
 *   title         – Page title
 *   description   – Optional description/subtitle
 *   breadcrumb    – Array of { label, href?, onClick? }
 *   actions       – Right-aligned actions
 *   icon          – Lucide icon for the page
 *   className     – Additional CSS classes
 */
export default function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  icon: Icon,
  className = '',
}) {
  return (
    <header className={`page-header ${className}`.trim()}>
      {(breadcrumb && breadcrumb.length > 0) && (
        <nav className="page-breadcrumb" aria-label="Breadcrumb">
          <ol>
            {breadcrumb.map((item, i) => (
              <li key={item.label || i}>
                {i > 0 && <ChevronLeft className="breadcrumb-sep" />}
                {item.href || item.onClick ? (
                  <button
                    className="breadcrumb-link"
                    onClick={item.onClick}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span className="breadcrumb-current">{item.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="page-header-main">
        <div className="page-header-content">
          {Icon && <div className="page-header-icon"><Icon /></div>}
          <div className="page-header-text">
            <h1 className="page-header-title">{title}</h1>
            {description && <p className="page-header-description">{description}</p>}
          </div>
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}