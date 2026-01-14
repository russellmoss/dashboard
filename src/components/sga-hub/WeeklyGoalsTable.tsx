'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Button } from '@tremor/react';
import { WeeklyGoalWithActuals } from '@/types/sga-hub';
import { Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

type SortColumn = 'week' | 'initialCalls' | 'qualificationCalls' | 'sqos' | null;
type SortDirection = 'asc' | 'desc';

interface WeeklyGoalsTableProps {
  goals: WeeklyGoalWithActuals[];
  onEditGoal: (goal: WeeklyGoalWithActuals) => void;
  isLoading?: boolean;
}

/**
 * Sort goals based on column and direction
 */
function sortGoals(goals: WeeklyGoalWithActuals[], sortColumn: SortColumn, sortDirection: SortDirection): WeeklyGoalWithActuals[] {
  if (!sortColumn) return goals;
  
  return [...goals].sort((a, b) => {
    let comparison = 0;
    
    switch (sortColumn) {
      case 'week':
        comparison = new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime();
        break;
      case 'initialCalls':
        comparison = (a.initialCallsActual - (a.initialCallsGoal || 0)) - (b.initialCallsActual - (b.initialCallsGoal || 0));
        break;
      case 'qualificationCalls':
        comparison = (a.qualificationCallsActual - (a.qualificationCallsGoal || 0)) - (b.qualificationCallsActual - (b.qualificationCallsGoal || 0));
        break;
      case 'sqos':
        comparison = (a.sqoActual - (a.sqoGoal || 0)) - (b.sqoActual - (b.sqoGoal || 0));
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

/**
 * Format difference with color coding
 */
function formatDifference(diff: number | null): { text: string; color: string } {
  if (diff === null) {
    return { text: '—', color: 'text-gray-500' };
  }
  
  if (diff >= 0) {
    return { text: `+${diff}`, color: 'text-green-600 dark:text-green-400' };
  } else {
    return { text: `${diff}`, color: 'text-red-600 dark:text-red-400' };
  }
}

export function WeeklyGoalsTable({ goals, onEditGoal, isLoading = false }: WeeklyGoalsTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('week');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  const sortedGoals = useMemo(() => {
    return sortGoals(goals, sortColumn, sortDirection);
  }, [goals, sortColumn, sortDirection]);
  
  const handleSort = (column: SortColumn) => {
    if (column === null) return;
    
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  const SortableHeader = ({ column, children }: { column: SortColumn; children: React.ReactNode }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';
    
    return (
      <TableHeaderCell 
        className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none text-right`}
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center justify-end gap-1">
          {children}
          <div className="flex flex-col">
            <ChevronUp 
              className={`w-3 h-3 ${showAsc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
            />
            <ChevronDown 
              className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
            />
          </div>
        </div>
      </TableHeaderCell>
    );
  };
  
  if (isLoading) {
    return (
      <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          Loading weekly goals...
        </div>
      </Card>
    );
  }
  
  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Weekly Goals vs Actuals
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Green = ahead of goal, Red = behind goal
        </p>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">
                Week
              </TableHeaderCell>
              <SortableHeader column="initialCalls">
                Initial Calls
              </SortableHeader>
              <SortableHeader column="qualificationCalls">
                Qualification Calls
              </SortableHeader>
              <SortableHeader column="sqos">
                SQOs
              </SortableHeader>
              <TableHeaderCell className="text-right text-gray-600 dark:text-gray-400">
                Actions
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedGoals.map((goal, idx) => {
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              const initialCallsDiff = formatDifference(goal.initialCallsDiff);
              const qualificationCallsDiff = formatDifference(goal.qualificationCallsDiff);
              const sqoDiff = formatDifference(goal.sqoDiff);
              
              return (
                <TableRow
                  key={goal.weekStartDate}
                  className={`${zebraClass} hover:bg-gray-100 dark:hover:bg-gray-700`}
                >
                  <TableCell className="font-medium text-gray-900 dark:text-white">
                    {goal.weekLabel}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-medium">{goal.initialCallsActual}</span>
                      {goal.initialCallsGoal !== null && (
                        <>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            / {goal.initialCallsGoal}
                          </span>
                          <span className={`text-xs font-medium ${initialCallsDiff.color}`}>
                            {initialCallsDiff.text}
                          </span>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-medium">{goal.qualificationCallsActual}</span>
                      {goal.qualificationCallsGoal !== null && (
                        <>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            / {goal.qualificationCallsGoal}
                          </span>
                          <span className={`text-xs font-medium ${qualificationCallsDiff.color}`}>
                            {qualificationCallsDiff.text}
                          </span>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-medium">{goal.sqoActual}</span>
                      {goal.sqoGoal !== null && (
                        <>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            / {goal.sqoGoal}
                          </span>
                          <span className={`text-xs font-medium ${sqoDiff.color}`}>
                            {sqoDiff.text}
                          </span>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {goal.canEdit ? (
                      <Button
                        size="xs"
                        variant="light"
                        icon={Pencil}
                        onClick={() => onEditGoal(goal)}
                      >
                        Edit
                      </Button>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="light"
                          icon={Pencil}
                          disabled
                        >
                          Edit
                        </Button>
                        <InfoTooltip content="You can only edit goals for current or future weeks" />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {sortedGoals.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No weekly goals found for the selected date range.
        </div>
      )}
    </Card>
  );
}
