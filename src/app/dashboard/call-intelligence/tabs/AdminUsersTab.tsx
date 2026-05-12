'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@tremor/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { CoachingRep } from '@/types/call-intelligence';
import type {
  RoleT,
  ManagerSummaryT,
  CoachingTeamSummaryT,
  GranolaKeyStatusT,
} from '@/lib/sales-coaching-client/schemas';

// ─── Constants ────────────────────────────────────────────────────────────────

// Order tracks the spec: admin | manager | SGM | SGA | OM. Note: 'OM' displays
// uppercase but the wire value is lowercase 'om' (RoleSchema). 'csa' is
// deliberately excluded — Thread 2 drops it. 'csa' rows that already exist in
// the DB still render in the table, just not in this dropdown.
const ROLE_OPTIONS: readonly RoleT[] = ['admin', 'manager', 'SGM', 'SGA', 'om'] as const;
const ROLE_LABELS: Record<RoleT, string> = {
  admin: 'admin',
  manager: 'manager',
  SGM: 'SGM',
  SGA: 'SGA',
  om: 'OM',
  csa: 'csa', // legacy display only
};
const POLICY_OPTIONS = ['manual', 'auto_delay', 'auto_immediate'] as const;
type RevealPolicy = (typeof POLICY_OPTIONS)[number];

const SLACK_ID_RE = /^U[A-Z0-9]+$/;
const GRANOLA_PREFIX = 'grn_';

function roleRequiresManager(role: RoleT): boolean {
  return role === 'SGA' || role === 'SGM';
}

function validateEmail(v: string): string | null {
  if (!v) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email';
  if (!v.toLowerCase().endsWith('@savvywealth.com')) return 'Must be a @savvywealth.com address';
  return null;
}
function validateSlack(v: string): string | null {
  if (!v) return null;
  if (v.length > 40) return 'Slack ID exceeds 40 chars';
  if (!SLACK_ID_RE.test(v)) return 'Slack ID must look like "U…" (letters/digits only)';
  return null;
}
function validateSfdc(v: string): string | null {
  if (!v) return null;
  if (v.length !== 15 && v.length !== 18) return 'SFDC User ID must be 15 or 18 chars';
  return null;
}
function validateGranola(v: string): string | null {
  if (!v) return null;
  if (!v.startsWith(GRANOLA_PREFIX)) return 'Granola key must start with "grn_"';
  if (v.length > 500) return 'Granola key is unreasonably long';
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsersResponse { rows?: CoachingRep[]; error?: string; }
interface ManagersResponse { managers?: ManagerSummaryT[]; error?: string; }
interface TeamsResponse { teams?: CoachingTeamSummaryT[]; error?: string; }

interface UserFormState {
  email: string;
  full_name: string;
  role: RoleT;
  manager_id: string | null;
  slack_user_id: string;
  sfdc_user_id: string;
  granola_key: string;        // Add-only; in Edit, this is "set new key" field
  pod_team_id: string | null; // Add-only single selection; Edit uses per-pod buttons instead
}

const EMPTY_FORM: UserFormState = {
  email: '',
  full_name: '',
  role: 'SGA',
  manager_id: null,
  slack_user_id: '',
  sfdc_user_id: '',
  granola_key: '',
  pod_team_id: null,
};

interface BulkReassignState {
  repId: string;
  blockingCount: number;
  selectedManagerId: string | null;
  status: 'idle' | 'reassigning' | 'retrying' | 'error';
  errorMsg: string | null;
}

// Granola validation pill shown after a save / verify call resolves.
type GranolaPill =
  | { kind: 'idle' }
  | { kind: 'valid'; at?: string }     // 200 + status='valid'
  | { kind: 'unverified'; at?: string } // 200 + status='unknown'
  | { kind: 'invalid'; at?: string }    // verify only → granola_key_status='invalid'
  | { kind: 'no_key' }                  // verify only → status='no_key'
  | { kind: 'rejected'; message: string }; // 400 (server rejected at write time)

// ─── Pill ─────────────────────────────────────────────────────────────────────

function GranolaPillBadge({ pill }: { pill: GranolaPill }) {
  if (pill.kind === 'idle') return null;
  const stamp = 'at' in pill && pill.at ? new Date(pill.at).toLocaleString() : null;
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium';
  switch (pill.kind) {
    case 'valid':
      return <span className={`${base} bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300`}>✓ Verified{stamp ? ` (${stamp})` : ''}</span>;
    case 'unverified':
      return <span className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`}>⚠ Granola unreachable — poll will retry in 30 min</span>;
    case 'invalid':
      return <span className={`${base} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300`}>✗ Stored key rejected by Granola</span>;
    case 'no_key':
      return <span className={`${base} bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200`}>No key on file</span>;
    case 'rejected':
      return <span className={`${base} bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300`}>✗ {pill.message}</span>;
  }
}

function granolaPillFromRep(rep: CoachingRep): GranolaPill {
  if (!rep.has_granola_key) return { kind: 'no_key' };
  const at = rep.granola_key_last_validated_at ?? undefined;
  switch (rep.granola_key_status) {
    case 'valid': return { kind: 'valid', at };
    case 'unverified': return { kind: 'unverified', at };
    case 'invalid': return { kind: 'invalid', at };
  }
}

function statusLabel(status: GranolaKeyStatusT | null, hasKey: boolean): string {
  if (!hasKey) return 'no key';
  return status ?? 'unverified';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AdminUsersTab() {
  const [rows, setRows] = useState<CoachingRep[]>([]);
  const [managers, setManagers] = useState<ManagerSummaryT[]>([]);
  const [teams, setTeams] = useState<CoachingTeamSummaryT[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingRepId, setEditingRepId] = useState<string | null>(null);
  const [bulkState, setBulkState] = useState<BulkReassignState | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, managersRes, teamsRes] = await Promise.all([
        fetch(`/api/call-intelligence/users?includeInactive=${includeInactive}`, { cache: 'no-store' }),
        fetch('/api/call-intelligence/managers', { cache: 'no-store' }),
        fetch('/api/call-intelligence/coaching-teams', { cache: 'no-store' }),
      ]);
      const usersJson: UsersResponse = await usersRes.json();
      const managersJson: ManagersResponse = await managersRes.json();
      const teamsJson: TeamsResponse = await teamsRes.json();
      if (!usersRes.ok) { setError(usersJson.error ?? `Users HTTP ${usersRes.status}`); setRows([]); return; }
      if (!managersRes.ok) { setError(managersJson.error ?? `Managers HTTP ${managersRes.status}`); return; }
      if (!teamsRes.ok) { setError(teamsJson.error ?? `Teams HTTP ${teamsRes.status}`); return; }
      setRows(usersJson.rows ?? []);
      setManagers(managersJson.managers ?? []);
      setTeams(teamsJson.teams ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => { void reload(); }, [reload]);

  const editingRep = useMemo(
    () => (editingRepId ? rows.find((r) => r.id === editingRepId) ?? null : null),
    [rows, editingRepId],
  );

  // ─── Deactivate flow (preserved from prior implementation) ─────────────────

  async function handleDeactivate(repId: string) {
    try {
      const res = await fetch(`/api/call-intelligence/users/${repId}/deactivate`, { method: 'POST' });
      const json = await res.json();
      if (res.status === 409 && json.blocked_reason === 'pending_evaluations') {
        setBulkState({ repId, blockingCount: json.blocking_count ?? 0, selectedManagerId: null, status: 'idle', errorMsg: null });
        return;
      }
      if (res.status === 409 && json.blocked_reason === 'active_direct_reports') {
        alert(`This user has ${json.blocking_count} active direct reports — reassign reports first. (Out of scope for this UI.)`);
        return;
      }
      if (!res.ok) { alert(json.error ?? `Deactivate failed: HTTP ${res.status}`); return; }
      setEditingRepId(null);
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
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_manager_id: bulkState.selectedManagerId }) },
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
      setBulkState({ ...bulkState, status: 'error', errorMsg: err instanceof Error ? err.message : 'Bulk reassign failed' });
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
            onClick={() => { setShowAddForm((s) => !s); setEditingRepId(null); }}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            {showAddForm ? 'Cancel' : 'Add user'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <AddUserForm
          managers={managers}
          teams={teams}
          onCancel={() => setShowAddForm(false)}
          onCreated={async () => { setShowAddForm(false); await reload(); }}
        />
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
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Reveal</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Granola</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{r.full_name}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.email}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{ROLE_LABELS[r.role] ?? r.role}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.manager_full_name ?? '—'}</td>
                  <td className="px-3 py-2 text-sm">
                    <span className={r.is_active ? 'text-green-700 dark:text-green-400' : 'text-gray-400'}>{r.is_active ? 'Yes' : 'No'}</span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.reveal_policy}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{statusLabel(r.granola_key_status, r.has_granola_key)}</td>
                  <td className="px-3 py-2 text-sm text-right">
                    <button
                      type="button"
                      onClick={() => { setEditingRepId(r.id); setShowAddForm(false); }}
                      className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded mr-1"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {bulkState && (
                <tr className="bg-amber-50 dark:bg-amber-900/30">
                  <td colSpan={8} className="px-3 py-3">
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      <strong>Cannot deactivate</strong> — user has {bulkState.blockingCount} pending evaluations.
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-gray-700 dark:text-gray-300">Reassign to:</span>
                      <select
                        value={bulkState.selectedManagerId ?? ''}
                        onChange={(e) => setBulkState({ ...bulkState, selectedManagerId: e.target.value || null })}
                        className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 text-sm"
                      >
                        <option value="">— Select new manager —</option>
                        {managers.filter((m) => m.id !== bulkState.repId).map((m) => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
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
                    {bulkState.errorMsg && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{bulkState.errorMsg}</div>}
                  </td>
                </tr>
              )}
              {rows.length === 0 && !bulkState && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingRep && (
        <EditUserDrawer
          rep={editingRep}
          rows={rows}
          managers={managers}
          teams={teams}
          onClose={() => setEditingRepId(null)}
          onReload={reload}
          onDeactivate={() => handleDeactivate(editingRep.id)}
        />
      )}
    </Card>
  );
}

// ─── Add form ─────────────────────────────────────────────────────────────────

interface AddUserFormProps {
  managers: ManagerSummaryT[];
  teams: CoachingTeamSummaryT[];
  onCancel: () => void;
  onCreated: () => Promise<void>;
}

function AddUserForm({ managers, teams, onCancel, onCreated }: AddUserFormProps) {
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof UserFormState, string>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const granolaInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-clear manager_id when role flips to a forbidden-manager role.
  useEffect(() => {
    if (!roleRequiresManager(form.role) && form.manager_id !== null) {
      setForm((f) => ({ ...f, manager_id: null }));
    }
  }, [form.role, form.manager_id]);

  function validate(): Partial<Record<keyof UserFormState, string>> {
    const errs: Partial<Record<keyof UserFormState, string>> = {};
    const emailErr = validateEmail(form.email);
    if (emailErr) errs.email = emailErr;
    if (!form.full_name.trim()) errs.full_name = 'Full name is required';
    if (roleRequiresManager(form.role) && !form.manager_id) errs.manager_id = `${ROLE_LABELS[form.role]}s require a canonical manager`;
    const slackErr = validateSlack(form.slack_user_id.trim());
    if (slackErr) errs.slack_user_id = slackErr;
    const sfdcErr = validateSfdc(form.sfdc_user_id.trim());
    if (sfdcErr) errs.sfdc_user_id = sfdcErr;
    const granolaErr = validateGranola(form.granola_key.trim());
    if (granolaErr) errs.granola_key = granolaErr;
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);
    setWarnings([]);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        role: form.role,
      };
      if (roleRequiresManager(form.role) && form.manager_id) body.manager_id = form.manager_id;
      if (form.slack_user_id.trim()) body.slack_user_id = form.slack_user_id.trim();
      if (form.sfdc_user_id.trim()) body.sfdc_user_id = form.sfdc_user_id.trim();

      const res = await fetch('/api/call-intelligence/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        // Backend doesn't yet translate 23505 duplicate-email into a typed 409 —
        // surface a gentler hint on 500 with the email signal. (Tracked as
        // backend follow-up; remove this branch when the kernel typed-errors it.)
        if (res.status === 500) {
          setFieldErrors({ ...errs, email: 'Email may already be in use — try the Edit screen on the existing user instead.' });
        } else if (res.status === 400) {
          setTopError(json.error ?? 'Invalid request');
        } else if (res.status === 403 || res.status === 401) {
          setTopError(json.error ?? `Authorization failed (${res.status})`);
        } else {
          setTopError(json.error ?? `Create failed (${res.status})`);
        }
        return;
      }

      const newRepId: string | undefined = json?.rep?.id;
      if (!newRepId) {
        setTopError('Create succeeded but rep id missing in response.');
        await onCreated();
        return;
      }

      // Secondary writes — fire-and-collect: pod add + granola key save in parallel.
      // Per refinement: do NOT roll back the create if a secondary fails.
      const secondaryFailures: string[] = [];
      const secondaryCalls: Promise<void>[] = [];

      if (form.pod_team_id) {
        secondaryCalls.push(
          fetch(`/api/call-intelligence/coaching-teams/${form.pod_team_id}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rep_id: newRepId }),
          }).then(async (r) => {
            if (!r.ok) {
              const b = await r.json().catch(() => ({}));
              secondaryFailures.push(`Pod assignment failed: ${b.error ?? `HTTP ${r.status}`}`);
            }
          }).catch((err) => {
            secondaryFailures.push(`Pod assignment failed: ${err instanceof Error ? err.message : 'network'}`);
          }),
        );
      }

      if (form.granola_key.trim()) {
        secondaryCalls.push(
          fetch(`/api/call-intelligence/users/${newRepId}/granola-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: form.granola_key.trim() }),
          }).then(async (r) => {
            if (!r.ok) {
              const b = await r.json().catch(() => ({}));
              const code = b?.issues?.error;
              if (code === 'granola_key_rejected' || code === 'granola_key_malformed') {
                secondaryFailures.push(`Granola key rejected: ${b.issues?.message ?? b.error ?? 'unknown reason'}`);
              } else {
                secondaryFailures.push(`Granola key save failed: ${b.error ?? `HTTP ${r.status}`}`);
              }
            }
          }).catch((err) => {
            secondaryFailures.push(`Granola key save failed: ${err instanceof Error ? err.message : 'network'}`);
          }),
        );
      }

      await Promise.allSettled(secondaryCalls);

      if (secondaryFailures.length > 0) {
        setWarnings([
          `User created — but: ${secondaryFailures.join(' / ')}.`,
          'You can fix this from the Edit screen on the newly-created user.',
        ]);
        // Still close + reload after the user has a chance to read it.
        setTimeout(() => { void onCreated(); }, 0);
        // Don't auto-close on warnings — let admin read them.
        return;
      }

      setForm(EMPTY_FORM);
      await onCreated();
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  const managerRequired = roleRequiresManager(form.role);

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 bg-gray-50 dark:bg-gray-900/40 rounded space-y-3 border border-gray-200 dark:border-gray-700">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FormField label="Email" required error={fieldErrors.email}>
          <input
            type="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="user@savvywealth.com"
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm"
          />
        </FormField>

        <FormField label="Full name" required error={fieldErrors.full_name}>
          <input
            type="text" required value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm"
          />
        </FormField>

        <FormField label="Role" required>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as RoleT })}
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm"
          >
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </FormField>

        <FormField
          label={`Canonical manager ${managerRequired ? '(required)' : '(not applicable)'}`}
          error={fieldErrors.manager_id}
          help="Determines DM fan-out: rep_review_dm, manager_reminder, granola_manager_monitor."
        >
          <select
            value={form.manager_id ?? ''}
            disabled={!managerRequired}
            onChange={(e) => setForm({ ...form, manager_id: e.target.value || null })}
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm disabled:opacity-50"
          >
            <option value="">— Select manager —</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </FormField>

        <FormField
          label="Pod / director (optional)"
          help="Analytics + coaching overlay. Orthogonal to canonical manager — valid for any role."
        >
          <select
            value={form.pod_team_id ?? ''}
            onChange={(e) => setForm({ ...form, pod_team_id: e.target.value || null })}
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm"
          >
            <option value="">— No pod —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — led by {t.lead_full_name ?? 'no lead'}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Slack member ID (optional)" error={fieldErrors.slack_user_id}>
          <input
            type="text" value={form.slack_user_id}
            onChange={(e) => setForm({ ...form, slack_user_id: e.target.value })}
            placeholder="U0123ABC456"
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm font-mono"
          />
        </FormField>

        <FormField label="Salesforce User ID (optional)" error={fieldErrors.sfdc_user_id}>
          <input
            type="text" value={form.sfdc_user_id}
            onChange={(e) => setForm({ ...form, sfdc_user_id: e.target.value })}
            placeholder="005…"
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm font-mono"
          />
        </FormField>

        <FormField
          label="Granola API key (optional)"
          error={fieldErrors.granola_key}
          help={'Paste from granola.ai/settings. Server validates against Granola before storing.'}
        >
          <input
            ref={granolaInputRef}
            type="password" value={form.granola_key}
            onChange={(e) => setForm({ ...form, granola_key: e.target.value })}
            placeholder="grn_…"
            className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm font-mono"
          />
        </FormField>
      </div>

      {topError && <div className="text-xs text-red-600 dark:text-red-400">{topError}</div>}
      {warnings.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded p-2 space-y-1">
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={submitting} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded">
          {submitting ? 'Creating…' : 'Create user'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Edit drawer ──────────────────────────────────────────────────────────────

interface EditUserDrawerProps {
  rep: CoachingRep;
  rows: CoachingRep[];
  managers: ManagerSummaryT[];
  teams: CoachingTeamSummaryT[];
  onClose: () => void;
  onReload: () => Promise<void>;
  onDeactivate: () => void;
}

function EditUserDrawer({ rep, managers, teams, onClose, onReload, onDeactivate }: EditUserDrawerProps) {
  const [email, setEmail] = useState(rep.email);
  const [fullName, setFullName] = useState(rep.full_name);
  const [role, setRole] = useState<RoleT>(rep.role);
  const [managerId, setManagerId] = useState<string | null>(rep.manager_id);
  const [slackId, setSlackId] = useState(rep.slack_user_id ?? '');
  const [sfdcId, setSfdcId] = useState(rep.sfdc_user_id ?? '');
  const [revealPolicy, setRevealPolicy] = useState<RevealPolicy>(rep.reveal_policy);
  const [revealDelayMin, setRevealDelayMin] = useState<string>(rep.reveal_delay_minutes != null ? String(rep.reveal_delay_minutes) : '');
  const [revealReminderMin, setRevealReminderMin] = useState<string>(rep.reveal_reminder_minutes != null ? String(rep.reveal_reminder_minutes) : '');

  const [newGranolaKey, setNewGranolaKey] = useState('');
  const [granolaPill, setGranolaPill] = useState<GranolaPill>(granolaPillFromRep(rep));
  const granolaInputRef = useRef<HTMLInputElement | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [granolaBusy, setGranolaBusy] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Pods this rep is currently a member of (derived from teams payload).
  const podsForRep = useMemo(
    () => teams.filter((t) => t.members.some((m) => m.rep_id === rep.id)),
    [teams, rep.id],
  );
  const podsForRepIds = useMemo(() => new Set(podsForRep.map((t) => t.id)), [podsForRep]);
  const podsNotForRep = useMemo(() => teams.filter((t) => !podsForRepIds.has(t.id)), [teams, podsForRepIds]);

  useEffect(() => {
    if (!roleRequiresManager(role) && managerId !== null) setManagerId(null);
  }, [role, managerId]);

  // ─── Profile save ─────────────────────────────────────────────────────────
  async function handleSaveProfile() {
    setTopError(null);
    const errs: Record<string, string> = {};
    const emailErr = validateEmail(email);
    if (emailErr) errs.email = emailErr;
    if (!fullName.trim()) errs.fullName = 'Full name is required';
    if (roleRequiresManager(role) && !managerId) errs.managerId = `${ROLE_LABELS[role]}s require a canonical manager`;
    const slackErr = validateSlack(slackId.trim()); if (slackErr) errs.slackId = slackErr;
    const sfdcErr = validateSfdc(sfdcId.trim()); if (sfdcErr) errs.sfdcId = sfdcErr;
    if (revealPolicy === 'auto_delay') {
      if (!revealDelayMin) errs.revealDelayMin = 'Required for auto_delay';
      else if (!Number.isFinite(Number(revealDelayMin)) || Number(revealDelayMin) < 1 || Number(revealDelayMin) > 10080) errs.revealDelayMin = '1–10080 min';
    }
    if (revealReminderMin && (!Number.isFinite(Number(revealReminderMin)) || Number(revealReminderMin) < 1)) {
      errs.revealReminderMin = 'Must be ≥1';
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSavingProfile(true);
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        full_name: fullName.trim(),
        role,
        manager_id: roleRequiresManager(role) ? managerId : null,
        slack_user_id: slackId.trim() || null,
        sfdc_user_id: sfdcId.trim() || null,
        reveal_policy: revealPolicy,
      };
      if (revealPolicy === 'auto_delay') body.reveal_delay_minutes = Number(revealDelayMin);
      else body.reveal_delay_minutes = null;
      body.reveal_reminder_minutes = revealReminderMin ? Number(revealReminderMin) : null;

      const res = await fetch(`/api/call-intelligence/users/${rep.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 500) {
          setFieldErrors({ ...errs, email: 'Email may already be in use on another active rep.' });
        } else {
          setTopError(json.error ?? `Save failed (${res.status})`);
        }
        return;
      }
      await onReload();
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingProfile(false);
    }
  }

  // ─── Granola actions ──────────────────────────────────────────────────────
  async function handleSaveGranola() {
    const trimmed = newGranolaKey.trim();
    const err = validateGranola(trimmed);
    if (err) { setGranolaPill({ kind: 'rejected', message: err }); granolaInputRef.current?.focus(); return; }
    if (!trimmed) return;
    setGranolaBusy(true);
    try {
      const res = await fetch(`/api/call-intelligence/users/${rep.id}/granola-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        const code = json?.issues?.error;
        if (res.status === 400 && (code === 'granola_key_rejected' || code === 'granola_key_malformed')) {
          setGranolaPill({ kind: 'rejected', message: json.issues?.message ?? json.error ?? 'Granola rejected this key' });
          granolaInputRef.current?.focus();
          return;
        }
        setGranolaPill({ kind: 'rejected', message: json.error ?? `Save failed (${res.status})` });
        return;
      }
      // Success — 200. status is 'valid' or 'unknown'.
      if (json.status === 'valid') setGranolaPill({ kind: 'valid', at: new Date().toISOString() });
      else setGranolaPill({ kind: 'unverified', at: new Date().toISOString() });
      setNewGranolaKey('');
      await onReload();
    } catch (err) {
      setGranolaPill({ kind: 'rejected', message: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setGranolaBusy(false);
    }
  }

  async function handleVerifyGranola() {
    setGranolaBusy(true);
    try {
      const res = await fetch(`/api/call-intelligence/users/${rep.id}/granola-key/verify`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setGranolaPill({ kind: 'rejected', message: json.error ?? `Verify failed (${res.status})` }); return; }
      const at = json.granola_key_last_validated_at ?? new Date().toISOString();
      switch (json.status as 'valid' | 'invalid' | 'unknown' | 'no_key') {
        case 'valid': setGranolaPill({ kind: 'valid', at }); break;
        case 'invalid': setGranolaPill({ kind: 'invalid', at }); break;
        case 'unknown': setGranolaPill({ kind: 'unverified', at }); break;
        case 'no_key': setGranolaPill({ kind: 'no_key' }); break;
      }
      await onReload();
    } catch (err) {
      setGranolaPill({ kind: 'rejected', message: err instanceof Error ? err.message : 'Verify failed' });
    } finally {
      setGranolaBusy(false);
    }
  }

  async function handleClearGranola() {
    if (!confirm('Clear the stored Granola key for this user? Any in-flight poll will be invalidated.')) return;
    setGranolaBusy(true);
    try {
      const res = await fetch(`/api/call-intelligence/users/${rep.id}/granola-key`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) { setGranolaPill({ kind: 'rejected', message: json.error ?? `Clear failed (${res.status})` }); return; }
      setGranolaPill({ kind: 'no_key' });
      await onReload();
    } catch (err) {
      setGranolaPill({ kind: 'rejected', message: err instanceof Error ? err.message : 'Clear failed' });
    } finally {
      setGranolaBusy(false);
    }
  }

  // ─── Pod actions ──────────────────────────────────────────────────────────
  async function handleAddPod(teamId: string) {
    setGranolaBusy(false); // not granola, but reuse same disable pattern via onReload
    try {
      const res = await fetch(`/api/call-intelligence/coaching-teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rep_id: rep.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Add to pod failed: ${j.error ?? res.status}`);
        return;
      }
      await onReload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Add to pod failed');
    }
  }

  async function handleRemovePod(teamId: string) {
    try {
      const res = await fetch(`/api/call-intelligence/coaching-teams/${teamId}/members/${rep.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Remove from pod failed: ${j.error ?? res.status}`);
        return;
      }
      await onReload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Remove from pod failed');
    }
  }

  const managerRequired = roleRequiresManager(role);

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby="edit-user-title"
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl h-full overflow-y-auto bg-white dark:bg-gray-900 shadow-xl p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="edit-user-title" className="text-lg font-semibold text-gray-900 dark:text-white">Edit user</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rep.full_name} · {rep.email}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        {topError && <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">{topError}</div>}

        {/* ── Profile ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Profile</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Email" required error={fieldErrors.email}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm" />
            </FormField>
            <FormField label="Full name" required error={fieldErrors.fullName}>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm" />
            </FormField>
            <FormField label="Role" required>
              <select value={role} onChange={(e) => setRole(e.target.value as RoleT)}
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm">
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                {rep.role === 'csa' && <option value="csa">csa (legacy)</option>}
              </select>
            </FormField>
            <FormField
              label={`Canonical manager ${managerRequired ? '(required)' : '(not applicable)'}`}
              error={fieldErrors.managerId}
              help="DM fan-out hierarchy. Distinct from pod assignment below."
            >
              <select value={managerId ?? ''} disabled={!managerRequired}
                onChange={(e) => setManagerId(e.target.value || null)}
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm disabled:opacity-50">
                <option value="">— Select manager —</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </FormField>
            <FormField label="Slack member ID" error={fieldErrors.slackId}>
              <input type="text" value={slackId} onChange={(e) => setSlackId(e.target.value)} placeholder="U0123ABC456"
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm font-mono" />
            </FormField>
            <FormField label="Salesforce User ID" error={fieldErrors.sfdcId}>
              <input type="text" value={sfdcId} onChange={(e) => setSfdcId(e.target.value)} placeholder="005…"
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm font-mono" />
            </FormField>
          </div>
        </section>

        {/* ── Reveal policy ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Reveal policy</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormField label="Policy">
              <select value={revealPolicy} onChange={(e) => setRevealPolicy(e.target.value as RevealPolicy)}
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm">
                {POLICY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </FormField>
            <FormField label="Delay (min)" error={fieldErrors.revealDelayMin} help={revealPolicy === 'auto_delay' ? 'Required' : 'Only used with auto_delay'}>
              <input type="number" value={revealDelayMin} onChange={(e) => setRevealDelayMin(e.target.value)}
                disabled={revealPolicy !== 'auto_delay'} min={1} max={10080}
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm disabled:opacity-50" />
            </FormField>
            <FormField label="Reminder (min)" error={fieldErrors.revealReminderMin}>
              <input type="number" value={revealReminderMin} onChange={(e) => setRevealReminderMin(e.target.value)}
                min={1}
                className="block w-full rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm" />
            </FormField>
          </div>
          <div>
            <button type="button" onClick={handleSaveProfile} disabled={savingProfile}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded">
              {savingProfile ? 'Saving…' : 'Save profile + policy'}
            </button>
          </div>
        </section>

        {/* ── Pods ── */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Pods / coaching teams</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Analytics + coaching overlay. Independent of canonical manager.</p>
          {podsForRep.length === 0 ? (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic">Not currently a member of any pod.</div>
          ) : (
            <ul className="space-y-1">
              {podsForRep.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-sm">
                  <span className="text-gray-800 dark:text-gray-100">{t.name} <span className="text-xs text-gray-500 dark:text-gray-400">— led by {t.lead_full_name ?? 'no lead'}</span></span>
                  <button type="button" onClick={() => handleRemovePod(t.id)}
                    className="text-xs px-2 py-0.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {podsNotForRep.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value=""
                onChange={(e) => { if (e.target.value) { void handleAddPod(e.target.value); e.currentTarget.value = ''; } }}
                className="text-sm rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm"
              >
                <option value="">— Add to pod… —</option>
                {podsNotForRep.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — led by {t.lead_full_name ?? 'no lead'}</option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* ── Granola key ── */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Granola API key</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Stored encrypted in Neon Postgres (AES-256-GCM); not in GCP.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <GranolaPillBadge pill={granolaPill} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={granolaInputRef} type="password" value={newGranolaKey} onChange={(e) => setNewGranolaKey(e.target.value)}
              placeholder={rep.has_granola_key ? 'Paste a new key to rotate…' : 'grn_…'}
              className="flex-1 min-w-[16rem] rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 shadow-sm text-sm font-mono" />
            <button type="button" onClick={handleSaveGranola} disabled={granolaBusy || !newGranolaKey.trim()}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded">
              {rep.has_granola_key ? 'Rotate' : 'Save'}
            </button>
            <button type="button" onClick={handleVerifyGranola} disabled={granolaBusy || !rep.has_granola_key}
              className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-800 dark:text-gray-100 rounded">
              Test stored key
            </button>
            <button type="button" onClick={handleClearGranola} disabled={granolaBusy || !rep.has_granola_key}
              className="px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 rounded">
              Clear
            </button>
          </div>
        </section>

        {/* ── Danger zone + footer ── */}
        <section className="space-y-2 pt-4 border-t border-gray-200 dark:border-gray-700">
          {rep.is_active && (
            <button type="button" onClick={onDeactivate}
              className="text-xs px-3 py-1 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 rounded">
              Deactivate user
            </button>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Note: coaching DM CC subscriptions (Nick / GinaRose / Weiner on a pod's calls) are managed via the <code className="text-[11px]">scripts/manage-rep.ts</code> CLI on the backend, not this form.
          </p>
        </section>
      </div>
    </div>
  );
}

// ─── Field helper ─────────────────────────────────────────────────────────────

function FormField({
  label, required, error, help, children,
}: { label: string; required?: boolean; error?: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
        {label}{required ? ' *' : ''}
      </label>
      <div className="mt-1">{children}</div>
      {help && !error && <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{help}</div>}
      {error && <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
