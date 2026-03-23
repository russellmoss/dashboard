'use client';

import React from 'react';
import { Card, Text } from '@tremor/react';
import { ForecastRates } from '@/lib/queries/forecast-rates';

interface ConversionRatesPanelProps {
  rates: ForecastRates | null;
}

const RATE_ROWS = [
  { key: 'sqo_to_sp' as const, label: 'SQO → SP', daysKey: 'avg_days_in_sp' as const },
  { key: 'sp_to_neg' as const, label: 'SP → Neg', daysKey: 'avg_days_in_neg' as const },
  { key: 'neg_to_signed' as const, label: 'Neg → Signed', daysKey: 'avg_days_in_signed' as const },
  { key: 'signed_to_joined' as const, label: 'Signed → Joined', daysKey: null },
];

export function ConversionRatesPanel({ rates }: ConversionRatesPanelProps) {
  if (!rates) return null;

  const combinedRate = rates.sqo_to_sp * rates.sp_to_neg * rates.neg_to_signed * rates.signed_to_joined;

  return (
    <Card className="p-4">
      <Text className="font-semibold mb-3">Historical Conversion Rates</Text>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 text-gray-500 dark:text-gray-400 font-medium">Transition</th>
            <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-medium">Rate</th>
            <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-medium">Avg Days</th>
          </tr>
        </thead>
        <tbody>
          {RATE_ROWS.map(row => (
            <tr key={row.key} className="border-b border-gray-100 dark:border-gray-800">
              <td className="py-2 text-gray-700 dark:text-gray-300">{row.label}</td>
              <td className="py-2 text-right font-mono text-gray-900 dark:text-gray-100">
                {(rates[row.key] * 100).toFixed(1)}%
              </td>
              <td className="py-2 text-right font-mono text-gray-600 dark:text-gray-400">
                {row.daysKey ? `${rates[row.daysKey]}d` : '-'}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-2 text-gray-900 dark:text-gray-100">SQO → Joined</td>
            <td className="py-2 text-right font-mono text-blue-600 dark:text-blue-400">
              {(combinedRate * 100).toFixed(1)}%
            </td>
            <td className="py-2 text-right font-mono text-gray-600 dark:text-gray-400">
              {rates.avg_days_in_sp + rates.avg_days_in_neg + rates.avg_days_in_signed}d
            </td>
          </tr>
        </tbody>
      </table>
      <Text className="mt-3 text-xs text-gray-400">
        Based on {rates.cohort_count} SQOs (
        {typeof rates.window_start === 'object' ? (rates.window_start as any)?.value || String(rates.window_start) : rates.window_start}
        {' to '}
        {typeof rates.window_end === 'object' ? (rates.window_end as any)?.value || String(rates.window_end) : rates.window_end}
        )
      </Text>
    </Card>
  );
}
