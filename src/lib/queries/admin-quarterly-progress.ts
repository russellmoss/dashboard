// src/lib/queries/admin-quarterly-progress.ts

import { runQuery } from '@/lib/bigquery';
import { AdminQuarterlyProgress } from '@/types/sga-hub';
import { toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { getAllSGAQuarterlyGoals } from '@/lib/queries/quarterly-goals';
import { prisma } from '@/lib/prisma';

/**
 * Raw BigQuery result for admin quarterly progress breakdown
 */
interface RawAdminProgressResult {
  sga_name: string;
  sqo_count: number | null;
}

/**
 * Always-inactive SGAs to exclude from admin quarterly progress
 * (Same list as leaderboard for consistency)
 */
const EXCLUDED_SGAS = [
  'Anett Diaz',
  'Jacqueline Tully',
  'Savvy Operations',
  'Savvy Marketing',
  'Russell Moss',
  'Jed Entin',
];

/**
 * Get admin quarterly progress with team totals and individual SGA breakdown
 * @param year - Year (e.g., 2026)
 * @param quarter - Quarter number (1-4)
 * @param filters - Optional filters for SGA names, channels, and sources
 */
const _getAdminQuarterlyProgress = async (
  year: number,
  quarter: number,
  filters?: {
    sgaNames?: string[];
    channels?: string[];
    sources?: string[];
  }
): Promise<AdminQuarterlyProgress> => {
  // Build date range from year/quarter
  const quarterStr = `${year}-Q${quarter}`;
  const quarterInfo = getQuarterInfo(quarterStr);
  const startDate = quarterInfo.startDate; // YYYY-MM-DD
  const endDate = quarterInfo.endDate; // YYYY-MM-DD

  // Build filter conditions for SQO data
  const channelFilter = filters?.channels && filters.channels.length > 0
    ? 'AND v.Channel_Grouping_Name IN UNNEST(@channels)'
    : '';

  const sourceFilter = filters?.sources && filters.sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  // Build SGA filter for the active SGAs subquery
  // If sgaNames is provided, filter to only those SGAs
  // Otherwise, get all active SGAs (excluding excluded ones)
  const sgaWhereClause = filters?.sgaNames && filters.sgaNames.length > 0
    ? 'AND u.Name IN UNNEST(@sgaNames)'
    : 'AND u.Name NOT IN UNNEST(@excludedSGAs)';

  // Query structure (same as leaderboard):
  // 1. Start with all active SGAs from User table
  // 2. LEFT JOIN with SQO data (with sga_user join first) to get counts (will be 0 for SGAs with no SQOs)
  // 3. This ensures all active SGAs appear, even with 0 SQOs
  const query = `
    WITH ActiveSGAs AS (
      SELECT DISTINCT u.Name as sga_name
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.IsSGA__c = TRUE
        AND u.IsActive = TRUE
        ${sgaWhereClause}
    ),
    SQOData AS (
      SELECT 
        COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as sga_name,
        v.primary_key
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
        ON v.Opp_SGA_Name__c = sga_user.Id
      WHERE v.is_sqo_unique = 1
        AND v.recordtypeid = @recruitingRecordType
        AND v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
        ${channelFilter}
        ${sourceFilter}
    )
    SELECT 
      a.sga_name,
      COALESCE(COUNT(DISTINCT s.primary_key), 0) as sqo_count
    FROM ActiveSGAs a
    LEFT JOIN SQOData s
      ON a.sga_name = s.sga_name
    GROUP BY a.sga_name
    ORDER BY sqo_count DESC, a.sga_name ASC
  `;

  const params: Record<string, any> = {
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    excludedSGAs: EXCLUDED_SGAS,
  };

  if (filters?.sgaNames && filters.sgaNames.length > 0) {
    params.sgaNames = filters.sgaNames;
  }
  if (filters?.channels && filters.channels.length > 0) {
    params.channels = filters.channels;
  }
  if (filters?.sources && filters.sources.length > 0) {
    params.sources = filters.sources;
  }

  const results = await runQuery<RawAdminProgressResult>(query, params);

  // Calculate team total
  const teamTotalSQOs = results.reduce((sum, row) => sum + (toNumber(row.sqo_count) || 0), 0);

  // Build breakdown
  const sgaBreakdown = results.map(row => ({
    sgaName: toString(row.sga_name),
    sqoCount: toNumber(row.sqo_count) || 0,
  }));

  // Fetch individual SGA goals and calculate aggregate
  const sgaGoals = await getAllSGAQuarterlyGoals(quarterStr);
  const sgaIndividualGoalsAggregate = sgaGoals.reduce((sum, goal) => sum + goal.sqoGoal, 0);

  // Fetch manager goal
  const managerGoal = await prisma.managerQuarterlyGoal.findUnique({
    where: { quarter: quarterStr },
  });

  return {
    year,
    quarter,
    teamTotalSQOs,
    sgaIndividualGoalsAggregate,
    sgaManagerGoal: managerGoal ? managerGoal.sqoGoal : null,
    sgaBreakdown,
  };
};

export const getAdminQuarterlyProgress = cachedQuery(
  _getAdminQuarterlyProgress,
  'getAdminQuarterlyProgress',
  CACHE_TAGS.SGA_HUB
);
