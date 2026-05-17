'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@tremor/react';
import { ArrowLeft, ChevronDown, ChevronRight, Flag } from 'lucide-react';
import { FlagClaimModal } from '@/components/call-intelligence/FlagClaimModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { Citation, EvaluationDetail } from '@/types/call-intelligence';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';
import { CitationPill } from '@/components/call-intelligence/CitationPill';
import { KBSidePanel } from '@/components/call-intelligence/KBSidePanel';
import { RefinementModal } from '@/components/call-intelligence/RefinementModal';
import { InlineEditDimensionScore } from '@/components/call-intelligence/InlineEditDimensionScore';
import { InlineEditTextField } from '@/components/call-intelligence/InlineEditTextField';
import { InlineEditListField, type ListItem } from '@/components/call-intelligence/InlineEditListField';
import { AuditToggle } from '@/components/call-intelligence/AuditToggle';
import { RubricVersionBadge } from '@/components/call-intelligence/RubricVersionBadge';
import {
  TranscriptModal,
  type TranscriptModalHandle,
} from '@/components/call-intelligence/TranscriptModal';
import {
  isFieldSupportedByAiOriginalVersion,
  readCitedItems,
} from '@/components/call-intelligence/citation-helpers';

interface Props {
  id: string;
  role: string;
  returnTab: string;
  currentRepId: string | null;
}

interface CustomDelayState {
  show: boolean;
  minutes: number;
}

interface ConflictState {
  expectedVersion: number;
  message: string;
}

interface ActiveKb {
  chunk_id: string;
  doc_id: string;
  drive_url: string;
  doc_title: string;
  owner: string;
  chunk_text: string;
}

type Banner =
  | null
  | {
      kind: 'success' | 'info' | 'error';
      text: string;
      cta?: { label: string; onClick: () => void };
      successLink?: { label: string; href: string };
    };

/**
 * Shared mutation lock — ensures all InlineEdit* + reveal-action buttons share a single
 * pending/conflict state. Replaces the per-component `actionPending` boolean with a
 * discriminated union that also represents conflict-pending-reload and authority-lost
 * terminal states (council fix B1.13 — closes the C4 freeze gap and C5 stale-version
 * race in one shared state).
 */
type MutationLock =
  | { kind: 'idle' }
  | { kind: 'pending'; tag?: string }
  | { kind: 'conflict-pending-reload' }
  | { kind: 'authority-lost' };

// ─── ai_original shape (defensive readers — preserved from Step 5a-UI) ─────

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function readDeferrals(x: unknown): Array<{ topic: string; deferral_text: string }> {
  if (!Array.isArray(x)) return [];
  const out: Array<{ topic: string; deferral_text: string }> = [];
  for (const it of x) {
    if (!isObj(it)) continue;
    const topic = typeof it.topic === 'string' ? it.topic.trim() : '';
    const dtxt = typeof it.deferral_text === 'string' ? it.deferral_text.trim() : '';
    if (!topic || !dtxt) continue;
    out.push({ topic, deferral_text: dtxt });
  }
  return out;
}

interface DimensionScoreEntry {
  name: string;
  score: number;
  citations?: Citation[];
  // 2026-05-11 — schema v6 per-dim AI rationale. v2-v5 historical rows lack
  // this until backfilled offline (scripts/backfill-dimension-bodies.cjs).
  body?: string;
}

function readDimensionScores(x: unknown): DimensionScoreEntry[] {
  if (!isObj(x)) return [];
  const out: DimensionScoreEntry[] = [];
  for (const [name, val] of Object.entries(x)) {
    const score =
      isObj(val) && typeof val.score === 'number'
        ? val.score
        : typeof val === 'number'
          ? val
          : null;
    if (score === null) continue;
    const citations =
      isObj(val) && Array.isArray(val.citations) ? (val.citations as Citation[]) : undefined;
    const body =
      isObj(val) && typeof val.body === 'string' && val.body.length > 0 ? val.body : undefined;
    out.push({ name, score, citations, body });
  }
  return out;
}

function humanizeKey(k: string): string {
  return k.replace(/[_\-]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function DimensionBar({ name, score }: { name: string; score: number }) {
  const pct = Math.max(0, Math.min(100, ((score - 1) / 3) * 100));
  const fillClass = score >= 3 ? 'bg-[#175242]' : score >= 2 ? 'bg-[#8e7e57]' : 'bg-[#c7bca1]';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-700 dark:text-gray-300">{humanizeKey(name)}</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium tabular-nums">
          {score.toFixed(1)} / 4
        </span>
      </div>
      <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-3">
        <div className={`${fillClass} h-3 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function OverallScoreBadge({ score }: { score: number }) {
  const fillClass = score >= 3 ? 'bg-[#175242]' : score >= 2 ? 'bg-[#8e7e57]' : 'bg-[#c7bca1]';
  return (
    <div className="flex items-center gap-3">
      <div
        className={`${fillClass} text-white rounded-lg px-4 py-2 font-bold text-2xl tabular-nums`}
      >
        {score.toFixed(1)}
      </div>
      <span className="text-sm text-gray-500 dark:text-gray-400">/ 4 overall</span>
    </div>
  );
}

/** Render text + inline citation pills for a `{text, citations}` shape. */
function CitedTextLine({
  text,
  citations,
  chunkLookup,
  onScrollToUtterance,
  onOpenKB,
  disabled,
}: {
  text: string;
  citations: Citation[] | undefined;
  chunkLookup: Record<string, { owner: string; chunk_text: string }>;
  onScrollToUtterance: (idx: number) => void;
  onOpenKB: (kb: ActiveKb) => void;
  disabled: boolean;
}) {
  return (
    <span>
      <span>{text}</span>
      {citations && citations.length > 0 && (
        <span className="ml-1 inline-flex flex-wrap items-center gap-0.5 align-middle">
          {citations.map((c, i) => (
            <CitationPill
              key={i}
              citation={c}
              chunkLookup={chunkLookup}
              onScrollToUtterance={onScrollToUtterance}
              onOpenKB={onOpenKB}
              disabled={disabled}
            />
          ))}
        </span>
      )}
    </span>
  );
}

export default function EvalDetailClient({ id, role, returnTab, currentRepId }: Props) {
  const router = useRouter();
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [customDelay, setCustomDelay] = useState<CustomDelayState>({ show: false, minutes: 60 });
  const [auditEnabled, setAuditEnabled] = useState(false);
  const [activeKb, setActiveKb] = useState<ActiveKb | null>(null);
  const [refinementOpen, setRefinementOpen] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [mutationLock, setMutationLock] = useState<MutationLock>({ kind: 'idle' });
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [pendingUtteranceIdx, setPendingUtteranceIdx] = useState<number | null>(null);
  const [evalPanelExpanded, setEvalPanelExpanded] = useState(false);
  const [flagTarget, setFlagTarget] = useState<{
    claimType: string;
    claimIndex: number | null;
    claimText: string;
    displayedText?: string | null;
    dimensionKey?: string | null;
  } | null>(null);
  const transcriptRef = useRef<TranscriptModalHandle>(null);

  const isLocked = mutationLock.kind !== 'idle';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/call-intelligence/evaluations/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        setDetail(null);
      } else {
        setDetail(json as EvaluationDetail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load evaluation');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleScrollToUtterance = useCallback((idx: number) => {
    // If the modal is already open, scroll directly. Otherwise stash the target
    // index and open the modal — the modal's mount-effect handles the scroll.
    setPendingUtteranceIdx(idx);
    setTranscriptOpen((open) => {
      if (open) transcriptRef.current?.scrollToUtterance(idx);
      return true;
    });
  }, []);
  const handleOpenKB = useCallback((kb: ActiveKb) => setActiveKb(kb), []);

  const isAdmin = role === 'admin' || role === 'revops_admin';
  const isManager = isAdmin || role === 'manager';
  const showActions = !!detail && isManager && detail.status === 'pending_review';

  /**
   * Central edit handler. Wraps PATCH /api/call-intelligence/evaluations/:id/edit
   * with shared OCC + 404 disambiguation. Every InlineEdit* component routes
   * here via its onSave callback; the lifecycle of `mutationLock` is owned here.
   */
  async function handleEdit(
    patch: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!detail) return { ok: false, error: 'no detail' };
    if (isLocked) return { ok: false, error: 'A save is already in progress.' };
    setMutationLock({ kind: 'pending', tag: 'edit' });
    setBanner(null);
    try {
      const res = await fetch(`/api/call-intelligence/evaluations/${detail.evaluation_id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_edit_version: detail.edit_version, ...patch }),
      });
      if (res.ok) {
        await load();
        setMutationLock({ kind: 'idle' });
        return { ok: true };
      }
      const json: Record<string, unknown> = await res.json().catch(() => ({}));
      const errCode = json.error;

      if (res.status === 404 && errCode === 'evaluation_not_found') {
        setBanner({
          kind: 'error',
          text: 'This evaluation is no longer available.',
          cta: {
            label: 'Return to queue',
            onClick: () => router.push(`/dashboard/call-intelligence?tab=${returnTab}`),
          },
        });
        setMutationLock({ kind: 'authority-lost' });
        return { ok: false, error: 'evaluation_not_found' };
      }

      if (res.status === 409 && errCode === 'evaluation_conflict') {
        const msg = typeof json.message === 'string' ? json.message : '';
        if (msg.includes('Authority lost')) {
          setBanner({
            kind: 'error',
            text: 'This evaluation was reassigned to another manager.',
            cta: {
              label: 'Return to queue',
              onClick: () => router.push(`/dashboard/call-intelligence?tab=${returnTab}`),
            },
          });
          setMutationLock({ kind: 'authority-lost' });
          return { ok: false, error: 'authority_lost' };
        }
        if (msg && !/edit[_ ]version|stale|conflict/i.test(msg)) {
          // eslint-disable-next-line no-console
          console.warn(
            '[EvalDetailClient] Unexpected 409 message text — may indicate sales-coaching copy drift:',
            msg,
          );
        }
        setConflict({
          expectedVersion:
            typeof json.edit_version_expected === 'number'
              ? (json.edit_version_expected as number)
              : detail.edit_version,
          message: 'Another manager just edited this evaluation — click Reload to pull their changes.',
        });
        setMutationLock({ kind: 'conflict-pending-reload' });
        return { ok: false, error: 'stale_version' };
      }

      if (res.status === 400 && errCode === 'invalid_request') {
        setMutationLock({ kind: 'idle' });
        const msg = typeof json.message === 'string' ? json.message : 'Invalid request';
        return { ok: false, error: msg };
      }

      setBanner({ kind: 'error', text: 'Something went wrong. Please try again.' });
      setMutationLock({ kind: 'idle' });
      return { ok: false, error: typeof errCode === 'string' ? errCode : 'unknown' };
    } catch {
      setBanner({ kind: 'error', text: 'Something went wrong. Please try again.' });
      setMutationLock({ kind: 'idle' });
      return { ok: false, error: 'network' };
    }
  }

  async function handleReload() {
    setConflict(null);
    setBanner(null);
    setMutationLock({ kind: 'idle' });
    await load();
  }

  async function performAction(
    kind: 'hold' | 'custom_delay' | 'use_default' | 'reveal_now',
    overrideDelayMinutes?: number,
  ) {
    if (!detail || isLocked) return;
    setMutationLock({ kind: 'pending', tag: kind });
    setBanner(null);
    try {
      let res: Response;
      if (kind === 'reveal_now') {
        res = await fetch(`/api/call-intelligence/evaluations/${detail.evaluation_id}/reveal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_edit_version: detail.edit_version }),
        });
      } else {
        const body: Record<string, unknown> = {
          override_action: kind,
          expected_edit_version: detail.edit_version,
        };
        if (kind === 'custom_delay') body.override_delay_minutes = overrideDelayMinutes;
        res = await fetch(
          `/api/call-intelligence/evaluations/${detail.evaluation_id}/reveal-scheduling`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
      }
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflict({
          expectedVersion: json.edit_version_expected ?? detail.edit_version,
          message: json.error ?? 'Conflict — another manager edited this evaluation.',
        });
        setMutationLock({ kind: 'conflict-pending-reload' });
        return;
      }
      if (!res.ok) {
        setBanner({ kind: 'error', text: json.error ?? `HTTP ${res.status}` });
        setMutationLock({ kind: 'idle' });
        return;
      }
      await load();
      setMutationLock({ kind: 'idle' });
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Action failed' });
      setMutationLock({ kind: 'idle' });
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-6">
        <LoadingSpinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-6 space-y-4">
        <Link
          href={`/dashboard/call-intelligence?tab=${returnTab}`}
          className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> Back to{' '}
          {returnTab === 'admin-refinements' ? 'refinements' : 'queue'}
        </Link>
        <div className="px-4 py-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">
          {error}
        </div>
      </div>
    );
  }
  if (!detail) return null;

  const aiObj: Record<string, unknown> = isObj(detail.ai_original) ? detail.ai_original : {};
  const aiDimensionScores = readDimensionScores(aiObj.dimensionScores);
  const aiNarrative =
    isObj(aiObj.narrative) && typeof aiObj.narrative.text === 'string'
      ? aiObj.narrative.text
      : typeof aiObj.narrative === 'string'
        ? aiObj.narrative
        : '';
  const aiStrengths = readCitedItems(aiObj.strengths);
  const aiWeaknesses = readCitedItems(aiObj.weaknesses);
  const aiKnowledgeGaps = readCitedItems(aiObj.knowledgeGaps);
  const aiComplianceFlags = readCitedItems(aiObj.complianceFlags);
  const aiAdditional = readCitedItems(aiObj.additionalObservations);
  const aiCoachingNudge =
    isObj(aiObj.coachingNudge) && typeof aiObj.coachingNudge.text === 'string'
      ? aiObj.coachingNudge.text
      : '';
  const repDeferrals = readDeferrals(aiObj.repDeferrals);

  // Canonical (manager-edited) view — falls back to AI-original arrays when canonical
  // is missing, matching the existing Step 5a-UI behavior. The canonical mirror columns
  // are NULL for pre-024 evals.
  // Note: dimension_scores + narrative are JSONB OBJECTS on the row (not primitives) —
  // we extract `.score` and `.text` for display.
  const canonicalDimensionScores: DimensionScoreEntry[] = detail.dimension_scores
    ? Object.entries(detail.dimension_scores).map(([name, v]) => ({
        name,
        score: v.score,
        citations: v.citations,
        body: v.body,
      }))
    : aiDimensionScores;
  const canonicalNarrative = detail.narrative?.text ?? aiNarrative;
  const canonicalStrengths = detail.strengths.length > 0 ? detail.strengths : aiStrengths;
  const canonicalWeaknesses = detail.weaknesses.length > 0 ? detail.weaknesses : aiWeaknesses;
  const canonicalKnowledgeGaps =
    detail.knowledge_gaps.length > 0 ? detail.knowledge_gaps : aiKnowledgeGaps;
  const canonicalComplianceFlags =
    detail.compliance_flags.length > 0 ? detail.compliance_flags : aiComplianceFlags;
  const canonicalAdditional =
    detail.additional_observations.length > 0 ? detail.additional_observations : aiAdditional;
  const effectiveNudge = detail.coaching_nudge_effective?.text ?? aiCoachingNudge;

  const overall =
    typeof detail.overall_score === 'number' && Number.isFinite(detail.overall_score)
      ? detail.overall_score
      : null;

  const supportsAdditional = isFieldSupportedByAiOriginalVersion(
    detail.ai_original_schema_version,
    'additionalObservations',
  );
  const supportsCoachingNudge = isFieldSupportedByAiOriginalVersion(
    detail.ai_original_schema_version,
    'coachingNudge',
  );

  const flags = detail.flags ?? [];
  function flagCountFor(claimType: string) {
    return flags.filter((f) => f.claim_type === claimType).length;
  }
  function FlagBadge({ count }: { count: number }) {
    if (count === 0) return null;
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 rounded">
        {count} {count === 1 ? 'flag' : 'flags'}
      </span>
    );
  }

  function FlagButton({ claimType, claimIndex, claimText, displayedText, dimensionKey }: {
    claimType: string;
    claimIndex: number | null;
    claimText: string;
    displayedText?: string | null;
    dimensionKey?: string | null;
  }) {
    if (!isManager) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setFlagTarget({
            claimType,
            claimIndex,
            claimText,
            displayedText: displayedText !== claimText ? displayedText : null,
            dimensionKey,
          });
        }}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors opacity-0 group-hover:opacity-100"
        title="Flag this content"
      >
        <Flag className="w-3 h-3" />
        Flag
      </button>
    );
  }

  const renderCitedDisplay = (item: ListItem) => (
    <CitedTextLine
      text={item.text}
      citations={item.citations}
      chunkLookup={detail.chunk_lookup}
      onScrollToUtterance={handleScrollToUtterance}
      onOpenKB={handleOpenKB}
      disabled={isLocked}
    />
  );

  function makeFlaggedRenderer(
    claimType: string,
    aiItems: ListItem[],
  ) {
    return (item: ListItem, idx: number) => (
      <div className="group/item flex items-start gap-1">
        <div className="flex-1">
          <CitedTextLine
            text={item.text}
            citations={item.citations}
            chunkLookup={detail.chunk_lookup}
            onScrollToUtterance={handleScrollToUtterance}
            onOpenKB={handleOpenKB}
            disabled={isLocked}
          />
        </div>
        <FlagButton
          claimType={claimType}
          claimIndex={idx}
          claimText={aiItems[idx]?.text ?? item.text}
          displayedText={item.text}
        />
      </div>
    );
  }

  /** Normalize a list-field draft for the bridge: every item gets a guaranteed
   *  citations array (even if empty). Preserves expected_source for knowledge_gaps. */
  const normalizeListForSave = (
    items: ListItem[],
    field: 'strengths' | 'weaknesses' | 'compliance_flags' | 'additional_observations' | 'knowledge_gaps',
  ) => {
    return items.map((it) => {
      const base: { text: string; citations: Citation[]; expected_source?: string } = {
        text: it.text,
        citations: (it.citations ?? []) as Citation[],
      };
      if (field === 'knowledge_gaps' && it.expected_source) {
        base.expected_source = it.expected_source;
      }
      return base;
    });
  };

  return (
    <div className="space-y-4 px-4 py-6">
      <Link
        href={`/dashboard/call-intelligence?tab=${returnTab}`}
        className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" /> Back to{' '}
        {returnTab === 'admin-refinements' ? 'refinements' : 'queue'}
      </Link>

      {banner && (
        <div
          className={`px-4 py-3 text-sm rounded flex items-center justify-between gap-4 ${
            banner.kind === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
              : banner.kind === 'info'
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
          }`}
        >
          <span>{banner.text}</span>
          <span className="flex items-center gap-3">
            {banner.successLink && (
              <Link href={banner.successLink.href} className="underline whitespace-nowrap">
                {banner.successLink.label} →
              </Link>
            )}
            {banner.cta && (
              <button
                onClick={banner.cta.onClick}
                className="underline whitespace-nowrap font-medium"
              >
                {banner.cta.label} →
              </button>
            )}
            <button
              onClick={() => setBanner(null)}
              aria-label="Dismiss"
              className="text-current opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </span>
        </div>
      )}

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Field label="Rep" value={detail.rep_full_name ?? '—'} />
          <Field label="Reviewer" value={detail.assigned_manager_full_name ?? '—'} />
          <Field label="Call date" value={formatDate(detail.call_started_at)} />
          <Field label="Created" value={formatDate(detail.created_at)} />
          <Field label="Status" value={detail.status} />
          <Field label="Edit version" value={String(detail.edit_version)} />
          <Field label="Reveal policy" value={detail.reveal_policy_snapshot} />
          <Field label="Scheduled reveal" value={formatDate(detail.scheduled_reveal_at)} />
        </div>
      </Card>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPendingUtteranceIdx(null);
              setTranscriptOpen(true);
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:text-gray-200"
          >
            View transcript
          </button>
          <AuditToggle
            evaluation={detail}
            enabled={auditEnabled}
            onToggle={() => setAuditEnabled((v) => !v)}
          />
        </div>
        {detail.manager_edited_at && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Last edited {formatRelativeTimestamp(detail.manager_edited_at)}
            {detail.manager_edited_by_name ? ` by ${detail.manager_edited_by_name}` : ''}
            {detail.manager_edited_by_active === false && <span className="italic"> (inactive)</span>}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {(overall !== null || canonicalDimensionScores.length > 0) && (
            <Card className="dark:bg-gray-800 dark:border-gray-700 p-0 overflow-hidden">
              <button
                type="button"
                onClick={() => setEvalPanelExpanded((v) => !v)}
                aria-expanded={evalPanelExpanded}
                className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {evalPanelExpanded
                    ? <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    : <ChevronRight className="w-5 h-5 text-gray-500 dark:text-gray-400" />}
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    AI Evaluation
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {overall !== null && <OverallScoreBadge score={overall} />}
                  <RubricVersionBadge
                    version={detail.rubric_version}
                    name={detail.rubric_name}
                    dimensionCount={detail.rubric_dimension_count}
                  />
                </div>
              </button>
              {evalPanelExpanded && (
                <div className="px-4 pb-4 pt-2 border-t border-gray-200 dark:border-gray-700">
                  {canonicalDimensionScores.length > 0 ? (
                    <div className="space-y-3">
                      {canonicalDimensionScores.map((s) => {
                        const aiCounterpart = aiDimensionScores.find((d) => d.name === s.name);
                        if (auditEnabled && aiCounterpart) {
                          return (
                            <div key={s.name} className="grid grid-cols-2 gap-3 items-center">
                              <DimensionBar name={s.name} score={s.score} />
                              <div className="opacity-70 italic text-xs">
                                <DimensionBar name={`AI: ${s.name}`} score={aiCounterpart.score} />
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={s.name} className="group flex items-center gap-2">
                            <div className="flex-1">
                              <DimensionBar name={s.name} score={s.score} />
                            </div>
                            {isManager && !auditEnabled && (
                              <FlagButton
                                claimType="dimension_score"
                                claimIndex={null}
                                claimText={`Dimension: ${humanizeKey(s.name)} — Score: ${(aiCounterpart ?? s).score.toFixed(1)}/4${(aiCounterpart ?? s).body ? `. ${(aiCounterpart ?? s).body}` : ''}`}
                                displayedText={`Dimension: ${humanizeKey(s.name)} — Score: ${s.score.toFixed(1)}/4${s.body ? `. ${s.body}` : ''}`}
                                dimensionKey={s.name}
                              />
                            )}
                            {isManager && !auditEnabled && (
                              <InlineEditDimensionScore
                                dimension={humanizeKey(s.name)}
                                score={s.score}
                                disabled={isLocked}
                                onSave={async (newScore) => {
                                  const base: Record<
                                    string,
                                    { score: number; citations: Citation[]; body?: string }
                                  > = {};
                                  const source =
                                    detail.dimension_scores ??
                                    Object.fromEntries(
                                      aiDimensionScores.map((d) => [
                                        d.name,
                                        { score: d.score, citations: d.citations ?? [], body: d.body },
                                      ]),
                                    );
                                  for (const [name, v] of Object.entries(source)) {
                                    const body = (v as { body?: unknown }).body;
                                    base[name] = {
                                      score: v.score,
                                      citations: (v.citations ?? []) as Citation[],
                                      ...(typeof body === 'string' && body.length > 0
                                        ? { body }
                                        : {}),
                                    };
                                  }
                                  base[s.name] = {
                                    score: newScore,
                                    citations: (s.citations ?? []) as Citation[],
                                    ...(typeof s.body === 'string' && s.body.length > 0
                                      ? { body: s.body }
                                      : {}),
                                  };
                                  return handleEdit({ dimension_scores: base });
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                      No dimension scores available
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {(canonicalNarrative || aiNarrative) && (
            <Card className="group dark:bg-gray-800 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Narrative
                </h2>
                {isManager && <FlagBadge count={flagCountFor('observation')} />}
                <FlagButton
                  claimType="observation"
                  claimIndex={null}
                  claimText={aiNarrative}
                  displayedText={canonicalNarrative}
                />
              </div>
              {auditEnabled ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs uppercase font-semibold text-gray-500 mb-1">
                      Canonical
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                      {canonicalNarrative || <span className="italic text-gray-400">—</span>}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs uppercase font-semibold text-gray-500 mb-1">
                      AI original
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 italic leading-relaxed">
                      {aiNarrative || <span>—</span>}
                    </p>
                  </div>
                </div>
              ) : isManager ? (
                <InlineEditTextField
                  value={canonicalNarrative ?? ''}
                  emptyLabel="No narrative"
                  disabled={isLocked}
                  rows={6}
                  onSave={(newValue) => {
                    // Bridge schema requires { text, citations } object shape on narrative.
                    // Preserve existing citations on edit so an unrelated text tweak doesn't
                    // strip them; canonical edits can still drop citations by saving an empty
                    // text or the parent product can later choose to scrub on canonical edit.
                    const existingCitations = detail.narrative?.citations ?? [];
                    return handleEdit({
                      narrative: { text: newValue, citations: existingCitations },
                    });
                  }}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                  {canonicalNarrative}
                </p>
              )}
            </Card>
          )}

          {supportsCoachingNudge && (effectiveNudge || isManager) && (
            <Card className="group dark:bg-gray-800 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Coaching nudge
                </h2>
                {isManager && <FlagBadge count={flagCountFor('coaching_nudge')} />}
                <FlagButton
                  claimType="coaching_nudge"
                  claimIndex={null}
                  claimText={aiCoachingNudge}
                  displayedText={effectiveNudge}
                />
              </div>
              {auditEnabled ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs uppercase font-semibold text-gray-500 mb-1">
                      Canonical
                    </div>
                    <p className="text-sm text-gray-800 dark:text-gray-200 italic">
                      {detail.coaching_nudge?.text ?? <span className="italic text-gray-400">—</span>}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs uppercase font-semibold text-gray-500 mb-1">
                      AI original
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 italic">
                      {aiCoachingNudge || <span>—</span>}
                    </p>
                  </div>
                </div>
              ) : isManager ? (
                <InlineEditTextField
                  value={effectiveNudge ?? ''}
                  emptyLabel="No coaching nudge"
                  disabled={isLocked}
                  rows={3}
                  onSave={(newValue) => {
                    const existingCitations =
                      detail.coaching_nudge?.citations ?? detail.coaching_nudge_effective?.citations ?? [];
                    return handleEdit({
                      coaching_nudge: { text: newValue, citations: existingCitations },
                    });
                  }}
                />
              ) : (
                <p className="text-sm text-gray-800 dark:text-gray-200 italic">{effectiveNudge}</p>
              )}
            </Card>
          )}

          {(canonicalStrengths.length > 0 || canonicalWeaknesses.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {canonicalStrengths.length > 0 && (
                <Card className="dark:bg-gray-800 dark:border-gray-700">
                  <h2 className="text-lg font-semibold text-green-700 dark:text-green-400 mb-2">
                    Strengths
                  </h2>
                  {auditEnabled ? (
                    <AuditTwoColList canonical={canonicalStrengths} ai={aiStrengths} />
                  ) : (
                    <InlineEditListField
                      items={canonicalStrengths}
                      disabled={isLocked || !isManager}
                      onSave={(newItems) =>
                        handleEdit({ strengths: normalizeListForSave(newItems, 'strengths') })
                      }
                      renderItemDisplay={isManager ? makeFlaggedRenderer('strength', aiStrengths) : renderCitedDisplay}
                    />
                  )}
                </Card>
              )}
              {canonicalWeaknesses.length > 0 && (
                <Card className="dark:bg-gray-800 dark:border-gray-700">
                  <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-400 mb-2">
                    Areas for improvement
                  </h2>
                  {auditEnabled ? (
                    <AuditTwoColList canonical={canonicalWeaknesses} ai={aiWeaknesses} />
                  ) : (
                    <InlineEditListField
                      items={canonicalWeaknesses}
                      disabled={isLocked || !isManager}
                      onSave={(newItems) =>
                        handleEdit({ weaknesses: normalizeListForSave(newItems, 'weaknesses') })
                      }
                      renderItemDisplay={isManager ? makeFlaggedRenderer('weakness', aiWeaknesses) : renderCitedDisplay}
                    />
                  )}
                </Card>
              )}
            </div>
          )}

          {canonicalKnowledgeGaps.length > 0 && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Knowledge gaps
              </h2>
              {auditEnabled ? (
                <AuditTwoColList canonical={canonicalKnowledgeGaps} ai={aiKnowledgeGaps} />
              ) : (
                <InlineEditListField
                  items={canonicalKnowledgeGaps}
                  disabled={isLocked || !isManager}
                  withExpectedSource
                  onSave={(newItems) =>
                    handleEdit({
                      knowledge_gaps: normalizeListForSave(newItems, 'knowledge_gaps'),
                    })
                  }
                  renderItemDisplay={isManager ? makeFlaggedRenderer('knowledge_gap', aiKnowledgeGaps) : renderCitedDisplay}
                />
              )}
            </Card>
          )}

          {repDeferrals.length > 0 && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Rep deferrals
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Moments where the rep verbally deferred or expressed uncertainty.
              </p>
              <ul className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
                {repDeferrals.map((d, i) => (
                  <li key={i} className="group border-l-2 border-gray-300 dark:border-gray-600 pl-3">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{d.topic}</div>
                      <FlagButton
                        claimType="rep_deferral"
                        claimIndex={i}
                        claimText={d.deferral_text}
                      />
                    </div>
                    <div className="text-gray-700 dark:text-gray-300">
                      &ldquo;{d.deferral_text}&rdquo;
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canonicalComplianceFlags.length > 0 && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">
                Compliance flags
              </h2>
              {auditEnabled ? (
                <AuditTwoColList canonical={canonicalComplianceFlags} ai={aiComplianceFlags} />
              ) : (
                <InlineEditListField
                  items={canonicalComplianceFlags}
                  disabled={isLocked || !isManager}
                  onSave={(newItems) =>
                    handleEdit({
                      compliance_flags: normalizeListForSave(newItems, 'compliance_flags'),
                    })
                  }
                  renderItemDisplay={isManager ? makeFlaggedRenderer('compliance_flag', aiComplianceFlags) : renderCitedDisplay}
                />
              )}
            </Card>
          )}

          {supportsAdditional && canonicalAdditional.length > 0 && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Additional observations
              </h2>
              {auditEnabled ? (
                <AuditTwoColList canonical={canonicalAdditional} ai={aiAdditional} />
              ) : (
                <InlineEditListField
                  items={canonicalAdditional}
                  disabled={isLocked || !isManager}
                  onSave={(newItems) =>
                    handleEdit({
                      additional_observations: normalizeListForSave(
                        newItems,
                        'additional_observations',
                      ),
                    })
                  }
                  renderItemDisplay={isManager ? makeFlaggedRenderer('observation', aiAdditional) : renderCitedDisplay}
                />
              )}
            </Card>
          )}

          {detail.call_summary_markdown && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Call summary
              </h2>
              <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200 font-sans leading-relaxed">
                {detail.call_summary_markdown}
              </pre>
            </Card>
          )}

          {showActions && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Reviewer actions
              </h2>
              {conflict ? (
                <div className="px-4 py-3 mb-3 text-sm bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded">
                  <div className="text-amber-800 dark:text-amber-200">{conflict.message}</div>
                  <button
                    type="button"
                    onClick={handleReload}
                    className="mt-2 px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded"
                  >
                    Reload
                  </button>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => performAction('hold')}
                  className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded disabled:opacity-50"
                >
                  {mutationLock.kind === 'pending' && mutationLock.tag === 'hold'
                    ? 'Holding…'
                    : 'Hold reveal'}
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setCustomDelay({ ...customDelay, show: !customDelay.show })}
                  className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded disabled:opacity-50"
                >
                  Custom delay…
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => performAction('use_default')}
                  className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded disabled:opacity-50"
                >
                  {mutationLock.kind === 'pending' && mutationLock.tag === 'use_default'
                    ? 'Resetting…'
                    : 'Use default'}
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => performAction('reveal_now')}
                  className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                >
                  {mutationLock.kind === 'pending' && mutationLock.tag === 'reveal_now'
                    ? 'Revealing…'
                    : 'Reveal now'}
                </button>
              </div>

              {customDelay.show && (
                <div className="mt-3 flex items-center gap-2">
                  <label
                    htmlFor="custom_delay"
                    className="text-sm text-gray-700 dark:text-gray-300"
                  >
                    Delay (minutes):
                  </label>
                  <input
                    id="custom_delay"
                    type="number"
                    min={1}
                    max={10080}
                    value={customDelay.minutes}
                    onChange={(e) =>
                      setCustomDelay({ ...customDelay, minutes: Number(e.target.value) })
                    }
                    className="w-24 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-sm"
                  />
                  <button
                    type="button"
                    disabled={isLocked || customDelay.minutes < 1}
                    onClick={() => performAction('custom_delay', customDelay.minutes)}
                    className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                  >
                    {mutationLock.kind === 'pending' && mutationLock.tag === 'custom_delay'
                      ? 'Applying…'
                      : 'Apply custom delay'}
                  </button>
                </div>
              )}
            </Card>
          )}
      </div>

      {/* Transcript modal — opens via the "View transcript" button or any
          citation pill carrying an utterance_index. */}
      <TranscriptModal
        ref={transcriptRef}
        isOpen={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        transcript={detail.transcript}
        evaluationId={id}
        comments={detail.transcript_comments}
        currentUserId={currentRepId}
        isAdmin={isAdmin}
        canComposeComments={isManager}
        repFullName={detail.rep_full_name}
        onCommentChanged={() => void load()}
        initialUtteranceIndex={pendingUtteranceIdx}
      />

      {/* KB chunk modal — opens when a citation pill carrying kb_source is clicked. */}
      <KBSidePanel
        kbSource={activeKb}
        onClose={() => setActiveKb(null)}
        onOpenRefinement={() => setRefinementOpen(true)}
        disabled={isLocked}
      />

      {flagTarget && (
        <FlagClaimModal
          evaluationId={id}
          claimType={flagTarget.claimType}
          claimIndex={flagTarget.claimIndex}
          claimText={flagTarget.claimText}
          displayedText={flagTarget.displayedText}
          dimensionKey={flagTarget.dimensionKey}
          onClose={() => setFlagTarget(null)}
          onSuccess={() => {
            if (detail && flagTarget) {
              setDetail({
                ...detail,
                flags: [
                  {
                    id: crypto.randomUUID(),
                    claim_type: flagTarget.claimType,
                    claim_index: flagTarget.claimIndex,
                    category: '',
                    what_was_wrong: '',
                    status: 'pending_review',
                    submitted_at: new Date().toISOString(),
                  },
                  ...(detail.flags ?? []),
                ],
              });
            }
            setFlagTarget(null);
            setBanner({ kind: 'success', text: 'Feedback submitted — it will improve future evaluations.' });
          }}
        />
      )}

      {refinementOpen && activeKb && (
        <RefinementModal
          isOpen
          evaluationId={id}
          docId={activeKb.doc_id}
          driveUrl={activeKb.drive_url}
          docTitle={activeKb.doc_title}
          currentChunkExcerpt={activeKb.chunk_text}
          onClose={() => setRefinementOpen(false)}
          onSuccess={() => {
            setRefinementOpen(false);
            setBanner({
              kind: 'success',
              text: "Refinement request sent to RevOps. They'll review and update the source doc.",
              successLink: {
                label: 'Track your refinement requests',
                href: '/dashboard/call-intelligence/my-refinements',
              },
            });
          }}
          onDuplicate={() => {
            setRefinementOpen(false);
            setBanner({
              kind: 'info',
              text: 'You already have an open refinement for this text.',
              cta: {
                label: 'View existing',
                onClick: () =>
                  router.push(
                    `/dashboard/call-intelligence/my-refinements?highlight=${id}`,
                  ),
              },
            });
          }}
          onEvaluationGone={() => {
            setRefinementOpen(false);
            setBanner({
              kind: 'error',
              text: 'This evaluation is no longer available.',
              cta: {
                label: 'Return to queue',
                onClick: () => router.push(`/dashboard/call-intelligence?tab=${returnTab}`),
              },
            });
            setMutationLock({ kind: 'authority-lost' });
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">{value}</div>
    </div>
  );
}

function AuditTwoColList({
  canonical,
  ai,
}: {
  canonical: ListItem[];
  ai: ListItem[];
}) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <div className="text-xs uppercase font-semibold text-gray-500 mb-1">Canonical</div>
        <ul className="list-disc list-inside space-y-1 text-gray-800 dark:text-gray-200">
          {canonical.length === 0 ? (
            <li className="italic text-gray-400">—</li>
          ) : (
            canonical.map((it, i) => <li key={i}>{it.text}</li>)
          )}
        </ul>
      </div>
      <div>
        <div className="text-xs uppercase font-semibold text-gray-500 mb-1">AI original</div>
        <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300 italic">
          {ai.length === 0 ? <li>—</li> : ai.map((it, i) => <li key={i}>{it.text}</li>)}
        </ul>
      </div>
    </div>
  );
}
