'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Lock, MessageCircle, GripVertical } from 'lucide-react';
import {
  DashboardRequestCard,
  STATUS_COLORS,
  TYPE_LABELS,
  TYPE_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  getDaysInStatus,
} from '@/types/dashboard-request';

interface RequestCardProps {
  request: DashboardRequestCard;
  canManageRequests: boolean;
  isDraggable: boolean;
  onClick?: () => void;
}

export function RequestCard({
  request,
  canManageRequests,
  isDraggable,
  onClick,
}: RequestCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: request.id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const daysInStatus = getDaysInStatus(request.statusChangedAt);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700
        p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer
        ${isDragging ? 'opacity-50 shadow-lg ring-2 ring-blue-500' : ''}
      `}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        {/* Drag Handle - only for admins */}
        {isDraggable && (
          <button
            {...attributes}
            {...listeners}
            className="p-1 -ml-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}

        <div className="flex-1 min-w-0">
          {/* Badges Row */}
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            {/* Type Badge */}
            <span
              className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                TYPE_COLORS[request.requestType].bg
              } ${TYPE_COLORS[request.requestType].text}`}
            >
              {TYPE_LABELS[request.requestType]}
            </span>

            {/* Priority Badge */}
            {request.priority && (
              <span
                className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                  PRIORITY_COLORS[request.priority].bg
                } ${PRIORITY_COLORS[request.priority].text}`}
              >
                {PRIORITY_LABELS[request.priority]}
              </span>
            )}

            {/* Private Indicator - only visible to admins */}
            {request.isPrivate && canManageRequests && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                <Lock className="w-3 h-3" />
                Private
              </span>
            )}
          </div>

          {/* Title */}
          <h4 className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 mb-2">
            {request.title}
          </h4>

          {/* Meta Row */}
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-2">
              {/* Submitter */}
              <span className="truncate max-w-[100px]">{request.submitter.name}</span>

              {/* Separator */}
              <span className="text-gray-300 dark:text-gray-600">·</span>

              {/* Days in Status */}
              <span>
                {daysInStatus === 0 ? 'Today' : `${daysInStatus}d`}
              </span>
            </div>

            {/* Comment Count */}
            {request._count.comments > 0 && (
              <div className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
                <MessageCircle className="w-3.5 h-3.5" />
                <span>{request._count.comments}</span>
              </div>
            )}
          </div>

          {/* Latest Comment Preview */}
          {request.latestComment && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                <span className="font-medium">{request.latestComment.author.name}:</span>{' '}
                {request.latestComment.content}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
