// src/components/sga-hub/MetricDrillDownModal.tsx

'use client';

import { useEffect, useMemo } from 'react';
import { X, ExternalLink } from 'lucide-react';
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from '@tremor/react';
import { 
  MetricDrillDownModalProps, 
  MetricType,
  InitialCallRecord,
  QualificationCallRecord,
  SQODrillDownRecord,
  DrillDownRecord
} from '@/types/drill-down';
import { formatDate } from '@/lib/utils/format-helpers';
import { ExportButton } from '@/components/ui/ExportButton';

// Type guards
function isInitialCallRecord(record: DrillDownRecord): record is InitialCallRecord {
  return 'initialCallDate' in record;
}

function isQualificationCallRecord(record: DrillDownRecord): record is QualificationCallRecord {
  return 'qualificationCallDate' in record;
}

function isSQODrillDownRecord(record: DrillDownRecord): record is SQODrillDownRecord {
  return 'sqoDate' in record;
}

// Column configurations
const COLUMN_CONFIGS: Record<MetricType, { key: string; label: string; width?: string }[]> = {
  'initial-calls': [
    { key: 'advisorName', label: 'Advisor Name', width: 'w-48' },
    { key: 'initialCallDate', label: 'Initial Call Date', width: 'w-32' },
    { key: 'source', label: 'Source', width: 'w-32' },
    { key: 'channel', label: 'Channel', width: 'w-32' },
    { key: 'leadScoreTier', label: 'Lead Score', width: 'w-24' },
    { key: 'tofStage', label: 'Stage', width: 'w-24' },
    { key: 'actions', label: '', width: 'w-20' },
  ],
  'qualification-calls': [
    { key: 'advisorName', label: 'Advisor Name', width: 'w-48' },
    { key: 'qualificationCallDate', label: 'Qual Call Date', width: 'w-32' },
    { key: 'source', label: 'Source', width: 'w-32' },
    { key: 'channel', label: 'Channel', width: 'w-28' },
    { key: 'aumFormatted', label: 'AUM', width: 'w-28' },
    { key: 'tofStage', label: 'Stage', width: 'w-24' },
    { key: 'actions', label: '', width: 'w-20' },
  ],
  'sqos': [
    { key: 'advisorName', label: 'Advisor Name', width: 'w-44' },
    { key: 'sqoDate', label: 'SQO Date', width: 'w-28' },
    { key: 'source', label: 'Source', width: 'w-28' },
    { key: 'channel', label: 'Channel', width: 'w-28' },
    { key: 'aumFormatted', label: 'AUM', width: 'w-28' },
    { key: 'aumTier', label: 'Tier', width: 'w-20' },
    { key: 'stageName', label: 'Stage', width: 'w-24' },
    { key: 'actions', label: '', width: 'w-20' },
  ],
};

// Skeleton row component
function SkeletonRow({ columns }: { columns: number }) {
  return (
    <TableRow>
      {Array.from({ length: columns }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </TableCell>
      ))}
    </TableRow>
  );
}

export function MetricDrillDownModal({
  isOpen,
  onClose,
  metricType,
  records,
  title,
  loading,
  error,
  onRecordClick,
  canExport = false,
}: MetricDrillDownModalProps) {
  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Prepare data for CSV export
  const exportData = useMemo(() => {
    if (metricType === 'initial-calls') {
      return (records as InitialCallRecord[]).map(record => ({
        'Advisor Name': record.advisorName,
        'Initial Call Date': formatDate(record.initialCallDate) || '',
        'Source': record.source,
        'Channel': record.channel,
        'Lead Score': record.leadScoreTier || '',
        'Stage': record.tofStage,
        'Salesforce URL': record.leadUrl || record.opportunityUrl || '',
      }));
    } else if (metricType === 'qualification-calls') {
      return (records as QualificationCallRecord[]).map(record => ({
        'Advisor Name': record.advisorName,
        'Qual Call Date': formatDate(record.qualificationCallDate) || '',
        'Source': record.source,
        'Channel': record.channel,
        'AUM': record.aumFormatted,
        'Stage': record.tofStage,
        'Salesforce URL': record.leadUrl || record.opportunityUrl || '',
      }));
    } else {
      return (records as SQODrillDownRecord[]).map(record => ({
        'Advisor Name': record.advisorName,
        'SQO Date': formatDate(record.sqoDate) || '',
        'Source': record.source,
        'Channel': record.channel,
        'AUM': record.aumFormatted,
        'Tier': record.aumTier || '',
        'Stage': record.stageName || record.tofStage,
        'Salesforce URL': record.opportunityUrl || record.leadUrl || '',
      }));
    }
  }, [records, metricType]);

  // Generate filename from title
  const exportFilename = useMemo(() => {
    const sanitizedTitle = title
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `drilldown-${sanitizedTitle}`;
  }, [title]);

  if (!isOpen) return null;

  const columns = COLUMN_CONFIGS[metricType];

  // Get cell value based on record type and column key
  const getCellValue = (record: DrillDownRecord, key: string): string => {
    if (key === 'actions') return '';
    
    if (key === 'initialCallDate' && isInitialCallRecord(record)) {
      return formatDate(record.initialCallDate) || '-';
    }
    if (key === 'qualificationCallDate' && isQualificationCallRecord(record)) {
      return formatDate(record.qualificationCallDate) || '-';
    }
    if (key === 'sqoDate' && isSQODrillDownRecord(record)) {
      return formatDate(record.sqoDate) || '-';
    }
    
    const value = record[key as keyof DrillDownRecord];
    if (value === null || value === undefined) return '-';
    return String(value);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {loading ? 'Loading...' : `${records.length} records`}
            </span>
            {canExport && (
              <ExportButton data={exportData} filename={exportFilename} />
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {!error && (
            <Table>
              <TableHead>
                <TableRow>
                  {columns.map((col) => (
                    <TableHeaderCell key={col.key} className={col.width}>
                      {col.label}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  // Skeleton rows
                  Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonRow key={i} columns={columns.length} />
                  ))
                ) : records.length === 0 ? (
                  // Empty state
                  <TableRow>
                    <TableCell colSpan={columns.length}>
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No records found for this period
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  // Data rows
                  records.map((record) => (
                    <TableRow
                      key={record.primaryKey}
                      onClick={() => onRecordClick(record.primaryKey)}
                      className="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors"
                    >
                      {columns.map((col) => (
                        <TableCell key={col.key}>
                          {col.key === 'actions' ? (
                            <div className="flex items-center gap-1">
                              {record.opportunityUrl && (
                                <a
                                  href={record.opportunityUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                  title="Open in Salesforce"
                                >
                                  <ExternalLink className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                </a>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-900 dark:text-gray-100">
                              {getCellValue(record, col.key)}
                            </span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Click any row to view full record details
          </p>
        </div>
      </div>
    </div>
  );
}
