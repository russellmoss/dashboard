import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE } from '@/config/constants';

// Types for Recruiter Hub records
export interface RecruiterProspect {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGA_Owner_Name__c: string | null;
  Next_Steps__c: string | null;
  TOF_Stage: string;
  Conversion_Status: string;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  salesforce_url: string | null;
  Full_Opportunity_ID__c: string | null;
}

export interface RecruiterOpportunity {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGM_Owner_Name__c: string | null;
  StageName: string;
  NextStep: string | null;
  salesforce_url: string | null;
}

// Get distinct external agencies for dropdown
export async function getDistinctExternalAgencies(): Promise<string[]> {
  const query = `
    SELECT DISTINCT External_Agency__c
    FROM \`${FULL_TABLE}\`
    WHERE External_Agency__c IS NOT NULL 
      AND TRIM(External_Agency__c) != ''
    ORDER BY External_Agency__c
  `;

  const rows = await runQuery<{ External_Agency__c: string }>(query);
  return rows.map((row) => row.External_Agency__c);
}

// Get prospects for Recruiter Hub
export async function getRecruiterProspects(
  recruiterFilter: string | null,
  filters: {
    stages?: string[];  // 'MQL', 'SQL', 'SQO', 'Qualified', 'Closed Lost'
    openOnly?: boolean;
    closedOnly?: boolean;
    externalAgencies?: string[];  // For admin filtering
  }
): Promise<RecruiterProspect[]> {
  const params: Record<string, unknown> = {};
  const conditions: string[] = [
    'External_Agency__c IS NOT NULL',
    "TRIM(External_Agency__c) != ''",
    'Full_prospect_id__c IS NOT NULL',  // Must have a prospect/lead
  ];

  // Recruiter filter (required for recruiters, ignored for admins)
  if (recruiterFilter) {
    conditions.push('External_Agency__c = @recruiterFilter');
    params.recruiterFilter = recruiterFilter;
  }

  // Admin agency filter (optional)
  if (!recruiterFilter && filters.externalAgencies && filters.externalAgencies.length > 0) {
    conditions.push('External_Agency__c IN UNNEST(@externalAgencies)');
    params.externalAgencies = filters.externalAgencies;
  }

  // Stage filters
  if (filters.stages && filters.stages.length > 0) {
    const stageConditions: string[] = [];
    if (filters.stages.includes('MQL')) stageConditions.push('is_mql = 1');
    if (filters.stages.includes('SQL')) stageConditions.push('is_sql = 1');
    if (filters.stages.includes('SQO')) stageConditions.push('is_sqo = 1');
    if (filters.stages.includes('Qualified')) {
      stageConditions.push('Full_Opportunity_ID__c IS NOT NULL');
    }
    if (filters.stages.includes('Closed Lost')) {
      stageConditions.push("Conversion_Status = 'Closed'");
    }
    if (stageConditions.length > 0) {
      conditions.push(`(${stageConditions.join(' OR ')})`);
    }
  }

  // Status: Open and/or Closed (default Open only when not specified)
  // Closed = Closed Lost (Conversion_Status = 'Closed') OR Qualified (converted to opportunity)
  if (filters.openOnly && !filters.closedOnly) {
    conditions.push("Conversion_Status = 'Open'");
    conditions.push('Full_Opportunity_ID__c IS NULL');
  } else if (filters.closedOnly && !filters.openOnly) {
    conditions.push(
      "(Conversion_Status = 'Closed' OR Full_Opportunity_ID__c IS NOT NULL)"
    );
  }
  // If both or neither, no status filter (show all)

  const query = `
    SELECT
      primary_key,
      advisor_name,
      External_Agency__c,
      SGA_Owner_Name__c,
      Next_Steps__c,
      TOF_Stage,
      Conversion_Status,
      is_mql,
      is_sql,
      is_sqo,
      salesforce_url,
      Full_Opportunity_ID__c
    FROM \`${FULL_TABLE}\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY advisor_name
    LIMIT 5000
  `;

  return runQuery<RecruiterProspect>(query, Object.keys(params).length ? params : undefined);
}

// Get opportunities for Recruiter Hub
export async function getRecruiterOpportunities(
  recruiterFilter: string | null,
  filters: {
    stages?: string[];
    sgms?: string[];
    openOnly?: boolean;
    closedOnly?: boolean;
    externalAgencies?: string[];
  }
): Promise<RecruiterOpportunity[]> {
  const params: Record<string, unknown> = {};
  const conditions: string[] = [
    'External_Agency__c IS NOT NULL',
    "TRIM(External_Agency__c) != ''",
    'Full_Opportunity_ID__c IS NOT NULL',
    'is_primary_opp_record = 1',  // Dedupe opportunities
  ];

  // Recruiter filter
  if (recruiterFilter) {
    conditions.push('External_Agency__c = @recruiterFilter');
    params.recruiterFilter = recruiterFilter;
  }

  // Admin agency filter
  if (!recruiterFilter && filters.externalAgencies && filters.externalAgencies.length > 0) {
    conditions.push('External_Agency__c IN UNNEST(@externalAgencies)');
    params.externalAgencies = filters.externalAgencies;
  }

  // Stage filter
  if (filters.stages && filters.stages.length > 0) {
    conditions.push('StageName IN UNNEST(@stages)');
    params.stages = filters.stages;
  }

  // SGM filter
  if (filters.sgms && filters.sgms.length > 0) {
    conditions.push('SGM_Owner_Name__c IN UNNEST(@sgms)');
    params.sgms = filters.sgms;
  }

  // Status: Open and/or Closed
  if (filters.openOnly && !filters.closedOnly) {
    conditions.push("StageName NOT IN ('Joined', 'Closed Lost')");
  } else if (filters.closedOnly && !filters.openOnly) {
    conditions.push("StageName IN ('Joined', 'Closed Lost')");
  }

  const query = `
    SELECT
      primary_key,
      advisor_name,
      External_Agency__c,
      SGM_Owner_Name__c,
      StageName,
      NextStep,
      salesforce_url
    FROM \`${FULL_TABLE}\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY advisor_name
    LIMIT 5000
  `;

  return runQuery<RecruiterOpportunity>(query, Object.keys(params).length ? params : undefined);
}

// Get distinct SGMs for filter dropdown
export async function getRecruiterHubSGMs(recruiterFilter: string | null): Promise<string[]> {
  const params: Record<string, unknown> = {};
  const conditions: string[] = [
    'External_Agency__c IS NOT NULL',
    "TRIM(External_Agency__c) != ''",
    'Full_Opportunity_ID__c IS NOT NULL',
    'SGM_Owner_Name__c IS NOT NULL',
  ];

  if (recruiterFilter) {
    conditions.push('External_Agency__c = @recruiterFilter');
    params.recruiterFilter = recruiterFilter;
  }

  const query = `
    SELECT DISTINCT SGM_Owner_Name__c
    FROM \`${FULL_TABLE}\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY SGM_Owner_Name__c
  `;

  const rows = await runQuery<{ SGM_Owner_Name__c: string }>(
    query,
    Object.keys(params).length ? params : undefined
  );
  return rows.map((row) => row.SGM_Owner_Name__c);
}
