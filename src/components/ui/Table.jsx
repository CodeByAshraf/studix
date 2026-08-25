// src/components/ui/Table.jsx
import { useState } from 'react';
import { paginate } from '../../utils/helpers';

/**
 * columns: [{ key, label, render?, sortable?, width? }]
 * rows:    array of data objects
 */
export default function Table({
  columns = [],
  rows = [],
  loading = false,
  emptyMessage = 'لا توجد بيانات',
  emptyIcon = '📋',
  pageSize = 10,
  onRowClick,
  rowKey = 'id',
  actions,       // (row) => JSX — rendered in last column
  stickyHeader = false,
}) {
  const [page, setPage]         = useState(1);
  const [sortKey, setSortKey]   = useState(null);
  const [sortDir, setSortDir]   = useState('asc');

  // ── Sort ──────────────────────────────────────────────────
  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const va = a[sortKey] ?? '';
        const vb = b[sortKey] ?? '';
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : rows;

  const pg = paginate(sorted, page, pageSize);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  // ── Skeleton loading ──────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        {Array(5).fill(0).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 44, marginBottom: 8, opacity: 1 - i * 0.15 }}/>
        ))}
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────
  if (!rows.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">{emptyIcon}</div>
        <div className="empty-text">{emptyMessage}</div>
      </div>
    );
  }

  const hasActions = typeof actions === 'function';

  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead style={stickyHeader ? { position: 'sticky', top: 0, zIndex: 1 } : {}}>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={{ width: col.width, cursor: col.sortable ? 'pointer' : 'default', userSelect: 'none' }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <span style={{ fontSize: 10, opacity: 0.7 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </span>
                </th>
              ))}
              {hasActions && <th style={{ width: 120 }}></th>}
            </tr>
          </thead>
          <tbody>
            {pg.items.map((row, i) => (
              <tr
                key={row[rowKey] || i}
                onClick={() => onRowClick?.(row)}
                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
              >
                {columns.map(col => (
                  <td key={col.key}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                  </td>
                ))}
                {hasActions && (
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {actions(row)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pg.totalPages > 1 && (
        <div className="pagination">
          <span className="pg-info">عرض {pg.start}–{pg.end} من {pg.total}</span>
          <div className="pg-btns">
            <button className="pg-btn" disabled={!pg.hasPrev} onClick={() => setPage(p => p - 1)}>›</button>
            {Array.from({ length: pg.totalPages }, (_, i) => i + 1)
              .filter(p => Math.abs(p - page) <= 2 || p === 1 || p === pg.totalPages)
              .map((p, i, arr) => (
                <span key={p}>
                  {i > 0 && arr[i - 1] !== p - 1 && (
                    <span style={{ padding: '0 4px', color: 'var(--text3)' }}>…</span>
                  )}
                  <button
                    className={`pg-btn ${p === page ? 'active' : ''}`}
                    onClick={() => setPage(p)}
                  >{p}</button>
                </span>
              ))}
            <button className="pg-btn" disabled={!pg.hasNext} onClick={() => setPage(p => p + 1)}>‹</button>
          </div>
        </div>
      )}
    </>
  );
}
