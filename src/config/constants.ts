// Application-wide constants

// Open Pipeline Stages - Must match actual Salesforce StageName values
// These are opportunities that are currently active and actively progressing
// Excludes: Closed Lost, Joined, On Hold, Signed
export const OPEN_PIPELINE_STAGES: readonly string[] = [
  'Qualifying',
  'Discovery',
  'Sales Process',
  'Negotiating'
];

export const STAGE_STACK_ORDER: readonly string[] = [
  'Planned Nurture',
  'Qualifying',
  'Discovery',
  'Sales Process',
  'Negotiating',
  'Signed',
  'On Hold',
];

export const STAGE_COLORS: Record<string, string> = {
  'Planned Nurture': '#94a3b8',
  'Qualifying':      '#60a5fa',
  'Discovery':       '#34d399',
  'Sales Process':   '#fbbf24',
  'Negotiating':     '#f97316',
  'Signed':          '#a78bfa',
  'On Hold':         '#f87171',
};

export const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';
export const RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC';

export const FULL_TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';
export const FORECAST_TABLE = 'savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast';
export const MAPPING_TABLE = 'savvy-gtm-analytics.SavvyGTMData.new_mapping';
export const DAILY_FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast';

export const DEFAULT_YEAR = 2025;
export const DEFAULT_DATE_PRESET = 'q4' as const;
