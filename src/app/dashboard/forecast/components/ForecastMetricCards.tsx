'use client';

import React, { useState } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { Info } from 'lucide-react';
import { ForecastRates } from '@/lib/queries/forecast-rates';
import { ForecastSummary } from '@/lib/queries/forecast-pipeline';

interface ForecastMetricCardsProps {
  summary: ForecastSummary | null;
  windowDays: 90 | 180 | 365 | null;
  rates: ForecastRates | null;
}

function formatAum(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

function getWindowLabel(days: 90 | 180 | 365 | null): string {
  if (days === null) return 'Jun 2025 - Dec 2025 (all-time)';
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const label = days === 90 ? '90d' : days === 180 ? '180d' : '1yr';
  return `${fmt(start)} - ${fmt(end)} (${label} window active)`;
}

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block ml-1">
      <Info
        className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help inline"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </span>
      )}
    </span>
  );
}

export function ForecastMetricCards({ summary, windowDays, rates }: ForecastMetricCardsProps) {
  if (!summary) return null;

  const cards = [
    {
      title: 'Open Pipeline AUM',
      value: formatAum(summary.pipeline_total_aum * 1e6),
      subtitle: `${summary.total_opps} opps (${summary.zero_aum_count} zero-AUM)`,
      tooltip: null,
    },
    {
      title: 'Expected Q2 AUM',
      value: formatAum(summary.q2_expected_aum),
      subtitle: `${summary.q2_opp_count} opps projected Q2 2026`,
      tooltip: 'Sum of each opp\'s AUM multiplied by its deterministic P(Join) — the product of historical stage-to-stage conversion rates for its remaining stages. Only opps whose projected join date falls in Q2 2026 are included. This is NOT a Monte Carlo estimate.',
    },
    {
      title: 'Expected Q3 AUM',
      value: formatAum(summary.q3_expected_aum),
      subtitle: `${summary.q3_opp_count} opps projected Q3 2026`,
      tooltip: 'Sum of each opp\'s AUM multiplied by its deterministic P(Join) — the product of historical stage-to-stage conversion rates for its remaining stages. Only opps whose projected join date falls in Q3 2026 are included. This is NOT a Monte Carlo estimate.',
    },
    {
      title: 'Conversion Window',
      value: rates ? `${rates.cohort_count} SQOs` : '-',
      subtitle: getWindowLabel(windowDays),
      tooltip: null,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(card => (
        <Card key={card.title} className="p-4">
          <Text>
            {card.title}
            {card.tooltip && <Tooltip text={card.tooltip} />}
          </Text>
          <Metric className="mt-1">{card.value}</Metric>
          <Text className="mt-1 text-xs">{card.subtitle}</Text>
        </Card>
      ))}
    </div>
  );
}
