'use client';

import React from 'react';
import { Card, Text } from '@tremor/react';
import { TrendingUp, Clock, DollarSign, Users } from 'lucide-react';

interface RateShape {
  sqo_to_sp: number;
  sp_to_neg: number;
  neg_to_signed: number;
  signed_to_joined: number;
  avg_days_sqo_to_sp: number;
  avg_days_in_sp: number;
  avg_days_in_neg: number;
  avg_days_in_signed: number;
  mean_joined_aum: number;
  joined_deal_count: number;
  cohort_count: number;
}

interface RatesSummaryBarProps {
  rates: RateShape | null;
  windowDays: 180 | 365 | 730 | null;
}

function formatAum(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return '$0';
}

function windowLabel(days: 180 | 365 | 730 | null): string {
  if (days === 180) return '180d';
  if (days === 365) return '1yr';
  if (days === 730) return '2yr';
  return 'All time';
}

const STAGES = [
  { key: 'sqo_to_sp', daysKey: 'avg_days_sqo_to_sp', label: 'SQO → SP', color: 'blue' },
  { key: 'sp_to_neg', daysKey: 'avg_days_in_sp', label: 'SP → Neg', color: 'cyan' },
  { key: 'neg_to_signed', daysKey: 'avg_days_in_neg', label: 'Neg → Signed', color: 'violet' },
  { key: 'signed_to_joined', daysKey: 'avg_days_in_signed', label: 'Signed → Joined', color: 'emerald' },
] as const;

export function RatesSummaryBar({ rates, windowDays }: RatesSummaryBarProps) {
  if (!rates) return null;

  const e2eRate = rates.sqo_to_sp * rates.sp_to_neg * rates.neg_to_signed * rates.signed_to_joined;
  const totalDays = Math.round(rates.avg_days_sqo_to_sp + rates.avg_days_in_sp + rates.avg_days_in_neg + rates.avg_days_in_signed);
  const expectedAumPerSqo = rates.mean_joined_aum * e2eRate;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Text className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Trailing Rates &middot; {windowLabel(windowDays)} window &middot; {rates.cohort_count} SQO cohort &middot; {rates.joined_deal_count} joined
        </Text>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* Stage conversion rates */}
        {STAGES.map(({ key, daysKey, label, color }) => (
          <Card
            key={key}
            decoration="top"
            decorationColor={color}
            className="p-3"
          >
            <Text className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{label}</Text>
            <p className="text-lg font-semibold mt-0.5">{(rates[key] * 100).toFixed(1)}%</p>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">~{Math.round(rates[daysKey])}d avg</p>
          </Card>
        ))}

        {/* SQO → Joined (end-to-end) */}
        <Card decoration="top" decorationColor="blue" className="p-3">
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-blue-500" />
            <Text className="text-[10px] text-gray-500 dark:text-gray-400">SQO → Joined</Text>
          </div>
          <p className="text-lg font-semibold text-blue-600 dark:text-blue-400 mt-0.5">{(e2eRate * 100).toFixed(1)}%</p>
        </Card>

        {/* Velocity */}
        <Card decoration="top" decorationColor="amber" className="p-3">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" />
            <Text className="text-[10px] text-gray-500 dark:text-gray-400">Velocity</Text>
          </div>
          <p className="text-lg font-semibold mt-0.5">~{totalDays}d</p>
        </Card>

        {/* Avg Joined AUM */}
        <Card decoration="top" decorationColor="green" className="p-3">
          <div className="flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-green-500" />
            <Text className="text-[10px] text-gray-500 dark:text-gray-400">Avg Joined AUM</Text>
          </div>
          <p className="text-lg font-semibold mt-0.5">{formatAum(rates.mean_joined_aum)}</p>
        </Card>

        {/* Expected AUM per SQO */}
        <Card decoration="top" decorationColor="indigo" className="p-3">
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3 text-indigo-500" />
            <Text className="text-[10px] text-gray-500 dark:text-gray-400">AUM/SQO</Text>
          </div>
          <p className="text-lg font-semibold mt-0.5">{formatAum(expectedAumPerSqo)}</p>
        </Card>
      </div>
    </div>
  );
}
