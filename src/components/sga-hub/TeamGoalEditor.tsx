// src/components/sga-hub/TeamGoalEditor.tsx

'use client';

import { useState } from 'react';
import { Button } from '@tremor/react';
import { Save, Edit2 } from 'lucide-react';

interface TeamGoalEditorProps {
  year: number;
  quarter: number;
  currentGoal: number | null;
  onSave: (goal: number) => Promise<void>;
  isLoading?: boolean;
}

export function TeamGoalEditor({
  year,
  quarter,
  currentGoal,
  onSave,
  isLoading = false,
}: TeamGoalEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [goalValue, setGoalValue] = useState<string>(currentGoal?.toString() || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const goalNum = parseInt(goalValue, 10);
    if (isNaN(goalNum) || goalNum < 0) {
      alert('Please enter a valid goal (non-negative number)');
      return;
    }

    setSaving(true);
    try {
      await onSave(goalNum);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving team goal:', error);
      alert('Failed to save team goal');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setGoalValue(currentGoal?.toString() || '');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={goalValue}
          onChange={(e) => setGoalValue(e.target.value)}
          className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white w-24"
          min="0"
          autoFocus
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || isLoading}
          icon={Save}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg font-semibold text-gray-900 dark:text-white">
        {currentGoal ?? 'Not set'}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsEditing(true)}
        disabled={isLoading}
        icon={Edit2}
      >
        Edit
      </Button>
    </div>
  );
}
