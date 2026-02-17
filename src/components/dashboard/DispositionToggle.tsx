'use client';

import { MetricDisposition } from '@/types/filters';

interface DispositionToggleProps {
  value: MetricDisposition;
  onChange: (value: MetricDisposition) => void;
}

const OPTIONS: { value: MetricDisposition; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'lost', label: 'Lost' },
  { value: 'converted', label: 'Converted' },
];

export function DispositionToggle({ value, onChange }: DispositionToggleProps) {
  return (
    <div
      className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-md p-0.5 mt-2"
      onClick={(e) => e.stopPropagation()}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={(e) => {
            e.stopPropagation();
            onChange(option.value);
          }}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
            value === option.value
              ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
