'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@tremor/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { EvaluationQueueRow } from '@/types/call-intelligence';

type HistoryFilter = 'pending' | 'revealed' | 'all';

interface Props {
  role: string;
  /** 'mine' for SGM/SGA (coachee view); 'queue' for manager/admin (reviewer view). */
  mode: 'mine' | 'queue';
}

interface QueueResponse {
  rows: EvaluationQueueRow[];
  generated_at: string;
  historyFilter?: HistoryFilter;
  notice?: string;
}

const FILTER_LABELS: Record<HistoryFilter, string> = {
  pending: 'Pending',
  revealed: 'Revealed',
  all: 'All',
};

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function formatDateOnly(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleDateString();
}

function formatTimeOnly(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function StatusBadge({ status }: { status: EvaluationQueueRow['status'] }) {
  const cls = status === 'pending_review'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    : status === 'revealed'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

export default function QueueTab({ role: _role, mode }: Props) {
  const router = useRouter();
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('pending');
  const [rows, setRows] = useState<EvaluationQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/call-intelligence/queue?status=${historyFilter}`, { cache: 'no-store' });
        const json: QueueResponse = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError((json as { error?: string }).error ?? `HTTP ${res.status}`);
          setRows([]);
        } else {
          setRows(json.rows ?? []);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load queue');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [historyFilter]);

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {mode === 'mine' ? 'My Evaluations' : 'Review Queue'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {mode === 'mine'
              ? 'AI evaluations of your calls. Pending entries are awaiting reveal by your reviewer.'
              : 'Evaluations assigned to you for review.'}
          </p>
        </div>
        <div className="inline-flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
          {(Object.keys(FILTER_LABELS) as HistoryFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setHistoryFilter(f)}
              className={`px-3 py-1 text-xs transition-colors ${
                historyFilter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="py-12 flex justify-center">
          <LoadingSpinner />
        </div>
      )}

      {!loading && error && (
        <div className="py-8 px-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {mode === 'mine'
            ? (historyFilter === 'pending' ? 'No pending evaluations.' : 'No evaluations.')
            : (historyFilter === 'pending' ? 'No pending reviews.' : 'No evaluations.')}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Time</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Rep</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Advisor</th>
                {mode === 'queue' && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reviewer</th>
                )}
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Edit ver.</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Scheduled reveal</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Call ID</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((r) => {
                const href = `/dashboard/call-intelligence/evaluations/${r.evaluation_id}?returnTab=queue`;
                return (
                  <tr
                    key={r.evaluation_id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(href);
                      }
                    }}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700"
                  >
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">{formatDateOnly(r.call_started_at)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatTimeOnly(r.call_started_at)}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{r.rep_full_name ?? '—'}</td>
                    <td
                      className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300"
                      title={r.call_title ?? undefined}
                    >
                      {r.advisor_name ?? '—'}
                    </td>
                    {mode === 'queue' && (
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.assigned_manager_full_name ?? '—'}</td>
                    )}
                    <td className="px-3 py-2 text-sm"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.edit_version}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDate(r.scheduled_reveal_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono" title={r.call_note_id}>
                      {r.call_note_id.slice(0, 8)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
