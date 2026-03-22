'use client';

import { useState, useMemo } from 'react';
import { Card, Badge, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@tremor/react';
import { TrendingUp, TrendingDown, Minus, ChevronUp, ChevronDown } from 'lucide-react';
import {
  SGMTeamProgress, SGMAdminBreakdown, SGMQuotaEntry,
  SGMQuotaFilters as SGMQuotaFiltersType, SGMPacingStatus,
} from '@/types/sgm-hub';
import { FilterOptions } from '@/types/filters';
import { formatArrCompact } from '@/lib/utils/sgm-hub-helpers';
import { SGMQuotaFilters } from './SGMQuotaFilters';
import { SGMQuotaTable } from './SGMQuotaTable';

interface SGMOption {
  value: string;
  label: string;
  isActive: boolean;
}

interface SGMAdminQuotaViewProps {
  teamProgress: SGMTeamProgress | null;
  breakdown: SGMAdminBreakdown[];
  quotas: SGMQuotaEntry[];
  loading: boolean;
  breakdownLoading: boolean;
  quotasLoading: boolean;
  selectedQuarter: string;
  onQuarterChange: (quarter: string) => void;
  onFilterApply: (filters: SGMQuotaFiltersType) => void;
  onOpenOppsClick: (sgmName: string) => void;
  onOpenOpps90Click: (sgmName: string) => void;
  onQuotaSave: (data: { userEmail: string; quarter: string; arrGoal: number }) => Promise<void>;
  sgmOptions: SGMOption[];
  sgmOptionsLoading: boolean;
  filterOptions: FilterOptions | null;
}

function getPacingBadgeConfig(status: SGMPacingStatus) {
  switch (status) {
    case 'ahead':
      return {
        className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        label: 'Ahead',
      };
    case 'on-track':
      return {
        className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        icon: <Minus className="w-3.5 h-3.5" />,
        label: 'On Track',
      };
    case 'behind':
      return {
        className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        icon: <TrendingDown className="w-3.5 h-3.5" />,
        label: 'Behind',
      };
    default:
      return {
        className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
        icon: <Minus className="w-3.5 h-3.5" />,
        label: 'No Goal',
      };
  }
}

type SortColumn = 'sgmName' | 'openOpps' | 'openOpps90Plus' | 'openAum' | 'openArr' | 'actualArr' | 'progressPercent';
type SortDirection = 'asc' | 'desc';

function getProgressBarColor(percent: number | null): string {
  if (percent === null) return 'bg-gray-400';
  if (percent >= 100) return 'bg-green-500 dark:bg-green-600';
  if (percent >= 75) return 'bg-blue-500 dark:bg-blue-600';
  if (percent >= 50) return 'bg-yellow-500 dark:bg-yellow-600';
  return 'bg-red-500 dark:bg-red-600';
}

export function SGMAdminQuotaView({
  teamProgress,
  breakdown,
  quotas,
  loading,
  breakdownLoading,
  quotasLoading,
  selectedQuarter,
  onQuarterChange,
  onFilterApply,
  onOpenOppsClick,
  onOpenOpps90Click,
  onQuotaSave,
  sgmOptions,
  sgmOptionsLoading,
  filterOptions,
}: SGMAdminQuotaViewProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('sgmName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [quotaYear, setQuotaYear] = useState(new Date().getFullYear());

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'sgmName' ? 'asc' : 'desc');
    }
  };

  const sortedBreakdown = useMemo(() => {
    return [...breakdown].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortColumn) {
        case 'sgmName': return dir * a.sgmName.localeCompare(b.sgmName);
        case 'openOpps': return dir * (a.openOpps - b.openOpps);
        case 'openOpps90Plus': return dir * (a.openOpps90Plus - b.openOpps90Plus);
        case 'openAum': return dir * (a.openAum - b.openAum);
        case 'openArr': return dir * (a.openArr - b.openArr);
        case 'actualArr': return dir * (a.actualArr - b.actualArr);
        case 'progressPercent': return dir * ((a.progressPercent ?? -1) - (b.progressPercent ?? -1));
        default: return 0;
      }
    });
  }, [breakdown, sortColumn, sortDirection]);

  const SortableHeader = ({ column, children }: { column: SortColumn; children: React.ReactNode }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';
    return (
      <TableHeaderCell
        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none text-gray-600 dark:text-gray-400"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-1">
          {children}
          <div className="flex flex-col">
            <ChevronUp className={`w-3 h-3 ${showAsc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} />
            <ChevronDown className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} />
          </div>
        </div>
      </TableHeaderCell>
    );
  };

  const tp = teamProgress;
  const pacingBadge = tp ? getPacingBadgeConfig(tp.pacingStatus) : null;
  const progressBarPercent = tp?.progressPercent !== null && tp?.progressPercent !== undefined
    ? Math.min(tp.progressPercent, 100)
    : 0;

  return (
    <div>
      {/* Filters */}
      <SGMQuotaFilters
        selectedFilters={{ quarter: selectedQuarter }}
        channelOptions={filterOptions?.channels || []}
        sourceOptions={filterOptions?.sources || []}
        sgmOptions={sgmOptions}
        sgmOptionsLoading={sgmOptionsLoading}
        onApply={(filters) => {
          if (filters.quarter !== selectedQuarter) {
            onQuarterChange(filters.quarter);
          }
          onFilterApply(filters);
        }}
      />

      {/* Team Progress Card */}
      {loading || !tp ? (
        <Card className="animate-pulse">
          <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
          <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Team Progress — {tp.quarterLabel}
            </h3>
            {pacingBadge && (
              <Badge className={pacingBadge.className}>
                <span className="flex items-center gap-1">
                  {pacingBadge.icon}
                  {pacingBadge.label}
                </span>
              </Badge>
            )}
          </div>

          <div className="mb-4">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatArrCompact(tp.totalActualArr)}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
              of {formatArrCompact(tp.totalQuotaArr)}
            </span>
          </div>

          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden mb-4">
            <div
              className={`h-full transition-all duration-500 ${getProgressBarColor(tp.progressPercent)}`}
              style={{ width: `${progressBarPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Expected ARR</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatArrCompact(tp.expectedArr)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Pacing Diff</p>
              <p className={`text-lg font-semibold ${
                tp.pacingDiff >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {tp.pacingDiff >= 0 ? '+' : ''}{formatArrCompact(tp.pacingDiff)}
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Days Elapsed</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{tp.daysElapsed} / {tp.daysInQuarter}</p>
            </div>
          </div>
        </Card>
      )}

      {/* SGM Breakdown Table */}
      <Card className="mt-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Individual SGM Breakdown
        </h3>
        {breakdownLoading ? (
          <div className="animate-pulse space-y-3 py-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
            ))}
          </div>
        ) : breakdown.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 py-4 text-center">No data</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <SortableHeader column="sgmName">SGM</SortableHeader>
                <SortableHeader column="openOpps">Open Opps</SortableHeader>
                <SortableHeader column="openOpps90Plus">90+ Days</SortableHeader>
                <SortableHeader column="openAum">Open AUM</SortableHeader>
                <SortableHeader column="openArr">Open ARR</SortableHeader>
                <SortableHeader column="actualArr">Joined ARR</SortableHeader>
                <SortableHeader column="progressPercent">Progress %</SortableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedBreakdown.map((row) => {
                const badge = getPacingBadgeConfig(row.pacingStatus);
                return (
                  <TableRow key={row.userEmail}>
                    <TableCell className="font-medium text-gray-900 dark:text-white">
                      {row.sgmName}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => onOpenOppsClick(row.sgmName)}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {row.openOpps}
                      </button>
                    </TableCell>
                    <TableCell>
                      {row.openOpps90Plus > 0 ? (
                        <button
                          onClick={() => onOpenOpps90Click(row.sgmName)}
                          className="text-red-600 dark:text-red-400 hover:underline font-semibold"
                        >
                          {row.openOpps90Plus}
                        </button>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell>{row.openAumFormatted}</TableCell>
                    <TableCell>{row.openArrFormatted}</TableCell>
                    <TableCell>{formatArrCompact(row.actualArr)}</TableCell>
                    <TableCell>
                      <Badge className={badge.className}>
                        <span className="flex items-center gap-1">
                          {badge.icon}
                          {row.progressPercent !== null ? `${row.progressPercent}%` : badge.label}
                        </span>
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Editable Quota Table */}
      <SGMQuotaTable
        quotas={quotas}
        loading={quotasLoading}
        onSave={onQuotaSave}
        selectedYear={quotaYear}
        onYearChange={setQuotaYear}
      />
    </div>
  );
}
