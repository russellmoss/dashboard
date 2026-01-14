// src/components/sga-hub/AdminSGATable.tsx

'use client';

import React, { useState } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button, Text } from '@tremor/react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { ChevronDown, ChevronUp, Pencil, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';

interface AdminSGATableProps {
  sgaOverviews: AdminSGAOverview[];
  selectedSGAEmail: string | null;
  onSGASelect: (email: string | null) => void;
  onRefresh: () => void;
  weekStartDate: string;
  quarter: string;
}

export function AdminSGATable({
  sgaOverviews,
  selectedSGAEmail,
  onSGASelect,
  onRefresh,
  weekStartDate,
  quarter,
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
                            onSGASelect(overview.userEmail);
                          }}
                        >
                          Edit
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Week Details */}
                          <div>
                            <Text className="font-semibold mb-2">Current Week ({formatDate(weekStartDate)})</Text>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                                <Text>
                                  {overview.currentWeekGoal
                                    ? `IC: ${overview.currentWeekGoal.initialCallsGoal}, QC: ${overview.currentWeekGoal.qualificationCallsGoal}, SQO: ${overview.currentWeekGoal.sqoGoal}`
                                    : 'Not set'}
                                </Text>
                              </div>
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                                <Text>
                                  {overview.currentWeekActual
                                    ? `IC: ${overview.currentWeekActual.initialCalls}, QC: ${overview.currentWeekActual.qualificationCalls}, SQO: ${overview.currentWeekActual.sqos}`
                                    : 'No data'}
                                </Text>
                              </div>
                            </div>
                          </div>

                          {/* Quarter Details */}
                          <div>
                            <Text className="font-semibold mb-2">Current Quarter ({quarter})</Text>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                                <Text>
                                  {overview.currentQuarterGoal
                                    ? `${overview.currentQuarterGoal.sqoGoal} SQOs`
                                    : 'Not set'}
                                </Text>
                              </div>
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                                <Text>
                                  {overview.currentQuarterProgress
                                    ? `${overview.currentQuarterProgress.sqoActual} SQOs (${overview.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)`
                                    : 'No data'}
                                </Text>
                              </div>
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Pacing:</Text>
                                <Text>
                                  {overview.currentQuarterProgress
                                    ? `${overview.currentQuarterProgress.pacingStatus} (${overview.currentQuarterProgress.pacingDiff > 0 ? '+' : ''}${overview.currentQuarterProgress.pacingDiff.toFixed(1)})`
                                    : 'N/A'}
                                </Text>
                              </div>
                            </div>
                          </div>

                          {/* Additional Info */}
                          <div className="md:col-span-2">
                            <Text className="font-semibold mb-2">Additional Info</Text>
                            <div className="flex gap-4 text-sm">
                              <div>
                                <Text className="text-gray-600 dark:text-gray-400">Closed Lost:</Text>
                                <Text className="ml-2">{overview.closedLostCount}</Text>
                              </div>
                              <div>
                                <Text className="text-gray-600 dark:text-gray-400">Status:</Text>
                                <Badge
                                  className={`ml-2 ${
                                    overview.isActive
                                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                                  }`}
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
