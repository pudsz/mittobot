/**
 * Professional metric/stat card for dashboards.
 *
 * Props:
 *   label         – Metric label
 *   value         – Metric value (string or number)
 *   icon          – Lucide icon component
 *   trend         – Optional { value: number, label: string, up?: boolean }
 *   color         – Custom color for value
 *   variant       – 'default' | 'compact' | 'featured'
 *   className     – Additional CSS classes
 *   onClick       – Optional click handler
 */
export default function MetricCard({
  label,
  value,
  icon: Icon,
  trend,
  color,
  variant = 'default',
  className = '',
  onClick,
}) {
  const trendClass = trend ? (trend.up ? 'trend-up' : 'trend-down') : '';
  const trendIcon = trend ? (trend.up ? '↗' : '↘') : null;

  return (
    <article
      className={`metric-card metric-card--${variant} ${trendClass} ${className}`.trim()}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }} : undefined}
    >
      <div className="metric-card-header">
        <span className="metric-label">{label}</span>
        {Icon && <Icon className="metric-icon" />}
      </div>
      <div className="metric-value" style={color ? { color } : undefined}>
        {value}
      </div>
      {trend && (
        <div className={`metric-trend ${trendClass}`}>
          <span className="trend-icon">{trendIcon}</span>
          <span className="trend-value">{trend.value}</span>
          <span className="trend-label">{trend.label}</span>
        </div>
      )}
    </article>
  );
}