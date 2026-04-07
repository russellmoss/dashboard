import { runQuery } from '@/lib/bigquery';

/**
 * Column contract for the BQ Audit Trail tab.
 * Every column index, header, and formula reference derives from this constant.
 */
export const AUDIT_TRAIL_COLUMNS = [
  { index: 0,  key: 'opp_id',               header: 'Opp ID',                    col: 'A' },
  { index: 1,  key: 'sf_url',               header: 'Salesforce URL',             col: 'B' },
  { index: 2,  key: 'advisor_name',          header: 'Advisor',                    col: 'C' },
  { index: 3,  key: 'sgm_name',             header: 'SGM',                        col: 'D' },
  { index: 4,  key: 'sga_name',             header: 'SGA',                        col: 'E' },
  { index: 5,  key: 'date_became_sqo',       header: 'Date Became SQO',           col: 'F' },
  { index: 6,  key: 'stage_entered_signed',  header: 'Stage Entered Signed',      col: 'G' },
  { index: 7,  key: 'stage_entered_joined',  header: 'Stage Entered Joined',      col: 'H' },
  { index: 8,  key: 'days_to_signed',        header: 'Days to Signed',            col: 'I' },
  { index: 9,  key: 'days_to_joined',        header: 'Days to Joined',            col: 'J' },
  { index: 10, key: 'current_stage',         header: 'Current Stage',             col: 'K' },
  { index: 11, key: 'status',               header: 'Status',                     col: 'L' },
  { index: 12, key: 'signed_lag_bucket',     header: 'Signed Lag Bucket',         col: 'M' },
  { index: 13, key: 'joined_lag_bucket',     header: 'Joined Lag Bucket',         col: 'N' },
  { index: 14, key: 'in_2yr_cohort',         header: 'In 2yr Cohort',            col: 'O' },
  { index: 15, key: 'in_1yr_cohort',         header: 'In 1yr Cohort',            col: 'P' },
  { index: 16, key: 'in_recent_mature',      header: 'In Recent Mature Cohort',  col: 'Q' },
  { index: 17, key: 'in_signed_denom_30d',   header: 'In Signed Denom 30d',      col: 'R' },
  { index: 18, key: 'in_signed_denom_60d',   header: 'In Signed Denom 60d',      col: 'S' },
  { index: 19, key: 'in_signed_denom_90d',   header: 'In Signed Denom 90d',      col: 'T' },
  { index: 20, key: 'in_signed_denom_120d',  header: 'In Signed Denom 120d',     col: 'U' },
  { index: 21, key: 'in_signed_denom_150d',  header: 'In Signed Denom 150d',     col: 'V' },
  { index: 22, key: 'in_signed_denom_180d',  header: 'In Signed Denom 180d',     col: 'W' },
  { index: 23, key: 'converted_to_signed',   header: 'Converted to Signed',      col: 'X' },
  { index: 24, key: 'converted_to_joined',   header: 'Converted to Joined',      col: 'Y' },
  { index: 25, key: 'in_trailing_180d',      header: 'In Trailing 180d Cohort',  col: 'Z' },
  { index: 26, key: 'stage_entered_closed',  header: 'Stage Entered Closed',     col: 'AA' },
  { index: 27, key: 'days_to_closed_lost',   header: 'Days to Closed Lost',      col: 'AB' },
  { index: 28, key: 'closed_lost_lag_bucket', header: 'Closed Lost Lag Bucket',  col: 'AC' },
  { index: 29, key: 'converted_to_closed_lost', header: 'Converted to Closed Lost', col: 'AD' },
] as const;

/**
 * Fetches all SQO audit trail records for the lag distribution export.
 * Returns one row per unique SQO with all 30 columns in AUDIT_TRAIL_COLUMNS order.
 * All flag columns are INT64 (1/0). Days columns use empty string for non-converted.
 */
export async function getSqoLagAuditTrail(): Promise<Record<string, any>[]> {
  const sql = `
    SELECT
      Full_Opportunity_ID__c AS opp_id,
      CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', Full_Opportunity_ID__c, '/view') AS sf_url,
      COALESCE(advisor_name, 'Unknown') AS advisor_name,
      COALESCE(SGM_Owner_Name__c, 'Unknown') AS sgm_name,
      COALESCE(SGA_Owner_Name__c, 'Unknown') AS sga_name,
      FORMAT_DATE('%F', DATE(Date_Became_SQO__c)) AS date_became_sqo,
      COALESCE(FORMAT_TIMESTAMP('%F %T', Stage_Entered_Signed__c), '') AS stage_entered_signed,
      COALESCE(FORMAT_TIMESTAMP('%F %T', Stage_Entered_Joined__c), '') AS stage_entered_joined,
      IF(Stage_Entered_Signed__c IS NOT NULL,
        CAST(DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY) AS STRING),
        '') AS days_to_signed,
      IF(Stage_Entered_Joined__c IS NOT NULL,
        CAST(DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) AS STRING),
        '') AS days_to_joined,
      StageName AS current_stage,
      CASE
        WHEN Stage_Entered_Joined__c IS NOT NULL THEN 'Joined'
        WHEN Stage_Entered_Signed__c IS NOT NULL AND StageName = 'Closed Lost' THEN 'Closed Lost'
        WHEN Stage_Entered_Signed__c IS NOT NULL THEN 'Signed'
        WHEN StageName = 'Closed Lost' THEN 'Closed Lost'
        ELSE 'Open'
      END AS status,
      CASE
        WHEN Stage_Entered_Signed__c IS NULL THEN 'Did Not Convert'
        WHEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY) <= 30 THEN '0-30 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY) <= 60 THEN '31-60 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY) <= 90 THEN '61-90 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY) <= 120 THEN '91-120 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY) <= 150 THEN '121-150 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY) <= 180 THEN '151-180 days'
        ELSE '180+ days'
      END AS signed_lag_bucket,
      CASE
        WHEN Stage_Entered_Joined__c IS NULL THEN 'Did Not Convert'
        WHEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) <= 30 THEN '0-30 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) <= 60 THEN '31-60 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) <= 90 THEN '61-90 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) <= 120 THEN '91-120 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) <= 150 THEN '121-150 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) <= 180 THEN '151-180 days'
        ELSE '180+ days'
      END AS joined_lag_bucket,
      IF(DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR), 1, 0) AS in_2yr_cohort,
      IF(DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR), 1, 0) AS in_1yr_cohort,
      IF(DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
        AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180, 1, 0) AS in_recent_mature,
      IF(DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 30, 1, 0) AS in_signed_denom_30d,
      IF(DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 60, 1, 0) AS in_signed_denom_60d,
      IF(DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 90, 1, 0) AS in_signed_denom_90d,
      IF(DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 120, 1, 0) AS in_signed_denom_120d,
      IF(DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 150, 1, 0) AS in_signed_denom_150d,
      IF(DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180, 1, 0) AS in_signed_denom_180d,
      IF(Stage_Entered_Signed__c IS NOT NULL, 1, 0) AS converted_to_signed,
      IF(Stage_Entered_Joined__c IS NOT NULL, 1, 0) AS converted_to_joined,
      IF(DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) <= 180, 1, 0) AS in_trailing_180d,
      COALESCE(FORMAT_TIMESTAMP('%F %T', Stage_Entered_Closed__c), '') AS stage_entered_closed,
      IF(StageName = 'Closed Lost' AND Stage_Entered_Closed__c IS NOT NULL,
        CAST(DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(Date_Became_SQO__c), DAY) AS STRING),
        '') AS days_to_closed_lost,
      CASE
        WHEN StageName != 'Closed Lost' OR Stage_Entered_Closed__c IS NULL THEN 'Did Not Close Lost'
        WHEN DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(Date_Became_SQO__c), DAY) <= 30 THEN '0-30 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(Date_Became_SQO__c), DAY) <= 60 THEN '31-60 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(Date_Became_SQO__c), DAY) <= 90 THEN '61-90 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(Date_Became_SQO__c), DAY) <= 120 THEN '91-120 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(Date_Became_SQO__c), DAY) <= 150 THEN '121-150 days'
        WHEN DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(Date_Became_SQO__c), DAY) <= 180 THEN '151-180 days'
        ELSE '180+ days'
      END AS closed_lost_lag_bucket,
      IF(StageName = 'Closed Lost', 1, 0) AS converted_to_closed_lost
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_sqo_unique = 1
      AND recordtypeid = '012Dn000000mrO3IAI'
      AND Date_Became_SQO__c IS NOT NULL
      AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
    ORDER BY DATE(Date_Became_SQO__c) DESC
  `;

  return runQuery<Record<string, any>>(sql);
}
