'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@tremor/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { ContentRefinementRow } from '@/types/call-intelligence';

interface RefinementsResponse {
  rows?: ContentRefinementRow[];
  error?: string;
}

interface DeclineModalState {
  refinementId: string;
  notes: string;
  submitting: boolean;
  error: string | null;
}

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

export default function AdminRefinementsTab() {
  const [rows, setRows] = useState<ContentRefinementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [declineModal, setDeclineModal] = useState<DeclineModalState | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/call-intelligence/refinements?status=open', { cache: 'no-store' });
      const json: RefinementsResponse = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        setRows([]);
      } else {
        setRows(json.rows ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load refinements');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function handleResolve(refinementId: string, resolution: 'addressed' | 'declined', notes?: string) {
    setPendingId(refinementId);
    setRowError((prev) => ({ ...prev, [refinementId]: '' }));
    try {
      const body: { resolution: 'addressed' | 'declined'; resolution_notes?: string } = { resolution };
      if (notes) body.resolution_notes = notes;
      const res = await fetch(`/api/call-intelligence/refinements/${refinementId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 409 && json.current_status) {
        setRowError((prev) => ({ ...prev, [refinementId]: `Already resolved by another admin (${json.current_status}) — refresh.` }));
        return;
      }
      if (!res.ok) {
        setRowError((prev) => ({ ...prev, [refinementId]: json.error ?? `HTTP ${res.status}` }));
        return;
      }
      // remove row optimistically
      setRows((prev) => prev.filter((r) => r.id !== refinementId));
      if (declineModal?.refinementId === refinementId) setDeclineModal(null);
    } catch (err) {
      setRowError((prev) => ({ ...prev, [refinementId]: err instanceof Error ? err.message : 'Resolve failed' }));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Open content refinements</h2>
        <button
          type="button"
          onClick={reload}
          className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded"
        >
          Refresh
        </button>
      </div>

      {loading && <div className="py-12 flex justify-center"><LoadingSpinner /></div>}
      {!loading && error && (
        <div className="py-8 px-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">No open refinement requests.</div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Created</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Requester</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Eval</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Doc</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Suggested change</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 align-top">
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDate(r.created_at)}</td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{r.requested_by_full_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <Link
                      href={`/dashboard/call-intelligence/evaluations/${r.evaluation_id}?returnTab=admin-refinements`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {r.evaluation_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <a href={r.drive_url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                      Open doc
                    </a>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 max-w-md">
                    <div className="font-medium">{truncate(r.suggested_change, 200)}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Excerpt: {truncate(r.current_chunk_excerpt, 140)}</div>
                  </td>
                  <td className="px-3 py-2 text-sm text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={pendingId === r.id}
                      onClick={() => handleResolve(r.id, 'addressed')}
                      className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded"
                    >
                      Mark addressed
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === r.id}
                      onClick={() => setDeclineModal({ refinementId: r.id, notes: '', submitting: false, error: null })}
                      className="ml-2 px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100 rounded"
                    >
                      Decline
                    </button>
                    {rowError[r.id] && (
                      <div className="mt-1 text-xs text-red-600 dark:text-red-400">{rowError[r.id]}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {declineModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Decline refinement</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Provide a reason (required when declining).</p>
            <textarea
              value={declineModal.notes}
              onChange={(e) => setDeclineModal({ ...declineModal, notes: e.target.value })}
              rows={4}
              className="mt-3 block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 shadow-sm text-sm"
            />
            {declineModal.error && (
              <div className="mt-2 text-xs text-red-600 dark:text-red-400">{declineModal.error}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeclineModal(null)}
                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!declineModal.notes.trim() || declineModal.submitting}
                onClick={async () => {
                  if (!declineModal.notes.trim()) {
                    setDeclineModal({ ...declineModal, error: 'Notes required when declining.' });
                    return;
                  }
                  setDeclineModal({ ...declineModal, submitting: true, error: null });
                  await handleResolve(declineModal.refinementId, 'declined', declineModal.notes.trim());
                }}
                className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded"
              >
                {declineModal.submitting ? 'Declining…' : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
