'use client';

import { Card, Metric, Text } from '@tremor/react';
import { ConversionRates } from '@/types/dashboard';
import { formatPercent } from '@/lib/utils/date-helpers';

interface ConversionRateCardsProps {
  rates: ConversionRates;
}

export function ConversionRateCards({ rates }: ConversionRateCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card className="p-4">
        <Text className="text-gray-600 mb-2">Contacted → MQL</Text>
        <Metric className="text-2xl font-bold">{formatPercent(rates.contactedToMql.rate)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">
          {rates.contactedToMql.numerator.toLocaleString()} / {rates.contactedToMql.denominator.toLocaleString()}
        </Text>
      </Card>

      <Card className="p-4">
        <Text className="text-gray-600 mb-2">MQL → SQL</Text>
        <Metric className="text-2xl font-bold">{formatPercent(rates.mqlToSql.rate)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">
          {rates.mqlToSql.numerator.toLocaleString()} / {rates.mqlToSql.denominator.toLocaleString()}
        </Text>
      </Card>

      <Card className="p-4">
        <Text className="text-gray-600 mb-2">SQL → SQO</Text>
        <Metric className="text-2xl font-bold">{formatPercent(rates.sqlToSqo.rate)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">
          {rates.sqlToSqo.numerator.toLocaleString()} / {rates.sqlToSqo.denominator.toLocaleString()}
        </Text>
      </Card>

      <Card className="p-4">
        <Text className="text-gray-600 mb-2">SQO → Joined</Text>
        <Metric className="text-2xl font-bold">{formatPercent(rates.sqoToJoined.rate)}</Metric>
        <Text className="text-xs text-gray-500 mt-1">
          {rates.sqoToJoined.numerator.toLocaleString()} / {rates.sqoToJoined.denominator.toLocaleString()}
        </Text>
      </Card>
    </div>
  );
}
