'use client';

import React from 'react';
import { BarChart3, FileSpreadsheet } from 'lucide-react';

export type ForecastTab = 'pipeline' | 'exports';

interface ForecastTabsProps {
  activeTab: ForecastTab;
  onTabChange: (tab: ForecastTab) => void;
}

const TABS: { id: ForecastTab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'pipeline', label: 'Pipeline Forecast', icon: BarChart3 },
  { id: 'exports', label: 'Exports', icon: FileSpreadsheet },
];

export function ForecastTabs({ activeTab, onTabChange }: ForecastTabsProps) {
  return (
    <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700" role="tablist">
      {TABS.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
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
