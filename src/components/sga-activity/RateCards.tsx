'use client';

import React from 'react';
import { Card, Text } from '@tremor/react';
import { SMSResponseRate, CallAnswerRate } from '@/types/sga-activity';

interface RateCardsProps {
  smsRate: SMSResponseRate;
  callRate: CallAnswerRate;
}

// Gauge component for displaying rates
function Gauge({ value, color = 'blue' }: { value: number; color?: 'blue' | 'green' | 'red' }) {
  const percentage = Math.min(Math.max(value, 0), 100);
  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  
  const colorClasses = {
    blue: 'text-blue-500',
    green: 'text-green-500',
    red: 'text-red-500',
  };
  
  const strokeColors = {
    blue: 'rgb(59 130 246)',
    green: 'rgb(34 197 94)',
    red: 'rgb(239 68 68)',
  };

  return (
    <div className="relative w-32 h-32 mx-auto">
      <svg className="transform -rotate-90 w-32 h-32" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          className="text-gray-200 dark:text-gray-700"
        />
        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          stroke={strokeColors[color]}
          strokeWidth="8"
          fill="none"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-2xl font-bold ${colorClasses[color]}`}>
          {percentage.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export default function RateCards({ smsRate, callRate }: RateCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* SMS Response Rate */}
      <Card className="dark:bg-gray-800 dark:border-gray-700 h-full flex flex-col">
        <Text className="text-gray-600 dark:text-gray-400 mb-4">SMS Response Rate</Text>
        <div className="flex-1 flex items-center justify-center">
          <Gauge value={smsRate.responseRatePercent} color="blue" />
        </div>
        <Text className="text-sm text-gray-500 dark:text-gray-400 mt-4 text-center">
          {smsRate.inboundCount.toLocaleString()} people responded / {smsRate.outboundCount.toLocaleString()} people texted
        </Text>
      </Card>

      {/* Call Answer Rate */}
      <Card className="dark:bg-gray-800 dark:border-gray-700 h-full flex flex-col">
        <Text className="text-gray-600 dark:text-gray-400 mb-4">Call Answer Rate</Text>
        <div className="flex-1 flex items-center justify-center">
          <Gauge value={callRate.answerRatePercent} color="green" />
        </div>
        <Text className="text-sm text-gray-500 dark:text-gray-400 mt-4 text-center">
          {callRate.answeredCount.toLocaleString()} answered / {callRate.outboundCount.toLocaleString()} total
        </Text>
      </Card>
    </div>
  );
}

