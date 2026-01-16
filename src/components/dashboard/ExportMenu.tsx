// src/components/dashboard/ExportMenu.tsx
'use client';

import { useState } from 'react';
import { Download, FileText, FileCode, Image, Archive, ChevronDown, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import JSZip from 'jszip';
import type { QueryResultData, CompiledQuery } from '@/types/agent';

interface ExportMenuProps {
  data: QueryResultData;
  query: CompiledQuery;
  chartElementId?: string;
  filename?: string;
}

export function ExportMenu({ data, query, chartElementId, filename = 'export' }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);

  const timestamp = new Date().toISOString().split('T')[0];
  const baseFilename = `${filename}_${timestamp}`;

  // CSV Export
  const exportCSV = async () => {
    setIsExporting(true);
    setExportingType('csv');
    try {
      const headers = data.columns.map(c => c.displayName);
      const rows = data.rows.map(row => 
        data.columns.map(col => {
          const value = row[col.name];
          // Escape quotes and wrap in quotes if contains comma
          const str = String(value ?? '');
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',')
      );
      
      const csv = [headers.join(','), ...rows].join('\n');
      downloadFile(csv, `${baseFilename}.csv`, 'text/csv;charset=utf-8;');
    } finally {
      setIsExporting(false);
      setExportingType(null);
      setIsOpen(false);
    }
  };

  // SQL Export
  const exportSQL = () => {
    setIsExporting(true);
    setExportingType('sql');
    try {
      // Format SQL nicely
      const formattedSql = formatSql(query.sql);
      
      // Add metadata as comments
      const content = `-- Query exported from Savvy Funnel Dashboard
-- Template: ${query.templateId}
-- Date: ${new Date().toISOString()}
-- Visualization: ${query.visualization}
--
-- Parameters:
${Object.entries(query.params)
  .map(([key, value]) => `-- @${key} = ${JSON.stringify(value)}`)
  .join('\n')}

${formattedSql}
`;
      
      downloadFile(content, `${baseFilename}.sql`, 'text/plain;charset=utf-8;');
    } finally {
      setIsExporting(false);
      setExportingType(null);
      setIsOpen(false);
    }
  };

  // PNG Export
  const exportPNG = async () => {
    if (!chartElementId) {
      alert('No chart element available to export');
      return;
    }

    setIsExporting(true);
    setExportingType('png');
    try {
      const element = document.getElementById(chartElementId);
      if (!element) {
        throw new Error('Chart element not found');
      }

      const dataUrl = await toPng(element, {
        backgroundColor: '#ffffff',
        pixelRatio: 2, // Higher quality
      });
      
      const link = document.createElement('a');
      link.download = `${baseFilename}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('Failed to export PNG. Please try again.');
    } finally {
      setIsExporting(false);
      setExportingType(null);
      setIsOpen(false);
    }
  };

  // ZIP Export (all formats bundled)
  const exportZIP = async () => {
    setIsExporting(true);
    setExportingType('zip');
    try {
      const zip = new JSZip();

      // Add CSV
      const headers = data.columns.map(c => c.displayName);
      const rows = data.rows.map(row => 
        data.columns.map(col => String(row[col.name] ?? '')).join(',')
      );
      const csv = [headers.join(','), ...rows].join('\n');
      zip.file('data.csv', csv);

      // Add SQL
      const sqlContent = `-- Query exported from Savvy Funnel Dashboard
-- Template: ${query.templateId}
-- Date: ${new Date().toISOString()}

${formatSql(query.sql)}
`;
      zip.file('query.sql', sqlContent);

      // Add PNG if chart element exists
      if (chartElementId) {
        const element = document.getElementById(chartElementId);
        if (element) {
          try {
            const dataUrl = await toPng(element, {
              backgroundColor: '#ffffff',
              pixelRatio: 2,
            });
            // Extract base64 data
            const base64Data = dataUrl.split(',')[1];
            zip.file('chart.png', base64Data, { base64: true });
          } catch (e) {
            console.warn('Could not include PNG in ZIP:', e);
          }
        }
      }

      // Add metadata JSON
      const metadata = {
        exportedAt: new Date().toISOString(),
        templateId: query.templateId,
        visualization: query.visualization,
        rowCount: data.metadata.rowCount,
        executionTimeMs: data.metadata.executionTimeMs,
        parameters: query.params,
      };
      zip.file('metadata.json', JSON.stringify(metadata, null, 2));

      // Generate and download
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.download = `${baseFilename}.zip`;
      link.href = URL.createObjectURL(content);
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('ZIP export failed:', err);
      alert('Failed to create ZIP. Please try individual exports.');
    } finally {
      setIsExporting(false);
      setExportingType(null);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 
                   dark:border-gray-700 bg-white dark:bg-gray-800 
                   hover:bg-gray-50 dark:hover:bg-gray-700 
                   disabled:opacity-50 transition-colors"
      >
        {isExporting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span>Export</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 
                         dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg z-20">
            <div className="py-1">
              <ExportButton
                onClick={exportCSV}
                icon={FileText}
                label="Export CSV"
                description="Data as spreadsheet"
                isLoading={exportingType === 'csv'}
              />
              <ExportButton
                onClick={exportSQL}
                icon={FileCode}
                label="Export SQL"
                description="Query file"
                isLoading={exportingType === 'sql'}
              />
              <ExportButton
                onClick={exportPNG}
                icon={Image}
                label="Export PNG"
                description="Chart image"
                isLoading={exportingType === 'png'}
                disabled={!chartElementId}
              />
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
              <ExportButton
                onClick={exportZIP}
                icon={Archive}
                label="Export All (ZIP)"
                description="Bundle everything"
                isLoading={exportingType === 'zip'}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Helper Components

function ExportButton({ 
  onClick, 
  icon: Icon, 
  label, 
  description, 
  isLoading,
  disabled 
}: {
  onClick: () => void;
  icon: typeof Download;
  label: string;
  description: string;
  isLoading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading || disabled}
      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-50 
                 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed
                 transition-colors"
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
      ) : (
        <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      )}
      <div className="text-left">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {label}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {description}
        </div>
      </div>
    </button>
  );
}

// Helper Functions

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatSql(sql: string): string {
  return sql
    .replace(/SELECT/gi, 'SELECT\n  ')
    .replace(/FROM/gi, '\nFROM')
    .replace(/WHERE/gi, '\nWHERE')
    .replace(/GROUP BY/gi, '\nGROUP BY')
    .replace(/ORDER BY/gi, '\nORDER BY')
    .replace(/LEFT JOIN/gi, '\nLEFT JOIN')
    .replace(/AND /gi, '\n  AND ')
    .replace(/,\s*/g, ',\n  ')
    .trim();
}
