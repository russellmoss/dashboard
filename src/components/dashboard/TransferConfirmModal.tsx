'use client';

import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@tremor/react';

interface TransferConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isTriggering?: boolean;
  cooldownMinutes?: number;
}

export function TransferConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isTriggering = false,
  cooldownMinutes = 0,
}: TransferConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <RefreshCw className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Sync Data from Salesforce</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            disabled={isTriggering}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            This will trigger a data sync from Salesforce to BigQuery. The process typically takes 3-5 minutes.
          </p>
          
          {cooldownMinutes > 0 && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md mb-3">
              <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
              <span className="text-sm text-yellow-800 dark:text-yellow-200">
                Please wait {cooldownMinutes} minute{cooldownMinutes !== 1 ? 's' : ''} before triggering another sync.
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
            <AlertTriangle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">Note:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Data will be synced for Lead, Opportunity, and Task objects</li>
                <li>The dashboard cache will refresh automatically after completion</li>
                <li>You can continue using the dashboard during the sync</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose} disabled={isTriggering}>
            Cancel
          </Button>
          <Button
            icon={RefreshCw}
            color="blue"
            onClick={onConfirm}
            loading={isTriggering}
            disabled={isTriggering || cooldownMinutes > 0}
          >
            Start Sync
          </Button>
        </div>
      </div>
    </div>
  );
}
