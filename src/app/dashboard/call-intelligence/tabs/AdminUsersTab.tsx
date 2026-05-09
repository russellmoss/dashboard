'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@tremor/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { CoachingRep } from '@/types/call-intelligence';
import type { RoleT } from '@/lib/sales-coaching-client/schemas';

const ROLE_OPTIONS: RoleT[] = ['admin', 'manager', 'SGM', 'SGA', 'om', 'csa'];
const POLICY_OPTIONS = ['manual', 'auto_delay', 'auto_immediate'] as const;
type RevealPolicy = (typeof POLICY_OPTIONS)[number];

interface UsersResponse {
  rows?: CoachingRep[];
  error?: string;
}

interface CreateForm {
  email: string;
  full_name: string;
  role: RoleT;
  manager_id: string | null;
  reveal_policy: RevealPolicy;
  reveal_delay_minutes: number | null;
  reveal_reminder_minutes: number | null;
}

const EMPTY_CREATE: CreateForm = {
  email: '',
  full_name: '',
  role: 'SGA',
  manager_id: null,
  reveal_policy: 'manual',
  reveal_delay_minutes: null,
  reveal_reminder_minutes: null,
};

interface BulkReassignState {
  repId: string;
  blockingCount: number;
  selectedManagerId: string | null;
  status: 'idle' | 'reassigning' | 'retrying' | 'error';
  errorMsg: string | null;
}

export default function AdminUsersTab() {
  const [rows, setRows] = useState<CoachingRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [bulkState, setBulkState] = useState<BulkReassignState | null>(null);

  const managerOptions = useMemo(
    () => rows.filter((r) => r.is_active && (r.role === 'manager' || r.role === 'admin')),
    [rows],
  );

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/call-intelligence/users?includeInactive=${includeInactive}`, { cache: 'no-store' });
      const json: UsersResponse = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        setRows([]);
      } else {
        setRows(json.rows ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!createForm.email.toLowerCase().endsWith('@savvywealth.com')) {
      setCreateError('Email must end with @savvywealth.com');
      return;
    }
    setCreateSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        email: createForm.email,
        full_name: createForm.full_name,
        role: createForm.role,
      };
      if ((createForm.role === 'SGA' || createForm.role === 'SGM') && createForm.manager_id) {
        body.manager_id = createForm.manager_id;
      }
      const res = await fetch('/api/call-intelligence/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setCreateError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setShowAddForm(false);
      setCreateForm(EMPTY_CREATE);
      await reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleDeactivate(repId: string) {
    try {
      const res = await fetch(`/api/call-intelligence/users/${repId}/deactivate`, { method: 'POST' });
      const json = await res.json();
      if (res.status === 409 && json.blocked_reason === 'pending_evaluations') {
        setBulkState({
          repId,
          blockingCount: json.blocking_count ?? 0,
          selectedManagerId: null,
          status: 'idle',
          errorMsg: null,
        });
        return;
      }
      if (res.status === 409 && json.blocked_reason === 'active_direct_reports') {
        alert(`This user has ${json.blocking_count} active direct reports — reassign reports first. (Out of scope for this UI.)`);
        return;
      }
      if (!res.ok) {
        alert(json.error ?? `Deactivate failed: HTTP ${res.status}`);
        return;
      }
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Deactivate failed');
    }
  }

  async function handleBulkReassignAndRetry() {
    if (!bulkState || !bulkState.selectedManagerId) return;
    setBulkState({ ...bulkState, status: 'reassigning', errorMsg: null });
    try {
      const reassignRes = await fetch(
        `/api/call-intelligence/users/${bulkState.repId}/bulk-reassign-pending-evals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_manager_id: bulkState.selectedManagerId }),
        },
      );
      const reassignJson = await reassignRes.json();
      if (!reassignRes.ok) {
        setBulkState({ ...bulkState, status: 'error', errorMsg: reassignJson.error ?? `Reassign failed (${reassignRes.status})` });
        return;
      }
      setBulkState({ ...bulkState, status: 'retrying', errorMsg: null });
      const retryRes = await fetch(`/api/call-intelligence/users/${bulkState.repId}/deactivate`, { method: 'POST' });
      const retryJson = await retryRes.json();
      if (!retryRes.ok) {
        setBulkState({ ...bulkState, status: 'error', errorMsg: retryJson.error ?? `Deactivate retry failed (${retryRes.status})` });
        return;
      }
      setBulkState(null);
      await reload();
    } catch (err) {
      setBulkState({
        ...bulkState,
        status: 'error',
        errorMsg: err instanceof Error ? err.message : 'Bulk reassign failed',
      });
    }
  }

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Coaching Users</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Show inactive
          </label>
          <button
            type="button"
            onClick={() => setShowAddForm((s) => !s)}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            {showAddForm ? 'Cancel' : 'Add user'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-gray-50 dark:bg-gray-900/40 rounded space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Email</label>
              <input
                type="email"
                required
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                className="mt-1 block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Full name</label>
              <input
                type="text"
                required
                value={createForm.full_name}
                onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                className="mt-1 block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Role</label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as RoleT, manager_id: null })}
                className="mt-1 block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm"
              >
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Manager {(createForm.role === 'SGA' || createForm.role === 'SGM') ? '(required)' : '(N/A for this role)'}
              </label>
              <select
                value={createForm.manager_id ?? ''}
                disabled={!(createForm.role === 'SGA' || createForm.role === 'SGM')}
                onChange={(e) => setCreateForm({ ...createForm, manager_id: e.target.value || null })}
                className="mt-1 block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm disabled:opacity-50"
              >
                <option value="">— Select manager —</option>
                {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>)}
              </select>
            </div>
          </div>
          {createError && <div className="text-xs text-red-600 dark:text-red-400">{createError}</div>}
          <div>
            <button type="submit" disabled={createSubmitting} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded">
              {createSubmitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      )}

      {loading && <div className="py-12 flex justify-center"><LoadingSpinner /></div>}

      {!loading && error && (
        <div className="py-8 px-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Email</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Role</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Manager</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Active</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Reveal policy</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{r.full_name}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.email}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.role}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.manager_full_name ?? '—'}</td>
                  <td className="px-3 py-2 text-sm">
                    <span className={r.is_active ? 'text-green-700 dark:text-green-400' : 'text-gray-400'}>
                      {r.is_active ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.reveal_policy}</td>
                  <td className="px-3 py-2 text-sm text-right">
                    {r.is_active && (
                      <button
                        type="button"
                        onClick={() => handleDeactivate(r.id)}
                        className="text-xs px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {bulkState && (
                <tr className="bg-amber-50 dark:bg-amber-900/30">
                  <td colSpan={7} className="px-3 py-3">
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <strong>Cannot deactivate</strong> — user has {bulkState.blockingCount} pending evaluations.
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-gray-700 dark:text-gray-300">Reassign to:</span>
                      <select
                        value={bulkState.selectedManagerId ?? ''}
                        onChange={(e) => setBulkState({ ...bulkState, selectedManagerId: e.target.value || null })}
                        className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-sm"
                      >
                        <option value="">— Select new manager —</option>
                        {managerOptions
                          .filter((m) => m.id !== bulkState.repId)
                          .map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.role})</option>)}
                      </select>
                      <button
                        type="button"
                        disabled={!bulkState.selectedManagerId || bulkState.status !== 'idle'}
                        onClick={handleBulkReassignAndRetry}
                        className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                      >
                        {bulkState.status === 'reassigning' && 'Reassigning…'}
                        {bulkState.status === 'retrying' && 'Retrying deactivate…'}
                        {(bulkState.status === 'idle' || bulkState.status === 'error') && 'Reassign all and retry'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkState(null)}
                        className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                    {bulkState.errorMsg && (
                      <div className="mt-2 text-xs text-red-600 dark:text-red-400">{bulkState.errorMsg}</div>
                    )}
                  </td>
                </tr>
              )}
              {rows.length === 0 && !bulkState && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
