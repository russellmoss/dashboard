'use client';

import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown, Info } from 'lucide-react';
import {
  ActivityBreakdownRow,
  ActivityBreakdownWeekBounds,
  TrailingWeeksOption,
  MetricType,
  METRIC_TYPES,
  METRIC_DISPLAY_NAMES,
} from '@/types/sga-activity';

const TRAILING_WEEKS_OPTIONS: { value: TrailingWeeksOption; label: string }[] = [
  { value: 4, label: '4 Weeks' },
  { value: 6, label: '6 Weeks' },
  { value: 8, label: '8 Weeks' },
  { value: 12, label: '12 Weeks' },
];

interface ActivityBreakdownTableProps {
  data: ActivityBreakdownRow[];
  weekBounds: ActivityBreakdownWeekBounds;
  trailingWeeks: TrailingWeeksOption;
  loading: boolean;
  onCellClick: (sgaName: string, metricType: string | null, weekBucket: string) => void;
  onExportXlsx: () => void;
  exportLoading: boolean;
  onTrailingWeeksChange: (weeks: TrailingWeeksOption) => void;
}

type SortDirection = 'asc' | 'desc' | null;
type SortColumn = { key: string; direction: SortDirection };

function HeaderTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: Math.max(8, rect.left - 240) });
    }
    setOpen(v => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className="inline-flex ml-1 focus:outline-none"
      >
        <Info className={`w-3.5 h-3.5 ${open ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'}`} />
      </button>
      {open && pos && (
        <div
          className="fixed px-3 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-[9999] text-left leading-relaxed"
          style={{ top: pos.top, left: pos.left, width: 288, maxWidth: 288, whiteSpace: 'normal', wordWrap: 'break-word', overflowWrap: 'break-word' }}
        >
          {text}
        </div>
      )}
    </>
  );
}

export default function ActivityBreakdownTable({
  data,
  weekBounds,
  trailingWeeks,
  loading,
  onCellClick,
  onExportXlsx,
  exportLoading,
  onTrailingWeeksChange,
}: ActivityBreakdownTableProps) {
  const [expandedSgas, setExpandedSgas] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [sort, setSort] = useState<SortColumn>({ key: '', direction: null });

  // Build ordered week bucket keys: This Week, Last Week, Wk 1 (most recent trailing), Wk 2, ...
  const weekBucketKeys = useMemo(() => {
    const trailing = weekBounds.trailingWeeks
      .sort((a, b) => a.weekNum - b.weekNum) // ascending: 1 (most recent) to N (oldest)
      .map(tw => `Trailing_${tw.weekNum}`);
    return ['This_Week', 'Last_Week', ...trailing];
  }, [weekBounds]);

  // Trailing-only keys (for average calculation)
  const trailingBucketKeys = useMemo(() => {
    return weekBounds.trailingWeeks.map(tw => `Trailing_${tw.weekNum}`);
  }, [weekBounds]);

  // Week header labels matching new order
  const weekHeaders = useMemo(() => {
    const fmt = (s: string, e: string) => `${s.slice(5)} – ${e.slice(5)}`;
    const trailing = weekBounds.trailingWeeks
      .sort((a, b) => a.weekNum - b.weekNum)
      .map(tw => `Wk ${tw.weekNum} (${fmt(tw.start, tw.end)})`);
    return [
      `This Wk (${fmt(weekBounds.thisWeek.start, weekBounds.thisWeek.end)})`,
      `Last Wk (${fmt(weekBounds.lastWeek.start, weekBounds.lastWeek.end)})`,
      ...trailing,
    ];
  }, [weekBounds]);

  // Get all SGA names from data
  const sgaNames = useMemo(() => {
    return [...new Set(data.map(r => r.sgaName))].sort();
  }, [data]);

  // Pivot data into lookup maps with zero-fill
  const { sgaTotals, sgaMetrics, teamTotals, teamMetrics } = useMemo(() => {
    const lookup = new Map<string, Map<string, Map<string, number>>>();
    for (const row of data) {
      if (!lookup.has(row.sgaName)) lookup.set(row.sgaName, new Map());
      const sgaMap = lookup.get(row.sgaName)!;
      if (!sgaMap.has(row.metricType)) sgaMap.set(row.metricType, new Map());
      sgaMap.get(row.metricType)!.set(row.weekBucket, row.activityCount);
    }

    const getCount = (sga: string, metric: string, week: string): number => {
      return lookup.get(sga)?.get(metric)?.get(week) || 0;
    };

    const sgaTotals = new Map<string, Map<string, number>>();
    for (const sga of sgaNames) {
      const weekMap = new Map<string, number>();
      for (const week of weekBucketKeys) {
        let total = 0;
        for (const metric of METRIC_TYPES) {
          total += getCount(sga, metric, week);
        }
        weekMap.set(week, total);
      }
      sgaTotals.set(sga, weekMap);
    }

    const sgaMetrics = new Map<string, Map<string, Map<string, number>>>();
    for (const sga of sgaNames) {
      const metricMap = new Map<string, Map<string, number>>();
      for (const metric of METRIC_TYPES) {
        const weekMap = new Map<string, number>();
        for (const week of weekBucketKeys) {
          weekMap.set(week, getCount(sga, metric, week));
        }
        metricMap.set(metric, weekMap);
      }
      sgaMetrics.set(sga, metricMap);
    }

    const teamTotals = new Map<string, number>();
    for (const week of weekBucketKeys) {
      let total = 0;
      for (const sga of sgaNames) {
        total += sgaTotals.get(sga)?.get(week) || 0;
      }
      teamTotals.set(week, total);
    }

    const teamMetrics = new Map<string, Map<string, number>>();
    for (const metric of METRIC_TYPES) {
      const weekMap = new Map<string, number>();
      for (const week of weekBucketKeys) {
        let total = 0;
        for (const sga of sgaNames) {
          total += getCount(sga, metric, week);
        }
        weekMap.set(week, total);
      }
      teamMetrics.set(metric, weekMap);
    }

    return { sgaTotals, sgaMetrics, teamTotals, teamMetrics };
  }, [data, sgaNames, weekBucketKeys]);

  // Compute derived columns for a week map
  const computeDerived = (weekMap: Map<string, number>) => {
    const lastWeek = weekMap.get('Last_Week') || 0;
    const trailingSum = trailingBucketKeys.reduce((sum, k) => sum + (weekMap.get(k) || 0), 0);
    const trailingAvg = trailingSum / trailingWeeks;
    const delta = lastWeek - trailingAvg;
    const pctChange = trailingAvg === 0 ? (lastWeek > 0 ? 1 : 0) : (lastWeek - trailingAvg) / trailingAvg;
    const direction = lastWeek > trailingAvg ? 'UP' : lastWeek < trailingAvg ? 'DOWN' : 'FLAT';
    return { trailingAvg, delta, pctChange, direction };
  };

  // Get the sortable value for a given SGA and column key
  const getSortValue = (sga: string, key: string): number | string => {
    if (key === 'sga') return sga;
    const weekMap = sgaTotals.get(sga);
    if (!weekMap) return 0;
    if (weekBucketKeys.includes(key)) return weekMap.get(key) || 0;
    const derived = computeDerived(weekMap);
    if (key === 'trailingAvg') return derived.trailingAvg;
    if (key === 'delta') return derived.delta;
    if (key === 'pctChange') return derived.pctChange;
    if (key === 'direction') return derived.direction === 'UP' ? 2 : derived.direction === 'DOWN' ? 0 : 1;
    return 0;
  };

  // Sorted SGA names
  const sortedSgaNames = useMemo(() => {
    if (!sort.key || !sort.direction) return sgaNames;
    return [...sgaNames].sort((a, b) => {
      const va = getSortValue(a, sort.key);
      const vb = getSortValue(b, sort.key);
      let cmp: number;
      if (typeof va === 'string' && typeof vb === 'string') {
        cmp = va.localeCompare(vb);
      } else {
        cmp = (va as number) - (vb as number);
      }
      return sort.direction === 'desc' ? -cmp : cmp;
    });
  }, [sgaNames, sort, sgaTotals, weekBucketKeys, trailingBucketKeys, trailingWeeks]);

  const handleSort = (key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, direction: 'desc' };
      if (prev.direction === 'desc') return { key, direction: 'asc' };
      return { key: '', direction: null };
    });
  };

  const toggleSga = (sgaName: string) => {
    setExpandedSgas(prev => {
      const next = new Set(prev);
      if (next.has(sgaName)) next.delete(sgaName);
      else next.add(sgaName);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedSgas(new Set());
      setAllExpanded(false);
    } else {
      setExpandedSgas(new Set([...sgaNames, 'TEAM_TOTAL']));
      setAllExpanded(true);
    }
  };

  const directionClass = (dir: string) => {
    if (dir === 'UP') return 'text-green-600 dark:text-green-400 font-semibold';
    if (dir === 'DOWN') return 'text-red-600 dark:text-red-400 font-semibold';
    return 'text-gray-500';
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sort.key !== columnKey) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    if (sort.direction === 'asc') return <ArrowUp className="w-3 h-3 ml-1 text-blue-500" />;
    return <ArrowDown className="w-3 h-3 ml-1 text-blue-500" />;
  };

  const renderCountCell = (
    count: number,
    sgaName: string,
    metricType: string | null,
    weekBucket: string
  ) => {
    const isFocusWeek = weekBucket === 'This_Week' || weekBucket === 'Last_Week';
    return (
      <td
        key={weekBucket}
        className={`px-3 py-2 text-right cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400 tabular-nums ${isFocusWeek ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}
        onClick={(e) => { e.stopPropagation(); onCellClick(sgaName, metricType, weekBucket); }}
      >
        {count.toLocaleString()}
      </td>
    );
  };

  const renderDerivedCells = (derived: ReturnType<typeof computeDerived>) => (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{derived.trailingAvg.toFixed(1)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {derived.delta > 0 ? '+' : ''}{derived.delta.toFixed(1)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {(derived.pctChange * 100).toFixed(1)}%
      </td>
      <td className={`px-3 py-2 text-center ${directionClass(derived.direction)}`}>
        {derived.direction}
      </td>
    </>
  );

  const renderRow = (
    name: string,
    weekMap: Map<string, number>,
    sgaName: string,
    metricType: string | null,
    isParent: boolean,
    isExpanded?: boolean,
    onToggle?: () => void
  ) => {
    const derived = computeDerived(weekMap);
    return (
      <tr
        key={`${sgaName}-${metricType || 'total'}`}
        className={
          isParent
            ? 'font-semibold bg-white dark:bg-gray-950 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-200 dark:border-gray-700'
            : 'bg-gray-50 dark:bg-gray-900 text-sm border-b border-gray-100 dark:border-gray-800'
        }
        onClick={isParent ? onToggle : undefined}
      >
        <td className="px-2 py-2 w-8">
          {isParent && (
            isExpanded
              ? <ChevronDown className="w-4 h-4 text-gray-500" />
              : <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </td>
        <td className={`px-3 py-2 whitespace-nowrap ${isParent ? '' : 'pl-8'}`}>
          {name}
        </td>
        {weekBucketKeys.map(week =>
          renderCountCell(weekMap.get(week) || 0, sgaName, metricType, week)
        )}
        {renderDerivedCells(derived)}
      </tr>
    );
  };

  if (loading && data.length === 0) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  const thClass = "px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          SGA Activity Breakdown
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Trailing</label>
            <select
              value={trailingWeeks}
              onChange={(e) => onTrailingWeeksChange(parseInt(e.target.value) as TrailingWeeksOption)}
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {TRAILING_WEEKS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={toggleAll}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
          >
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
          <button
            onClick={onExportXlsx}
            disabled={exportLoading}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {exportLoading ? 'Exporting...' : 'Export XLSX'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-2 py-3 w-8" />
              <th
                className={`${thClass} text-left`}
                onClick={() => handleSort('sga')}
              >
                <div className="flex items-center">
                  SGA <SortIcon columnKey="sga" />
                </div>
              </th>
              {weekBucketKeys.map((key, i) => {
                const isFocusWeek = key === 'This_Week' || key === 'Last_Week';
                return (
                  <th
                    key={key}
                    className={`${thClass} text-right ${isFocusWeek ? '!font-bold !text-blue-700 dark:!text-blue-300 bg-blue-50 dark:bg-blue-900/30' : ''}`}
                    onClick={() => handleSort(key)}
                  >
                    <div className="flex items-center justify-end">
                      {weekHeaders[i]} <SortIcon columnKey={key} />
                    </div>
                  </th>
                );
              })}
              <th className={`${thClass} text-right`} onClick={() => handleSort('trailingAvg')}>
                <div className="flex items-center justify-end">
                  Trailing Avg <SortIcon columnKey="trailingAvg" />
                </div>
              </th>
              <th className={`${thClass} text-right`} onClick={() => handleSort('delta')}>
                <div className="flex items-center justify-end">
                  Delta <SortIcon columnKey="delta" />
                </div>
              </th>
              <th
                className={`${thClass} text-right`}
                onClick={() => handleSort('pctChange')}
              >
                <div className="flex items-center justify-end">
                  % Change
                  <HeaderTooltip text="Measures the most recent completed week (Last Week, Mon–Sun) against the trailing weekly average. Not based on the current in-progress week." />
                  <SortIcon columnKey="pctChange" />
                </div>
              </th>
              <th
                className={`${thClass} text-center`}
                onClick={() => handleSort('direction')}
              >
                <div className="flex items-center justify-center">
                  Direction
                  <HeaderTooltip text="UP/DOWN/FLAT trend based on the most recent completed week (Last Week, Mon–Sun) vs. the trailing weekly average. Not based on the current in-progress week." />
                  <SortIcon columnKey="direction" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedSgaNames.map(sga => {
              const isExpanded = expandedSgas.has(sga);
              const totalWeekMap = sgaTotals.get(sga)!;
              return (
                <React.Fragment key={sga}>
                  {renderRow(sga, totalWeekMap, sga, null, true, isExpanded, () => toggleSga(sga))}
                  {isExpanded &&
                    METRIC_TYPES.map(metric => {
                      const weekMap = sgaMetrics.get(sga)?.get(metric) || new Map();
                      return renderRow(
                        METRIC_DISPLAY_NAMES[metric],
                        weekMap,
                        sga,
                        metric,
                        false
                      );
                    })}
                </React.Fragment>
              );
            })}
            {/* TEAM TOTAL */}
            {(() => {
              const isExpanded = expandedSgas.has('TEAM_TOTAL');
              return (
                <React.Fragment key="TEAM_TOTAL">
                  <tr
                    className="font-bold bg-gray-100 dark:bg-gray-800 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 border-t-2 border-gray-300 dark:border-gray-600"
                    onClick={() => toggleSga('TEAM_TOTAL')}
                  >
                    <td className="px-2 py-2 w-8">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-gray-500" />
                        : <ChevronRight className="w-4 h-4 text-gray-500" />}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-blue-700 dark:text-blue-400">
                      TEAM TOTAL
                    </td>
                    {weekBucketKeys.map(week => {
                      const isFocusWeek = week === 'This_Week' || week === 'Last_Week';
                      return (
                        <td key={week} className={`px-3 py-2 text-right tabular-nums ${isFocusWeek ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}>
                          {(teamTotals.get(week) || 0).toLocaleString()}
                        </td>
                      );
                    })}
                    {renderDerivedCells(computeDerived(teamTotals))}
                  </tr>
                  {isExpanded &&
                    METRIC_TYPES.map(metric => {
                      const weekMap = teamMetrics.get(metric) || new Map();
                      const derived = computeDerived(weekMap);
                      return (
                        <tr
                          key={`team-${metric}`}
                          className="bg-gray-50 dark:bg-gray-900 text-sm border-b border-gray-100 dark:border-gray-800"
                        >
                          <td className="px-2 py-2 w-8" />
                          <td className="px-3 py-2 whitespace-nowrap pl-8">
                            {METRIC_DISPLAY_NAMES[metric]}
                          </td>
                          {weekBucketKeys.map(week => {
                            const isFocusWeek = week === 'This_Week' || week === 'Last_Week';
                            return (
                              <td key={week} className={`px-3 py-2 text-right tabular-nums ${isFocusWeek ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}>
                                {(weekMap.get(week) || 0).toLocaleString()}
                              </td>
                            );
                          })}
                          {renderDerivedCells(derived)}
                        </tr>
                      );
                    })}
                </React.Fragment>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
