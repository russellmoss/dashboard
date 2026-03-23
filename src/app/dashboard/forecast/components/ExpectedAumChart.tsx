'use client';

import React, { useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ForecastPipelineRecord } from '@/lib/queries/forecast-pipeline';

interface ExpectedAumChartProps {
  pipeline: ForecastPipelineRecord[];
}

function formatAumShort(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

export default function ExpectedAumChart({ pipeline }: ExpectedAumChartProps) {
  const chartData = useMemo(() => {
    const stages = ['Discovery', 'Qualifying', 'Sales Process', 'Negotiating', 'Signed'];
    return stages.map(stage => {
      const stageRecords = pipeline.filter(r => r.StageName === stage);
      return {
        stage: stage === 'Sales Process' ? 'SP' : stage === 'Negotiating' ? 'Neg' : stage,
        Q2: stageRecords.reduce((sum, r) => sum + r.expected_aum_q2, 0),
        Q3: stageRecords.reduce((sum, r) => sum + r.expected_aum_q3, 0),
        count: stageRecords.length,
      };
    }).filter(d => d.count > 0);
  }, [pipeline]);

  return (
    <Card className="p-4">
      <Text className="font-semibold mb-3">Expected AUM by Stage & Quarter</Text>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={formatAumShort} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value) => formatAumShort(Number(value))}
            labelFormatter={(label) => `Stage: ${label}`}
          />
          <Legend />
          <Bar dataKey="Q2" name="Q2 2026" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Q3" name="Q3 2026" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
