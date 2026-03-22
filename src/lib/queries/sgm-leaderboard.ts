// src/lib/queries/sgm-leaderboard.ts

import { runQuery } from '@/lib/bigquery';
import { SGMLeaderboardEntry, SGMLeaderboardFilters } from '@/types/sgm-hub';
import { FULL_TABLE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toNumber, toString } from '@/types/bigquery-raw';

/**
 * Raw BigQuery result for SGM leaderboard entry
 */
interface RawSGMLeaderboardResult {
  sgm_name: string;
  joined_count: number | null;
  total_aum: number | null;
}

/**
 * Format AUM for display
 * Examples: $0, $18.4M, $458.0M, $1.57B
 */
function formatAum(aum: number): string {
  if (aum === 0) return '$0';
  if (aum >= 1_000_000_000) return `$${(aum / 1_000_000_000).toFixed(2)}B`;
  if (aum >= 1_000_000) return `$${(aum / 1_000_000).toFixed(1)}M`;
  if (aum >= 1_000) return `$${(aum / 1_000).toFixed(0)}K`;
  return `$${aum.toFixed(0)}`;
}

/**
 * Calculate ranks for SGM leaderboard entries
 * Ranked by joinedAum (descending). Ties share rank, next rank increments by 1.
 * Input must already be sorted by total_aum DESC (SQL ORDER BY guarantees this).
 */
function calculateRanks(entries: SGMLeaderboardEntry[]): SGMLeaderboardEntry[] {
  if (entries.length === 0) return [];

  let currentRank = 1;
  let previousAum: number | null = null;

  return entries.map((entry, index) => {
    if (index === 0) {
      previousAum = entry.joinedAum;
      return { ...entry, rank: currentRank };
    }

    if (entry.joinedAum !== previousAum) {
      currentRank++;
      previousAum = entry.joinedAum;
    }

    return { ...entry, rank: currentRank };
  });
}

/**
 * Extract date string from BigQuery result (handles both string and {value: string} formats)
 */
function extractDate(val: string | { value: string } | null | undefined): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && 'value' in val) return val.value;
  return '';
}

/**
 * Get SGM leaderboard with Joined counts and AUM for a given quarter and filters
 */
const _getSGMLeaderboard = async (
  filters: SGMLeaderboardFilters
): Promise<SGMLeaderboardEntry[]> => {
  const { startDate, endDate, channels, sources, sgmNames } = filters;

  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }
  if (!channels || channels.length === 0) {
    throw new Error('At least one channel is required');
  }

  // Build optional filter clauses
  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  const sgmWhereClause = sgmNames && sgmNames.length > 0
    ? 'AND u.Name IN UNNEST(@sgmNames)'
    : '';

  // Derive quarter months from the date range for joined_cohort_month filtering
  const startYear = parseInt(startDate.substring(0, 4), 10);
  const startMonth = parseInt(startDate.substring(5, 7), 10);
  const endMonth = parseInt(endDate.substring(5, 7), 10);
  const quarterMonths: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    quarterMonths.push(`${startYear}-${String(m).padStart(2, '0')}`);
  }

  const query = `
    WITH ActiveSGMs AS (
      SELECT DISTINCT u.Name AS sgm_name
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.Is_SGM__c = TRUE
        AND u.IsActive = TRUE
        ${sgmWhereClause}
    ),
    JoinedData AS (
      SELECT
        v.SGM_Owner_Name__c AS sgm_name,
        v.primary_key,
        v.Opportunity_AUM
      FROM \`${FULL_TABLE}\` v
      WHERE v.is_joined_unique = 1
        AND v.joined_cohort_month IN UNNEST(@quarterMonths)
        AND v.Channel_Grouping_Name IN UNNEST(@channels)
        ${sourceFilter}
    )
    SELECT
      a.sgm_name,
      COUNT(DISTINCT j.primary_key) AS joined_count,
      COALESCE(SUM(j.Opportunity_AUM), 0) AS total_aum
    FROM ActiveSGMs a
    LEFT JOIN JoinedData j ON j.sgm_name = a.sgm_name
    GROUP BY a.sgm_name
    ORDER BY total_aum DESC, a.sgm_name ASC
  `;

  const params: Record<string, unknown> = {
    quarterMonths,
    channels,
  };

  if (sources && sources.length > 0) {
    params.sources = sources;
  }
  if (sgmNames && sgmNames.length > 0) {
    params.sgmNames = sgmNames;
  }

  const results = await runQuery<RawSGMLeaderboardResult>(query, params);

  const entries: SGMLeaderboardEntry[] = results.map((row) => {
    const aum = toNumber(row.total_aum);
    return {
      sgmName: toString(row.sgm_name),
      joinedCount: toNumber(row.joined_count),
      joinedAum: aum,
      joinedAumFormatted: formatAum(aum),
      rank: 0,
    };
  });

  return calculateRanks(entries);
};

export const getSGMLeaderboard = cachedQuery(
  _getSGMLeaderboard,
  'getSGMLeaderboard',
  CACHE_TAGS.SGM_HUB
);

/**
 * Raw BigQuery result for joined drill-down
 */
interface RawJoinedDrillDown {
  primary_key: string;
  advisor_name: string;
  advisor_join_date__c: string | { value: string } | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  SGM_Owner_Name__c: string | null;
  Opportunity_AUM: number | null;
  aum_tier: string | null;
  TOF_Stage: string;
  StageName: string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
}

/**
 * Get joined advisor drill-down records for a specific SGM
 */
const _getJoinedDrillDown = async (
  sgmName: string,
  startDate: string,
  endDate: string,
  options?: {
    channels?: string[];
    sources?: string[];
  }
): Promise<import('@/types/drill-down').JoinedDrillDownRecord[]> => {
  const { channels, sources } = options || {};

  const channelFilter = channels && channels.length > 0
    ? 'AND v.Channel_Grouping_Name IN UNNEST(@channels)'
    : '';
  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  // Derive quarter months from date range
  const startMonth = parseInt(startDate.substring(5, 7), 10);
  const endMonth = parseInt(endDate.substring(5, 7), 10);
  const startYear = parseInt(startDate.substring(0, 4), 10);
  const quarterMonths: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    quarterMonths.push(`${startYear}-${String(m).padStart(2, '0')}`);
  }

  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.advisor_join_date__c,
      v.Original_source,
      v.Channel_Grouping_Name,
      v.SGM_Owner_Name__c,
      v.Opportunity_AUM,
      v.aum_tier,
      v.TOF_Stage,
      v.StageName,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep
    FROM \`${FULL_TABLE}\` v
    WHERE v.is_joined_unique = 1
      AND v.joined_cohort_month IN UNNEST(@quarterMonths)
      AND v.SGM_Owner_Name__c = @sgmName
      ${channelFilter}
      ${sourceFilter}
    ORDER BY v.advisor_join_date__c DESC
  `;

  const params: Record<string, unknown> = {
    quarterMonths,
    sgmName,
  };
  if (channels && channels.length > 0) params.channels = channels;
  if (sources && sources.length > 0) params.sources = sources;

  const results = await runQuery<RawJoinedDrillDown>(query, params);

  return results.map((row) => {
    const aum = row.Opportunity_AUM ?? 0;
    return {
      primaryKey: toString(row.primary_key),
      advisorName: toString(row.advisor_name),
      joinDate: extractDate(row.advisor_join_date__c),
      source: toString(row.Original_source),
      channel: toString(row.Channel_Grouping_Name) || 'Other',
      sgmName: toString(row.SGM_Owner_Name__c),
      aum,
      aumFormatted: formatAum(aum),
      aumTier: row.aum_tier ?? null,
      tofStage: toString(row.TOF_Stage),
      leadUrl: row.lead_url ?? null,
      opportunityUrl: row.opportunity_url ?? null,
      nextSteps: row.Next_Steps__c ?? null,
      opportunityNextStep: row.NextStep ?? null,
      daysInCurrentStage: null,
      stageName: row.StageName ?? null,
    };
  });
};

export const getJoinedDrillDown = cachedQuery(
  _getJoinedDrillDown,
  'getJoinedDrillDown',
  CACHE_TAGS.SGM_HUB
);
