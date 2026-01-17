import { runQuery } from '@/lib/bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

/**
 * Raw BigQuery result interface matching the query columns
 * Note: BigQuery TIMESTAMP fields are returned as { value: string } objects by the client library
 */
interface RawDataFreshnessResult {
  last_updated: string | { value: string };  // BigQuery client wraps TIMESTAMP in { value: string }
  hours_ago: number | string;  // May be returned as string from BigQuery
  minutes_ago: number | string;  // May be returned as string from BigQuery
}

export interface DataFreshnessResult {
  lastUpdated: string;        // ISO timestamp in UTC
  hoursAgo: number;
  minutesAgo: number;
  isStale: boolean;           // true if > 24 hours
  status: 'fresh' | 'recent' | 'stale' | 'very_stale';
}

/**
 * Get the most recent data transfer time from Lead and Opportunity tables
 * Uses __TABLES__ metadata to determine when data was last synced from Salesforce
 */
const _getDataFreshness = async (): Promise<DataFreshnessResult> => {
  const query = `
    SELECT 
      MAX(last_data_load) as last_updated,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
    FROM (
      SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
      FROM \`savvy-gtm-analytics.SavvyGTMData.__TABLES__\`
      WHERE table_id IN ('Lead', 'Opportunity')
    )
  `;

  const [result] = await runQuery<RawDataFreshnessResult>(query);
  
  // BigQuery may return numbers as strings, so convert safely
  const hoursAgo = typeof result.hours_ago === 'string' ? parseInt(result.hours_ago, 10) : (result.hours_ago || 0);
  const minutesAgo = typeof result.minutes_ago === 'string' ? parseInt(result.minutes_ago, 10) : (result.minutes_ago || 0);
  
  // Determine status based on age
  let status: DataFreshnessResult['status'];
  if (hoursAgo < 1) {
    status = 'fresh';
  } else if (hoursAgo < 6) {
    status = 'recent';
  } else if (hoursAgo < 24) {
    status = 'stale';
  } else {
    status = 'very_stale';
  }

  // BigQuery TIMESTAMP may be returned as { value: string } object or string directly
  const lastUpdated = typeof result.last_updated === 'object' && result.last_updated !== null && 'value' in result.last_updated
    ? result.last_updated.value
    : (typeof result.last_updated === 'string' ? result.last_updated : new Date().toISOString());

  return {
    lastUpdated,
    hoursAgo,
    minutesAgo,
    isStale: hoursAgo >= 24,
    status,
  };
};

export const getDataFreshness = cachedQuery(
  _getDataFreshness,
  'getDataFreshness',
  CACHE_TAGS.DASHBOARD
);
