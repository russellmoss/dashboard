'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@tremor/react';
import { Trash2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';
import type { RubricListRow } from '@/types/call-intelligence';
import type { RubricStatusT } from '@/lib/sales-coaching-client/schemas';

function StatusBadge({ status }: { status: RubricStatusT }) {
  const cls =
    status === 'draft'
      ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
      : status === 'active'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
      : 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function RubricSection({
  title,
  role,
  rows,
  onDelete,
}: {
  title: string;
  role: 'SGA' | 'SGM';
  rows: RubricListRow[];
  onDelete: (row: RubricListRow) => void;
}) {
  const filtered = rows.filter((r) => r.role === role);
  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        <Link
          href={`/dashboard/call-intelligence/rubrics/new?role=${role}`}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Create new version
        </Link>
      </div>
      {filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No rubrics yet. Click &lsquo;Create new version&rsquo; to start.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {filtered.map((row) => {
            // Drafts: always deletable (no historical refs possible).
            // Archived: deletable IF no evaluation references it (server checks
            //   on click; UI shows the icon and surfaces 409 for blocked archives).
            // Active: never deletable (would orphan the role's scoring path).
            // System rubrics: deletable when status='archived' and no refs —
            //   the system_lock guards content edits, not row removal.
            const canDelete =
              (row.status === 'draft' && !row.created_by_is_system) ||
              row.status === 'archived';
            return (
              <li
                key={row.id}
                className="py-3 flex items-center gap-4 text-sm"
              >
                <span className="px-2 py-0.5 rounded text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 font-medium">
                  v{row.version}
                </span>
                <span className="font-medium text-gray-900 dark:text-white flex-1">
                  {row.name}
                </span>
                <StatusBadge status={row.status} />
                <span className="text-gray-500 dark:text-gray-400 text-xs">
                  {formatRelativeTimestamp(row.created_at)}
                </span>
                <span className="text-gray-500 dark:text-gray-400 text-xs">
                  by {row.created_by_name}
                </span>
                <Link
                  href={`/dashboard/call-intelligence/rubrics/${row.id}`}
                  className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                  title={row.created_by_is_system ? 'System rubric — read only' : undefined}
                >
                  {row.created_by_is_system
                    ? 'View'
                    : row.status === 'draft'
                    ? 'Edit'
                    : 'View'}
                </Link>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(row)}
                    aria-label={`Delete draft v${row.version}`}
                    title="Delete draft"
                    className="p-1.5 rounded text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function RubricsTab() {
  const [rows, setRows] = useState<RubricListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RubricListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const res = await fetch('/api/call-intelligence/rubrics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { rows: RubricListRow[] };
      setRows(json.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/call-intelligence/rubrics');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { rows: RubricListRow[] };
        if (!cancelled) setRows(json.rows ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/call-intelligence/rubrics/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string; message?: string };
        if (res.status === 409 && body.reason === 'not_in_draft') {
          throw new Error('This rubric is currently active and cannot be deleted. Re-activate a different version first.');
        }
        if (res.status === 409 && body.reason === 'has_evaluation_references') {
          throw new Error('This archived rubric cannot be deleted — historical evaluations were scored against it. Past evals would lose their rubric reference.');
        }
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      setPendingDelete(null);
      await reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-4 rounded">
          {error}
        </div>
      )}
      {rows === null && !error ? (
        <div className="py-12 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          <RubricSection title="SGA Rubrics" role="SGA" rows={rows ?? []} onDelete={setPendingDelete} />
          <RubricSection title="SGM Rubrics" role="SGM" rows={rows ?? []} onDelete={setPendingDelete} />
        </>
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          row={pendingDelete}
          submitting={deleting}
          error={deleteError}
          onCancel={() => {
            if (deleting) return;
            setPendingDelete(null);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function DeleteConfirmModal({
  row,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  row: RubricListRow;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-rubric-title"
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full shadow-xl">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="delete-rubric-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Delete draft rubric?
          </h2>
        </div>
        <div className="px-6 py-4 text-sm text-gray-700 dark:text-gray-200 space-y-3">
          <p>
            <span className="font-mono">{row.role}</span> v{row.version} —{' '}
            <span className="font-medium">{row.name}</span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            This permanently removes the draft. Active and archived versions
            for this role are unaffected. This cannot be undone.
          </p>
          {error && (
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Deleting…' : 'Delete draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
