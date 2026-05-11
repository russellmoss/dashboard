'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { X } from 'lucide-react';
import type { TranscriptCommentRow } from '@/types/call-intelligence';
import {
  TranscriptViewer,
  type TranscriptViewerHandle,
} from './TranscriptViewer';

export interface TranscriptModalHandle {
  scrollToUtterance: (idx: number) => void;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  transcript: unknown;
  evaluationId: string;
  comments: TranscriptCommentRow[];
  currentUserId: string | null;
  isAdmin: boolean;
  canComposeComments: boolean;
  repFullName: string | null;
  advisorName?: string | null;
  onCommentChanged: () => void;
  /** Utterance to scroll to once the modal mounts. */
  initialUtteranceIndex?: number | null;
  /** When true, suppress the internal document keydown listener.
   *  Use when rendered inside a parent that owns a unified Esc handler
   *  (e.g. the Insights modal stack). */
  disableOwnEscHandler?: boolean;
  /** Tailwind class for outer fixed wrapper. Default 'z-50'. Override (e.g. 'z-[70]')
   *  when stacked above other modals. */
  zClassName?: string;
}

export const TranscriptModal = forwardRef<TranscriptModalHandle, Props>(function TranscriptModal(
  {
    isOpen,
    onClose,
    transcript,
    evaluationId,
    comments,
    currentUserId,
    isAdmin,
    canComposeComments,
    repFullName,
    advisorName,
    onCommentChanged,
    initialUtteranceIndex,
    disableOwnEscHandler,
    zClassName,
  },
  ref,
) {
  const viewerRef = useRef<TranscriptViewerHandle>(null);

  useImperativeHandle(ref, () => ({
    scrollToUtterance: (idx) => viewerRef.current?.scrollToUtterance(idx),
  }));

  // When the modal opens (or initial idx changes while open), scroll. Defer one
  // frame so the viewer has mounted utterance refs before we try to scroll.
  useEffect(() => {
    if (!isOpen || initialUtteranceIndex === null || initialUtteranceIndex === undefined) return;
    const idx = initialUtteranceIndex;
    const t = setTimeout(() => viewerRef.current?.scrollToUtterance(idx), 60);
    return () => clearTimeout(t);
  }, [isOpen, initialUtteranceIndex]);

  // Close on Escape — skip when parent owns the unified Esc handler.
  useEffect(() => {
    if (!isOpen || disableOwnEscHandler) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, disableOwnEscHandler]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${zClassName ?? 'z-50'} bg-black/40 flex md:items-center md:justify-center`}
      onClick={onClose}
    >
      <div
        // Roughly matches the right-pane footprint at >= md; full-screen below.
        className="bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden w-full h-full md:h-auto md:max-w-3xl md:mx-4 md:my-6 md:max-h-[90vh] md:rounded-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Call transcript"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Transcript</h2>
          <button
            onClick={onClose}
            aria-label="Close transcript"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <TranscriptViewer
            ref={viewerRef}
            transcript={transcript}
            evaluationId={evaluationId}
            comments={comments}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            canComposeComments={canComposeComments}
            repFullName={repFullName}
            advisorName={advisorName}
            onCommentChanged={onCommentChanged}
          />
        </div>
      </div>
    </div>
  );
});
