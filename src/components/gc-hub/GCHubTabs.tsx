// src/components/gc-hub/GCHubTabs.tsx

'use client';

import { BarChart3, Users } from 'lucide-react';
import type { GcHubTab } from '@/types/gc-hub';

interface GCHubTabsProps {
  activeTab: GcHubTab;
  onTabChange: (tab: GcHubTab) => void;
  isCapitalPartner?: boolean;
}

const TABS: { id: GcHubTab; label: string; icon: React.ReactNode; cpVisible: boolean }[] = [
  { id: 'overview', label: 'Portfolio Overview', icon: <BarChart3 className="w-4 h-4" />, cpVisible: true },
  { id: 'advisor-detail', label: 'Advisor Detail', icon: <Users className="w-4 h-4" />, cpVisible: true },
];

export function GCHubTabs({ activeTab, onTabChange, isCapitalPartner = false }: GCHubTabsProps) {
  const visibleTabs = isCapitalPartner ? TABS.filter(t => t.cpVisible) : TABS;

  return (
    <div
      role="tablist"
      aria-label="GC Hub navigation tabs"
      className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto"
    >
      {visibleTabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`gc-hub-tabpanel-${tab.id}`}
            id={`gc-hub-tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => {
              // Arrow key navigation for tabs
              if (e.key === 'ArrowRight') {
                const nextIndex = (index + 1) % visibleTabs.length;
                onTabChange(visibleTabs[nextIndex].id);
              } else if (e.key === 'ArrowLeft') {
                const prevIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
                onTabChange(visibleTabs[prevIndex].id);
              }
            }}
            className={`
              px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap
              flex items-center gap-2
              border-b-2 -mb-px
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset
              ${
                isActive
                  ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
              }
            `}
          >
            <span aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
