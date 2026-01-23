// SGA Activity Dashboard Types

// ============================================
// FILTER TYPES
// ============================================

export interface SGAActivityFilters {
  // SGA Filter
  sga: string | null;  // null = all SGAs
  
  // Date Range Filters (for main dashboard - scheduled calls, totals, etc.)
  dateRangeType: 'this_week' | 'next_week' | 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
  startDate: string | null;  // ISO date string for custom range
  endDate: string | null;    // ISO date string for custom range
  
  // Comparison Period (for main dashboard)
  comparisonDateRangeType: 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
  comparisonStartDate: string | null;
  comparisonEndDate: string | null;
  
  // Period A/B Filters (ONLY for Activity Distribution table)
  periodAType?: 'this_week' | 'next_week' | 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
  periodAStartDate?: string | null;
  periodAEndDate?: string | null;
  periodBType?: 'this_week' | 'next_week' | 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
  periodBStartDate?: string | null;
  periodBEndDate?: string | null;
  
  // Activity Filters
  activityTypes: ActivityType[];  // Which activity types to show
  includeAutomated: boolean;      // Default false (exclude lemlist)
  
  // Call Type Filter (for answer rate)
  callTypeFilter: 'all_outbound' | 'cold_calls' | 'scheduled_calls';
}

export type ActivityType = 
  | 'cold_call'
  | 'outbound_call'
  | 'inbound_call'
  | 'sms_outbound'
  | 'sms_inbound'
  | 'linkedin_message'
  | 'linkedin_connection'
  | 'linkedin_accept'
  | 'linkedin_reply'
  | 'email_manual'
  | 'email_automated';

export type ActivityChannel = 'Call' | 'SMS' | 'LinkedIn' | 'Email';

// ============================================
// SCHEDULED CALLS TYPES
// ============================================

export interface ScheduledCallsSummary {
  thisWeek: {
    total: number;
    byDay: DayCount[];
    bySGA: SGACallCount[];
  };
  nextWeek: {
    total: number;
    byDay: DayCount[];
    bySGA: SGACallCount[];
  };
}

export interface DayCount {
  dayOfWeek: number;  // 1=Monday, 2=Tuesday, etc.
  dayName: string;     // "Monday", "Tuesday", etc.
  count: number;
}

export interface SGACallCount {
  sgaName: string;
  thisWeek: number;
  nextWeek: number;
  total: number;
}

export interface ScheduledCallRecord {
  id: string;
  prospectName: string;
  sgaName: string;
  scheduledDate: string;  // ISO date string
  source: string | null;
  channel: string | null;
  salesforceUrl: string;
  leadId: string | null;
  opportunityId: string | null;
}

// ============================================
// ACTIVITY DISTRIBUTION TYPES
// ============================================

export interface ActivityDistribution {
  channel: ActivityChannel;
  currentPeriod: DayCount[];
  comparisonPeriod: ComparisonDayCount[];
  variance: VarianceDayCount[];
}

export interface ComparisonDayCount {
  dayOfWeek: number;
  dayName: string;
  count: number;  // Total count (for reference)
  avgCount: number;  // Average per occurrence of that day
}

export interface VarianceDayCount {
  dayOfWeek: number;
  dayName: string;
  currentCount: number;
  comparisonCount: number;
  variance: number;
  variancePercent: number;
}

// ============================================
// RESPONSE RATE TYPES
// ============================================

export interface SMSResponseRate {
  outboundCount: number;
  inboundCount: number;
  responseRate: number;  // 0-1 decimal
  responseRatePercent: number;  // 0-100 percentage
}

export interface CallAnswerRate {
  outboundCount: number;
  answeredCount: number;
  answerRate: number;  // 0-1 decimal
  answerRatePercent: number;  // 0-100 percentage
}

// ============================================
// ACTIVITY BREAKDOWN TYPES
// ============================================

export interface ActivityBreakdown {
  channel: ActivityChannel;
  subType: string;
  count: number;
  percentage: number;
}

// ============================================
// ACTIVITY TOTALS TYPES
// ============================================

export interface ActivityTotals {
  coldCalls: number;
  outboundCalls: number;
  smsOutbound: number;
  smsInbound: number;
  linkedInMessages: number;
  emailsManual: number;
}

// ============================================
// DRILL-DOWN RECORD TYPES
// ============================================

export interface ActivityRecord {
  taskId: string;
  createdDate: string;        // ISO datetime
  createdDateEST: string;     // Date in EST
  activityChannel: string;
  activitySubType: string;
  direction: string;
  sgaName: string;
  prospectName: string;
  leadId: string;
  opportunityId: string | null;
  source: string;
  channel: string;
  subject: string;
  callDuration: number | null;
  isAutomated: boolean;
  isColdCall: boolean;
  salesforceUrl: string;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface SGAActivityDashboardData {
  // Scheduled Calls
  initialCalls: ScheduledCallsSummary;
  qualificationCalls: ScheduledCallsSummary;
  
  // Activity Distribution
  activityDistribution: ActivityDistribution[];
  
  // Response/Answer Rates
  smsResponseRate: SMSResponseRate;
  callAnswerRate: CallAnswerRate;
  
  // Activity Breakdown
  activityBreakdown: ActivityBreakdown[];
  
  // Totals
  totals: ActivityTotals;
}
