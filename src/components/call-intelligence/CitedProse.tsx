'use client';

import type { Citation } from '@/types/call-intelligence';
import { CitationPill } from './CitationPill';

interface CitedProseProps {
  text: string;
  citations: Citation[];
  chunkLookup: Record<string, { owner: string; chunk_text: string }>;
  onScrollToUtterance?: (idx: number) => void;
  onOpenKB?: (
    kbSource: NonNullable<Citation['kb_source']> & { owner: string; chunk_text: string },
  ) => void;
  className?: string;
}

// Renders prose followed by a trailing wrapped row of citation pills.
// Replaces the two private CitedText / CitedTextLine impls in
// InsightsEvalDetailModal.tsx and EvalDetailClient.tsx so they don't drift.
export function CitedProse({
  text,
  citations,
  chunkLookup,
  onScrollToUtterance,
  onOpenKB,
  className,
}: CitedProseProps) {
  if (!text) return null;
  return (
    <div className={className ?? 'text-sm text-gray-800 dark:text-gray-200'}>
      <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
      {citations.length > 0 && (
        <div className="mt-1.5 inline-flex flex-wrap items-center gap-1">
          {citations.map((c, i) => (
            <CitationPill
              key={`${c.utterance_index ?? c.kb_source?.chunk_id ?? i}-${i}`}
              citation={c}
              chunkLookup={chunkLookup}
              onScrollToUtterance={onScrollToUtterance}
              onOpenKB={onOpenKB}
            />
          ))}
        </div>
      )}
    </div>
  );
}
