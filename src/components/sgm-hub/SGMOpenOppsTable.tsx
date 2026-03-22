'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@tremor/react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SGMOpenOpp } from '@/types/sgm-hub';

type SortColumn = 'advisorName' | 'daysOpen' | 'currentStage' | 'daysInStage' | 'aum' | 'estimatedArr';
type SortDirection = 'asc' | 'desc';

interface SGMOpenOppsTableProps {
  opps: SGMOpenOpp[];
  loading: boolean;
  onAdvisorClick: (opportunityId: string) => void;
}

function getAgingCellClass(status: 'green' | 'yellow' | 'orange' | 'red' | null): string {
  switch (status) {
    case 'green': return 'text-green-600 dark:text-green-400';
    case 'yellow': return 'text-yellow-600 dark:text-yellow-400';
    case 'orange': return 'text-orange-600 dark:text-orange-400';
    case 'red': return 'text-red-600 dark:text-red-400 font-semibold';
    default: return 'text-gray-400';
  }
}

export function SGMOpenOppsTable({ opps, loading, onAdvisorClick }: SGMOpenOppsTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('daysOpen');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'advisorName' || column === 'currentStage' ? 'asc' : 'desc');
    }
  };

  const sortedOpps = useMemo(() => {
    return [...opps].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortColumn) {
        case 'advisorName': return dir * a.advisorName.localeCompare(b.advisorName);
        case 'currentStage': return dir * a.currentStage.localeCompare(b.currentStage);
        case 'daysOpen': return dir * (a.daysOpen - b.daysOpen);
        case 'daysInStage': return dir * ((a.daysInStage ?? -1) - (b.daysInStage ?? -1));
        case 'aum': return dir * (a.aum - b.aum);
        case 'estimatedArr': return dir * ((a.estimatedArr ?? -1) - (b.estimatedArr ?? -1));
        default: return 0;
      }
    });
  }, [opps, sortColumn, sortDirection]);

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

  if (loading) {
    return (
      <Card className="mt-6">
        <div className="animate-pulse space-y-3 py-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Open Opportunities ({opps.length})
      </h3>
      {opps.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 py-4 text-center">No open opportunities</p>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <SortableHeader column="advisorName">Advisor Name</SortableHeader>
              <SortableHeader column="daysOpen">Days Open</SortableHeader>
              <SortableHeader column="currentStage">Stage</SortableHeader>
              <SortableHeader column="daysInStage">Days in Stage</SortableHeader>
              <SortableHeader column="aum">AUM</SortableHeader>
              <SortableHeader column="estimatedArr">Est. ARR</SortableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedOpps.map((opp) => (
              <TableRow key={opp.opportunityId}>
                <TableCell>
                  <button
                    onClick={() => onAdvisorClick(opp.primaryKey)}
                    className="text-blue-600 dark:text-blue-400 hover:underline text-left"
                  >
                    {opp.advisorName}
                  </button>
                </TableCell>
                <TableCell className={getAgingCellClass(opp.daysOpenStatus)}>
                  {opp.daysOpen}
                </TableCell>
                <TableCell>{opp.currentStage}</TableCell>
                <TableCell className={getAgingCellClass(opp.daysInStageStatus)}>
                  {opp.daysInStage !== null ? opp.daysInStage : '—'}
                </TableCell>
                <TableCell>{opp.aumFormatted}</TableCell>
                <TableCell>{opp.estimatedArrFormatted}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
