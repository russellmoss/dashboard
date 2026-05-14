import { runQuery } from '@/lib/bigquery';
import type { OpportunityHeader } from '@/types/call-intelligence-opportunities';

const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';

interface HeaderRaw {
  opp_id: string;
  name: string;
  stage_name: string;
  last_stage_change_date: { value: string } | string | null;
  last_activity_date: { value: string } | string | null;
  owner_name: string | null;
  amount: number | null;
  close_date: { value: string } | string | null;
  is_closed: boolean;
  is_won: boolean;
  next_step: string | null;
  last_modified_date: { value: string } | string | null;
  lead_id: string | null;
  contact_id: string | null;
  days_in_stage: number | null;
}

function extractDateValue(v: { value: string } | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return null;
}

export async function getOpportunityHeader(opportunityId: string): Promise<OpportunityHeader | null> {
  const rows = await runQuery<HeaderRaw>(
    `SELECT
      o.Id AS opp_id,
      o.Name AS name,
      o.StageName AS stage_name,
      o.LastStageChangeDate AS last_stage_change_date,
      o.LastActivityDate AS last_activity_date,
      o.Opportunity_Owner_Name__c AS owner_name,
      o.Amount AS amount,
      o.CloseDate AS close_date,
      o.IsClosed AS is_closed,
      o.IsWon AS is_won,
      o.NextStep AS next_step,
      o.LastModifiedDate AS last_modified_date,
      l.Id AS lead_id,
      l.ConvertedContactId AS contact_id,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.LastStageChangeDate, DAY) AS days_in_stage
    FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
      ON l.ConvertedOpportunityId = o.Id
      AND l.IsConverted = true
    WHERE o.Id = @opportunityId
      AND o.RecordTypeId = @recruitingRecordType
    LIMIT 1`,
    { opportunityId, recruitingRecordType: RECRUITING_RECORD_TYPE },
  );

  if (rows.length === 0) return null;
  const r = rows[0];

  let leadId = r.lead_id?.trim() || null;
  // Re-engagement guard: 006-prefixed lead_id is actually an Opp Id
  if (leadId && leadId.startsWith('006')) leadId = null;

  return {
    opportunityId: r.opp_id,
    name: r.name,
    stageName: r.stage_name,
    daysInStage: r.days_in_stage ?? null,
    lastActivityDate: extractDateValue(r.last_activity_date),
    ownerName: r.owner_name ?? 'Unknown',
    amount: r.amount ?? null,
    closeDate: extractDateValue(r.close_date) ?? '',
    isClosed: r.is_closed === true,
    isWon: r.is_won === true,
    nextStep: r.next_step?.trim() || null,
    lastModifiedDate: extractDateValue(r.last_modified_date) ?? '',
    leadId,
    contactId: r.contact_id?.trim() || null,
  };
}

interface IdentityMapRaw {
  opp_id: string;
  lead_id: string | null;
  contact_id: string | null;
  name: string;
  stage_name: string;
  last_stage_change_date: { value: string } | string | null;
  last_activity_date: { value: string } | string | null;
  owner_name: string | null;
  owner_sfdc_id: string | null;
  days_in_stage: number | null;
}

export interface OpportunityIdentityTuple {
  oppId: string;
  leadId: string | null;
  contactId: string | null;
  name: string;
  stageName: string;
  daysInStage: number | null;
  lastActivityDate: string | null;
  ownerName: string;
  ownerSfdcId: string | null;
}

export async function getOpportunityIdentityMap(): Promise<OpportunityIdentityTuple[]> {
  const rows = await runQuery<IdentityMapRaw>(
    `SELECT
      o.Id AS opp_id,
      l.Id AS lead_id,
      l.ConvertedContactId AS contact_id,
      o.Name AS name,
      o.StageName AS stage_name,
      o.LastStageChangeDate AS last_stage_change_date,
      o.LastActivityDate AS last_activity_date,
      o.Opportunity_Owner_Name__c AS owner_name,
      o.OwnerId AS owner_sfdc_id,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), o.LastStageChangeDate, DAY) AS days_in_stage
    FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
      ON l.ConvertedOpportunityId = o.Id
      AND l.IsConverted = true
    WHERE o.RecordTypeId = @recruitingRecordType`,
    { recruitingRecordType: RECRUITING_RECORD_TYPE },
  );

  return rows.map((r) => {
    let leadId = r.lead_id?.trim() || null;
    if (leadId && leadId.startsWith('006')) leadId = null;

    return {
      oppId: r.opp_id,
      leadId,
      contactId: r.contact_id?.trim() || null,
      name: r.name,
      stageName: r.stage_name,
      daysInStage: r.days_in_stage ?? null,
      lastActivityDate: extractDateValue(r.last_activity_date),
      ownerName: r.owner_name ?? 'Unknown',
      ownerSfdcId: r.owner_sfdc_id?.trim() || null,
    };
  });
}

interface StageHistoryRaw {
  created_date: { value: string } | string;
  stage_name: string;
}

export async function getStageAtTimeOfCalls(
  opportunityId: string,
  callDates: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (callDates.length === 0) return result;

  const rows = await runQuery<StageHistoryRaw>(
    `SELECT
      h.CreatedDate AS created_date,
      h.NewValue AS stage_name
    FROM \`savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory\` h
    WHERE h.OpportunityId = @opportunityId
      AND h.Field = 'StageName'
    ORDER BY h.CreatedDate ASC`,
    { opportunityId },
  );

  const transitions = rows.map((r) => ({
    date: extractDateValue(r.created_date) ?? '',
    stage: r.stage_name,
  }));

  for (const callDate of callDates) {
    let stage: string | null = null;
    for (const t of transitions) {
      if (t.date <= callDate) {
        stage = t.stage;
      } else {
        break;
      }
    }
    result.set(callDate, stage);
  }

  return result;
}
