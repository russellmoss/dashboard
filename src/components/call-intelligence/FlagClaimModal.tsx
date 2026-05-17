'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface FlagClaimModalProps {
  evaluationId: string;
  claimType: string;
  claimIndex: number | null;
  claimText: string;
  displayedText?: string | null;
  dimensionKey?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORY_OPTIONS = [
  { value: 'factual_error', label: 'Factual error' },
  { value: 'obsolete_process', label: 'Obsolete process' },
  { value: 'wrong_tone', label: 'Wrong tone' },
  { value: 'wrong_recommendation', label: 'Wrong recommendation' },
] as const;

export function FlagClaimModal({
  evaluationId,
  claimType,
  claimIndex,
  claimText,
  displayedText,
  dimensionKey,
  onClose,
  onSuccess,
}: FlagClaimModalProps) {
  const [category, setCategory] = useState('');
  const [whatWasWrong, setWhatWasWrong] = useState('');
  const [whatItShouldSay, setWhatItShouldSay] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayQuote = displayedText ?? claimText;
  const truncatedQuote =
    displayQuote.length > 200 ? displayQuote.slice(0, 200) + '…' : displayQuote;

  const canSubmit = category && whatWasWrong.trim().length >= 10 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(
        `/api/call-intelligence/evaluations/${evaluationId}/feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claim_type: claimType,
            claim_index: claimIndex,
            claim_text: claimText,
            displayed_text: displayedText || null,
            dimension_key: dimensionKey || null,
            category,
            what_was_wrong: whatWasWrong.trim(),
            what_it_should_say: whatItShouldSay.trim() || null,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Flag AI Evaluation Content
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="bg-gray-100 dark:bg-gray-700/50 rounded p-3 text-sm text-gray-700 dark:text-gray-300 italic">
            &ldquo;{truncatedQuote}&rdquo;
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Category <span className="text-red-500">*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="">Select a category…</option>
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              What was wrong? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={whatWasWrong}
              onChange={(e) => setWhatWasWrong(e.target.value)}
              rows={3}
              placeholder="Describe what's incorrect (min 10 characters)…"
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              What should it say instead?{' '}
              <span className="text-gray-400 text-xs">(optional)</span>
            </label>
            <textarea
              value={whatItShouldSay}
              onChange={(e) => setWhatItShouldSay(e.target.value)}
              rows={3}
              placeholder="Suggest the correct content…"
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-y"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded"
            >
              {submitting ? 'Submitting…' : 'Submit flag'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
