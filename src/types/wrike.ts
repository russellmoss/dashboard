import { RequestStatus, RequestPriority } from '@prisma/client';

// Wrike Configuration - discovered from Wrike API exploration
// Run `npx ts-node scripts/discover-wrike.ts` to rediscover these values
export const WRIKE_CONFIG = {
  // Default folder - can be overridden with WRIKE_FOLDER_ID env var
  // Options found: "Rev Ops" (MQAAAAECwHhs), "Dashboards" (MQAAAAEEBpOb)
  FOLDER_ID: 'MQAAAAECwHhs', // Rev Ops project

  WORKFLOW_ID: 'IEAGT6KAK77ZMBWA', // Default Workflow

  // Status IDs from Default Workflow
  STATUS_IDS: {
    SUBMITTED: 'IEAGT6KAJMAAAAAA',    // Requested (Active)
    PLANNED: 'IEAGT6KAJMGFKCLS',      // In Design (Active)
    IN_PROGRESS: 'IEAGT6KAJMF7ZXTO',  // In Progress (Active)
    DONE: 'IEAGT6KAJMAAAAAB',         // Completed (Completed)
    ARCHIVED: 'IEAGT6KAJMAAAAAD',     // Cancelled (Cancelled)
  },

  CUSTOM_FIELD_IDS: {
    PRIORITY: 'IEAGT6KAJUAKJULP',        // DropDown: Low, Medium, High, Pre-Committed
    REQUESTING_TEAM: 'IEAGT6KAJUAKEJUP', // Multiple: Marketing, SGA, SGM, etc.
    SIZE_OF_ASK: 'IEAGT6KAJUAKEJVQ',     // DropDown: Small, Medium, Large, Project/Epic
  },
} as const;

// Map dashboard status to Wrike status ID
export const STATUS_TO_WRIKE: Record<RequestStatus, string> = {
  SUBMITTED: WRIKE_CONFIG.STATUS_IDS.SUBMITTED,
  PLANNED: WRIKE_CONFIG.STATUS_IDS.PLANNED,
  IN_PROGRESS: WRIKE_CONFIG.STATUS_IDS.IN_PROGRESS,
  DONE: WRIKE_CONFIG.STATUS_IDS.DONE,
  ARCHIVED: WRIKE_CONFIG.STATUS_IDS.ARCHIVED,
};

// Map Wrike status ID back to dashboard status
export const WRIKE_TO_STATUS: Record<string, RequestStatus> = {
  'IEAGT6KAJMAAAAAA': RequestStatus.SUBMITTED,   // Requested
  'IEAGT6KAJMGFKCLS': RequestStatus.PLANNED,     // In Design
  'IEAGT6KAJMF7ZXTO': RequestStatus.IN_PROGRESS, // In Progress
  'IEAGT6KAJMAAAAAB': RequestStatus.DONE,        // Completed
  'IEAGT6KAJMAAAAAD': RequestStatus.ARCHIVED,    // Cancelled
  // Also map On Hold to ARCHIVED as fallback
  'IEAGT6KAJMAAAAAC': RequestStatus.ARCHIVED,    // On Hold
};

// Map dashboard priority to Wrike priority format
export const PRIORITY_TO_WRIKE: Record<RequestPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Normal',
  HIGH: 'High',
  IMMEDIATE: 'Urgent',
};

// Wrike API Types
export interface WrikeTask {
  id: string;
  accountId: string;
  title: string;
  description?: string;
  briefDescription?: string;
  parentIds: string[];
  superParentIds: string[];
  sharedIds: string[];
  responsibleIds: string[];
  status: string;
  importance: string;
  createdDate: string;
  updatedDate: string;
  dates?: {
    type: string;
    duration?: number;
    start?: string;
    due?: string;
  };
  scope: string;
  authorIds: string[];
  customStatusId: string;
  hasAttachments: boolean;
  attachmentCount: number;
  permalink: string;
  priority: string;
  followedByMe: boolean;
  followerIds: string[];
  recurrent: boolean;
  superTaskIds: string[];
  subTaskIds: string[];
  dependencyIds: string[];
  metadata: Array<{ key: string; value: string }>;
  customFields?: Array<{ id: string; value: string }>;
}

export interface WrikeComment {
  id: string;
  authorId: string;
  text: string;
  createdDate: string;
  taskId?: string;
  folderId?: string;
}

export interface CreateTaskData {
  title: string;
  description?: string;
  status?: string;
  importance?: string;
  dates?: {
    start?: string;
    due?: string;
  };
  responsibles?: string[];
  followers?: string[];
  follow?: boolean;
  priorityBefore?: string;
  priorityAfter?: string;
  superTasks?: string[];
  metadata?: Array<{ key: string; value: string }>;
  customFields?: Array<{ id: string; value: string }>;
  customStatus?: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  status?: string;
  importance?: string;
  dates?: {
    start?: string;
    due?: string;
  };
  addResponsibles?: string[];
  removeResponsibles?: string[];
  addFollowers?: string[];
  removeFollowers?: string[];
  follow?: boolean;
  priorityBefore?: string;
  priorityAfter?: string;
  addSuperTasks?: string[];
  removeSuperTasks?: string[];
  metadata?: Array<{ key: string; value: string }>;
  customFields?: Array<{ id: string; value: string }>;
  customStatus?: string;
  restore?: boolean;
}

export interface WrikeWebhookEvent {
  taskId: string;
  webhookId: string;
  eventAuthorId: string;
  eventType: 'TaskCreated' | 'TaskDeleted' | 'TaskTitleChanged' | 'TaskStatusChanged' | 'TaskDatesChanged' | 'TaskImportanceChanged' | 'TaskCustomFieldChanged' | 'CommentAdded' | 'CommentDeleted';
  lastUpdatedDate: string;
  // Additional fields based on event type
  newStatusId?: string;
  oldStatusId?: string;
  newTitle?: string;
  oldTitle?: string;
  commentId?: string;
  [key: string]: unknown;
}

export interface WrikeApiResponse<T> {
  kind: string;
  data: T[];
}

export interface WrikeError {
  error: string;
  errorDescription: string;
}

// Dashboards Project Configuration (for dev commit tracking)
// Workflow: Default Workflow (IEAGT6KAK77ZMBWA) — same workflow the Dashboards folder uses
// Status IDs discovered via scripts/discover-dashboards-workflow-v2.ts (real IDs, not placeholders)
// Commit tasks are auto-created by scripts/post-commit-wrike.js
export const DASHBOARDS_WRIKE_CONFIG = {
  FOLDER_ID: 'MQAAAAEEBpOb',        // Dashboards project
  WORKFLOW_ID: 'IEAGT6KAK77ZMBWA',  // Default Workflow

  STATUS_IDS: {
    BACKLOG:     'IEAGT6KAJMAAAAAA', // Requested (Active) — new commit tasks land here
    PLANNED:     'IEAGT6KAJMGFKCLS', // In Design (Active)
    IN_PROGRESS: 'IEAGT6KAJMF7ZXTO', // In Progress (Active)
    DONE:        'IEAGT6KAJMAAAAAB', // Completed (Completed)
    CANCELLED:   'IEAGT6KAJMAAAAAD', // Cancelled (Cancelled)
  },
} as const;
