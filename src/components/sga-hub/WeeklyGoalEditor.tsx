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
  const [formData, setFormData] = useState<WeeklyGoalInput>({
    weekStartDate: '',
    initialCallsGoal: 0,
    qualificationCallsGoal: 0,
    sqoGoal: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (goal && isOpen) {
      setFormData({
        weekStartDate: goal.weekStartDate,
        initialCallsGoal: goal.initialCallsGoal || 0,
        qualificationCallsGoal: goal.qualificationCallsGoal || 0,
        sqoGoal: goal.sqoGoal || 0,
      });
    }
    setError(null);
  }, [goal, isOpen]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    // Validate non-negative integers
    if (formData.initialCallsGoal < 0 || 
        formData.qualificationCallsGoal < 0 || 
        formData.sqoGoal < 0) {
      setError('Goals must be non-negative integers');
      setLoading(false);
      return;
    }
    
    // Validate integers
    if (!Number.isInteger(formData.initialCallsGoal) ||
        !Number.isInteger(formData.qualificationCallsGoal) ||
        !Number.isInteger(formData.sqoGoal)) {
      setError('Goals must be whole numbers');
      setLoading(false);
      return;
    }
    
    try {
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
                type="number"
                min="0"
                step="1"
                value={formData.initialCallsGoal.toString()}
                onChange={(e) => setFormData({
                  ...formData,
                  initialCallsGoal: parseInt(e.target.value) || 0,
                })}
                placeholder="0"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Qualification Calls Goal
              </label>
              <TextInput
                type="number"
                min="0"
                step="1"
                value={formData.qualificationCallsGoal.toString()}
                onChange={(e) => setFormData({
                  ...formData,
                  qualificationCallsGoal: parseInt(e.target.value) || 0,
                })}
                placeholder="0"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                SQO Goal
              </label>
              <TextInput
                type="number"
                min="0"
                step="1"
                value={formData.sqoGoal.toString()}
                onChange={(e) => setFormData({
                  ...formData,
                  sqoGoal: parseInt(e.target.value) || 0,
                })}
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
