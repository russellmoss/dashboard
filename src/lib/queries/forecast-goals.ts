// src/lib/queries/forecast-goals.ts
// Query functions for daily-ized forecast goals from vw_daily_forecast view

import { runQuery } from '../bigquery';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { 
  RawForecastGoalsResult, 
  RawChannelForecastResult, 
  RawSourceForecastResult,
  toNumber, 
  toString 
} from '@/types/bigquery-raw';
import { DAILY_FORECAST_VIEW } from '@/config/constants';
import { ForecastGoals } from '@/types/dashboard';

// Output types for channel and source goals
export interface ChannelForecastGoals extends ForecastGoals {
  channel: string;
}

export interface SourceForecastGoals extends ForecastGoals {
  source: string;
  channel: string;
}

// The earliest date with forecast data
const FORECAST_START_DATE = '2025-10-01';

/**
 * Check if the date range has forecast data available
 */
function hasForecastData(startDate: string): boolean {
  const filterStart = new Date(startDate);
  const forecastStart = new Date(FORECAST_START_DATE);
  return filterStart >= forecastStart;
}

/**
 * Get aggregate forecast goals for the entire period (for scorecards)
 * Sums daily rates across the date range to get pro-rated goals
 */
export async function getAggregateForecastGoals(
  filters: DashboardFilters
): Promise<ForecastGoals | null> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Debug logging
  console.log('[Forecast Goals] Date range:', { startDate, endDate, datePreset: filters.datePreset, year: filters.year });
  
  // Check if we have forecast data for this date range
  if (!hasForecastData(startDate)) {
    console.log('[Forecast Goals] Date range before forecast start date (2025-10-01), returning null');
    return null;
  }
  
  const query = `
    SELECT
      ROUND(SUM(prospects_daily), 2) AS prospects_goal,
      ROUND(SUM(mqls_daily), 2) AS mqls_goal,
      ROUND(SUM(sqls_daily), 2) AS sqls_goal,
      ROUND(SUM(sqos_daily), 2) AS sqos_goal,
      ROUND(SUM(joined_daily), 2) AS joined_goal
    FROM \`${DAILY_FORECAST_VIEW}\`
    WHERE date_day BETWEEN @startDate AND @endDate
  `;
  
  const params = { startDate, endDate };
  
  console.log('[Forecast Goals] Executing query with params:', params);
  
  const results = await runQuery<RawForecastGoalsResult>(query, params);
  
  if (results.length === 0) {
    return null;
  }
  
  const r = results[0];
  
  // Check if we got any data (all nulls means no forecast data)
  if (r.sqls_goal === null && r.sqos_goal === null && r.joined_goal === null) {
    return null;
  }
  
  return {
    prospects: toNumber(r.prospects_goal),
    mqls: toNumber(r.mqls_goal),
    sqls: toNumber(r.sqls_goal),
    sqos: toNumber(r.sqos_goal),
    joined: toNumber(r.joined_goal),
  };
}

/**
 * Get forecast goals grouped by channel (for Channel Performance table)
 */
export async function getChannelForecastGoals(
  filters: DashboardFilters
): Promise<ChannelForecastGoals[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  if (!hasForecastData(startDate)) {
    return [];
  }
  
  const query = `
    SELECT
      channel_grouping_name,
      ROUND(SUM(prospects_daily), 2) AS prospects_goal,
      ROUND(SUM(mqls_daily), 2) AS mqls_goal,
      ROUND(SUM(sqls_daily), 2) AS sqls_goal,
      ROUND(SUM(sqos_daily), 2) AS sqos_goal,
      ROUND(SUM(joined_daily), 2) AS joined_goal
    FROM \`${DAILY_FORECAST_VIEW}\`
    WHERE date_day BETWEEN @startDate AND @endDate
    GROUP BY channel_grouping_name
    HAVING SUM(sqls_daily) > 0 OR SUM(sqos_daily) > 0 OR SUM(joined_daily) > 0
    ORDER BY SUM(sqos_daily) DESC
  `;
  
  const params = { startDate, endDate };
  
  const results = await runQuery<RawChannelForecastResult>(query, params);
  
  return results.map(r => ({
    channel: toString(r.channel_grouping_name),
    prospects: toNumber(r.prospects_goal),
    mqls: toNumber(r.mqls_goal),
    sqls: toNumber(r.sqls_goal),
    sqos: toNumber(r.sqos_goal),
    joined: toNumber(r.joined_goal),
  }));
}

/**
 * Get forecast goals grouped by source (for Source Performance table)
 * Optionally filter by channel
 */
export async function getSourceForecastGoals(
  filters: DashboardFilters,
  channelFilter?: string | null
): Promise<SourceForecastGoals[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  if (!hasForecastData(startDate)) {
    return [];
  }
  
  // Build WHERE conditions
  const conditions = ['date_day BETWEEN @startDate AND @endDate'];
  const params: Record<string, string> = { startDate, endDate };
  
  if (channelFilter) {
    conditions.push('channel_grouping_name = @channelFilter');
    params.channelFilter = channelFilter;
  }
  
  const query = `
    SELECT
      original_source,
      channel_grouping_name,
      ROUND(SUM(prospects_daily), 2) AS prospects_goal,
      ROUND(SUM(mqls_daily), 2) AS mqls_goal,
      ROUND(SUM(sqls_daily), 2) AS sqls_goal,
      ROUND(SUM(sqos_daily), 2) AS sqos_goal,
      ROUND(SUM(joined_daily), 2) AS joined_goal
    FROM \`${DAILY_FORECAST_VIEW}\`
    WHERE ${conditions.join(' AND ')}
    GROUP BY original_source, channel_grouping_name
    HAVING SUM(sqls_daily) > 0 OR SUM(sqos_daily) > 0 OR SUM(joined_daily) > 0
    ORDER BY channel_grouping_name, SUM(sqos_daily) DESC
  `;
  
  const results = await runQuery<RawSourceForecastResult>(query, params);
  
  return results.map(r => ({
    source: toString(r.original_source),
    channel: toString(r.channel_grouping_name),
    prospects: toNumber(r.prospects_goal),
    mqls: toNumber(r.mqls_goal),
    sqls: toNumber(r.sqls_goal),
    sqos: toNumber(r.sqos_goal),
    joined: toNumber(r.joined_goal),
  }));
}
