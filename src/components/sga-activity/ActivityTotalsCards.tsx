'use client';

import React from 'react';
import { Card, Metric, Text, Grid } from '@tremor/react';
import { Phone, MessageSquare, Linkedin, Mail } from 'lucide-react';

interface ActivityTotalsCardsProps {
  totals: {
    coldCalls: number;
    outboundCalls: number;
    smsOutbound: number;
    smsInbound: number;
    linkedInMessages: number;
    emailsManual: number;
    emailsEngagement: number;
  };
  onCardClick: (activityType: string) => void;
}

export default function ActivityTotalsCards({ totals, onCardClick }: ActivityTotalsCardsProps) {
  const cards: Array<{
    key: string;
    label: string;
    value: number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    suffix: string;
  }> = [
    {
      key: 'cold_calls',
      label: 'Cold Calls',
      value: totals.coldCalls,
      icon: Phone,
      color: 'text-orange-500',
      suffix: '',
    },
    {
      key: 'outbound_calls',
      label: 'Outbound Calls',
      value: totals.outboundCalls,
      icon: Phone,
      color: 'text-blue-500',
      suffix: '',
    },
    {
      key: 'sms_outbound',
      label: 'SMS Sent',
      value: totals.smsOutbound,
      icon: MessageSquare,
      color: 'text-green-500',
      suffix: ' messages',
    },
    {
      key: 'sms_inbound',
      label: 'SMS Received',
      value: totals.smsInbound,
      icon: MessageSquare,
      color: 'text-teal-500',
      suffix: ' messages',
    },
    {
      key: 'linkedin_messages',
      label: 'LinkedIn Messages',
      value: totals.linkedInMessages,
      icon: Linkedin,
      color: 'text-blue-600',
      suffix: '',
    },
    {
      key: 'emails_manual',
      label: 'Emails',
      value: totals.emailsManual,
      icon: Mail,
      color: 'text-purple-500',
      suffix: '',
    },
    {
      key: 'emails_engagement',
      label: 'Email (Engagement)',
      value: totals.emailsEngagement,
      icon: Mail,
      color: 'text-slate-500',
      suffix: ' link clicks',
    },
  ];

  return (
    <Grid numItems={2} numItemsSm={3} numItemsLg={4} className="gap-4">
      {cards.map((card) => (
        <Card
          key={card.key}
          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 dark:border-gray-700"
          onClick={() => onCardClick(card.key)}
        >
          <div className="flex items-center gap-2">
            <card.icon className={`h-5 w-5 ${card.color}`} />
            <Text className="text-gray-600 dark:text-gray-400">{card.label}</Text>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <Metric className="text-gray-900 dark:text-white">{card.value.toLocaleString()}</Metric>
            {card.suffix && (
              <Text className="text-sm text-gray-500 dark:text-gray-400">{card.suffix}</Text>
            )}
          </div>
        </Card>
      ))}
    </Grid>
  );
}
