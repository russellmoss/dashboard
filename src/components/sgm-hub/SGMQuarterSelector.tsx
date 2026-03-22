'use client';

import React from 'react';

interface SGMQuarterSelectorProps {
  quarterCount: number;
  onQuarterCountChange: (count: number) => void;
}

const QUARTER_OPTIONS = [4, 5, 6, 7, 8];

export function SGMQuarterSelector({ quarterCount, onQuarterCountChange }: SGMQuarterSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600 dark:text-gray-400">Quarters:</span>
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
        {QUARTER_OPTIONS.map(n => (
          <button
            key={n}
            onClick={() => onQuarterCountChange(n)}
            className={`px-3 py-1 text-sm font-medium transition-colors ${
              quarterCount === n
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
