/**
 * Professional Panel/Card component with variants and rich header.
 *
 * Props:
 *   icon           – Lucide icon component
 *   title          – Panel title
 *   description    – Optional subtitle/description
 *   children       – Panel content
 *   variant        – 'elevated' | 'glass' | 'bordered' | 'flat'
 *   tone           – 'default' | 'accent' | 'success' | 'warning' | 'danger'
 *   actions        – Right-aligned header actions (React node)
 *   className      – Additional CSS classes
 *   compact        – Compact padding
 *   loading        – Show skeleton loading state
 *   empty          – Show empty state message
 *   footer         – Optional footer content
 *   onClick        – Make panel clickable
 */
export default function Panel({
  icon: Icon,
  title,
  description,
  children,
  variant = 'elevated',
  tone = 'default',
  actions,
  className = '',
  compact = false,
  loading = false,
  empty,
  footer,
  onClick,
}) {
  const toneClass = tone !== 'default' ? `panel--tone-${tone}` : '';
  const variantClass = variant !== 'elevated' ? `panel--${variant}` : '';
  const compactClass = compact ? 'panel--compact' : '';
  const clickableClass = onClick ? 'panel--clickable' : '';

  const header = (title || description || actions) && (
    <header className="panel-header">
      <div className="panel-header-main">
        {(Icon || title) && (
          <div className="panel-title-row">
            {Icon && <Icon className="panel-icon" />}
            <div className="panel-title-block">
              {title && <h2 className="panel-title">{title}</h2>}
              {description && <p className="panel-description">{description}</p>}
            </div>
          </div>
        )}
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
    </header>
  );

  const body = loading ? (
    <div className="panel-skeleton">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton skeleton-text" />
      <div className="skeleton skeleton-text" style={{ width: '60%' }} />
    </div>
  ) : empty ? (
    <div className="panel-empty">{empty}</div>
  ) : (
    <div className="panel-body">{children}</div>
  );

  return (
    <article
      className={`panel ${variantClass} ${toneClass} ${compactClass} ${clickableClass} ${className}`.trim()}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }} : undefined}
    >
      {header}
      {body}
      {footer && <footer className="panel-footer">{footer}</footer>}
    </article>
  );
}