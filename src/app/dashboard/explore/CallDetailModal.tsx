'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ─────────────────────────────────────────────────────────────────────────────
// Types — keep the modal's row prop loose enough that it accepts the drill-down
// row shape from CoachingUsageClient without a circular import.
// ─────────────────────────────────────────────────────────────────────────────

export interface CallDetailRowSummary {
  callNoteId: string;
  callDate: string;
  advisorName: string | null;
  advisorEmail: string | null;
  sgaName: string | null;
  sgmName: string | null;
  source: 'granola' | 'kixie';
  didSql: boolean;
  didSqo: boolean;
  currentStage: string | null;
  closedLost: boolean;
  pushedToSfdc: boolean;
  hasAiFeedback: boolean;
  hasManagerEditEval: boolean;
}

interface TranscriptUtterance {
  utterance_index: number;
  speaker_role: 'rep' | 'other_party';
  text: string;
  start_seconds: number;
  end_seconds: number;
}

interface CallDetailResponse {
  notesMarkdown: string;
  coachingMarkdown: string;
  transcript: TranscriptUtterance[] | null;
}

type Tab = 'summary' | 'notes' | 'coaching' | 'transcript';

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const total = Math.floor(s);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? 'text-green-600 dark:text-green-400 font-medium' : 'text-gray-400 dark:text-gray-500'}>
      {value ? 'Yes' : 'No'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab panels
// ─────────────────────────────────────────────────────────────────────────────

function SummaryTab({ row }: { row: CallDetailRowSummary }) {
  const advisorDisplay = row.advisorName ?? row.advisorEmail ?? 'Unknown';
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Advisor</div>
        <div className="text-2xl font-semibold dark:text-white">{advisorDisplay}</div>
        {row.advisorEmail && row.advisorName && (
          <div className="text-sm text-gray-500 dark:text-gray-400">{row.advisorEmail}</div>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Rep</dt>
          <dd className="dark:text-gray-100">{row.sgaName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Manager</dt>
          <dd className="dark:text-gray-100">{row.sgmName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Call date / time</dt>
          <dd className="dark:text-gray-100">{formatTimestamp(row.callDate)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Source</dt>
          <dd className="dark:text-gray-100 capitalize">{row.source}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">SQL'd</dt>
          <dd><YesNo value={row.didSql} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">SQO'd</dt>
          <dd><YesNo value={row.didSqo} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Opp stage</dt>
          <dd className="dark:text-gray-100">{row.currentStage ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Closed Lost</dt>
          <dd><YesNo value={row.closedLost} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Notes pushed to SFDC</dt>
          <dd><YesNo value={row.pushedToSfdc} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">AI got feedback</dt>
          <dd><YesNo value={row.hasAiFeedback} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Eval edited</dt>
          <dd><YesNo value={row.hasManagerEditEval} /></dd>
        </div>
      </dl>
    </div>
  );
}

// Tailwind typography would be perfect here, but the project doesn't have
// @tailwindcss/typography, so we ship explicit rules for the elements
// ReactMarkdown emits. Keeps the renderer readable; no markdown artifacts
// (#, **, -, etc.) make it to the DOM — only their semantic equivalents.
const MARKDOWN_PROSE_CLASSES = [
  '[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:dark:text-white',
  '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:dark:text-white',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:dark:text-white',
  '[&_p]:text-sm [&_p]:leading-6 [&_p]:my-2 [&_p]:dark:text-gray-100',
  '[&_strong]:font-semibold [&_strong]:dark:text-white',
  '[&_em]:italic',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1',
  '[&_li]:text-sm [&_li]:leading-6 [&_li]:dark:text-gray-100',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:dark:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_blockquote]:dark:text-gray-300 [&_blockquote]:my-2',
  '[&_code]:bg-gray-100 [&_code]:dark:bg-gray-700 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono',
  '[&_a]:text-blue-600 [&_a]:dark:text-blue-400 [&_a]:underline',
  '[&_hr]:my-4 [&_hr]:border-gray-200 [&_hr]:dark:border-gray-700',
  '[&_table]:my-2 [&_table]:text-sm',
  '[&_th]:font-semibold [&_th]:px-2 [&_th]:py-1 [&_th]:border-b [&_th]:dark:border-gray-700 [&_th]:dark:text-white [&_th]:text-left',
  '[&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:dark:border-gray-800 [&_td]:dark:text-gray-100',
].join(' ');

function MarkdownTab({
  markdown, loading, error, emptyMessage, loadingMessage,
}: {
  markdown: string;
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  loadingMessage: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        {loadingMessage}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }
  if (!markdown.trim()) {
    return <div className="text-gray-500 dark:text-gray-400 italic">{emptyMessage}</div>;
  }
  return (
    <div className={MARKDOWN_PROSE_CLASSES}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}

function TranscriptTab({
  transcript, loading, error,
}: { transcript: TranscriptUtterance[] | null; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Loading transcript…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }
  if (!transcript || transcript.length === 0) {
    return <div className="text-gray-500 dark:text-gray-400 italic">No transcript available for this call.</div>;
  }

  // Some Granola transcripts arrive with no speaker diarization — every
  // utterance gets `speaker_role='rep'` regardless of who actually spoke.
  // When that happens, attaching Rep/Advisor pills to every line is worse
  // than wrong (it misattributes the conversation). Detect single-speaker
  // transcripts and render unattributed instead, with a small notice.
  const distinctRoles = new Set(transcript.map((u) => u.speaker_role));
  const labelsUnreliable = distinctRoles.size <= 1;

  return (
    <div className="space-y-3">
      {labelsUnreliable && (
        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
          Speaker labels are unavailable for this transcript (upstream diarization didn't run). Displayed without Rep / Advisor attribution.
        </div>
      )}
      {transcript.map((u) => {
        const isRep = u.speaker_role === 'rep';
        return (
          <div key={u.utterance_index} className="flex gap-3 items-start">
            <div className="w-16 shrink-0 text-xs font-mono text-gray-500 dark:text-gray-400 pt-1">
              {formatSeconds(u.start_seconds)}
            </div>
            {!labelsUnreliable && (
              <div className="w-20 shrink-0 pt-1">
                <span
                  className={[
                    'inline-block px-2 py-0.5 text-xs rounded-full',
                    isRep
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
                  ].join(' ')}
                >
                  {isRep ? 'Rep' : 'Advisor'}
                </span>
              </div>
            )}
            <p className="flex-1 text-sm leading-6 dark:text-gray-100 whitespace-pre-wrap">{u.text}</p>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

export function CallDetailModal({
  row,
  onClose,
}: {
  row: CallDetailRowSummary | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('summary');
  const [detail, setDetail] = useState<CallDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when the row changes (different call selected) and fetch detail.
  useEffect(() => {
    if (!row) return;
    setTab('summary');
    setDetail(null);
    setError(null);
    let cancelled = false;
    async function load() {
      if (!row) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/coaching-usage/call/${row.callNoteId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as CallDetailResponse;
        if (!cancelled) setDetail(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load call detail');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [row]);

  // Esc-to-close.
  useEffect(() => {
    if (!row) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold dark:text-white">
              {row.advisorName ?? row.advisorEmail ?? 'Unknown advisor'}
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatTimestamp(row.callDate)} · {row.source}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-5">
          {(['summary', 'notes', 'coaching', 'transcript'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                'py-2 px-3 text-sm font-medium border-b-2 transition-colors capitalize',
                tab === t
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 flex-1">
          {tab === 'summary' && <SummaryTab row={row} />}
          {tab === 'notes' && (
            <MarkdownTab
              markdown={detail?.notesMarkdown ?? ''}
              loading={loading}
              error={error}
              emptyMessage="No notes available for this call."
              loadingMessage="Loading notes…"
            />
          )}
          {tab === 'coaching' && (
            <MarkdownTab
              markdown={detail?.coachingMarkdown ?? ''}
              loading={loading}
              error={error}
              emptyMessage="No coaching analysis available for this call."
              loadingMessage="Loading coaching analysis…"
            />
          )}
          {tab === 'transcript' && <TranscriptTab transcript={detail?.transcript ?? null} loading={loading} error={error} />}
        </div>
      </div>
    </div>
  );
}
