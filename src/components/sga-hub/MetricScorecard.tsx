'use client';

import { useState, useRef, useEffect } from 'react';
import { Card } from '@tremor/react';
import { Pencil, Check, X } from 'lucide-react';
import { ClickableMetricValue } from '@/components/sga-hub/ClickableMetricValue';

interface MetricScorecardProps {
  label: string;
  goalValue: number | null;
  actualValue: number;
  secondaryActualValue?: number;
  isEditable: boolean;
  onGoalChange?: (value: number) => void;
  onActualClick?: () => void;
  showToggle?: boolean;
  toggleLabel?: [string, string];
  toggleValue?: 'all' | 'self-sourced';
  onToggleChange?: (value: 'all' | 'self-sourced') => void;
  hideActual?: boolean;
  accentColor?: string;
}

export function MetricScorecard({
  label,
  goalValue,
  actualValue,
  secondaryActualValue,
  isEditable,
  onGoalChange,
  onActualClick,
  showToggle = false,
  toggleLabel = ['All', 'Self-Sourced'],
  toggleValue = 'all',
  onToggleChange,
  hideActual = false,
  accentColor,
}: MetricScorecardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayActual = showToggle && toggleValue === 'self-sourced' && secondaryActualValue !== undefined
    ? secondaryActualValue
    : actualValue;

  const diff = goalValue !== null && goalValue !== undefined && !hideActual
    ? displayActual - goalValue
    : null;

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(String(goalValue ?? 0));
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft('');
  };

  const submitGoal = () => {
    const num = draft === '' ? 0 : parseInt(draft, 10);
    if (onGoalChange) {
      onGoalChange(isNaN(num) ? 0 : num);
    }
    setEditing(false);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      submitGoal();
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  };

  return (
    <Card
      className="dark:bg-gray-800 dark:border-gray-700 px-3 py-2.5 text-center border-l-4"
      style={{ borderLeftColor: accentColor || 'transparent' }}
    >
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</h4>
      {showToggle && onToggleChange ? (
        <div className="flex justify-center mb-1">
          <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 text-[10px] overflow-hidden">
            <button
              onClick={() => onToggleChange('all')}
              className={`px-1.5 py-0.5 transition-colors ${
                toggleValue === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              {toggleLabel[0]}
            </button>
            <button
              onClick={() => onToggleChange('self-sourced')}
              className={`px-1.5 py-0.5 transition-colors ${
                toggleValue === 'self-sourced'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              {toggleLabel[1]}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-1 h-[18px]" />
      )}

      {/* Goal */}
      <div className="mb-1">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Goal</span>
        {isEditable && onGoalChange ? (
          editing ? (
            <div className="flex items-center justify-center gap-1">
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={handleKeyDown}
                className="w-16 px-1.5 py-0.5 text-lg font-bold text-center rounded border border-blue-400 dark:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={submitGoal}
                className="p-1 rounded text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
                title="Save goal"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={cancelEditing}
                className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center justify-center gap-1">
              <div className="w-14 text-center text-lg font-bold text-gray-900 dark:text-white">
                {goalValue !== null && goalValue !== undefined ? goalValue : (
                  <span className="text-sm text-gray-400 dark:text-gray-500">&mdash;</span>
                )}
              </div>
              <button
                onClick={startEditing}
                className="p-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400"
                title="Edit goal"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        ) : (
          <div className="inline-flex items-center justify-center gap-1">
            <div className="w-14 text-center text-lg font-bold text-gray-900 dark:text-white">
              {goalValue !== null && goalValue !== undefined ? goalValue : (
                <span className="text-sm text-gray-400 dark:text-gray-500">&mdash;</span>
              )}
            </div>
            {/* Invisible spacer to match editable card width */}
            <div className="w-[18px]" />
          </div>
        )}
      </div>

      {/* Actual */}
      <div className="mb-0.5">
        {!hideActual ? (
          <>
            <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Actual</span>
            <div>
              {onActualClick ? (
                <ClickableMetricValue value={displayActual} onClick={onActualClick} />
              ) : (
                <span className="text-lg font-bold text-gray-900 dark:text-white">{displayActual}</span>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="text-[10px] invisible uppercase tracking-wider">Actual</span>
            <div>
              <span className="text-lg font-bold invisible">0</span>
            </div>
          </>
        )}
      </div>

      {/* Diff */}
      <div className="mt-0.5">
        {diff !== null ? (
          <span
            className={`text-xs font-medium ${
              diff >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {diff >= 0 ? `+${diff}` : diff}
          </span>
        ) : (
          <span className="text-xs font-medium invisible">+0</span>
        )}
      </div>
    </Card>
  );
}
