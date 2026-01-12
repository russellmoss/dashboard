import { DashboardFilters } from '@/types/filters';
import { ConversionRates, TrendDataPoint, FunnelMetrics } from '@/types/dashboard';

/**
 * Complete record data for export - includes all fields needed for validation
 */
export interface ExportDetailRecord {
  // Identifiers
  leadId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  primaryKey: string;
  
  // Advisor Info
  advisorName: string;
  salesforceUrl: string | null;
  
  // Attribution
  originalSource: string | null;
  channel: string | null;
  sga: string | null;
  sgm: string | null;
  
  // Stage Info
  stageName: string | null;
  aum: number;
  aumFormatted: string;
  
  // Date Fields (ISO strings)
  filterDate: string | null;
  contactedDate: string | null;      // stage_entered_contacting__c
  mqlDate: string | null;            // mql_stage_entered_ts
  sqlDate: string | null;            // converted_date_raw
  sqoDate: string | null;            // Date_Became_SQO__c
  joinedDate: string | null;         // advisor_join_date__c
  
  // Stage Flags (0 or 1)
  isContacted: number;
  isMql: number;
  isSql: number;
  isSqo: number;
  isJoined: number;
  
  // Progression Flags (Numerators) - 0 or 1
  contactedToMqlProgression: number;
  mqlToSqlProgression: number;
  sqlToSqoProgression: number;
  sqoToJoinedProgression: number;
  
  // Eligibility Flags (Denominators) - 0 or 1
  eligibleForContactedConversions: number;
  eligibleForMqlConversions: number;
  eligibleForSqlConversions: number;
  eligibleForSqoConversions: number;
  
  // Deduplication Flags
  isSqoUnique: number;
  isJoinedUnique: number;
  isPrimaryOppRecord: number;
  
  // Record Type
  recordTypeId: string | null;
  recordTypeName: string;
}

/**
 * Conversion analysis record for breakdown by conversion type
 */
export interface ConversionAnalysisRecord {
  advisorName: string;
  salesforceUrl: string | null;
  fromDate: string | null;
  toDate: string | null;
  inNumerator: boolean;
  inDenominator: boolean;
  notes: string;
}

/**
 * Full export data package
 */
export interface SheetsExportData {
  // Metadata
  exportDate: string;
  exportedBy: string;
  dateRange: {
    start: string;
    end: string;
    preset: string;
  };
  filtersApplied: {
    channel: string | null;
    source: string | null;
    sga: string | null;
    sgm: string | null;
  };
  mode?: 'period' | 'cohort'; // Conversion rate calculation mode
  
  // Summary Data
  metrics: FunnelMetrics;
  conversionRates: ConversionRates;
  
  // Trend Data
  trends: TrendDataPoint[];
  
  // Detail Records
  detailRecords: ExportDetailRecord[];
  
  // Conversion Analysis (grouped by conversion type)
  conversionAnalysis: {
    contactedToMql: ConversionAnalysisRecord[];
    mqlToSql: ConversionAnalysisRecord[];
    sqlToSqo: ConversionAnalysisRecord[];
    sqoToJoined: ConversionAnalysisRecord[];
  };
}

/**
 * Result of sheet export operation
 */
export interface SheetsExportResult {
  success: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  error?: string;
}

/**
 * Options for export
 */
export interface ExportOptions {
  filters: DashboardFilters;
  userEmail: string;
  includeDetailRecords?: boolean;  // Default true, but can skip for speed
  maxDetailRecords?: number;       // Limit for very large exports
}
