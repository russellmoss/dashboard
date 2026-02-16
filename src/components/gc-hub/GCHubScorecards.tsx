// src/components/gc-hub/GCHubScorecards.tsx

'use client';

import { Card, Text, Metric } from '@tremor/react';
import { DollarSign, TrendingUp, Users, BarChart3 } from 'lucide-react';
import { formatCurrency, formatNumber, percentChange } from '@/lib/gc-hub/formatters';

interface GcSummaryItem {
  period: string;
  periodStart: string;
  totalRevenue: number;
  totalCommissions: number;
  totalAmountEarned: number;
  activeAdvisorCount: number;
  revenuePerAdvisor: number;
}

interface GCHubScorecardsProps {
  summary: GcSummaryItem[];
  isLoading?: boolean;
}

export function GCHubScorecards({ summary, isLoading = false }: GCHubScorecardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4 dark:bg-gray-800 dark:border-gray-700">
            <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          </Card>
        ))}
      </div>
    );
  }

  // Aggregate totals across ALL periods in view
  const totalRevenue = summary.reduce((sum, s) => sum + s.totalRevenue, 0);
  const totalAmountEarned = summary.reduce((sum, s) => sum + s.totalAmountEarned, 0);

  // Latest period metrics
  const sortedByDate = [...summary].sort(
    (a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime()
  );
  const latest = sortedByDate[sortedByDate.length - 1];
  const previous = sortedByDate.length > 1 ? sortedByDate[sortedByDate.length - 2] : null;

  const latestAdvisors = latest?.activeAdvisorCount ?? 0;
  const latestRevenuePerAdvisor = latest?.revenuePerAdvisor ?? 0;

  // Period-over-period change for advisors and rev/advisor
  const advisorChange = previous
    ? percentChange(previous.activeAdvisorCount, latestAdvisors)
    : null;
  const rpaChange = previous
    ? percentChange(previous.revenuePerAdvisor, latestRevenuePerAdvisor)
    : null;

  const cards = [
    {
      label: 'Total Revenue',
      value: formatCurrency(totalRevenue, true),
      subtext: `${summary.length} periods`,
      icon: <DollarSign className="w-5 h-5 text-blue-500 dark:text-blue-400" aria-hidden="true" />,
      change: null,
    },
    {
      label: 'Total Amount Earned',
      value: formatCurrency(totalAmountEarned, true),
      subtext: 'Revenue minus commissions',
      icon: <TrendingUp className="w-5 h-5 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />,
      change: null,
    },
    {
      label: 'Active Advisors',
      value: formatNumber(latestAdvisors),
      subtext: latest ? `Latest: ${latest.period}` : '—',
      icon: <Users className="w-5 h-5 text-violet-500 dark:text-violet-400" aria-hidden="true" />,
      change: advisorChange,
    },
    {
      label: 'Avg. Monthly Revenue/Advisor',
      value: formatCurrency(latestRevenuePerAdvisor, true),
      subtext: latest ? `Latest: ${latest.period}` : '—',
      icon: <BarChart3 className="w-5 h-5 text-cyan-500 dark:text-cyan-400" aria-hidden="true" />,
      change: rpaChange,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <Text className="text-gray-600 dark:text-gray-400">{card.label}</Text>
            {card.icon}
          </div>
          <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
            {card.value}
          </Metric>
          <div className="flex items-center gap-2 mt-1">
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {card.subtext}
            </Text>
            {card.change !== null && (
              <span
                className={`text-xs font-medium ${
                  card.change >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
                aria-label={`${card.change >= 0 ? 'Increased' : 'Decreased'} by ${Math.abs(card.change).toFixed(1)} percent`}
              >
                <span aria-hidden="true">{card.change >= 0 ? '↑' : '↓'}</span> {Math.abs(card.change).toFixed(1)}%
              </span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
