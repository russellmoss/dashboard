// Outreach Effectiveness Tab Types

// ============================================
// FILTER TYPES
// ============================================

export interface OutreachEffectivenessFilters {
  sga: string | null;
  dateRangeType: 'this_week' | 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
  startDate: string | null;
  endDate: string | null;
  campaignId: string | null;
  zeroTouchMode: 'all' | 'stale';
}

// ============================================
// DASHBOARD DATA (main response)
// ============================================

export interface OutreachEffectivenessDashboardData {
  persistence: PersistenceMetrics;
  avgTouches: AvgTouchesMetrics;
  multiChannel: MultiChannelMetrics;
  zeroTouch: ZeroTouchMetrics;
  avgCalls: AvgCallsMetrics;
  sgaBreakdown: SGABreakdownRow[];
  campaignSummary: CampaignSummaryData | null;
}

// ============================================
// METRIC 1: Persistence
// ============================================

export interface PersistenceMetrics {
  pct5Plus: number;           // 0-100 percentage
  totalTerminalUnengaged: number;
  totalWith5Plus: number;
  avgTouchpoints: number;
}

// ============================================
// METRIC 2: Avg Touches Before Terminality
// ============================================

export interface AvgTouchesMetrics {
  avgTouches: number;
  totalTerminalUnengagedWorked: number;
  prematureCount: number;     // <5 touches
  prematureRate: number;      // 0-100 percentage
  distribution: TouchDistribution;
}

export interface TouchDistribution {
  one: number;
  two: number;
  three: number;
  four: number;
  fivePlus: number;
}

// ============================================
// METRIC 3: Multi-Channel Coverage
// ============================================

export interface MultiChannelMetrics {
  pct2Plus: number;           // 0-100 percentage
  pct3Plus: number;           // 0-100 percentage
  totalTerminalUnengaged: number;
  channelGaps: ChannelGap[];
}

export interface ChannelGap {
  channel: string;            // SMS, LinkedIn, Call, Email
  coveragePct: number;        // 0-100 — % of leads reached via this channel
}

// ============================================
// METRIC 4: Zero-Touch Coverage Gap
// ============================================

export interface ZeroTouchMetrics {
  zeroTouchCount: number;
  totalAssigned: number;
  zeroTouchPct: number;       // 0-100
  stillOpen: number;
  closedZeroTouch: number;
}

// ============================================
// METRIC 5: Avg Calls/Week
// ============================================

export interface AvgCallsMetrics {
  avgInitialPerWeek: number;
  avgQualPerWeek: number;
  sgaCount: number;
  weekCount: number;
}

// ============================================
// PER-SGA BREAKDOWN
// ============================================

export interface SGABreakdownRow {
  sgaName: string;
  // Overall
  totalAssigned: number;
  workedLeads: number;
  badLeads: number;
  mql: number;
  sql: number;
  sqo: number;
  replied: number;
  unengaged: number;
  // Persistence
  fivePlusTouches: number;
  pct5Plus: number;
  avgTouchpoints: number;
  // Avg Touches
  terminalUnengagedWorked: number;
  avgTouchesBeforeTerminal: number;
  prematureCount: number;
  prematureRate: number;
  // Multi-Channel
  pct2PlusChannels: number;
  pct3PlusChannels: number;
  pctAllChannels: number;
  pct1Only: number;
  smsPct: number;
  linkedInPct: number;
  callPct: number;
  emailPct: number;
  // Zero-Touch
  zeroTouchCount: number;
  zeroTouchPct: number;
  zeroTouchStillOpen: number;
  zeroTouchClosed: number;
  // Avg Calls/Week
  sgaStartDate: string;
  eligibleWeeks: number;
  totalInitialCalls: number;
  avgInitialPerWeek: number;
  totalQualCalls: number;
  avgQualPerWeek: number;
}

// ============================================
// DRILL-DOWN RECORDS
// ============================================

export type OutreachDrillDownType = 'leads' | 'zero-touch' | 'weekly-calls';

export interface OutreachLeadRecord {
  prospectId: string;
  advisorName: string;
  sgaName: string;
  outboundTouchpoints: number;
  channelsUsed: string;         // comma-separated: "SMS, Call, LinkedIn"
  daysInContacting: number | null;
  status: 'Converted' | 'MQL' | 'Replied' | 'Unengaged';
  campaignName: string | null;
  disposition: string | null;
  salesforceUrl: string;
  opportunityId: string | null;
}

export interface ZeroTouchLeadRecord {
  prospectId: string;
  advisorName: string;
  sgaName: string;
  daysSinceAssignment: number;
  currentStage: string;
  disposition: string | null;
  campaignName: string | null;
  isOpen: boolean;
  salesforceUrl: string;
  opportunityId: string | null;
}

export interface WeeklyCallBreakdownRow {
  sgaName: string;
  weekStarting: string;         // YYYY-MM-DD
  initialCalls: number;
  qualCalls: number;
}

// ============================================
// CAMPAIGN SUMMARY
// ============================================

export interface CampaignSummaryData {
  campaignName: string;
  totalLeads: number;
  contactedLeads: number;
  avgTouchesBeforeClose: number;
  pct5PlusTouchpoints: number;
  multiChannelPct: number;
}

// ============================================
// FILTER OPTIONS (API response)
// ============================================

export interface OutreachFilterOptions {
  sgas: Array<{ value: string; label: string; isActive: boolean }>;
  campaigns: Array<{ value: string; label: string }>;
}
