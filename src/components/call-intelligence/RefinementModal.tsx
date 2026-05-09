'use client';

import { useState } from 'react';

interface Props {
  isOpen: boolean;
  evaluationId: string;
  docId: string;
  driveUrl: string;
  docTitle: string;
  currentChunkExcerpt: string;
  onClose: () => void;
  onSuccess: () => void;
  onDuplicate: () => void;
  onEvaluationGone: () => void;
}

export function RefinementModal(props: Props) {
  const placeholder = `Suggested change to ${props.docTitle}: `;
  const [text, setText] = useState(placeholder);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.isOpen) return null;

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (trimmed === placeholder.trim()) {
      setError('Please describe the suggested change instead of leaving the placeholder.');
      return;
    }
    if (trimmed.length < 20) {
      setError('Suggested change must be at least 20 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/call-intelligence/content-refinements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluation_id: props.evaluationId,
          doc_id: props.docId,
          drive_url: props.driveUrl,
          current_chunk_excerpt: props.currentChunkExcerpt,
          suggested_change: text,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        props.onSuccess();
        return;
      }
      if (res.status === 409 && json.error === 'content_refinement_duplicate') {
        props.onDuplicate();
        return;
      }
      if (res.status === 404 && json.error === 'evaluation_not_found') {
        props.onEvaluationGone();
        return;
      }
      if (res.status === 400 && json.error === 'invalid_request' && Array.isArray(json.issues)) {
        const fieldIssue = json.issues.find(
          (i: unknown) =>
            i &&
            typeof i === 'object' &&
            Array.isArray((i as { path?: unknown[] }).path) &&
            (i as { path: unknown[] }).path[0] === 'suggested_change',
        );
        setError(
          (fieldIssue && typeof (fieldIssue as { message?: string }).message === 'string'
            ? (fieldIssue as { message: string }).message
            : null) ?? 'Suggested change is invalid.',
        );
        return;
      }
      setError('Something went wrong. Please try again.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-lg w-full p-6 mx-4">
        <h3 className="text-lg font-semibold mb-3 dark:text-white">Refine: {props.docTitle}</h3>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 text-sm p-2"
        />
        {error && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={props.onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Send refinement request'}
          </button>
        </div>
      </div>
    </div>
  );
}
