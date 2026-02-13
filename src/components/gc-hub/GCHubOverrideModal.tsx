// src/components/gc-hub/GCHubOverrideModal.tsx

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, Title, Text } from '@tremor/react';
import { X } from 'lucide-react';
import { gcHubApi } from '@/lib/api-client';
import { formatCurrency } from '@/lib/gc-hub/formatters';

const MONTH_OPTIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const YEAR_START = 2022;
const YEAR_END = 2035;
const YEAR_OPTIONS = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => String(YEAR_START + i));

/** Parse period label "Jan 2026" or "Q1 2024" into { month, year } for dropdowns. */
function parsePeriodLabel(label: string): { month: string; year: string } {
  if (!label.trim()) {
    const d = new Date();
    return { month: MONTH_OPTIONS[d.getMonth()], year: String(d.getFullYear()) };
  }
  const monthMatch = label.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);
  if (monthMatch) {
    return { month: monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1).toLowerCase(), year: monthMatch[2] };
  }
  const quarterMatch = label.match(/^Q([1-4])\s+(\d{4})$/i);
  if (quarterMatch) {
    const q = parseInt(quarterMatch[1], 10);
    const year = quarterMatch[2];
    const month = MONTH_OPTIONS[(q - 1) * 3]; // Q1=Jan, Q2=Apr, Q3=Jul, Q4=Oct
    return { month, year };
  }
  const d = new Date();
  return { month: MONTH_OPTIONS[d.getMonth()], year: String(d.getFullYear()) };
}

interface GCHubOverrideModalProps {
  /** When null, modal is in "add period" mode. */
  periodId: string | null;
  /** Advisor normalized name (required for add mode). */
  advisorName: string;
  /** Current period label (e.g. "Jan 2026"). Empty for add mode. */
  periodLabel: string;
  currentRevenue: number | null;
  currentCommissions: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function GCHubOverrideModal({
  periodId,
  advisorName,
  periodLabel,
  currentRevenue,
  currentCommissions,
  onClose,
  onSuccess,
}: GCHubOverrideModalProps) {
  const isAddMode = periodId == null || periodId === '';

  const parsed = parsePeriodLabel(periodLabel);
  const [periodMonth, setPeriodMonth] = useState<string>(parsed.month);
  const [periodYear, setPeriodYear] = useState<string>(parsed.year);
  const period = `${periodMonth} ${periodYear}`;

  // Sync month/year when modal opens for a different row or add mode
  useEffect(() => {
    const { month, year } = parsePeriodLabel(periodLabel);
    setPeriodMonth(month);
    setPeriodYear(year);
  }, [periodLabel]);

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
      setError('Reason is required.');
      return;
    }

    const trimmedPeriod = period.trim();

    const revenueNum = revenue.trim() === '' ? undefined : parseFloat(revenue);
    const commissionsNum = commissions.trim() === '' ? undefined : parseFloat(commissions);

    const periodChanged = trimmedPeriod !== periodLabel;
    if (!isAddMode && !periodChanged && revenueNum === undefined && commissionsNum === undefined) {
      setError('At least one of Period, Revenue, or Commissions must be changed.');
      return;
    }
    if (isAddMode && revenueNum === undefined && commissionsNum === undefined) {
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
      if (isAddMode) {
        await gcHubApi.createPeriod({
          advisorName,
          period: trimmedPeriod,
          grossRevenue: revenueNum,
          commissionsPaid: commissionsNum,
          reason: trimmedReason,
        });
      } else {
        await gcHubApi.overrideValue({
          recordId: periodId,
          period: trimmedPeriod !== periodLabel ? trimmedPeriod : undefined,
          grossRevenue: revenueNum,
          commissionsPaid: commissionsNum,
          reason: trimmedReason,
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSubmitting(false);
    }
  }, [periodId, advisorName, periodLabel, periodMonth, periodYear, revenue, commissions, reason, isAddMode, onSuccess, onClose]);

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
              {isAddMode ? 'Add period' : `Override — ${periodLabel}`}
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

          {!isAddMode && (
            <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
              <Text className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Current values (reference)
              </Text>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                Period: {periodLabel} · Revenue: {formatCurrency(currentRevenue)} · Commissions: {formatCurrency(currentCommissions)}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Period <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  id="override-period-month"
                  value={periodMonth}
                  onChange={(e) => setPeriodMonth(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={submitting}
                  aria-label="Month"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select
                  id="override-period-year"
                  value={periodYear}
                  onChange={(e) => setPeriodYear(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={submitting}
                  aria-label="Year"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Stored as &quot;{period}&quot; (Month Year).
              </Text>
            </div>
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
