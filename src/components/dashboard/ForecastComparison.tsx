'use client';

import { Card, Title, BarChart } from '@tremor/react';
import { ForecastData } from '@/types/dashboard';

interface ForecastComparisonProps {
  forecast: ForecastData[];
}

export function ForecastComparison({ forecast }: ForecastComparisonProps) {
  // Group forecast data by month and stage
  const groupedData = forecast.reduce((acc, item) => {
    const key = `${item.monthKey}_${item.stage}`;
    if (!acc[key]) {
      acc[key] = {
        period: item.monthKey,
        stage: item.stage,
        forecast: 0,
      };
    }
    acc[key].forecast += item.forecastValue;
    return acc;
  }, {} as Record<string, { period: string; stage: string; forecast: number }>);

  const chartData = Object.values(groupedData);

  return (
    <Card className="mb-6">
      <Title>Forecast Comparison</Title>
      {chartData.length > 0 ? (
        <BarChart
          data={chartData}
          index="period"
          categories={['forecast']}
          colors={['blue']}
          valueFormatter={(value) => value.toLocaleString()}
        />
      ) : (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No forecast data available
        </div>
      )}
    </Card>
  );
}
