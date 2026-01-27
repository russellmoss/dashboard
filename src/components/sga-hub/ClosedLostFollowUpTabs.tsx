// src/components/sga-hub/ClosedLostFollowUpTabs.tsx

'use client';

import { useState } from 'react';
import { ClosedLostRecord, ReEngagementOpportunity } from '@/types/sga-hub';
import { ClosedLostTable } from './ClosedLostTable';
import { ReEngagementOpportunitiesTable } from './ReEngagementOpportunitiesTable';

interface ClosedLostFollowUpTabsProps {
  closedLostRecords: ClosedLostRecord[];
  reEngagementOpportunities: ReEngagementOpportunity[];
  closedLostLoading?: boolean;
  reEngagementLoading?: boolean;
  onClosedLostRecordClick?: (record: ClosedLostRecord) => void;
  onReEngagementClick?: (opportunity: ReEngagementOpportunity) => void;
  showAllRecords?: boolean;
  onToggleShowAll?: (showAll: boolean) => void;
}

type TabType = 'closed-lost' | 're-engagement';

export function ClosedLostFollowUpTabs({
  closedLostRecords,
  reEngagementOpportunities,
  closedLostLoading = false,
  reEngagementLoading = false,
  onClosedLostRecordClick,
  onReEngagementClick,
  showAllRecords = false,
  onToggleShowAll,
}: ClosedLostFollowUpTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('closed-lost');
  
  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-4 border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8" aria-label="Tabs">
          <button
            onClick={() => setActiveTab('closed-lost')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${
                activeTab === 'closed-lost'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }
            `}
          >
            Closed Lost Follow-Up
            {closedLostRecords.length > 0 && (
              <span className="ml-2 py-0.5 px-2 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                {closedLostRecords.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('re-engagement')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm transition-colors
              ${
                activeTab === 're-engagement'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }
            `}
          >
            Open Re-Engagement Opportunities
            {reEngagementOpportunities.length > 0 && (
              <span className="ml-2 py-0.5 px-2 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                {reEngagementOpportunities.length}
              </span>
            )}
          </button>
        </nav>
      </div>
      
      {/* Tab Content */}
      {activeTab === 'closed-lost' && (
        <ClosedLostTable
          records={closedLostRecords}
          isLoading={closedLostLoading}
          onRecordClick={onClosedLostRecordClick}
          showAllRecords={showAllRecords}
          onToggleShowAll={onToggleShowAll}
        />
      )}
      
      {activeTab === 're-engagement' && (
        <ReEngagementOpportunitiesTable
          opportunities={reEngagementOpportunities}
          isLoading={reEngagementLoading}
          onRecordClick={onReEngagementClick}
        />
      )}
    </div>
  );
}
