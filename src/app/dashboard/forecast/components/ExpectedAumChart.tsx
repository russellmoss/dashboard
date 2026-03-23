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

// Stable color palette for dynamic quarters
const QUARTER_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];

export default function ExpectedAumChart({ pipeline }: ExpectedAumChartProps) {
  // Discover all quarters from the data
  const quarters = useMemo(() => {
    const qSet = new Set<string>();
    for (const r of pipeline) {
      if (r.projected_quarter) qSet.add(r.projected_quarter);
    }
    return Array.from(qSet).sort((a, b) => {
      const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
      const [bq, by] = b.replace('Q', '').split(' ').map(Number);
      return ay !== by ? ay - by : aq - bq;
    });
  }, [pipeline]);

  const chartData = useMemo(() => {
    const stages = ['Discovery', 'Qualifying', 'Sales Process', 'Negotiating', 'Signed'];
    return stages.map(stage => {
      const stageRecords = pipeline.filter(r => r.StageName === stage);
      const entry: Record<string, any> = {
        stage: stage === 'Sales Process' ? 'SP' : stage === 'Negotiating' ? 'Neg' : stage,
        count: stageRecords.length,
      };
      for (const q of quarters) {
        entry[q] = stageRecords
          .filter(r => r.projected_quarter === q)
          .reduce((sum, r) => sum + r.expected_aum_weighted, 0);
      }
      return entry;
    }).filter(d => d.count > 0);
  }, [pipeline, quarters]);

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
          {quarters.map((q, i) => (
            <Bar
              key={q}
              dataKey={q}
              name={q}
              fill={QUARTER_COLORS[i % QUARTER_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
