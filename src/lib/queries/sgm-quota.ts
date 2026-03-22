import { runQuery } from '@/lib/bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toNumber, toString } from '@/types/bigquery-raw';
import { prisma } from '@/lib/prisma';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import {
  SGMQuotaProgress,
  SGMOpenOpp,
  SGMHistoricalQuarter,
  SGMAdminBreakdown,
  SGMTeamProgress,
  SGMQuotaFilters,
} from '@/types/sgm-hub';
import { calculateSGMQuarterPacing, getDaysAgingStatus, formatArrCompact } from '@/lib/utils/sgm-hub-helpers';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

/**
 * Map quarter string to its 3 month strings (YYYY-MM format)
 */
function getQuarterMonths(quarter: string): string[] {
  const [yearStr, qStr] = quarter.split('-Q');
  const year = parseInt(yearStr, 10);
  const q = parseInt(qStr, 10);
  const startMonth = (q - 1) * 3; // 0-indexed
  return [0, 1, 2].map(offset => {
    const m = startMonth + offset + 1; // 1-indexed
    return `${year}-${String(m).padStart(2, '0')}`;
  });
}

/**
 * Look up SGM userEmail from their display name
 */
async function getSGMEmail(sgmName: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { name: sgmName, role: 'sgm' },
    select: { email: true },
  });
  return user?.email ?? null;
}

// ============================================
// 5.1 getSGMQuotaProgress
// ============================================

const _getSGMQuotaProgress = async (
  sgmName: string,
  quarter: string
): Promise<SGMQuotaProgress> => {
  const quarterMonths = getQuarterMonths(quarter);
  const info = getQuarterInfo(quarter);

  // BigQuery: per-record ARR with COALESCE
  const query = `
    SELECT
      v.Full_prospect_id__c,
      v.Actual_ARR__c,
      v.Account_Total_ARR__c,
      COALESCE(v.Actual_ARR__c, v.Account_Total_ARR__c) AS effective_arr,
      CASE WHEN v.Actual_ARR__c IS NOT NULL THEN FALSE ELSE TRUE END AS is_estimate
    FROM \`${FULL_TABLE}\` v
    WHERE v.is_joined_unique = 1
      AND v.SGM_Owner_Name__c = @sgmName
      AND v.joined_cohort_month IN UNNEST(@quarterMonths)
      AND v.recordtypeid = @recruitingRecordType
  `;

  const rows = await runQuery(query, {
    sgmName,
    quarterMonths,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  });

  const totalArr = rows.reduce((sum: number, r: any) => sum + (toNumber(r.effective_arr) || 0), 0);
  const hasAnyEstimate = rows.some((r: any) => r.is_estimate === true);
  const joinedCount = rows.length;

  // Prisma: look up quota
  const userEmail = await getSGMEmail(sgmName);
  let quotaArr = 0;
  if (userEmail) {
    const quota = await prisma.sGMQuarterlyGoal.findUnique({
      where: { userEmail_quarter: { userEmail, quarter } },
    });
    quotaArr = quota?.arrGoal ?? 0;
  }

  const pacing = calculateSGMQuarterPacing(quarter, quotaArr > 0 ? quotaArr : null, totalArr);

  return {
    sgmName,
    quarter,
    quarterLabel: info.label,
    actualArr: Math.round(totalArr),
    isEstimate: hasAnyEstimate,
    quotaArr,
    hasQuota: quotaArr > 0,
    joinedCount,
    ...pacing,
  };
};

export const getSGMQuotaProgress = cachedQuery(
  _getSGMQuotaProgress,
  'getSGMQuotaProgress',
  CACHE_TAGS.SGM_HUB
);

// ============================================
// 5.2 getSGMOpenOpportunities
// ============================================

const _getSGMOpenOpportunities = async (
  sgmName: string
): Promise<SGMOpenOpp[]> => {
  const query = `
    SELECT
      v.primary_key AS primaryKey,
      v.Full_Opportunity_ID__c AS opportunityId,
      v.advisor_name AS advisorName,
      v.StageName AS currentStage,
      DATE_DIFF(CURRENT_DATE(), DATE(v.converted_date_raw), DAY) AS daysOpen,
      v.Opportunity_AUM AS aum,
      v.SGM_Estimated_ARR__c AS estimatedArr,
      v.salesforce_url AS salesforceUrl,
      CASE v.StageName
        WHEN 'Qualifying' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.mql_stage_entered_ts), DAY)
        WHEN 'Discovery' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Discovery__c), DAY)
        WHEN 'Sales Process' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Sales_Process__c), DAY)
        WHEN 'Negotiating' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Negotiating__c), DAY)
        WHEN 'Signed' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Signed__c), DAY)
        WHEN 'On Hold' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_On_Hold__c), DAY)
        ELSE NULL
      END AS daysInStage
    FROM \`${FULL_TABLE}\` v
    WHERE v.is_sqo_unique = 1
      AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'On Hold', 'Signed')
      AND v.SGM_Owner_Name__c = @sgmName
      AND v.recordtypeid = @recruitingRecordType
    ORDER BY daysOpen DESC
  `;

  const rows = await runQuery(query, {
    sgmName,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  });

  return rows.map((r: any) => {
    const daysOpen = toNumber(r.daysOpen) || 0;
    const daysInStage = r.daysInStage != null ? toNumber(r.daysInStage) : null;
    const aum = toNumber(r.aum) || 0;
    const estimatedArr = r.estimatedArr != null ? toNumber(r.estimatedArr) : null;

    return {
      primaryKey: toString(r.primaryKey) || toString(r.opportunityId) || '',
      opportunityId: toString(r.opportunityId) || '',
      advisorName: toString(r.advisorName) || '',
      daysOpen,
      daysOpenStatus: getDaysAgingStatus(daysOpen) || 'green',
      currentStage: toString(r.currentStage) || '',
      daysInStage,
      daysInStageStatus: getDaysAgingStatus(daysInStage),
      aum,
      aumFormatted: formatArrCompact(aum),
      estimatedArr,
      estimatedArrFormatted: estimatedArr != null ? formatArrCompact(estimatedArr) : '—',
      salesforceUrl: toString(r.salesforceUrl) || '',
    };
  });
};

export const getSGMOpenOpportunities = cachedQuery(
  _getSGMOpenOpportunities,
  'getSGMOpenOpportunities',
  CACHE_TAGS.SGM_HUB
);

// ============================================
// 5.3 getSGMHistoricalQuarters
// ============================================

const _getSGMHistoricalQuarters = async (
  sgmName: string,
  numQuarters: number = 8
): Promise<SGMHistoricalQuarter[]> => {
  // Calculate start date: first day of (currentQuarter - numQuarters + 1)
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3) + 1;
  const currentYear = now.getFullYear();

  // Go back numQuarters-1 quarters from current
  let startYear = currentYear;
  let startQ = currentQ - (numQuarters - 1);
  while (startQ <= 0) {
    startQ += 4;
    startYear--;
  }
  const startDate = `${startYear}-${String((startQ - 1) * 3 + 1).padStart(2, '0')}-01`;

  // Build list of quarter strings for Prisma lookup
  const quartersList: string[] = [];
  let y = startYear;
  let q = startQ;
  for (let i = 0; i < numQuarters; i++) {
    quartersList.push(`${y}-Q${q}`);
    q++;
    if (q > 4) { q = 1; y++; }
  }

  const query = `
    SELECT
      CONCAT(CAST(EXTRACT(YEAR FROM DATE(v.advisor_join_date__c)) AS STRING), '-Q',
        CAST(EXTRACT(QUARTER FROM DATE(v.advisor_join_date__c)) AS STRING)) AS quarter,
      COUNT(DISTINCT v.Full_prospect_id__c) AS joined_count,
      SUM(COALESCE(v.Actual_ARR__c, v.Account_Total_ARR__c, 0)) AS total_arr,
      COUNTIF(v.Actual_ARR__c IS NULL AND v.Account_Total_ARR__c IS NOT NULL) AS estimate_count,
      COUNTIF(v.Actual_ARR__c IS NOT NULL) AS actual_count
    FROM \`${FULL_TABLE}\` v
    WHERE v.is_joined_unique = 1
      AND v.SGM_Owner_Name__c = @sgmName
      AND v.recordtypeid = @recruitingRecordType
      AND v.advisor_join_date__c >= @startDate
    GROUP BY quarter
    ORDER BY quarter ASC
  `;

  const rows = await runQuery(query, {
    sgmName,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    startDate,
  });

  // Prisma: look up quotas for these quarters
  const userEmail = await getSGMEmail(sgmName);
  let quotaMap: Record<string, number> = {};
  if (userEmail) {
    const quotas = await prisma.sGMQuarterlyGoal.findMany({
      where: { userEmail, quarter: { in: quartersList } },
    });
    quotaMap = Object.fromEntries(quotas.map(q => [q.quarter, q.arrGoal]));
  }

  return rows.map((r: any) => {
    const qtr = toString(r.quarter) || '';
    const info = getQuarterInfo(qtr);
    return {
      quarter: qtr,
      quarterLabel: info.label,
      actualArr: Math.round(toNumber(r.total_arr) || 0),
      isEstimate: (toNumber(r.estimate_count) || 0) > 0,
      goalArr: quotaMap[qtr] ?? null,
      joinedCount: toNumber(r.joined_count) || 0,
    };
  });
};

export const getSGMHistoricalQuarters = cachedQuery(
  _getSGMHistoricalQuarters,
  'getSGMHistoricalQuarters',
  CACHE_TAGS.SGM_HUB
);

// ============================================
// 5.4 getSGMAdminBreakdown
// ============================================

const _getSGMAdminBreakdown = async (
  quarter: string,
  filters?: SGMQuotaFilters
): Promise<SGMAdminBreakdown[]> => {
  const quarterMonths = getQuarterMonths(quarter);

  // Build optional SGM name filter
  const sgmFilterClause = filters?.sgmNames && filters.sgmNames.length > 0
    ? `AND u.Name IN UNNEST(@sgmNames)` : '';

  // Build optional channel/source filter clauses for pipeline + joined CTEs
  const extraConditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    quarterMonths,
  };

  if (filters?.sgmNames && filters.sgmNames.length > 0) {
    params.sgmNames = filters.sgmNames;
  }

  if (filters?.channels && filters.channels.length > 0) {
    extraConditions.push(`AND IFNULL(v.Channel_Grouping_Name, 'Other') IN UNNEST(@channels)`);
    params.channels = filters.channels;
  }
  if (filters?.sources && filters.sources.length > 0) {
    extraConditions.push(`AND v.Original_source IN UNNEST(@sources)`);
    params.sources = filters.sources;
  }
  const extraWhere = extraConditions.join('\n    ');

  const query = `
    WITH ActiveSGMs AS (
      SELECT DISTINCT u.Name AS sgm_name, u.Email AS sgm_email
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.Is_SGM__c = TRUE AND u.IsActive = TRUE
      ${sgmFilterClause}
    ),
    OpenPipeline AS (
      SELECT
        v.SGM_Owner_Name__c AS sgm_name,
        COUNT(DISTINCT v.Full_Opportunity_ID__c) AS open_opps,
        COUNTIF(DATE_DIFF(CURRENT_DATE(), DATE(v.converted_date_raw), DAY) >= 90) AS open_opps_90_plus,
        COALESCE(SUM(v.Opportunity_AUM), 0) AS open_aum,
        COALESCE(SUM(v.SGM_Estimated_ARR__c), 0) AS open_arr
      FROM \`${FULL_TABLE}\` v
      WHERE v.is_sqo_unique = 1
        AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'On Hold', 'Signed')
        AND v.recordtypeid = @recruitingRecordType
        ${extraWhere}
      GROUP BY v.SGM_Owner_Name__c
    ),
    JoinedArr AS (
      SELECT
        v.SGM_Owner_Name__c AS sgm_name,
        SUM(COALESCE(v.Actual_ARR__c, v.Account_Total_ARR__c, 0)) AS actual_arr
      FROM \`${FULL_TABLE}\` v
      WHERE v.is_joined_unique = 1
        AND v.joined_cohort_month IN UNNEST(@quarterMonths)
        AND v.recordtypeid = @recruitingRecordType
        ${extraWhere}
      GROUP BY v.SGM_Owner_Name__c
    )
    SELECT
      a.sgm_name,
      a.sgm_email,
      COALESCE(p.open_opps, 0) AS open_opps,
      COALESCE(p.open_opps_90_plus, 0) AS open_opps_90_plus,
      COALESCE(p.open_aum, 0) AS open_aum,
      COALESCE(p.open_arr, 0) AS open_arr,
      COALESCE(j.actual_arr, 0) AS actual_arr
    FROM ActiveSGMs a
    LEFT JOIN OpenPipeline p ON p.sgm_name = a.sgm_name
    LEFT JOIN JoinedArr j ON j.sgm_name = a.sgm_name
    ORDER BY a.sgm_name ASC
  `;

  const rows = await runQuery(query, params);

  // Prisma: look up quotas for all SGMs for this quarter
  const quotas = await prisma.sGMQuarterlyGoal.findMany({
    where: { quarter },
  });
  const quotaMap = Object.fromEntries(
    quotas.map(q => [q.userEmail, q.arrGoal])
  );

  const results: SGMAdminBreakdown[] = rows.map((r: any) => {
    const sgmEmail = toString(r.sgm_email) || '';
    const actualArr = Math.round(toNumber(r.actual_arr) || 0);
    const quotaArr = quotaMap[sgmEmail] ?? 0;
    const openAum = toNumber(r.open_aum) || 0;
    const openArr = toNumber(r.open_arr) || 0;

    const pacing = calculateSGMQuarterPacing(quarter, quotaArr > 0 ? quotaArr : null, actualArr);

    return {
      sgmName: toString(r.sgm_name) || '',
      userEmail: sgmEmail,
      openOpps: toNumber(r.open_opps) || 0,
      openOpps90Plus: toNumber(r.open_opps_90_plus) || 0,
      openAum,
      openAumFormatted: formatArrCompact(openAum),
      openArr,
      openArrFormatted: formatArrCompact(openArr),
      quotaArr,
      actualArr,
      progressPercent: pacing.progressPercent,
      pacingStatus: pacing.pacingStatus,
    };
  });

  // Filter by pacing status in TypeScript (if specified)
  if (filters?.pacingStatuses && filters.pacingStatuses.length > 0) {
    return results.filter(r => filters.pacingStatuses!.includes(r.pacingStatus));
  }

  return results;
};

export const getSGMAdminBreakdown = cachedQuery(
  _getSGMAdminBreakdown,
  'getSGMAdminBreakdown',
  CACHE_TAGS.SGM_HUB
);

// ============================================
// 5.5 getSGMTeamProgress
// ============================================

const _getSGMTeamProgress = async (
  quarter: string
): Promise<SGMTeamProgress> => {
  const quarterMonths = getQuarterMonths(quarter);
  const info = getQuarterInfo(quarter);

  // Sum all quotas for the quarter
  const quotas = await prisma.sGMQuarterlyGoal.findMany({
    where: { quarter },
  });
  const totalQuotaArr = quotas.reduce((sum, q) => sum + q.arrGoal, 0);

  // Get total joined ARR for the quarter (no SGM filter)
  const query = `
    SELECT
      SUM(COALESCE(v.Actual_ARR__c, v.Account_Total_ARR__c, 0)) AS total_arr
    FROM \`${FULL_TABLE}\` v
    WHERE v.is_joined_unique = 1
      AND v.joined_cohort_month IN UNNEST(@quarterMonths)
      AND v.recordtypeid = @recruitingRecordType
  `;

  const rows = await runQuery(query, {
    quarterMonths,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  });

  const totalActualArr = Math.round(toNumber((rows[0] as any)?.total_arr) || 0);
  const pacing = calculateSGMQuarterPacing(quarter, totalQuotaArr > 0 ? totalQuotaArr : null, totalActualArr);

  return {
    quarter,
    quarterLabel: info.label,
    totalActualArr,
    totalQuotaArr,
    progressPercent: pacing.progressPercent,
    expectedArr: pacing.expectedArr,
    pacingDiff: pacing.pacingDiff,
    pacingStatus: pacing.pacingStatus,
    daysElapsed: pacing.daysElapsed,
    daysInQuarter: pacing.daysInQuarter,
  };
};

export const getSGMTeamProgress = cachedQuery(
  _getSGMTeamProgress,
  'getSGMTeamProgress',
  CACHE_TAGS.SGM_HUB
);
