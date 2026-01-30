'use client';

import { useState, useCallback } from 'react';
import { MessageSquarePlus, Kanban, BarChart3 } from 'lucide-react';
import { UserRole } from '@/types/user';
import { RequestForm } from '@/components/requests/RequestForm';
import { KanbanBoard } from '@/components/requests/KanbanBoard';
import { RequestDetailModal } from '@/components/requests/RequestDetailModal';
import { RequestAnalytics } from '@/components/requests/RequestAnalytics';
import { DashboardRequestCard } from '@/types/dashboard-request';

interface RequestsPageContentProps {
  canManageRequests: boolean;
  userRole: UserRole;
}

type TabId = 'submit' | 'board' | 'analytics';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof MessageSquarePlus;
  adminOnly?: boolean;
}

const TABS: Tab[] = [
  { id: 'submit', label: 'Submit Request', icon: MessageSquarePlus },
  { id: 'board', label: 'Request Board', icon: Kanban },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, adminOnly: true },
];

export function RequestsPageContent({ canManageRequests, userRole }: RequestsPageContentProps) {
  const [activeTab, setActiveTab] = useState<TabId>('submit');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filter tabs based on permissions
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || canManageRequests);

  // Handle request card click - opens the detail modal
  const handleRequestClick = useCallback((request: DashboardRequestCard) => {
    setSelectedRequestId(request.id);
  }, []);

  // Close the modal
  const handleCloseModal = useCallback(() => {
    setSelectedRequestId(null);
  }, []);

  // Refresh the kanban board when request is updated
  const handleRequestUpdated = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard Requests</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Submit feature requests or report data errors to help improve the dashboard.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${isActive
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'submit' && (
          <SubmitTab onSuccess={() => {
            setActiveTab('board');
            handleRequestUpdated();
          }} />
        )}
        {activeTab === 'board' && (
          <KanbanBoard
            key={refreshKey}
            canManageRequests={canManageRequests}
            onRequestClick={handleRequestClick}
          />
        )}
        {activeTab === 'analytics' && canManageRequests && (
          <RequestAnalytics />
        )}
      </div>

      {/* Request Detail Modal */}
      {selectedRequestId && (
        <RequestDetailModal
          requestId={selectedRequestId}
          isOpen={!!selectedRequestId}
          onClose={handleCloseModal}
          onUpdated={handleRequestUpdated}
          canManageRequests={canManageRequests}
        />
      )}
    </div>
  );
}

// Submit tab with the request form
function SubmitTab({ onSuccess }: { onSuccess?: () => void }) {
  return (
    <div className="max-w-2xl">
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <RequestForm onSuccess={onSuccess} />
      </div>
    </div>
  );
}

