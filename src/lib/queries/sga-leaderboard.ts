// src/lib/queries/sga-leaderboard.ts

import { runQuery } from '@/lib/bigquery';
import { LeaderboardEntry, LeaderboardFilters } from '@/types/sga-hub';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toNumber, toString } from '@/types/bigquery-raw';

/**
 * Raw BigQuery result for leaderboard entry
 */
interface RawLeaderboardResult {
  sga_name: string;
  sqo_count: number | null;
}

/**
 * Always-inactive SGAs to exclude from leaderboard
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
 * Calculate ranks for leaderboard entries
 * Ties get the same rank, next rank increments by 1
 * Example: [5, 4, 4, 4, 2, 2, 1, 1, 1, 1, 0, 0] -> ranks: [1, 2, 2, 2, 3, 3, 4, 4, 4, 4, 5, 5]
 */
function calculateRanks(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  if (entries.length === 0) return [];

  let currentRank = 1;
  let previousCount: number | null = null;

  return entries.map((entry, index) => {
    // If this is the first entry, start with rank 1
    if (index === 0) {
      previousCount = entry.sqoCount;
      return {
        ...entry,
        rank: currentRank,
      };
    }

    // If this entry has a different count than the previous one, move to next rank
    if (entry.sqoCount !== previousCount) {
      currentRank++;
      previousCount = entry.sqoCount;
    }
    // If same count, keep the same rank (ties share the rank)

    return {
      ...entry,
      rank: currentRank,
    };
  });
}

/**
 * Get SGA leaderboard with SQO counts for a given date range and filters
 * @param filters - Date range, channels, optional sources, and optional sgaNames
 * @returns Array of leaderboard entries sorted by SQO count (descending)
 */
const _getSGALeaderboard = async (
  filters: LeaderboardFilters
): Promise<LeaderboardEntry[]> => {
  const { startDate, endDate, channels, sources, sgaNames } = filters;

  // Validate required parameters
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }
  if (!channels || channels.length === 0) {
    throw new Error('At least one channel is required');
  }

  // Build source filter conditionally (only include in SQL and params if sources provided)
  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  // Build SGA filter for the active SGAs subquery
  // If sgaNames is provided, filter to only those SGAs
  // Otherwise, get all active SGAs (excluding excluded ones)
  const sgaWhereClause = sgaNames && sgaNames.length > 0
    ? 'AND u.Name IN UNNEST(@sgaNames)'
    : 'AND u.Name NOT IN UNNEST(@excludedSGAs)';

  // Query structure:
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
        AND v.Channel_Grouping_Name IN UNNEST(@channels)
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
    channels,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    excludedSGAs: EXCLUDED_SGAS,
  };

  // Add sources parameter only if provided
  if (sources && sources.length > 0) {
    params.sources = sources;
  }

  // Add sgaNames parameter only if provided
  if (sgaNames && sgaNames.length > 0) {
    params.sgaNames = sgaNames;
  }

  const results = await runQuery<RawLeaderboardResult>(query, params);

  // Transform raw results to LeaderboardEntry
  const entries: LeaderboardEntry[] = results.map((row) => ({
    sgaName: toString(row.sga_name),
    sqoCount: toNumber(row.sqo_count),
    rank: 0, // Will be calculated below
  }));

  // Calculate ranks (handles ties)
  const rankedEntries = calculateRanks(entries);

  return rankedEntries;
};

export const getSGALeaderboard = cachedQuery(
  _getSGALeaderboard,
  'getSGALeaderboard',
  CACHE_TAGS.SGA_HUB
);
