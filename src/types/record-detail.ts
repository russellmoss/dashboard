// src/types/record-detail.ts

/**
 * Full record detail type for modal display
 * Contains all fields from vw_funnel_master view
 */

// Funnel stage flags interface
export interface FunnelStageFlags {
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
}

// Progression flags interface
export interface ProgressionFlags {
  contactedToMql: boolean;
  mqlToSql: boolean;
  sqlToSqo: boolean;
  sqoToJoined: boolean;
}

// Eligibility flags interface
export interface EligibilityFlags {
  eligibleForContactedConversions: boolean;
  eligibleForMqlConversions: boolean;
  eligibleForSqlConversions: boolean;
  eligibleForSqoConversions: boolean;
}

// Full record detail interface
export interface RecordDetailFull {
  // Identifiers
  id: string;                          // primary_key
  fullProspectId: string | null;       // Full_prospect_id__c (Lead ID)
  fullOpportunityId: string | null;    // Full_Opportunity_ID__c (Opportunity ID)
  advisorName: string;
  
  // Record Type
  recordType: 'Lead' | 'Opportunity' | 'Converted';  // Derived from IDs
  recordTypeName: string | null;       // 'Recruiting' | 'Re-Engagement'
  
  // Attribution
  source: string;
  channel: string;
  sga: string | null;
  sgm: string | null;
  externalAgency: string | null;
  nextSteps: string | null;          // From Lead.Next_Steps__c
  opportunityNextStep: string | null; // From Opportunity.NextStep
  leadScoreTier: string | null;
  experimentationTag: string | null;
  
  // Dates - Key Milestones
  createdDate: string | null;
  filterDate: string | null;
  contactedDate: string | null;        // stage_entered_contacting__c
  mqlDate: string | null;              // mql_stage_entered_ts
  sqlDate: string | null;              // converted_date_raw
  sqoDate: string | null;              // Date_Became_SQO__c
  joinedDate: string | null;           // advisor_join_date__c
  
  // Dates - Calls
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  
  // Dates - Stage Entry (Opportunity stages)
  stageEnteredDiscovery: string | null;
  stageEnteredSalesProcess: string | null;
  stageEnteredNegotiating: string | null;
  stageEnteredSigned: string | null;
  stageEnteredOnHold: string | null;
  stageEnteredClosed: string | null;
  leadClosedDate: string | null;
  oppCreatedDate: string | null;
  
  // Financials
  aum: number | null;
  aumFormatted: string;
  underwrittenAum: number | null;
  underwrittenAumFormatted: string;
  amount: number | null;
  amountFormatted: string;
  aumTier: string | null;
  
  // Status
  stageName: string | null;
  tofStage: string;                    // TOF_Stage (always populated)
  conversionStatus: string;            // 'Open' | 'Joined' | 'Closed'
  disposition: string | null;
  closedLostReason: string | null;
  closedLostDetails: string | null;
  
  // Funnel Flags
  funnelFlags: FunnelStageFlags;
  progressionFlags: ProgressionFlags;
  eligibilityFlags: EligibilityFlags;
  
  // URLs
  leadUrl: string | null;
  opportunityUrl: string | null;
  salesforceUrl: string;
  
  // Deduplication flags (for debugging)
  isPrimaryOppRecord: boolean;
  isSqoUnique: boolean;
  isJoinedUnique: boolean;
}

// Raw BigQuery response interface
export interface RecordDetailRaw {
  primary_key: string;
  Full_prospect_id__c: string | null;
  Full_Opportunity_ID__c: string | null;
  advisor_name: string;
  record_type_name: string | null;
  
  // Attribution
  Original_source: string;
  Channel_Grouping_Name: string;
  SGA_Owner_Name__c: string | null;
  SGM_Owner_Name__c: string | null;
  External_Agency__c: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
  Lead_Score_Tier__c: string | null;
  Experimentation_Tag_Raw__c: string | null;
  
  // Dates
  CreatedDate: { value: string } | string | null;
  FilterDate: { value: string } | string | null;
  stage_entered_contacting__c: { value: string } | string | null;
  mql_stage_entered_ts: { value: string } | string | null;
  converted_date_raw: string | { value: string } | null;  // DATE type - can be string or object
  Date_Became_SQO__c: { value: string } | string | null;
  advisor_join_date__c: string | { value: string } | null;  // DATE type - can be string or object
  Initial_Call_Scheduled_Date__c: string | { value: string } | null;  // DATE type - can be string or object
  Qualification_Call_Date__c: string | { value: string } | null;  // DATE type - can be string or object
  Stage_Entered_Discovery__c: { value: string } | string | null;
  Stage_Entered_Sales_Process__c: { value: string } | string | null;
  Stage_Entered_Negotiating__c: { value: string } | string | null;
  Stage_Entered_Signed__c: { value: string } | string | null;
  Stage_Entered_On_Hold__c: { value: string } | string | null;
  Stage_Entered_Closed__c: { value: string } | string | null;
  lead_closed_date: { value: string } | string | null;
  Opp_CreatedDate: { value: string } | string | null;
  
  // Financials
  Opportunity_AUM: number | null;
  Underwritten_AUM__c: number | null;
  Amount: number | null;
  aum_tier: string | null;
  
  // Status
  StageName: string | null;
  TOF_Stage: string;
  Conversion_Status: string;
  Disposition__c: string | null;
  Closed_Lost_Reason__c: string | null;
  Closed_Lost_Details__c: string | null;
  
  // Flags (returned as 0 or 1 from BigQuery)
  is_contacted: number;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  is_joined: number;
  is_sqo_unique: number;
  is_joined_unique: number;
  is_primary_opp_record: number;
  
  // Progression flags
  contacted_to_mql_progression: number;
  mql_to_sql_progression: number;
  sql_to_sqo_progression: number;
  sqo_to_joined_progression: number;
  
  // Eligibility flags
  eligible_for_contacted_conversions: number;
  eligible_for_mql_conversions: number;
  eligible_for_sql_conversions: number;
  eligible_for_sqo_conversions: number;
  
  // URLs
  lead_url: string | null;
  opportunity_url: string | null;
  salesforce_url: string;
}

// API Response type
export interface RecordDetailResponse {
  record: RecordDetailFull | null;
  error?: string;
}
