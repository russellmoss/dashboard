// src/components/gc-hub/GCHubOverrideModal.tsx

'use client';

import { useState, useCallback } from 'react';
import { Card, Title, Text } from '@tremor/react';
import { X } from 'lucide-react';
import { gcHubApi } from '@/lib/api-client';
import { formatCurrency } from '@/lib/gc-hub/formatters';

interface GCHubOverrideModalProps {
  periodId: string;
  periodLabel: string;
  currentRevenue: number | null;
  currentCommissions: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function GCHubOverrideModal({
  periodId,
  periodLabel,
  currentRevenue,
  currentCommissions,
  onClose,
  onSuccess,
}: GCHubOverrideModalProps) {
  const [revenue, setRevenue] = useState<string>(
    currentRevenue != null ? String(currentRevenue) : ''
  );
  const [commissions, setCommissions] = useState<string>(
    currentCommissions != null ? String(currentCommissions) : ''
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError('Override reason is required.');
      return;
    }

    const revenueNum = revenue.trim() === '' ? undefined : parseFloat(revenue);
    const commissionsNum = commissions.trim() === '' ? undefined : parseFloat(commissions);

    if (revenueNum === undefined && commissionsNum === undefined) {
      setError('At least one of Revenue or Commissions must be provided.');
      return;
    }
    if (revenue.trim() !== '' && Number.isNaN(revenueNum)) {
      setError('Revenue must be a valid number.');
      return;
    }
    if (commissions.trim() !== '' && Number.isNaN(commissionsNum)) {
      setError('Commissions must be a valid number.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await gcHubApi.overrideValue({
        recordId: periodId,
        grossRevenue: revenueNum,
        commissionsPaid: commissionsNum,
        reason: trimmedReason,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save override.');
    } finally {
      setSubmitting(false);
    }
  }, [periodId, revenue, commissions, reason, onSuccess, onClose]);

  const modalTitleId = 'gc-override-modal-title';

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
    >
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <Card
          className="relative w-full max-w-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <Title id={modalTitleId} className="dark:text-white">
              Override — {periodLabel}
            </Title>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
            <Text className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Current values (reference)
            </Text>
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Revenue: {formatCurrency(currentRevenue)} · Commissions: {formatCurrency(currentCommissions)}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="override-revenue" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Revenue
              </label>
              <input
                id="override-revenue"
                type="number"
                step="0.01"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="override-commissions" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Commissions
              </label>
              <input
                id="override-commissions"
                type="number"
                step="0.01"
                value={commissions}
                onChange={(e) => setCommissions(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="override-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                id="override-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Why is this override needed?"
                required
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                <Text className="text-sm text-red-700 dark:text-red-300">{error}</Text>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-gray-800"
              >
                {submitting ? 'Saving…' : 'Submit'}
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
