'use client';

import type { Citation } from '@/types/call-intelligence';

interface Props {
  citation: Citation;
  chunkLookup: Record<string, { owner: string; chunk_text: string }>;
  onScrollToUtterance?: (idx: number) => void;
  onOpenKB?: (
    kbSource: NonNullable<Citation['kb_source']> & { owner: string; chunk_text: string },
  ) => void;
  utteranceTextForTooltip?: string;
  disabled?: boolean;
}

export function CitationPill({
  citation,
  chunkLookup,
  onScrollToUtterance,
  onOpenKB,
  utteranceTextForTooltip,
  disabled = false,
}: Props) {
  const hasUtterance = typeof citation.utterance_index === 'number';
  const hasKb = !!citation.kb_source;

  const handleClick = () => {
    if (disabled) return;
    if (hasUtterance && onScrollToUtterance) onScrollToUtterance(citation.utterance_index!);
    if (hasKb && onOpenKB && citation.kb_source) {
      const aug = chunkLookup[citation.kb_source.chunk_id];
      onOpenKB({
        ...citation.kb_source,
        owner: aug?.owner ?? '—',
        chunk_text: aug?.chunk_text ?? '',
      });
    }
  };

  const truncatedTitle = citation.kb_source?.doc_title
    ? citation.kb_source.doc_title.length > 24
      ? `${citation.kb_source.doc_title.slice(0, 24)}…`
      : citation.kb_source.doc_title
    : '';

  let label: string;
  let baseClasses: string;
  if (hasUtterance && hasKb) {
    label = `💬📄 ${citation.utterance_index} · ${truncatedTitle}`;
    baseClasses = 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
  } else if (hasKb) {
    label = `📄 ${truncatedTitle}`;
    baseClasses = 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
  } else {
    label = `💬 ${citation.utterance_index}`;
    baseClasses = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }

  const tooltip = hasKb
    ? citation.kb_source?.doc_title
    : utteranceTextForTooltip?.slice(0, 80);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={tooltip}
      className={`inline-flex items-center px-2 py-0.5 mx-0.5 rounded-full text-xs font-medium ${baseClasses} ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}`}
    >
      {label}
    </button>
  );
}
