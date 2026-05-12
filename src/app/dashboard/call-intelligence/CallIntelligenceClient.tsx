'use client';

import { useState } from 'react';
import { ListChecks, Settings as SettingsIcon, Users, FileText, Sliders, PhoneCall, BarChart3, DollarSign } from 'lucide-react';
import type { CallIntelligenceTab } from '@/types/call-intelligence';
import { canEditRubrics } from '@/lib/permissions';
import QueueTab from './tabs/QueueTab';
import SettingsTab from './tabs/SettingsTab';
import AdminUsersTab from './tabs/AdminUsersTab';
import AdminRefinementsTab from './tabs/AdminRefinementsTab';
import { RubricsTab } from './tabs/RubricsTab';
import CoachingUsageWrapper from './tabs/CoachingUsageWrapper';
import InsightsTab from './tabs/InsightsTab';
import CostAnalysisTab from './tabs/CostAnalysisTab';

interface Props {
  role: string;
  initialTab?: CallIntelligenceTab;
  initialFocusRep: string | null;
}

const VALID_TABS: CallIntelligenceTab[] = ['queue', 'settings', 'admin-users', 'admin-refinements', 'rubrics', 'coaching-usage', 'insights', 'cost-analysis'];

export default function CallIntelligenceClient({ role, initialTab, initialFocusRep }: Props) {
  const isAdmin = role === 'admin' || role === 'revops_admin';
  const isRevopsAdmin = role === 'revops_admin';
  const isManagerOrAdmin = canEditRubrics(role);
  const safeInitial: CallIntelligenceTab =
    initialTab && VALID_TABS.includes(initialTab)
      ? initialTab
      : initialFocusRep && isManagerOrAdmin
        ? 'insights'
        : 'queue';
  const [activeTab, setActiveTab] = useState<CallIntelligenceTab>(safeInitial);

  // SGM/SGA see "My Evaluations" (coachee view); manager/admin see "Queue" (reviewer view).
  const queueLabel = role === 'sgm' || role === 'sga' ? 'My Evaluations' : 'Queue';
  const queueMode: 'mine' | 'queue' = role === 'sgm' || role === 'sga' ? 'mine' : 'queue';

  return (
    <div className="space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Call Intelligence</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          AI evaluations of advisor calls and content-refinement requests.
        </p>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          <TabButton active={activeTab === 'queue'} onClick={() => setActiveTab('queue')}>
            <ListChecks className="w-4 h-4" /> {queueLabel}
          </TabButton>
          <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
            <SettingsIcon className="w-4 h-4" /> My settings
          </TabButton>
          {isAdmin && (
            <TabButton active={activeTab === 'admin-users'} onClick={() => setActiveTab('admin-users')}>
              <Users className="w-4 h-4" /> Admin: Users
            </TabButton>
          )}
          {isAdmin && (
            <TabButton active={activeTab === 'admin-refinements'} onClick={() => setActiveTab('admin-refinements')}>
              <FileText className="w-4 h-4" /> Admin: Content Refinements
            </TabButton>
          )}
          {isManagerOrAdmin && (
            <TabButton active={activeTab === 'rubrics'} onClick={() => setActiveTab('rubrics')}>
              <Sliders className="w-4 h-4" /> Rubrics
            </TabButton>
          )}
          {(isRevopsAdmin || isManagerOrAdmin || role === 'sgm') && (
            <TabButton active={activeTab === 'coaching-usage'} onClick={() => setActiveTab('coaching-usage')}>
              <PhoneCall className="w-4 h-4" /> Coaching Usage
            </TabButton>
          )}
          {isManagerOrAdmin && (
            <TabButton active={activeTab === 'insights'} onClick={() => setActiveTab('insights')}>
              <BarChart3 className="w-4 h-4" /> Insights
            </TabButton>
          )}
          {isAdmin && (
            <TabButton active={activeTab === 'cost-analysis'} onClick={() => setActiveTab('cost-analysis')}>
              <DollarSign className="w-4 h-4" /> Cost Analysis
            </TabButton>
          )}
        </nav>
      </div>

      {activeTab === 'queue' && <QueueTab role={role} mode={queueMode} />}
      {activeTab === 'settings' && <SettingsTab />}
      {isAdmin && activeTab === 'admin-users' && <AdminUsersTab />}
      {isAdmin && activeTab === 'admin-refinements' && <AdminRefinementsTab />}
      {isManagerOrAdmin && activeTab === 'rubrics' && <RubricsTab />}
      {(isRevopsAdmin || isManagerOrAdmin || role === 'sgm') && activeTab === 'coaching-usage' && <CoachingUsageWrapper role={role} />}
      {isManagerOrAdmin && activeTab === 'insights' && (
        <InsightsTab initialFocusRep={initialFocusRep} />
      )}
      {isAdmin && activeTab === 'cost-analysis' && <CostAnalysisTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      {children}
    </button>
  );
}
