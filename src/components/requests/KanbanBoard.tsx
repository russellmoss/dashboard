'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
} from '@dnd-kit/core';
import { Loader2, RefreshCw } from 'lucide-react';
import { KanbanColumn } from './KanbanColumn';
import { RequestCard } from './RequestCard';
import { RequestFilters } from './RequestFilters';
import { dashboardRequestsApi } from '@/lib/api-client';
import {
  DashboardRequestCard,
  KanbanBoardData,
  RequestFilters as RequestFiltersType,
  RequestStatus,
} from '@/types/dashboard-request';

interface KanbanBoardProps {
  canManageRequests: boolean;
  onRequestClick: (request: DashboardRequestCard) => void;
}

export function KanbanBoard({ canManageRequests, onRequestClick }: KanbanBoardProps) {
  const [data, setData] = useState<KanbanBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<RequestFiltersType>({});
  const [activeCard, setActiveCard] = useState<DashboardRequestCard | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px drag before activating
      },
    })
  );

  // Fetch kanban data
  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const result = await dashboardRequestsApi.getKanban(filters);
      setData(result);
    } catch (err) {
      console.error('Failed to fetch kanban data:', err);
      setError('Failed to load requests. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const card = findCard(active.id as string);
    if (card) {
      setActiveCard(card);
    }
  };

  // Handle drag over (for visual feedback)
  const handleDragOver = (event: DragOverEvent) => {
    // Could add visual feedback here if needed
  };

  // Helper to find which column a card belongs to
  const findColumnForCard = (cardId: string): RequestStatus | undefined => {
    if (!data) return undefined;
    for (const column of data.columns) {
      if (column.requests.some((r) => r.id === cardId)) {
        return column.status;
      }
    }
    return undefined;
  };

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over || !canManageRequests) return;

    const cardId = active.id as string;
    const overId = over.id as string;

    // Determine the target status:
    // - If dropped on a column, over.id is the column's status (e.g., "SUBMITTED")
    // - If dropped on a card, over.id is the card's ID, so we need to find its column
    let newStatus: RequestStatus;

    // Check if over.id is a valid status
    const validStatuses = ['SUBMITTED', 'PLANNED', 'IN_PROGRESS', 'DONE', 'ARCHIVED'];
    if (validStatuses.includes(overId)) {
      newStatus = overId as RequestStatus;
    } else {
      // over.id is a card ID, find which column that card is in
      const columnStatus = findColumnForCard(overId);
      if (!columnStatus) return;
      newStatus = columnStatus;
    }

    // Find the card and its current status
    const card = findCard(cardId);
    if (!card || card.status === newStatus) return;

    // Optimistic update
    setData((prevData) => {
      if (!prevData) return prevData;

      const newColumns = prevData.columns.map((col) => {
        if (col.status === card.status) {
          // Remove from old column
          return {
            ...col,
            requests: col.requests.filter((r) => r.id !== cardId),
          };
        }
        if (col.status === newStatus) {
          // Add to new column
          const updatedCard = { ...card, status: newStatus, statusChangedAt: new Date().toISOString() };
          return {
            ...col,
            requests: [updatedCard, ...col.requests],
          };
        }
        return col;
      });

      return { ...prevData, columns: newColumns };
    });

    // API update
    setIsUpdating(true);
    try {
      await dashboardRequestsApi.updateStatus(cardId, newStatus);
    } catch (err) {
      console.error('Failed to update status:', err);
      // Revert on error
      fetchData();
    } finally {
      setIsUpdating(false);
    }
  };

  // Helper to find a card by ID
  const findCard = (id: string): DashboardRequestCard | undefined => {
    if (!data) return undefined;
    for (const column of data.columns) {
      const card = column.requests.find((r) => r.id === id);
      if (card) return card;
    }
    return undefined;
  };

  // Handle filter changes
  const handleFiltersChange = (newFilters: RequestFiltersType) => {
    setFilters(newFilters);
    setLoading(true);
  };

  // Handle refresh
  const handleRefresh = () => {
    setLoading(true);
    fetchData();
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <RequestFilters
          filters={filters}
          onChange={handleFiltersChange}
          canManageRequests={canManageRequests}
        />

        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Status indicator */}
      {isUpdating && (
        <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Updating...
        </div>
      )}

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-4 gap-4">
          {data?.columns.map((column) => (
            <KanbanColumn
              key={column.status}
              status={column.status}
              label={column.label}
              requests={column.requests}
              canManageRequests={canManageRequests}
              onCardClick={onRequestClick}
            />
          ))}
        </div>

        {/* Drag Overlay - shows the card being dragged */}
        <DragOverlay>
          {activeCard ? (
            <div className="transform rotate-3 opacity-90">
              <RequestCard
                request={activeCard}
                canManageRequests={canManageRequests}
                isDraggable={false}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Empty State */}
      {data && data.totalCount === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">
            No requests found. Try adjusting your filters or submit a new request.
          </p>
        </div>
      )}
    </div>
  );
}
