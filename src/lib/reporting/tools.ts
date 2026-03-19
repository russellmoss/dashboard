import { tool } from 'ai';
import { z } from 'zod';
import { BigQuery, Query } from '@google-cloud/bigquery';
import { CONSTANTS } from '@/lib/semantic-layer/definitions';
import { getReportingContextPayload } from '@/lib/reporting/context';
import { logger } from '@/lib/logger';
import type { QueryLogEntry, ReportType } from '@/types/reporting';

const bigqueryClient = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const EXCLUDED_REPORT_SGAS = [
  'Anett Diaz',
  'Ariana Butler',
  'Bre McDaniel',
  'Bryan Belville',
  'GinaRose Galli',
  'Jacqueline Tully',
  'Jed Entin',
  'Russell Moss',
  'Savvy Marketing',
  'Savvy Operations',
];

function normalizeBigQueryError(error: unknown) {
  if (error instanceof Error) {
    const detailedError = error as Error & {
      code?: number | string;
      errors?: Array<Record<string, unknown>>;
      response?: { data?: unknown };
    };

    return {
      message: detailedError.message,
      code: detailedError.code ?? null,
      errors: detailedError.errors ?? null,
      response: detailedError.response?.data ?? null,
      stack: detailedError.stack ?? null,
    };
  }

  return {
    message: typeof error === 'string' ? error : JSON.stringify(error),
    code: null,
    errors: null,
    response: null,
    stack: null,
  };
}

function trimForLog(sql: string) {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function getStatsFromResult(
  result: [Record<string, unknown>[], { metadata?: { statistics?: { totalBytesProcessed?: string } } }]
) {
  const rows = result[0] ?? [];
  const job = result[1];
  const cappedRows = rows.slice(0, 200);
  const bytesScanned = Number(job?.metadata?.statistics?.totalBytesProcessed ?? 0);
  return { cappedRows, bytesScanned };
}

function buildSgmSectionQuery(section: string, exactName: string) {
  switch (section) {
    case 'identify-role':
      return {
        description: `Resolve role and exact warehouse name for ${exactName}`,
        sql: `
WITH matches AS (
  SELECT
    'sgm' AS role,
    SGM_Owner_Name__c AS matched_name,
    COUNT(*) AS matched_records
  FROM \`${CONSTANTS.FULL_TABLE}\`
  WHERE SGM_Owner_Name__c IS NOT NULL
    AND LOWER(SGM_Owner_Name__c) LIKE LOWER(@namePattern)
  GROUP BY 1, 2

  UNION ALL

  SELECT
    'sga' AS role,
    SGA_Owner_Name__c AS matched_name,
    COUNT(*) AS matched_records
  FROM \`${CONSTANTS.FULL_TABLE}\`
  WHERE SGA_Owner_Name__c IS NOT NULL
    AND LOWER(SGA_Owner_Name__c) LIKE LOWER(@namePattern)
  GROUP BY 1, 2
)
SELECT role, matched_name, matched_records
FROM matches
ORDER BY matched_records DESC, matched_name ASC
LIMIT 10
        `,
        params: { namePattern: `%${exactName}%` },
      };
    case 'sgm-qualification-discipline':
      return {
        description: `Qualification discipline benchmark across all SGMs using ${exactName} for comparison`,
        sql: `
SELECT
  v.SGM_Owner_Name__c AS sgm_name,
  COUNT(DISTINCT CASE WHEN v.is_primary_opp_record = 1 AND v.is_sql = 1 THEN v.Full_Opportunity_ID__c END) AS total_sqls,
  SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END) AS total_sqos,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END),
    COUNT(DISTINCT CASE WHEN v.is_primary_opp_record = 1 AND v.is_sql = 1 THEN v.Full_Opportunity_ID__c END)
  ) AS sql_to_sqo_pct,
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS total_joined,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) +
      COUNTIF(v.StageName = 'Closed Lost' AND v.is_primary_opp_record = 1 AND v.is_sqo = 1)
  ) AS close_rate_pct,
  ROUND(SUM(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM_M ELSE 0 END), 1) AS joined_aum_m,
  ROUND(AVG(
    CASE
      WHEN v.is_joined_unique = 1
        AND v.advisor_join_date__c IS NOT NULL
        AND v.Date_Became_SQO__c IS NOT NULL
      THEN DATE_DIFF(v.advisor_join_date__c, DATE(v.Date_Became_SQO__c), DAY)
      ELSE NULL
    END
  ), 1) AS avg_sqo_to_join_days,
  v.SGM_Owner_Name__c = @exactName AS is_target_sgm
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.SGM_Owner_Name__c IS NOT NULL
GROUP BY v.SGM_Owner_Name__c
HAVING total_sqos >= 10
ORDER BY close_rate_pct DESC, total_joined DESC
        `,
        params: { exactName },
      };
    case 'sgm-routing-breakdown':
      return {
        description: `SGA routing breakdown for SGM ${exactName}`,
        sql: `
SELECT
  COALESCE(v.SGA_Owner_Name__c, 'Unassigned') AS sga_name,
  COUNT(DISTINCT CASE WHEN v.is_primary_opp_record = 1 AND v.is_sql = 1 THEN v.Full_Opportunity_ID__c END) AS sqls_routed,
  SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END) AS sqos,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END),
    COUNT(DISTINCT CASE WHEN v.is_primary_opp_record = 1 AND v.is_sql = 1 THEN v.Full_Opportunity_ID__c END)
  ) AS sql_to_sqo_pct,
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS joined,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) +
      COUNTIF(v.StageName = 'Closed Lost' AND v.is_primary_opp_record = 1 AND v.is_sqo = 1)
  ) AS close_rate_pct,
  ROUND(AVG(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM_M ELSE NULL END), 1) AS avg_joined_aum_m
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.SGM_Owner_Name__c = @exactName
GROUP BY 1
HAVING sqls_routed > 0
ORDER BY joined DESC, sqos DESC, sqls_routed DESC
        `,
        params: { exactName },
      };
    case 'sgm-pipeline':
      return {
        description: `Current open SQO pipeline for SGM ${exactName}`,
        sql: `
SELECT
  v.StageName AS stage,
  COUNT(DISTINCT v.Full_Opportunity_ID__c) AS opps,
  ROUND(SUM(v.Opportunity_AUM_M), 1) AS total_aum_m,
  ROUND(AVG(v.Opportunity_AUM_M), 1) AS avg_aum_m,
  ROUND(AVG(
    CASE v.StageName
      WHEN 'Qualifying' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Date_Became_SQO__c), DAY)
      WHEN 'Discovery' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Discovery__c), DAY)
      WHEN 'Sales Process' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Sales_Process__c), DAY)
      WHEN 'Negotiating' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Negotiating__c), DAY)
      ELSE NULL
    END
  ), 1) AS avg_days_in_stage
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.SGM_Owner_Name__c = @exactName
  AND v.is_sqo = 1
  AND v.is_primary_opp_record = 1
  AND v.is_joined = 0
  AND v.StageName IN UNNEST(@openStages)
GROUP BY 1
ORDER BY CASE v.StageName
  WHEN 'Qualifying' THEN 1
  WHEN 'Discovery' THEN 2
  WHEN 'Sales Process' THEN 3
  WHEN 'Negotiating' THEN 4
  ELSE 99
END
        `,
        params: { exactName, openStages: [...CONSTANTS.OPEN_PIPELINE_STAGES] },
      };
    case 'sgm-quarterly-trend':
      return {
        description: `Quarterly production trend for SGM ${exactName}`,
        sql: `
SELECT
  FORMAT_DATE('%Y-Q%Q', DATE_TRUNC(DATE(v.Date_Became_SQO__c), QUARTER)) AS quarter,
  COUNT(DISTINCT CASE WHEN v.is_primary_opp_record = 1 AND v.is_sql = 1 THEN v.Full_Opportunity_ID__c END) AS sqls,
  SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END) AS sqos,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END),
    COUNT(DISTINCT CASE WHEN v.is_primary_opp_record = 1 AND v.is_sql = 1 THEN v.Full_Opportunity_ID__c END)
  ) AS sql_to_sqo_pct,
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS joined,
  ROUND(SUM(CASE WHEN v.is_sqo_unique = 1 THEN v.Opportunity_AUM_M ELSE 0 END), 1) AS sqo_aum_m,
  COUNT(DISTINCT CASE WHEN v.is_primary_opp_record = 1 THEN v.SGA_Owner_Name__c END) AS active_sgas
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.SGM_Owner_Name__c = @exactName
  AND v.Date_Became_SQO__c IS NOT NULL
GROUP BY 1
ORDER BY MIN(DATE_TRUNC(DATE(v.Date_Became_SQO__c), QUARTER))
        `,
        params: { exactName },
      };
    case 'sgm-source-performance':
      return {
        description: `Won/lost by source for SGM ${exactName}`,
        sql: `
SELECT
  COALESCE(v.Original_source, 'Unknown') AS original_source,
  COALESCE(v.Channel_Grouping_Name, 'Unknown') AS channel_grouping_name,
  SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END) AS sqos,
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS joined,
  COUNTIF(v.StageName = 'Closed Lost' AND v.is_primary_opp_record = 1 AND v.is_sqo = 1) AS closed_lost,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) +
      COUNTIF(v.StageName = 'Closed Lost' AND v.is_primary_opp_record = 1 AND v.is_sqo = 1)
  ) AS close_rate_pct
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.SGM_Owner_Name__c = @exactName
  AND v.is_sqo = 1
GROUP BY 1, 2
HAVING sqos >= 3
ORDER BY joined DESC, sqos DESC
        `,
        params: { exactName },
      };
    default:
      throw new Error(`Unsupported SGM analysis section: ${section}`);
  }
}

function buildCompetitiveIntelSectionQuery(section: string) {
  const lossesCte = `
WITH canonical_losses AS (
  SELECT
    l.opportunity_id,
    CASE
      WHEN LOWER(l.moved_to_firm) LIKE '%mariner%' THEN 'Mariner'
      WHEN LOWER(l.moved_to_firm) LIKE '%lpl%' THEN 'LPL'
      ELSE l.moved_to_firm
    END AS competitor,
    l.moved_to_firm,
    ROUND(l.months_to_move, 1) AS months_to_move,
    DATE(l.closed_lost_date) AS closed_lost_date,
    l.closed_lost_reason,
    l.closed_lost_details,
    f.Opportunity_AUM_M,
    ROW_NUMBER() OVER (
      PARTITION BY l.opportunity_id
      ORDER BY DATE(l.closed_lost_date) DESC, l.moved_to_firm
    ) AS row_num
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition\` l
  LEFT JOIN \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
    ON l.opportunity_id = f.Full_Opportunity_ID__c
  WHERE l.moved_to_firm IS NOT NULL
    AND TRIM(l.moved_to_firm) != ''
),
losses AS (
  SELECT
    opportunity_id,
    competitor,
    moved_to_firm,
    months_to_move,
    closed_lost_date,
    closed_lost_reason,
    closed_lost_details,
    Opportunity_AUM_M
  FROM canonical_losses
  WHERE row_num = 1
)
  `;

  switch (section) {
    case 'competitor-leaderboard':
      return {
        description: 'Verified competitor leaderboard with canonical grouping, distinct opportunity counts, and AUM lost in millions',
        sql: `
${lossesCte}
SELECT
  competitor,
  COUNT(DISTINCT opportunity_id) AS deal_count,
  ROUND(SUM(COALESCE(Opportunity_AUM_M, 0)), 1) AS total_aum_m,
  ROUND(AVG(COALESCE(Opportunity_AUM_M, 0)), 1) AS avg_aum_m,
  ROUND(AVG(months_to_move), 1) AS avg_months_to_move
FROM losses
GROUP BY competitor
ORDER BY deal_count DESC, total_aum_m DESC
LIMIT 15
        `,
      };
    case 'deal-economics':
      return {
        description: 'Verified deal economics comparison between joined deals and lost-to-competition deals',
        sql: `
${lossesCte},
wins AS (
  SELECT DISTINCT
    v.Full_Opportunity_ID__c AS opportunity_id,
    v.Opportunity_AUM_M
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  WHERE v.is_joined_unique = 1
    AND v.Full_Opportunity_ID__c IS NOT NULL
)
SELECT
  'Lost to Competition' AS cohort,
  COUNT(DISTINCT opportunity_id) AS deal_count,
  ROUND(SUM(COALESCE(Opportunity_AUM_M, 0)), 1) AS total_aum_m,
  ROUND(AVG(COALESCE(Opportunity_AUM_M, 0)), 1) AS avg_aum_m,
  ROUND(APPROX_QUANTILES(COALESCE(Opportunity_AUM_M, 0), 2)[OFFSET(1)], 1) AS median_aum_m
FROM losses

UNION ALL

SELECT
  'Won (Joined)' AS cohort,
  COUNT(DISTINCT opportunity_id) AS deal_count,
  ROUND(SUM(COALESCE(Opportunity_AUM_M, 0)), 1) AS total_aum_m,
  ROUND(AVG(COALESCE(Opportunity_AUM_M, 0)), 1) AS avg_aum_m,
  ROUND(APPROX_QUANTILES(COALESCE(Opportunity_AUM_M, 0), 2)[OFFSET(1)], 1) AS median_aum_m
FROM wins
        `,
      };
    case 'loss-reasons':
      return {
        description: 'Verified qualitative loss reasons with canonical competitor grouping',
        sql: `
${lossesCte}
SELECT
  competitor,
  COALESCE(NULLIF(TRIM(closed_lost_reason), ''), 'Unspecified') AS closed_lost_reason,
  COUNT(DISTINCT opportunity_id) AS deal_count,
  ROUND(SUM(COALESCE(Opportunity_AUM_M, 0)), 1) AS total_aum_m
FROM losses
GROUP BY competitor, closed_lost_reason
ORDER BY deal_count DESC, total_aum_m DESC
LIMIT 50
        `,
      };
    case 'time-trend':
      return {
        description: 'Verified quarter-over-quarter trend of competitive losses with canonical competitor grouping',
        sql: `
${lossesCte}
SELECT
  FORMAT_DATE('%Y-Q%Q', DATE_TRUNC(closed_lost_date, QUARTER)) AS quarter,
  COUNT(DISTINCT opportunity_id) AS deal_count,
  ROUND(SUM(COALESCE(Opportunity_AUM_M, 0)), 1) AS total_aum_m,
  COUNT(DISTINCT competitor) AS competitor_count
FROM losses
WHERE closed_lost_date IS NOT NULL
GROUP BY quarter
ORDER BY MIN(DATE_TRUNC(closed_lost_date, QUARTER))
        `,
      };
    default:
      throw new Error(`Unsupported competitive intelligence section: ${section}`);
  }
}

function buildAnalyzeWinsSectionQuery(section: string) {
  switch (section) {
    case 'joined-kpis':
      return {
        description: 'Verified top-level joined advisor KPIs from vw_funnel_master',
        sql: `
SELECT
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS total_joined,
  ROUND(AVG(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM_M END), 1) AS avg_joined_aum_m,
  ROUND(SUM(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM_M ELSE 0 END), 1) AS total_joined_aum_m,
  ROUND(AVG(
    CASE
      WHEN v.is_joined_unique = 1
        AND v.Date_Became_SQO__c IS NOT NULL
        AND v.advisor_join_date__c IS NOT NULL
      THEN DATE_DIFF(v.advisor_join_date__c, DATE(v.Date_Became_SQO__c), DAY)
      ELSE NULL
    END
  ), 1) AS avg_sqo_to_join_days,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) +
      COUNTIF(v.StageName = 'Closed Lost' AND v.is_primary_opp_record = 1 AND v.is_sqo = 1)
  ) AS overall_close_rate
FROM \`${CONSTANTS.FULL_TABLE}\` v
        `,
      };
    case 'source-channel-performance':
      return {
        description: 'Verified source and channel performance for joined advisors and close rate',
        sql: `
SELECT
  COALESCE(v.Original_source, 'Unknown') AS original_source,
  COALESCE(v.Channel_Grouping_Name, 'Unknown') AS channel_grouping_name,
  SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END) AS sqos,
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS joined,
  ROUND(SUM(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM_M ELSE 0 END), 1) AS joined_aum_m,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) +
      COUNTIF(v.StageName = 'Closed Lost' AND v.is_primary_opp_record = 1 AND v.is_sqo = 1)
  ) AS close_rate
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.is_sqo = 1
GROUP BY 1, 2
HAVING sqos >= 5
ORDER BY joined DESC, close_rate DESC, joined_aum_m DESC
LIMIT 25
        `,
      };
    case 'sga-leaderboard':
      return {
        description: 'Verified SGA leaderboard for joined deals, close rate, AUM, and cycle time using the dashboard SGA role/exclusion logic',
        sql: `
SELECT
  COALESCE(v.SGA_Owner_Name__c, 'Unassigned') AS sga_name,
  SUM(CASE WHEN v.is_sqo_unique = 1 THEN 1 ELSE 0 END) AS sqos,
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS joined,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) +
      COUNTIF(v.StageName = 'Closed Lost' AND v.is_primary_opp_record = 1 AND v.is_sqo = 1)
  ) AS close_rate,
  ROUND(AVG(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM_M END), 1) AS avg_joined_aum_m,
  ROUND(AVG(
    CASE
      WHEN v.is_joined_unique = 1
        AND v.Date_Became_SQO__c IS NOT NULL
        AND v.advisor_join_date__c IS NOT NULL
      THEN DATE_DIFF(v.advisor_join_date__c, DATE(v.Date_Became_SQO__c), DAY)
      ELSE NULL
    END
  ), 1) AS avg_sqo_to_join_days
FROM \`${CONSTANTS.FULL_TABLE}\` v
INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
  ON v.SGA_Owner_Name__c = u.Name
  AND u.IsSGA__c = TRUE
WHERE v.SGA_Owner_Name__c IS NOT NULL
  AND v.SGA_Owner_Name__c NOT IN UNNEST(@excludedSgas)
GROUP BY 1
HAVING sqos >= 5
ORDER BY joined DESC, close_rate DESC, avg_joined_aum_m DESC
LIMIT 20
        `,
        params: { excludedSgas: EXCLUDED_REPORT_SGAS },
      };
    case 'sms-behavior':
      return {
        description: 'Verified SMS behavior comparison for joined vs non-joined leads using the deployed SMS timing view',
        sql: `
SELECT
  is_joined,
  COUNT(*) AS lead_count,
  ROUND(AVG(days_to_first_sms), 2) AS avg_days_to_first_sms,
  ROUND(AVG(days_to_first_double_tap), 2) AS avg_days_to_first_double_tap,
  ROUND(AVG(total_outbound_sms), 2) AS avg_total_outbound_sms,
  ROUND(AVG(total_inbound_sms), 2) AS avg_total_inbound_sms,
  SAFE_DIVIDE(SUM(CASE WHEN got_reply = 1 THEN 1 ELSE 0 END), COUNT(*)) AS reply_rate,
  SAFE_DIVIDE(SUM(CASE WHEN first_sms_same_day = 1 THEN 1 ELSE 0 END), COUNT(*)) AS same_day_first_sms_rate
FROM \`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2\`
GROUP BY 1
ORDER BY 1 DESC
        `,
      };
    case 'quarterly-velocity':
      return {
        description: 'Verified quarterly joined trend and cycle time from SQO to join',
        sql: `
SELECT
  FORMAT_DATE('%Y-Q%Q', DATE_TRUNC(v.advisor_join_date__c, QUARTER)) AS joined_quarter,
  SUM(CASE WHEN v.is_joined_unique = 1 THEN 1 ELSE 0 END) AS joined,
  ROUND(SUM(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM_M ELSE 0 END), 1) AS joined_aum_m,
  ROUND(AVG(
    CASE
      WHEN v.is_joined_unique = 1
        AND v.Date_Became_SQO__c IS NOT NULL
        AND v.advisor_join_date__c IS NOT NULL
      THEN DATE_DIFF(v.advisor_join_date__c, DATE(v.Date_Became_SQO__c), DAY)
      ELSE NULL
    END
  ), 1) AS avg_sqo_to_join_days
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.is_joined_unique = 1
  AND v.advisor_join_date__c IS NOT NULL
GROUP BY 1
ORDER BY MIN(DATE_TRUNC(v.advisor_join_date__c, QUARTER))
        `,
      };
    case 'aum-distribution':
      return {
        description: 'Verified AUM tier distribution for joined advisors',
        sql: `
SELECT
  CASE
    WHEN v.Opportunity_AUM_M < 50 THEN '<$50M'
    WHEN v.Opportunity_AUM_M < 100 THEN '$50M-$100M'
    WHEN v.Opportunity_AUM_M < 200 THEN '$100M-$200M'
    ELSE '$200M+'
  END AS aum_bucket,
  COUNT(*) AS joined_count,
  ROUND(SUM(v.Opportunity_AUM_M), 1) AS total_aum_m,
  ROUND(AVG(v.Opportunity_AUM_M), 1) AS avg_aum_m
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.is_joined_unique = 1
  AND v.Opportunity_AUM_M IS NOT NULL
GROUP BY 1
ORDER BY CASE aum_bucket
  WHEN '<$50M' THEN 1
  WHEN '$50M-$100M' THEN 2
  WHEN '$100M-$200M' THEN 3
  WHEN '$200M+' THEN 4
  ELSE 99
END
        `,
      };
    case 'won-vs-lost-contrast':
      return {
        description: 'Verified won versus lost-to-competition contrast using joined wins and canonical loss data',
        sql: `
WITH wins AS (
  SELECT DISTINCT
    v.Full_Opportunity_ID__c AS opportunity_id,
    v.Opportunity_AUM_M,
    DATE(v.advisor_join_date__c) AS outcome_date,
    'Won (Joined)' AS cohort
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  WHERE v.is_joined_unique = 1
    AND v.Full_Opportunity_ID__c IS NOT NULL
),
losses AS (
  SELECT DISTINCT
    l.opportunity_id,
    f.Opportunity_AUM_M,
    DATE(l.closed_lost_date) AS outcome_date,
    'Lost to Competition' AS cohort
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition\` l
  LEFT JOIN \`${CONSTANTS.FULL_TABLE}\` f
    ON l.opportunity_id = f.Full_Opportunity_ID__c
  WHERE l.moved_to_firm IS NOT NULL
    AND TRIM(l.moved_to_firm) != ''
)
SELECT
  cohort,
  COUNT(DISTINCT opportunity_id) AS deal_count,
  ROUND(SUM(COALESCE(Opportunity_AUM_M, 0)), 1) AS total_aum_m,
  ROUND(AVG(COALESCE(Opportunity_AUM_M, 0)), 1) AS avg_aum_m,
  ROUND(APPROX_QUANTILES(COALESCE(Opportunity_AUM_M, 0), 2)[OFFSET(1)], 1) AS median_aum_m
FROM (
  SELECT * FROM wins
  UNION ALL
  SELECT * FROM losses
)
GROUP BY cohort
ORDER BY deal_count DESC
        `,
      };
    default:
      throw new Error(`Unsupported analyze-wins section: ${section}`);
  }
}

function buildSgaPerformanceSectionQuery(section: string) {
  const activeSgasCte = `
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
  WHERE u.IsSGA__c = TRUE
    AND u.IsActive = TRUE
    AND u.Name NOT IN UNNEST(@excludedSgas)
),
ResolvedOpps AS (
  SELECT
    COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) AS sga_name,
    v.primary_key,
    v.Full_Opportunity_ID__c,
    v.StageName,
    v.Date_Became_SQO__c,
    v.advisor_join_date__c,
    v.Opportunity_AUM_M,
    v.is_sqo_unique,
    v.is_joined_unique,
    v.is_primary_opp_record,
    v.sql_to_sqo_progression,
    v.eligible_for_sql_conversions,
    v.sqo_to_joined_progression,
    v.eligible_for_sqo_conversions,
    DATE(v.stage_entered_contacting__c) AS contacted_date,
    DATE(v.mql_stage_entered_ts) AS mql_date,
    DATE(v.converted_date_raw) AS sql_date
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
    ON v.Opp_SGA_Name__c = sga_user.Id
)
  `;

  switch (section) {
    case 'conversion-leaderboard':
      return {
        description: 'Verified SGA conversion leaderboard using the SGA Hub leaderboard ownership and exclusion logic',
        sql: `
${activeSgasCte},
LeadMetrics AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    COUNT(DISTINCT CASE WHEN v.stage_entered_contacting__c IS NOT NULL THEN v.primary_key END) AS contacted,
    COUNT(DISTINCT CASE WHEN v.mql_stage_entered_ts IS NOT NULL THEN v.primary_key END) AS mqls,
    COUNT(DISTINCT CASE WHEN v.converted_date_raw IS NOT NULL AND v.is_sql = 1 THEN v.primary_key END) AS sqls,
    SUM(CASE WHEN v.stage_entered_contacting__c IS NOT NULL THEN v.contacted_to_mql_progression ELSE 0 END) AS contacted_to_mql_numer,
    SUM(CASE WHEN v.stage_entered_contacting__c IS NOT NULL THEN v.eligible_for_contacted_conversions_30d ELSE 0 END) AS contacted_to_mql_denom,
    SUM(CASE WHEN v.mql_stage_entered_ts IS NOT NULL THEN v.mql_to_sql_progression ELSE 0 END) AS mql_to_sql_numer,
    SUM(CASE WHEN v.mql_stage_entered_ts IS NOT NULL THEN v.eligible_for_mql_conversions ELSE 0 END) AS mql_to_sql_denom
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  INNER JOIN ActiveSGAs a
    ON v.SGA_Owner_Name__c = a.sga_name
  GROUP BY 1
),
OppMetrics AS (
  SELECT
    r.sga_name,
    COUNT(DISTINCT CASE WHEN r.is_sqo_unique = 1 THEN r.primary_key END) AS sqos,
    COUNT(DISTINCT CASE WHEN r.is_joined_unique = 1 THEN r.primary_key END) AS joined,
    SUM(CASE WHEN r.sql_date IS NOT NULL THEN r.sql_to_sqo_progression ELSE 0 END) AS sql_to_sqo_numer,
    SUM(CASE WHEN r.sql_date IS NOT NULL THEN r.eligible_for_sql_conversions ELSE 0 END) AS sql_to_sqo_denom,
    SUM(CASE WHEN r.Date_Became_SQO__c IS NOT NULL THEN r.sqo_to_joined_progression ELSE 0 END) AS sqo_to_joined_numer,
    SUM(CASE WHEN r.Date_Became_SQO__c IS NOT NULL THEN r.eligible_for_sqo_conversions ELSE 0 END) AS sqo_to_joined_denom,
    COUNT(DISTINCT CASE
      WHEN r.is_primary_opp_record = 1
        AND r.StageName = 'Closed Lost'
        AND r.Date_Became_SQO__c IS NOT NULL
      THEN r.Full_Opportunity_ID__c
    END) AS closed_lost_sqo,
    ROUND(AVG(CASE WHEN r.is_joined_unique = 1 THEN r.Opportunity_AUM_M END), 1) AS avg_joined_aum_m
  FROM ResolvedOpps r
  INNER JOIN ActiveSGAs a
    ON r.sga_name = a.sga_name
  GROUP BY 1
)
SELECT
  a.sga_name,
  COALESCE(l.contacted, 0) AS contacted,
  COALESCE(l.mqls, 0) AS mqls,
  COALESCE(l.sqls, 0) AS sqls,
  COALESCE(o.sqos, 0) AS sqos,
  COALESCE(o.joined, 0) AS joined,
  SAFE_DIVIDE(COALESCE(l.contacted_to_mql_numer, 0), NULLIF(COALESCE(l.contacted_to_mql_denom, 0), 0)) AS contacted_to_mql_rate,
  SAFE_DIVIDE(COALESCE(l.mql_to_sql_numer, 0), NULLIF(COALESCE(l.mql_to_sql_denom, 0), 0)) AS mql_to_sql_rate,
  SAFE_DIVIDE(COALESCE(o.sql_to_sqo_numer, 0), NULLIF(COALESCE(o.sql_to_sqo_denom, 0), 0)) AS sql_to_sqo_rate,
  SAFE_DIVIDE(COALESCE(o.sqo_to_joined_numer, 0), NULLIF(COALESCE(o.sqo_to_joined_denom, 0), 0)) AS close_rate,
  COALESCE(l.contacted_to_mql_numer, 0) AS contacted_to_mql_numer,
  COALESCE(l.contacted_to_mql_denom, 0) AS contacted_to_mql_denom,
  COALESCE(l.mql_to_sql_numer, 0) AS mql_to_sql_numer,
  COALESCE(l.mql_to_sql_denom, 0) AS mql_to_sql_denom,
  COALESCE(o.sql_to_sqo_numer, 0) AS sql_to_sqo_numer,
  COALESCE(o.sql_to_sqo_denom, 0) AS sql_to_sqo_denom,
  COALESCE(o.sqo_to_joined_numer, 0) AS close_rate_numer,
  COALESCE(o.sqo_to_joined_denom, 0) AS close_rate_denom,
  COALESCE(o.avg_joined_aum_m, 0) AS avg_joined_aum_m
FROM ActiveSGAs a
LEFT JOIN LeadMetrics l
  ON a.sga_name = l.sga_name
LEFT JOIN OppMetrics o
  ON a.sga_name = o.sga_name
ORDER BY joined DESC, close_rate DESC, sqos DESC, a.sga_name
        `,
        params: { excludedSgas: EXCLUDED_REPORT_SGAS },
      };
    case 'period-comparison':
      return {
        description: 'Verified last 90 days versus prior 90 days comparison by SGA using contacted-date cohorts and dashboard SGA logic',
        sql: `
${activeSgasCte},
Periods AS (
  SELECT 'last_90_days' AS period
  UNION ALL
  SELECT 'prior_90_days' AS period
),
PeriodizedLeads AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    CASE
      WHEN DATE(v.stage_entered_contacting__c) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 89 DAY) AND CURRENT_DATE() THEN 'last_90_days'
      WHEN DATE(v.stage_entered_contacting__c) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 179 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) THEN 'prior_90_days'
      ELSE NULL
    END AS period,
    COUNT(DISTINCT CASE WHEN v.stage_entered_contacting__c IS NOT NULL THEN v.primary_key END) AS contacted,
    COUNT(DISTINCT CASE WHEN v.mql_stage_entered_ts IS NOT NULL THEN v.primary_key END) AS mqls,
    COUNT(DISTINCT CASE WHEN v.converted_date_raw IS NOT NULL AND v.is_sql = 1 THEN v.primary_key END) AS sqls
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  INNER JOIN ActiveSGAs a
    ON v.SGA_Owner_Name__c = a.sga_name
  WHERE v.stage_entered_contacting__c IS NOT NULL
    AND DATE(v.stage_entered_contacting__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 179 DAY)
  GROUP BY 1, 2
),
PeriodizedOpps AS (
  SELECT
    r.sga_name,
    CASE
      WHEN r.contacted_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 89 DAY) AND CURRENT_DATE() THEN 'last_90_days'
      WHEN r.contacted_date BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 179 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) THEN 'prior_90_days'
      ELSE NULL
    END AS period,
    COUNT(DISTINCT CASE WHEN r.is_sqo_unique = 1 THEN r.primary_key END) AS sqos,
    COUNT(DISTINCT CASE WHEN r.is_joined_unique = 1 THEN r.primary_key END) AS joined,
    COUNT(DISTINCT CASE
      WHEN r.is_primary_opp_record = 1
        AND r.StageName = 'Closed Lost'
        AND r.Date_Became_SQO__c IS NOT NULL
      THEN r.Full_Opportunity_ID__c
    END) AS closed_lost_sqo
  FROM ResolvedOpps r
  INNER JOIN ActiveSGAs a
    ON r.sga_name = a.sga_name
  WHERE r.contacted_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 179 DAY)
  GROUP BY 1, 2
)
SELECT
  a.sga_name,
  p.period,
  COALESCE(l.contacted, 0) AS contacted,
  COALESCE(l.mqls, 0) AS mqls,
  COALESCE(l.sqls, 0) AS sqls,
  COALESCE(o.sqos, 0) AS sqos,
  COALESCE(o.joined, 0) AS joined,
  SAFE_DIVIDE(COALESCE(o.joined, 0), NULLIF(COALESCE(o.joined, 0) + COALESCE(o.closed_lost_sqo, 0), 0)) AS close_rate
FROM ActiveSGAs a
CROSS JOIN Periods p
LEFT JOIN PeriodizedLeads l
  ON a.sga_name = l.sga_name AND p.period = l.period
LEFT JOIN PeriodizedOpps o
  ON a.sga_name = o.sga_name AND p.period = o.period
ORDER BY a.sga_name, p.period DESC
        `,
        params: { excludedSgas: EXCLUDED_REPORT_SGAS },
      };
    case 'source-adjusted-performance':
      return {
        description: 'Verified source-adjusted SGA performance using Original_source and the dashboard SGA ownership rules',
        sql: `
${activeSgasCte},
LeadMetrics AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    COALESCE(v.Original_source, 'Unknown') AS original_source,
    COUNT(DISTINCT CASE WHEN v.stage_entered_contacting__c IS NOT NULL THEN v.primary_key END) AS contacted,
    COUNT(DISTINCT CASE WHEN v.mql_stage_entered_ts IS NOT NULL THEN v.primary_key END) AS mqls,
    COUNT(DISTINCT CASE WHEN v.converted_date_raw IS NOT NULL AND v.is_sql = 1 THEN v.primary_key END) AS sqls
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  INNER JOIN ActiveSGAs a
    ON v.SGA_Owner_Name__c = a.sga_name
  GROUP BY 1, 2
),
OppMetrics AS (
  SELECT
    r.sga_name,
    COALESCE(v.Original_source, 'Unknown') AS original_source,
    COUNT(DISTINCT CASE WHEN r.is_sqo_unique = 1 THEN r.primary_key END) AS sqos,
    COUNT(DISTINCT CASE WHEN r.is_joined_unique = 1 THEN r.primary_key END) AS joined,
    COUNT(DISTINCT CASE
      WHEN r.is_primary_opp_record = 1
        AND r.StageName = 'Closed Lost'
        AND r.Date_Became_SQO__c IS NOT NULL
      THEN r.Full_Opportunity_ID__c
    END) AS closed_lost_sqo
  FROM ResolvedOpps r
  INNER JOIN \`${CONSTANTS.FULL_TABLE}\` v
    ON r.primary_key = v.primary_key
  INNER JOIN ActiveSGAs a
    ON r.sga_name = a.sga_name
  GROUP BY 1, 2
)
SELECT
  l.sga_name,
  l.original_source,
  l.contacted,
  l.mqls,
  l.sqls,
  COALESCE(o.sqos, 0) AS sqos,
  COALESCE(o.joined, 0) AS joined,
  SAFE_DIVIDE(COALESCE(o.joined, 0), NULLIF(COALESCE(o.joined, 0) + COALESCE(o.closed_lost_sqo, 0), 0)) AS close_rate
FROM LeadMetrics l
LEFT JOIN OppMetrics o
  ON l.sga_name = o.sga_name
 AND l.original_source = o.original_source
WHERE l.contacted >= 5 OR COALESCE(o.sqos, 0) >= 3
ORDER BY close_rate DESC, joined DESC, l.contacted DESC
LIMIT 60
        `,
        params: { excludedSgas: EXCLUDED_REPORT_SGAS },
      };
    case 'bottleneck-analysis':
      return {
        description: 'Verified funnel bottleneck analysis by SGA using contacted, MQL, SQL, SQO, and joined stages',
        sql: `
${activeSgasCte},
LeadMetrics AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    COUNT(DISTINCT CASE WHEN v.stage_entered_contacting__c IS NOT NULL THEN v.primary_key END) AS contacted,
    COUNT(DISTINCT CASE WHEN v.mql_stage_entered_ts IS NOT NULL THEN v.primary_key END) AS mqls,
    COUNT(DISTINCT CASE WHEN v.converted_date_raw IS NOT NULL AND v.is_sql = 1 THEN v.primary_key END) AS sqls
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  INNER JOIN ActiveSGAs a
    ON v.SGA_Owner_Name__c = a.sga_name
  GROUP BY 1
),
OppMetrics AS (
  SELECT
    r.sga_name,
    COUNT(DISTINCT CASE WHEN r.is_sqo_unique = 1 THEN r.primary_key END) AS sqos,
    COUNT(DISTINCT CASE WHEN r.is_joined_unique = 1 THEN r.primary_key END) AS joined
  FROM ResolvedOpps r
  INNER JOIN ActiveSGAs a
    ON r.sga_name = a.sga_name
  GROUP BY 1
)
SELECT
  a.sga_name,
  COALESCE(l.contacted, 0) AS contacted,
  COALESCE(l.mqls, 0) AS mqls,
  COALESCE(l.sqls, 0) AS sqls,
  COALESCE(o.sqos, 0) AS sqos,
  COALESCE(o.joined, 0) AS joined,
  1 - SAFE_DIVIDE(COALESCE(l.mqls, 0), NULLIF(COALESCE(l.contacted, 0), 0)) AS contacted_to_mql_dropoff,
  1 - SAFE_DIVIDE(COALESCE(l.sqls, 0), NULLIF(COALESCE(l.mqls, 0), 0)) AS mql_to_sql_dropoff,
  1 - SAFE_DIVIDE(COALESCE(o.sqos, 0), NULLIF(COALESCE(l.sqls, 0), 0)) AS sql_to_sqo_dropoff,
  1 - SAFE_DIVIDE(COALESCE(o.joined, 0), NULLIF(COALESCE(o.sqos, 0), 0)) AS sqo_to_join_dropoff
FROM ActiveSGAs a
LEFT JOIN LeadMetrics l
  ON a.sga_name = l.sga_name
LEFT JOIN OppMetrics o
  ON a.sga_name = o.sga_name
ORDER BY sqo_to_join_dropoff DESC, sql_to_sqo_dropoff DESC, a.sga_name
        `,
        params: { excludedSgas: EXCLUDED_REPORT_SGAS },
      };
    case 'activity-profile':
      return {
        description: 'Verified SGA activity and connect profile from vw_sga_activity_performance',
        sql: `
SELECT
  a.SGA_Owner_Name__c AS sga_name,
  COUNT(*) AS total_activities,
  SUM(CASE WHEN a.direction = 'Outbound' THEN 1 ELSE 0 END) AS outbound_activities,
  SUM(CASE WHEN a.activity_channel = 'SMS' THEN 1 ELSE 0 END) AS sms_activities,
  SUM(CASE WHEN a.activity_channel = 'Call' THEN 1 ELSE 0 END) AS call_activities,
  SUM(CASE WHEN a.is_meaningful_connect = 1 THEN 1 ELSE 0 END) AS meaningful_connects,
  SAFE_DIVIDE(
    SUM(CASE WHEN a.is_meaningful_connect = 1 THEN 1 ELSE 0 END),
    NULLIF(SUM(CASE WHEN a.activity_channel = 'Call' AND a.direction = 'Outbound' THEN 1 ELSE 0 END), 0)
  ) AS call_connect_rate
FROM \`savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance\` a
INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
  ON a.SGA_Owner_Name__c = u.Name
  AND u.IsSGA__c = TRUE
  AND u.IsActive = TRUE
WHERE a.SGA_Owner_Name__c NOT IN UNNEST(@excludedSgas)
GROUP BY 1
ORDER BY meaningful_connects DESC, outbound_activities DESC, sga_name
        `,
        params: { excludedSgas: EXCLUDED_REPORT_SGAS },
      };
    case 'sms-discipline':
      return {
        description: 'Verified SMS timing and reply behavior by SGA from vw_sga_sms_timing_analysis_v2',
        sql: `
SELECT
  SGA_Owner_Name__c AS sga_name,
  COUNT(*) AS lead_count,
  ROUND(AVG(days_to_first_sms), 2) AS avg_days_to_first_sms,
  ROUND(AVG(days_to_first_double_tap), 2) AS avg_days_to_first_double_tap,
  ROUND(AVG(total_outbound_sms), 2) AS avg_total_outbound_sms,
  ROUND(AVG(total_inbound_sms), 2) AS avg_total_inbound_sms,
  SAFE_DIVIDE(SUM(CASE WHEN got_reply = 1 THEN 1 ELSE 0 END), COUNT(*)) AS reply_rate,
  SAFE_DIVIDE(SUM(CASE WHEN first_sms_same_day = 1 THEN 1 ELSE 0 END), COUNT(*)) AS same_day_first_sms_rate
FROM \`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2\`
WHERE SGA_Owner_Name__c IS NOT NULL
  AND SGA_Owner_Name__c NOT IN UNNEST(@excludedSgas)
GROUP BY 1
ORDER BY reply_rate DESC, same_day_first_sms_rate DESC, lead_count DESC
        `,
        params: { excludedSgas: EXCLUDED_REPORT_SGAS },
      };
    default:
      throw new Error(`Unsupported SGA performance section: ${section}`);
  }
}

// Factory function - creates a fresh tool instance with its own query log per report generation
export function createReportingTools(reportType: ReportType) {
  const queryLog: QueryLogEntry[] = [];

  const executeAndLog = async (
    sql: string,
    description: string,
    params?: Record<string, unknown>
  ) => {
    const startTime = Date.now();
    const trimmed = sql.trim();
    if (!/^\s*(SELECT|WITH)/i.test(trimmed)) {
      throw new Error('Only SELECT/WITH queries are allowed');
    }

    try {
      const options: Query = {
        query: sql,
        params: params ?? {},
        maximumBytesBilled: '1000000000',
        jobTimeoutMs: 30000,
      };

      const result = (await bigqueryClient.query(options)) as [Record<string, unknown>[], { metadata?: { statistics?: { totalBytesProcessed?: string } } }];
      const { cappedRows, bytesScanned } = getStatsFromResult(result);

      const entry: QueryLogEntry = {
        stepIndex: queryLog.length,
        sql,
        description,
        rows: cappedRows,
        rowCount: cappedRows.length,
        bytesScanned,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      queryLog.push(entry);

      return { rows: cappedRows, rowCount: cappedRows.length, description };
    } catch (error) {
      const normalizedError = normalizeBigQueryError(error);
      logger.error('[runBigQuery] Query failed', error, {
        description,
        sql: trimForLog(sql),
        params,
        bigQueryError: normalizedError,
      });
      throw new Error(normalizedError.message);
    }
  };

  const runBigQuery = tool({
    description: 'Execute a read-only SQL query against BigQuery. Prefer curated tools first when available. Returns rows as JSON.',
    inputSchema: z.object({
      sql: z.string().describe('The BigQuery SQL query to execute'),
      description: z.string().describe('Brief description of what this query measures'),
    }),
    execute: async ({ sql, description }: { sql: string; description: string }) => {
      return executeAndLog(sql, description);
    },
  });

  const describeReportingSchema = tool({
    description: 'Return curated reporting context, trusted data sources, and business rules for this report type. Use this before guessing about schema details.',
    inputSchema: z.object({
      topic: z.string().optional().describe('Optional topic or question to focus the schema guidance'),
    }),
    execute: async ({ topic }: { topic?: string }) => {
      const payload = getReportingContextPayload(reportType);
      return {
        ...payload,
        topic: topic ?? null,
      };
    },
  });

  const runSgmAnalysisSection = tool({
    description: 'Run a verified SGM analysis query for core report sections. Use identify-role first, then reuse the exact matched warehouse name for downstream sections.',
    inputSchema: z.object({
      section: z.enum([
        'identify-role',
        'sgm-qualification-discipline',
        'sgm-routing-breakdown',
        'sgm-pipeline',
        'sgm-quarterly-trend',
        'sgm-source-performance',
      ]),
      name: z.string().describe('Person name. For downstream section queries, pass the exact matched warehouse name from identify-role.'),
    }),
    execute: async ({ section, name }: { section: string; name: string }) => {
      const { sql, description, params } = buildSgmSectionQuery(section, name);
      return executeAndLog(sql, description, params);
    },
  });

  const runCompetitiveIntelSection = tool({
    description: 'Run a verified competitive intelligence query using canonical competitor grouping and distinct opportunity-level counts.',
    inputSchema: z.object({
      section: z.enum([
        'competitor-leaderboard',
        'deal-economics',
        'loss-reasons',
        'time-trend',
      ]),
    }),
    execute: async ({ section }: { section: string }) => {
      const { sql, description } = buildCompetitiveIntelSectionQuery(section);
      return executeAndLog(sql, description);
    },
  });

  const runAnalyzeWinsSection = tool({
    description: 'Run a verified won-intelligence query using the deployed funnel, SMS timing, and lost-to-competition schemas.',
    inputSchema: z.object({
      section: z.enum([
        'joined-kpis',
        'source-channel-performance',
        'sga-leaderboard',
        'sms-behavior',
        'quarterly-velocity',
        'aum-distribution',
        'won-vs-lost-contrast',
      ]),
    }),
    execute: async ({ section }: { section: string }) => {
      const { sql, description } = buildAnalyzeWinsSectionQuery(section);
      return executeAndLog(sql, description);
    },
  });

  const runSgaPerformanceSection = tool({
    description: 'Run a verified SGA performance query using the SGA Hub leaderboard ownership and exclusion logic.',
    inputSchema: z.object({
      section: z.enum([
        'conversion-leaderboard',
        'period-comparison',
        'source-adjusted-performance',
        'bottleneck-analysis',
        'activity-profile',
        'sms-discipline',
      ]),
    }),
    execute: async ({ section }: { section: string }) => {
      const { sql, description, params } = buildSgaPerformanceSectionQuery(section);
      return executeAndLog(sql, description, params);
    },
  });

  return {
    runBigQuery,
    describeReportingSchema,
    runSgmAnalysisSection,
    runCompetitiveIntelSection,
    runAnalyzeWinsSection,
    runSgaPerformanceSection,
    getQueryLog: () => queryLog,
  };
}

// Web search tool - available only to competitive-intel agent
export const webSearch = tool({
  description: `Search the web for RIA industry news and competitor intelligence.
Use this for: M&A activity, aggregator strategy, platform announcements, regulatory news.
Do NOT use for: individual advisor movements (already tracked via FinTrx in vw_lost_to_competition).`,
  inputSchema: z.object({
    query: z.string().describe('Search query about RIA industry news or competitor firm activity'),
  }),
  execute: async ({ query }: { query: string }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY not configured');
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: 'advanced',
        include_domains: [
          'riabiz.com', 'wealthmanagement.com', 'investmentnews.com',
          'advisorhub.com', 'financial-planning.com', 'citywire.com',
          'barrons.com', 'thinkadvisor.com', 'sec.gov',
        ],
      }),
    });
    const data = await response.json();
    return data.results.map((r: Record<string, unknown>) => ({
      title: r.title,
      snippet: typeof r.content === 'string' ? r.content.slice(0, 300) : '',
      url: r.url,
      publishedDate: r.published_date,
    }));
  },
});
