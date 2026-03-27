export interface ProspectRecord {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGA_Owner_Name__c: string | null;
  Next_Steps__c: string | null;
  TOF_Stage: string;
  Conversion_Status: string;
  salesforce_url: string | null;
  Full_Opportunity_ID__c: string | null;
}

export interface OpportunityRecord {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGM_Owner_Name__c: string | null;
  StageName: string;
  NextStep: string | null;
  salesforce_url: string | null;
}

export interface ProspectFilters {
  stages: string[];
  statusOpen: boolean;
  statusClosed: boolean;
  externalAgencies: string[];
}

export interface OpportunityFilters {
  stages: string[];
  sgms: string[];
  statusOpen: boolean;
  statusClosed: boolean;
  externalAgencies: string[];
}

export type SortDir = 'asc' | 'desc';

export const ROWS_PER_PAGE = 150;

export const PROSPECT_STAGES = ['MQL', 'SQL', 'SQO', 'Qualified', 'Closed Lost'];

// Open stages for Recruiter Hub opportunities (match pipeline "Open")
export const OPEN_OPPORTUNITY_STAGES_RH = [
  'Qualifying',
  'Discovery',
  'Sales Process',
  'Negotiating',
  'Signed',
  'On Hold',
  'Re-Engaged',
  'Planned Nurture',
];
export const CLOSED_OPPORTUNITY_STAGES_RH = ['Joined', 'Closed Lost'];
export const ALL_OPPORTUNITY_STAGES_RH = [
  { value: 'Qualifying', label: 'Qualifying', isOpenStage: true },
  { value: 'Discovery', label: 'Discovery', isOpenStage: true },
  { value: 'Sales Process', label: 'Sales Process', isOpenStage: true },
  { value: 'Negotiating', label: 'Negotiating', isOpenStage: true },
  { value: 'Signed', label: 'Signed', isOpenStage: true },
  { value: 'On Hold', label: 'On Hold', isOpenStage: true },
  { value: 'Re-Engaged', label: 'Re-Engaged', isOpenStage: true },
  { value: 'Planned Nurture', label: 'Planned Nurture', isOpenStage: true },
  { value: 'Joined', label: 'Joined', isOpenStage: false },
  { value: 'Closed Lost', label: 'Closed Lost', isOpenStage: false },
];

export const OPPORTUNITY_STAGE_COLORS: Record<string, string> = {
  Qualifying: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Discovery: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  'Sales Process': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Negotiating: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Signed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  'On Hold': 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  'Re-Engaged': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  'Planned Nurture': 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400',
  Joined: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  'Closed Lost': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export const PROSPECT_STAGE_COLORS: Record<string, string> = {
  MQL: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  SQL: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  SQO: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Qualified: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
  'Closed Lost': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};
