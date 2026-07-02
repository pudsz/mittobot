import { useState } from 'react';

/**
 * DataTable wrapper and table styling
 * Provides consistent table styling across all tabs.
 */
export default function DataTable({
  columns,
  data,
  keyExtractor,
  sortBy,
  sortDir,
  onSort,
  onRowClick,
  emptyMessage = 'No data available.',
  striped = true,
  hover = true,
  responsive = true,
  className = '',
}) {
  const [localSort, setLocalSort] = useState({ key: sortBy, dir: sortDir });

  const handleSort = (key) => {
    if (!onSort) return;
    const dir = localSort.key === key && localSort.dir === 'asc' ? 'desc' : 'asc';
    setLocalSort({ key, dir });
    onSort(key, dir);
  };

  const sortIndicator = (key) => {
    if (localSort.key !== key) return null;
    return localSort.dir === 'asc' ? ' ▲' : ' ▼';
  };

  if (!data || data.length === 0) {
    return (
      <div className="table-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48, marginBottom: 12, color: 'var(--text-muted)' }}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 9h6M9 15h4" />
        </svg>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`table-wrap ${responsive ? 'responsive' : ''} ${className}`}>
      <table className={`data-table ${striped ? 'striped' : ''} ${hover ? 'hover' : ''}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align }}
                className={col.sortable ? 'sortable' : ''}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                <span>{col.header}{col.sortable && sortIndicator(col.key)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={keyExtractor ? keyExtractor(row) : i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'clickable' : ''}
            >
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align }}>
                  {col.render ? col.render(row, i) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}