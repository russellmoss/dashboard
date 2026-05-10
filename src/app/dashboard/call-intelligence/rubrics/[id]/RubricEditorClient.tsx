'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, ArrowLeft, Trash } from 'lucide-react';
import type {
  RubricT,
  RubricRoleT,
  RubricStatusT,
  RubricDimensionDefT,
} from '@/lib/sales-coaching-client/schemas';
import type { RubricListRow } from '@/types/call-intelligence';

// Keep this in sync with the upstream Zod regex on DimensionNameSchema.
const DIMENSION_NAME_RE = /^[a-z][a-z0-9_]{2,49}$/;

type Banner =
  | null
  | {
      kind: 'success' | 'info' | 'error';
      text: string;
      forkPayload?: ForkPayload;
    };

interface ForkPayload {
  name: string;
  role: RubricRoleT;
  dimensions: RubricDimensionDefT[];
}

interface EditingDimension extends RubricDimensionDefT {
  /** local-only id for dnd-kit (not part of the wire shape). */
  _localId: string;
}

type Props =
  | {
      mode: 'new';
      role: RubricRoleT;
      email: string;
      seedFromActive: RubricListRow | null;
    }
  | {
      mode: 'edit';
      rubric: RubricT;
      email: string;
      readOnlyReason: 'system' | null;
    };

interface DiffModalState {
  added: string[];
  dropped: string[];
  unchanged: string[];
  loading: boolean;
  error: string | null;
}

let _localCounter = 0;
function nextLocalId() {
  _localCounter += 1;
  return `dim-${_localCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function attachLocalIds(dims: readonly RubricDimensionDefT[]): EditingDimension[] {
  return dims.map((d) => ({ ...d, _localId: nextLocalId() }));
}

function blankDimension(order: number): EditingDimension {
  return {
    _localId: nextLocalId(),
    name: '',
    order,
    levels: { 1: '', 2: '', 3: '', 4: '' },
  };
}

function stripLocalIds(dims: EditingDimension[]): RubricDimensionDefT[] {
  return dims.map((d, idx) => ({
    name: d.name,
    order: idx, // canonical order is array index at save time
    levels: d.levels,
  }));
}

export function RubricEditorClient(props: Props) {
  const router = useRouter();

  // ----- Initial state -----
  // For new rubrics: leave the name field blank with a placeholder. The seed's
  // name is shown as a "forking from: {name}" hint above the input so the user
  // doesn't have to clear and retype it. For edit mode, the field starts with
  // the row's current name (and is editable on any status — see lock decisions).
  const initialName: string = props.mode === 'edit' ? props.rubric.name : '';

  const initialDims: EditingDimension[] =
    props.mode === 'new'
      ? props.seedFromActive
        ? attachLocalIds(props.seedFromActive.dimensions)
        : [blankDimension(0)]
      : attachLocalIds(props.rubric.dimensions);

  const role: RubricRoleT =
    props.mode === 'new' ? props.role : props.rubric.role;

  const [name, setName] = useState<string>(initialName);
  const [dims, setDims] = useState<EditingDimension[]>(initialDims);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [confirmModal, setConfirmModal] = useState<DiffModalState | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ----- Lock decisions -----
  const status: RubricStatusT =
    props.mode === 'new' ? 'draft' : props.rubric.status;
  const editVersion: number =
    props.mode === 'new' ? 1 : props.rubric.edit_version;
  const version: number | null =
    props.mode === 'new' ? null : props.rubric.version;
  const rubricId: string | null =
    props.mode === 'new' ? null : props.rubric.id;
  const systemLock = props.mode === 'edit' && props.readOnlyReason === 'system';
  const statusLock = props.mode === 'edit' && status !== 'draft';
  // Two independent locks now:
  //   nameLocked       — never; the display label is mutable on any status
  //                      (admins can rename even system rubrics).
  //   dimensionsLocked — true for system OR non-draft. Dimensions are the
  //                      controlled-vocabulary identifiers historical evaluations
  //                      reference; freezing them on non-drafts preserves
  //                      referential integrity for past scores.
  // `readOnly` is kept as the dimension-level disabled flag (drives every dim
  // input, dnd handle, add/delete buttons).
  const nameLocked = false;
  const dimensionsLocked = systemLock || statusLock;
  const readOnly = dimensionsLocked;
  const canActivate =
    props.mode === 'edit' &&
    ((status === 'draft' && !systemLock) || status === 'archived');
  const activateButtonLabel = status === 'archived' ? 'Re-activate this version' : 'Activate';
  // Track the row's original name so we can detect rename-only saves on
  // non-drafts. Drafts pass everything; non-drafts only allow name updates.
  const originalName = props.mode === 'edit' ? props.rubric.name : null;
  const nameChanged = originalName !== null && name !== originalName;
  const seedName = props.mode === 'new' ? props.seedFromActive?.name ?? null : null;

  // ----- Validation -----
  const nameErrors: Record<number, string> = useMemo(() => {
    const out: Record<number, string> = {};
    dims.forEach((d, idx) => {
      if (!DIMENSION_NAME_RE.test(d.name)) {
        out[idx] = 'lowercase, digits, underscores; no leading digit; 3–50 chars';
      }
    });
    return out;
  }, [dims]);
  const hasNameErrors = Object.keys(nameErrors).length > 0;
  const hasEmptyLevels = dims.some(
    (d) =>
      !d.levels[1].trim() ||
      !d.levels[2].trim() ||
      !d.levels[3].trim() ||
      !d.levels[4].trim(),
  );
  const isValid = !hasNameErrors && !hasEmptyLevels && dims.length >= 1 && name.trim().length > 0;
  const zeroDimensions = dims.length === 0;

  // ----- dnd-kit sensors (council Q5: keyboard a11y included) -----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (readOnly) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setDims((current) => {
      const oldIdx = current.findIndex((d) => d._localId === active.id);
      const newIdx = current.findIndex((d) => d._localId === over.id);
      if (oldIdx < 0 || newIdx < 0) return current;
      return arrayMove(current, oldIdx, newIdx).map((d, i) => ({ ...d, order: i }));
    });
  }

  function updateDim(localId: string, patch: Partial<RubricDimensionDefT>) {
    setDims((cur) => cur.map((d) => (d._localId === localId ? { ...d, ...patch } : d)));
  }

  function updateLevel(localId: string, level: 1 | 2 | 3 | 4, value: string) {
    setDims((cur) =>
      cur.map((d) =>
        d._localId === localId
          ? { ...d, levels: { ...d.levels, [level]: value } }
          : d,
      ),
    );
  }

  function removeDim(localId: string) {
    if (!window.confirm('Delete this dimension?')) return;
    setDims((cur) => cur.filter((d) => d._localId !== localId).map((d, i) => ({ ...d, order: i })));
  }

  function addDim() {
    setDims((cur) => [...cur, blankDimension(cur.length)]);
  }

  // ----- Save / create -----
  async function onSaveDraft() {
    // For drafts, gate on the full validity check (name + dims). For
    // rename-only on non-drafts, we only need a non-empty name.
    if (props.mode === 'edit' && status !== 'draft') {
      // Rename-only path. Block when name didn't change or is empty.
      if (nameLocked || !nameChanged || name.trim().length === 0) return;
    } else {
      if (readOnly || !isValid) return;
    }
    setSubmitting(true);
    setBanner(null);
    const payload = stripLocalIds(dims);
    try {
      let res: Response;
      if (props.mode === 'new') {
        res = await fetch('/api/call-intelligence/rubrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            role,
            dimensions: payload,
            status: 'draft',
          }),
        });
      } else if (status === 'draft') {
        // Draft: send name + dimensions together.
        res = await fetch(`/api/call-intelligence/rubrics/${props.rubric.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_edit_version: editVersion,
            name: name.trim(),
            dimensions: payload,
          }),
        });
      } else {
        // Non-draft rename path: send name only. Upstream allows name-only on
        // any status; sending dimensions would trigger 'not_in_draft' 409.
        res = await fetch(`/api/call-intelligence/rubrics/${props.rubric.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_edit_version: editVersion,
            name: name.trim(),
          }),
        });
      }

      if (res.status === 409) {
        // Council Q2: do NOT redirect on save 409. Preserve the user's edits and
        // offer a Fork CTA so the local state lands as a brand-new draft.
        setBanner({
          kind: 'error',
          text:
            'This rubric was activated or modified by another user. Your edits are preserved locally.',
          forkPayload: {
            name: name.trim() || `${role} draft`,
            role,
            dimensions: payload,
          },
        });
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const body = (await res.json()) as { rubric: RubricT };
      if (props.mode === 'new') {
        router.push(`/dashboard/call-intelligence/rubrics/${body.rubric.id}`);
        router.refresh();
        return;
      }
      // edit mode: refresh server data
      setBanner({ kind: 'success', text: 'Draft saved.' });
      router.refresh();
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Save failed.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function onForkFromBanner(payload: ForkPayload) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/call-intelligence/rubrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          role: payload.role,
          dimensions: payload.dimensions,
          status: 'draft',
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { rubric: RubricT };
      router.push(`/dashboard/call-intelligence/rubrics/${body.rubric.id}`);
      router.refresh();
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? `Fork failed: ${err.message}` : 'Fork failed.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // ----- Activate confirm modal -----
  async function openActivateConfirm() {
    // Gate on canActivate (true for drafts AND archived) — readOnly is true for
    // archived rubrics because their content is immutable, but re-activation
    // doesn't edit content. Earlier check used `readOnly` and silently swallowed
    // the click on archived.
    if (!canActivate || !isValid || rubricId === null) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setConfirmModal({ added: [], dropped: [], unchanged: [], loading: true, error: null });

    try {
      const url = `/api/call-intelligence/rubrics?role=${encodeURIComponent(role)}&status=active`;
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { rows: RubricListRow[] };
      const activeRow = body.rows[0] ?? null;

      const draftNames = new Set(dims.map((d) => d.name));
      const activeNames = new Set(
        (activeRow?.dimensions ?? []).map((d) => d.name),
      );

      const added: string[] = [];
      const dropped: string[] = [];
      const unchanged: string[] = [];
      draftNames.forEach((n) => {
        if (activeNames.has(n)) unchanged.push(n);
        else added.push(n);
      });
      activeNames.forEach((n) => {
        if (!draftNames.has(n)) dropped.push(n);
      });

      setConfirmModal({ added, dropped, unchanged, loading: false, error: null });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setConfirmModal({
        added: [],
        dropped: [],
        unchanged: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load active rubric',
      });
    }
  }

  function closeConfirmModal() {
    abortRef.current?.abort();
    abortRef.current = null;
    setConfirmModal(null);
  }

  async function onActivateConfirmed() {
    if (rubricId === null) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/call-intelligence/rubrics/${rubricId}/activate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_edit_version: editVersion }),
      });
      if (res.status === 409) {
        setBanner({
          kind: 'error',
          text: 'A rubric was updated concurrently. Refreshing — please retry.',
        });
        closeConfirmModal();
        router.refresh();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { rubric: RubricT };
      closeConfirmModal();
      router.push(
        `/dashboard/call-intelligence?tab=rubrics&activated=${encodeURIComponent(
          `Rubric v${body.rubric.version} activated for ${body.rubric.role}.`,
        )}`,
      );
      router.refresh();
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Activate failed.',
      });
      closeConfirmModal();
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeleteConfirmed() {
    if (rubricId === null) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/call-intelligence/rubrics/${rubricId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
          message?: string;
        };
        if (res.status === 409 && body.reason === 'not_in_draft') {
          throw new Error('This rubric is currently active and cannot be deleted. Re-activate a different version first.');
        }
        if (res.status === 409 && body.reason === 'has_evaluation_references') {
          throw new Error('This archived rubric cannot be deleted — historical evaluations were scored against it. Past evals would lose their rubric reference.');
        }
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      setShowDeleteConfirm(false);
      router.push('/dashboard/call-intelligence?tab=rubrics');
      router.refresh();
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Delete failed.',
      });
      setShowDeleteConfirm(false);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  // ----- Render -----
  const headerStatusLabel = props.mode === 'new' ? 'draft' : status;

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/dashboard/call-intelligence?tab=rubrics"
          className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-300 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Rubrics
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200">
              {role}
            </span>
            {version !== null && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200">
                v{version}
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                headerStatusLabel === 'active'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                  : headerStatusLabel === 'archived'
                  ? 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
              }`}
            >
              {headerStatusLabel}
            </span>
          </div>
          {seedName && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Forking from: <span className="font-medium">{seedName}</span>
            </p>
          )}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={nameLocked}
            placeholder={
              props.mode === 'new'
                ? 'Give this version a name (e.g., SGA Discovery v3 — tighter timeline)'
                : 'Rubric name'
            }
            className="w-full text-2xl font-bold bg-transparent text-gray-900 dark:text-white border-b border-gray-300 dark:border-gray-700 focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>
      </div>

      {/* Status / system banners */}
      {systemLock && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-4 py-3 rounded text-sm">
          This rubric is system-managed. Its dimensions are frozen — create a
          new version (it will fork from this one) to change dimensions. You
          can still rename it{status === 'archived' ? ' and re-activate this version to roll back to the system baseline' : ''}.
        </div>
      )}
      {statusLock && !systemLock && (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 px-4 py-3 rounded text-sm">
          {status === 'active'
            ? 'This rubric is active. Its dimensions are frozen (referenced by historical evaluations), but you can rename it. Create a new version to change dimensions.'
            : 'This rubric is archived. Its dimensions are frozen, but you can rename it or re-activate this version below to roll back — re-activating will archive the current active rubric for this role.'}
        </div>
      )}

      {/* Error / fork banner */}
      {banner && (
        <div
          className={`px-4 py-3 rounded text-sm flex items-start justify-between gap-4 ${
            banner.kind === 'error'
              ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
              : banner.kind === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
              : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
          }`}
        >
          <span>{banner.text}</span>
          {banner.forkPayload && (
            <button
              type="button"
              onClick={() => onForkFromBanner(banner.forkPayload!)}
              disabled={submitting}
              className="px-3 py-1 rounded bg-red-700 dark:bg-red-600 text-white text-xs font-medium hover:bg-red-800 dark:hover:bg-red-700 disabled:opacity-50"
            >
              Fork to v{(version ?? 0) + 1}
            </button>
          )}
        </div>
      )}

      {/* Zero-dimension warning (council Q10) */}
      {zeroDimensions && (
        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 px-4 py-3 rounded text-sm">
          This rubric has no dimensions. Add at least one before activating.
        </div>
      )}

      {/* Dimension list */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <SortableContext
          items={dims.map((d) => d._localId)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-3">
            {dims.map((d, idx) => (
              <SortableDimensionCard
                key={d._localId}
                dim={d}
                index={idx}
                readOnly={readOnly}
                nameError={nameErrors[idx] ?? null}
                onChangeName={(v) => updateDim(d._localId, { name: v })}
                onChangeLevel={(level, v) => updateLevel(d._localId, level, v)}
                onDelete={() => removeDim(d._localId)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {!readOnly && (
        <button
          type="button"
          onClick={addDim}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed border-gray-400 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <Plus className="w-4 h-4" /> Add dimension
        </button>
      )}

      {/* Sticky save bar — visible whenever any control is actionable:
          editable drafts (Save + Activate), archived rubrics (Re-activate),
          or any rename-pending row (Save name). Hidden only when the row is
          truly locked AND has no actionable button. */}
      {(props.mode === 'new' || !readOnly || canActivate || nameChanged) && (
        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
          {props.mode === 'edit' && (status === 'draft' || status === 'archived') ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              title={
                status === 'archived'
                  ? 'Delete this version permanently. Blocked if any evaluations reference it.'
                  : undefined
              }
            >
              <Trash className="w-4 h-4" />{' '}
              {status === 'draft' ? 'Delete draft' : 'Delete this version'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {(props.mode === 'new' || status === 'draft') && (
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={submitting || !isValid}
                className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Saving…' : 'Save draft'}
              </button>
            )}
            {props.mode === 'edit' && status !== 'draft' && nameChanged && (
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={submitting || name.trim().length === 0}
                className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Saving…' : 'Save name'}
              </button>
            )}
            {canActivate && (
              <button
                type="button"
                onClick={openActivateConfirm}
                disabled={submitting || !isValid || zeroDimensions}
                className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  status === 'archived'
                    ? 'Re-activate this version. The current active rubric for this role will be archived.'
                    : undefined
                }
              >
                {activateButtonLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Activate confirm modal */}
      {confirmModal !== null && (
        <ActivateConfirmModal
          state={confirmModal}
          version={version ?? 0}
          isReactivation={status === 'archived'}
          submitting={submitting}
          onConfirm={onActivateConfirmed}
          onCancel={closeConfirmModal}
        />
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && props.mode === 'edit' && (
        <DeleteDraftConfirmModal
          name={name}
          version={version ?? 0}
          role={role}
          status={status}
          submitting={submitting}
          onConfirm={onDeleteConfirmed}
          onCancel={() => {
            if (submitting) return;
            setShowDeleteConfirm(false);
          }}
        />
      )}
    </div>
  );
}

function DeleteDraftConfirmModal({
  name,
  version,
  role,
  status,
  submitting,
  onConfirm,
  onCancel,
}: {
  name: string;
  version: number;
  role: RubricRoleT;
  status: RubricStatusT;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isArchived = status === 'archived';
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-delete-title"
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full shadow-xl">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="editor-delete-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            {isArchived ? 'Delete this version?' : 'Delete this draft?'}
          </h2>
        </div>
        <div className="px-6 py-4 text-sm text-gray-700 dark:text-gray-200 space-y-3">
          <p>
            <span className="font-mono">{role}</span> v{version} —{' '}
            <span className="font-medium">{name || '(unnamed)'}</span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isArchived
              ? 'This permanently removes the archived version. The server will reject this if any historical evaluations were scored against it. This cannot be undone.'
              : 'This permanently removes the draft and returns you to the Rubrics tab. Active and archived versions for this role are unaffected. This cannot be undone.'}
          </p>
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

interface SortableDimensionCardProps {
  dim: EditingDimension;
  index: number;
  readOnly: boolean;
  nameError: string | null;
  onChangeName: (value: string) => void;
  onChangeLevel: (level: 1 | 2 | 3 | 4, value: string) => void;
  onDelete: () => void;
}

function SortableDimensionCard(props: SortableDimensionCardProps) {
  const { dim, index, readOnly, nameError, onChangeName, onChangeLevel, onDelete } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dim._localId,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const labels: Record<1 | 2 | 3 | 4, string> = {
    1: '1 — Did not demonstrate',
    2: '2 — Partially demonstrated',
    3: '3 — Competent',
    4: '4 — Exemplary',
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4 space-y-3"
    >
      <div className="flex items-center gap-3">
        {!readOnly && (
          <button
            type="button"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
            className="cursor-grab text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <GripVertical className="w-5 h-5" />
          </button>
        )}
        <span className="text-xs text-gray-400 dark:text-gray-500 w-8">#{index + 1}</span>
        <div className="flex-1">
          <input
            type="text"
            value={dim.name}
            onChange={(e) => onChangeName(e.target.value)}
            disabled={readOnly}
            placeholder="dimension_name"
            className={`w-full text-sm font-mono bg-transparent border-b ${
              nameError
                ? 'border-red-500 dark:border-red-400'
                : 'border-gray-300 dark:border-gray-700'
            } text-gray-900 dark:text-white focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70`}
          />
          {nameError && (
            <p className="text-xs text-red-600 dark:text-red-300 mt-1">{nameError}</p>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete dimension"
            className="text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {([1, 2, 3, 4] as const).map((lv) => (
          <div key={lv}>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {labels[lv]}
            </label>
            <textarea
              rows={3}
              value={dim.levels[lv]}
              onChange={(e) => onChangeLevel(lv, e.target.value)}
              disabled={readOnly}
              placeholder="Describe what a rep doing at this level looks like on this dimension."
              className="w-full text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded p-2 focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        ))}
      </div>
    </li>
  );
}

function ActivateConfirmModal({
  state,
  version,
  isReactivation,
  submitting,
  onConfirm,
  onCancel,
}: {
  state: DiffModalState;
  version: number;
  isReactivation: boolean;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { added, dropped, unchanged, loading, error } = state;

  const dropWarning = dropped.length > 0 && (
    <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 px-3 py-2 rounded text-sm space-y-1">
      <p>
        <strong>⚠ {dropped.length} dimension{dropped.length === 1 ? '' : 's'} will no longer score on new evaluations:</strong>{' '}
        {dropped.join(', ')}.
      </p>
      <p className="text-xs">
        Past evaluations keep their dimension names (immutable), but historical reporting
        continuity for these will end here. If this is a rename rather than a drop,
        controlled-vocabulary governance forbids dimension renames — only adds + deprecates.
      </p>
    </div>
  );

  const confirmText =
    dropped.length > 0
      ? `Confirm — drop ${dropped.length} dimension${dropped.length === 1 ? '' : 's'}`
      : isReactivation
        ? `Confirm — re-activate v${version}`
        : `Confirm — activate v${version}`;

  const title = isReactivation ? 'Re-activate this version?' : 'Activate this rubric?';
  const subtitle = isReactivation
    ? 'Rolling back to this version will archive the rubric currently active for this role.'
    : null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activate-confirm-title"
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2
            id="activate-confirm-title"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
          )}
        </div>
        <div className="px-6 py-4 space-y-4">
          {loading && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading current active rubric…</p>
          )}
          {error && (
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          )}
          {!loading && !error && (
            <>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <DiffList title="Added" items={added} colorClass="text-green-700 dark:text-green-300" />
                <DiffList title="Dropped" items={dropped} colorClass="text-red-700 dark:text-red-300" />
                <DiffList title="Unchanged" items={unchanged} colorClass="text-gray-500 dark:text-gray-400" />
              </div>
              {dropWarning}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Note: changes to a dimension&apos;s level descriptions are not surfaced
                here — only name-level adds/drops.
              </p>
            </>
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
            disabled={submitting || loading || error !== null}
            className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Activating…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffList({
  title,
  items,
  colorClass,
}: {
  title: string;
  items: string[];
  colorClass: string;
}) {
  return (
    <div>
      <h3 className="font-medium text-gray-900 dark:text-white text-xs uppercase tracking-wide mb-1">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">—</p>
      ) : (
        <ul className={`text-xs space-y-0.5 ${colorClass}`}>
          {items.map((n) => (
            <li key={n} className="font-mono break-all">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
