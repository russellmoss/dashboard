'use client';

import React from 'react';
import { Card } from '@tremor/react';
import { Play, Download, Loader2, ExternalLink } from 'lucide-react';

interface ForecastTopBarProps {
  windowDays: 180 | 365 | 730 | null;
  onWindowChange: (days: 180 | 365 | 730 | null) => void;
  canRunScenarios: boolean;
  onRunMonteCarlo: () => void;
  onExport: () => void;
  mcLoading: boolean;
  exporting: boolean;
  totalOpps: number;
  exportResult: { url: string; name: string } | null;
}

const WINDOW_OPTIONS: { label: string; value: 180 | 365 | 730 | null }[] = [
  { label: '180d', value: 180 },
  { label: '1yr', value: 365 },
  { label: '2yr', value: 730 },
  { label: 'All time', value: null },
];

export function ForecastTopBar({
  windowDays,
  onWindowChange,
  canRunScenarios,
  onRunMonteCarlo,
  onExport,
  mcLoading,
  exporting,
  totalOpps,
  exportResult,
}: ForecastTopBarProps) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Window selector */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {WINDOW_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => onWindowChange(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  windowDays === opt.value
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Opp count */}
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {totalOpps} open SQOs
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Export result link */}
          {exportResult && (
            <a
              href={exportResult.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {exportResult.name}
            </a>
          )}

          <button
            onClick={onExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {exporting ? 'Exporting...' : 'Export to Sheets'}
          </button>

          {canRunScenarios && (
            <button
              onClick={onRunMonteCarlo}
              disabled={mcLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mcLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Run Monte Carlo
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
