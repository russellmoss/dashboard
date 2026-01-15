// src/components/sga-hub/AdminSGATable.tsx

'use client';

import React, { useState } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button, Text } from '@tremor/react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { ChevronDown, ChevronUp, Pencil, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { ClickableMetricValue } from './ClickableMetricValue';
import { MetricType } from '@/types/drill-down';

interface AdminSGATableProps {
  sgaOverviews: AdminSGAOverview[];
  selectedSGAEmail: string | null;
  onSGASelect: (email: string | null) => void;
  onEditGoal: (sgaEmail: string, goalType: 'weekly' | 'quarterly') => void;
  onRefresh: () => void;
  weekStartDate: string;
  quarter: string;
  // New prop for metric click
  onMetricClick?: (
    sgaEmail: string,
    sgaName: string,
    metricType: MetricType,
    isGoal: boolean,
    quarter?: string // Optional quarter for quarterly metrics
  ) => void;
}

export function AdminSGATable({
  sgaOverviews,
  selectedSGAEmail,
  onSGASelect,
  onEditGoal,
  onRefresh,
  weekStartDate,
  quarter,
  onMetricClick,
}: AdminSGATableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (email: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(email)) {
      newExpanded.delete(email);
    } else {
      newExpanded.add(email);
    }
    setExpandedRows(newExpanded);
  };

  const getWeekStatusBadge = (overview: AdminSGAOverview) => {
    if (!overview.currentWeekGoal) {
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">No Goal</Badge>;
    }
    if (!overview.currentWeekActual) {
      return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">No Data</Badge>;
    }
    
    const goal = overview.currentWeekGoal.sqoGoal;
    const actual = overview.currentWeekActual.sqos;
    
    if (actual >= goal) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">On Track</Badge>;
    } else if (actual >= goal * 0.8) {
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Close</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Behind</Badge>;
    }
  };

  const getQuarterStatusBadge = (overview: AdminSGAOverview) => {
    if (!overview.currentQuarterProgress) {
      return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">No Data</Badge>;
    }
    
    const status = overview.currentQuarterProgress.pacingStatus;
    switch (status) {
      case 'ahead':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Ahead</Badge>;
      case 'on-track':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">On Track</Badge>;
      case 'behind':
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Behind</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">No Goal</Badge>;
    }
  };

  const getAlertsBadges = (overview: AdminSGAOverview) => {
    const badges = [];
    if (overview.missingWeeklyGoal) {
      badges.push(
        <Badge key="weekly" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-xs">
          Missing Weekly
        </Badge>
      );
    }
    if (overview.missingQuarterlyGoal) {
      badges.push(
        <Badge key="quarterly" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs">
          Missing Quarterly
        </Badge>
      );
    }
    if (overview.behindPacing) {
      badges.push(
        <Badge key="pacing" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs">
          Behind Pacing
        </Badge>
      );
    }
    if (badges.length === 0) {
      badges.push(
        <Badge key="good" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
          All Good
        </Badge>
      );
    }
    return badges;
  };

  return (
    <Card>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell className="w-12"></TableHeaderCell>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Email</TableHeaderCell>
            <TableHeaderCell>Week Status</TableHeaderCell>
            <TableHeaderCell>Quarter Status</TableHeaderCell>
            <TableHeaderCell>Alerts</TableHeaderCell>
            <TableHeaderCell>Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sgaOverviews.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                No SGAs found
              </TableCell>
            </TableRow>
          ) : (
            sgaOverviews.map((overview) => {
              const isExpanded = expandedRows.has(overview.userEmail);
              const isSelected = selectedSGAEmail === overview.userEmail;

              return (
                <React.Fragment key={overview.userEmail}>
                  <TableRow
                    className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    onClick={() => toggleRow(overview.userEmail)}
                  >
                    <TableCell>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-gray-900 dark:text-white">
                      {overview.userName}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">
                      {overview.userEmail}
                    </TableCell>
                    <TableCell>{getWeekStatusBadge(overview)}</TableCell>
                    <TableCell>{getQuarterStatusBadge(overview)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">{getAlertsBadges(overview)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          icon={Pencil}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditGoal(overview.userEmail, 'weekly');
                          }}
                        >
                          Edit Weekly
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          icon={Pencil}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditGoal(overview.userEmail, 'quarterly');
                          }}
                        >
                          Edit Quarterly
                        </Button>
                        <a
                          href={`/dashboard/sga-hub?userEmail=${encodeURIComponent(overview.userEmail)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button size="xs" variant="secondary" icon={ExternalLink}>
                            View Hub
                          </Button>
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-gray-50 dark:bg-gray-900">
                      <TableCell colSpan={7} className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Week Details */}
                          <div>
                            <Text className="font-semibold mb-3 text-gray-900 dark:text-white">Current Week ({formatDate(weekStartDate)})</Text>
                            <div className="space-y-2 text-sm">
                              <div className="grid grid-cols-[160px_1fr] gap-2">
                                <Text className="text-gray-600 dark:text-gray-400 font-medium">Goal:</Text>
                                <Text className="text-gray-900 dark:text-white">
                                  {overview.currentWeekGoal ? (
                                    <>
                                      Initial Calls: <span className="text-lg font-semibold">{overview.currentWeekGoal.initialCallsGoal}</span>,{' '}
                                      Qualification Calls: <span className="text-lg font-semibold">{overview.currentWeekGoal.qualificationCallsGoal}</span>,{' '}
                                      SQO: <span className="text-lg font-semibold">{overview.currentWeekGoal.sqoGoal}</span>
                                    </>
                                  ) : (
                                    'Not set'
                                  )}
                                </Text>
                              </div>
                              <div className="grid grid-cols-[160px_1fr] gap-2">
                                <Text className="text-gray-600 dark:text-gray-400 font-medium">Actual:</Text>
                                <div className="flex items-center gap-4 flex-wrap">
                                  {overview.currentWeekActual ? (
                                    <>
                                      {onMetricClick ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onMetricClick(overview.userEmail, overview.userName, 'initial-calls', false);
                                          }}
                                          className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                                        >
                                          Initial Calls: <span className="text-xl font-bold">{overview.currentWeekActual.initialCalls}</span>
                                        </button>
                                      ) : (
                                        <span className="text-sm text-gray-600 dark:text-gray-400">
                                          Initial Calls: <span className="text-lg font-semibold">{overview.currentWeekActual.initialCalls}</span>
                                        </span>
                                      )}
                                      {onMetricClick ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onMetricClick(overview.userEmail, overview.userName, 'qualification-calls', false);
                                          }}
                                          className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                                        >
                                          Qualification Calls: <span className="text-xl font-bold">{overview.currentWeekActual.qualificationCalls}</span>
                                        </button>
                                      ) : (
                                        <span className="text-sm text-gray-600 dark:text-gray-400">
                                          Qualification Calls: <span className="text-lg font-semibold">{overview.currentWeekActual.qualificationCalls}</span>
                                        </span>
                                      )}
                                      {onMetricClick ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onMetricClick(overview.userEmail, overview.userName, 'sqos', false);
                                          }}
                                          className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                                        >
                                          SQO: <span className="text-xl font-bold">{overview.currentWeekActual.sqos}</span>
                                        </button>
                                      ) : (
                                        <span className="text-sm text-gray-600 dark:text-gray-400">
                                          SQO: <span className="text-lg font-semibold">{overview.currentWeekActual.sqos}</span>
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-gray-500 dark:text-gray-400">No data</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Quarter Details */}
                          <div>
                            <Text className="font-semibold mb-3 text-gray-900 dark:text-white">Current Quarter ({quarter})</Text>
                            <div className="space-y-2 text-sm">
                              <div className="grid grid-cols-[160px_1fr] gap-2">
                                <Text className="text-gray-600 dark:text-gray-400 font-medium">Goal:</Text>
                                <Text className="text-gray-900 dark:text-white">
                                  {overview.currentQuarterGoal
                                    ? <span className="text-lg font-semibold">{overview.currentQuarterGoal.sqoGoal} SQOs</span>
                                    : 'Not set'}
                                </Text>
                              </div>
                              <div className="grid grid-cols-[160px_1fr] gap-2">
                                <Text className="text-gray-600 dark:text-gray-400 font-medium">Actual:</Text>
                                <div className="flex items-center gap-2">
                                  {overview.currentQuarterProgress ? (
                                    onMetricClick ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onMetricClick(overview.userEmail, overview.userName, 'sqos', false, quarter);
                                        }}
                                        className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer flex items-center gap-1"
                                      >
                                        <span className="text-xl font-bold">{Math.round(overview.currentQuarterProgress.sqoActual)}</span>
                                        <span>SQOs</span>
                                        <span className="text-gray-500 dark:text-gray-400">({overview.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)</span>
                                      </button>
                                    ) : (
                                      <>
                                        <span className="text-xl font-bold text-gray-900 dark:text-white">
                                          {Math.round(overview.currentQuarterProgress.sqoActual)}
                                        </span>
                                        <span className="text-sm text-gray-500 dark:text-gray-400">
                                          SQOs ({overview.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)
                                        </span>
                                      </>
                                    )
                                  ) : (
                                    <span className="text-gray-500 dark:text-gray-400">No data</span>
                                  )}
                                </div>
                              </div>
                              <div className="grid grid-cols-[160px_1fr] gap-2">
                                <Text className="text-gray-600 dark:text-gray-400 font-medium">Pacing:</Text>
                                <Text className="text-gray-900 dark:text-white">
                                  {overview.currentQuarterProgress
                                    ? `${overview.currentQuarterProgress.pacingStatus} (${overview.currentQuarterProgress.pacingDiff > 0 ? '+' : ''}${overview.currentQuarterProgress.pacingDiff.toFixed(1)})`
                                    : 'N/A'}
                                </Text>
                              </div>
                            </div>
                          </div>

                          {/* Additional Info */}
                          <div className="md:col-span-2">
                            <Text className="font-semibold mb-2 text-gray-900 dark:text-white">Additional Info</Text>
                            <div className="flex gap-6 text-sm">
                              <div className="flex gap-2">
                                <Text className="text-gray-600 dark:text-gray-400 font-medium">Closed Lost:</Text>
                                <Text className="text-gray-900 dark:text-white">{overview.closedLostCount}</Text>
                              </div>
                              <div className="flex gap-2">
                                <Text className="text-gray-600 dark:text-gray-400 font-medium">Status:</Text>
                                <Badge
                                  className={
                                    overview.isActive
                                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                                  }
                                >
                                  {overview.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
