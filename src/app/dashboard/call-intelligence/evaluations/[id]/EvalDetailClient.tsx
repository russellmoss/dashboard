'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@tremor/react';
import { ArrowLeft } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { EvaluationDetail } from '@/types/call-intelligence';

interface Props {
  id: string;
  role: string;
  returnTab: string;
}

interface CustomDelayState {
  show: boolean;
  minutes: number;
}

interface ConflictState {
  expectedVersion: number;
  message: string;
}

// ─── ai_original shape (defensive readers) ─────────────────────────────────
//
// Canonical v5 shape from sales-coaching/src/evaluation/schema.ts:
//   dimensionScores: { [dimName]: { score: 1-4, citations: [] } }
//   narrative:       { text: string, citations: [] }
//   strengths:       Array<{ text, citations }>
//   weaknesses:      Array<{ text, citations }>
//   knowledgeGaps:   Array<{ text, citations, expected_source? }>
//   complianceFlags: Array<{ text, citations }>
//   coachingNudge:   { text, citations }                          (v3+)
//   additionalObservations: Array<{ text, citations }>             (v4+)
//   repDeferrals:    Array<{ topic, deferral_text, citations }>    (v5)
//
// Older rows omit later-version fields. Renderer skips any section whose data
// is missing or empty. Citation pills + transcript pane are deferred to Step 5b-1.

interface DimensionScore { name: string; score: number /* 1..4 */ }

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function readText(x: unknown): string | null {
  if (typeof x === 'string') return x.trim() || null;
  if (isObj(x) && typeof x.text === 'string') return x.text.trim() || null;
  return null;
}

function readCitedItemTexts(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const it of x) {
    const t = readText(it);
    if (t) out.push(t);
  }
  return out;
}

function readKnowledgeGaps(x: unknown): Array<{ text: string; expected_source?: string }> {
  if (!Array.isArray(x)) return [];
  const out: Array<{ text: string; expected_source?: string }> = [];
  for (const it of x) {
    if (!isObj(it)) continue;
    const t = typeof it.text === 'string' ? it.text.trim() : '';
    if (!t) continue;
    const exp = typeof it.expected_source === 'string' ? it.expected_source.trim() : '';
    out.push(exp ? { text: t, expected_source: exp } : { text: t });
  }
  return out;
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

function readDimensionScores(x: unknown): DimensionScore[] {
  if (!isObj(x)) return [];
  const out: DimensionScore[] = [];
  for (const [name, val] of Object.entries(x)) {
    const score = isObj(val) && typeof val.score === 'number'
      ? val.score
      : (typeof val === 'number' ? val : null);
    if (score === null) continue;
    out.push({ name, score });
  }
  return out;
}

function humanizeKey(k: string): string {
  // 'kicker_introduction_timing' → 'Kicker Introduction Timing'
  return k.replace(/[_\-]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function DimensionBar({ name, score }: DimensionScore) {
  // Score is 1-4; convert to 0-100% with 1→0%, 4→100%.
  const pct = Math.max(0, Math.min(100, ((score - 1) / 3) * 100));
  // Color cue mirrors Step 5c-1 heat map (runbook line 700):
  //   3.0+ green, 2.0-2.9 gold, 1.0-1.9 tan.
  const fillClass = score >= 3 ? 'bg-[#175242]' : score >= 2 ? 'bg-[#8e7e57]' : 'bg-[#c7bca1]';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-700 dark:text-gray-300">{humanizeKey(name)}</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium tabular-nums">{score.toFixed(1)} / 4</span>
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
      <div className={`${fillClass} text-white rounded-lg px-4 py-2 font-bold text-2xl tabular-nums`}>
        {score.toFixed(1)}
      </div>
      <span className="text-sm text-gray-500 dark:text-gray-400">/ 4 overall</span>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-800 dark:text-gray-200">
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </ul>
  );
}

export default function EvalDetailClient({ id, role, returnTab }: Props) {
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [customDelay, setCustomDelay] = useState<CustomDelayState>({ show: false, minutes: 60 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    setConflict(null);
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

  useEffect(() => { void load(); }, [load]);

  const isAdmin = role === 'admin' || role === 'revops_admin';
  const isManagerView = !!detail && (isAdmin || role === 'manager');
  const showActions = isManagerView && detail && detail.status === 'pending_review';

  async function performAction(kind: 'hold' | 'custom_delay' | 'use_default' | 'reveal_now', overrideDelayMinutes?: number) {
    if (!detail) return;
    setActionPending(kind);
    setActionError(null);
    setConflict(null);
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
        res = await fetch(`/api/call-intelligence/evaluations/${detail.evaluation_id}/reveal-scheduling`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const json = await res.json();
      if (res.status === 409) {
        setConflict({
          expectedVersion: json.edit_version_expected ?? detail.edit_version,
          message: json.error ?? 'Conflict — another manager edited this evaluation.',
        });
        return;
      }
      if (!res.ok) {
        setActionError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionPending(null);
    }
  }

  if (loading) {
    return <div className="px-4 py-6"><LoadingSpinner /></div>;
  }
  if (error) {
    return (
      <div className="px-4 py-6 space-y-4">
        <Link href={`/dashboard/call-intelligence?tab=${returnTab}`} className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to {returnTab === 'admin-refinements' ? 'refinements' : 'queue'}
        </Link>
        <div className="px-4 py-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>
      </div>
    );
  }
  if (!detail) return null;

  // Parse ai_original defensively — Step 5a-UI rendering. Step 5b-1 will replace
  // this with the full transcript + citation-pill experience.
  const aiObj: Record<string, unknown> = isObj(detail.ai_original) ? detail.ai_original : {};
  const dimensionScores = readDimensionScores(aiObj.dimensionScores);
  const narrativeText = readText(aiObj.narrative);
  const strengths = readCitedItemTexts(aiObj.strengths);
  const weaknesses = readCitedItemTexts(aiObj.weaknesses);
  const knowledgeGaps = readKnowledgeGaps(aiObj.knowledgeGaps);
  const complianceFlags = readCitedItemTexts(aiObj.complianceFlags);
  const coachingNudgeText = readText(aiObj.coachingNudge);
  const additionalObservations = readCitedItemTexts(aiObj.additionalObservations);
  const repDeferrals = readDeferrals(aiObj.repDeferrals);
  const overall = typeof detail.overall_score === 'number' && Number.isFinite(detail.overall_score)
    ? detail.overall_score
    : null;

  return (
    <div className="space-y-4 px-4 py-6">
      <Link
        href={`/dashboard/call-intelligence?tab=${returnTab}`}
        className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" /> Back to {returnTab === 'admin-refinements' ? 'refinements' : 'queue'}
      </Link>

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

      {(overall !== null || dimensionScores.length > 0) && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">AI Evaluation</h2>
            {overall !== null && <OverallScoreBadge score={overall} />}
          </div>
          {dimensionScores.length > 0 && (
            <div className="space-y-3">
              {dimensionScores.map((s) => <DimensionBar key={s.name} {...s} />)}
            </div>
          )}
        </Card>
      )}

      {narrativeText && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Narrative</h2>
          <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{narrativeText}</p>
        </Card>
      )}

      {coachingNudgeText && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Coaching nudge</h2>
          <p className="text-sm text-gray-800 dark:text-gray-200 italic leading-relaxed">{coachingNudgeText}</p>
        </Card>
      )}

      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strengths.length > 0 && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-green-700 dark:text-green-400 mb-2">Strengths</h2>
              <BulletList items={strengths} />
            </Card>
          )}
          {weaknesses.length > 0 && (
            <Card className="dark:bg-gray-800 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-400 mb-2">Areas for improvement</h2>
              <BulletList items={weaknesses} />
            </Card>
          )}
        </div>
      )}

      {knowledgeGaps.length > 0 && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Knowledge gaps</h2>
          <ul className="list-disc list-inside space-y-1.5 text-sm text-gray-800 dark:text-gray-200">
            {knowledgeGaps.map((g, i) => (
              <li key={i}>
                {g.text}
                {g.expected_source && (
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    (expected source: {g.expected_source})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {repDeferrals.length > 0 && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Rep deferrals</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Moments where the rep verbally deferred or expressed uncertainty.</p>
          <ul className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
            {repDeferrals.map((d, i) => (
              <li key={i} className="border-l-2 border-gray-300 dark:border-gray-600 pl-3">
                <div className="font-medium">{d.topic}</div>
                <div className="text-gray-700 dark:text-gray-300">&ldquo;{d.deferral_text}&rdquo;</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {complianceFlags.length > 0 && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">Compliance flags</h2>
          <BulletList items={complianceFlags} />
        </Card>
      )}

      {additionalObservations.length > 0 && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Additional observations</h2>
          <BulletList items={additionalObservations} />
        </Card>
      )}

      {detail.call_summary_markdown && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Call summary</h2>
          <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200 font-sans leading-relaxed">{detail.call_summary_markdown}</pre>
        </Card>
      )}

      {showActions && (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Reviewer actions</h2>
          {conflict ? (
            <div className="px-4 py-3 mb-3 text-sm bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded">
              <div className="text-amber-800 dark:text-amber-200">{conflict.message}</div>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-2 px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded"
              >
                Reload
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!actionPending}
              onClick={() => performAction('hold')}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded disabled:opacity-50"
            >
              {actionPending === 'hold' ? 'Holding…' : 'Hold reveal'}
            </button>
            <button
              type="button"
              disabled={!!actionPending}
              onClick={() => setCustomDelay({ ...customDelay, show: !customDelay.show })}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded disabled:opacity-50"
            >
              Custom delay…
            </button>
            <button
              type="button"
              disabled={!!actionPending}
              onClick={() => performAction('use_default')}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 rounded disabled:opacity-50"
            >
              {actionPending === 'use_default' ? 'Resetting…' : 'Use default'}
            </button>
            <button
              type="button"
              disabled={!!actionPending}
              onClick={() => performAction('reveal_now')}
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
            >
              {actionPending === 'reveal_now' ? 'Revealing…' : 'Reveal now'}
            </button>
          </div>

          {customDelay.show && (
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="custom_delay" className="text-sm text-gray-700 dark:text-gray-300">Delay (minutes):</label>
              <input
                id="custom_delay"
                type="number"
                min={1}
                max={10080}
                value={customDelay.minutes}
                onChange={(e) => setCustomDelay({ ...customDelay, minutes: Number(e.target.value) })}
                className="w-24 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 text-sm"
              />
              <button
                type="button"
                disabled={!!actionPending || customDelay.minutes < 1}
                onClick={() => performAction('custom_delay', customDelay.minutes)}
                className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
              >
                {actionPending === 'custom_delay' ? 'Applying…' : 'Apply custom delay'}
              </button>
            </div>
          )}

          {actionError && (
            <div className="mt-3 px-3 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">{actionError}</div>
          )}
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-gray-900 dark:text-gray-100 mt-0.5">{value}</div>
    </div>
  );
}
