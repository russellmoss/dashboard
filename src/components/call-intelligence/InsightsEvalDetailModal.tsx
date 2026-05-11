'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import type {
  Citation,
  EvalDetailDrillPayload,
  EvaluationDetail,
  RepDeferral,
  TranscriptDrillPayload,
} from '@/types/call-intelligence';
import { CitationPill } from './CitationPill';
import { CitedProse } from './CitedProse';

interface Props {
  isOpen: boolean;
  payload: EvalDetailDrillPayload | null;
  detail: EvaluationDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onOpenTranscript: (drill: TranscriptDrillPayload) => void;
  /** Optional KB-side-panel opener; if not passed, KB pills are click-no-op. */
  onOpenKB?: (
    kbSource: NonNullable<Citation['kb_source']> & { owner: string; chunk_text: string },
  ) => void;
  /** When true, this modal is below a deeper modal — set aria-hidden + suppress focus. */
  ariaHidden?: boolean;
}

function humanizeKey(key: string): string {
  if (!key) return '';
  return key.replace(/[_\-]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function scoreBadgeClass(score: number): string {
  if (score >= 3) return 'bg-[#175242] text-white';
  if (score >= 2) return 'bg-[#8e7e57] text-white';
  return 'bg-[#c7bca1] text-gray-900';
}

/** Call-level metadata row in the modal header: advisor name, SFDC link, copyable call ID. */
function EvalMetaRow({ detail }: { detail: EvaluationDetail }) {
  const [copied, setCopied] = useState(false);
  const sfdcUrl = detail.call_sfdc_record_id
    ? `https://savvywealth.lightning.force.com/${detail.call_sfdc_record_id}`
    : null;
  const copyCallId = async () => {
    try {
      await navigator.clipboard.writeText(detail.call_note_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — fail silently */
    }
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
      <span>
        Advisor: <span className="text-gray-900 dark:text-gray-200 font-medium">
          {detail.advisor_name ?? '—'}
        </span>
      </span>
      {detail.call_title && (
        <span className="truncate" title={detail.call_title}>
          · {detail.call_title}
        </span>
      )}
      {sfdcUrl && (
        <a
          href={sfdcUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline"
          title={detail.call_sfdc_record_id ?? undefined}
        >
          SFDC <ExternalLink className="w-3 h-3" />
        </a>
      )}
      <button
        type="button"
        onClick={copyCallId}
        className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-mono"
        title="Copy Neon call_note_id"
      >
        <span className="tabular-nums">
          {copied ? 'copied' : `call: ${detail.call_note_id.slice(0, 8)}…`}
        </span>
        <Copy className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function InsightsEvalDetailModal({
  isOpen,
  payload,
  detail,
  loading,
  error,
  onClose,
  onOpenTranscript,
  onOpenKB,
  ariaHidden,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus-on-open.
  useEffect(() => {
    if (isOpen && !ariaHidden) {
      const t = setTimeout(() => closeButtonRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [isOpen, ariaHidden]);

  if (!isOpen) return null;
  if (!payload || (!payload.dimension && !payload.topic)) return null;

  // Resolve the dimension's own score + citations + body (the drill anchor).
  // 2026-05-11: body (schema v6) is the primary content; v2-v5 historical rows
  // lack body until backfilled — see scripts/backfill-dimension-bodies.cjs.
  let dimensionScoreEntry:
    | { score: number; citations: Citation[]; body?: string }
    | null = null;
  let topicDeferrals: RepDeferral[] = [];

  if (detail) {
    if (payload.dimension && detail.dimension_scores) {
      const entry = detail.dimension_scores[payload.dimension];
      if (entry) {
        dimensionScoreEntry = {
          score: entry.score,
          citations: entry.citations ?? [],
          body: entry.body,
        };
      }
    }
    if (payload.topic) {
      topicDeferrals = detail.rep_deferrals.filter(d => d.topic === payload.topic);
    }
  }

  const scrollToUtterance = (idx: number) => {
    if (!detail) return;
    onOpenTranscript({
      evaluationId: detail.evaluation_id,
      initialUtteranceIndex: idx,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insights-eval-detail-title"
      aria-hidden={ariaHidden}
    >
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden w-full h-full md:h-auto md:max-w-3xl md:mx-4 md:max-h-[90vh] md:rounded-lg">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h2
              id="insights-eval-detail-title"
              className="text-lg font-semibold text-gray-900 dark:text-white truncate"
            >
              {detail?.rep_full_name ?? 'Evaluation'}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
              {formatDate(detail?.call_started_at ?? null)}
            </p>
            {detail && <EvalMetaRow detail={detail} />}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close evaluation detail"
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
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

          {!loading && !error && detail && (
            <>
              {/* Dimension drill: banner + score + per-dim AI rationale (body) +
                  citation pills. Body (schema v6) is the primary content. When
                  body is missing on v2-v5 historical rows, the dim banner +
                  citations are still rendered as the fallback path so managers
                  can still reach the transcript / KB chunks via the pills. */}
              {payload.dimension && (
                <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/40">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {humanizeKey(payload.dimension)}
                    </h3>
                    {dimensionScoreEntry && (
                      <div className={`rounded-md px-3 py-1 font-bold tabular-nums ${scoreBadgeClass(dimensionScoreEntry.score)}`}>
                        {dimensionScoreEntry.score.toFixed(1)} / 4
                      </div>
                    )}
                  </div>

                  {!dimensionScoreEntry && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-1">
                      No score recorded for this dimension on this evaluation.
                    </p>
                  )}

                  {/* Body path — schema v6 with rationale. */}
                  {dimensionScoreEntry && dimensionScoreEntry.body && dimensionScoreEntry.body.trim().length > 0 && (
                    <div className="mt-3">
                      <CitedProse
                        text={dimensionScoreEntry.body}
                        citations={dimensionScoreEntry.citations}
                        chunkLookup={detail.chunk_lookup}
                        onScrollToUtterance={scrollToUtterance}
                        onOpenKB={onOpenKB}
                      />
                    </div>
                  )}

                  {/* Fallback path — no body yet (v2-v5 row pre-backfill). */}
                  {dimensionScoreEntry && (!dimensionScoreEntry.body || dimensionScoreEntry.body.trim().length === 0) && (
                    <>
                      <p className="mt-3 text-xs italic text-gray-500 dark:text-gray-400">
                        No per-dimension rationale on file yet. Admin can fill via CLI backfill.
                      </p>
                      {dimensionScoreEntry.citations.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Cited utterances:</span>
                          {dimensionScoreEntry.citations.map((c, i) => (
                            <CitationPill
                              key={i}
                              citation={c}
                              chunkLookup={detail.chunk_lookup}
                              onScrollToUtterance={scrollToUtterance}
                              onOpenKB={onOpenKB}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}

              {/* Topic drill (rep deferrals — reserved for cluster ship) */}
              {payload.topic && (
                <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/40">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    {payload.topic}
                  </h3>
                  {topicDeferrals.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                      No deferrals captured for this topic on this evaluation.
                    </p>
                  ) : (
                    <ul className="space-y-2 text-sm text-gray-800 dark:text-gray-200">
                      {topicDeferrals.map((d, i) => (
                        <li key={i} className="border-l-2 border-gray-300 dark:border-gray-600 pl-3">
                          <div className="italic text-gray-700 dark:text-gray-300">&ldquo;{d.deferral_text}&rdquo;</div>
                          {d.citations.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {d.citations.map((c, ci) => (
                                <CitationPill
                                  key={ci}
                                  citation={c}
                                  chunkLookup={detail.chunk_lookup}
                                  onScrollToUtterance={scrollToUtterance}
                                  onOpenKB={onOpenKB}
                                />
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* Per spec (council-approved 2026-05-11): the per-dimension body
                  (above) is the canonical drill answer. Call-level Narrative /
                  Strengths / Weaknesses / Knowledge gaps / Compliance flags /
                  Additional observations / Rep deferrals (non-topic) sections
                  that previously rendered here have been removed — they belong
                  on the standalone /evaluations/[id] page, not this drill-down. */}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
