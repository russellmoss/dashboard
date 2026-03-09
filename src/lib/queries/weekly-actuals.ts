// src/lib/queries/weekly-actuals.ts

// ✅ VERIFIED: All imports match existing patterns
import { runQuery } from '@/lib/bigquery'; // ✅ Verified: runQuery<T>(query, params?: Record<string, any>): Promise<T[]>
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants'; // ✅ Verified: Constants exist
import { WeeklyActual } from '@/types/sga-hub';
import { toNumber } from '@/types/bigquery-raw'; // ✅ Verified: Helper function exists
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

interface RawWeeklyActualResult {
  week_start: { value: string } | string;
  initial_calls: number | null;
  qualification_calls: number | null;
  sqos: number | null;
  mqls: number | null;
  sqls: number | null;
  leads_sourced: number | null;
  leads_sourced_self: number | null;
  leads_contacted: number | null;
  leads_contacted_self: number | null;
}

/**
 * Get weekly actuals for a specific SGA
 * @param sgaName - Exact SGA_Owner_Name__c value (from user.name)
 * @param startDate - Start date for range (ISO string)
 * @param endDate - End date for range (ISO string)
 */
const _getWeeklyActuals = async (
  sgaName: string,
  startDate: string,
  endDate: string
): Promise<WeeklyActual[]> => {
  const query = `
    WITH initial_calls AS (
      SELECT 
        DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT primary_key) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND Initial_Call_Scheduled_Date__c IS NOT NULL
        AND Initial_Call_Scheduled_Date__c >= @startDate
        AND Initial_Call_Scheduled_Date__c <= @endDate
      GROUP BY week_start
    ),
    qual_calls AS (
      SELECT 
        DATE_TRUNC(Qualification_Call_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT Full_Opportunity_ID__c) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND Qualification_Call_Date__c IS NOT NULL
        AND Qualification_Call_Date__c >= @startDate
        AND Qualification_Call_Date__c <= @endDate
      GROUP BY week_start
    ),
    sqos AS (
      SELECT 
        DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
        ON v.Opp_SGA_Name__c = sga_user.Id
      WHERE (v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)
        AND v.is_sqo_unique = 1
        AND v.Date_Became_SQO__c IS NOT NULL
        AND v.Date_Became_SQO__c >= TIMESTAMP(@startDate)
        AND v.Date_Became_SQO__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
        AND v.recordtypeid = @recruitingRecordType
      GROUP BY week_start
    ),
    mqls AS (
      SELECT
        DATE(DATE_TRUNC(mql_stage_entered_ts, WEEK(MONDAY))) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND mql_stage_entered_ts IS NOT NULL
        AND mql_stage_entered_ts >= TIMESTAMP(@startDate)
        AND mql_stage_entered_ts <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY week_start
    ),
    sqls AS (
      SELECT
        DATE_TRUNC(converted_date_raw, WEEK(MONDAY)) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND converted_date_raw IS NOT NULL
        AND converted_date_raw >= @startDate
        AND converted_date_raw <= @endDate
        AND is_sql = 1
      GROUP BY week_start
    ),
    leads_sourced AS (
      SELECT
        DATE(DATE_TRUNC(l.CreatedDate, WEEK(MONDAY))) as week_start,
        COUNT(*) as total,
        COUNTIF(l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')) as self_sourced
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
      WHERE l.SGA_Owner_Name__c = @sgaName
        AND l.CreatedDate >= TIMESTAMP(@startDate)
        AND l.CreatedDate <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY week_start
    ),
    leads_contacted AS (
      SELECT
        DATE(DATE_TRUNC(stage_entered_contacting__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as total
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND stage_entered_contacting__c IS NOT NULL
        AND stage_entered_contacting__c >= TIMESTAMP(@startDate)
        AND stage_entered_contacting__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY week_start
    ),
    leads_contacted_self AS (
      SELECT
        DATE(DATE_TRUNC(l.Stage_Entered_Contacting__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as self_sourced
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
      WHERE l.SGA_Owner_Name__c = @sgaName
        AND l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
        AND l.Stage_Entered_Contacting__c IS NOT NULL
        AND l.Stage_Entered_Contacting__c >= TIMESTAMP(@startDate)
        AND l.Stage_Entered_Contacting__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY week_start
    ),
    -- Generate all weeks in range
    all_weeks AS (
      SELECT week_start
      FROM UNNEST(
        GENERATE_DATE_ARRAY(
          DATE_TRUNC(DATE(@startDate), WEEK(MONDAY)),
          DATE_TRUNC(DATE(@endDate), WEEK(MONDAY)),
          INTERVAL 1 WEEK
        )
      ) as week_start
    )
    SELECT
      aw.week_start,
      COALESCE(ic.count, 0) as initial_calls,
      COALESCE(qc.count, 0) as qualification_calls,
      COALESCE(s.count, 0) as sqos,
      COALESCE(m.count, 0) as mqls,
      COALESCE(sq2.count, 0) as sqls,
      COALESCE(ls.total, 0) as leads_sourced,
      COALESCE(ls.self_sourced, 0) as leads_sourced_self,
      COALESCE(lc.total, 0) as leads_contacted,
      COALESCE(lcs.self_sourced, 0) as leads_contacted_self
    FROM all_weeks aw
    LEFT JOIN initial_calls ic ON aw.week_start = ic.week_start
    LEFT JOIN qual_calls qc ON aw.week_start = qc.week_start
    LEFT JOIN sqos s ON aw.week_start = s.week_start
    LEFT JOIN mqls m ON aw.week_start = m.week_start
    LEFT JOIN sqls sq2 ON aw.week_start = sq2.week_start
    LEFT JOIN leads_sourced ls ON aw.week_start = ls.week_start
    LEFT JOIN leads_contacted lc ON aw.week_start = lc.week_start
    LEFT JOIN leads_contacted_self lcs ON aw.week_start = lcs.week_start
    ORDER BY aw.week_start DESC
  `;

  const params = {
    sgaName,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawWeeklyActualResult>(query, params);
  
  return results.map(transformWeeklyActual);
};

export const getWeeklyActuals = cachedQuery(
  _getWeeklyActuals,
  'getWeeklyActuals',
  CACHE_TAGS.SGA_HUB
);

/**
 * Get weekly actuals for all SGAs (admin view)
 */
const _getAllSGAWeeklyActuals = async (
  startDate: string,
  endDate: string
): Promise<{ sgaName: string; actuals: WeeklyActual[] }[]> => {
  const query = `
    WITH initial_calls AS (
      SELECT 
        SGA_Owner_Name__c as sga_name,
        DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT primary_key) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND Initial_Call_Scheduled_Date__c IS NOT NULL
        AND Initial_Call_Scheduled_Date__c >= @startDate
        AND Initial_Call_Scheduled_Date__c <= @endDate
      GROUP BY sga_name, week_start
    ),
    qual_calls AS (
      SELECT 
        SGA_Owner_Name__c as sga_name,
        DATE_TRUNC(Qualification_Call_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT Full_Opportunity_ID__c) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND Qualification_Call_Date__c IS NOT NULL
        AND Qualification_Call_Date__c >= @startDate
        AND Qualification_Call_Date__c <= @endDate
      GROUP BY sga_name, week_start
    ),
    sqos AS (
      SELECT 
        SGA_Owner_Name__c as sga_name,
        DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND is_sqo_unique = 1
        AND Date_Became_SQO__c IS NOT NULL
        AND Date_Became_SQO__c >= TIMESTAMP(@startDate)
        AND Date_Became_SQO__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
        AND recordtypeid = @recruitingRecordType
      GROUP BY sga_name, week_start
    ),
    mqls AS (
      SELECT
        SGA_Owner_Name__c as sga_name,
        DATE(DATE_TRUNC(mql_stage_entered_ts, WEEK(MONDAY))) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND mql_stage_entered_ts IS NOT NULL
        AND mql_stage_entered_ts >= TIMESTAMP(@startDate)
        AND mql_stage_entered_ts <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY sga_name, week_start
    ),
    sqls AS (
      SELECT
        SGA_Owner_Name__c as sga_name,
        DATE_TRUNC(converted_date_raw, WEEK(MONDAY)) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND converted_date_raw IS NOT NULL
        AND converted_date_raw >= @startDate
        AND converted_date_raw <= @endDate
        AND is_sql = 1
      GROUP BY sga_name, week_start
    ),
    leads_sourced AS (
      SELECT
        u.Name as sga_name,
        DATE(DATE_TRUNC(l.CreatedDate, WEEK(MONDAY))) as week_start,
        COUNT(*) as total,
        COUNTIF(l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')) as self_sourced
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
      JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
      WHERE l.CreatedDate >= TIMESTAMP(@startDate)
        AND l.CreatedDate <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY sga_name, week_start
    ),
    leads_contacted AS (
      SELECT
        SGA_Owner_Name__c as sga_name,
        DATE(DATE_TRUNC(stage_entered_contacting__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as total
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND stage_entered_contacting__c IS NOT NULL
        AND stage_entered_contacting__c >= TIMESTAMP(@startDate)
        AND stage_entered_contacting__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY sga_name, week_start
    ),
    leads_contacted_self AS (
      SELECT
        u.Name as sga_name,
        DATE(DATE_TRUNC(l.Stage_Entered_Contacting__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as self_sourced
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
      JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
      WHERE l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
        AND l.Stage_Entered_Contacting__c IS NOT NULL
        AND l.Stage_Entered_Contacting__c >= TIMESTAMP(@startDate)
        AND l.Stage_Entered_Contacting__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      GROUP BY sga_name, week_start
    ),
    all_sgas AS (
      SELECT DISTINCT SGA_Owner_Name__c as sga_name
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
    ),
    all_weeks AS (
      SELECT week_start
      FROM UNNEST(
        GENERATE_DATE_ARRAY(
          DATE_TRUNC(DATE(@startDate), WEEK(MONDAY)),
          DATE_TRUNC(DATE(@endDate), WEEK(MONDAY)),
          INTERVAL 1 WEEK
        )
      ) as week_start
    )
    SELECT
      s.sga_name,
      aw.week_start,
      COALESCE(ic.count, 0) as initial_calls,
      COALESCE(qc.count, 0) as qualification_calls,
      COALESCE(sq.count, 0) as sqos,
      COALESCE(m.count, 0) as mqls,
      COALESCE(sq2.count, 0) as sqls,
      COALESCE(ls.total, 0) as leads_sourced,
      COALESCE(ls.self_sourced, 0) as leads_sourced_self,
      COALESCE(lc.total, 0) as leads_contacted,
      COALESCE(lcs.self_sourced, 0) as leads_contacted_self
    FROM all_sgas s
    CROSS JOIN all_weeks aw
    LEFT JOIN initial_calls ic ON s.sga_name = ic.sga_name AND aw.week_start = ic.week_start
    LEFT JOIN qual_calls qc ON s.sga_name = qc.sga_name AND aw.week_start = qc.week_start
    LEFT JOIN sqos sq ON s.sga_name = sq.sga_name AND aw.week_start = sq.week_start
    LEFT JOIN mqls m ON s.sga_name = m.sga_name AND aw.week_start = m.week_start
    LEFT JOIN sqls sq2 ON s.sga_name = sq2.sga_name AND aw.week_start = sq2.week_start
    LEFT JOIN leads_sourced ls ON s.sga_name = ls.sga_name AND aw.week_start = ls.week_start
    LEFT JOIN leads_contacted lc ON s.sga_name = lc.sga_name AND aw.week_start = lc.week_start
    LEFT JOIN leads_contacted_self lcs ON s.sga_name = lcs.sga_name AND aw.week_start = lcs.week_start
    ORDER BY s.sga_name, aw.week_start DESC
  `;
  
  const params = {
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawWeeklyActualResult & { sga_name: string }>(query, params);
  
  // Group by SGA
  const sgaMap = new Map<string, WeeklyActual[]>();
  
  for (const row of results) {
    const sgaName = row.sga_name;
    if (!sgaMap.has(sgaName)) {
      sgaMap.set(sgaName, []);
    }
    sgaMap.get(sgaName)!.push(transformWeeklyActual(row));
  }
  
  return Array.from(sgaMap.entries()).map(([sgaName, actuals]) => ({
    sgaName,
    actuals,
  }));
};

export const getAllSGAWeeklyActuals = cachedQuery(
  _getAllSGAWeeklyActuals,
  'getAllSGAWeeklyActuals',
  CACHE_TAGS.SGA_HUB
);

/**
 * Transform raw BigQuery result to WeeklyActual
 * week_start is always a DATE type from BigQuery (YYYY-MM-DD format)
 */
function transformWeeklyActual(row: RawWeeklyActualResult): WeeklyActual {
  let weekStartDate: string;
  if (typeof row.week_start === 'object' && 'value' in row.week_start) {
    // BigQuery DATE fields can return as { value: "YYYY-MM-DD" }
    weekStartDate = row.week_start.value.split('T')[0];
  } else if (typeof row.week_start === 'string') {
    // Direct string format "YYYY-MM-DD"
    weekStartDate = row.week_start.split('T')[0];
  } else {
    // Fallback: convert to string and extract date part
    weekStartDate = String(row.week_start).split('T')[0];
  }
  
  // Ensure format is YYYY-MM-DD (no time component)
  if (weekStartDate.length > 10) {
    weekStartDate = weekStartDate.substring(0, 10);
  }
  
  return {
    weekStartDate,
    initialCalls: toNumber(row.initial_calls) || 0,
    qualificationCalls: toNumber(row.qualification_calls) || 0,
    sqos: toNumber(row.sqos) || 0,
    mqls: toNumber(row.mqls) || 0,
    sqls: toNumber(row.sqls) || 0,
    leadsSourced: toNumber(row.leads_sourced) || 0,
    leadsSourcedSelfSourced: toNumber(row.leads_sourced_self) || 0,
    leadsContacted: toNumber(row.leads_contacted) || 0,
    leadsContactedSelfSourced: toNumber(row.leads_contacted_self) || 0,
  };
}
