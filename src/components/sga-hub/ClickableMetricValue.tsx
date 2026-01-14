// src/components/sga-hub/ClickableMetricValue.tsx

'use client';

import { Loader2 } from 'lucide-react';
import { ClickableMetricValueProps } from '@/types/drill-down';

export function ClickableMetricValue({
  value,
  onClick,
  loading = false,
  className = '',
}: ClickableMetricValueProps) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400 dark:text-gray-500">-</span>;
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={loading}
      className={`
        text-xl font-bold
        text-gray-900 dark:text-white
        hover:text-blue-600 dark:hover:text-blue-400
        hover:underline
        cursor-pointer
        transition-colors duration-150
        disabled:opacity-50 disabled:cursor-wait
        inline-flex items-center gap-1
        ${className}
      `}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        value
      )}
    </button>
  );
}
