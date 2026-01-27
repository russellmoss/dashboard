// src/app/dashboard/sga-management/SGAManagementContent.tsx

'use client';

import { useState, useEffect } from 'react';
import { Card, Title, Text, Metric, Badge, Button } from '@tremor/react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { AdminSGATable } from '@/components/sga-hub/AdminSGATable';
import { BulkGoalEditor } from '@/components/sga-hub/BulkGoalEditor';
import { IndividualGoalEditor } from '@/components/sga-hub/IndividualGoalEditor';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { getCurrentQuarter, getWeekMondayDate, formatDateISO, getWeekSundayDate, formatDateISO as formatDateISOHelper } from '@/lib/utils/sga-hub-helpers';
import { exportAdminOverviewCSV } from '@/lib/utils/sga-hub-csv-export';
import { Settings, Users, AlertTriangle, Target, Download } from 'lucide-react';
import { MetricDrillDownModal } from '@/components/sga-hub/MetricDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { 
  MetricType, 
  DrillDownRecord, 
  DrillDownContext
} from '@/types/drill-down';
import { dashboardApi } from '@/lib/api-client';
import { formatDate } from '@/lib/utils/format-helpers';

interface SGAManagementContentProps {}

export function SGAManagementContent({}: SGAManagementContentProps) {
  const [loading, setLoading] = useState(true);
  const [sgaOverviews, setSgaOverviews] = useState<AdminSGAOverview[]>([]);
  const [selectedSGAEmail, setSelectedSGAEmail] = useState<string | null>(null);
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [showIndividualEditor, setShowIndividualEditor] = useState(false);
  const [editingSGAEmail, setEditingSGAEmail] = useState<string | null>(null);
  const [editingGoalType, setEditingGoalType] = useState<'weekly' | 'quarterly'>('weekly');
  const [weekStartDate, setWeekStartDate] = useState<string>(
    formatDateISO(getWeekMondayDate(new Date()))
  );
  const [quarter, setQuarter] = useState<string>(getCurrentQuarter());

  // Drill-down modal state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownMetricType, setDrillDownMetricType] = useState<MetricType | null>(null);
  const [drillDownRecords, setDrillDownRecords] = useState<DrillDownRecord[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownError, setDrillDownError] = useState<string | null>(null);
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownContext, setDrillDownContext] = useState<DrillDownContext | null>(null);

  // Record detail modal state
  const [recordDetailOpen, setRecordDetailOpen] = useState(false);
  const [recordDetailId, setRecordDetailId] = useState<string | null>(null);

  // Fetch SGA overview data
  const fetchSGAOverviews = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        weekStartDate,
        quarter,
      });
      
      const response = await fetch(`/api/admin/sga-overview?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch SGA overview');
      
      const data = await response.json();
      setSgaOverviews(data.sgaOverviews || []);
    } catch (error) {
      console.error('Failed to fetch SGA overview:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSGAOverviews();
  }, [weekStartDate, quarter]);

  // Calculate summary stats
  const totalSGAs = sgaOverviews.length;
  const behindPacingCount = sgaOverviews.filter(sga => sga.behindPacing).length;
  const missingWeeklyGoalCount = sgaOverviews.filter(sga => sga.missingWeeklyGoal).length;
  const missingQuarterlyGoalCount = sgaOverviews.filter(sga => sga.missingQuarterlyGoal).length;

  const selectedSGA = selectedSGAEmail
    ? sgaOverviews.find(sga => sga.userEmail === selectedSGAEmail)
    : null;

  const handleRefresh = () => {
    fetchSGAOverviews();
  };

  const handleEditGoal = (sgaEmail: string, goalType: 'weekly' | 'quarterly') => {
    setEditingSGAEmail(sgaEmail);
    setEditingGoalType(goalType);
    setShowIndividualEditor(true);
  };

  const handleGoalSaved = () => {
    setShowIndividualEditor(false);
    setEditingSGAEmail(null);
    fetchSGAOverviews();
  };

  // Helper to calculate week end date (Sunday) from start date (Monday)
  const getWeekEndDate = (startDate: string): string => {
    return formatDateISO(getWeekSundayDate(startDate));
  };

  // Handle metric value click (used by both AdminSGATable and details card)
  const handleMetricClick = async (
    sgaEmail: string,
    sgaName: string,
    metricType: MetricType,
    isGoal: boolean,
    quarterParam?: string // Optional quarter for quarterly metrics
  ) => {
    // Don't open drill-down for goal values (only actuals)
    if (isGoal) return;

    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType(metricType);
    setDrillDownOpen(true);

    const metricLabels: Record<MetricType, string> = {
      'initial-calls': 'Initial Calls',
      'qualification-calls': 'Qualification Calls',
      'sqos': 'SQOs',
    };

    // Determine if this is a quarterly or weekly metric
    const isQuarterly = !!quarterParam && metricType === 'sqos';
    
    let title: string;
    let context: DrillDownContext;

    if (isQuarterly) {
      // Quarterly SQO drill-down
      title = `${metricLabels[metricType]} - ${sgaName} - ${quarterParam}`;
      context = {
        metricType,
        title,
        sgaName,
        quarter: quarterParam,
      };
    } else {
      // Weekly metric drill-down
      const weekEndDate = getWeekEndDate(weekStartDate);
      title = `${metricLabels[metricType]} - ${sgaName} - Week of ${formatDate(weekStartDate)}`;
      context = {
        metricType,
        title,
        sgaName,
        weekStartDate,
        weekEndDate,
      };
    }

    setDrillDownTitle(title);
    setDrillDownContext(context);

    try {
      let records: DrillDownRecord[] = [];

      if (isQuarterly) {
        // Use quarter for SQO drill-down
        const response = await dashboardApi.getSQODrillDown(sgaName, { quarter: quarterParam! }, sgaEmail);
        records = response.records;
      } else {
        // Use week dates for weekly metrics
        const weekEndDate = getWeekEndDate(weekStartDate);
        switch (metricType) {
          case 'initial-calls': {
            const response = await dashboardApi.getInitialCallsDrillDown(sgaName, weekStartDate, weekEndDate, sgaEmail);
            records = response.records;
            break;
          }
          case 'qualification-calls': {
            const response = await dashboardApi.getQualificationCallsDrillDown(sgaName, weekStartDate, weekEndDate, sgaEmail);
            records = response.records;
            break;
          }
          case 'sqos': {
            const response = await dashboardApi.getSQODrillDown(sgaName, { weekStartDate, weekEndDate }, sgaEmail);
            records = response.records;
            break;
          }
        }
      }

      setDrillDownRecords(records);
    } catch (error) {
      console.error('Error fetching drill-down records:', error);
      setDrillDownError('Failed to load records. Please try again.');
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Handle row click in drill-down modal
  const handleRecordClick = (primaryKey: string) => {
    setDrillDownOpen(false);
    setRecordDetailId(primaryKey);
    setRecordDetailOpen(true);
  };

  // Handle back button in record detail modal
  const handleBackToDrillDown = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
    setDrillDownOpen(true);
  };

  // Handle close drill-down modal
  const handleCloseDrillDown = () => {
    setDrillDownOpen(false);
    setDrillDownRecords([]);
    setDrillDownContext(null);
  };

  // Handle close record detail modal
  const handleCloseRecordDetail = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
    setDrillDownContext(null);
  };

  if (loading && sgaOverviews.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <Title>SGA Management</Title>
            <Text>Monitor and manage SGA performance, goals, and alerts</Text>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowBulkEditor(true)} icon={Settings}>
              Bulk Goal Editor
            </Button>
            <Button 
              onClick={() => exportAdminOverviewCSV(sgaOverviews)} 
              icon={Download}
              variant="secondary"
              disabled={sgaOverviews.length === 0}
            >
              Export CSV
            </Button>
            <Button onClick={handleRefresh} variant="secondary">
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Total SGAs</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {totalSGAs}
              </Metric>
            </div>
            <Users className="w-8 h-8 text-blue-500 dark:text-blue-400" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Behind Pacing</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {behindPacingCount}
              </Metric>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-500 dark:text-red-400" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Missing Weekly Goals</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {missingWeeklyGoalCount}
              </Metric>
            </div>
            <Target className="w-8 h-8 text-yellow-500 dark:text-yellow-400" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Missing Quarterly Goals</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {missingQuarterlyGoalCount}
              </Metric>
            </div>
            <Target className="w-8 h-8 text-orange-500 dark:text-orange-400" />
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Text className="text-gray-600 dark:text-gray-400 text-sm mb-2">Week</Text>
            <input
              type="date"
              value={weekStartDate}
              onChange={(e) => setWeekStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex-1">
            <Text className="text-gray-600 dark:text-gray-400 text-sm mb-2">Quarter</Text>
            <input
              type="text"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              placeholder="2025-Q1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex-1">
            <Text className="text-gray-600 dark:text-gray-400 text-sm mb-2">Select SGA</Text>
            <select
              value={selectedSGAEmail || ''}
              onChange={(e) => setSelectedSGAEmail(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">Select an SGA...</option>
              {sgaOverviews.map((sga) => (
                <option key={sga.userEmail} value={sga.userEmail}>
                  {sga.userName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Selected SGA Details - Display above table */}
      {selectedSGA && (
        <Card className="mb-6 p-6">
          <Title className="mb-4">{selectedSGA.userName} - Details</Title>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Week Details */}
            <div>
              <Text className="font-semibold mb-3 text-gray-900 dark:text-white">
                Current Week ({formatDate(weekStartDate)})
              </Text>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-[160px_1fr] gap-2">
                  <Text className="text-gray-600 dark:text-gray-400 font-medium">Goal:</Text>
                  <Text className="text-gray-900 dark:text-white">
                    {selectedSGA.currentWeekGoal ? (
                      <>
                        Initial Calls: <span className="text-lg font-semibold">{selectedSGA.currentWeekGoal.initialCallsGoal}</span>,{' '}
                        Qualification Calls: <span className="text-lg font-semibold">{selectedSGA.currentWeekGoal.qualificationCallsGoal}</span>,{' '}
                        SQO: <span className="text-lg font-semibold">{selectedSGA.currentWeekGoal.sqoGoal}</span>
                      </>
                    ) : (
                      'Not set'
                    )}
                  </Text>
                </div>
                <div className="grid grid-cols-[160px_1fr] gap-2">
                  <Text className="text-gray-600 dark:text-gray-400 font-medium">Actual:</Text>
                  <div className="flex items-center gap-4 flex-wrap">
                    {selectedSGA.currentWeekActual ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMetricClick(selectedSGA.userEmail, selectedSGA.userName, 'initial-calls', false);
                          }}
                          className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                        >
                          Initial Calls: <span className="text-xl font-bold">{selectedSGA.currentWeekActual.initialCalls}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMetricClick(selectedSGA.userEmail, selectedSGA.userName, 'qualification-calls', false);
                          }}
                          className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                        >
                          Qualification Calls: <span className="text-xl font-bold">{selectedSGA.currentWeekActual.qualificationCalls}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMetricClick(selectedSGA.userEmail, selectedSGA.userName, 'sqos', false);
                          }}
                          className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer"
                        >
                          SQO: <span className="text-xl font-bold">{selectedSGA.currentWeekActual.sqos}</span>
                        </button>
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
              <Text className="font-semibold mb-3 text-gray-900 dark:text-white">
                Current Quarter ({quarter})
              </Text>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-[160px_1fr] gap-2">
                  <Text className="text-gray-600 dark:text-gray-400 font-medium">Goal:</Text>
                  <Text className="text-gray-900 dark:text-white">
                    {selectedSGA.currentQuarterGoal
                      ? <span className="text-lg font-semibold">{selectedSGA.currentQuarterGoal.sqoGoal} SQOs</span>
                      : 'Not set'}
                  </Text>
                </div>
                <div className="grid grid-cols-[160px_1fr] gap-2">
                  <Text className="text-gray-600 dark:text-gray-400 font-medium">Actual:</Text>
                  <div className="flex items-center gap-2">
                    {selectedSGA.currentQuarterProgress ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMetricClick(selectedSGA.userEmail, selectedSGA.userName, 'sqos', false, quarter);
                        }}
                        className="text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded transition-colors duration-150 cursor-pointer flex items-center gap-1"
                      >
                        <span className="text-xl font-bold">{Math.round(selectedSGA.currentQuarterProgress.sqoActual)}</span>
                        <span>SQOs</span>
                        <span className="text-gray-500 dark:text-gray-400">({selectedSGA.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)</span>
                      </button>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">No data</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[160px_1fr] gap-2">
                  <Text className="text-gray-600 dark:text-gray-400 font-medium">Pacing:</Text>
                  <Text className="text-gray-900 dark:text-white">
                    {selectedSGA.currentQuarterProgress
                      ? `${selectedSGA.currentQuarterProgress.pacingStatus} (${selectedSGA.currentQuarterProgress.pacingDiff > 0 ? '+' : ''}${selectedSGA.currentQuarterProgress.pacingDiff.toFixed(1)})`
                      : 'N/A'}
                  </Text>
                </div>
              </div>
            </div>

            {/* Alerts */}
            <div className="md:col-span-2">
              <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-2">
                Alerts
              </Text>
              <div className="flex gap-2 flex-wrap">
                {selectedSGA.missingWeeklyGoal && (
                  <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    Missing Weekly Goal
                  </Badge>
                )}
                {selectedSGA.missingQuarterlyGoal && (
                  <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                    Missing Quarterly Goal
                  </Badge>
                )}
                {selectedSGA.behindPacing && (
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    Behind Pacing
                  </Badge>
                )}
                {selectedSGA.closedLostCount > 0 && (
                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {selectedSGA.closedLostCount} Closed Lost
                  </Badge>
                )}
                {!selectedSGA.missingWeeklyGoal &&
                  !selectedSGA.missingQuarterlyGoal &&
                  !selectedSGA.behindPacing && (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      All Good
                    </Badge>
                  )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* SGA Table */}
      <AdminSGATable
        sgaOverviews={sgaOverviews}
        selectedSGAEmail={selectedSGAEmail}
        onSGASelect={setSelectedSGAEmail}
        onEditGoal={handleEditGoal}
        onRefresh={handleRefresh}
        weekStartDate={weekStartDate}
        quarter={quarter}
        onMetricClick={handleMetricClick}
      />

      {/* Bulk Goal Editor Modal */}
      <BulkGoalEditor
        isOpen={showBulkEditor}
        onClose={() => setShowBulkEditor(false)}
        onSaved={() => {
          setShowBulkEditor(false);
          fetchSGAOverviews();
        }}
        sgaOverviews={sgaOverviews}
      />

      {/* Individual Goal Editor Modal */}
      {editingSGAEmail && (
        <IndividualGoalEditor
          isOpen={showIndividualEditor}
          onClose={() => {
            setShowIndividualEditor(false);
            setEditingSGAEmail(null);
          }}
          onSaved={handleGoalSaved}
          sgaOverview={sgaOverviews.find(sga => sga.userEmail === editingSGAEmail) || null}
          goalType={editingGoalType}
          weekStartDate={weekStartDate}
          quarter={quarter}
        />
      )}

      {/* Drill-Down Modal */}
      <MetricDrillDownModal
        isOpen={drillDownOpen}
        onClose={handleCloseDrillDown}
        metricType={drillDownMetricType || 'initial-calls'}
        records={drillDownRecords}
        title={drillDownTitle}
        loading={drillDownLoading}
        error={drillDownError}
        onRecordClick={handleRecordClick}
        canExport={true}
      />

      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={recordDetailOpen}
        onClose={handleCloseRecordDetail}
        recordId={recordDetailId}
        showBackButton={drillDownContext !== null}
        onBack={handleBackToDrillDown}
        backButtonLabel="← Back to records"
      />
    </div>
  );
}
