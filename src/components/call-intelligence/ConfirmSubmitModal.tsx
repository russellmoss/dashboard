'use client';
import { useEffect, useRef } from 'react';

type Props = { isOpen: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; linkedRecordName: string; isSubmitting?: boolean };

export function ConfirmSubmitModal({ isOpen, onClose, onConfirm, linkedRecordName, isSubmitting }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => confirmRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="confirm-submit-title">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
        <h3 id="confirm-submit-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Push note to Salesforce</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Pushing this note to <span className="font-medium text-gray-900 dark:text-gray-100">{linkedRecordName}</span>. Continue?
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={!!isSubmitting} className="min-h-[44px] px-4 py-2 rounded text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">Cancel</button>
          <button
            ref={confirmRef}
            disabled={!!isSubmitting}
            onClick={() => onConfirm()}
            className="min-h-[44px] px-4 py-2 rounded text-sm font-semibold bg-yellow-500 text-gray-900 dark:text-gray-900 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Pushing…' : 'Push to Salesforce'}
          </button>
        </div>
      </div>
    </div>
  );
}
