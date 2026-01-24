import { runQuery } from '../bigquery';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { QuarterGameData, QuarterLevel } from '@/types/game';
import { getQuarterDates, getLastNQuarters, getCurrentQuarter, formatQuarterDisplay, QUARTERS_TO_SHOW } from '@/config/game-constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

// Note: Following the pattern from src/lib/queries/open-pipeline.ts
// All queries use DATE() wrapper for TIMESTAMP fields
// All query functions are wrapped with cachedQuery for performance

interface RawSqoRecord {
  name: string;
  aum: { value: string } | number | null;
  stage: string;
}

interface RawJoinedRecord {
  name: string;
  aum: { value: string } | number | null;
}

interface RawGhostRecord {
  name: string;
}

interface RawQuarterSummary {
  quarter: string;
  sqo_count: { value: string } | number;
  joined_count: { value: string } | number;
  total_aum: { value: string } | number | null;
}

const extractNumber = (value: { value: string } | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && 'value' in value) {
    const num = parseFloat(value.value);
    return isNaN(num) ? 0 : num;
  }
  return 0;
};

const _getAvailableLevels = async (): Promise<QuarterLevel[]> => {
  const quarters = getLastNQuarters(QUARTERS_TO_SHOW);
  const currentQtr = getCurrentQuarter();
  const oldestQuarter = quarters[quarters.length - 1];
  const { startDate } = getQuarterDates(oldestQuarter);
  
  const summaryQuery = `
    WITH quarter_data AS (
      SELECT 
        FORMAT_DATE('%Y-Q%Q', DATE(Date_Became_SQO__c)) as quarter,
        COUNT(*) as sqo_count,
        SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum
      FROM \`${FULL_TABLE}\`
      WHERE is_sqo_unique = 1
        AND recordtypeid = @recruitingRecordType
        AND DATE(Date_Became_SQO__c) >= @startDate
      GROUP BY quarter
    ),
    joined_data AS (
      SELECT 
        FORMAT_DATE('%Y-Q%Q', DATE(advisor_join_date__c)) as quarter,
        COUNT(*) as joined_count
      FROM \`${FULL_TABLE}\`
      WHERE is_joined_unique = 1
        AND DATE(advisor_join_date__c) >= @startDate
      GROUP BY quarter
    )
    SELECT 
      q.quarter,
      COALESCE(q.sqo_count, 0) as sqo_count,
      COALESCE(j.joined_count, 0) as joined_count,
      COALESCE(q.total_aum, 0) as total_aum
    FROM quarter_data q
    LEFT JOIN joined_data j ON q.quarter = j.quarter
    WHERE q.quarter IN UNNEST(@quarters)
    ORDER BY q.quarter DESC
  `;
  
  const summaryResults = await runQuery<RawQuarterSummary>(summaryQuery, {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    startDate,
    quarters,
  });
  
  return quarters.map(quarter => {
    const summary = summaryResults.find(s => s.quarter === quarter);
    return {
      quarter,
      displayName: formatQuarterDisplay(quarter),
      sqoCount: summary ? extractNumber(summary.sqo_count) : 0,
      joinedCount: summary ? extractNumber(summary.joined_count) : 0,
      totalAum: summary ? extractNumber(summary.total_aum) : 0,
      isQTD: quarter === currentQtr,
    };
  });
};

export const getAvailableLevels = cachedQuery(
  _getAvailableLevels,
  'getAvailableLevels',
  CACHE_TAGS.DASHBOARD
);

const _getGameDataForQuarter = async (quarter: string): Promise<QuarterGameData> => {
  const { startDate, endDate } = getQuarterDates(quarter);
  
  const sqoQuery = `
    SELECT 
      advisor_name as name,
      COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
      StageName as stage
    FROM \`${FULL_TABLE}\`
    WHERE is_sqo_unique = 1
      AND recordtypeid = @recruitingRecordType
      AND DATE(Date_Became_SQO__c) >= @startDate
      AND DATE(Date_Became_SQO__c) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY COALESCE(Underwritten_AUM__c, Amount, 0) DESC
  `;
  
  const stopSignQuery = `
    SELECT DISTINCT advisor_name as name
    FROM \`${FULL_TABLE}\`
    WHERE DoNotCall = TRUE
      AND DATE(FilterDate) >= @startDate
      AND DATE(FilterDate) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY RAND()
    LIMIT 25
  `;
  
  const ghostQuery = `
    SELECT DISTINCT advisor_name as name
    FROM \`${FULL_TABLE}\`
    WHERE is_contacted = 1
      AND is_mql = 0
      AND DATE(FilterDate) >= @startDate
      AND DATE(FilterDate) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY RAND()
    LIMIT 25
  `;
  
  const joinedQuery = `
    SELECT 
      advisor_name as name,
      COALESCE(Underwritten_AUM__c, Amount, 0) as aum
    FROM \`${FULL_TABLE}\`
    WHERE is_joined_unique = 1
      AND DATE(advisor_join_date__c) >= @startDate
      AND DATE(advisor_join_date__c) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY COALESCE(Underwritten_AUM__c, Amount, 0) DESC
  `;
  
  const params = { recruitingRecordType: RECRUITING_RECORD_TYPE, startDate, endDate };
  
  const [sqoResults, stopSignResults, ghostResults, joinedResults] = await Promise.all([
    runQuery<RawSqoRecord>(sqoQuery, params),
    runQuery<RawGhostRecord>(stopSignQuery, params),
    runQuery<RawGhostRecord>(ghostQuery, params),
    runQuery<RawJoinedRecord>(joinedQuery, params),
  ]);
  
  return {
    sqos: sqoResults.map(r => ({ name: r.name, aum: extractNumber(r.aum), stage: r.stage })),
    stopSigns: stopSignResults.map(r => ({ name: r.name })),
    ghosts: ghostResults.map(r => ({ name: r.name })),
    joined: joinedResults.map(r => ({ name: r.name, aum: extractNumber(r.aum) })),
  };
};

export const getGameDataForQuarter = cachedQuery(
  _getGameDataForQuarter,
  'getGameDataForQuarter',
  CACHE_TAGS.DASHBOARD
);
