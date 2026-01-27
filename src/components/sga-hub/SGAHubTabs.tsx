'use client';

import { Button } from '@tremor/react';
import { Trophy, Target, AlertCircle, TrendingUp, PhoneCall } from 'lucide-react';

export type SGAHubTab = 'leaderboard' | 'weekly-goals' | 'closed-lost' | 'quarterly-progress' | 'activity';

interface SGAHubTabsProps {
  activeTab: SGAHubTab;
  onTabChange: (tab: SGAHubTab) => void;
}

export function SGAHubTabs({ activeTab, onTabChange }: SGAHubTabsProps) {
  const tabs: { id: SGAHubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
    { id: 'weekly-goals', label: 'Weekly Goals', icon: <Target className="w-4 h-4" /> },
    { id: 'closed-lost', label: 'Closed Lost Follow-Up', icon: <AlertCircle className="w-4 h-4" /> },
    { id: 'quarterly-progress', label: 'Quarterly Progress', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'activity', label: 'Activity', icon: <PhoneCall className="w-4 h-4" /> },
  ];
  
  return (
    <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            px-4 py-2 text-sm font-medium transition-colors
            flex items-center gap-2
            border-b-2 -mb-px
            ${
              activeTab === tab.id
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
            }
          `}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
