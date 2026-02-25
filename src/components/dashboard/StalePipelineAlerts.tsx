'use client';

import React, { useMemo, useState } from 'react';
import { Card } from '@tremor/react';
import { AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import { DetailRecord } from '@/types/dashboard';
import {
  OPEN_PIPELINE_STAGES,
  STAGE_COLORS,
  STALE_PIPELINE_THRESHOLDS,
  ON_HOLD_STAGE,
} from '@/config/constants';

// ─── Aging tier helpers ───────────────────────────────────────────────────────

type AgingTier = 'fresh' | 'warning' | 'stale' | 'critical' | 'unknown';

function getAgingTier(days: number | null): AgingTier {
  if (days === null) return 'unknown';
  if (days >= STALE_PIPELINE_THRESHOLDS.critical) return 'critical';
  if (days >= STALE_PIPELINE_THRESHOLDS.stale)    return 'stale';
  if (days >= STALE_PIPELINE_THRESHOLDS.warning)  return 'warning';
  return 'fresh';
}

const TIER_BADGE_CLASSES: Record<AgingTier, string> = {
  fresh:   'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-400',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  stale:   'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  critical:'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400',
  unknown: 'bg-gray-100   text-gray-500   dark:bg-gray-800      dark:text-gray-400',
};

const TIER_RANGE_LABEL: Record<AgingTier, string> = {
  fresh:   `<${STALE_PIPELINE_THRESHOLDS.warning}d`,
  warning: `${STALE_PIPELINE_THRESHOLDS.warning}–${STALE_PIPELINE_THRESHOLDS.stale - 1}d`,
  stale:   `${STALE_PIPELINE_THRESHOLDS.stale}–${STALE_PIPELINE_THRESHOLDS.critical - 1}d`,
  critical:`${STALE_PIPELINE_THRESHOLDS.critical}d+`,
  unknown: 'N/A',
};

function AgingBadge({ days }: { days: number | null }) {
  const tier = getAgingTier(days);
  const label = days === null ? 'N/A' : `${days}d`;
  return (
    <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full flex-shrink-0 ${TIER_BADGE_CLASSES[tier]}`}>
      {label}
    </span>
  );
}

function formatAum(aum: number): string {
  if (aum >= 1_000_000_000) return `$${(aum / 1_000_000_000).toFixed(1)}B`;
  if (aum >= 1_000_000)     return `$${(aum / 1_000_000).toFixed(0)}M`;
  return `$${aum.toLocaleString()}`;
}

// ─── Tier summary badges ─────────────────────────────────────────────────────

interface TierCounts {
  fresh: number;
  warning: number;
  stale: number;
  critical: number;
  unknown: number;
}

function TierSummaryBadges({ counts, total }: { counts: TierCounts; total: number }) {
  const tiers: AgingTier[] = ['critical', 'stale', 'warning', 'fresh', 'unknown'];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tiers.map(tier => {
        const count = counts[tier];
        if (count === 0) return null;
        const pct = Math.round((count / total) * 100);
        return (
          <span key={tier} className={`px-2 py-0.5 text-xs font-medium rounded-full ${TIER_BADGE_CLASSES[tier]}`}>
            {count} {TIER_RANGE_LABEL[tier]} ({pct}%)
          </span>
        );
      })}
    </div>
  );
}

// ─── Stage section ────────────────────────────────────────────────────────────

interface StageSectionProps {
  stage: string;
  records: DetailRecord[];
  isOnHold?: boolean;
  onStageClick: (stage: string, records: DetailRecord[]) => void;
  onRecordClick: (recordId: string) => void;
}

function StageSection({ stage, records, isOnHold = false, onStageClick, onRecordClick }: StageSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const stageColor = STAGE_COLORS[stage] ?? '#94a3b8';

  const counts = useMemo<TierCounts>(() => {
    return records.reduce(
      (acc, r) => {
        acc[getAgingTier(r.daysInCurrentStage)]++;
        return acc;
      },
      { fresh: 0, warning: 0, stale: 0, critical: 0, unknown: 0 }
    );
  }, [records]);

  // Sort: highest days first, nulls last
  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      if (a.daysInCurrentStage === null && b.daysInCurrentStage === null) return 0;
      if (a.daysInCurrentStage === null) return 1;
      if (b.daysInCurrentStage === null) return -1;
      return b.daysInCurrentStage - a.daysInCurrentStage;
    });
  }, [records]);

  const staleCount = counts.critical + counts.stale + counts.warning;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header row — left side toggles expand, right side opens drill-down */}
      <div className="flex items-center px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        {/* Toggle button — takes up most of the row */}
        <button
          onClick={() => setIsOpen(o => !o)}
          className="flex items-center gap-3 min-w-0 flex-1 text-left"
        >
          <ChevronDown
            className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
          />
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: stageColor }}
          />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {stage}
          </span>
          {isOnHold && (
            <span className="text-xs text-gray-400 dark:text-gray-500 italic hidden sm:inline">
              — deliberate pause
            </span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {records.length} record{records.length !== 1 ? 's' : ''}
            {staleCount > 0 && (
              <span className="ml-1 text-orange-600 dark:text-orange-400">
                · {staleCount} flagged
              </span>
            )}
          </span>
          <div className="hidden sm:flex items-center ml-1">
            <TierSummaryBadges counts={counts} total={records.length} />
          </div>
        </button>

        {/* View all — opens drill-down modal */}
        <button
          onClick={() => onStageClick(stage, records)}
          className="flex-shrink-0 ml-3 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          View all
        </button>
      </div>

      {/* Record rows — only shown when expanded */}
      {isOpen && (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {sorted.map(record => (
            <button
              key={record.id}
              onClick={() => onRecordClick(record.id)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors text-left"
            >
              {/* Left: badge + two-line info */}
              <div className="flex items-start gap-3 min-w-0">
                <AgingBadge days={record.daysInCurrentStage} />
                <div className="min-w-0">
                  {/* Line 1: advisor / opp name */}
                  <span className="block font-medium text-gray-800 dark:text-gray-200 truncate">
                    {record.advisorName}
                  </span>
                  {/* Line 2: SGM + next step */}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {record.sgm && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        SGM: <span className="font-medium">{record.sgm}</span>
                      </span>
                    )}
                    {(record.opportunityNextStep || record.nextSteps) && (
                      <>
                        {record.sgm && <span className="text-gray-300 dark:text-gray-600">·</span>}
                        <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">
                          {record.opportunityNextStep ?? record.nextSteps}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {/* Right: AUM */}
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0 ml-3 self-start mt-0.5">
                {formatAum(record.aum)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface StalePipelineAlertsProps {
  records: DetailRecord[];
  loading: boolean;
  onStageClick: (stage: string, records: DetailRecord[]) => void;
  onRecordClick: (recordId: string) => void;
}

export function StalePipelineAlerts({ records, loading, onStageClick, onRecordClick }: StalePipelineAlertsProps) {
  // Group records by stage client-side
  const byStage = useMemo(() => {
    const map = new Map<string, DetailRecord[]>();
    for (const record of records) {
      const stage = record.stage || 'Unknown';
      const existing = map.get(stage) ?? [];
      existing.push(record);
      map.set(stage, existing);
    }
    return map;
  }, [records]);

  // Separate On Hold from actively-progressing stages
  const onHoldRecords = byStage.get(ON_HOLD_STAGE) ?? [];
  const activeStageRecords = OPEN_PIPELINE_STAGES
    .map(stage => ({ stage, records: byStage.get(stage) ?? [] }))
    .filter(({ records: r }) => r.length > 0);

  const totalFlagged = records.filter(
    r => r.daysInCurrentStage !== null && r.daysInCurrentStage >= STALE_PIPELINE_THRESHOLDS.warning
  ).length;

  const hasData = records.length > 0;

  if (!hasData && !loading) return null;

  return (
    <Card className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Stale Pipeline Alerts
          </h2>
          {!loading && hasData && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {totalFlagged} of {records.length} records flagged at {STALE_PIPELINE_THRESHOLDS.warning}d+
              · Expand a stage to see records · View all to drill down
            </p>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Active pipeline stages */}
      {!loading && activeStageRecords.length > 0 && (
        <div className="space-y-3">
          {activeStageRecords.map(({ stage, records: stageRecords }) => (
            <StageSection
              key={stage}
              stage={stage}
              records={stageRecords}
              onStageClick={onStageClick}
              onRecordClick={onRecordClick}
            />
          ))}
        </div>
      )}

      {/* On Hold — always shown separately if records exist */}
      {!loading && onHoldRecords.length > 0 && (
        <div className={activeStageRecords.length > 0 ? 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700' : ''}>
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              On Hold
            </span>
          </div>
          <StageSection
            stage={ON_HOLD_STAGE}
            records={onHoldRecords}
            isOnHold
            onStageClick={onStageClick}
            onRecordClick={onRecordClick}
          />
        </div>
      )}

      {/* Qualifying footnote — only when Qualifying records are present */}
      {!loading && (byStage.get('Qualifying')?.length ?? 0) > 0 && (
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 italic">
          * Qualifying: days counted from opportunity creation date (no Salesforce stage entry date available)
        </p>
      )}
    </Card>
  );
}
