'use client';

import { Card, Title, LineChart } from '@tremor/react';
import { TrendDataPoint } from '@/types/dashboard';

interface VolumeTrendChartProps {
  trends: TrendDataPoint[];
}

export function VolumeTrendChart({ trends }: VolumeTrendChartProps) {
  const chartData = trends.map(t => ({
    period: t.period,
    SQLs: t.sqls,
    SQOs: t.sqos,
    Joined: t.joined,
  }));

  return (
    <Card className="mb-6">
      <Title>Volume Trends</Title>
      {trends.length > 0 ? (
        <LineChart
          data={chartData}
          index="period"
          categories={['SQLs', 'SQOs', 'Joined']}
          colors={['blue', 'green', 'purple']}
          valueFormatter={(value) => value.toLocaleString()}
          yAxisWidth={80}
        />
      ) : (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No trend data available
        </div>
      )}
    </Card>
  );
}
