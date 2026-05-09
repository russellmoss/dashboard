'use client';

import { useState } from 'react';

interface Props {
  evaluationId: string;
  utteranceIndex: number;
  onSubmitted: () => void;
  onCancel: () => void;
}

export function UtteranceCommentComposer({
  evaluationId,
  utteranceIndex,
  onSubmitted,
  onCancel,
}: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/call-intelligence/evaluations/${encodeURIComponent(evaluationId)}/transcript-comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ utterance_index: utteranceIndex, text }),
        },
      );
      if (res.ok) {
        onSubmitted();
        return;
      }
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `HTTP ${res.status}`);
    } catch {
      setError('Failed to submit comment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-2">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
        Add comment on utterance {utteranceIndex}
      </div>
      <textarea
        rows={3}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 text-sm p-2"
      />
      {error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 dark:text-gray-200"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !text.trim()}
          className="px-3 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post comment'}
        </button>
      </div>
    </div>
  );
}
