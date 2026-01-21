'use client';

import { Card, Metric, Text, Flex, BadgeDelta, Grid } from '@tremor/react';
import { ConversionRatesResponse } from '@/types/dashboard';
import { formatPercent } from '@/lib/utils/date-helpers';
import { useState } from 'react';

// Info icon component for tooltips
const InfoIcon = ({ className = '' }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={`h-3.5 w-3.5 text-gray-400 hover:text-gray-600 cursor-help ${className}`}
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor"
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth={2} 
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
    />
  </svg>
);

// Simple tooltip component
const SimpleTooltip = ({ content, children }: { content: string; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="relative inline-block">
      <div 
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onClick={() => setIsOpen(!isOpen)}
      >
        {children}
      </div>
      {isOpen && (
        <div className="absolute z-50 w-64 p-3 bg-white rounded-lg shadow-xl border border-gray-200 -left-2 mt-2">
          <div className="absolute -top-2 left-4 w-4 h-4 bg-white border-l border-t border-gray-200 transform rotate-45" />
          <p className="text-sm text-gray-700">{content}</p>
        </div>
      )}
    </div>
  );
};

interface ConversionRateCardsProps {
  conversionRates: ConversionRatesResponse;
  previousRates?: ConversionRatesResponse;
  isLoading?: boolean;
  visibleRates?: {
    contactedToMql: boolean;
    mqlToSql: boolean;
    sqlToSqo: boolean;
    sqoToJoined: boolean;
  };
}

interface RateCardProps {
  title: string;
  rate: number;
  label: string;
  previousRate?: number;
  isResolved: boolean;
}

function RateCard({ title, rate, label, previousRate, isResolved }: RateCardProps) {
  const ratePercent = (rate * 100).toFixed(1);
  
  // Calculate delta if previous rate exists
  const delta = previousRate !== undefined 
    ? ((rate - previousRate) * 100).toFixed(1)
    : undefined;
  
  const deltaType = delta !== undefined
    ? parseFloat(delta) > 0 ? 'increase' : parseFloat(delta) < 0 ? 'decrease' : 'unchanged'
    : undefined;

  return (
    <Card className="p-4">
      <Flex flexDirection="col" alignItems="start" className="gap-1">
        <Text className="text-sm text-gray-500">{title}</Text>
        <Flex alignItems="baseline" className="gap-2">
          <Metric className="text-2xl">{ratePercent}%</Metric>
          {delta !== undefined && deltaType && (
            <BadgeDelta deltaType={deltaType} size="sm">
              {delta}%
            </BadgeDelta>
          )}
        </Flex>
        {isResolved && label.includes('resolved') ? (
          <SimpleTooltip 
            content="Only includes records that have a final outcome (converted to next stage OR closed/lost). Open records still being worked are excluded."
          >
            <Text className={`text-xs text-blue-600 cursor-help`}>
              {label}
            </Text>
          </SimpleTooltip>
        ) : (
          <Text className={`text-xs ${isResolved ? 'text-blue-600' : 'text-gray-400'}`}>
            {label}
          </Text>
        )}
      </Flex>
    </Card>
  );
}

export function ConversionRateCards({ 
  conversionRates, 
  previousRates,
  isLoading,
  visibleRates = { contactedToMql: true, mqlToSql: true, sqlToSqo: true, sqoToJoined: true },
}: ConversionRateCardsProps) {
  const isResolved = conversionRates.mode === 'cohort';

  // Don't render if no rates are visible
  if (!visibleRates.contactedToMql && !visibleRates.mqlToSql && 
      !visibleRates.sqlToSqo && !visibleRates.sqoToJoined) {
    return null;
  }

  if (isLoading) {
    return (
      <Grid numItemsSm={2} numItemsLg={4} className="gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-8 bg-gray-200 rounded w-16 mb-1" />
            <div className="h-3 bg-gray-200 rounded w-20" />
          </Card>
        ))}
      </Grid>
    );
  }

  return (
    <div className="space-y-2 mb-6">
      {/* Mode indicator */}
      <div className="flex items-center gap-2">
        <Text className="text-xs text-gray-500">
          {isResolved 
            ? 'Showing cohort efficiency rates (resolved records only)' 
            : 'Showing period snapshot rates (resolved in-period only)'
          }
        </Text>
        <SimpleTooltip 
          content={
            isResolved 
              ? 'Cohort Mode: Shows conversion efficiency for leads that originated in this period AND have resolved (converted or closed). Open records still being worked are excluded. Rates are always 0-100%.'
              : 'Period Mode: Shows conversion rates for records that entered AND resolved (converted or closed) within this period. In-flight records are excluded for a clean snapshot. Rates are always 0-100%.'
          }
        >
          <InfoIcon />
        </SimpleTooltip>
        {isResolved && (
          <SimpleTooltip 
            content="Only includes records that have a final outcome (converted to next stage OR closed/lost). Open records still being worked are excluded."
          >
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 cursor-help">
              Resolved only
              <InfoIcon className="h-3 w-3" />
            </span>
          </SimpleTooltip>
        )}
      </div>

      {/* Rate Cards */}
      <Grid numItemsSm={2} numItemsLg={4} className="gap-4">
        {visibleRates.contactedToMql && (
          <RateCard
            title="Contacted → MQL"
            rate={conversionRates.contactedToMql.rate}
            label={conversionRates.contactedToMql.label}
            previousRate={previousRates?.contactedToMql.rate}
            isResolved={isResolved}
          />
        )}
        {visibleRates.mqlToSql && (
          <RateCard
            title="MQL → SQL"
            rate={conversionRates.mqlToSql.rate}
            label={conversionRates.mqlToSql.label}
            previousRate={previousRates?.mqlToSql.rate}
            isResolved={isResolved}
          />
        )}
        {visibleRates.sqlToSqo && (
          <RateCard
            title="SQL → SQO"
            rate={conversionRates.sqlToSqo.rate}
            label={conversionRates.sqlToSqo.label}
            previousRate={previousRates?.sqlToSqo.rate}
            isResolved={isResolved}
          />
        )}
        {visibleRates.sqoToJoined && (
          <RateCard
            title="SQO → Joined"
            rate={conversionRates.sqoToJoined.rate}
            label={conversionRates.sqoToJoined.label}
            previousRate={previousRates?.sqoToJoined.rate}
            isResolved={isResolved}
          />
        )}
      </Grid>
    </div>
  );
}
