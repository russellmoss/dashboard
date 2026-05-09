'use client';

import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  label?: string;
  value: string;
  /** Used when value is empty to render a "—" or empty-state hint. */
  emptyLabel?: string;
  disabled: boolean;
  /** Parent applies the patch + handles 409/404. Returns ok=true on success. */
  onSave: (newValue: string) => Promise<{ ok: boolean; error?: string }>;
  /** Optional: render the displayed (read-only) value with a custom node (e.g., text + citation pills). */
  renderDisplay?: () => React.ReactNode;
  /** Min character requirement; default 0. */
  minLength?: number;
  /** When the textarea should support multi-line input. */
  rows?: number;
}

export function InlineEditTextField({
  label,
  value,
  emptyLabel = '—',
  disabled,
  onSave,
  renderDisplay,
  minLength = 0,
  rows = 4,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!editing) {
    return (
      <div className="group relative">
        {label && (
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</div>
        )}
        <div className="text-sm dark:text-gray-200 whitespace-pre-wrap">
          {renderDisplay ? renderDisplay() : value || <span className="italic text-gray-400">{emptyLabel}</span>}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setEditing(true)}
          className={`absolute top-0 right-0 ${disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'} transition-opacity text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-400`}
          aria-label="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const trimmed = draft.trim();
  const tooShort = minLength > 0 && trimmed.length > 0 && trimmed.length < minLength;
  const canSave = trimmed !== value.trim() && !submitting && !tooShort;

  return (
    <div>
      {label && (
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</div>
      )}
      <textarea
        rows={rows}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={submitting}
        className="w-full rounded border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 text-sm p-2"
      />
      {error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div>}
      {tooShort && (
        <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Must be at least {minLength} characters.
        </div>
      )}
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={() => {
            setEditing(false);
            setDraft(value);
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
              setEditing(false);
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
  );
}
