'use client';

import React from 'react';
import { SGMDashboardMetrics } from '@/types/sgm-hub';
import { formatCurrency, formatAumCompact, formatNumber } from '@/lib/utils/date-helpers';

interface SGMDashboardScorecardsProps {
  metrics: SGMDashboardMetrics | null;
  loading: boolean;
  onMetricClick?: (metric: string) => void;
}

interface CardConfig {
  key: string;
  label: string;
  getValue: (m: SGMDashboardMetrics) => string;
  subtitle?: (m: SGMDashboardMetrics) => string;
  clickMetric?: string;
}

const CARDS: CardConfig[] = [
  {
    key: 'sqls',
    label: 'SQLs',
    getValue: (m) => formatNumber(m.sqls),
    clickMetric: 'sql',
  },
  {
    key: 'sqos',
    label: 'SQOs',
    getValue: (m) => formatNumber(m.sqos),
    clickMetric: 'sqo',
  },
  {
    key: 'signed',
    label: 'Signed',
    getValue: (m) => formatNumber(m.signed),
    clickMetric: 'signed',
  },
  {
    key: 'signedAum',
    label: 'Signed AUM',
    getValue: (m) => formatAumCompact(m.signedAum),
  },
  {
    key: 'joined',
    label: 'Joined',
    getValue: (m) => formatNumber(m.joined),
    clickMetric: 'joined',
  },
  {
    key: 'joinedAum',
    label: 'Joined AUM',
    getValue: (m) => formatAumCompact(m.joinedAum),
  },
  {
    key: 'openPipelineAum',
    label: 'Open Pipeline AUM',
    getValue: (m) => formatAumCompact(m.openPipelineAum),
    clickMetric: 'openPipeline',
  },
  {
    key: 'actualArr',
    label: 'Joined ARR (Actual)',
    getValue: (m) => formatCurrency(m.actualArr),
    subtitle: (m) => `n=${m.arrCoverageCount}`,
  },
  {
    key: 'estimatedArr',
    label: 'Pipeline Est. ARR',
    getValue: (m) => formatCurrency(m.estimatedArr),
    subtitle: (m) => `n=${m.estimatedArrCount}`,
  },
];

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="animate-pulse">
        <div className="bg-gray-200 dark:bg-gray-700 h-4 w-24 rounded mb-3" />
        <div className="bg-gray-200 dark:bg-gray-700 h-8 w-20 rounded" />
      </div>
    </div>
  );
}

export function SGMDashboardScorecards({ metrics, loading, onMetricClick }: SGMDashboardScorecardsProps) {
  if (loading || !metrics) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {CARDS.map(card => <SkeletonCard key={card.key} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {CARDS.map(card => {
        const isClickable = !!card.clickMetric && !!onMetricClick;
        return (
          <div
            key={card.key}
            onClick={isClickable ? () => onMetricClick!(card.clickMetric!) : undefined}
            className={`
              bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4
              ${isClickable ? 'cursor-pointer hover:border-blue-500 transition-colors' : ''}
            `}
          >
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              {card.label}
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {card.getValue(metrics)}
            </div>
            {card.subtitle && (
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {card.subtitle(metrics)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
