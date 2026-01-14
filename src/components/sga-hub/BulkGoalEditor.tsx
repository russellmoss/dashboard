// src/components/sga-hub/BulkGoalEditor.tsx

'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { getCurrentQuarter, getWeekMondayDate, formatDateISO } from '@/lib/utils/sga-hub-helpers';
import { Button } from '@tremor/react';

interface BulkGoalEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  sgaOverviews: AdminSGAOverview[];
}

type GoalType = 'weekly' | 'quarterly';

export function BulkGoalEditor({
  isOpen,
  onClose,
  onSaved,
  sgaOverviews,
}: BulkGoalEditorProps) {
  const [goalType, setGoalType] = useState<GoalType>('weekly');
  const [weekStartDate, setWeekStartDate] = useState<string>(
    formatDateISO(getWeekMondayDate(new Date()))
  );
  const [quarter, setQuarter] = useState<string>(getCurrentQuarter());
  const [selectedSGAs, setSelectedSGAs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Weekly goal fields
  const [initialCallsGoal, setInitialCallsGoal] = useState<number>(0);
  const [qualificationCallsGoal, setQualificationCallsGoal] = useState<number>(0);
  const [sqoGoal, setSqoGoal] = useState<number>(0);

  // Quarterly goal field
  const [quarterlySqoGoal, setQuarterlySqoGoal] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      // Reset form when modal opens
      setSelectedSGAs(new Set());
      setInitialCallsGoal(0);
      setQualificationCallsGoal(0);
      setSqoGoal(0);
      setQuarterlySqoGoal(0);
      setError(null);
    }
  }, [isOpen]);

  const toggleSGA = (email: string) => {
    const newSet = new Set(selectedSGAs);
    if (newSet.has(email)) {
      newSet.delete(email);
    } else {
      newSet.add(email);
    }
    setSelectedSGAs(newSet);
  };

  const selectAll = () => {
    setSelectedSGAs(new Set(sgaOverviews.map(sga => sga.userEmail)));
  };

  const deselectAll = () => {
    setSelectedSGAs(new Set());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (selectedSGAs.size === 0) {
        setError('Please select at least one SGA');
        setLoading(false);
        return;
      }

      // Create goals for all selected SGAs
      const promises = Array.from(selectedSGAs).map(async (email) => {
        if (goalType === 'weekly') {
          const response = await fetch('/api/sga-hub/weekly-goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: email,
              weekStartDate,
              initialCallsGoal,
              qualificationCallsGoal,
              sqoGoal,
            }),
          });
          if (!response.ok) throw new Error(`Failed to save goal for ${email}`);
        } else {
          const response = await fetch('/api/sga-hub/quarterly-goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: email,
              quarter,
              sqoGoal: quarterlySqoGoal,
            }),
          });
          if (!response.ok) throw new Error(`Failed to save goal for ${email}`);
        }
      });

      await Promise.all(promises);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save goals');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Bulk Goal Editor</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Goal Type Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Goal Type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="weekly"
                  checked={goalType === 'weekly'}
                  onChange={(e) => setGoalType(e.target.value as GoalType)}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">Weekly</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="quarterly"
                  checked={goalType === 'quarterly'}
                  onChange={(e) => setGoalType(e.target.value as GoalType)}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">Quarterly</span>
              </label>
            </div>
          </div>

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
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Initial Calls Goal
                </label>
                <input
                  type="number"
                  min="0"
                  value={initialCallsGoal}
                  onChange={(e) => setInitialCallsGoal(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Qualification Calls Goal
                </label>
                <input
                  type="number"
                  min="0"
                  value={qualificationCallsGoal}
                  onChange={(e) => setQualificationCallsGoal(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  SQO Goal
                </label>
                <input
                  type="number"
                  min="0"
                  value={sqoGoal}
                  onChange={(e) => setSqoGoal(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  required
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                SQO Goal
              </label>
              <input
                type="number"
                min="0"
                value={quarterlySqoGoal}
                onChange={(e) => setQuarterlySqoGoal(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                required
              />
            </div>
          )}

          {/* SGA Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Select SGAs ({selectedSGAs.size} selected)
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div className="border border-gray-300 dark:border-gray-600 rounded-md p-4 max-h-60 overflow-y-auto">
              {sgaOverviews.map((sga) => (
                <label key={sga.userEmail} className="flex items-center mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSGAs.has(sga.userEmail)}
                    onChange={() => toggleSGA(sga.userEmail)}
                    className="mr-2"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{sga.userName}</span>
                </label>
              ))}
            </div>
          </div>

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
              {loading ? 'Saving...' : `Save Goals (${selectedSGAs.size} SGAs)`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
