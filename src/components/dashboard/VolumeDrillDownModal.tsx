'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { DetailRecord } from '@/types/dashboard';
import { DetailRecordsTable } from './DetailRecordsTable';

interface VolumeDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: DetailRecord[];
  title: string;
  loading: boolean;
  error: string | null;
  onRecordClick: (recordId: string) => void;
  metricFilter?: 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  canExport?: boolean;
}

export function VolumeDrillDownModal({
  isOpen,
  onClose,
  records,
  title,
  loading,
  error,
  onRecordClick,
  metricFilter,
  canExport = false,
}: VolumeDrillDownModalProps) {
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

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* Modal */}
      <div 
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col"
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

          {!error && !loading && records.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <p className="text-lg mb-2">No records found</p>
              <p className="text-sm">No records match the selected criteria for this period.</p>
            </div>
          )}

          {!error && (loading || records.length > 0) && (
            <DetailRecordsTable
              records={records}
              title=""
              filterDescription={title}
              canExport={canExport}
              onRecordClick={onRecordClick}
              metricFilter={metricFilter}
            />
          )}

          {loading && records.length === 0 && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-500 dark:text-gray-400">Loading records...</p>
            </div>
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
