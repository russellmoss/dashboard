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

export interface OpportunityChatThread {
  id: string;
  title: string | null;
  callNoteIdsHash: string;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface OpportunityChatThreadSummary {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  messageCount: number;
}

export interface OpportunityChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citedChunkIds: string[];
  createdAt: string;
}

export interface OpportunityChatResponse {
  thread: OpportunityChatThread;
  messages: OpportunityChatMessage[];
  threads: OpportunityChatThreadSummary[];
  newCallsDetected: boolean;
}

export interface KbChunkForChat {
  id: string;
  bodyText: string;
  docId: string;
  driveFileId: string;
  docTitle: string;
  driveUrl: string;
  distance: number;
}

export type ChatStreamChunk =
  | { type: 'text'; content: string }
  | { type: 'done'; citedChunkIds: string[] }
  | { type: 'error'; message: string };
