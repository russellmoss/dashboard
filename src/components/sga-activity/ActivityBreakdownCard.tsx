'use client';

import React, { useState, useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ActivityBreakdown, ActivityChannel } from '@/types/sga-activity';

interface ActivityBreakdownCardProps {
  breakdowns: ActivityBreakdown[];
  onChannelClick: (channel: string) => void;
}

// Color mapping for each channel - using hex colors directly
const CHANNEL_COLORS: Record<ActivityChannel, string> = {
  'SMS': '#10b981',      // emerald-500
  'Call': '#3b82f6',     // blue-500
  'Email': '#8b5cf6',     // violet-500
  'LinkedIn': '#06b6d4',  // cyan-500
  'Other': '#f59e0b',     // amber-500 (for debugging/monitoring)
};

export default function ActivityBreakdownCard({
  breakdowns,
  onChannelClick,
}: ActivityBreakdownCardProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  // Memoize all chart data transformations
  const { donutData, grandTotal } = useMemo(() => {
    // Group by channel and calculate totals
    const channelMap = new Map<string, number>();

    for (const breakdown of breakdowns) {
      const currentCount = channelMap.get(breakdown.channel) || 0;
      channelMap.set(breakdown.channel, currentCount + breakdown.count);
    }

    // Prepare data for donut chart - maintain consistent order for color mapping
    const channelOrder: ActivityChannel[] = ['SMS', 'Call', 'Email', 'LinkedIn'];
    const sortedChannels = Array.from(channelMap.entries()).sort((a, b) => {
      // Sort by predefined order first, then by count
      const aIndex = channelOrder.indexOf(a[0] as ActivityChannel);
      const bIndex = channelOrder.indexOf(b[0] as ActivityChannel);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return b[1] - a[1];
    });

    const data = sortedChannels.map(([channel, count]) => ({
      name: channel,
      value: count,
      color: CHANNEL_COLORS[channel as ActivityChannel] || '#6b7280',
    }));

    const total = data.reduce((sum, item) => sum + item.value, 0);

    return { donutData: data, grandTotal: total };
  }, [breakdowns]);

  const handlePieClick = (data: any, index: number) => {
    if (data && data.name) {
      onChannelClick(data.name);
    }
    setActiveIndex(activeIndex === index ? undefined : index);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-md p-3">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: data.payload.color }}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {data.name}: {data.value.toLocaleString()}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <Text className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Activity Breakdown</Text>
      
      <div className="flex flex-col items-center">
        <ResponsiveContainer width="100%" height={256}>
          <PieChart>
            <Pie
              data={donutData}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={100}
              innerRadius={75}
              fill="#8884d8"
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              onClick={handlePieClick}
              style={{ cursor: 'pointer' }}
            >
              {donutData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  opacity={activeIndex === undefined || activeIndex === index ? 1 : 0.3}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <Text className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
          Total: {grandTotal.toLocaleString()} activities
        </Text>
      </div>
    </Card>
  );
}
