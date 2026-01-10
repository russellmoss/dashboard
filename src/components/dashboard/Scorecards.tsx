'use client';

import { Card, Metric, Text, Badge } from '@tremor/react';
import { FunnelMetrics } from '@/types/dashboard';
import { formatCurrency, formatNumber } from '@/lib/utils/date-helpers';
import { TrendingUp, Users, DollarSign, Package } from 'lucide-react';

interface ScorecardsProps {
  metrics: FunnelMetrics;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
}

export function Scorecards({ metrics, selectedMetric, onMetricClick }: ScorecardsProps) {
  const isSelected = (id: string) => selectedMetric === id;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card 
        className={`p-4 ${onMetricClick ? 'cursor-pointer transition-all hover:bg-gray-50 ' + (isSelected('sql') ? 'ring-2 ring-blue-500 bg-blue-50' : '') : ''}`}
        onClick={() => onMetricClick?.('sql')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600">SQLs</Text>
          <Users className="w-5 h-5 text-blue-500" />
        </div>
        <Metric className="text-2xl font-bold">{formatNumber(metrics.sqls)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">Sales Qualified Leads</Text>
      </Card>

      <Card 
        className={`p-4 ${onMetricClick ? 'cursor-pointer transition-all hover:bg-gray-50 ' + (isSelected('sqo') ? 'ring-2 ring-blue-500 bg-blue-50' : '') : ''}`}
        onClick={() => onMetricClick?.('sqo')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600">SQOs</Text>
          <TrendingUp className="w-5 h-5 text-green-500" />
        </div>
        <Metric className="text-2xl font-bold">{formatNumber(metrics.sqos)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">Sales Qualified Opportunities</Text>
      </Card>

      <Card 
        className={`p-4 ${onMetricClick ? 'cursor-pointer transition-all hover:bg-gray-50 ' + (isSelected('joined') ? 'ring-2 ring-blue-500 bg-blue-50' : '') : ''}`}
        onClick={() => onMetricClick?.('joined')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600">Joined</Text>
          <Package className="w-5 h-5 text-purple-500" />
        </div>
        <Metric className="text-2xl font-bold">{formatNumber(metrics.joined)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">Advisors Joined</Text>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600">Open Pipeline AUM</Text>
          <DollarSign className="w-5 h-5 text-yellow-500" />
        </div>
        <Metric className="text-2xl font-bold">{formatCurrency(metrics.openPipelineAum)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">Current open pipeline (all time)</Text>
      </Card>
    </div>
  );
}
