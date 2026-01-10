import { runQuery } from '../bigquery';
import { ForecastData } from '@/types/dashboard';
import { DashboardFilters } from '@/types/filters';
import { toNumber, toString } from '@/types/bigquery-raw';
import { FORECAST_TABLE } from '@/config/constants';

export async function getForecastData(filters: DashboardFilters): Promise<ForecastData[]> {
  // Extract month keys based on filter date range
  const query = `
    SELECT
      month_key,
      channel,
      metric,
      stage,
      original_source,
      forecast_value
    FROM \`${FORECAST_TABLE}\`
    WHERE forecast_value IS NOT NULL
      AND forecast_value > 0
  `;
  
  const results = await runQuery<{
    month_key: string;
    channel: string | null;
    metric: string | null;
    stage: string | null;
    original_source: string | null;
    forecast_value: number | null;
  }>(query);
  
  return results.map(r => ({
    monthKey: toString(r.month_key),
    channel: toString(r.channel),
    metric: toString(r.metric),
    stage: toString(r.stage),
    originalSource: toString(r.original_source),
    forecastValue: toNumber(r.forecast_value),
  }));
}

export async function getMonthlyForecastTotals(monthKey: string): Promise<{
  prospects: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
}> {
  const query = `
    SELECT
      stage,
      SUM(forecast_value) as total
    FROM \`${FORECAST_TABLE}\`
    WHERE month_key = @monthKey
      AND (metric = 'Total_prospects' OR metric LIKE 'Total_%')
    GROUP BY stage
  `;
  
  const results = await runQuery<{
    stage: string | null;
    total: number | null;
  }>(query, { monthKey });
  
  const totals = {
    prospects: 0,
    mqls: 0,
    sqls: 0,
    sqos: 0,
    joined: 0,
  };
  
  results.forEach(r => {
    const stage = toString(r.stage).toLowerCase();
    const value = toNumber(r.total);
    
    if (stage === 'prospects') totals.prospects = value;
    else if (stage === 'mql') totals.mqls = value;
    else if (stage === 'sql') totals.sqls = value;
    else if (stage === 'sqo') totals.sqos = value;
    else if (stage === 'joined') totals.joined = value;
  });
  
  return totals;
}
