'use client';

import { Card, Title } from '@tremor/react';
import { TrendDataPoint } from '@/types/dashboard';
import { useState } from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface ConversionTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
}

export function ConversionTrendChart({ trends, onGranularityChange }: ConversionTrendChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<'rates' | 'volume'>('rates');
  const [granularity, setGranularity] = useState<'month' | 'quarter'>('month');
  
  const handleGranularityChange = (value: string) => {
    const g = value as 'month' | 'quarter';
    setGranularity(g);
    onGranularityChange?.(g);
  };

  const chartData = trends.map(t => {
    const dataPoint = {
      period: t.period,
      // Convert rates from decimal (0-1) to percentage (0-100) for chart display
      'Contacted→MQL': (Number(t.contactedToMqlRate) || 0) * 100,
      'MQL→SQL': (Number(t.mqlToSqlRate) || 0) * 100,
      'SQL→SQO': (Number(t.sqlToSqoRate) || 0) * 100,
      'SQO→Joined': (Number(t.sqoToJoinedRate) || 0) * 100,
      SQLs: Number(t.sqls) || 0,
      SQOs: Number(t.sqos) || 0,
      Joined: Number(t.joined) || 0,
    };
    return dataPoint;
  });

  const rateCategories = ['Contacted→MQL', 'MQL→SQL', 'SQL→SQO', 'SQO→Joined'];
  const volumeCategories = ['SQLs', 'SQOs', 'Joined'];

  const rateColors = ['#3b82f6', '#10b981', '#eab308', '#a855f7']; // blue, green, yellow, purple
  const volumeColors = ['#3b82f6', '#10b981', '#a855f7']; // blue, green, purple

  const categories = selectedMetric === 'rates' ? rateCategories : volumeCategories;
  const colors = selectedMetric === 'rates' ? rateColors : volumeColors;

  const formatValue = (value: number) => {
    if (selectedMetric === 'rates') {
      return `${Number(value).toFixed(1)}%`;
    }
    return value.toLocaleString();
  };

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <Title>Conversion Trends</Title>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedMetric('rates')}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              selectedMetric === 'rates'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Rates
          </button>
          <button
            onClick={() => setSelectedMetric('volume')}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              selectedMetric === 'volume'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Volume
          </button>
          <select
            value={granularity}
            onChange={(e) => handleGranularityChange(e.target.value)}
            className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
          </select>
        </div>
      </div>
      
      {trends.length > 0 ? (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsLineChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="period" 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
                width={selectedMetric === 'rates' ? 60 : 80}
                tickFormatter={formatValue}
              />
              <Tooltip
                formatter={(value: number | undefined) => value !== undefined ? formatValue(value) : ''}
                labelStyle={{ color: '#374151', fontWeight: '600' }}
                contentStyle={{ 
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '8px 12px'
                }}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
                iconType="line"
              />
              {categories.map((category, index) => (
                <Line
                  key={category}
                  type="monotone"
                  dataKey={category}
                  stroke={colors[index]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </RechartsLineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No trend data available (received {trends.length} data points)
        </div>
      )}
    </Card>
  );
}
