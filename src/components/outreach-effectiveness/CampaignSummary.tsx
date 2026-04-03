'use client';

import React from 'react';
import { Card, Text } from '@tremor/react';
import { CampaignSummaryData } from '@/types/outreach-effectiveness';

interface CampaignSummaryProps {
  data: CampaignSummaryData;
}

export default function CampaignSummary({ data }: CampaignSummaryProps) {
  return (
    <Card className="p-4">
      <Text className="text-lg font-semibold mb-3">Campaign: {data.campaignName}</Text>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div>
          <Text className="text-xs text-gray-500 dark:text-gray-400">Total Leads</Text>
          <Text className="text-xl font-bold">{data.totalLeads}</Text>
        </div>
        <div>
          <Text className="text-xs text-gray-500 dark:text-gray-400">Contacted</Text>
          <Text className="text-xl font-bold">{data.contactedLeads}</Text>
        </div>
        <div>
          <Text className="text-xs text-gray-500 dark:text-gray-400">Avg Touches</Text>
          <Text className="text-xl font-bold">{data.avgTouchesBeforeClose.toFixed(1)}</Text>
        </div>
        <div>
          <Text className="text-xs text-gray-500 dark:text-gray-400">5+ Touchpoints</Text>
          <Text className="text-xl font-bold">{data.pct5PlusTouchpoints.toFixed(1)}%</Text>
        </div>
        <div>
          <Text className="text-xs text-gray-500 dark:text-gray-400">Multi-Channel</Text>
          <Text className="text-xl font-bold">{data.multiChannelPct.toFixed(1)}%</Text>
        </div>
      </div>
    </Card>
  );
}
