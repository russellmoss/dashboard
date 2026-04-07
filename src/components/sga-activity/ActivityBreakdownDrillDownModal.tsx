'use client';

import React, { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { ActivityBreakdownDrillDownRecord } from '@/types/sga-activity';
import { exportToCSV } from '@/lib/utils/export-csv';

interface ActivityBreakdownDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  records: ActivityBreakdownDrillDownRecord[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onRecordClick: (recordId: string) => void;
  onExportAll?: () => Promise<any[]>;
  onSearch: (search: string) => void;
  searchValue: string;
}

const DRILLDOWN_COLUMNS: Record<string, keyof ActivityBreakdownDrillDownRecord> = {
  'Prospect Name': 'prospectName',
  'Stage': 'stage',
  'Cold Calls': 'coldCalls',
  'Scheduled Calls': 'scheduledCalls',
  'Outbound SMS': 'outboundSms',
  'LinkedIn': 'linkedin',
  'Manual Email': 'manualEmail',
  'Email Engagement': 'emailEngagement',
  'Total': 'totalActivities',
};

export default function ActivityBreakdownDrillDownModal({
  isOpen,
  onClose,
  title,
  records,
  loading,
  total,
  page,
  pageSize,
  onPageChange,
  onRecordClick,
  onExportAll,
  onSearch,
  searchValue,
}: ActivityBreakdownDrillDownModalProps) {
  const [exportLoading, setExportLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [localSearch, setLocalSearch] = useState(searchValue);

  // Sync local search with prop
  useEffect(() => {
    setLocalSearch(searchValue);
  }, [searchValue]);

  // ESC key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearch(value);
    }, 300);
  };

  const handleExportCurrent = () => {
    const exportData = records.map(r => {
      const row: Record<string, any> = {};
      for (const [label, key] of Object.entries(DRILLDOWN_COLUMNS)) {
        row[label] = r[key];
      }
      return row;
    });
    exportToCSV(exportData, `activity-drilldown-page${page}.csv`);
  };

  const handleExportAll = async () => {
    if (!onExportAll) return;
    setExportLoading(true);
    try {
      const allRecords = await onExportAll();
      const exportData = allRecords.map((r: any) => {
        const row: Record<string, any> = {};
        for (const [label, key] of Object.entries(DRILLDOWN_COLUMNS)) {
          row[label] = r[key];
        }
        return row;
      });
      exportToCSV(exportData, 'activity-drilldown-all.csv');
    } finally {
      setExportLoading(false);
    }
  };

  if (!isOpen) return null;

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        style={{ width: 'calc(100vw - 48px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search + Export */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search prospects..."
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none w-64"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCurrent}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              Export Page
            </button>
            {onExportAll && total > records.length && (
              <button
                onClick={handleExportAll}
                disabled={exportLoading}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {exportLoading ? 'Exporting...' : `Export All (${total})`}
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              No records found
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                <tr>
                  {Object.keys(DRILLDOWN_COLUMNS).map(label => (
                    <th
                      key={label}
                      className={`px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${
                        label === 'Prospect Name' || label === 'Stage' ? 'text-left' : 'text-right'
                      }`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {records.map((record, idx) => {
                  const isUnlinked = !record.recordId;
                  return (
                    <tr
                      key={`${record.recordId || idx}`}
                      className={
                        isUnlinked
                          ? 'cursor-not-allowed opacity-70'
                          : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800'
                      }
                      onClick={() => {
                        if (!isUnlinked && record.recordId) {
                          onRecordClick(record.recordId);
                        }
                      }}
                      title={isUnlinked ? 'No linked Salesforce record' : undefined}
                    >
                      <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {record.prospectName}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {record.stage}
                      </td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">{record.coldCalls}</td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">{record.scheduledCalls}</td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">{record.outboundSms}</td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">{record.linkedin}</td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">{record.manualEmail}</td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">{record.emailEngagement}</td>
                      <td className="px-3 py-2 text-sm text-right tabular-nums font-semibold">{record.totalActivities}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Showing {records.length} of {total} records (Page {page} of {totalPages})
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
