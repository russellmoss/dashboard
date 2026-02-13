// src/components/gc-hub/GCHubAdvisorModal.tsx

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, Title, Text, Metric } from '@tremor/react';
import { X, Loader2, Download, Pencil, Plus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { CHART_COLORS } from '@/config/theme';
import { GC_CHART_COLORS } from '@/config/gc-hub-theme';
import { formatCurrency, formatPeriodLabel } from '@/lib/gc-hub/formatters';
import { gcHubApi } from '@/lib/api-client';
import { GCHubOverrideModal } from '@/components/gc-hub/GCHubOverrideModal';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface GCHubAdvisorModalProps {
  advisorName: string;
  onClose: () => void;
  canEdit?: boolean;
}

export function GCHubAdvisorModal({ advisorName, onClose, canEdit = false }: GCHubAdvisorModalProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overridePeriod, setOverridePeriod] = useState<{
    id: string | null;
    period: string;
    grossRevenue: number | null;
    commissionsPaid: number | null;
  } | null>(null);

  useEffect(() => {
    async function fetchDetail() {
      setLoading(true);
      setError(null);
      try {
        const data = await gcHubApi.getAdvisorDetail(advisorName);
        setDetail(data.advisor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load advisor detail');
      } finally {
        setLoading(false);
      }
    }
    fetchDetail();
  }, [advisorName]);

  // Close on Escape (override-aware: close override modal first, then drilldown)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (overridePeriod) {
          setOverridePeriod(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, overridePeriod]);

  // Chart data from detail periods
  const chartData = detail?.periods
    ?.sort((a: any, b: any) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime())
    .map((p: any) => ({
      period: formatPeriodLabel(p.period),
      Revenue: p.grossRevenue ?? 0,
      Commissions: p.commissionsPaid ?? 0,
      'Amount Earned': p.amountEarned ?? 0,
    })) || [];

  // Aggregate totals
  const totalRevenue = detail?.periods?.reduce((s: number, p: any) => s + (p.grossRevenue ?? 0), 0) ?? 0;
  const totalCommissions = detail?.periods?.reduce((s: number, p: any) => s + (p.commissionsPaid ?? 0), 0) ?? 0;
  const totalEarned = totalRevenue - totalCommissions;

  // ── CSV Export for Period Detail ──
  const handleExportPeriodsCsv = () => {
    if (!detail?.periods?.length) return;

    function escapeCsvCell(value: string | null | undefined): string {
      const s = String(value ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    const headers = [
      'Period',
      'Period Start',
      'Revenue',
      'Commissions',
      'Amount Earned',
      'Source',
    ];

    const rows = detail.periods
      .sort((a: any, b: any) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())
      .map((p: any) => [
        escapeCsvCell(p.period),
        escapeCsvCell(p.periodStart?.split('T')[0]),
        (p.grossRevenue ?? 0).toFixed(2),
        (p.commissionsPaid ?? 0).toFixed(2),
        (p.amountEarned ?? 0).toFixed(2),
        escapeCsvCell(p.dataSource),
      ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Sanitize advisor name for filename
    const safeName = (detail.advisorName || advisorName).replace(/[^a-zA-Z0-9]/g, '-');
    a.download = `gc-hub-${safeName}-periods-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const modalTitleId = 'gc-advisor-modal-title';

  const handleOverrideSuccess = useCallback(() => {
    setOverridePeriod(null);
    gcHubApi.getAdvisorDetail(advisorName).then((data) => setDetail(data.advisor)).catch(() => {});
  }, [advisorName]);

  return (
    <>
      {overridePeriod && (
        <GCHubOverrideModal
          periodId={overridePeriod.id}
          advisorName={detail?.advisorName ?? advisorName}
          periodLabel={overridePeriod.period}
          currentRevenue={overridePeriod.grossRevenue}
          currentCommissions={overridePeriod.commissionsPaid}
          onClose={() => setOverridePeriod(null)}
          onSuccess={handleOverrideSuccess}
        />
      )}
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* Modal */}
      <div className="relative min-h-screen flex items-start justify-center p-4 pt-16">
        <div className="relative w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div>
              <Title id={modalTitleId} className="dark:text-white">{detail?.advisorName || advisorName}</Title>
              <Text className="text-gray-500 dark:text-gray-400">
                {detail?.accountName || '—'} · {detail?.billingFrequency || '—'}
                {detail?.orionRepresentativeId && ` · Orion ID: ${detail.orionRepresentativeId}`}
              </Text>
            </div>
            <button
              onClick={onClose}
              aria-label="Close advisor detail"
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-6">
            {loading && (
              <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" aria-hidden="true" />
                <span className="sr-only">Loading advisor details...</span>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
                <Text className="text-red-700 dark:text-red-300">{error}</Text>
              </div>
            )}

            {!loading && !error && detail && (
              <>
                {/* KPI Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="p-4 dark:bg-gray-900 dark:border-gray-700">
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">Total Revenue</Text>
                    <Metric className="text-xl dark:text-white">{formatCurrency(totalRevenue)}</Metric>
                  </Card>
                  <Card className="p-4 dark:bg-gray-900 dark:border-gray-700">
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">Total Commissions</Text>
                    <Metric className="text-xl dark:text-white">{formatCurrency(totalCommissions)}</Metric>
                  </Card>
                  <Card className="p-4 dark:bg-gray-900 dark:border-gray-700">
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">Amount Earned</Text>
                    <Metric className="text-xl text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(totalEarned)}
                    </Metric>
                  </Card>
                </div>

                {/* Chart */}
                <Card className="dark:bg-gray-900 dark:border-gray-700">
                  <Title className="dark:text-white mb-4">Financial History</Title>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
                          angle={-45}
                          textAnchor="end"
                          height={50}
                          className="dark:[&_text]:fill-gray-400"
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                          tickFormatter={(v) => formatCurrency(v, true)}
                          className="dark:[&_text]:fill-gray-400"
                        />
                        <RechartsTooltip
                          contentStyle={{
                            backgroundColor: isDark ? '#1f2937' : '#fff',
                            border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                            borderRadius: '8px',
                            color: isDark ? '#f9fafb' : '#111827',
                          }}
                          formatter={(value) => [formatCurrency(value as number), '']}
                        />
                        <Legend wrapperStyle={{ color: isDark ? '#d1d5db' : '#374151' }} />
                        <Line type="monotone" dataKey="Revenue" stroke={GC_CHART_COLORS.revenue} strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Commissions" stroke={GC_CHART_COLORS.commissions} strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Amount Earned" stroke={GC_CHART_COLORS.amountEarned} strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Period Table */}
                <Card className="dark:bg-gray-900 dark:border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between p-4">
                    <Title className="dark:text-white">Period Detail</Title>
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setOverridePeriod({ id: null, period: '', grossRevenue: null, commissionsPaid: null })}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-blue-600 dark:border-blue-500 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          title="Add period"
                          aria-label="Add period"
                        >
                          <Plus className="w-4 h-4" />
                          Add period
                        </button>
                      )}
                      <button
                        onClick={handleExportPeriodsCsv}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Export ({detail.periods?.length || 0})
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full" aria-label="Period detail for advisor">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                          <th scope="col" className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 text-left">Period</th>
                          <th scope="col" className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 text-right">Revenue</th>
                          <th scope="col" className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 text-right">Commissions</th>
                          <th scope="col" className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 text-right">Amount Earned</th>
                          <th scope="col" className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 text-left">Source</th>
                          {canEdit && (
                            <th scope="col" className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 text-right">Actions</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.periods
                          .sort((a: any, b: any) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())
                          .map((p: any) => (
                            <tr key={p.id ?? p.period} className="border-b border-gray-100 dark:border-gray-800">
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">
                                <span className="inline-flex items-center gap-1.5">
                                  {formatPeriodLabel(p.period)}
                                  {p.isManuallyOverridden && (
                                    <span
                                      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                                      title={[p.overriddenBy, p.overriddenAt ? new Date(p.overriddenAt).toLocaleString() : null, p.overrideReason].filter(Boolean).join(' — ')}
                                    >
                                      Overridden
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-900 dark:text-white text-right font-mono">{formatCurrency(p.grossRevenue)}</td>
                              <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 text-right font-mono">{formatCurrency(p.commissionsPaid)}</td>
                              <td className="px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400 text-right font-mono">{formatCurrency(p.amountEarned)}</td>
                              <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{p.dataSource}</td>
                              {canEdit && (
                                <td className="px-4 py-2 text-right">
                                  {p.id ? (
                                    <button
                                      type="button"
                                      onClick={() => setOverridePeriod({ id: p.id, period: p.period, grossRevenue: p.grossRevenue ?? null, commissionsPaid: p.commissionsPaid ?? null })}
                                      className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      title="Edit values"
                                      aria-label="Edit values"
                                    >
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                  ) : null}
                                </td>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
