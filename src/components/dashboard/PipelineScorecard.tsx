'use client';

import React from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { OpenPipelineAumTooltip } from './OpenPipelineAumTooltip';

interface PipelineScorecardProps {
  totalAum: number;
  totalAumFormatted: string;
  advisorCount: number;
  loading?: boolean;
  onAumClick?: () => void;
  onAdvisorsClick?: () => void;
}

export function PipelineScorecard({
  totalAum,
  totalAumFormatted,
  advisorCount,
  loading = false,
  onAumClick,
  onAdvisorsClick,
}: PipelineScorecardProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
        </Card>
        <Card className="animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        </Card>
      </div>
    );
  }
  
  const aumInBillions = (totalAum / 1000000000).toFixed(2);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card 
        decoration="top" 
        decorationColor="blue"
        className={onAumClick ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' : ''}
        onClick={onAumClick}
      >
        <div className="flex items-center gap-2">
          <Text>Open Pipeline AUM</Text>
          <OpenPipelineAumTooltip />
        </div>
        <Metric className="mt-1">${aumInBillions}B</Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {totalAumFormatted}
        </Text>
      </Card>
      
      <Card 
        decoration="top" 
        decorationColor="green"
        className={onAdvisorsClick ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' : ''}
        onClick={onAdvisorsClick}
      >
        <Text>Open Pipeline Advisors</Text>
        <Metric className="mt-1">{advisorCount.toLocaleString()}</Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Unique opportunities in pipeline
        </Text>
      </Card>
    </div>
  );
}
