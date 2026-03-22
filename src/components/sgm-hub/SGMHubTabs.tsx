'use client';

import { Trophy, LayoutDashboard, Target } from 'lucide-react';
import { SGMHubTab } from '@/types/sgm-hub';

export type { SGMHubTab };

interface SGMHubTabsProps {
  activeTab: SGMHubTab;
  onTabChange: (tab: SGMHubTab) => void;
}

const tabs: { id: SGMHubTab; label: string; icon: typeof Trophy }[] = [
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'quota-tracking', label: 'Quota Tracking', icon: Target },
];

export function SGMHubTabs({ activeTab, onTabChange }: SGMHubTabsProps) {
  return (
    <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
