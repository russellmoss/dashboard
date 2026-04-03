'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Text, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Button } from '@tremor/react';
import { X, ExternalLink, Download } from 'lucide-react';
import { ExportButton } from '@/components/ui/ExportButton';
import { exportToCSV } from '@/lib/utils/export-csv';
import type {
  OutreachDrillDownType,
  OutreachLeadRecord,
  ZeroTouchLeadRecord,
  WeeklyCallBreakdownRow,
} from '@/types/outreach-effectiveness';

interface OutreachDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  drillDownType: OutreachDrillDownType;
  records: (OutreachLeadRecord | ZeroTouchLeadRecord | WeeklyCallBreakdownRow)[];
  loading: boolean;
  error?: string | null;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onRecordClick?: (record: any) => void;
  onExportAll?: () => Promise<any[]>;
}

const LEADS_COLUMNS: Record<string, keyof OutreachLeadRecord> = {
  'Advisor Name': 'advisorName',
  'SGA': 'sgaName',
  'Outbound Touchpoints': 'outboundTouchpoints',
  'Channels Used': 'channelsUsed',
  'Days in Contacting': 'daysInContacting',
  'Status': 'status',
  'Campaign': 'campaignName',
  'Disposition': 'disposition',
  'Salesforce URL': 'salesforceUrl',
};

const ZERO_TOUCH_COLUMNS: Record<string, keyof ZeroTouchLeadRecord> = {
  'Advisor Name': 'advisorName',
  'SGA': 'sgaName',
  'Days Since Assignment': 'daysSinceAssignment',
  'Current Stage': 'currentStage',
  'Disposition': 'disposition',
  'Campaign': 'campaignName',
  'Still Open': 'isOpen',
  'Salesforce URL': 'salesforceUrl',
};

const WEEKLY_CALLS_COLUMNS: Record<string, keyof WeeklyCallBreakdownRow> = {
  'SGA': 'sgaName',
  'Week Starting': 'weekStarting',
  'Initial Calls': 'initialCalls',
  'Qualification Calls': 'qualCalls',
};

function mapRecordsForExport(records: any[], columns: Record<string, string>): any[] {
  return records.map(r => {
    const mapped: Record<string, any> = {};
    for (const [header, field] of Object.entries(columns)) {
      mapped[header] = r[field] ?? '';
    }
    return mapped;
  });
}

export default function OutreachDrillDownModal({
  isOpen,
  onClose,
  title,
  drillDownType,
  records,
  loading,
  error,
  total,
  page,
  pageSize,
  onPageChange,
  onRecordClick,
  onExportAll,
}: OutreachDrillDownModalProps) {
  const [exporting, setExporting] = useState(false);

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const columns = useMemo(() => {
    switch (drillDownType) {
      case 'leads': return LEADS_COLUMNS;
      case 'zero-touch': return ZERO_TOUCH_COLUMNS;
      case 'weekly-calls': return WEEKLY_CALLS_COLUMNS;
    }
  }, [drillDownType]);

  const exportData = useMemo(() => mapRecordsForExport(records, columns), [records, columns]);

  const handleExportAll = async () => {
    if (!onExportAll) return;
    setExporting(true);
    try {
      const allRecords = await onExportAll();
      const mapped = mapRecordsForExport(allRecords, columns);
      exportToCSV(mapped, `outreach-${drillDownType}-export`);
    } finally {
      setExporting(false);
    }
  };

  if (!isOpen) return null;

  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, total);
  const totalPages = Math.ceil(total / pageSize);
  const isPaginated = total > pageSize;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Card className="relative z-10 mx-6 max-h-[90vh] overflow-hidden flex flex-col bg-white dark:bg-gray-800 dark:border-gray-700" style={{ width: 'calc(100vw - 48px)' }}>
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <Text className="text-lg font-semibold">{title}</Text>
          <div className="flex gap-2 items-center">
            <ExportButton data={exportData} filename={`outreach-${drillDownType}`} />
            {total > records.length && onExportAll && (
              <Button
                size="xs"
                variant="secondary"
                icon={Download}
                onClick={handleExportAll}
                loading={exporting}
                disabled={exporting}
              >
                Export All ({total})
              </Button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body — vertical scroll here, horizontal scroll on inner table wrapper */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <Text className="text-center py-8 text-gray-500">Loading...</Text>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 m-4">
              <Text className="text-red-600 dark:text-red-400">Error: {error}</Text>
            </div>
          ) : records.length === 0 ? (
            <Text className="text-center py-8 text-gray-500">No records found</Text>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  {Object.keys(columns).map((header) => (
                    <TableHeaderCell key={header} className="whitespace-nowrap">{header}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((record: any, idx: number) => (
                  <TableRow
                    key={idx}
                    className={onRecordClick && drillDownType !== 'weekly-calls' ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''}
                    onClick={() => {
                      if (onRecordClick && drillDownType !== 'weekly-calls') {
                        onRecordClick(record);
                      }
                    }}
                  >
                    {Object.values(columns).map((field, colIdx) => {
                      const value = record[field];
                      if (field === 'salesforceUrl' && value) {
                        return (
                          <TableCell key={colIdx}>
                            <a
                              href={value}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" /> Open
                            </a>
                          </TableCell>
                        );
                      }
                      if (field === 'isOpen') {
                        return <TableCell key={colIdx}>{value ? 'Yes' : 'No'}</TableCell>;
                      }
                      return <TableCell key={colIdx}>{value ?? '-'}</TableCell>;
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
          <Text className="text-sm text-gray-500">
            {total > 0 ? `Showing ${startIdx} - ${endIdx} of ${total} records` : 'No records'}
          </Text>
          <div className="flex items-center gap-2">
            {isPaginated && (
              <>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => onPageChange(page - 1)}
                >
                  Previous
                </Button>
                <Text className="text-sm">Page {page} of {totalPages}</Text>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={page >= totalPages || loading}
                  onClick={() => onPageChange(page + 1)}
                >
                  Next
                </Button>
              </>
            )}
            <Button size="xs" variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
