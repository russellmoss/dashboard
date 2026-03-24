'use client';

import React, { useEffect, useState } from 'react';
import { Card, Text } from '@tremor/react';
import { ExternalLink, FileSpreadsheet, Loader2 } from 'lucide-react';
import { dashboardApi } from '@/lib/api-client';

interface ExportRecord {
  id: string;
  name: string;
  spreadsheetUrl: string;
  createdAt: string;
  createdBy: string;
  windowDays: number;
  p2RowCount: number;
  auditRowCount: number;
}

function windowLabel(days: number): string {
  if (days === 180) return '180d';
  if (days === 365) return '1yr';
  if (days === 730) return '2yr';
  if (days === 0) return 'All time';
  return `${days}d`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ExportsPanel() {
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dashboardApi.getForecastExports()
      .then(data => setExports(data.exports))
      .catch(() => setError('Failed to load exports'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <Text className="text-red-500">{error}</Text>
      </Card>
    );
  }

  if (exports.length === 0) {
    return (
      <Card className="p-8 text-center">
        <FileSpreadsheet className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <Text className="text-gray-500">No exports yet</Text>
        <Text className="text-xs text-gray-400 mt-1">
          Use the "Export to Sheets" button on the Pipeline Forecast tab to create your first export.
        </Text>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="font-semibold">Forecast Exports</Text>
        <Text className="text-xs text-gray-500 mt-0.5">
          Each export is a unique Google Sheet snapshot. Click to open.
        </Text>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
              <th className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-400">Date</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-400">Exported By</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-400">Window</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-400">Deals</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-400">Cohort</th>
              <th className="px-4 py-2.5 font-medium text-gray-600 dark:text-gray-400">Sheet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {exports.map(exp => (
              <tr key={exp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                <td className="px-4 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                  {formatDate(exp.createdAt)}
                </td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                  {exp.createdBy}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                    {windowLabel(exp.windowDays)}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                  {exp.p2RowCount} opps
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                  {exp.auditRowCount} resolved
                </td>
                <td className="px-4 py-3">
                  <a
                    href={exp.spreadsheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
