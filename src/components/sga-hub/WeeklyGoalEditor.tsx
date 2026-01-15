'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { WeeklyGoalWithActuals, WeeklyGoalInput } from '@/types/sga-hub';
import { Button, TextInput } from '@tremor/react';

interface WeeklyGoalEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  goal: WeeklyGoalWithActuals | null;
}

export function WeeklyGoalEditor({ isOpen, onClose, onSaved, goal }: WeeklyGoalEditorProps) {
  // Use string values for inputs to allow free text entry
  const [initialCallsGoalInput, setInitialCallsGoalInput] = useState<string>('');
  const [qualificationCallsGoalInput, setQualificationCallsGoalInput] = useState<string>('');
  const [sqoGoalInput, setSqoGoalInput] = useState<string>('');
  const [weekStartDate, setWeekStartDate] = useState<string>('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (goal && isOpen) {
      setWeekStartDate(goal.weekStartDate);
      setInitialCallsGoalInput(goal.initialCallsGoal?.toString() || '');
      setQualificationCallsGoalInput(goal.qualificationCallsGoal?.toString() || '');
      setSqoGoalInput(goal.sqoGoal?.toString() || '');
    }
    setError(null);
  }, [goal, isOpen]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    // Parse and validate inputs
    const parseGoal = (input: string, fieldName: string): number => {
      const trimmed = input.trim();
      if (trimmed === '') {
        return 0;
      }
      const parsed = parseInt(trimmed, 10);
      if (isNaN(parsed)) {
        throw new Error(`${fieldName} must be a valid number`);
      }
      if (parsed < 0) {
        throw new Error(`${fieldName} must be a non-negative number`);
      }
      if (!Number.isInteger(parsed)) {
        throw new Error(`${fieldName} must be a whole number`);
      }
      return parsed;
    };
    
    try {
      const initialCallsGoal = parseGoal(initialCallsGoalInput, 'Initial Calls Goal');
      const qualificationCallsGoal = parseGoal(qualificationCallsGoalInput, 'Qualification Calls Goal');
      const sqoGoal = parseGoal(sqoGoalInput, 'SQO Goal');
      
      const formData: WeeklyGoalInput = {
        weekStartDate,
        initialCallsGoal,
        qualificationCallsGoal,
        sqoGoal,
      };
      
      const response = await fetch('/api/sga-hub/weekly-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save goal');
      }
      
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
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
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Initial Calls Goal
              </label>
              <TextInput
                type="text"
                inputMode="numeric"
                value={initialCallsGoalInput}
                onChange={(e) => {
                  // Allow only digits and empty string
                  const value = e.target.value;
                  if (value === '' || /^\d+$/.test(value)) {
                    setInitialCallsGoalInput(value);
                  }
                }}
                placeholder="0"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Qualification Calls Goal
              </label>
              <TextInput
                type="text"
                inputMode="numeric"
                value={qualificationCallsGoalInput}
                onChange={(e) => {
                  // Allow only digits and empty string
                  const value = e.target.value;
                  if (value === '' || /^\d+$/.test(value)) {
                    setQualificationCallsGoalInput(value);
                  }
                }}
                placeholder="0"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                SQO Goal
              </label>
              <TextInput
                type="text"
                inputMode="numeric"
                value={sqoGoalInput}
                onChange={(e) => {
                  // Allow only digits and empty string
                  const value = e.target.value;
                  if (value === '' || /^\d+$/.test(value)) {
                    setSqoGoalInput(value);
                  }
                }}
                placeholder="0"
                required
              />
            </div>
          </div>
          
          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Goal'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
