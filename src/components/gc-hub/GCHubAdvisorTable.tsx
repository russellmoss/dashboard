// src/components/gc-hub/GCHubAdvisorTable.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, Title, Text } from '@tremor/react';
import { Search, ChevronUp, ChevronDown, Download } from 'lucide-react';
import { formatCurrency } from '@/lib/gc-hub/formatters';
import { GC_CHART_COLORS } from '@/config/gc-hub-theme';
import { GC_ROWS_PER_PAGE } from '@/config/gc-hub-theme';
import type { SortDir } from '@/types/gc-hub';

interface AdvisorTableRow {
  advisorName: string;
  accountName: string | null;
  period: string;
  periodStart: string;
  grossRevenue: number | null;
  commissionsPaid: number | null;
  amountEarned: number | null;
  billingFrequency: string | null;
  dataSource: string;
  isManuallyOverridden: boolean;
}

interface GCHubAdvisorTableProps {
  records: AdvisorTableRow[];
  isLoading?: boolean;
  isAnonymized?: boolean;
  isAdmin?: boolean;
  isCapitalPartner?: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  onAdvisorClick?: (advisorName: string) => void;
  onExportCsv?: () => void;
}

// ── SortableTh ──
function SortableTh({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  alignRight = false,
}: {
  label: string;
  sortKey: string;
  currentKey: string | null;
  currentDir: SortDir;
  onSort: (key: string) => void;
  alignRight?: boolean;
}) {
  const isActive = currentKey === sortKey;
  const ariaSort = isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : undefined;

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-4 py-3 text-sm font-medium uppercase tracking-wider
        text-gray-600 dark:text-gray-400
        ${alignRight ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex items-center gap-1.5 w-full cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 -m-1 p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${alignRight ? 'justify-end' : ''}`}
        aria-label={`Sort by ${label}${isActive ? (currentDir === 'asc' ? ', sorted ascending' : ', sorted descending') : ''}`}
      >
        {label}
        <span className="flex flex-col" aria-hidden="true">
          <ChevronUp
            className={`w-3.5 h-3.5 ${isActive && currentDir === 'asc' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`}
          />
          <ChevronDown
            className={`w-3.5 h-3.5 -mt-1 ${isActive && currentDir === 'desc' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`}
          />
        </span>
      </button>
    </th>
  );
}

// ── Sparkline SVG ──
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-gray-400 text-base" aria-label="No trend data">—</span>;

  const width = 100;
  const height = 32;
  const padding = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((v - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  });

  const trend = values[values.length - 1] - values[0];
  const color = trend > 0 ? GC_CHART_COLORS.sparklineUp : trend < 0 ? GC_CHART_COLORS.sparklineDown : GC_CHART_COLORS.sparklineFlat;
  const trendLabel = trend > 0 ? 'Upward trend' : trend < 0 ? 'Downward trend' : 'Flat trend';

  return (
    <svg width={width} height={height} className="inline-block" role="img" aria-label={trendLabel}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GCHubAdvisorTable({
  records,
  isLoading = false,
  isAnonymized = false,
  isAdmin = false,
  isCapitalPartner = false,
  search,
  onSearchChange,
  onAdvisorClick,
  onExportCsv,
}: GCHubAdvisorTableProps) {
  // Allow drill-down for both admin and capital partner
  const canDrillDown = isAdmin || isCapitalPartner;
  const [sortKey, setSortKey] = useState<string | null>('advisorName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  // ── Pivot: Group records by advisor, compute per-advisor aggregates ──
  const advisorAggregates = useMemo(() => {
    const grouped: Record<string, AdvisorTableRow[]> = {};
    for (const r of records) {
      if (!grouped[r.advisorName]) grouped[r.advisorName] = [];
      grouped[r.advisorName].push(r);
    }

    return Object.entries(grouped).map(([name, rows]) => {
      const sorted = [...rows].sort(
        (a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime()
      );
      const totalRevenue = rows.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
      const totalCommissions = rows.reduce((s, r) => s + (r.commissionsPaid ?? 0), 0);
      const totalEarned = rows.reduce((s, r) => s + (r.amountEarned ?? 0), 0);
      const sparklineValues = sorted.map((r) => r.grossRevenue ?? 0);
      const latestPeriod = sorted[sorted.length - 1]?.period ?? '';
      const accountName = rows[0]?.accountName ?? null;
      const billingFrequency = rows[0]?.billingFrequency ?? null;
      const hasOverride = rows.some((r) => r.isManuallyOverridden);

      return {
        advisorName: name,
        accountName,
        billingFrequency,
        totalRevenue,
        totalCommissions,
        totalEarned,
        periodCount: rows.length,
        latestPeriod,
        sparklineValues,
        hasOverride,
      };
    });
  }, [records]);

  // ── Sort ──
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'advisorName' || key === 'accountName' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const sorted = useMemo(() => {
    if (!sortKey) return advisorAggregates;
    return [...advisorAggregates].sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal) : aVal - bVal;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [advisorAggregates, sortKey, sortDir]);

  // ── Paginate ──
  const totalPages = Math.ceil(sorted.length / GC_ROWS_PER_PAGE);
  const paginated = sorted.slice((page - 1) * GC_ROWS_PER_PAGE, page * GC_ROWS_PER_PAGE);

  if (isLoading) {
    return (
      <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </Card>
    );
  }

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
      {/* ── Header: Title + Search + Export ── */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Title className="dark:text-white">Advisor Breakdown</Title>
            <Text className="text-gray-500 dark:text-gray-400 text-base">
              {sorted.length} advisors — {records.length} total records
              {isAnonymized && ' (anonymized)'}
            </Text>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" aria-hidden="true" />
              <input
                type="search"
                id="gc-advisor-search"
                aria-label="Search advisors"
                placeholder="Search advisors..."
                value={search}
                onChange={(e) => {
                  onSearchChange(e.target.value);
                  setPage(1);
                }}
                className="pl-10 pr-4 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 outline-none w-64"
              />
            </div>
            {/* Export */}
            {onExportCsv && (
              <button
                onClick={onExportCsv}
                disabled={sorted.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                <Download className="w-5 h-5" />
                Export ({sorted.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="w-full" aria-label="Advisor breakdown table">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <SortableTh label="Advisor" sortKey="advisorName" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Team" sortKey="accountName" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableTh label="Total Revenue" sortKey="totalRevenue" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} alignRight />
              <SortableTh label="Total Commissions" sortKey="totalCommissions" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} alignRight />
              <SortableTh label="Amount Earned" sortKey="totalEarned" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} alignRight />
              <th scope="col" className="px-4 py-3 text-sm font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400 text-center">
                Trend
              </th>
              <SortableTh label="Periods" sortKey="periodCount" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} alignRight />
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-base text-gray-500 dark:text-gray-400">
                  No advisors found
                </td>
              </tr>
            ) : (
              paginated.map((advisor) => (
                <tr
                  key={advisor.advisorName}
                  onClick={() => canDrillDown && onAdvisorClick?.(advisor.advisorName)}
                  className={`border-b border-gray-100 dark:border-gray-800 transition-colors ${
                    canDrillDown
                      ? 'hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer'
                      : ''
                  }`}
                >
                  <td className="px-4 py-4 text-base text-gray-900 dark:text-white font-medium whitespace-nowrap">
                    {advisor.advisorName}
                    {advisor.hasOverride && (
                      <span className="ml-2 text-sm text-amber-500" title="Has manual override">
                        ✎
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-base text-gray-600 dark:text-gray-300">
                    {advisor.accountName || '—'}
                  </td>
                  <td className="px-4 py-4 text-base text-gray-900 dark:text-white text-right font-mono">
                    {formatCurrency(advisor.totalRevenue)}
                  </td>
                  <td className="px-4 py-4 text-base text-gray-600 dark:text-gray-300 text-right font-mono">
                    {formatCurrency(advisor.totalCommissions)}
                  </td>
                  <td className="px-4 py-4 text-base text-emerald-700 dark:text-emerald-400 text-right font-mono font-medium">
                    {formatCurrency(advisor.totalEarned)}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <Sparkline values={advisor.sparklineValues} />
                  </td>
                  <td className="px-4 py-4 text-base text-gray-600 dark:text-gray-300 text-right">
                    {advisor.periodCount}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <Text className="text-base text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages} ({sorted.length} advisors)
          </Text>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-1.5 text-base border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-1.5 text-base border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
