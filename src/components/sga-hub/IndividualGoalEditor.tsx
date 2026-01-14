// src/components/sga-hub/IndividualGoalEditor.tsx

'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { getCurrentQuarter, getWeekMondayDate, formatDateISO } from '@/lib/utils/sga-hub-helpers';
import { Button, TextInput } from '@tremor/react';

interface IndividualGoalEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  sgaOverview: AdminSGAOverview | null;
  goalType: 'weekly' | 'quarterly';
  weekStartDate?: string;
  quarter?: string;
}

export function IndividualGoalEditor({
  isOpen,
  onClose,
  onSaved,
  sgaOverview,
  goalType,
  weekStartDate: initialWeekStartDate,
  quarter: initialQuarter,
}: IndividualGoalEditorProps) {
  const [weekStartDate, setWeekStartDate] = useState<string>(
    initialWeekStartDate || formatDateISO(getWeekMondayDate(new Date()))
  );
  const [quarter, setQuarter] = useState<string>(initialQuarter || getCurrentQuarter());
  
  // Weekly goal fields
  const [initialCallsGoal, setInitialCallsGoal] = useState<number>(0);
  const [qualificationCallsGoal, setQualificationCallsGoal] = useState<number>(0);
  const [sqoGoal, setSqoGoal] = useState<number>(0);
  
  // Quarterly goal field
  const [quarterlySqoGoal, setQuarterlySqoGoal] = useState<number>(0);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && sgaOverview) {
      if (goalType === 'weekly' && sgaOverview.currentWeekGoal) {
        setInitialCallsGoal(sgaOverview.currentWeekGoal.initialCallsGoal);
        setQualificationCallsGoal(sgaOverview.currentWeekGoal.qualificationCallsGoal);
        setSqoGoal(sgaOverview.currentWeekGoal.sqoGoal);
        setWeekStartDate(sgaOverview.currentWeekGoal.weekStartDate);
      } else if (goalType === 'quarterly' && sgaOverview.currentQuarterGoal) {
        setQuarterlySqoGoal(sgaOverview.currentQuarterGoal.sqoGoal);
        setQuarter(sgaOverview.currentQuarterGoal.quarter);
      } else {
        // Reset to defaults if no existing goal
        setInitialCallsGoal(0);
        setQualificationCallsGoal(0);
        setSqoGoal(0);
        setQuarterlySqoGoal(0);
      }
      setError(null);
    }
  }, [isOpen, sgaOverview, goalType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!sgaOverview) {
        setError('No SGA selected');
        setLoading(false);
        return;
      }

      if (goalType === 'weekly') {
        // Validate weekly goals
        if (initialCallsGoal < 0 || qualificationCallsGoal < 0 || sqoGoal < 0) {
          setError('Goals must be non-negative integers');
          setLoading(false);
          return;
        }

        if (!Number.isInteger(initialCallsGoal) ||
            !Number.isInteger(qualificationCallsGoal) ||
            !Number.isInteger(sqoGoal)) {
          setError('Goals must be whole numbers');
          setLoading(false);
          return;
        }

        const response = await fetch('/api/sga-hub/weekly-goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userEmail: sgaOverview.userEmail,
            weekStartDate,
            initialCallsGoal,
            qualificationCallsGoal,
            sqoGoal,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to save weekly goal');
        }
      } else {
        // Validate quarterly goal
        if (quarterlySqoGoal < 0) {
          setError('Goal must be a non-negative integer');
          setLoading(false);
          return;
        }

        if (!Number.isInteger(quarterlySqoGoal)) {
          setError('Goal must be a whole number');
          setLoading(false);
          return;
        }

        const response = await fetch('/api/sga-hub/quarterly-goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userEmail: sgaOverview.userEmail,
            quarter,
            sqoGoal: quarterlySqoGoal,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to save quarterly goal');
        }
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save goal');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !sgaOverview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Edit {goalType === 'weekly' ? 'Weekly' : 'Quarterly'} Goal - {sgaOverview.userName}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Week/Quarter Selector */}
          {goalType === 'weekly' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Week Start Date (Monday)
              </label>
              <input
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                required
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Quarter
              </label>
              <input
                type="text"
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                placeholder="2025-Q1"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                required
              />
            </div>
          )}

          {/* Goal Values */}
          {goalType === 'weekly' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Initial Calls Goal
                </label>
                <TextInput
                  type="number"
                  min="0"
                  step="1"
                  value={initialCallsGoal.toString()}
                  onChange={(e) => setInitialCallsGoal(parseInt(e.target.value) || 0)}
                  placeholder="0"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Qualification Calls Goal
                </label>
                <TextInput
                  type="number"
                  min="0"
                  step="1"
                  value={qualificationCallsGoal.toString()}
                  onChange={(e) => setQualificationCallsGoal(parseInt(e.target.value) || 0)}
                  placeholder="0"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  SQO Goal
                </label>
                <TextInput
                  type="number"
                  min="0"
                  step="1"
                  value={sqoGoal.toString()}
                  onChange={(e) => setSqoGoal(parseInt(e.target.value) || 0)}
                  placeholder="0"
                  required
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                SQO Goal
              </label>
              <TextInput
                type="number"
                min="0"
                step="1"
                value={quarterlySqoGoal.toString()}
                onChange={(e) => setQuarterlySqoGoal(parseInt(e.target.value) || 0)}
                placeholder="0"
                required
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Goal'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
