'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { WeeklyGoalWithActuals, WeeklyGoalInput } from '@/types/sga-hub';
import { Button, TextInput } from '@tremor/react';
import { dashboardApi } from '@/lib/api-client';

interface WeeklyGoalEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  goal: WeeklyGoalWithActuals | null;
}

export function WeeklyGoalEditor({ isOpen, onClose, onSaved, goal }: WeeklyGoalEditorProps) {
  const [mqlGoalInput, setMqlGoalInput] = useState<string>('');
  const [sqlGoalInput, setSqlGoalInput] = useState<string>('');
  const [sqoGoalInput, setSqoGoalInput] = useState<string>('');
  const [initialCallsGoalInput, setInitialCallsGoalInput] = useState<string>('');
  const [qualificationCallsGoalInput, setQualificationCallsGoalInput] = useState<string>('');
  const [leadsSourcedGoalInput, setLeadsSourcedGoalInput] = useState<string>('');
  const [leadsContactedGoalInput, setLeadsContactedGoalInput] = useState<string>('');
  const [weekStartDate, setWeekStartDate] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (goal && isOpen) {
      setWeekStartDate(goal.weekStartDate);
      setMqlGoalInput(goal.mqlGoal?.toString() || '');
      setSqlGoalInput(goal.sqlGoal?.toString() || '');
      setSqoGoalInput(goal.sqoGoal?.toString() || '');
      setInitialCallsGoalInput(goal.initialCallsGoal?.toString() || '');
      setQualificationCallsGoalInput(goal.qualificationCallsGoal?.toString() || '');
      setLeadsSourcedGoalInput(goal.leadsSourcedGoal?.toString() || '');
      setLeadsContactedGoalInput(goal.leadsContactedGoal?.toString() || '');
    }
    setError(null);
  }, [goal, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const parseGoal = (input: string, fieldName: string): number => {
      const trimmed = input.trim();
      if (trimmed === '') return 0;
      const parsed = parseInt(trimmed, 10);
      if (isNaN(parsed)) throw new Error(`${fieldName} must be a valid number`);
      if (parsed < 0) throw new Error(`${fieldName} must be a non-negative number`);
      return parsed;
    };

    try {
      const formData: WeeklyGoalInput = {
        weekStartDate,
        mqlGoal: parseGoal(mqlGoalInput, 'MQL Goal'),
        sqlGoal: parseGoal(sqlGoalInput, 'SQL Goal'),
        sqoGoal: parseGoal(sqoGoalInput, 'SQO Goal'),
        initialCallsGoal: parseGoal(initialCallsGoalInput, 'Initial Calls Goal'),
        qualificationCallsGoal: parseGoal(qualificationCallsGoalInput, 'Qualification Calls Goal'),
        leadsSourcedGoal: parseGoal(leadsSourcedGoalInput, 'Leads Sourced Goal'),
        leadsContactedGoal: parseGoal(leadsContactedGoalInput, 'Leads Contacted Goal'),
      };

      await dashboardApi.saveWeeklyGoal(formData);

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const numericInputHandler = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setter(value);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {goal ? 'Edit Weekly Goal' : 'Set Weekly Goal'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {goal && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Week: {goal.weekLabel}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Pipeline */}
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pipeline</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">MQL Goal</label>
              <TextInput type="text" inputMode="numeric" value={mqlGoalInput} onChange={numericInputHandler(setMqlGoalInput)} placeholder="0" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SQL Goal</label>
              <TextInput type="text" inputMode="numeric" value={sqlGoalInput} onChange={numericInputHandler(setSqlGoalInput)} placeholder="0" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">SQO Goal</label>
              <TextInput type="text" inputMode="numeric" value={sqoGoalInput} onChange={numericInputHandler(setSqoGoalInput)} placeholder="0" required />
            </div>

            {/* Calls */}
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider pt-2">Calls</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Initial Calls Goal</label>
              <TextInput type="text" inputMode="numeric" value={initialCallsGoalInput} onChange={numericInputHandler(setInitialCallsGoalInput)} placeholder="0" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qualification Calls Goal</label>
              <TextInput type="text" inputMode="numeric" value={qualificationCallsGoalInput} onChange={numericInputHandler(setQualificationCallsGoalInput)} placeholder="0" required />
            </div>

            {/* Lead Activity */}
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider pt-2">Lead Activity</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Leads Sourced Goal</label>
              <TextInput type="text" inputMode="numeric" value={leadsSourcedGoalInput} onChange={numericInputHandler(setLeadsSourcedGoalInput)} placeholder="0" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Leads Contacted Goal</label>
              <TextInput type="text" inputMode="numeric" value={leadsContactedGoalInput} onChange={numericInputHandler(setLeadsContactedGoalInput)} placeholder="0" required />
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
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
