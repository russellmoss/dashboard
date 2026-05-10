'use client';
import { useEffect, useRef, useState } from 'react';

type Props = { isOpen: boolean; onClose: () => void; onConfirm: (reason: string) => void | Promise<void>; isSubmitting?: boolean };

export function RejectReasonModal({ isOpen, onClose, onConfirm, isSubmitting }: Props) {
  const [reason, setReason] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    const t = setTimeout(() => textareaRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="reject-modal-title">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
        <h3 id="reject-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Reject note</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          This note will be removed from the review queue. Add a brief reason — visible to coaches and admins.
        </p>
        <textarea
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Reason for rejection…"
          className="mt-3 w-full text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded p-2 focus:outline-none focus:border-blue-500"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="min-h-[44px] px-4 py-2 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
          <button
            disabled={!reason.trim() || !!isSubmitting}
            onClick={() => onConfirm(reason.trim())}
            className="min-h-[44px] px-4 py-2 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
