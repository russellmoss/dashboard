'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from '@tremor/react';
import { ExternalLink } from 'lucide-react';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';

interface Refinement {
  id: string;
  evaluation_id: string;
  doc_id: string;
  drive_url: string;
  current_chunk_excerpt: string;
  suggested_change: string;
  status: 'open' | 'addressed' | 'declined';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

interface Props {
  /** Optional eval_id to highlight (anchored from a duplicate-refinement banner click). */
  highlightEvaluationId?: string | null;
}

export function MyRefinementsTable({ highlightEvaluationId = null }: Props) {
  const [rows, setRows] = useState<Refinement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/call-intelligence/my-content-refinements', {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setRows(json.requests ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <h2 className="text-lg font-semibold dark:text-white mb-4">My refinement requests</h2>
      {loading && <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>}
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          You haven&apos;t filed any refinement requests yet.
        </div>
      )}
      {!loading && rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Submitted</TableHeaderCell>
              <TableHeaderCell>Doc</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Resolution notes</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const highlighted = highlightEvaluationId && r.evaluation_id === highlightEvaluationId;
              return (
                <TableRow
                  key={r.id}
                  className={
                    highlighted ? 'bg-amber-50 dark:bg-amber-900/20' : undefined
                  }
                >
                  <TableCell title={r.created_at}>
                    {formatRelativeTimestamp(r.created_at)}
                  </TableCell>
                  <TableCell>
                    <a
                      href={r.drive_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {r.doc_id} <ExternalLink className="w-3 h-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-sm text-gray-700 dark:text-gray-300 max-w-md whitespace-pre-wrap">
                    {r.resolution_notes ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: Refinement['status'] }) {
  const cls = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    addressed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    declined: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  }[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
