'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell,
  Button, Text,
} from '@tremor/react';
import { ExportButton } from '@/components/ui/ExportButton';
import { NoteReviewClient } from '../review/[callNoteId]/NoteReviewClient';
import type { NeedsLinkingRow } from '@/types/call-intelligence';
import type { CallNoteDetailT, BridgeSfdcSuggestionT } from '@/lib/sales-coaching-client/schemas';

const STRATEGY_LABELS: Record<string, string> = {
  manual_entry: 'Manual Entry',
  kixie_task_link: 'Kixie Task',
  crd_prefix: 'CRD Match',
  calendar_title: 'Calendar Title',
  attendee_email: 'Attendee Email',
};

function strategyLabel(raw: string): string {
  return STRATEGY_LABELS[raw] ?? raw;
}

interface ReviewModalState {
  callNote: CallNoteDetailT;
  suggestion: BridgeSfdcSuggestionT | null;
}

export default function NeedsLinkingTab() {
  const [rows, setRows] = useState<NeedsLinkingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewModal, setReviewModal] = useState<ReviewModalState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const fetchRows = useCallback(() => {
    setLoading(true);
    fetch(`/api/call-intelligence/needs-linking?showAll=${showAll}`)
      .then((res) => res.json())
      .then((data) => {
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [showAll]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  function openReview(callNoteId: string) {
    setReviewLoading(true);
    fetch(`/api/call-intelligence/note-reviews/${callNoteId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        setReviewModal({
          callNote: data.call_note,
          suggestion: data.sfdc_suggestion ?? null,
        });
      })
      .catch(() => setReviewModal(null))
      .finally(() => setReviewLoading(false));
  }

  function closeReview() {
    setReviewModal(null);
    fetchRows();
  }

  const exportData = rows.map((r) => ({
    'Call Date': new Date(r.callDate).toLocaleDateString(),
    'Source': r.source,
    'Advisor Hint': r.advisorHint,
    'Rep': r.repName,
    'Manager': r.managerName ?? '',
    'Linkage Strategy': strategyLabel(r.linkageStrategy),
    'Confidence Tier': r.confidenceTier ?? '',
    'Days Since Call': r.daysSinceCall,
  }));

  if (loading) {
    return <Text className="p-4">Loading needs-linking queue...</Text>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Text className="font-medium">
            {total} call{total !== 1 ? 's' : ''} need linking
          </Text>
          <Button
            size="xs"
            variant={showAll ? 'secondary' : 'primary'}
            onClick={() => setShowAll(false)}
          >
            Last 14 Days
          </Button>
          <Button
            size="xs"
            variant={showAll ? 'primary' : 'secondary'}
            onClick={() => setShowAll(true)}
          >
            All
          </Button>
        </div>
        {rows.length > 0 && (
          <ExportButton data={exportData} filename="needs-linking" />
        )}
      </div>

      {rows.length === 0 ? (
        <Text className="p-4 text-center text-gray-500">
          No calls need linking{showAll ? '' : ' in the last 14 days'}.
        </Text>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Call Date</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Advisor Hint</TableHeaderCell>
              <TableHeaderCell>Rep</TableHeaderCell>
              <TableHeaderCell>Manager</TableHeaderCell>
              <TableHeaderCell>Strategy</TableHeaderCell>
              <TableHeaderCell>Confidence</TableHeaderCell>
              <TableHeaderCell>Days</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.callNoteId}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                onClick={() => openReview(r.callNoteId)}
              >
                <TableCell>{new Date(r.callDate).toLocaleDateString()}</TableCell>
                <TableCell>
                  <span className={r.source === 'granola' ? 'text-blue-400 font-medium' : 'text-amber-400 font-medium'}>
                    {r.source}
                  </span>
                </TableCell>
                <TableCell className="max-w-[200px] truncate">{r.advisorHint}</TableCell>
                <TableCell>{r.repName}</TableCell>
                <TableCell>{r.managerName ?? '—'}</TableCell>
                <TableCell>
                  <span className="text-gray-300">{strategyLabel(r.linkageStrategy)}</span>
                </TableCell>
                <TableCell>
                  {r.confidenceTier ? (
                    <span className={
                      r.confidenceTier === 'unlikely' ? 'text-red-400 font-medium'
                        : r.confidenceTier === 'possible' ? 'text-yellow-400 font-medium'
                        : 'text-green-400 font-medium'
                    }>
                      {r.confidenceTier}
                    </span>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </TableCell>
                <TableCell>{r.daysSinceCall}d</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {reviewLoading && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <Text className="text-white text-lg">Loading review...</Text>
        </div>
      )}

      {reviewModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={closeReview}>
          <div
            className="w-full max-w-7xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-lg shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <NoteReviewClient
              initial={reviewModal.callNote}
              suggestion={reviewModal.suggestion}
              onDone={closeReview}
            />
          </div>
        </div>
      )}
    </div>
  );
}
