'use client';

import { useState } from 'react';
import { Button } from '@tremor/react';
import { FileSpreadsheet, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { DashboardFilters } from '@/types/filters';
import { ConversionTrendMode } from '@/types/dashboard';

interface ExportToSheetsButtonProps {
  filters: DashboardFilters;
  mode?: ConversionTrendMode;
  disabled?: boolean;
  canExport?: boolean;
}

export function ExportToSheetsButton({ 
  filters,
  mode = 'cohort', // Default to cohort mode (resolved)
  disabled = false,
  canExport = true,
}: ExportToSheetsButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    setSpreadsheetUrl(null);

    try {
      const response = await fetch('/api/dashboard/export-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, mode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Export failed');
      }

      if (data.spreadsheetUrl) {
        setSpreadsheetUrl(data.spreadsheetUrl);
        // Open in new tab
        window.open(data.spreadsheetUrl, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  if (!canExport) {
    return null;
  }

  return (
    <div className="relative">
      <Button
        icon={isExporting ? Loader2 : FileSpreadsheet}
        onClick={handleExport}
        disabled={disabled || isExporting}
        variant="secondary"
        className={isExporting ? 'animate-pulse' : ''}
      >
        {isExporting ? 'Exporting...' : 'Export to Sheets'}
      </Button>

      {error && (
        <div className="absolute top-full mt-2 right-0 z-10 bg-red-50 border border-red-200 rounded-lg p-3 shadow-lg max-w-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <button 
                onClick={() => setError(null)}
                className="text-xs text-red-500 hover:text-red-700 mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {spreadsheetUrl && !error && (
        <div className="absolute top-full mt-2 right-0 z-10 bg-green-50 border border-green-200 rounded-lg p-3 shadow-lg max-w-xs">
          <div className="flex items-start gap-2">
            <ExternalLink className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-green-700">Export complete!</p>
              <a 
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-600 hover:text-green-800 underline"
              >
                Open spreadsheet
              </a>
              <button 
                onClick={() => setSpreadsheetUrl(null)}
                className="text-xs text-green-500 hover:text-green-700 ml-2"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
