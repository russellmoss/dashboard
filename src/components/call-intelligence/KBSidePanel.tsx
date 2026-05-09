'use client';

import { useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';

interface Props {
  kbSource: {
    chunk_id: string;
    doc_id: string;
    drive_url: string;
    doc_title: string;
    owner: string;
    chunk_text: string;
  } | null;
  onClose: () => void;
  onOpenRefinement: () => void;
  disabled?: boolean;
}

/**
 * Modal-style KB chunk inspector. Triggered when a citation pill carrying a
 * `kb_source` is clicked. Renders centered over a backdrop. The underlying
 * component is named "KBSidePanel" for legacy reasons; it now displays as a
 * modal alongside TranscriptModal so the eval panel can use full width.
 */
export function KBSidePanel({ kbSource, onClose, onOpenRefinement, disabled = false }: Props) {
  useEffect(() => {
    if (!kbSource) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [kbSource, onClose]);

  if (!kbSource) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 my-6 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Knowledge base chunk: ${kbSource.doc_title}`}
      >
        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 pr-4">
            <h3 className="text-base font-semibold dark:text-white">{kbSource.doc_title}</h3>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Owner:{' '}
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                {kbSource.owner}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close KB panel"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="text-xs whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900 rounded p-3 font-mono">
            {kbSource.chunk_text || '(chunk text unavailable)'}
          </pre>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <a
            href={kbSource.drive_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:text-gray-200"
          >
            Open in Drive <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={onOpenRefinement}
            disabled={disabled}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Refine this content →
          </button>
        </div>
      </div>
    </div>
  );
}
