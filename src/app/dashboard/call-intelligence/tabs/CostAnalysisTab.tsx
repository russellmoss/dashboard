'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Title, Text, Metric } from '@tremor/react';
import { useTheme } from 'next-themes';
import { Calendar, RefreshCw, AlertCircle } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { CHART_COLORS } from '@/config/theme';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { CostAnalysisResponseT } from '@/lib/sales-coaching-client/schemas';

// ─── Date helpers ───────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthToDateRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: toIsoDate(start), end: toIsoDate(now) };
}

function lastNDaysRange(n: number): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  return { start: toIsoDate(start), end: toIsoDate(now) };
}

// ─── Money formatting ───────────────────────────────────────────────────────

function formatMoney(microUsd: number, opts?: { compact?: boolean }): string {
  const usd = microUsd / 1_000_000;
  if (usd === 0) return '$0.00';
  if (opts?.compact && usd >= 1000) {
    return `$${(usd / 1000).toFixed(1)}k`;
  }
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

// ─── Component ──────────────────────────────────────────────────────────────

type PresetKey = 'mtd' | 'last7' | 'last30' | 'last90' | 'custom';

const PRESETS: { value: PresetKey; label: string }[] = [
  { value: 'mtd', label: 'Month to date' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

export default function CostAnalysisTab() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const initial = monthToDateRange();
  const [preset, setPreset] = useState<PresetKey>('mtd');
  const [startDate, setStartDate] = useState<string>(initial.start);
  const [endDate, setEndDate] = useState<string>(initial.end);
  const [data, setData] = useState<CostAnalysisResponseT | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Preset → resolved range.
  const handlePreset = useCallback((next: PresetKey) => {
    setPreset(next);
    if (next === 'mtd') {
      const r = monthToDateRange();
      setStartDate(r.start);
      setEndDate(r.end);
    } else if (next === 'last7') {
      const r = lastNDaysRange(7);
      setStartDate(r.start);
      setEndDate(r.end);
    } else if (next === 'last30') {
      const r = lastNDaysRange(30);
      setStartDate(r.start);
      setEndDate(r.end);
    } else if (next === 'last90') {
      const r = lastNDaysRange(90);
      setStartDate(r.start);
      setEndDate(r.end);
    }
    // 'custom' keeps the current dates editable.
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      const res = await fetch(`/api/call-intelligence/cost-analysis?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CostAnalysisResponseT;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Chart data — convert micro-USD to USD for the y-axis. Keep day on x-axis.
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.by_day.map((d) => ({
      day: d.day,
      // Display short label like "May 11" on the axis to save space.
      label: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      spend_usd: d.spend_micro_usd / 1_000_000,
      api_calls: d.api_call_count,
    }));
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Date-range controls */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Date range
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            (spend filtered by API-call timestamp; advisor-call count filtered by call_notes.created_at)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={preset}
            onChange={(e) => handlePreset(e.target.value as PresetKey)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPreset('custom'); }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
          />
          <span className="text-gray-500 dark:text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPreset('custom'); }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
          />

          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 text-sm font-medium
                       bg-blue-600 text-white rounded-lg hover:bg-blue-700
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </Card>

      {/* Loading / error */}
      {loading && !data && (
        <Card className="p-12 flex items-center justify-center">
          <LoadingSpinner />
        </Card>
      )}
      {error && (
        <Card className="p-4 border-red-200 dark:border-red-800">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Failed to load cost analysis</span>
          </div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{error}</p>
        </Card>
      )}

      {/* KPI cards */}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <Text>Total spend</Text>
              <Metric>{formatMoney(data.total_spend_micro_usd)}</Metric>
              <Text className="mt-1 text-xs text-gray-500">
                {formatNumber(data.total_api_calls)} AI API calls
              </Text>
            </Card>
            <Card>
              <Text>Spend per advisor call</Text>
              <Metric>{formatMoney(data.spend_per_advisor_call_micro_usd)}</Metric>
              <Text className="mt-1 text-xs text-gray-500">
                {formatNumber(data.advisor_call_count)} advisor calls processed
              </Text>
            </Card>
            <Card>
              <Text>Avg. $/day</Text>
              <Metric>{formatMoney(data.avg_daily_spend_micro_usd)}</Metric>
              <Text className="mt-1 text-xs text-gray-500">
                over {data.date_range.days_in_range} day{data.date_range.days_in_range === 1 ? '' : 's'}
              </Text>
            </Card>
            <Card>
              <Text>Avg. $/month</Text>
              <Metric>{formatMoney(data.avg_monthly_spend_micro_usd)}</Metric>
              <Text className="mt-1 text-xs text-gray-500">
                avg daily &times; 31
              </Text>
            </Card>
          </div>

          {/* Daily spend chart */}
          <Card>
            <Title>Daily AI spend</Title>
            <Text>
              Window: {data.date_range.start} → {data.date_range.end}
            </Text>
            <div className="mt-4" style={{ height: 320 }}>
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-500">
                  No AI API calls recorded in this window yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={isDark ? '#374151' : '#e5e7eb'}
                    />
                    <XAxis
                      dataKey="label"
                      stroke={isDark ? '#9ca3af' : '#6b7280'}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      stroke={isDark ? '#9ca3af' : '#6b7280'}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) =>
                        v >= 1 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`
                      }
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#1f2937' : '#ffffff',
                        border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                        borderRadius: '0.375rem',
                        fontSize: '0.875rem',
                      }}
                      labelStyle={{ color: isDark ? '#f3f4f6' : '#111827' }}
                      formatter={(value: unknown, name: string | undefined) => {
                        if (name === 'spend_usd' && typeof value === 'number') {
                          return [`$${value.toFixed(4)}`, 'Spend'];
                        }
                        return [String(value), name ?? ''];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="spend_usd"
                      stroke={CHART_COLORS.primary}
                      fill="url(#costGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {/* By feature + by model */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <Title>By feature</Title>
              <Text>How spend breaks down by what the AI was doing.</Text>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="pb-2 font-medium">Feature</th>
                      <th className="pb-2 font-medium text-right">Spend</th>
                      <th className="pb-2 font-medium text-right">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_feature.length === 0 ? (
                      <tr><td colSpan={3} className="py-4 text-gray-500 text-center">No data</td></tr>
                    ) : (
                      data.by_feature.map((row) => (
                        <tr key={row.feature} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <td className="py-2 text-gray-900 dark:text-gray-100">{row.feature}</td>
                          <td className="py-2 text-right text-gray-900 dark:text-gray-100">
                            {formatMoney(row.spend_micro_usd)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                            {formatNumber(row.api_call_count)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <Title>By model</Title>
              <Text>Anthropic model used for each API call.</Text>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="pb-2 font-medium">Model</th>
                      <th className="pb-2 font-medium text-right">Spend</th>
                      <th className="pb-2 font-medium text-right">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_model.length === 0 ? (
                      <tr><td colSpan={3} className="py-4 text-gray-500 text-center">No data</td></tr>
                    ) : (
                      data.by_model.map((row) => (
                        <tr key={row.model} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <td className="py-2 text-gray-900 dark:text-gray-100 font-mono text-xs">{row.model}</td>
                          <td className="py-2 text-right text-gray-900 dark:text-gray-100">
                            {formatMoney(row.spend_micro_usd)}
                          </td>
                          <td className="py-2 text-right text-gray-600 dark:text-gray-400">
                            {formatNumber(row.api_call_count)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
