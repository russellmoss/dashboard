'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type {
  EvalListModalPayload,
  InsightsEvalListRow,
} from '@/types/call-intelligence';

interface Props {
  isOpen: boolean;
  payload: EvalListModalPayload | null;
  onClose: () => void;
  onRowClick: (evaluationId: string) => void;
  /** When true, this modal is below a deeper modal — set aria-hidden + suppress focus. */
  ariaHidden?: boolean;
}

function humanizeKey(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function scoreColor(score: number | null): string {
  if (score === null || isNaN(score)) return 'text-gray-400';
  if (score >= 3) return 'text-[#175242] font-semibold';
  if (score >= 2) return 'text-[#8e7e57] font-semibold';
  return 'text-[#c7bca1] font-semibold';
}

export default function InsightsEvalListModal({
  isOpen,
  payload,
  onClose,
  onRowClick,
  ariaHidden,
}: Props) {
  const [rows, setRows] = useState<InsightsEvalListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const qs = useMemo(() => {
    if (!payload) return '';
    const p = new URLSearchParams();
    if (payload.role) p.set('role', payload.role);
    if (payload.rubricVersion) p.set('rubric_version', String(payload.rubricVersion));
    if (payload.podId) p.set('pod', payload.podId);
    if (payload.dimension) p.set('dimension', payload.dimension);
    p.set('range', payload.dateRange.kind);
    if (payload.dateRange.kind === 'custom') {
      p.set('start', payload.dateRange.start);
      p.set('end', payload.dateRange.end);
    }
    if (payload.focusRep) p.set('rep', payload.focusRep);
    return p.toString();
  }, [payload]);

  useEffect(() => {
    if (!isOpen || !payload) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    (async () => {
      try {
        const res = await fetch(`/api/call-intelligence/insights/evals?${qs}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json() as { rows?: InsightsEvalListRow[] };
        if (!cancelled) setRows(data.rows ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, payload, qs]);

  // Focus-on-open (C4).
  useEffect(() => {
    if (isOpen && !ariaHidden) {
      const t = setTimeout(() => closeButtonRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [isOpen, ariaHidden]);

  if (!isOpen || !payload) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insights-eval-list-title"
      aria-hidden={ariaHidden}
    >
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden w-full h-full md:h-auto md:max-w-4xl md:mx-4 md:max-h-[90vh] md:rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2
              id="insights-eval-list-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              Evaluations{payload.dimension ? ` · ${humanizeKey(payload.dimension)}` : ''}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <span className="mr-2">role <strong>{payload.role}</strong></span>
              <span className="mr-2">rubric v<strong>{payload.rubricVersion}</strong></span>
              <span>range <strong>{payload.dateRange.kind}</strong></span>
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close evaluation list"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Loading…
            </div>
          )}
          {error && (
            <div className="py-4 text-center text-sm text-red-600 dark:text-red-400">
              Failed: {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              No evaluations match this filter.
            </div>
          )}
          {!loading && !error && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-200">Rep</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-200">Started</th>
                  {payload.dimension && (
                    <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-200">
                      {humanizeKey(payload.dimension)}
                    </th>
                  )}
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-200">Call</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr
                    key={r.evaluation_id}
                    role="button"
                    aria-label={`Open evaluation for ${r.rep_full_name ?? 'unknown rep'}`}
                    tabIndex={0}
                    onClick={() => onRowClick(r.evaluation_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(r.evaluation_id);
                      }
                    }}
                    className="cursor-pointer min-h-[44px] border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 focus:bg-blue-50 dark:focus:bg-blue-900/30 outline-none"
                  >
                    <td className="py-2 px-2 text-gray-900 dark:text-gray-100">
                      {r.rep_full_name ?? '—'}
                    </td>
                    <td className="py-2 px-2 text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                      {r.call_started_at ? new Date(r.call_started_at).toLocaleDateString() : '—'}
                    </td>
                    {payload.dimension && (
                      <td className={`py-2 px-2 text-right tabular-nums ${scoreColor(r.dimension_score)}`}>
                        {r.dimension_score !== null ? r.dimension_score.toFixed(1) : '—'}
                      </td>
                    )}
                    <td className="py-2 px-2 text-gray-700 dark:text-gray-300">
                      {r.call_title ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
