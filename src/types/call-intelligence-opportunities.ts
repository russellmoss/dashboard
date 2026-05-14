export interface OpportunityHeader {
  opportunityId: string;
  name: string;
  stageName: string;
  daysInStage: number | null;
  lastActivityDate: string | null;
  ownerName: string;
  amount: number | null;
  closeDate: string;
  isClosed: boolean;
  isWon: boolean;
  nextStep: string | null;
  lastModifiedDate: string;
  leadId: string | null;
  contactId: string | null;
}

export interface OpportunityListRow {
  opportunityId: string;
  name: string;
  stageName: string;
  daysInStage: number | null;
  lastActivityDate: string | null;
  ownerName: string;
  podId: string | null;
  podName: string | null;
  threadedCallCount: number;
  likelyUnlinkedCount: number;
  lastCallDate: string | null;
  granolaCount: number;
  kixieCount: number;
}

export type LinkageStatus = 'linked_opp' | 'linked_contact' | 'linked_lead' | 'likely_match';

export interface OpportunityTimelineRow {
  callNoteId: string;
  callDate: string;
  title: string;
  summaryPreview: string | null;
  source: 'granola' | 'kixie';
  repId: string;
  repName: string | null;
  managerName: string | null;
  linkageStatus: LinkageStatus;
  sfdcRecordType: string | null;
  sfdcSuggestion: unknown | null;
  stageAtTimeOfCall: string | null;
}

export interface OpportunityAiSummary {
  opportunityId: string;
  painPoints: string[];
  competitorsInTheMix: string[];
  nextSteps: string[];
  compensationDiscussions: string[];
  advisorConcerns: string[];
  generatedAt: string;
  callNoteIds: string[];
  cacheHit: boolean;
  callDateMap: Record<string, string>;
}
