'use client';

import React, { useEffect, useMemo } from 'react';
import { Card, Text, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Button } from '@tremor/react';
import { X, ExternalLink } from 'lucide-react';
import { ActivityRecord, ScheduledCallRecord } from '@/types/sga-activity';
import { ExportButton } from '@/components/ui/ExportButton';

interface ActivityDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  records: (ActivityRecord | ScheduledCallRecord)[];
  loading: boolean;
  onRecordClick: (recordId: string) => void;
  recordType: 'activity' | 'scheduled_call';
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  canExport?: boolean;
}

export default function ActivityDrillDownModal({
  isOpen,
  onClose,
  title,
  records,
  loading,
  onRecordClick,
  recordType,
  total = 0,
  page = 1,
  pageSize = 100,
  onPageChange,
  canExport = true,
}: ActivityDrillDownModalProps) {
  // Prepare data for CSV export
  const exportData = useMemo(() => {
    if (recordType === 'scheduled_call') {
      return (records as ScheduledCallRecord[]).map(record => ({
        Prospect: record.prospectName,
        SGA: record.sgaName,
        'Scheduled Date': record.scheduledDate,
        Source: record.source,
        Channel: record.channel,
        'Salesforce URL': record.salesforceUrl,
      }));
    } else {
      return (records as ActivityRecord[]).map(record => ({
        Date: record.createdDateEST,
        Type: `${record.activityChannel}${record.isColdCall ? ' (Cold)' : ''}${record.isAutomated ? ' (Auto)' : ''}`,
        Prospect: record.prospectName,
        SGA: record.sgaName,
        Subject: record.subject,
        'Activity Channel': record.activityChannel,
        'Activity Sub Type': record.activitySubType,
        Direction: record.direction,
        'Is Cold Call': record.isColdCall ? 'Yes' : 'No',
        'Is Automated': record.isAutomated ? 'Yes' : 'No',
        'Call Duration (seconds)': record.callDuration || '',
        'Salesforce URL': record.salesforceUrl,
      }));
    }
  }, [records, recordType]);

  // Generate filename from title
  const filename = useMemo(() => {
    const sanitizedTitle = title
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `sga-activity-${sanitizedTitle}`;
  }, [title]);
  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <Card className="relative z-10 w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col m-4 dark:bg-gray-800 dark:border-gray-700">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 pb-4 border-b">
          <Text className="text-lg font-semibold">{title}</Text>
          <div className="flex items-center gap-2">
            {canExport && !loading && records.length > 0 && (
              <ExportButton data={exportData} filename={filename} />
            )}
            <Button
              variant="light"
              icon={X}
              onClick={onClose}
            />
          </div>
        </div>

        {/* Content */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <Text>Loading...</Text>
            </div>
          ) : records.length === 0 ? (
            <div className="flex justify-center items-center h-32">
              <Text className="text-gray-500">No records found</Text>
            </div>
          ) : recordType === 'scheduled_call' ? (
            <ScheduledCallsTable 
              records={records as ScheduledCallRecord[]} 
              onRecordClick={onRecordClick}
            />
          ) : (
            <ActivityRecordsTable 
              records={records as ActivityRecord[]} 
              onRecordClick={onRecordClick}
            />
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              Showing {records.length > 0 ? ((page - 1) * pageSize + 1) : 0} - {Math.min(page * pageSize, total)} of {total.toLocaleString()} records
            </Text>
            {total > pageSize && onPageChange && (
              <div className="flex items-center gap-2">
                <Button
                  variant="light"
                  size="sm"
                  onClick={() => onPageChange(page - 1)}
                  disabled={page <= 1 || loading}
                >
                  Previous
                </Button>
                <Text className="text-sm text-gray-500 dark:text-gray-400">
                  Page {page} of {Math.ceil(total / pageSize)}
                </Text>
                <Button
                  variant="light"
                  size="sm"
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= Math.ceil(total / pageSize) || loading}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ScheduledCallsTable({ 
  records, 
  onRecordClick 
}: { 
  records: ScheduledCallRecord[]; 
  onRecordClick: (id: string) => void;
}) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Prospect</TableHeaderCell>
          <TableHeaderCell>SGA</TableHeaderCell>
          <TableHeaderCell>Scheduled Date</TableHeaderCell>
          <TableHeaderCell>Source</TableHeaderCell>
          <TableHeaderCell>Channel</TableHeaderCell>
          <TableHeaderCell>Salesforce</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {records.map((record) => (
          <TableRow 
            key={record.id}
            className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => {
              // RecordDetailModal requires Lead ID (00Q...) or Opportunity ID (006...)
              // Prefer leadId, then opportunityId, then id (if it's a valid format)
              const detailId = record.leadId || record.opportunityId || record.id;
              onRecordClick(detailId);
            }}
          >
            <TableCell>{record.prospectName}</TableCell>
            <TableCell>{record.sgaName}</TableCell>
            <TableCell>{record.scheduledDate}</TableCell>
            <TableCell>{record.source}</TableCell>
            <TableCell>{record.channel}</TableCell>
            <TableCell>
              <a 
                href={record.salesforceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-500 hover:text-blue-700"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ActivityRecordsTable({ 
  records, 
  onRecordClick 
}: { 
  records: ActivityRecord[]; 
  onRecordClick: (id: string) => void;
}) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Date</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
          <TableHeaderCell>Prospect</TableHeaderCell>
          <TableHeaderCell>SGA</TableHeaderCell>
          <TableHeaderCell>Subject</TableHeaderCell>
          <TableHeaderCell>Salesforce</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {records.map((record) => (
          <TableRow 
            key={record.taskId}
            className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => {
              // RecordDetailModal requires Lead ID (00Q...) or Opportunity ID (006...)
              // Task IDs (00T...) are NOT accepted - must use leadId or opportunityId
              const detailId = record.leadId || record.opportunityId;
              if (detailId) {
                onRecordClick(detailId);
              } else {
                // If no lead/opportunity ID, show alert or skip (Task detail not supported)
                console.warn('Cannot open RecordDetailModal: Task has no linked Lead or Opportunity ID');
              }
            }}
          >
            <TableCell>{record.createdDateEST}</TableCell>
            <TableCell>
              {record.activityChannel}
              {record.isColdCall && ' (Cold)'}
              {record.isAutomated && ' (Auto)'}
            </TableCell>
            <TableCell>{record.prospectName}</TableCell>
            <TableCell>{record.sgaName}</TableCell>
            <TableCell className="max-w-xs truncate">{record.subject}</TableCell>
            <TableCell>
              <a 
                href={record.salesforceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-500 hover:text-blue-700"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
