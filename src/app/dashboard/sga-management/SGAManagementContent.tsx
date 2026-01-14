// src/app/dashboard/sga-management/SGAManagementContent.tsx

'use client';

import { useState, useEffect } from 'react';
import { Card, Title, Text, Metric, Badge, Button } from '@tremor/react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { AdminSGATable } from '@/components/sga-hub/AdminSGATable';
import { BulkGoalEditor } from '@/components/sga-hub/BulkGoalEditor';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { getCurrentQuarter, getWeekMondayDate, formatDateISO } from '@/lib/utils/sga-hub-helpers';
import { Settings, Users, AlertTriangle, Target } from 'lucide-react';

interface SGAManagementContentProps {}

export function SGAManagementContent({}: SGAManagementContentProps) {
  const [loading, setLoading] = useState(true);
  const [sgaOverviews, setSgaOverviews] = useState<AdminSGAOverview[]>([]);
  const [selectedSGAEmail, setSelectedSGAEmail] = useState<string | null>(null);
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [weekStartDate, setWeekStartDate] = useState<string>(
    formatDateISO(getWeekMondayDate(new Date()))
  );
  const [quarter, setQuarter] = useState<string>(getCurrentQuarter());

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
      
      // Auto-select first SGA if none selected
      if (!selectedSGAEmail && data.sgaOverviews?.length > 0) {
        setSelectedSGAEmail(data.sgaOverviews[0].userEmail);
      }
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

      {/* SGA Table */}
      <AdminSGATable
        sgaOverviews={sgaOverviews}
        selectedSGAEmail={selectedSGAEmail}
        onSGASelect={setSelectedSGAEmail}
        onRefresh={handleRefresh}
        weekStartDate={weekStartDate}
        quarter={quarter}
      />

      {/* Selected SGA Details */}
      {selectedSGA && (
        <Card className="mt-6 p-6">
          <Title className="mb-4">{selectedSGA.userName} - Details</Title>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Week */}
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-2">
                Current Week
              </Text>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentWeekGoal
                      ? `IC: ${selectedSGA.currentWeekGoal.initialCallsGoal}, QC: ${selectedSGA.currentWeekGoal.qualificationCallsGoal}, SQO: ${selectedSGA.currentWeekGoal.sqoGoal}`
                      : 'Not set'}
                  </Text>
                </div>
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentWeekActual
                      ? `IC: ${selectedSGA.currentWeekActual.initialCalls}, QC: ${selectedSGA.currentWeekActual.qualificationCalls}, SQO: ${selectedSGA.currentWeekActual.sqos}`
                      : 'No data'}
                  </Text>
                </div>
              </div>
            </div>

            {/* Current Quarter */}
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-2">
                Current Quarter
              </Text>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentQuarterGoal
                      ? `${selectedSGA.currentQuarterGoal.sqoGoal} SQOs`
                      : 'Not set'}
                  </Text>
                </div>
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentQuarterProgress
                      ? `${selectedSGA.currentQuarterProgress.sqoActual} SQOs (${selectedSGA.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)`
                      : 'No data'}
                  </Text>
                </div>
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Pacing:</Text>
                  <Badge
                    className={
                      selectedSGA.currentQuarterProgress?.pacingStatus === 'ahead'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : selectedSGA.currentQuarterProgress?.pacingStatus === 'behind'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        : selectedSGA.currentQuarterProgress?.pacingStatus === 'on-track'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                    }
                  >
                    {selectedSGA.currentQuarterProgress?.pacingStatus || 'No goal'}
                  </Badge>
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
    </div>
  );
}
