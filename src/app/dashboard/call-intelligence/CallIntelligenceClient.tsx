'use client';

import { useState } from 'react';
import { ListChecks, Settings as SettingsIcon, Users, FileText, Sliders, PhoneCall } from 'lucide-react';
import type { CallIntelligenceTab } from '@/types/call-intelligence';
import { canEditRubrics } from '@/lib/permissions';
import QueueTab from './tabs/QueueTab';
import SettingsTab from './tabs/SettingsTab';
import AdminUsersTab from './tabs/AdminUsersTab';
import AdminRefinementsTab from './tabs/AdminRefinementsTab';
import { RubricsTab } from './tabs/RubricsTab';
import { CoachingUsageClient } from './tabs/CoachingUsageTab';

interface Props {
  role: string;
  initialTab?: CallIntelligenceTab;
}

const VALID_TABS: CallIntelligenceTab[] = ['queue', 'settings', 'admin-users', 'admin-refinements', 'rubrics', 'coaching-usage'];

export default function CallIntelligenceClient({ role, initialTab }: Props) {
  const isAdmin = role === 'admin' || role === 'revops_admin';
  const isRevopsAdmin = role === 'revops_admin';
  const isManagerOrAdmin = canEditRubrics(role);
  const safeInitial: CallIntelligenceTab =
    initialTab && VALID_TABS.includes(initialTab) ? initialTab : 'queue';
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
          {isRevopsAdmin && (
            <TabButton active={activeTab === 'coaching-usage'} onClick={() => setActiveTab('coaching-usage')}>
              <PhoneCall className="w-4 h-4" /> Coaching Usage
            </TabButton>
          )}
        </nav>
      </div>

      {activeTab === 'queue' && <QueueTab role={role} mode={queueMode} />}
      {activeTab === 'settings' && <SettingsTab />}
      {isAdmin && activeTab === 'admin-users' && <AdminUsersTab />}
      {isAdmin && activeTab === 'admin-refinements' && <AdminRefinementsTab />}
      {isManagerOrAdmin && activeTab === 'rubrics' && <RubricsTab />}
      {isRevopsAdmin && activeTab === 'coaching-usage' && <CoachingUsageClient />}
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
