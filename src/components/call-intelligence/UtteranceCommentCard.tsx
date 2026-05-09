'use client';

import { X } from 'lucide-react';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';
import type { TranscriptCommentRow } from '@/types/call-intelligence';

interface Props {
  comment: TranscriptCommentRow;
  currentUserId: string | null;
  isAdmin: boolean;
  onDelete: (commentId: string) => void;
}

export function UtteranceCommentCard({ comment, currentUserId, isAdmin, onDelete }: Props) {
  const canDelete = isAdmin || (currentUserId !== null && comment.author_id === currentUserId);
  const displayName = comment.author_full_name ?? roleLabel(comment.author_role);

  return (
    <div className="border-l-2 border-blue-200 dark:border-blue-800 pl-3 py-1 my-2 bg-blue-50/40 dark:bg-blue-900/10 rounded-r">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs">
          <span className="font-medium dark:text-gray-200">{displayName}</span>
          <span className="ml-2 inline-flex items-center px-1.5 py-0 rounded-full text-[10px] uppercase bg-gray-200 dark:bg-gray-700 dark:text-gray-300">
            {comment.author_role}
          </span>
          <span className="ml-2 text-gray-500 dark:text-gray-400">
            {formatRelativeTimestamp(comment.created_at)}
          </span>
        </div>
        {canDelete && (
          <button
            onClick={() => onDelete(comment.id)}
            aria-label="Delete comment"
            className="text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-sm dark:text-gray-200 mt-1 whitespace-pre-wrap">{comment.text}</p>
    </div>
  );
}

function roleLabel(role: 'manager' | 'rep' | 'admin'): string {
  if (role === 'manager') return 'Manager';
  if (role === 'admin') return 'Admin';
  return 'Rep';
}
