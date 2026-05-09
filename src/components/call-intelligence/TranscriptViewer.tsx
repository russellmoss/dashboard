'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { TranscriptCommentRow, TranscriptUtterance } from '@/types/call-intelligence';
import { UtteranceCommentCard } from './UtteranceCommentCard';
import { UtteranceCommentComposer } from './UtteranceCommentComposer';

export interface TranscriptViewerHandle {
  scrollToUtterance: (idx: number) => void;
}

interface Props {
  transcript: unknown;
  evaluationId: string;
  comments: TranscriptCommentRow[];
  currentUserId: string | null;
  isAdmin: boolean;
  /** True for managers + admins; reps get no compose UI. */
  canComposeComments: boolean;
  /** Display label for `speaker_role === 'rep'` utterances (e.g., "Eleni Greco"). */
  repFullName: string | null;
  /** Display label for `speaker_role === 'other_party'` utterances. Defaults to "Advisor". */
  advisorName?: string | null;
  onCommentChanged: () => void;
}

/** Format start_seconds as M:SS for display next to each utterance. */
function formatElapsed(secs: number | undefined): string {
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const TranscriptViewer = forwardRef<TranscriptViewerHandle, Props>(
  (
    {
      transcript,
      evaluationId,
      comments,
      currentUserId,
      isAdmin,
      canComposeComments,
      repFullName,
      advisorName,
      onCommentChanged,
    },
    ref,
  ) => {
    const repLabel = repFullName ?? 'Rep';
    const advisorLabel = advisorName ?? 'Advisor';
    const speakerLabel = (s: TranscriptUtterance['speaker']) =>
      s === 'rep' ? repLabel : s === 'advisor' ? advisorLabel : 'Unknown';
    const speakerPillClass = (s: TranscriptUtterance['speaker']) =>
      s === 'rep'
        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
        : s === 'advisor'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    const utterances = readUtterances(transcript);
    const utteranceRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const [pendingComment, setPendingComment] = useState<{ utteranceIndex: number } | null>(null);
    const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);

    useImperativeHandle(ref, () => ({
      scrollToUtterance: (idx: number) => {
        const el = utteranceRefs.current[idx];
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedIdx(idx);
        setTimeout(() => setHighlightedIdx(null), 1500);
      },
    }));

    const handleSelection = (utteranceIndex: number) => {
      if (!canComposeComments) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      setPendingComment({ utteranceIndex });
    };

    const commentsByIdx = groupCommentsByIndex(comments);

    if (utterances.length === 0) {
      return (
        <div className="text-sm italic text-gray-500 dark:text-gray-400 p-4 border border-gray-200 dark:border-gray-700 rounded">
          No transcript available for this call.
        </div>
      );
    }

    return (
      <div className="space-y-2 max-h-[80vh] overflow-y-auto pr-2">
        {utterances.map((u) => (
          <div
            key={u.utterance_index}
            ref={(el) => {
              utteranceRefs.current[u.utterance_index] = el;
            }}
            className={`border rounded p-3 transition-colors ${
              highlightedIdx === u.utterance_index
                ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
                : 'border-gray-200 dark:border-gray-700'
            }`}
            onMouseUp={() => handleSelection(u.utterance_index)}
          >
            <div className="flex items-baseline justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${speakerPillClass(u.speaker)}`}
              >
                {speakerLabel(u.speaker)} · #{u.utterance_index}
              </span>
              {typeof u.start_seconds === 'number' && (
                <span title={`${u.start_seconds.toFixed(1)}s elapsed`}>
                  {formatElapsed(u.start_seconds)}
                </span>
              )}
            </div>
            <p className="text-sm dark:text-gray-200 whitespace-pre-wrap select-text">{u.text}</p>
            {commentsByIdx[u.utterance_index]?.map((c) => (
              <UtteranceCommentCard
                key={c.id}
                comment={c}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onDelete={async (id) => {
                  const res = await fetch(
                    `/api/call-intelligence/transcript-comments/${encodeURIComponent(id)}`,
                    { method: 'DELETE' },
                  );
                  if (res.ok) onCommentChanged();
                }}
              />
            ))}
            {pendingComment?.utteranceIndex === u.utterance_index && (
              <UtteranceCommentComposer
                evaluationId={evaluationId}
                utteranceIndex={u.utterance_index}
                onSubmitted={() => {
                  setPendingComment(null);
                  onCommentChanged();
                }}
                onCancel={() => setPendingComment(null)}
              />
            )}
          </div>
        ))}
      </div>
    );
  },
);
TranscriptViewer.displayName = 'TranscriptViewer';

function readUtterances(raw: unknown): TranscriptUtterance[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i): TranscriptUtterance | null => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text : '';
      if (!text) return null;
      const idx = typeof o.utterance_index === 'number' ? o.utterance_index : i;
      // Sales-coaching writes `speaker_role: 'rep' | 'other_party'`. Older payloads
      // may use `speaker` (microphone/speaker source) — accept both.
      const roleRaw =
        typeof o.speaker_role === 'string'
          ? o.speaker_role.toLowerCase()
          : typeof o.speaker === 'string'
            ? o.speaker.toLowerCase()
            : '';
      const speaker: 'rep' | 'advisor' | 'unknown' =
        roleRaw === 'rep' || roleRaw === 'microphone'
          ? 'rep'
          : roleRaw === 'other_party' || roleRaw === 'advisor' || roleRaw === 'speaker'
            ? 'advisor'
            : 'unknown';
      const start_seconds = typeof o.start_seconds === 'number' ? o.start_seconds : undefined;
      const end_seconds = typeof o.end_seconds === 'number' ? o.end_seconds : undefined;
      return { utterance_index: idx, speaker, text, start_seconds, end_seconds };
    })
    .filter((u): u is TranscriptUtterance => u !== null);
}

function groupCommentsByIndex(
  comments: TranscriptCommentRow[],
): Record<number, TranscriptCommentRow[]> {
  return comments.reduce<Record<number, TranscriptCommentRow[]>>((acc, c) => {
    (acc[c.utterance_index] ||= []).push(c);
    return acc;
  }, {});
}
