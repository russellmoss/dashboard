import { runQuery } from '../bigquery';
import { DetailRecord } from '@/types/dashboard';
import { DashboardFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
import { buildAdvancedFilterClauses, buildSgaFilterClause } from '../utils/filter-helpers';
import { buildDateRangeFromFilters, formatCurrency, calculateDaysInStage } from '../utils/date-helpers';
import { RawDetailRecordResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE } from '@/config/constants';

const _getDetailRecords = async (
  filters: DashboardFilters,
  limit: number = 10000  // Reduced to prevent Next.js cache errors (2MB limit)
): Promise<DetailRecord[]> => {
  // Joined / Signed scorecards count individual advisors (Contacts), not opps.
  // Their drill-downs need advisor-grain rows so the row count matches the scorecard
  // and team Accounts (e.g. "Marcado", "Colorado Wealth Group") expand into one row
  // per advisor instead of one row per Opportunity.
  if (filters.metricFilter === 'joined') {
    return getJoinedAdvisorRecords(filters, limit);
  }
  if (filters.metricFilter === 'signed') {
    return getSignedAdvisorRecords(filters, limit);
  }

  const { startDate, endDate } = buildDateRangeFromFilters(filters);

  // Extract advancedFilters from filters object
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;
  
  // Build advanced filter clauses
  const { whereClauses: advFilterClauses, params: advFilterParams } =
    buildAdvancedFilterClauses(advancedFilters, 'adv');

  // SGA clause — honors ATTRIBUTION_MODEL. Prefer multi-select; fall back to legacy single-SGA.
  const sgasFilter =
    advancedFilters.sgas && !advancedFilters.sgas.selectAll && advancedFilters.sgas.selected.length > 0
      ? advancedFilters.sgas
      : filters.sga
        ? { selectAll: false, selected: [filters.sga] }
        : undefined;
  const sgaClause = buildSgaFilterClause(sgasFilter, 'adv');

  // Build parameterized query conditions
  const conditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
    limit,
  };

  // Determine if this is an opportunity-level metric (retained for legacy User join — see below)
  const isOpportunityLevelMetric = ['sqo', 'signed', 'joined', 'openPipeline'].includes(filters.metricFilter || '');

  // Add channel/source/sgm filters (no date filter here - we'll add date filter based on metric)
  if (filters.channel) {
    // Channel_Grouping_Name now comes directly from Finance_View__c in the view
    conditions.push('v.Channel_Grouping_Name = @channel');
    params.channel = filters.channel;
  }
  if (filters.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  if (filters.experimentationTag) {
    conditions.push(`EXISTS (
      SELECT 1 
      FROM UNNEST(v.Experimentation_Tag_List) as tag
      WHERE tag = @experimentationTag
    )`);
    params.experimentationTag = filters.experimentationTag;
  }
  if (filters.campaignId) {
    conditions.push('(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)');
    params.campaignId = filters.campaignId;
  }
  
  // Add advanced filter clauses to existing conditions
  conditions.push(...advFilterClauses);
  Object.assign(params, advFilterParams);

  // Attribution-aware SGA clause.
  if (sgaClause.whereClause) {
    conditions.push(sgaClause.whereClause);
  }
  Object.assign(params, sgaClause.params);

  // Determine date field and metric filter based on metricFilter
  let dateField = '';
  let dateFieldAlias = '';
  let metricCondition = '';
  
  switch (filters.metricFilter) {
    case 'prospect':
      // Prospects: Include ALL records where ANY stage date is within the date range
      // This allows client-side filtering to show all SQOs/SQLs/MQLs/Signed/etc that entered those stages in the period,
      // not just records that became prospects in the period
      // NOTE: Do NOT filter by recordtypeid here - match scorecard behavior (MQLs/SQLs/Contacted count all record types)
      // SQOs will be filtered by recordtypeid in the client-side filter to match scorecard behavior
      dateField = 'FilterDate';
      dateFieldAlias = 'relevant_date';
      // Include records where any stage date is in range (including all opportunity stage_entered dates)
      conditions.push(`(
        (FilterDate IS NOT NULL AND TIMESTAMP(FilterDate) >= TIMESTAMP(@startDate) AND TIMESTAMP(FilterDate) <= TIMESTAMP(@endDate))
        OR (Date_Became_SQO__c IS NOT NULL AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate))
        OR (converted_date_raw IS NOT NULL AND DATE(converted_date_raw) >= DATE(@startDate) AND DATE(converted_date_raw) <= DATE(@endDate))
        OR (mql_stage_entered_ts IS NOT NULL AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate) AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate))
        OR (stage_entered_contacting__c IS NOT NULL AND TIMESTAMP(stage_entered_contacting__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(stage_entered_contacting__c) <= TIMESTAMP(@endDate))
        OR (advisor_join_date__c IS NOT NULL AND DATE(advisor_join_date__c) >= DATE(@startDate) AND DATE(advisor_join_date__c) <= DATE(@endDate))
        OR (Stage_Entered_Signed__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Signed__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Signed__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_Discovery__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Discovery__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Discovery__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_Sales_Process__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Sales_Process__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Sales_Process__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_Negotiating__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Negotiating__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Negotiating__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_On_Hold__c IS NOT NULL AND TIMESTAMP(Stage_Entered_On_Hold__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_On_Hold__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_Closed__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Closed__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Closed__c) <= TIMESTAMP(@endDate))
      )`);
      break;
    case 'contacted':
      // Contacted: Filter by stage_entered_contacting__c within date range AND is_contacted = 1
      dateField = 'stage_entered_contacting__c';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_contacted = 1');
      conditions.push('stage_entered_contacting__c IS NOT NULL');
      conditions.push('TIMESTAMP(stage_entered_contacting__c) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(stage_entered_contacting__c) <= TIMESTAMP(@endDate)');
      break;
    case 'mql':
      // MQLs: Filter by mql_stage_entered_ts within date range AND is_mql = 1
      dateField = 'mql_stage_entered_ts';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_mql = 1');
      conditions.push('mql_stage_entered_ts IS NOT NULL');
      conditions.push('TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)');
      break;
    case 'sql':
      // SQLs: Filter by converted_date_raw within date range
      dateField = 'converted_date_raw';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_sql = 1');
      conditions.push('converted_date_raw IS NOT NULL');
      conditions.push('DATE(converted_date_raw) >= DATE(@startDate)');
      conditions.push('DATE(converted_date_raw) <= DATE(@endDate)');
      break;
    case 'sqo':
      // SQOs: Filter by Date_Became_SQO__c within date range AND recruiting record type
      dateField = 'Date_Became_SQO__c';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_sqo_unique = 1');
      conditions.push('recordtypeid = @recruitingRecordType');
      conditions.push('Date_Became_SQO__c IS NOT NULL');
      conditions.push('TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)');
      params.recruitingRecordType = RECRUITING_RECORD_TYPE;
      break;
    // 'joined' and 'signed' are handled by getJoinedAdvisorRecords / getSignedAdvisorRecords
    // at the top of _getDetailRecords — they don't reach this switch.
    case 'openPipeline':
      // Open Pipeline: No date filter (current state), but filter by stages
      dateField = 'FilterDate'; // Fallback for display
      dateFieldAlias = 'relevant_date';
      const stageParams = OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`);
      conditions.push(`StageName IN (${stageParams.join(', ')})`);
      OPEN_PIPELINE_STAGES.forEach((stage, i) => {
        params[`stage${i}`] = stage;
      });
      conditions.push('is_sqo_unique = 1');
      conditions.push('recordtypeid = @recruitingRecordType');
      params.recruitingRecordType = RECRUITING_RECORD_TYPE;
      // No date filter for open pipeline - it's current state
      break;
    default:
      // 'all' - Default behavior depends on active advanced filters
      // If Initial Call Scheduled filter is active, show all records with Initial_Call_Scheduled_Date__c in range
      // If Qualification Call filter is active, show all opportunities with Qualification_Call_Date__c in range
      // Otherwise, default to SQLs filtered by converted_date_raw
      if (advancedFilters.initialCallScheduled.enabled) {
        // Show all records with Initial_Call_Scheduled_Date__c in the date range
        // The advanced filter already filters by Initial_Call_Scheduled_Date__c, so we just need to set the display date
        // Use Initial_Call_Scheduled_Date__c as the display date (the actual date we're filtering by)
        dateField = 'Initial_Call_Scheduled_Date__c';
        dateFieldAlias = 'relevant_date';
        // No additional date filters needed - the advanced filter handles Initial_Call_Scheduled_Date__c filtering
        // We want to show ALL records with initial calls in the period, regardless of when they entered contacting
        // This includes records that were MQL'd in previous quarters but had initial calls scheduled in this period
      } else if (advancedFilters.qualificationCallDate.enabled) {
        // Show all opportunities with Qualification_Call_Date__c in the date range
        // The advanced filter already filters by Qualification_Call_Date__c, so we just need to set the display date
        // Use Opp_CreatedDate as the display date
        dateField = 'Opp_CreatedDate';
        dateFieldAlias = 'relevant_date';
        conditions.push('Full_Opportunity_ID__c IS NOT NULL'); // Only opportunities
        // No additional date filters needed - the advanced filter handles Qualification_Call_Date__c filtering
      } else {
        // Default: Show SQLs filtered by converted_date_raw
        dateField = 'converted_date_raw';
        dateFieldAlias = 'relevant_date';
        conditions.push('is_sql = 1');
        conditions.push('converted_date_raw IS NOT NULL');
        conditions.push('DATE(converted_date_raw) >= DATE(@startDate)');
        conditions.push('DATE(converted_date_raw) <= DATE(@endDate)');
      }
  }

  // Disposition filtering (Open/Lost/Converted sub-filter for Contacted/MQL/SQL/SQO)
  if (filters.metricDisposition && filters.metricDisposition !== 'all') {
    switch (filters.metricFilter) {
      case 'contacted':
        switch (filters.metricDisposition) {
          case 'open':
            conditions.push('is_mql = 0');
            conditions.push('lead_closed_date IS NULL');
            break;
          case 'lost':
            conditions.push('is_mql = 0');
            conditions.push('lead_closed_date IS NOT NULL');
            break;
          case 'converted':
            conditions.push('is_mql = 1');
            break;
        }
        break;
      case 'mql':
        switch (filters.metricDisposition) {
          case 'open':
            conditions.push('is_sql = 0');
            conditions.push('lead_closed_date IS NULL');
            break;
          case 'lost':
            conditions.push('is_sql = 0');
            conditions.push('lead_closed_date IS NOT NULL');
            break;
          case 'converted':
            conditions.push('is_sql = 1');
            break;
        }
        break;
      case 'sql':
        switch (filters.metricDisposition) {
          case 'open':
            conditions.push("(LOWER(COALESCE(SQO_raw, '')) != 'yes')");
            conditions.push("(StageName IS NULL OR StageName != 'Closed Lost')");
            break;
          case 'lost':
            conditions.push("(LOWER(COALESCE(SQO_raw, '')) != 'yes')");
            conditions.push("StageName = 'Closed Lost'");
            break;
          case 'converted':
            conditions.push("LOWER(SQO_raw) = 'yes'");
            break;
        }
        break;
      case 'sqo':
        switch (filters.metricDisposition) {
          case 'open':
            conditions.push("StageName NOT IN ('Closed Lost', 'Joined', 'Signed')");
            conditions.push('advisor_join_date__c IS NULL');
            break;
          case 'lost':
            conditions.push("StageName = 'Closed Lost'");
            conditions.push('advisor_join_date__c IS NULL');
            break;
          case 'converted':
            conditions.push("(advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed'))");
            break;
        }
        break;
      // No disposition filtering for other metrics (prospect, joined, etc.)
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Add User table join for opportunity-level metrics when legacy SGA filter is present
  // This allows us to resolve Opp_SGA_Name__c User IDs to names
  const userJoin = (isOpportunityLevelMetric && filters.sga)
    ? `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user ON v.Opp_SGA_Name__c = sga_user.Id`
    : '';

  // Per Q1 (b): under v2 with SGA filter active, display the lead-era primary SGA so
  // the table row matches the filter math. Without the JOIN (v1 or unfiltered v2), the
  // legacy display column is preserved.
  const sgaDisplayCol = sgaClause.joinClause
    ? 'COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c)'
    : 'v.SGA_Owner_Name__c';

  const query = `
    SELECT
      v.primary_key as id,
      v.advisor_name,
      v.Original_source as source,
      v.Channel_Grouping_Name as channel,
      v.StageName as stage,
      ${sgaDisplayCol} as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Campaign_Id__c as campaign_id,
      v.Campaign_Name__c as campaign_name,
      v.Lead_Score_Tier__c as lead_score_tier,
      v.Opportunity_AUM as aum,
      v.salesforce_url,
      v.FilterDate as filter_date,
      v.stage_entered_contacting__c as contacted_date,
      v.mql_stage_entered_ts as mql_date,
      v.converted_date_raw as sql_date,
      v.Date_Became_SQO__c as sqo_date,
      v.advisor_join_date__c as joined_date,
      v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
      v.Qualification_Call_Date__c as qualification_call_date,
      v.Stage_Entered_Signed__c as signed_date,
      v.Stage_Entered_Discovery__c as discovery_date,
      v.Stage_Entered_Sales_Process__c as sales_process_date,
      v.Stage_Entered_Negotiating__c as negotiating_date,
      v.Stage_Entered_On_Hold__c as on_hold_date,
      v.Stage_Entered_Closed__c as closed_date,
      v.is_contacted,
      v.is_mql,
      v.is_sql,
      v.is_sqo_unique as is_sqo,
      v.is_joined_unique as is_joined,
      v.recordtypeid,
      v.is_primary_opp_record,
      v.Full_Opportunity_ID__c as opportunity_id,
      v.lead_record_source AS prospect_source_type,
      v.Previous_Recruiting_Opportunity_ID__c AS origin_recruiting_opp_id,
      v.origin_opportunity_url,
      v.Next_Steps__c as next_steps,
      v.NextStep as opportunity_next_step,
      v.TOF_Stage as tof_stage,
      v.Opp_CreatedDate as opp_created_date
    FROM \`${FULL_TABLE}\` v
    ${userJoin}
    ${sgaClause.joinClause}
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT @limit
  `;
  
  const results = await runQuery<RawDetailRecordResult>(query, params);
  
  return results.map(r => {
    // Helper function to extract date values (handles both DATE and TIMESTAMP types)
    // BigQuery returns DATE fields as strings, TIMESTAMP fields as objects with .value
    const extractDate = (field: any): string | null => {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (typeof field === 'object' && field.value) return field.value;
      return null;
    };
    
    // Extract all date fields
    // Note: FilterDate, stage_entered_contacting__c, mql_stage_entered_ts, Date_Became_SQO__c are TIMESTAMP
    // converted_date_raw and advisor_join_date__c are DATE
    // Stage_Entered_* fields are TIMESTAMP
    const filterDate = extractDate(r.filter_date) || '';
    const contactedDate = extractDate(r.contacted_date);
    const mqlDate = extractDate(r.mql_date);
    const sqlDate = extractDate(r.sql_date); // DATE field
    const sqoDate = extractDate(r.sqo_date);
    const joinedDate = extractDate(r.joined_date); // DATE field
    const signedDate = extractDate(r.signed_date);
    const discoveryDate = extractDate(r.discovery_date);
    const salesProcessDate = extractDate(r.sales_process_date);
    const negotiatingDate = extractDate(r.negotiating_date);
    const onHoldDate = extractDate(r.on_hold_date);
    const closedDate = extractDate(r.closed_date);
    const oppCreatedDate = extractDate(r.opp_created_date);

    // Extract Initial Call Scheduled Date (DATE field - direct string)
    let initialCallDate: string | null = null;
    if (r.initial_call_scheduled_date) {
      if (typeof r.initial_call_scheduled_date === 'string') {
        initialCallDate = r.initial_call_scheduled_date;
      } else if (typeof r.initial_call_scheduled_date === 'object' && r.initial_call_scheduled_date.value) {
        initialCallDate = r.initial_call_scheduled_date.value;
      }
    }
    
    // Extract Qualification Call Date (DATE field - direct string)
    let qualCallDate: string | null = null;
    if (r.qualification_call_date) {
      if (typeof r.qualification_call_date === 'string') {
        qualCallDate = r.qualification_call_date;
      } else if (typeof r.qualification_call_date === 'object' && r.qualification_call_date.value) {
        qualCallDate = r.qualification_call_date.value;
      }
    }
    
    const stageForCalc = toString(r.stage) || 'Unknown';
    const tofStageForCalc = toString(r.tof_stage) || 'Prospect';
    const daysInCurrentStage = calculateDaysInStage({
      stage: stageForCalc,
      tofStage: tofStageForCalc,
      oppCreatedDate,
      discoveryDate,
      salesProcessDate,
      negotiatingDate,
      signedDate,
      onHoldDate,
      closedDate,
      joinedDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
    });

    return {
      id: toString(r.id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.source) || 'Unknown',
      channel: toString(r.channel) || 'Unknown',
      stage: stageForCalc,
      tofStage: tofStageForCalc,
      sga: r.sga ? toString(r.sga) : null,
      sgm: r.sgm ? toString(r.sgm) : null,
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
      aum: toNumber(r.aum),
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: filterDate, // FilterDate as fallback
      contactedDate: contactedDate,
      mqlDate: mqlDate,
      sqlDate: sqlDate,
      sqoDate: sqoDate,
      joinedDate: joinedDate,
      signedDate: signedDate,
      discoveryDate: discoveryDate,
      salesProcessDate: salesProcessDate,
      negotiatingDate: negotiatingDate,
      onHoldDate: onHoldDate,
      closedDate: closedDate,
      oppCreatedDate,
      daysInCurrentStage,
      initialCallScheduledDate: initialCallDate,
      qualificationCallDate: qualCallDate,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: r.is_sql === 1,
      isSqo: r.is_sqo === 1,
      isJoined: r.is_joined === 1,
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
      recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
      isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
      prospectSourceType: r.prospect_source_type ? toString(r.prospect_source_type) : null,
      originRecruitingOppId: r.origin_recruiting_opp_id ? toString(r.origin_recruiting_opp_id) : null,
      originOpportunityUrl: r.origin_opportunity_url ? toString(r.origin_opportunity_url) : null,
      nextSteps: r.next_steps ? toString(r.next_steps) : null,
      opportunityNextStep: r.opportunity_next_step ? toString(r.opportunity_next_step) : null,
    };
  });
};

// Note: Not cached because result sets typically exceed Next.js 2MB cache limit
// The query returns 50,000+ rows (~10MB), which cannot be cached
export const getDetailRecords = _getDetailRecords;

// Advisor-level drill-down for the Joined scorecard. One row per individual advisor
// (Contact) on a Joined or Churned Account, filtered by joined_date in range.
// Honors filters.joinedDisposition (all/current/churned). Many DetailRecord fields
// are null because Contact-level rows don't have lead-attribution data — the table
// renderer should tolerate nulls.
const getJoinedAdvisorRecords = async (
  filters: DashboardFilters,
  limit: number
): Promise<DetailRecord[]> => {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
    limit,
  };
  // Alltime preset: include advisors with NULL joined_date (Joined-status advisors
  // with no joining Opportunity in SFDC — e.g., Michael McCarthy). Specific periods
  // still require a known date so a NULL-date advisor doesn't appear in every period.
  const isAlltime = filters.datePreset === 'alltime';
  const conditions: string[] = isAlltime
    ? ['(joined_date IS NULL OR (joined_date >= DATE(@startDate) AND joined_date <= DATE(@endDate)))']
    : ['joined_date IS NOT NULL', 'joined_date >= DATE(@startDate)', 'joined_date <= DATE(@endDate)'];
  if (filters.joinedDisposition === 'current') conditions.push("account_status = 'Joined'");
  else if (filters.joinedDisposition === 'churned') conditions.push("account_status = 'Churned'");

  const query = `
    SELECT
      contact_id,
      advisor_name,
      advisor_title,
      account_name,
      account_status,
      contact_url AS salesforce_url,
      account_url,
      opportunity_id,
      opportunity_url,
      joined_date,
      sqo_date,
      churn_date,
      churned_to_firm,
      prior_firm,
      team_role,
      fa_crd,
      months_at_savvy,
      account_aum,
      account_total_aum
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_close_won\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY COALESCE(account_total_aum, account_aum) DESC NULLS LAST, advisor_name ASC
    LIMIT @limit
  `;
  const results = await runQuery<any>(query, params);
  return results.map(r => {
    const extractDate = (f: any): string | null => {
      if (!f) return null;
      if (typeof f === 'string') return f;
      if (typeof f === 'object' && f.value) return f.value;
      return null;
    };
    const joinedDate = extractDate(r.joined_date);
    const sqoDate = extractDate(r.sqo_date);
    const churnDate = extractDate(r.churn_date);
    const accountStatus = toString(r.account_status);
    const stage = accountStatus === 'Joined' ? 'Joined' : 'Churned';
    const aum = toNumber(r.account_total_aum) || toNumber(r.account_aum);
    return {
      id: toString(r.contact_id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.account_name) || 'Unknown',
      channel: toString(r.team_role) || 'Advisor',
      stage,
      tofStage: 'Joined',
      sga: null,
      sgm: null,
      campaignId: null,
      campaignName: null,
      leadScoreTier: null,
      aum,
      aumFormatted: formatCurrency(aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: joinedDate || '',
      contactedDate: null,
      mqlDate: null,
      sqlDate: null,
      sqoDate,
      joinedDate,
      signedDate: null,
      discoveryDate: null,
      salesProcessDate: null,
      negotiatingDate: null,
      onHoldDate: null,
      closedDate: churnDate,
      oppCreatedDate: null,
      daysInCurrentStage: null,
      initialCallScheduledDate: null,
      qualificationCallDate: null,
      isContacted: false,
      isMql: false,
      isSql: false,
      isSqo: false,
      isJoined: true,
      isOpenPipeline: false,
      recordTypeId: null,
      isPrimaryOppRecord: true,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
    } as DetailRecord;
  });
};

// Advisor-level drill-down for the Signed scorecard. One row per individual advisor
// on an Account whose primary signing opp had Stage_Entered_Signed__c populated.
// Honors filters.signedDisposition (all/joined/lost).
const getSignedAdvisorRecords = async (
  filters: DashboardFilters,
  limit: number
): Promise<DetailRecord[]> => {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
    limit,
  };
  const conditions: string[] = [
    'signed_date IS NOT NULL',
    'signed_date >= DATE(@startDate)',
    'signed_date <= DATE(@endDate)',
  ];
  if (filters.signedDisposition === 'joined') conditions.push("cohort = 'joined'");
  else if (filters.signedDisposition === 'lost') conditions.push("cohort = 'lost'");

  const query = `
    SELECT
      contact_id,
      advisor_name,
      advisor_title,
      account_name,
      account_status,
      contact_url AS salesforce_url,
      account_url,
      opportunity_id,
      opportunity_url,
      signed_date,
      joined_date,
      cohort,
      opp_stage,
      team_role,
      fa_crd,
      account_aum
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_signed_advisors\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY account_aum DESC NULLS LAST, advisor_name ASC
    LIMIT @limit
  `;
  const results = await runQuery<any>(query, params);
  return results.map(r => {
    const extractDate = (f: any): string | null => {
      if (!f) return null;
      if (typeof f === 'string') return f;
      if (typeof f === 'object' && f.value) return f.value;
      return null;
    };
    const signedDate = extractDate(r.signed_date);
    const joinedDate = extractDate(r.joined_date);
    const cohort = toString(r.cohort);
    const stage = toString(r.opp_stage) || 'Signed';
    const aum = toNumber(r.account_aum);
    return {
      id: toString(r.contact_id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.account_name) || 'Unknown',
      channel: toString(r.team_role) || 'Advisor',
      stage,
      tofStage: cohort === 'lost' ? 'Closed Lost' : cohort === 'joined' ? 'Joined' : 'Signed',
      sga: null,
      sgm: null,
      campaignId: null,
      campaignName: null,
      leadScoreTier: null,
      aum,
      aumFormatted: formatCurrency(aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: signedDate || '',
      contactedDate: null,
      mqlDate: null,
      sqlDate: null,
      sqoDate: null,
      joinedDate,
      signedDate,
      discoveryDate: null,
      salesProcessDate: null,
      negotiatingDate: null,
      onHoldDate: null,
      closedDate: null,
      oppCreatedDate: null,
      daysInCurrentStage: null,
      initialCallScheduledDate: null,
      qualificationCallDate: null,
      isContacted: false,
      isMql: false,
      isSql: false,
      isSqo: false,
      isJoined: cohort === 'joined',
      isOpenPipeline: false,
      recordTypeId: null,
      isPrimaryOppRecord: true,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
    } as DetailRecord;
  });
};
