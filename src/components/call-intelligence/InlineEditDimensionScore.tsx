'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  dimension: string;
  score: number;
  /** When true, click-to-edit is blocked (used during a 409 freeze or pending save). */
  disabled: boolean;
  /** Parent provides full updated dimension_scores object back; this component only owns its own draft. */
  onSave: (newScore: number) => Promise<{ ok: boolean; error?: string }>;
}

const RUBRIC: Record<number, string> = {
  1: 'Did not meet expectations',
  2: 'Partially met expectations',
  3: 'Met expectations',
  4: 'Exceeded expectations',
};

export function InlineEditDimensionScore({ dimension, score, disabled, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(score);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(score);
  }, [score]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setDraft(score);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, score]);

  const canSave = draft !== score && !submitting;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-sm ${
          disabled
            ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 cursor-not-allowed'
            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 hover:brightness-110'
        }`}
        title={disabled ? '' : 'Click to edit'}
      >
        {score} / 4
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-3">
          <div className="text-xs font-semibold mb-2 dark:text-white">{dimension}</div>
          {[1, 2, 3, 4].map((n) => (
            <label key={n} className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="radio"
                name={`score-${dimension}`}
                value={n}
                checked={draft === n}
                onChange={() => setDraft(n)}
                disabled={submitting}
                className="mt-0.5"
              />
              <span className="text-xs dark:text-gray-200">
                <strong>{n}</strong> — {RUBRIC[n]}
              </span>
            </label>
          ))}
          {error && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => {
                setOpen(false);
                setDraft(score);
                setError(null);
              }}
              disabled={submitting}
              className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 dark:text-gray-200"
            >
              Cancel
            </button>
            <button
              disabled={!canSave}
              onClick={async () => {
                setSubmitting(true);
                setError(null);
                const result = await onSave(draft);
                setSubmitting(false);
                if (result.ok) {
                  setOpen(false);
                } else {
                  setError(result.error ?? 'Save failed');
                }
              }}
              className="px-2 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
