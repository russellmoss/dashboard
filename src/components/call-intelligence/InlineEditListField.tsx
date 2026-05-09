'use client';

import { Pencil, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Citation } from '@/types/call-intelligence';

export interface ListItem {
  text: string;
  citations?: Citation[];
  expected_source?: string;
}

interface Props {
  label?: string;
  items: ListItem[];
  disabled: boolean;
  /** Parent applies the patch with the FULL updated array (not a diff). */
  onSave: (newItems: ListItem[]) => Promise<{ ok: boolean; error?: string }>;
  /** Optional: render each item's read-only display with custom node (e.g., text + citation pills). */
  renderItemDisplay?: (item: ListItem, idx: number) => React.ReactNode;
  /** When true, items support an `expected_source` field (knowledge_gaps). */
  withExpectedSource?: boolean;
}

export function InlineEditListField({
  label,
  items,
  disabled,
  onSave,
  renderItemDisplay,
  withExpectedSource = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ListItem[]>(items);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(items);
  }, [items]);

  if (!editing) {
    return (
      <div className="group relative">
        {label && (
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</div>
        )}
        <ul className="space-y-1.5 text-sm dark:text-gray-200">
          {items.length === 0 ? (
            <li className="italic text-gray-400">—</li>
          ) : (
            items.map((it, i) => (
              <li key={i} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 flex-shrink-0" />
                <div className="flex-1">
                  {renderItemDisplay ? renderItemDisplay(it, i) : <span>{it.text}</span>}
                  {withExpectedSource && it.expected_source && (
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                      (expected: {it.expected_source})
                    </span>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setEditing(true)}
          className={`absolute top-0 right-0 ${disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'} transition-opacity text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-400`}
          aria-label="Edit list"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(items);
  const canSave = isDirty && !submitting;

  return (
    <div>
      {label && (
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">{label}</div>
      )}
      <ul className="space-y-2">
        {draft.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <textarea
              rows={2}
              value={it.text}
              onChange={(e) => {
                const next = [...draft];
                // Preserve citations + expected_source on edit (canonical edits don't touch citations).
                next[i] = { ...next[i], text: e.target.value };
                setDraft(next);
              }}
              disabled={submitting}
              className="flex-1 rounded border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 text-sm p-2"
            />
            <button
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}
              disabled={submitting}
              aria-label={`Remove item ${i + 1}`}
              className="mt-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
            >
              <X className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setDraft([...draft, { text: '' }])}
        disabled={submitting}
        className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> Add item
      </button>
      {error && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => {
            setEditing(false);
            setDraft(items);
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
            // Drop empty text rows on save (UX nicety).
            const clean = draft.filter((d) => d.text.trim().length > 0);
            setSubmitting(true);
            setError(null);
            const result = await onSave(clean);
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
