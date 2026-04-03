'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, Text } from '@tremor/react';
import { Info } from 'lucide-react';
import { OutreachEffectivenessDashboardData } from '@/types/outreach-effectiveness';

interface MetricCardsProps {
  data: OutreachEffectivenessDashboardData;
  activeMetric: string;
  onMetricClick: (metric: string) => void;
  zeroTouchMode: 'all' | 'stale';
  onZeroTouchModeChange: (mode: 'all' | 'stale') => void;
}

// ============================================
// TOOLTIP COMPONENT
// ============================================

interface TooltipSection {
  label: string;
  text: React.ReactNode;
  color?: string; // tailwind bg color class for the left accent
}

function Term({ word, definition }: { word: string; definition: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="inline">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="font-semibold text-blue-600 dark:text-blue-400 underline decoration-dotted underline-offset-2 cursor-pointer hover:text-blue-700 dark:hover:text-blue-300"
      >
        {word}
      </button>
      {expanded && (
        <span className="block mt-1 mb-1 pl-2 border-l-2 border-blue-300 dark:border-blue-600 text-[10px] text-gray-600 dark:text-gray-300 leading-relaxed">
          {definition}
        </span>
      )}
    </span>
  );
}

interface MetricTooltipProps {
  title: string;
  sections: TooltipSection[];
}

function MetricTooltip({ title, sections }: MetricTooltipProps) {
  const [show, setShow] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setShow(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  // Close on ESC
  useEffect(() => {
    if (!show) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [show]);

  // Reposition if off-screen
  useEffect(() => {
    if (!show || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    // Clamp horizontally
    if (rect.right > window.innerWidth - 8) {
      tooltipRef.current.style.left = 'auto';
      tooltipRef.current.style.right = '0';
      tooltipRef.current.style.transform = 'none';
    }
    if (rect.left < 8) {
      tooltipRef.current.style.left = '0';
      tooltipRef.current.style.right = 'auto';
      tooltipRef.current.style.transform = 'none';
    }
  }, [show]);

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setShow(!show);
        }}
        className="p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        aria-label={`Info about ${title}`}
      >
        <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
      </button>

      {show && (
        <div
          ref={tooltipRef}
          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Arrow pointing up */}
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-800 border-l border-t border-gray-200 dark:border-gray-600" />

          <div className="relative p-3">
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
              {title}
            </div>
            <div className="space-y-2">
              {sections.map((section, i) => (
                <div key={i} className={`flex gap-2 ${i > 0 ? 'pt-2 border-t border-gray-100 dark:border-gray-700' : ''}`}>
                  <div className={`w-1 rounded-full shrink-0 ${section.color || 'bg-blue-400'}`} />
                  <div>
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {section.label}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      {section.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// TOOLTIP CONTENT
// ============================================

const PERSISTENCE_TOOLTIP: MetricTooltipProps = {
  title: 'How this is calculated',
  sections: [
    {
      label: 'What it measures',
      text: <>How many outbound touches are SGAs making on their <Term word="unengaged" definition="Leads that never replied, never scheduled a call, and never converted. Leads with inbound replies or conversation-indicating dispositions are classified as Replied, not Unengaged." /> leads in contacting? Shows average touchpoints and what percentage hit the 5+ touch target.</>,
      color: 'bg-blue-400',
    },
    {
      label: 'Which leads count',
      text: <>Includes <Term word="terminal" definition="A lead is terminal if it's currently closed, progressed to MQL/SQL/SQO/Joined, or been sitting in contacting for 30+ days with no progression. Uses the lead's current stage — recycled leads are NOT terminal." /> unengaged leads AND leads currently open in contacting. This gives a live view of how thoroughly SGAs are working their pipeline, not just completed leads.</>,
      color: 'bg-amber-400',
    },
    {
      label: 'What counts as a touchpoint',
      text: 'All outbound activities: SMS, LinkedIn, Call, and Email (including automated drip/campaign emails — the candidate receives them either way). Only engagement tracking events and marketing activities are excluded. Only touches performed by the current lead owner count.',
      color: 'bg-green-400',
    },
    {
      label: 'Premature abandonment',
      text: 'The "premature" rate shows what percentage of leads were abandoned with fewer than 5 outreach attempts. Best practice is 5+ touches before closing an unengaged lead.',
      color: 'bg-red-400',
    },
  ],
};

const MULTI_CHANNEL_TOOLTIP: MetricTooltipProps = {
  title: 'How this is calculated',
  sections: [
    {
      label: 'What it measures',
      text: 'Of terminal unengaged worked leads, what percentage were reached via 2 or more distinct outbound channels?',
      color: 'bg-blue-400',
    },
    {
      label: 'The 4 channels',
      text: 'SMS, LinkedIn, Call, and Email. For channel presence, automated emails (lemlist, drip campaigns) DO count — the candidate received the email regardless of how it was sent.',
      color: 'bg-amber-400',
    },
    {
      label: 'Channel gaps',
      text: 'The subtext shows the two channels with lowest coverage. These are opportunities for SGAs to diversify their outreach approach.',
      color: 'bg-green-400',
    },
  ],
};

const ZERO_TOUCH_TOOLTIP: MetricTooltipProps = {
  title: 'How this is calculated',
  sections: [
    {
      label: 'What it measures',
      text: 'Leads assigned to SGAs with zero tracked outbound activity. This is a coverage gap metric.',
      color: 'bg-blue-400',
    },
    {
      label: 'Stale mode (default)',
      text: 'Only shows leads that need action: those already closed with zero outreach, OR leads that have been sitting untouched for 30+ days since entering the funnel. Brand new leads get a grace period before appearing.',
      color: 'bg-amber-400',
    },
    {
      label: 'All mode',
      text: 'Shows every zero-touch lead regardless of age, including brand new leads assigned yesterday. Useful for a complete picture.',
      color: 'bg-green-400',
    },
    {
      label: 'Excluded leads',
      text: 'Ghost contacts, bad leads (Bad Contact Info, Not a Fit, Wrong Number, Bad Lead Provided), leads with a "Replied" disposition, and "No Response" disposition (outreach happened, task wasn\'t logged) are all excluded.',
      color: 'bg-red-400',
    },
    {
      label: 'Open vs Closed',
      text: '"Open" zero-touch leads are still active and could be worked. "Closed" zero-touch leads were closed without any recorded outreach.',
      color: 'bg-purple-400',
    },
  ],
};

const AVG_CALLS_TOOLTIP: MetricTooltipProps = {
  title: 'How this is calculated',
  sections: [
    {
      label: 'What it measures',
      text: 'How many initial calls and qualification calls is each SGA scheduling per week, on average?',
      color: 'bg-blue-400',
    },
    {
      label: 'Tenure-bounded',
      text: 'Only counts weeks after each SGA\'s start date, so new SGAs aren\'t penalized for weeks before they joined.',
      color: 'bg-amber-400',
    },
    {
      label: 'Zero-filled',
      text: 'Weeks where an SGA scheduled zero calls still count in the average. This prevents inflated averages from only counting "active" weeks.',
      color: 'bg-green-400',
    },
    {
      label: 'Two call types',
      text: 'Initial Calls are scheduled between MQL and SQL stages. Qualification Calls happen after SQL conversion when the SGA and SGM evaluate SQO eligibility.',
      color: 'bg-purple-400',
    },
  ],
};

// ============================================
// METRIC CARD
// ============================================

function MetricCard({
  title,
  headline,
  headlineSuffix,
  secondary,
  subtext,
  metricKey,
  activeMetric,
  onClick,
  tooltip,
}: {
  title: string;
  headline: string;
  headlineSuffix?: string;
  secondary?: string;
  subtext: string;
  metricKey: string;
  activeMetric: string;
  onClick: (metric: string) => void;
  tooltip: MetricTooltipProps;
}) {
  const isActive = activeMetric === metricKey;
  return (
    <Card
      className={`cursor-pointer transition-all ${
        isActive
          ? 'ring-2 ring-blue-500 dark:ring-blue-400'
          : 'hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600'
      }`}
      onClick={() => onClick(metricKey)}
    >
      <div className="flex items-center justify-between">
        <Text className="text-sm text-gray-500 dark:text-gray-400">{title}</Text>
        <MetricTooltip {...tooltip} />
      </div>
      <div className="mt-1">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{headline}</span>
        {headlineSuffix && (
          <span className="text-lg text-gray-500 dark:text-gray-400 ml-1">{headlineSuffix}</span>
        )}
      </div>
      {secondary && (
        <Text className="text-sm text-gray-600 dark:text-gray-300 mt-1">{secondary}</Text>
      )}
      <Text className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtext}</Text>
    </Card>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function MetricCards({ data, activeMetric, onMetricClick, zeroTouchMode, onZeroTouchModeChange }: MetricCardsProps) {
  const { persistence, avgTouches, multiChannel, zeroTouch, avgCalls } = data;

  const sortedGaps = [...multiChannel.channelGaps].sort((a, b) => a.coveragePct - b.coveragePct);
  const gapText = sortedGaps.length >= 2
    ? `Gaps: ${sortedGaps[0].channel} (${sortedGaps[0].coveragePct}%), ${sortedGaps[1].channel} (${sortedGaps[1].coveragePct}%)`
    : '';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        title="Avg. Touchpoints in Contacting"
        headline={persistence.avgTouchpoints.toFixed(1)}
        headlineSuffix="avg touchpoints"
        secondary={`${persistence.pct5Plus}% with 5+ | ${avgTouches.prematureRate}% premature`}
        subtext={`${persistence.totalTerminalUnengaged} terminal unengaged leads`}
        metricKey="persistence"
        activeMetric={activeMetric}
        onClick={onMetricClick}
        tooltip={PERSISTENCE_TOOLTIP}
      />
      <MetricCard
        title="Multi-Channel Coverage"
        headline={`${multiChannel.pct2Plus}%`}
        headlineSuffix="2+ channels"
        secondary={`${multiChannel.pct3Plus}% with 3+ channels`}
        subtext={gapText}
        metricKey="multi-channel"
        activeMetric={activeMetric}
        onClick={onMetricClick}
        tooltip={MULTI_CHANNEL_TOOLTIP}
      />
      <Card
        className={`cursor-pointer transition-all ${
          activeMetric === 'zero-touch'
            ? 'ring-2 ring-blue-500 dark:ring-blue-400'
            : 'hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600'
        }`}
        onClick={() => onMetricClick('zero-touch')}
      >
        <div className="flex items-center justify-between">
          <Text className="text-sm text-gray-500 dark:text-gray-400">Zero-Touch Gap</Text>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-md p-0.5" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => onZeroTouchModeChange('stale')}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                  zeroTouchMode === 'stale'
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Stale
              </button>
              <button
                type="button"
                onClick={() => onZeroTouchModeChange('all')}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                  zeroTouchMode === 'all'
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                All
              </button>
            </div>
            <MetricTooltip {...ZERO_TOUCH_TOOLTIP} />
          </div>
        </div>
        <div className="mt-1">
          <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{zeroTouch.zeroTouchCount}</span>
          <span className="text-lg text-gray-500 dark:text-gray-400 ml-1">({zeroTouch.zeroTouchPct}%)</span>
        </div>
        <Text className="text-xs text-gray-400 dark:text-gray-500 mt-1">{zeroTouch.stillOpen} open, {zeroTouch.closedZeroTouch} closed</Text>
      </Card>
      <MetricCard
        title="Avg Calls / Week"
        headline={avgCalls.avgInitialPerWeek.toFixed(2)}
        headlineSuffix="initial"
        secondary={`${avgCalls.avgQualPerWeek.toFixed(2)} qual / week`}
        subtext={`Across ${avgCalls.sgaCount} SGAs, ${avgCalls.weekCount} weeks`}
        metricKey="avg-calls"
        activeMetric={activeMetric}
        onClick={onMetricClick}
        tooltip={AVG_CALLS_TOOLTIP}
      />
    </div>
  );
}
