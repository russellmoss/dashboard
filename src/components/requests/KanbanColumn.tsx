'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { RequestCard } from './RequestCard';
import { DashboardRequestCard, RequestStatus, STATUS_COLORS } from '@/types/dashboard-request';

interface KanbanColumnProps {
  status: RequestStatus;
  label: string;
  requests: DashboardRequestCard[];
  canManageRequests: boolean;
  onCardClick: (request: DashboardRequestCard) => void;
}

export function KanbanColumn({
  status,
  label,
  requests,
  canManageRequests,
  onCardClick,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  const statusColor = STATUS_COLORS[status];

  return (
    <div
      className={`
        flex flex-col bg-gray-50 dark:bg-gray-900 rounded-lg w-full
        ${isOver ? 'ring-2 ring-blue-500 ring-opacity-50' : ''}
      `}
    >
      {/* Column Header */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${statusColor.bg} ${statusColor.border} border`}
            />
            <h3 className="font-medium text-gray-900 dark:text-white">{label}</h3>
          </div>
          <span className="text-sm text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full">
            {requests.length}
          </span>
        </div>
      </div>

      {/* Column Content */}
      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] min-h-[200px]"
      >
        <SortableContext
          items={requests.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          {requests.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-gray-400 dark:text-gray-500 text-sm">
              No requests
            </div>
          ) : (
            requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                canManageRequests={canManageRequests}
                isDraggable={canManageRequests}
                onClick={() => onCardClick(request)}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}
