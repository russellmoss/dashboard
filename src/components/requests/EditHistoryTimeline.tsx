'use client';

import { Clock, ArrowRight, MessageSquare } from 'lucide-react';
import { EditHistoryEntry, RequestCommentWithAuthor } from '@/types/dashboard-request';

interface EditHistoryTimelineProps {
  history: EditHistoryEntry[];
  comments: RequestCommentWithAuthor[];
}

// Unified timeline entry type
type TimelineEntry =
  | { type: 'edit'; data: EditHistoryEntry; date: Date }
  | { type: 'comment'; data: RequestCommentWithAuthor; date: Date };

// Field name display mapping
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  status: 'Status',
  priority: 'Priority',
  affectedPage: 'Affected Page',
  isPrivate: 'Privacy',
  filtersApplied: 'Filters Applied',
  valueSeen: 'Value Seen',
  valueExpected: 'Value Expected',
};

// Status display mapping
const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
};

// Priority display mapping
const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  IMMEDIATE: 'Immediate',
};

function formatValue(fieldName: string, value: string | null): string {
  if (value === null || value === '') return '(empty)';

  if (fieldName === 'status') {
    return STATUS_LABELS[value] || value;
  }

  if (fieldName === 'priority') {
    return PRIORITY_LABELS[value] || value;
  }

  if (fieldName === 'isPrivate') {
    return value === 'true' ? 'Private' : 'Public';
  }

  // Truncate long values
  if (value.length > 100) {
    return value.substring(0, 100) + '...';
  }

  return value;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function EditHistoryTimeline({ history, comments }: EditHistoryTimelineProps) {
  // Merge history and comments into a unified timeline
  const timelineEntries: TimelineEntry[] = [
    ...history.map((entry) => ({
      type: 'edit' as const,
      data: entry,
      date: new Date(entry.createdAt),
    })),
    ...comments.map((comment) => ({
      type: 'comment' as const,
      data: comment,
      date: new Date(comment.createdAt),
    })),
  ];

  // Sort by date, newest first
  timelineEntries.sort((a, b) => b.date.getTime() - a.date.getTime());

  if (timelineEntries.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">
        No activity history available.
      </p>
    );
  }

  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto">
      {timelineEntries.map((entry) => (
        <div
          key={entry.type === 'edit' ? `edit-${entry.data.id}` : `comment-${entry.data.id}`}
          className="relative pl-6 pb-4 border-l-2 border-gray-200 dark:border-gray-700 last:border-l-0 last:pb-0"
        >
          {/* Timeline dot */}
          <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 flex items-center justify-center ${
            entry.type === 'comment'
              ? 'bg-blue-200 dark:bg-blue-700'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}>
            {entry.type === 'comment' ? (
              <MessageSquare className="w-2 h-2 text-blue-600 dark:text-blue-300" />
            ) : (
              <Clock className="w-2 h-2 text-gray-500 dark:text-gray-400" />
            )}
          </div>

          {/* Content */}
          {entry.type === 'edit' ? (
            <EditEntryContent entry={entry.data} />
          ) : (
            <CommentEntryContent comment={entry.data} />
          )}
        </div>
      ))}
    </div>
  );
}

// Edit entry display component
function EditEntryContent({ entry }: { entry: EditHistoryEntry }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-gray-900 dark:text-white text-sm">
          {entry.editedBy.name}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(entry.createdAt)}
        </span>
      </div>

      {/* Change details */}
      <div className="text-sm">
        <span className="text-gray-600 dark:text-gray-400">
          Changed{' '}
          <span className="font-medium text-gray-900 dark:text-white">
            {FIELD_LABELS[entry.fieldName] || entry.fieldName}
          </span>
        </span>

        <div className="mt-1 flex items-center gap-2 text-xs flex-wrap">
          <span className="px-2 py-1 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded">
            {formatValue(entry.fieldName, entry.oldValue)}
          </span>
          <ArrowRight className="w-3 h-3 text-gray-400" />
          <span className="px-2 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
            {formatValue(entry.fieldName, entry.newValue)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Comment entry display component
function CommentEntryContent({ comment }: { comment: RequestCommentWithAuthor }) {
  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-gray-900 dark:text-white text-sm">
          {comment.author.name}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(comment.createdAt)}
        </span>
      </div>

      {/* Comment content */}
      <div className="text-sm">
        <span className="text-blue-600 dark:text-blue-400 text-xs font-medium">
          Added a comment
        </span>
        <p className="mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
          {comment.content.length > 150
            ? comment.content.substring(0, 150) + '...'
            : comment.content}
        </p>
      </div>
    </div>
  );
}
