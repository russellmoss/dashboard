import { RequestStatus, RequestType, RequestPriority } from '@prisma/client';

// Re-export Prisma enums for convenience
export { RequestStatus, RequestType, RequestPriority };

// Dashboard pages constant for the affected page dropdown
export const DASHBOARD_PAGES = [
  { id: 1, name: 'Funnel Performance' },
  { id: 3, name: 'Open Pipeline' },
  { id: 7, name: 'Settings' },
  { id: 8, name: 'SGA Hub' },
  { id: 9, name: 'Explore' },
  { id: 10, name: 'Quarterly Goal Progress' },
  { id: 11, name: 'SGA Management' },
  { id: 12, name: 'Recruiter Hub' },
  { id: 13, name: 'Dashboard Requests' },
] as const;

// Input types for creating/updating requests
export interface CreateRequestInput {
  title: string;
  description: string;
  requestType: RequestType;
  priority?: RequestPriority;
  affectedPage?: string;
  // Data error specific fields
  filtersApplied?: string;
  valueSeen?: string;
  valueExpected?: string;
  errorOccurredAt?: string; // ISO date string
  isPrivate?: boolean;
}

export interface UpdateRequestInput {
  title?: string;
  description?: string;
  priority?: RequestPriority;
  affectedPage?: string;
  filtersApplied?: string;
  valueSeen?: string;
  valueExpected?: string;
  errorOccurredAt?: string;
  isPrivate?: boolean;
}

// Submitter info (minimal user data)
export interface RequestSubmitter {
  id: string;
  name: string;
  email: string;
}

// Comment with author info
export interface RequestCommentWithAuthor {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    email: string;
  };
  wrikeCommentId: string | null;
}

// Attachment info
export interface RequestAttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  data?: string | null; // Base64 encoded file data (not returned in list queries for performance)
  wrikeAttachmentId: string | null;
  wrikeDownloadUrl: string | null;
  createdAt: string;
  uploadedBy: {
    id: string;
    name: string;
  };
}

// Edit history entry
export interface EditHistoryEntry {
  id: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  editedBy: {
    id: string;
    name: string;
  };
}

// Full request with all relations (for detail view)
export interface DashboardRequestFull {
  id: string;
  title: string;
  description: string;
  requestType: RequestType;
  status: RequestStatus;
  priority: RequestPriority | null;
  affectedPage: string | null;
  filtersApplied: string | null;
  valueSeen: string | null;
  valueExpected: string | null;
  errorOccurredAt: string | null;
  isPrivate: boolean;
  wrikeTaskId: string | null;
  wrikePermalink: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string;
  submitterId: string;
  submitter: RequestSubmitter;
  comments: RequestCommentWithAuthor[];
  attachments: RequestAttachmentInfo[];
  editHistory: EditHistoryEntry[];
  _count?: {
    comments: number;
  };
}

// Card view (for Kanban board)
export interface DashboardRequestCard {
  id: string;
  title: string;
  requestType: RequestType;
  status: RequestStatus;
  priority: RequestPriority | null;
  isPrivate: boolean;
  createdAt: string;
  statusChangedAt: string;
  submitter: {
    id: string;
    name: string;
  };
  _count: {
    comments: number;
  };
  latestComment?: {
    content: string;
    createdAt: string;
    author: {
      name: string;
    };
  } | null;
}

// Kanban board data structure
export interface KanbanColumn {
  status: RequestStatus;
  label: string;
  requests: DashboardRequestCard[];
}

export interface KanbanBoardData {
  columns: KanbanColumn[];
  totalCount: number;
}

// Filter options for request list
export interface RequestFilters {
  search?: string;
  requestType?: RequestType;
  priority?: RequestPriority;
  status?: RequestStatus[];
  submitterId?: string;
  dateFrom?: string;
  dateTo?: string;
  includeArchived?: boolean;
}

// Analytics types
export interface RequestAnalytics {
  totalRequests: number;
  averageResolutionDays: number | null;
  thisMonth: {
    featureRequests: number;
    dataErrors: number;
    resolved: number;
  };
  byType: {
    type: RequestType;
    count: number;
  }[];
  byStatus: {
    status: RequestStatus;
    count: number;
  }[];
  byPriority: {
    priority: RequestPriority | null;
    count: number;
  }[];
  recentActivity: {
    submissions: number;
    resolutions: number;
  };
  topSubmitters: {
    name: string;
    count: number;
  }[];
}

// Notification types
export interface RequestNotificationInfo {
  id: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  requestId: string;
  request: {
    id: string;
    title: string;
  };
}

export interface NotificationUnreadCount {
  count: number;
}

// API response types
export interface RequestListResponse {
  requests: DashboardRequestCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KanbanResponse {
  data: KanbanBoardData;
}

export interface RequestDetailResponse {
  request: DashboardRequestFull;
}

export interface CreateRequestResponse {
  request: DashboardRequestFull;
}

export interface UpdateRequestResponse {
  request: DashboardRequestFull;
}

export interface StatusUpdateResponse {
  request: DashboardRequestFull;
  previousStatus: RequestStatus;
}

export interface CommentResponse {
  comment: RequestCommentWithAuthor;
}

export interface NotificationsResponse {
  notifications: RequestNotificationInfo[];
}

// Status display helpers
export const STATUS_LABELS: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
};

export const STATUS_COLORS: Record<RequestStatus, { bg: string; text: string; border: string }> = {
  SUBMITTED: { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' },
  PLANNED: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  IN_PROGRESS: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  DONE: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  ARCHIVED: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
};

export const TYPE_LABELS: Record<RequestType, string> = {
  FEATURE_REQUEST: 'Feature Request',
  DATA_ERROR: 'Data Error',
};

export const TYPE_COLORS: Record<RequestType, { bg: string; text: string }> = {
  FEATURE_REQUEST: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  DATA_ERROR: { bg: 'bg-red-100', text: 'text-red-700' },
};

export const PRIORITY_LABELS: Record<RequestPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  IMMEDIATE: 'Immediate',
};

export const PRIORITY_COLORS: Record<RequestPriority, { bg: string; text: string }> = {
  LOW: { bg: 'bg-slate-100', text: 'text-slate-600' },
  MEDIUM: { bg: 'bg-blue-100', text: 'text-blue-600' },
  HIGH: { bg: 'bg-orange-100', text: 'text-orange-600' },
  IMMEDIATE: { bg: 'bg-red-100', text: 'text-red-600' },
};

// Helper to calculate days in current status
export function getDaysInStatus(statusChangedAt: string): number {
  const changed = new Date(statusChangedAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - changed.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}
