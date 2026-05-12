'use client';

import { useState } from 'react';
import { Button } from '@tremor/react';
import { CoachingUsageClient } from './CoachingUsageTab';
import NeedsLinkingTab from './NeedsLinkingTab';

type CoachingSubTab = 'overview' | 'needs-linking';

interface CoachingUsageWrapperProps {
  role: string;
}

export default function CoachingUsageWrapper({ role }: CoachingUsageWrapperProps) {
  const isRevopsAdmin = role === 'revops_admin';
  const defaultTab: CoachingSubTab = isRevopsAdmin ? 'overview' : 'needs-linking';
  const [subTab, setSubTab] = useState<CoachingSubTab>(defaultTab);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        {isRevopsAdmin && (
          <Button
            size="xs"
            variant={subTab === 'overview' ? 'primary' : 'secondary'}
            onClick={() => setSubTab('overview')}
          >
            Overview
          </Button>
        )}
        <Button
          size="xs"
          variant={subTab === 'needs-linking' ? 'primary' : 'secondary'}
          onClick={() => setSubTab('needs-linking')}
        >
          Needs Linking
        </Button>
      </div>

      {subTab === 'overview' && isRevopsAdmin && <CoachingUsageClient />}
      {subTab === 'needs-linking' && <NeedsLinkingTab />}
    </div>
  );
}
