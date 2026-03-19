'use client';

import { useMemo, useState } from 'react';
import type { TableSpec } from '@/types/reporting';
import { formatReportingValue } from './formatting';

export function TableRenderer({ spec }: { spec: TableSpec }) {
  const [sortKey, setSortKey] = useState(spec.sortBy?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(spec.sortBy?.direction ?? 'asc');
  const [showAll, setShowAll] = useState(false);

  const sortedRows = useMemo(() => {
    if (!sortKey) return spec.rows;
    return [...spec.rows].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [spec.rows, sortKey, sortDir]);

  const displayRows = spec.maxRows && !showAll
    ? sortedRows.slice(0, spec.maxRows)
    : sortedRows;

  const handleSort = (key: string, sortable?: boolean) => {
    if (sortable === false) return;
    if (sortKey === key) {
      setSortDir(direction => direction === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="my-6">
      <h4 className="text-sm font-medium text-muted-foreground mb-3">{spec.title}</h4>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              {spec.columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap ${
                    col.sortable !== false ? 'cursor-pointer hover:text-foreground select-none' : ''
                  } text-${col.align ?? 'left'}`}
                  onClick={() => handleSort(col.key, col.sortable)}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => {
              const isHighlighted = spec.highlightRow &&
                row[spec.highlightRow.key] === spec.highlightRow.value;

              return (
                <tr
                  key={rowIndex}
                  className={`border-t border-border ${
                    isHighlighted ? 'bg-primary/5 font-medium' : 'hover:bg-muted/30'
                  }`}
                >
                  {spec.columns.map(col => (
                    <td
                      key={col.key}
                      className={`px-4 py-2.5 whitespace-nowrap text-${col.align ?? 'left'}`}
                    >
                      {formatReportingValue(row[col.key], col.format, `${spec.title} ${col.label} ${col.key}`)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {spec.maxRows && sortedRows.length > spec.maxRows && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-sm text-primary hover:underline"
        >
          Show all {sortedRows.length} rows
        </button>
      )}
    </div>
  );
}
