'use client';

import { ViewMode } from '@/types/dashboard';

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/**
 * Toggle component for switching between Focused View and Full Funnel View
 * 
 * @param value - Current view mode ('focused' | 'fullFunnel')
 * @param onChange - Callback function when view mode changes
 */
export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
      <button
        onClick={() => onChange('focused')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          value === 'focused'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
        }`}
      >
        Focused View
      </button>
      <button
        onClick={() => onChange('fullFunnel')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          value === 'fullFunnel'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
        }`}
      >
        Full Funnel View
      </button>
    </div>
  );
}
