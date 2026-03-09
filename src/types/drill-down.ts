// src/types/drill-down.ts

/**
 * Type definitions for drill-down modals in SGA Management and SGA Hub
 */

// Metric type for drill-down
export type MetricType = 'initial-calls' | 'qualification-calls' | 'sqos' | 'open-sqls' | 'mqls' | 'sqls' | 'leads-sourced' | 'leads-contacted';

// Base interface with common fields
export interface DrillDownRecordBase {
  primaryKey: string;
  advisorName: string;
  source: string;
  channel: string;
  tofStage: string;
  leadUrl: string | null;
  opportunityUrl: string | null;
  nextSteps: string | null;
  opportunityNextStep: string | null;
  daysInCurrentStage: number | null;
}

// Initial Call Record
export interface InitialCallRecord extends DrillDownRecordBase {
  initialCallDate: string;
  leadScoreTier: string | null;
}

// Qualification Call Record
export interface QualificationCallRecord extends DrillDownRecordBase {
  qualificationCallDate: string;
  leadScoreTier: string | null;
  aum: number | null;
  aumFormatted: string;
  aumTier: string | null;
}

// SQO Drill-Down Record
export interface SQODrillDownRecord extends DrillDownRecordBase {
  sqoDate: string;
  sgaName: string | null; // SGA name (null for single-SGA drill-downs, populated for team-level)
  aum: number | null;
  aumFormatted: string;
  underwrittenAum: number | null;
  underwrittenAumFormatted: string;
  aumTier: string | null;
  stageName: string | null;
}

// Open SQL Drill-Down Record
export interface OpenSQLDrillDownRecord extends DrillDownRecordBase {
  sqlDate: string;
  sgaName: string | null;
  aum: number | null;
  aumFormatted: string;
  aumTier: string | null;
  stageName: string | null;
}

// MQL Drill-Down Record
export interface MQLDrillDownRecord extends DrillDownRecordBase {
  mqlDate: string;
  initialCallDate: string | null;
}

// SQL Drill-Down Record
export interface SQLDrillDownRecord extends DrillDownRecordBase {
  sqlDate: string;
  qualificationCallDate: string | null;
}

// Leads Sourced Record (different fields from Lead table — does NOT extend DrillDownRecordBase)
export interface LeadsSourcedRecord {
  primaryKey: string;  // Lead Id — matches primary_key in vw_funnel_master
  leadId: string;
  advisorName: string;
  company: string;
  source: string;
  createdDate: string;
  isSelfSourced: boolean;
  leadUrl: string | null;
}

// Leads Contacted Record
export interface LeadsContactedRecord {
  primaryKey: string;
  advisorName: string;
  source: string;
  channel: string;
  contactedDate: string;
  leadUrl: string | null;
}

// Union type for all drill-down records
export type DrillDownRecord = InitialCallRecord | QualificationCallRecord | SQODrillDownRecord | OpenSQLDrillDownRecord | MQLDrillDownRecord | SQLDrillDownRecord | LeadsSourcedRecord | LeadsContactedRecord;

// Props for MetricDrillDownModal
export interface MetricDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  metricType: MetricType;
  records: DrillDownRecord[];
  title: string;
  loading: boolean;
  error: string | null;
  onRecordClick: (primaryKey: string) => void;
  canExport?: boolean;
}

// Props for ClickableMetricValue
export interface ClickableMetricValueProps {
  value: number | null;
  onClick: () => void;
  loading?: boolean;
  className?: string;
}

// Raw BigQuery response types
export interface RawInitialCallRecord {
  primary_key: string;
  advisor_name: string;
  Initial_Call_Scheduled_Date__c: { value: string } | string | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  Lead_Score_Tier__c: string | null;
  TOF_Stage: string;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
  stage_entered_contacting__c: { value: string } | string | null;
  mql_stage_entered_ts: { value: string } | string | null;
}

export interface RawQualificationCallRecord {
  primary_key: string;
  advisor_name: string;
  Qualification_Call_Date__c: { value: string } | string | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  Lead_Score_Tier__c: string | null;
  TOF_Stage: string;
  Opportunity_AUM: number | null;
  aum_tier: string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
  StageName: string | null;
  mql_stage_entered_ts: { value: string } | string | null;
  converted_date_raw: string | { value: string } | null;
  Date_Became_SQO__c: { value: string } | string | null;
  Opp_CreatedDate: { value: string } | string | null;
  Stage_Entered_Discovery__c: { value: string } | string | null;
  Stage_Entered_Sales_Process__c: { value: string } | string | null;
  Stage_Entered_Negotiating__c: { value: string } | string | null;
}

export interface RawOpenSQLDrillDownRecord {
  primary_key: string;
  advisor_name: string;
  converted_date_raw: string | { value: string } | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  SGA_Owner_Name__c: string | null;
  Opportunity_AUM: number | null;
  aum_tier: string | null;
  TOF_Stage: string;
  StageName: string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
  Opp_CreatedDate: { value: string } | string | null;
  Stage_Entered_Discovery__c: { value: string } | string | null;
  Stage_Entered_Sales_Process__c: { value: string } | string | null;
  Stage_Entered_Negotiating__c: { value: string } | string | null;
}

export interface RawSQODrillDownRecord {
  primary_key: string;
  advisor_name: string;
  Date_Became_SQO__c: { value: string } | string | null;
  Original_source: string;
  channel: string | null;
  sga_name: string | null;
  Opportunity_AUM: number | null;
  Underwritten_AUM__c: number | null;
  aum_tier: string | null;
  TOF_Stage: string;
  StageName: string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
  Opp_CreatedDate: { value: string } | string | null;
  Stage_Entered_Discovery__c: { value: string } | string | null;
  Stage_Entered_Sales_Process__c: { value: string } | string | null;
  Stage_Entered_Negotiating__c: { value: string } | string | null;
  Stage_Entered_Signed__c: { value: string } | string | null;
  Stage_Entered_On_Hold__c: { value: string } | string | null;
  Stage_Entered_Closed__c: { value: string } | string | null;
}

// Raw BigQuery types for new drill-down records
export interface RawMQLDrillDownRecord {
  primary_key: string;
  advisor_name: string;
  mql_stage_entered_ts: { value: string } | string | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  TOF_Stage: string;
  Initial_Call_Scheduled_Date__c: { value: string } | string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
}

export interface RawSQLDrillDownRecord {
  primary_key: string;
  advisor_name: string;
  converted_date_raw: string | { value: string } | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  TOF_Stage: string;
  Qualification_Call_Date__c: { value: string } | string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
}

export interface RawLeadsSourcedRecord {
  Id: string;
  Name: string;
  Company: string | null;
  Final_Source__c: string;
  CreatedDate: { value: string } | string | null;
  SGA_Owner_Name__c: string;
}

export interface RawLeadsContactedRecord {
  primary_key: string;
  advisor_name: string;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  stage_entered_contacting__c: { value: string } | string | null;
  lead_url: string | null;
}
// NOTE: Final_Source__c is NOT in vw_funnel_master. Self-sourced toggle only affects counts, not drill-down records.

// Drill-down context for "Back" button functionality
export interface DrillDownContext {
  metricType: MetricType;
  title: string;
  sgaName: string | null; // null for team-level drill-down
  weekStartDate?: string;
  weekEndDate?: string;
  quarter?: string;
}
