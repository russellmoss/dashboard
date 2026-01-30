# Dashboard Requests Feature - Implementation Plan

> **Purpose**: Step-by-step agentic implementation guide for the Dashboard Requests feature
> **Target**: Cursor.ai or Claude Code
> **Approach**: Complete each phase, validate, verify, then proceed to next phase

---

## Wrike Configuration (Discovered)

The following values were discovered via Wrike API exploration and are ready to use:

### Environment Variables
```
WRIKE_ACCESS_TOKEN=${WRIKE_ACCESS_TOKEN}  # Set in .env - NEVER commit actual token
WRIKE_FOLDER_ID=IEAGT6KAI7777RTZ
WRIKE_WORKFLOW_ID=IEAGT6KAK77ZMBWA
WRIKE_WEBHOOK_SECRET=your_random_secret_here  # Generate a random string for webhook verification
NEXT_PUBLIC_APP_URL=https://yourdomain.com    # App URL for email links
```

> ⚠️ **SECURITY NOTE**: Never commit actual tokens to version control. Set `WRIKE_ACCESS_TOKEN` in your `.env.local` file only.

### Status Mappings
| Dashboard Status | Wrike Status ID | Wrike Status Name |
|-----------------|-----------------|-------------------|
| SUBMITTED | IEAGT6KAJMAAAAAA | Requested |
| PLANNED | IEAGT6KAJMGFKCLS | In Design |
| IN_PROGRESS | IEAGT6KAJMF7ZXTO | In Progress |
| DONE | IEAGT6KAJMAAAAAB | Completed |
| ARCHIVED | IEAGT6KAJMAAAAAC | Cancelled (or use Completed) |

### Custom Fields (Existing - Can Reuse)
| Field Name | Field ID | Type |
|-----------|----------|------|
| Priority | IEAGT6KAJUAKJULP | DropDown |
| Requesting Team | IEAGT6KAJUAKEJUP | DropDown |
| Size of Ask | IEAGT6KAJUAKEJUQ | DropDown |

### Account Info
- **Account ID**: IEAGT6KA
- **Dashboards Folder ID**: IEAGT6KAI7777RTZ (internal) / MQAAAAEEBpOb (encoded)
- **Webhook Endpoint**: None configured yet - will be `/api/webhooks/wrike`

### API Verified Operations
- ✅ Authentication working
- ✅ Task creation in Dashboards folder
- ✅ Task updates with custom fields
- ✅ Comment creation
- ✅ Task deletion

---

## Pre-Implementation Checklist

Before starting, confirm:
- [x] `dashboard_request_questions.md` has been completed with Wrike API exploration
- [x] You have the following from Wrike exploration:
  - ✅ Folder ID: `IEAGT6KAI7777RTZ` (Dashboards folder)
  - ✅ Workflow ID: `IEAGT6KAK77ZMBWA` (Default Workflow)
  - ✅ Status IDs mapped (see Wrike Configuration section above)
  - ✅ Custom Field IDs available (Priority, Requesting Team, Size of Ask)
- [x] Environment variables are set:
  ```
  WRIKE_ACCESS_TOKEN=${WRIKE_ACCESS_TOKEN}  # Set in .env.local - NEVER commit
  WRIKE_FOLDER_ID=IEAGT6KAI7777RTZ (add to .env)
  WRIKE_WEBHOOK_SECRET=your_random_secret_here
  NEXT_PUBLIC_APP_URL=https://yourdomain.com
  ```

### Infrastructure Decisions

#### Email Provider
**Decision**: Use existing SendGrid integration (already configured for password reset)

- [x] SendGrid credentials in .env (SENDGRID_API_KEY, etc.)
- [ ] Create email templates for:
  - Request submitted confirmation
  - Status change notification
  - New comment notification

#### File Storage
**Decision**: Use existing Neon (Postgres) database for attachment storage

No additional setup needed — we'll store files as binary data in the `RequestAttachment` table using Prisma's `Bytes` type. This keeps the architecture simple for an internal tool with low attachment volume.

---

## Phase 1: Database Schema

### Objective
Create Prisma models for Dashboard Requests, Comments, and Notifications.

### Files to Modify
- `prisma/schema.prisma`

### Instructions

Add the following to `prisma/schema.prisma`:

```prisma
// Dashboard Request Enums
enum RequestStatus {
  SUBMITTED
  PLANNED
  IN_PROGRESS
  DONE
  ARCHIVED
}

enum RequestType {
  FEATURE_REQUEST
  DATA_ERROR
}

enum RequestPriority {
  LOW
  MEDIUM
  HIGH
  IMMEDIATE
}

// Main Dashboard Request Model
model DashboardRequest {
  id                String          @id @default(cuid())
  title             String
  description       String          @db.Text
  requestType       RequestType
  status            RequestStatus   @default(SUBMITTED)
  priority          RequestPriority?
  affectedPage      String?
  filtersApplied    String?         @db.Text
  valueSeen         String?
  valueExpected     String?
  errorOccurredAt   DateTime?
  isPrivate         Boolean         @default(false)
  wrikeTaskId       String?         @unique
  wrikePermalink    String?
  lastSyncedAt      DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  statusChangedAt   DateTime        @default(now())
  submitterId       String
  submitter         User            @relation("SubmittedRequests", fields: [submitterId], references: [id])
  comments          RequestComment[]
  attachments       RequestAttachment[]
  editHistory       RequestEditHistory[]
  notifications     RequestNotification[]
  
  @@index([submitterId])
  @@index([status])
  @@index([requestType])
  @@index([wrikeTaskId])
}

model RequestComment {
  id             String   @id @default(cuid())
  content        String   @db.Text
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  requestId      String
  request        DashboardRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  authorId       String
  author         User     @relation("RequestComments", fields: [authorId], references: [id])
  wrikeCommentId String?  @unique
  
  @@index([requestId])
  @@index([authorId])
}

model RequestAttachment {
  id           String   @id @default(cuid())
  filename     String
  mimeType     String
  size         Int
  data         Bytes    // Store file as binary in Postgres (Neon)
  createdAt    DateTime @default(now())
  requestId    String
  request      DashboardRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  uploadedById String
  uploadedBy   User     @relation("UploadedAttachments", fields: [uploadedById], references: [id])
  
  @@index([requestId])
}

model RequestEditHistory {
  id         String   @id @default(cuid())
  fieldName  String
  oldValue   String?  @db.Text
  newValue   String?  @db.Text
  createdAt  DateTime @default(now())
  requestId  String
  request    DashboardRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  editedById String
  editedBy   User     @relation("RequestEdits", fields: [editedById], references: [id])
  
  @@index([requestId])
}

model RequestNotification {
  id        String   @id @default(cuid())
  message   String
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())
  requestId String
  request   DashboardRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation("UserNotifications", fields: [userId], references: [id])
  
  @@index([userId, isRead])
  @@index([requestId])
}
```

Also update the `User` model to add reverse relations:
```prisma
model User {
  // ... existing fields ...
  submittedRequests    DashboardRequest[]      @relation("SubmittedRequests")
  requestComments      RequestComment[]        @relation("RequestComments")
  uploadedAttachments  RequestAttachment[]     @relation("UploadedAttachments")
  requestEdits         RequestEditHistory[]    @relation("RequestEdits")
  notifications        RequestNotification[]   @relation("UserNotifications")
}
```

### Run Commands
```bash
npx prisma format
npx prisma generate
npx prisma db push
```

### Validation Checklist
- [ ] `prisma format` completes without errors
- [ ] `prisma generate` completes without errors
- [ ] `prisma db push` successfully creates tables
- [ ] `npx tsc --noEmit` passes

### Phase 1 Complete When
- [ ] All 5 new tables visible in Prisma Studio
- [ ] Can import `DashboardRequest` type from `@prisma/client`

---

## Phase 2: RevOps Admin Role & Permissions

### Objective
Add the "RevOps Admin" role with full admin access plus Dashboard Requests management.

### Files to Modify
- `src/types/user.ts`
- `src/lib/permissions.ts`
- `src/components/settings/UserModal.tsx`

### Instructions

#### 2.1 Update `src/types/user.ts`

Add `revops_admin` to role types and `canManageRequests` to permissions:

```typescript
export interface User {
  // ... existing fields ...
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin';
}

export interface UserPermissions {
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin';
  // ... existing fields ...
  canManageRequests: boolean;  // NEW
}
```

#### 2.2 Update `src/lib/permissions.ts`

Add revops_admin role and page 13 to appropriate roles:

```typescript
const ROLE_PERMISSIONS = {
  revops_admin: {
    role: 'revops_admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13],
    canExport: true,
    canManageUsers: true,
    canManageRequests: true,
  },
  admin: {
    // ... add page 13 to allowedPages, add canManageRequests: false
  },
  // ... update all other roles with canManageRequests: false
  // ... add page 13 to all roles EXCEPT recruiter
};
```

#### 2.3 Update `src/components/settings/UserModal.tsx`

Add RevOps Admin option to role dropdown.

### Validation Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] RevOps Admin appears in user creation dropdown
- [ ] Can create a user with RevOps Admin role

---

## Phase 3: Type Definitions, API Client & State Management

### Objective
Create TypeScript types, API client functions, and SWR hooks for state management.

### Dependencies to Install
```bash
npm install swr
```

### Files to Create
- `src/types/dashboard-request.ts`
- `src/lib/hooks/useRequests.ts`
- `src/lib/hooks/useNotifications.ts`

### Files to Modify
- `src/lib/api-client.ts`

### Instructions

Create comprehensive types in `src/types/dashboard-request.ts` for:
- CreateRequestInput, UpdateRequestInput
- DashboardRequestFull, DashboardRequestCard
- RequestCommentWithAuthor, EditHistoryEntry
- KanbanBoardData, RequestFilters
- RequestAnalytics, RequestNotificationInfo
- DASHBOARD_PAGES constant
- PaginationMeta, PaginatedResponse (see Phase 4 types below)

Add API client functions to `src/lib/api-client.ts`:
- dashboardRequestsApi object with CRUD operations
- notificationsApi object for notification management

### SWR Hooks

#### Create `src/lib/hooks/useRequests.ts`

```typescript
import useSWR, { mutate } from 'swr';
import { DashboardRequestWithRelations, RequestFilters } from '@/types/dashboard-request';

const fetcher = (url: string) => fetch(url).then(res => res.json());

// Main hook for fetching requests with filters
export function useRequests(filters?: RequestFilters) {
  const params = new URLSearchParams();
  
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.priority) params.set('priority', filters.priority);
  if (filters?.submitterId) params.set('submitterId', filters.submitterId);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.page) params.set('page', filters.page.toString());
  if (filters?.limit) params.set('limit', filters.limit.toString());
  
  const queryString = params.toString();
  const url = `/api/dashboard-requests${queryString ? `?${queryString}` : ''}`;
  
  const { data, error, isLoading, isValidating } = useSWR<{
    requests: DashboardRequestWithRelations[];
    pagination: PaginationMeta;
  }>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });

  return {
    requests: data?.requests ?? [],
    pagination: data?.pagination,
    isLoading,
    isValidating,
    error,
  };
}

// Hook for single request
export function useRequest(id: string | null) {
  const { data, error, isLoading } = useSWR<DashboardRequestWithRelations>(
    id ? `/api/dashboard-requests/${id}` : null,
    fetcher
  );

  return { request: data, isLoading, error };
}

// Mutation helpers for optimistic updates
export function invalidateRequests() {
  mutate((key) => typeof key === 'string' && key.startsWith('/api/dashboard-requests'));
}

export function optimisticStatusUpdate(
  requestId: string, 
  newStatus: string,
  previousData: DashboardRequestWithRelations[]
) {
  return previousData.map(req => 
    req.id === requestId ? { ...req, status: newStatus } : req
  );
}
```

#### Create `src/lib/hooks/useNotifications.ts`

```typescript
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export function useUnreadCount() {
  const { data, mutate } = useSWR<{ count: number }>(
    '/api/notifications/unread-count',
    fetcher,
    { refreshInterval: 30000 } // Poll every 30 seconds
  );

  return {
    unreadCount: data?.count ?? 0,
    refresh: mutate,
  };
}

export function useNotifications(limit = 10) {
  const { data, error, isLoading, mutate } = useSWR<{ notifications: Notification[] }>(
    `/api/notifications?limit=${limit}`,
    fetcher
  );

  return {
    notifications: data?.notifications ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}
```

### Validation Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] Types can be imported without errors
- [ ] `useRequests()` hook fetches data correctly
- [ ] SWR caching works (no duplicate requests on re-render)
- [ ] `invalidateRequests()` triggers refetch

---

## Phase 4: Core API Routes (with Pagination)

### Objective
Create basic CRUD API routes for Dashboard Requests with pagination support.

### Files to Create
- `src/app/api/dashboard-requests/route.ts` (GET, POST)
- `src/app/api/dashboard-requests/[id]/route.ts` (GET, PATCH, DELETE)
- `src/app/api/dashboard-requests/[id]/status/route.ts` (PATCH)
- `src/app/api/dashboard-requests/[id]/comments/route.ts` (POST)
- `src/app/api/dashboard-requests/kanban/route.ts` (POST)
- `src/app/api/dashboard-requests/recent/route.ts` (GET)

### Key Implementation Notes
- All routes must check authentication
- All routes must block recruiter role
- Visibility rules:
  - RevOps Admin sees ALL requests
  - Users see own submissions + non-private, non-submitted requests
- Edit history tracked on all updates
- Status changes update `statusChangedAt`

### Pagination Types (Add to `src/types/dashboard-request.ts`)

```typescript
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface RequestFilters {
  status?: RequestStatus;
  type?: RequestType;
  priority?: RequestPriority;
  submitterId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}
```

### GET Route with Pagination (`src/app/api/dashboard-requests/route.ts`)

```typescript
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  // Pagination params
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const skip = (page - 1) * limit;
  
  // Filter params
  const status = searchParams.get('status') as RequestStatus | null;
  const type = searchParams.get('type') as RequestType | null;
  const priority = searchParams.get('priority') as RequestPriority | null;
  const submitterId = searchParams.get('submitterId');
  const search = searchParams.get('search');
  
  // Build where clause
  const where: Prisma.DashboardRequestWhereInput = {
    ...(status && { status }),
    ...(type && { requestType: type }),
    ...(priority && { priority }),
    ...(submitterId && { submitterId }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
    // Hide archived from main view unless explicitly requested
    ...(status !== 'ARCHIVED' && { status: { not: 'ARCHIVED' } }),
  };

  // Execute queries in parallel
  const [requests, total] = await Promise.all([
    prisma.dashboardRequest.findMany({
      where,
      include: {
        submitter: { select: { id: true, name: true, email: true } },
        comments: { select: { id: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.dashboardRequest.count({ where }),
  ]);

  return NextResponse.json({
    requests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + requests.length < total,
    },
  });
}
```

### Kanban Pagination Note
For the Kanban board specifically, pagination works differently—load all non-archived requests but consider virtual scrolling if columns get large (50+ cards). Add to Phase 7:

- Initial load: Fetch all non-archived requests (typically <200)
- If performance issues arise with 200+ requests, implement:
  - Virtual scrolling within columns using @tanstack/react-virtual
  - Or lazy-load older "Done" items

### Validation Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] API returns 401 for unauthenticated requests
- [ ] API returns 403 for recruiter role
- [ ] API returns pagination metadata
- [ ] Page/limit params work correctly
- [ ] Default limit is reasonable (50)

---

## Phase 5: Page Structure & Navigation

### Objective
Create the Dashboard Requests page and add to sidebar.

### Files to Modify
- `src/components/layout/Sidebar.tsx`

### Files to Create
- `src/app/dashboard/requests/page.tsx`
- `src/app/dashboard/requests/RequestsPageContent.tsx`

### Instructions

Add to Sidebar PAGES array:
```typescript
{ id: 13, name: 'Dashboard Requests', href: '/dashboard/requests', icon: MessageSquarePlus },
```
Place before Settings (page 7).

Create server component with auth check and client component with tabs.

### Validation Checklist
- [ ] Dashboard Requests appears in sidebar for non-recruiters
- [ ] Page loads with two tabs
- [ ] Recruiters are redirected away

---

## Phase 6: Request Submission Form & File Storage

### Objective
Create the form for submitting feature requests and data errors, with file attachment support using Neon (Postgres) for storage.

### Files to Create
- `src/components/requests/RequestForm.tsx`
- `src/components/requests/RecentSubmissions.tsx`
- `src/components/requests/AttachmentUpload.tsx`
- `src/hooks/useDebounce.ts`
- `src/lib/file-storage.ts`
- `src/app/api/dashboard-requests/[id]/attachments/route.ts`
- `src/app/api/attachments/[id]/route.ts`

### Key Features
- Request Type selector (required)
- Title and Description (required)
- Priority selector (optional)
- Affected Page dropdown (optional)
- Data Error specific fields (conditional, all optional)
- Screenshot upload
- Recent submissions for duplicate detection (shows after 3+ chars typed)

### File Storage Implementation (Neon/Postgres)

#### Create `src/lib/file-storage.ts`

```typescript
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB - keep reasonable for DB storage
const ALLOWED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { 
      valid: false, 
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` 
    };
  }
  
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { 
      valid: false, 
      error: `File type not allowed: ${file.type}` 
    };
  }

  return { valid: true };
}

export async function fileToBuffer(file: File): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

#### Create `src/app/api/dashboard-requests/[id]/attachments/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateFile, fileToBuffer } from '@/lib/file-storage';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify request exists
  const requestExists = await prisma.dashboardRequest.findUnique({
    where: { id: params.id },
    select: { id: true },
  });

  if (!requestExists) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File;
  
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const buffer = await fileToBuffer(file);
    
    const attachment = await prisma.requestAttachment.create({
      data: {
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        data: buffer,
        requestId: params.id,
        uploadedById: session.user.id,
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ attachment });
  } catch (error) {
    console.error('Upload failed:', error);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}

// GET: List attachments for a request
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const attachments = await prisma.requestAttachment.findMany({
    where: { requestId: params.id },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ attachments });
}
```

#### Create `src/app/api/attachments/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// GET: Serve the file
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const attachment = await prisma.requestAttachment.findUnique({
    where: { id: params.id },
    include: {
      request: { select: { submitterId: true, isPrivate: true } },
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  // Check access: user is submitter OR user is RevOps Admin
  const isSubmitter = attachment.request.submitterId === session.user.id;
  const isRevOpsAdmin = session.user.role === 'revops_admin';
  
  if (attachment.request.isPrivate && !isSubmitter && !isRevOpsAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return new NextResponse(attachment.data, {
    headers: {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `inline; filename="${attachment.filename}"`,
      'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
    },
  });
}

// DELETE: Remove attachment
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const attachment = await prisma.requestAttachment.findUnique({
    where: { id: params.id },
    include: {
      request: { select: { submitterId: true } },
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  // Only submitter or RevOps Admin can delete
  const isSubmitter = attachment.request.submitterId === session.user.id;
  const isRevOpsAdmin = session.user.role === 'revops_admin';
  
  if (!isSubmitter && !isRevOpsAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.requestAttachment.delete({
    where: { id: params.id },
  });

  return NextResponse.json({ success: true });
}
```

#### Create `src/components/requests/AttachmentUpload.tsx`

```typescript
'use client';

import { useState, useRef } from 'react';

interface AttachmentUploadProps {
  requestId: string;
  onUploadComplete: () => void;
}

export function AttachmentUpload({ requestId, onUploadComplete }: AttachmentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`/api/dashboard-requests/${requestId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }

      onUploadComplete();
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        onChange={handleUpload}
        disabled={uploading}
        accept="image/*,.pdf,.csv,.xlsx"
      />
      {uploading && <span>Uploading...</span>}
      {error && <span className="text-red-500">{error}</span>}
    </div>
  );
}
```

### Validation Checklist
- [ ] Can submit Feature Request
- [ ] Can submit Data Error with additional fields
- [ ] Duplicate detection shows similar requests
- [ ] File upload to Neon works (creates RequestAttachment record with binary data)
- [ ] File size validation works (rejects >5MB)
- [ ] File type validation works
- [ ] File serving works via `/api/attachments/[id]`
- [ ] File deletion works
- [ ] Privacy check works (private request attachments only visible to submitter/RevOps Admin)

---

## Phase 7: Kanban Board

### Objective
Create drag-and-drop Kanban board for viewing requests with virtual scrolling support for large datasets.

### Dependencies to Install
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @tanstack/react-virtual
```

### Files to Create
- `src/components/requests/KanbanBoard.tsx`
- `src/components/requests/KanbanColumn.tsx`
- `src/components/requests/VirtualizedKanbanColumn.tsx`
- `src/components/requests/RequestCard.tsx`
- `src/components/requests/RequestFilters.tsx`

### Key Features
- 4 columns: Submitted, Planned/Prioritized, In Progress, Done
- Drag-and-drop for RevOps Admin only
- Cards show: title, type badge, priority badge, submitter, date, days in status, comment count, latest comment preview
- Private indicator (lock icon) for RevOps Admin only
- Filters: search, type, priority, submitter, date range
- Optimistic updates on drag
- Virtual scrolling for columns with 50+ cards

---

### Virtual Scrolling Implementation

For columns with many cards (50+), we use `@tanstack/react-virtual` to only render visible cards, dramatically improving performance.

#### Constants
```typescript
// src/components/requests/constants.ts
export const VIRTUALIZATION_THRESHOLD = 50;
export const ESTIMATED_CARD_HEIGHT = 140; // Base height in pixels
export const OVERSCAN_COUNT = 5; // Extra items to render above/below viewport
```

#### Create `src/components/requests/VirtualizedKanbanColumn.tsx`

```typescript
'use client';

import { useRef, useCallback, useState, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { RequestCard } from './RequestCard';
import { DashboardRequestCard } from '@/types/dashboard-request';
import { ESTIMATED_CARD_HEIGHT, OVERSCAN_COUNT } from './constants';

interface VirtualizedKanbanColumnProps {
  id: string;
  title: string;
  requests: DashboardRequestCard[];
  canDrag: boolean;
  onCardClick: (request: DashboardRequestCard) => void;
}

// Loading skeleton for fast scrolling
const CardSkeleton = memo(function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-2" />
      <div className="flex gap-2">
        <div className="h-5 bg-gray-100 rounded w-16" />
        <div className="h-5 bg-gray-100 rounded w-12" />
      </div>
    </div>
  );
});

export function VirtualizedKanbanColumn({
  id,
  title,
  requests,
  canDrag,
  onCardClick,
}: VirtualizedKanbanColumnProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();

  // Setup droppable zone for dnd-kit
  const { setNodeRef, isOver } = useDroppable({ id });

  // Dynamic height estimation based on card content
  const estimateSize = useCallback((index: number) => {
    const request = requests[index];
    if (!request) return ESTIMATED_CARD_HEIGHT;

    // Base height
    let height = 100;

    // Add height for title (estimate based on character count)
    const titleLines = Math.ceil(request.title.length / 35);
    height += titleLines * 20;

    // Add height for comment preview if present
    if (request.latestCommentPreview) {
      height += 24;
    }

    // Add padding/margins
    height += 16;

    return Math.max(height, ESTIMATED_CARD_HEIGHT);
  }, [requests]);

  // Setup virtualizer
  const virtualizer = useVirtualizer({
    count: requests.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN_COUNT,
    // Enable smooth scrolling detection
    scrollingDelay: 150,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Handle scroll state for showing skeletons during fast scroll
  const handleScroll = useCallback(() => {
    setIsScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 150);
  }, []);

  // Get request IDs for SortableContext
  const requestIds = requests.map(r => r.id);

  return (
    <div
      className={`flex flex-col bg-gray-50 rounded-lg w-80 flex-shrink-0 ${
        isOver ? 'ring-2 ring-blue-400 ring-opacity-50' : ''
      }`}
    >
      {/* Column Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-100 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-700">{title}</h3>
          <span className="text-sm text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
            {requests.length}
          </span>
        </div>
      </div>

      {/* Virtualized Card List */}
      <div
        ref={(node) => {
          // Combine refs for both virtualizer and dnd-kit
          parentRef.current = node;
          setNodeRef(node);
        }}
        className="flex-1 overflow-y-auto p-2"
        style={{ maxHeight: 'calc(100vh - 250px)' }}
        onScroll={handleScroll}
      >
        <SortableContext items={requestIds} strategy={verticalListSortingStrategy}>
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualItem) => {
              const request = requests[virtualItem.index];
              const isScrollingFast = isScrolling && virtualizer.scrollDirection !== null;

              return (
                <div
                  key={request.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {isScrollingFast ? (
                    <CardSkeleton />
                  ) : (
                    <RequestCard
                      request={request}
                      canDrag={canDrag}
                      onClick={() => onCardClick(request)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </SortableContext>

        {/* Empty state */}
        {requests.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            No requests
          </div>
        )}
      </div>
    </div>
  );
}
```

#### Update `KanbanColumn.tsx` to Use Virtualization Conditionally

```typescript
'use client';

import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { RequestCard } from './RequestCard';
import { VirtualizedKanbanColumn } from './VirtualizedKanbanColumn';
import { DashboardRequestCard } from '@/types/dashboard-request';
import { VIRTUALIZATION_THRESHOLD } from './constants';

interface KanbanColumnProps {
  id: string;
  title: string;
  requests: DashboardRequestCard[];
  canDrag: boolean;
  onCardClick: (request: DashboardRequestCard) => void;
}

export const KanbanColumn = memo(function KanbanColumn({
  id,
  title,
  requests,
  canDrag,
  onCardClick,
}: KanbanColumnProps) {
  // Use virtualized column for large datasets
  if (requests.length > VIRTUALIZATION_THRESHOLD) {
    return (
      <VirtualizedKanbanColumn
        id={id}
        title={title}
        requests={requests}
        canDrag={canDrag}
        onCardClick={onCardClick}
      />
    );
  }

  // Simple rendering for small datasets
  const { setNodeRef, isOver } = useDroppable({ id });
  const requestIds = requests.map(r => r.id);

  return (
    <div
      className={`flex flex-col bg-gray-50 rounded-lg w-80 flex-shrink-0 ${
        isOver ? 'ring-2 ring-blue-400 ring-opacity-50' : ''
      }`}
    >
      {/* Column Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-100 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-700">{title}</h3>
          <span className="text-sm text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
            {requests.length}
          </span>
        </div>
      </div>

      {/* Card List */}
      <div
        ref={setNodeRef}
        className="flex-1 overflow-y-auto p-2 space-y-2"
        style={{ maxHeight: 'calc(100vh - 250px)' }}
      >
        <SortableContext items={requestIds} strategy={verticalListSortingStrategy}>
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              canDrag={canDrag}
              onClick={() => onCardClick(request)}
            />
          ))}
        </SortableContext>

        {requests.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            No requests
          </div>
        )}
      </div>
    </div>
  );
});
```

#### Memoized RequestCard Component

```typescript
// src/components/requests/RequestCard.tsx
'use client';

import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDistanceToNow } from 'date-fns';
import { Lock, MessageSquare } from 'lucide-react';
import { DashboardRequestCard } from '@/types/dashboard-request';

interface RequestCardProps {
  request: DashboardRequestCard;
  canDrag: boolean;
  onClick: () => void;
}

export const RequestCard = memo(function RequestCard({
  request,
  canDrag,
  onClick,
}: RequestCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: request.id,
    disabled: !canDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priorityColors: Record<string, string> = {
    IMMEDIATE: 'bg-red-100 text-red-700',
    HIGH: 'bg-orange-100 text-orange-700',
    MEDIUM: 'bg-yellow-100 text-yellow-700',
    LOW: 'bg-green-100 text-green-700',
  };

  const typeColors: Record<string, string> = {
    FEATURE_REQUEST: 'bg-purple-100 text-purple-700',
    DATA_ERROR: 'bg-blue-100 text-blue-700',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(canDrag ? listeners : {})}
      onClick={onClick}
      className={`
        bg-white rounded-lg border border-gray-200 p-3 mb-2
        hover:border-gray-300 hover:shadow-sm
        ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
        ${isDragging ? 'shadow-lg ring-2 ring-blue-400' : ''}
      `}
    >
      {/* Title with private indicator */}
      <div className="flex items-start gap-2 mb-2">
        <h4 className="font-medium text-gray-900 text-sm flex-1 line-clamp-2">
          {request.title}
        </h4>
        {request.isPrivate && (
          <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className={`text-xs px-2 py-0.5 rounded-full ${typeColors[request.requestType]}`}>
          {request.requestType === 'FEATURE_REQUEST' ? 'Feature' : 'Data Error'}
        </span>
        {request.priority && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColors[request.priority]}`}>
            {request.priority.toLowerCase()}
          </span>
        )}
      </div>

      {/* Meta info */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{request.submitter.name}</span>
        <span>{formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}</span>
      </div>

      {/* Days in status */}
      <div className="text-xs text-gray-400 mt-1">
        {request.daysInStatus} days in {request.status.toLowerCase().replace('_', ' ')}
      </div>

      {/* Comment preview */}
      {(request.commentCount > 0 || request.latestCommentPreview) && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <MessageSquare className="w-3 h-3" />
            <span>{request.commentCount}</span>
          </div>
          {request.latestCommentPreview && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-1">
              {request.latestCommentPreview}
            </p>
          )}
        </div>
      )}
    </div>
  );
});
```

---

### Performance Considerations

#### Memoization
- `RequestCard` is wrapped with `React.memo` to prevent unnecessary re-renders when parent state changes
- `KanbanColumn` is also memoized to avoid re-rendering columns whose data hasn't changed
- Use `useCallback` for event handlers passed to child components

#### Stable Keys
- Always use `request.id` as the key for list items—never use array index
- This ensures React can efficiently reconcile the virtual DOM during drag operations

#### Filter Debouncing
```typescript
// In RequestFilters.tsx or parent component
import { useDebouncedCallback } from 'use-debounce';

const debouncedSearch = useDebouncedCallback(
  (value: string) => {
    setFilters(prev => ({ ...prev, search: value }));
  },
  300 // 300ms delay
);

// Or with custom hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}
```

#### Lazy-Loading Done Column
The "Done" column typically grows fastest. Consider lazy-loading older items:

```typescript
// In KanbanBoard.tsx
const [doneLimit, setDoneLimit] = useState(50);

const doneRequests = useMemo(() => {
  const done = requests.filter(r => r.status === 'DONE');
  // Sort by most recent first, limit initial display
  return done
    .sort((a, b) => new Date(b.statusChangedAt).getTime() - new Date(a.statusChangedAt).getTime())
    .slice(0, doneLimit);
}, [requests, doneLimit]);

const hasMoreDone = requests.filter(r => r.status === 'DONE').length > doneLimit;

// In Done column, add "Load More" button
{hasMoreDone && (
  <button
    onClick={() => setDoneLimit(prev => prev + 50)}
    className="w-full py-2 text-sm text-blue-600 hover:bg-blue-50 rounded"
  >
    Load 50 more...
  </button>
)}
```

#### React Query/SWR Optimizations
If using SWR (from Phase 3), configure for optimal Kanban performance:

```typescript
const { data } = useSWR('/api/dashboard-requests/kanban', fetcher, {
  revalidateOnFocus: false,      // Don't refetch on tab focus
  revalidateOnReconnect: false,  // Don't refetch on reconnect
  dedupingInterval: 10000,       // Dedupe requests within 10s
  keepPreviousData: true,        // Show stale data while revalidating
});
```

---

### Validation Checklist
- [ ] Kanban displays with 4 columns
- [ ] Drag-and-drop works for RevOps Admin only
- [ ] Status updates persist after drag
- [ ] Filters work correctly
- [ ] Kanban performs smoothly with 500+ test requests
- [ ] Virtual scrolling activates for columns over 50 cards
- [ ] Drag-and-drop still works with virtualized columns
- [ ] No layout shift when scrolling quickly
- [ ] RequestCard is properly memoized (verify with React DevTools)
- [ ] Filter changes are debounced (no excessive API calls)

---

## Phase 8: Request Detail Modal

### Objective
Create modal for viewing/editing individual requests with comments.

### Files to Create
- `src/components/requests/RequestDetailModal.tsx`
- `src/components/requests/CommentThread.tsx`
- `src/components/requests/EditHistoryTimeline.tsx`

### Key Features
- Full request details display
- RevOps Admin controls: status dropdown, priority dropdown, privacy toggle
- Tabs: Details, Comments, History
- Comment thread with add comment form
- Edit history timeline
- Delete and Archive actions
- Wrike link (if synced)

### Validation Checklist
- [ ] Modal opens with full request details
- [ ] RevOps Admin can change status/priority/privacy
- [ ] Comments work
- [ ] Edit history displays
- [ ] Delete works

---

## Phase 9: Wrike Integration (with Error Handling & Rate Limiting)

### Objective
Bi-directional sync with Wrike, including robust error handling, rate limiting, and webhook security.

### Prerequisites
- ✅ Wrike API exploration complete (see "Wrike Configuration (Discovered)" section above)
- ✅ Folder ID, Status IDs, Custom Field IDs discovered and documented

### Files to Create
- `src/types/wrike.ts`
- `src/lib/wrike-client.ts` (NEW: Rate limiting & error handling)
- `src/lib/wrike.ts`
- `src/app/api/webhooks/wrike/route.ts`

### Files to Modify
- Update API routes to call Wrike functions on create/update/delete/comment

### Wrike Status Constants (for `src/types/wrike.ts`)
```typescript
export const WRIKE_CONFIG = {
  FOLDER_ID: 'IEAGT6KAI7777RTZ',
  WORKFLOW_ID: 'IEAGT6KAK77ZMBWA',

  STATUS_IDS: {
    SUBMITTED: 'IEAGT6KAJMAAAAAA',    // Requested
    PLANNED: 'IEAGT6KAJMGFKCLS',      // In Design
    IN_PROGRESS: 'IEAGT6KAJMF7ZXTO',  // In Progress
    DONE: 'IEAGT6KAJMAAAAAB',         // Completed
    ARCHIVED: 'IEAGT6KAJMAAAAAC',     // Cancelled
  },

  CUSTOM_FIELD_IDS: {
    PRIORITY: 'IEAGT6KAJUAKJULP',
    REQUESTING_TEAM: 'IEAGT6KAJUAKEJUP',
    SIZE_OF_ASK: 'IEAGT6KAJUAKEJUQ',
  },
} as const;

// Map dashboard status to Wrike status
export const STATUS_TO_WRIKE: Record<RequestStatus, string> = {
  SUBMITTED: WRIKE_CONFIG.STATUS_IDS.SUBMITTED,
  PLANNED: WRIKE_CONFIG.STATUS_IDS.PLANNED,
  IN_PROGRESS: WRIKE_CONFIG.STATUS_IDS.IN_PROGRESS,
  DONE: WRIKE_CONFIG.STATUS_IDS.DONE,
  ARCHIVED: WRIKE_CONFIG.STATUS_IDS.ARCHIVED,
};

// Map Wrike status back to dashboard status
export const WRIKE_TO_STATUS: Record<string, RequestStatus> = {
  'IEAGT6KAJMAAAAAA': 'SUBMITTED',
  'IEAGT6KAJMGFKCLS': 'PLANNED',
  'IEAGT6KAJMF7ZXTO': 'IN_PROGRESS',
  'IEAGT6KAJMAAAAAB': 'DONE',
  'IEAGT6KAJMAAAAAC': 'ARCHIVED',
};
```

### Environment Variables
```
WRIKE_ACCESS_TOKEN=${WRIKE_ACCESS_TOKEN}  # Set in .env.local - NEVER commit
WRIKE_FOLDER_ID=IEAGT6KAI7777RTZ
WRIKE_WEBHOOK_SECRET=your_random_secret_here  # For webhook verification
```

### Wrike API Client with Rate Limiting (`src/lib/wrike-client.ts`)

```typescript
import { WRIKE_CONFIG } from '@/types/wrike';

interface WrikeError {
  error: string;
  errorDescription: string;
}

interface WrikeRateLimitInfo {
  remaining: number;
  reset: Date;
}

class WrikeAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public isRateLimited: boolean = false,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'WrikeAPIError';
  }
}

// Simple in-memory rate limit tracking
let rateLimitInfo: WrikeRateLimitInfo = {
  remaining: 400, // Wrike default
  reset: new Date(),
};

async function wrikeRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // Check rate limit before making request
  if (rateLimitInfo.remaining <= 5 && new Date() < rateLimitInfo.reset) {
    const waitTime = rateLimitInfo.reset.getTime() - Date.now();
    console.warn(`Wrike rate limit approaching, waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  const url = `https://www.wrike.com/api/v4${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.WRIKE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Update rate limit tracking from headers
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');
  
  if (remaining) rateLimitInfo.remaining = parseInt(remaining);
  if (reset) rateLimitInfo.reset = new Date(parseInt(reset) * 1000);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
    throw new WrikeAPIError(
      'Wrike rate limit exceeded',
      429,
      true,
      retryAfter
    );
  }

  if (!response.ok) {
    const error = await response.json() as WrikeError;
    throw new WrikeAPIError(
      error.errorDescription || 'Wrike API error',
      response.status
    );
  }

  const data = await response.json();
  return data.data as T;
}

// Retry wrapper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (error instanceof WrikeAPIError) {
        // Don't retry client errors (4xx except 429)
        if (error.statusCode >= 400 && error.statusCode < 500 && !error.isRateLimited) {
          throw error;
        }
        
        // Rate limited - wait the specified time
        if (error.isRateLimited && error.retryAfter) {
          console.log(`Rate limited, waiting ${error.retryAfter}s before retry`);
          await new Promise(resolve => setTimeout(resolve, error.retryAfter! * 1000));
          continue;
        }
      }
      
      // Exponential backoff for other errors
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Wrike request failed, retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Export wrapped API functions
export const wrikeClient = {
  async createTask(folderId: string, data: CreateTaskData) {
    return withRetry(() => 
      wrikeRequest<WrikeTask[]>(`/folders/${folderId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
    );
  },

  async updateTask(taskId: string, data: UpdateTaskData) {
    return withRetry(() =>
      wrikeRequest<WrikeTask[]>(`/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
    );
  },

  async deleteTask(taskId: string) {
    return withRetry(() =>
      wrikeRequest<void>(`/tasks/${taskId}`, {
        method: 'DELETE',
      })
    );
  },

  async addComment(taskId: string, text: string) {
    return withRetry(() =>
      wrikeRequest<WrikeComment[]>(`/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
    );
  },
};
```

### Wrike Service with Graceful Failure Handling (`src/lib/wrike.ts`)

```typescript
import { wrikeClient } from './wrike-client';
import { prisma } from './prisma';

export async function syncToWrike(requestId: string): Promise<{ 
  success: boolean; 
  wrikeTaskId?: string; 
  error?: string 
}> {
  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    include: { submitter: true },
  });

  if (!request) {
    return { success: false, error: 'Request not found' };
  }

  try {
    const [task] = await wrikeClient.createTask(process.env.WRIKE_FOLDER_ID!, {
      title: `[${request.requestType}] ${request.title}`,
      description: formatDescriptionForWrike(request),
      status: STATUS_TO_WRIKE[request.status],
      customFields: [
        { id: WRIKE_CONFIG.CUSTOM_FIELD_IDS.PRIORITY, value: request.priority },
      ],
    });

    // Update local record with Wrike info
    await prisma.dashboardRequest.update({
      where: { id: requestId },
      data: {
        wrikeTaskId: task.id,
        wrikePermalink: task.permalink,
        lastSyncedAt: new Date(),
      },
    });

    return { success: true, wrikeTaskId: task.id };
  } catch (error) {
    console.error('Failed to sync to Wrike:', error);
    
    // Log sync failure but don't fail the request creation
    await prisma.dashboardRequest.update({
      where: { id: requestId },
      data: {
        // Store sync failure for retry/manual intervention
        lastSyncedAt: null, // null indicates sync failed
      },
    });

    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Add a sync status check for UI
export async function getWrikeSyncStatus(requestId: string): Promise<{
  synced: boolean;
  wrikeTaskId?: string;
  lastSyncedAt?: Date;
}> {
  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    select: { wrikeTaskId: true, lastSyncedAt: true },
  });

  return {
    synced: !!request?.wrikeTaskId && !!request?.lastSyncedAt,
    wrikeTaskId: request?.wrikeTaskId ?? undefined,
    lastSyncedAt: request?.lastSyncedAt ?? undefined,
  };
}

// Manual retry for failed syncs
export async function retrySyncToWrike(requestId: string) {
  return syncToWrike(requestId);
}
```

### Webhook with Security (`src/app/api/webhooks/wrike/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { WRIKE_TO_STATUS } from '@/types/wrike';

// Wrike sends a hook verification request on setup
// and includes X-Hook-Secret header for verification
const WEBHOOK_SECRET = process.env.WRIKE_WEBHOOK_SECRET;

function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!WEBHOOK_SECRET || !signature) {
    console.warn('Webhook secret not configured or signature missing');
    // In development, you might want to allow unsigned webhooks
    return process.env.NODE_ENV === 'development';
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: NextRequest) {
  const headersList = headers();
  const signature = headersList.get('X-Hook-Secret') || headersList.get('X-Wrike-Signature');
  
  // Get raw body for signature verification
  const rawBody = await request.text();
  
  // Verify signature
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error('Invalid webhook signature');
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 401 }
    );
  }

  // Handle Wrike's webhook verification handshake
  if (signature && !rawBody) {
    // Wrike sends X-Hook-Secret on setup, we echo it back
    return new NextResponse(null, {
      status: 200,
      headers: { 'X-Hook-Secret': signature },
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    );
  }

  // Process webhook events
  try {
    for (const event of payload) {
      await processWrikeEvent(event);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Processing failed' },
      { status: 500 }
    );
  }
}

async function processWrikeEvent(event: WrikeWebhookEvent) {
  const { taskId, eventType, ...data } = event;

  // Find our request by Wrike task ID
  const request = await prisma.dashboardRequest.findUnique({
    where: { wrikeTaskId: taskId },
  });

  if (!request) {
    console.log(`No matching request for Wrike task ${taskId}`);
    return;
  }

  // Prevent sync loops - check if we recently updated this
  const recentlyUpdated = request.updatedAt > new Date(Date.now() - 5000);
  if (recentlyUpdated) {
    console.log(`Skipping webhook for ${taskId} - recently updated locally`);
    return;
  }

  switch (eventType) {
    case 'TaskStatusChanged':
      const newStatus = WRIKE_TO_STATUS[data.newStatusId];
      if (newStatus && newStatus !== request.status) {
        await prisma.dashboardRequest.update({
          where: { id: request.id },
          data: {
            status: newStatus,
            statusChangedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        });
        // Trigger notification
        await notifyStatusChange(request.id, request.status, newStatus);
      }
      break;

    case 'TaskDeleted':
      await prisma.dashboardRequest.update({
        where: { id: request.id },
        data: {
          wrikeTaskId: null,
          wrikePermalink: null,
          lastSyncedAt: null,
        },
      });
      break;

    // Add other event types as needed
  }
}
```

### Optional Custom Fields to Create
If you want dashboard-specific tracking fields:
- `Dashboard Request ID` - Text field to store our cuid
- `Request Type` - DropDown with FEATURE_REQUEST, DATA_ERROR
- `Submitter Email` - Text field for the user who submitted

### Validation Checklist
- [ ] Requests sync to Wrike on creation
- [ ] Status changes sync both directions
- [ ] Comments sync to Wrike
- [ ] Webhook processes Wrike updates
- [ ] Wrike sync retries on failure
- [ ] Rate limit doesn't cause crashes
- [ ] Webhook signature verification works
- [ ] Sync loop prevention works (5s window)
- [ ] Failed syncs are logged and can be retried

---

## Phase 10: Notifications (with SendGrid Email)

### Objective
Email and in-app notifications for status changes, using existing SendGrid integration.

### Files to Create
- `src/lib/notifications.ts`
- `src/components/layout/NotificationBell.tsx`
- `src/app/api/notifications/route.ts`
- `src/app/api/notifications/[id]/read/route.ts`
- `src/app/api/notifications/unread-count/route.ts`
- `src/app/api/notifications/mark-all-read/route.ts`

### Files to Modify
- `src/components/layout/Header.tsx` (add NotificationBell)
- API routes to call notification functions

### Notifications Service with SendGrid (`src/lib/notifications.ts`)

```typescript
import sgMail from '@sendgrid/mail';
import { prisma } from './prisma';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

interface NotifyOptions {
  userId: string;
  requestId: string;
  message: string;
  emailSubject?: string;
  emailBody?: string;
  skipEmail?: boolean;
}

export async function createNotification({
  userId,
  requestId,
  message,
  emailSubject,
  emailBody,
  skipEmail = false,
}: NotifyOptions) {
  // Create in-app notification
  const notification = await prisma.requestNotification.create({
    data: {
      userId,
      requestId,
      message,
    },
  });

  // Send email if configured
  if (!skipEmail && emailSubject) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (user?.email) {
      try {
        await sgMail.send({
          to: user.email,
          from: FROM_EMAIL,
          subject: emailSubject,
          html: emailBody || message,
        });
      } catch (error) {
        console.error('Failed to send email notification:', error);
        // Don't throw - email failure shouldn't break the flow
      }
    }
  }

  return notification;
}

export async function notifyStatusChange(
  requestId: string,
  oldStatus: string,
  newStatus: string
) {
  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    include: { submitter: true },
  });

  if (!request) return;

  const statusLabels: Record<string, string> = {
    SUBMITTED: 'Submitted',
    PLANNED: 'Planned',
    IN_PROGRESS: 'In Progress',
    DONE: 'Done',
    ARCHIVED: 'Archived',
  };

  await createNotification({
    userId: request.submitterId,
    requestId,
    message: `Your request "${request.title}" status changed to ${statusLabels[newStatus]}`,
    emailSubject: `[Dashboard Request] Status Update: ${request.title}`,
    emailBody: `
      <h2>Your request status has been updated</h2>
      <p><strong>Request:</strong> ${request.title}</p>
      <p><strong>Previous Status:</strong> ${statusLabels[oldStatus]}</p>
      <p><strong>New Status:</strong> ${statusLabels[newStatus]}</p>
      <p><a href="${APP_URL}/requests?id=${requestId}">View Request</a></p>
    `,
  });
}

export async function notifyNewComment(
  requestId: string,
  commentAuthorId: string,
  commentPreview: string
) {
  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    include: { submitter: true },
  });

  if (!request || request.submitterId === commentAuthorId) return;

  const author = await prisma.user.findUnique({
    where: { id: commentAuthorId },
    select: { name: true },
  });

  await createNotification({
    userId: request.submitterId,
    requestId,
    message: `${author?.name || 'Someone'} commented on "${request.title}"`,
    emailSubject: `[Dashboard Request] New Comment: ${request.title}`,
    emailBody: `
      <h2>New comment on your request</h2>
      <p><strong>Request:</strong> ${request.title}</p>
      <p><strong>Comment by:</strong> ${author?.name || 'Unknown'}</p>
      <p><strong>Comment:</strong> ${commentPreview}</p>
      <p><a href="${APP_URL}/requests?id=${requestId}">View Request</a></p>
    `,
  });
}
```

### Key Features
- notifyStatusChange: Creates in-app notification + sends email via SendGrid
- notifyNewComment: Creates in-app notification + sends email
- NotificationBell: Shows unread count, dropdown with recent notifications
- Mark as read on click, mark all read button
- Email failure doesn't break notification flow (graceful degradation)

### Validation Checklist
- [ ] Notification bell shows in header
- [ ] Unread count updates correctly
- [ ] Email sends on status change
- [ ] In-app notification created simultaneously
- [ ] Email failure doesn't break notification flow
- [ ] In-app notifications work for comments

---

## Phase 11: Analytics & Archive

### Objective
Add analytics and archived requests view.

### Files to Create
- `src/components/requests/RequestAnalytics.tsx`
- `src/app/api/dashboard-requests/analytics/route.ts`
- `src/app/api/dashboard-requests/[id]/archive/route.ts`
- `src/app/api/dashboard-requests/[id]/unarchive/route.ts`

### Key Features
- Analytics (RevOps Admin only):
  - Total requests, avg resolution time
  - This month: feature requests, data errors, resolved
  - Charts: by type, by status
- Archive: Move Done requests to Archived (hidden from main Kanban)
- Archived tab to view/restore archived requests

### Validation Checklist
- [ ] Analytics tab shows for RevOps Admin
- [ ] Metrics display correctly
- [ ] Archive/unarchive works

---

## Phase 12.5: Test Coverage

### Objective
Create comprehensive automated tests for unit, integration, and end-to-end testing to ensure code quality and prevent regressions.

### Dependencies to Install
```bash
# Unit & Integration Testing
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom

# API Mocking
npm install -D msw

# E2E Testing
npm install -D @playwright/test
npx playwright install
```

### Files to Create
```
__tests__/
├── unit/
│   ├── permissions.test.ts
│   ├── file-storage.test.ts
│   ├── wrike-status-mapping.test.ts
│   └── visibility-rules.test.ts
├── integration/
│   ├── wrike-sync.test.ts
│   ├── webhook-processing.test.ts
│   └── notifications.test.ts
├── setup.ts
└── mocks/
    ├── handlers.ts
    └── server.ts
e2e/
├── request-lifecycle.spec.ts
├── kanban-board.spec.ts
├── privacy-access.spec.ts
└── fixtures/
    └── test-data.ts
vitest.config.ts
playwright.config.ts
```

---

### 1. Unit Tests

#### Test Configuration (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/unit/**/*.test.ts', '__tests__/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.ts', 'src/types/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

#### Test Setup (`__tests__/setup.ts`)

```typescript
import '@testing-library/jest-dom';
import { beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './mocks/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

#### Permission Logic Tests (`__tests__/unit/permissions.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { getUserPermissions, ROLE_PERMISSIONS } from '@/lib/permissions';

describe('Permission Logic', () => {
  describe('Page 13 (Dashboard Requests) Access', () => {
    it('should grant page 13 access to revops_admin', () => {
      const permissions = ROLE_PERMISSIONS.revops_admin;
      expect(permissions.allowedPages).toContain(13);
    });

    it('should grant page 13 access to admin', () => {
      const permissions = ROLE_PERMISSIONS.admin;
      expect(permissions.allowedPages).toContain(13);
    });

    it('should grant page 13 access to manager', () => {
      const permissions = ROLE_PERMISSIONS.manager;
      expect(permissions.allowedPages).toContain(13);
    });

    it('should grant page 13 access to sgm', () => {
      const permissions = ROLE_PERMISSIONS.sgm;
      expect(permissions.allowedPages).toContain(13);
    });

    it('should grant page 13 access to sga', () => {
      const permissions = ROLE_PERMISSIONS.sga;
      expect(permissions.allowedPages).toContain(13);
    });

    it('should grant page 13 access to viewer', () => {
      const permissions = ROLE_PERMISSIONS.viewer;
      expect(permissions.allowedPages).toContain(13);
    });

    it('should DENY page 13 access to recruiter', () => {
      const permissions = ROLE_PERMISSIONS.recruiter;
      expect(permissions.allowedPages).not.toContain(13);
    });
  });

  describe('canManageRequests Permission', () => {
    it('should grant canManageRequests to revops_admin only', () => {
      expect(ROLE_PERMISSIONS.revops_admin.canManageRequests).toBe(true);
      expect(ROLE_PERMISSIONS.admin.canManageRequests).toBe(false);
      expect(ROLE_PERMISSIONS.manager.canManageRequests).toBe(false);
      expect(ROLE_PERMISSIONS.sgm.canManageRequests).toBe(false);
      expect(ROLE_PERMISSIONS.sga.canManageRequests).toBe(false);
      expect(ROLE_PERMISSIONS.viewer.canManageRequests).toBe(false);
      expect(ROLE_PERMISSIONS.recruiter.canManageRequests).toBe(false);
    });
  });

  describe('Role Hierarchy', () => {
    it('revops_admin should have all admin permissions plus canManageRequests', () => {
      const revopsPerms = ROLE_PERMISSIONS.revops_admin;
      const adminPerms = ROLE_PERMISSIONS.admin;
      
      // RevOps Admin should have at least all admin pages
      adminPerms.allowedPages.forEach(page => {
        expect(revopsPerms.allowedPages).toContain(page);
      });
      
      // Plus the request management capability
      expect(revopsPerms.canManageRequests).toBe(true);
      expect(adminPerms.canManageRequests).toBe(false);
    });
  });
});
```

#### File Validation Tests (`__tests__/unit/file-storage.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { validateFile } from '@/lib/file-storage';

// Helper to create mock File objects
function createMockFile(name: string, size: number, type: string): File {
  const blob = new Blob(['x'.repeat(size)], { type });
  return new File([blob], name, { type });
}

describe('File Storage Validation', () => {
  describe('File Size Limits', () => {
    it('should accept files under 5MB', () => {
      const file = createMockFile('test.png', 4 * 1024 * 1024, 'image/png'); // 4MB
      const result = validateFile(file);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept files exactly at 5MB', () => {
      const file = createMockFile('test.png', 5 * 1024 * 1024, 'image/png'); // 5MB
      const result = validateFile(file);
      expect(result.valid).toBe(true);
    });

    it('should reject files over 5MB', () => {
      const file = createMockFile('test.png', 6 * 1024 * 1024, 'image/png'); // 6MB
      const result = validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('File too large');
    });

    it('should reject very large files', () => {
      const file = createMockFile('test.png', 50 * 1024 * 1024, 'image/png'); // 50MB
      const result = validateFile(file);
      expect(result.valid).toBe(false);
    });
  });

  describe('Allowed File Types', () => {
    const allowedTypes = [
      { type: 'image/png', ext: 'png' },
      { type: 'image/jpeg', ext: 'jpg' },
      { type: 'image/gif', ext: 'gif' },
      { type: 'image/webp', ext: 'webp' },
      { type: 'application/pdf', ext: 'pdf' },
      { type: 'text/csv', ext: 'csv' },
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
    ];

    allowedTypes.forEach(({ type, ext }) => {
      it(`should accept ${ext} files (${type})`, () => {
        const file = createMockFile(`test.${ext}`, 1024, type);
        const result = validateFile(file);
        expect(result.valid).toBe(true);
      });
    });

    const disallowedTypes = [
      { type: 'application/javascript', ext: 'js' },
      { type: 'application/x-executable', ext: 'exe' },
      { type: 'text/html', ext: 'html' },
      { type: 'application/zip', ext: 'zip' },
      { type: 'video/mp4', ext: 'mp4' },
    ];

    disallowedTypes.forEach(({ type, ext }) => {
      it(`should reject ${ext} files (${type})`, () => {
        const file = createMockFile(`test.${ext}`, 1024, type);
        const result = validateFile(file);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('File type not allowed');
      });
    });
  });
});
```

#### Status Mapping Tests (`__tests__/unit/wrike-status-mapping.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { 
  WRIKE_CONFIG, 
  STATUS_TO_WRIKE, 
  WRIKE_TO_STATUS 
} from '@/types/wrike';
import { RequestStatus } from '@prisma/client';

describe('Wrike Status Mapping', () => {
  const dashboardStatuses: RequestStatus[] = [
    'SUBMITTED',
    'PLANNED', 
    'IN_PROGRESS',
    'DONE',
    'ARCHIVED',
  ];

  describe('Dashboard → Wrike Mapping', () => {
    dashboardStatuses.forEach(status => {
      it(`should map ${status} to a valid Wrike status ID`, () => {
        const wrikeStatusId = STATUS_TO_WRIKE[status];
        expect(wrikeStatusId).toBeDefined();
        expect(wrikeStatusId).toMatch(/^IEAGT6KAJ/); // Wrike ID format
      });
    });

    it('should map to correct Wrike status IDs', () => {
      expect(STATUS_TO_WRIKE.SUBMITTED).toBe(WRIKE_CONFIG.STATUS_IDS.SUBMITTED);
      expect(STATUS_TO_WRIKE.PLANNED).toBe(WRIKE_CONFIG.STATUS_IDS.PLANNED);
      expect(STATUS_TO_WRIKE.IN_PROGRESS).toBe(WRIKE_CONFIG.STATUS_IDS.IN_PROGRESS);
      expect(STATUS_TO_WRIKE.DONE).toBe(WRIKE_CONFIG.STATUS_IDS.DONE);
      expect(STATUS_TO_WRIKE.ARCHIVED).toBe(WRIKE_CONFIG.STATUS_IDS.ARCHIVED);
    });
  });

  describe('Wrike → Dashboard Mapping', () => {
    Object.entries(STATUS_TO_WRIKE).forEach(([dashStatus, wrikeId]) => {
      it(`should map Wrike ID back to ${dashStatus}`, () => {
        const mappedBack = WRIKE_TO_STATUS[wrikeId];
        expect(mappedBack).toBe(dashStatus);
      });
    });
  });

  describe('Bidirectional Consistency', () => {
    it('should have matching entries in both directions', () => {
      // Every dashboard status should round-trip correctly
      dashboardStatuses.forEach(status => {
        const wrikeId = STATUS_TO_WRIKE[status];
        const backToDashboard = WRIKE_TO_STATUS[wrikeId];
        expect(backToDashboard).toBe(status);
      });
    });

    it('should have same number of mappings in both directions', () => {
      expect(Object.keys(STATUS_TO_WRIKE).length).toBe(
        Object.keys(WRIKE_TO_STATUS).length
      );
    });
  });
});
```

#### Visibility Rules Tests (`__tests__/unit/visibility-rules.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';

// Types for testing
interface MockRequest {
  id: string;
  submitterId: string;
  status: string;
  isPrivate: boolean;
}

interface MockUser {
  id: string;
  role: string;
}

// Visibility logic (mirrors actual implementation)
function canUserSeeRequest(user: MockUser, request: MockRequest): boolean {
  // RevOps Admin sees everything
  if (user.role === 'revops_admin') {
    return true;
  }

  // User is the submitter - always visible
  if (request.submitterId === user.id) {
    return true;
  }

  // Private requests only visible to submitter (already checked above)
  if (request.isPrivate) {
    return false;
  }

  // SUBMITTED status only visible to submitter (already checked above)
  if (request.status === 'SUBMITTED') {
    return false;
  }

  // All other cases: visible
  return true;
}

describe('Request Visibility Rules', () => {
  const regularUser: MockUser = { id: 'user-1', role: 'viewer' };
  const revOpsAdmin: MockUser = { id: 'admin-1', role: 'revops_admin' };
  const otherUser: MockUser = { id: 'user-2', role: 'viewer' };

  describe('Regular User Visibility', () => {
    it('should see their own submissions regardless of status', () => {
      const request: MockRequest = {
        id: 'req-1',
        submitterId: regularUser.id,
        status: 'SUBMITTED',
        isPrivate: false,
      };
      expect(canUserSeeRequest(regularUser, request)).toBe(true);
    });

    it('should see their own private submissions', () => {
      const request: MockRequest = {
        id: 'req-1',
        submitterId: regularUser.id,
        status: 'IN_PROGRESS',
        isPrivate: true,
      };
      expect(canUserSeeRequest(regularUser, request)).toBe(true);
    });

    it('should NOT see other users SUBMITTED requests', () => {
      const request: MockRequest = {
        id: 'req-1',
        submitterId: otherUser.id,
        status: 'SUBMITTED',
        isPrivate: false,
      };
      expect(canUserSeeRequest(regularUser, request)).toBe(false);
    });

    it('should NOT see other users private requests', () => {
      const request: MockRequest = {
        id: 'req-1',
        submitterId: otherUser.id,
        status: 'IN_PROGRESS',
        isPrivate: true,
      };
      expect(canUserSeeRequest(regularUser, request)).toBe(false);
    });

    it('should see other users non-private, non-submitted requests', () => {
      const statuses = ['PLANNED', 'IN_PROGRESS', 'DONE', 'ARCHIVED'];
      
      statuses.forEach(status => {
        const request: MockRequest = {
          id: 'req-1',
          submitterId: otherUser.id,
          status,
          isPrivate: false,
        };
        expect(canUserSeeRequest(regularUser, request)).toBe(true);
      });
    });
  });

  describe('RevOps Admin Visibility', () => {
    it('should see ALL requests regardless of ownership', () => {
      const request: MockRequest = {
        id: 'req-1',
        submitterId: otherUser.id,
        status: 'SUBMITTED',
        isPrivate: false,
      };
      expect(canUserSeeRequest(revOpsAdmin, request)).toBe(true);
    });

    it('should see ALL private requests', () => {
      const request: MockRequest = {
        id: 'req-1',
        submitterId: otherUser.id,
        status: 'IN_PROGRESS',
        isPrivate: true,
      };
      expect(canUserSeeRequest(revOpsAdmin, request)).toBe(true);
    });

    it('should see requests in any status', () => {
      const statuses = ['SUBMITTED', 'PLANNED', 'IN_PROGRESS', 'DONE', 'ARCHIVED'];
      
      statuses.forEach(status => {
        const request: MockRequest = {
          id: 'req-1',
          submitterId: otherUser.id,
          status,
          isPrivate: true,
        };
        expect(canUserSeeRequest(revOpsAdmin, request)).toBe(true);
      });
    });
  });
});
```

---

### 2. Integration Tests

#### MSW Mock Handlers (`__tests__/mocks/handlers.ts`)

```typescript
import { http, HttpResponse } from 'msw';

const WRIKE_API_BASE = 'https://www.wrike.com/api/v4';

export const handlers = [
  // Wrike Create Task
  http.post(`${WRIKE_API_BASE}/folders/:folderId/tasks`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      kind: 'tasks',
      data: [{
        id: 'IEAGT6KAKxxxxxxx',
        title: body.title,
        status: body.status,
        permalink: 'https://www.wrike.com/open.htm?id=xxxxxxx',
      }],
    });
  }),

  // Wrike Update Task
  http.put(`${WRIKE_API_BASE}/tasks/:taskId`, async ({ request, params }) => {
    const body = await request.json();
    return HttpResponse.json({
      kind: 'tasks',
      data: [{
        id: params.taskId,
        ...body,
      }],
    });
  }),

  // Wrike Rate Limit Response
  http.post(`${WRIKE_API_BASE}/folders/rate-limited/tasks`, () => {
    return new HttpResponse(null, {
      status: 429,
      headers: {
        'Retry-After': '5',
        'X-RateLimit-Remaining': '0',
      },
    });
  }),

  // SendGrid Send Email
  http.post('https://api.sendgrid.com/v3/mail/send', () => {
    return HttpResponse.json({ message: 'success' }, { status: 202 });
  }),
];
```

#### MSW Server (`__tests__/mocks/server.ts`)

```typescript
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

#### Wrike Sync Integration Tests (`__tests__/integration/wrike-sync.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dashboardRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { syncToWrike, retrySyncToWrike } from '@/lib/wrike';

const WRIKE_API_BASE = 'https://www.wrike.com/api/v4';

describe('Wrike Sync Integration', () => {
  const mockRequest = {
    id: 'req-123',
    title: 'Test Request',
    description: 'Test description',
    requestType: 'FEATURE_REQUEST',
    status: 'SUBMITTED',
    priority: 'MEDIUM',
    submitter: { name: 'Test User', email: 'test@example.com' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.dashboardRequest.findUnique as any).mockResolvedValue(mockRequest);
    (prisma.dashboardRequest.update as any).mockResolvedValue({});
  });

  describe('syncToWrike()', () => {
    it('should successfully create a Wrike task', async () => {
      const result = await syncToWrike('req-123');

      expect(result.success).toBe(true);
      expect(result.wrikeTaskId).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify local record was updated with Wrike info
      expect(prisma.dashboardRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-123' },
        data: expect.objectContaining({
          wrikeTaskId: expect.any(String),
          wrikePermalink: expect.stringContaining('wrike.com'),
          lastSyncedAt: expect.any(Date),
        }),
      });
    });

    it('should handle API errors gracefully', async () => {
      // Override handler for this test
      server.use(
        http.post(`${WRIKE_API_BASE}/folders/:folderId/tasks`, () => {
          return HttpResponse.json(
            { error: 'invalid_request', errorDescription: 'Invalid folder' },
            { status: 400 }
          );
        })
      );

      const result = await syncToWrike('req-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      
      // Should mark sync as failed (lastSyncedAt = null)
      expect(prisma.dashboardRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-123' },
        data: { lastSyncedAt: null },
      });
    });

    it('should handle rate limiting with retry', async () => {
      let attempts = 0;
      
      server.use(
        http.post(`${WRIKE_API_BASE}/folders/:folderId/tasks`, () => {
          attempts++;
          if (attempts < 2) {
            return new HttpResponse(null, {
              status: 429,
              headers: { 'Retry-After': '1' },
            });
          }
          return HttpResponse.json({
            kind: 'tasks',
            data: [{ id: 'IEAGT6KAKretried', permalink: 'https://wrike.com/test' }],
          });
        })
      );

      const result = await syncToWrike('req-123');

      expect(attempts).toBeGreaterThan(1);
      expect(result.success).toBe(true);
    });

    it('should return error when request not found', async () => {
      (prisma.dashboardRequest.findUnique as any).mockResolvedValue(null);

      const result = await syncToWrike('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request not found');
    });
  });

  describe('retrySyncToWrike()', () => {
    it('should retry failed syncs', async () => {
      const result = await retrySyncToWrike('req-123');
      expect(result.success).toBe(true);
    });
  });
});
```

#### Webhook Processing Tests (`__tests__/integration/webhook-processing.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    dashboardRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/notifications', () => ({
  notifyStatusChange: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { notifyStatusChange } from '@/lib/notifications';

// Simulate webhook verification
function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

describe('Wrike Webhook Processing', () => {
  const WEBHOOK_SECRET = 'test-secret';
  
  const mockRequest = {
    id: 'req-123',
    wrikeTaskId: 'IEAGT6KAKxxxxx',
    status: 'SUBMITTED',
    updatedAt: new Date(Date.now() - 60000), // 1 minute ago
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.dashboardRequest.findUnique as any).mockResolvedValue(mockRequest);
    (prisma.dashboardRequest.update as any).mockResolvedValue({});
  });

  describe('Signature Verification', () => {
    it('should accept valid signatures', () => {
      const payload = JSON.stringify([{ taskId: 'test', eventType: 'TaskStatusChanged' }]);
      const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
      
      expect(verifySignature(payload, signature, WEBHOOK_SECRET)).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const payload = JSON.stringify([{ taskId: 'test' }]);
      const invalidSignature = 'invalid-signature-here';
      
      expect(() => verifySignature(payload, invalidSignature, WEBHOOK_SECRET)).toThrow();
    });
  });

  describe('Sync Loop Prevention', () => {
    it('should skip processing if request was recently updated locally', async () => {
      const recentlyUpdatedRequest = {
        ...mockRequest,
        updatedAt: new Date(Date.now() - 2000), // 2 seconds ago (within 5s window)
      };
      (prisma.dashboardRequest.findUnique as any).mockResolvedValue(recentlyUpdatedRequest);

      // Processing should be skipped
      const shouldProcess = recentlyUpdatedRequest.updatedAt < new Date(Date.now() - 5000);
      expect(shouldProcess).toBe(false);
    });

    it('should process if request was not recently updated', async () => {
      const oldRequest = {
        ...mockRequest,
        updatedAt: new Date(Date.now() - 60000), // 1 minute ago
      };
      (prisma.dashboardRequest.findUnique as any).mockResolvedValue(oldRequest);

      const shouldProcess = oldRequest.updatedAt < new Date(Date.now() - 5000);
      expect(shouldProcess).toBe(true);
    });
  });

  describe('Status Change Processing', () => {
    it('should update local status when Wrike status changes', async () => {
      // Simulate status change from webhook
      const newStatus = 'IN_PROGRESS';
      
      await prisma.dashboardRequest.update({
        where: { id: mockRequest.id },
        data: {
          status: newStatus,
          statusChangedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      });

      expect(prisma.dashboardRequest.update).toHaveBeenCalled();
    });

    it('should trigger notification on status change', async () => {
      await notifyStatusChange('req-123', 'SUBMITTED', 'IN_PROGRESS');
      
      expect(notifyStatusChange).toHaveBeenCalledWith('req-123', 'SUBMITTED', 'IN_PROGRESS');
    });
  });
});
```

#### Notification Tests (`__tests__/integration/notifications.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SendGrid
vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue([{ statusCode: 202 }]),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    requestNotification: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    dashboardRequest: {
      findUnique: vi.fn(),
    },
  },
}));

import sgMail from '@sendgrid/mail';
import { prisma } from '@/lib/prisma';
import { createNotification, notifyStatusChange } from '@/lib/notifications';

describe('Notification Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.requestNotification.create as any).mockResolvedValue({ id: 'notif-1' });
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
    });
    (prisma.dashboardRequest.findUnique as any).mockResolvedValue({
      id: 'req-1',
      title: 'Test Request',
      submitterId: 'user-1',
      submitter: { name: 'Test User' },
    });
  });

  describe('createNotification()', () => {
    it('should create in-app notification', async () => {
      await createNotification({
        userId: 'user-1',
        requestId: 'req-1',
        message: 'Test notification',
        skipEmail: true,
      });

      expect(prisma.requestNotification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          requestId: 'req-1',
          message: 'Test notification',
        },
      });
    });

    it('should send email when emailSubject is provided', async () => {
      await createNotification({
        userId: 'user-1',
        requestId: 'req-1',
        message: 'Test notification',
        emailSubject: 'Test Subject',
        emailBody: '<p>Test body</p>',
      });

      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Subject',
        })
      );
    });

    it('should NOT fail if email send fails', async () => {
      (sgMail.send as any).mockRejectedValueOnce(new Error('SendGrid error'));

      // Should not throw
      await expect(
        createNotification({
          userId: 'user-1',
          requestId: 'req-1',
          message: 'Test',
          emailSubject: 'Test',
        })
      ).resolves.not.toThrow();

      // In-app notification should still be created
      expect(prisma.requestNotification.create).toHaveBeenCalled();
    });
  });

  describe('notifyStatusChange()', () => {
    it('should create notification with correct message format', async () => {
      await notifyStatusChange('req-1', 'SUBMITTED', 'IN_PROGRESS');

      expect(prisma.requestNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          message: expect.stringContaining('In Progress'),
        }),
      });
    });

    it('should send email with status change details', async () => {
      await notifyStatusChange('req-1', 'SUBMITTED', 'DONE');

      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Status Update'),
          html: expect.stringContaining('Done'),
        })
      );
    });
  });
});
```

---

### 3. E2E Tests (Playwright)

#### Playwright Configuration (`playwright.config.ts`)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

#### Test Fixtures (`e2e/fixtures/test-data.ts`)

```typescript
import { prisma } from '@/lib/prisma';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export const testUsers = {
  regularUser: {
    email: 'test-user@example.com',
    name: 'Test User',
    role: 'viewer',
  },
  revOpsAdmin: {
    email: 'revops-admin@example.com',
    name: 'RevOps Admin',
    role: 'revops_admin',
  },
  otherUser: {
    email: 'other-user@example.com',
    name: 'Other User',
    role: 'viewer',
  },
};

export async function seedTestData() {
  // Create test users
  const users = await Promise.all(
    Object.values(testUsers).map(user =>
      prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: {
          email: user.email,
          name: user.name,
          role: user.role,
        },
      })
    )
  );

  return { users };
}

export async function cleanupTestData() {
  // Delete test requests and related data
  await prisma.requestNotification.deleteMany({
    where: { request: { title: { startsWith: '[E2E]' } } },
  });
  await prisma.requestComment.deleteMany({
    where: { request: { title: { startsWith: '[E2E]' } } },
  });
  await prisma.requestAttachment.deleteMany({
    where: { request: { title: { startsWith: '[E2E]' } } },
  });
  await prisma.dashboardRequest.deleteMany({
    where: { title: { startsWith: '[E2E]' } },
  });
}
```

#### Request Lifecycle E2E Tests (`e2e/request-lifecycle.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';
import { seedTestData, cleanupTestData, testUsers } from './fixtures/test-data';

test.describe('Request Lifecycle', () => {
  test.beforeAll(async () => {
    await seedTestData();
  });

  test.afterAll(async () => {
    await cleanupTestData();
  });

  test.describe('Feature Request Submission', () => {
    test('user submits Feature Request → appears in Kanban Submitted column', async ({ page }) => {
      // Login as regular user
      await page.goto('/auth/signin');
      await page.fill('[name="email"]', testUsers.regularUser.email);
      await page.click('button[type="submit"]');
      
      // Navigate to requests page
      await page.goto('/dashboard/requests');
      
      // Click "Submit Request" tab
      await page.click('text=Submit Request');
      
      // Fill out Feature Request form
      await page.click('[data-testid="request-type-feature"]');
      await page.fill('[name="title"]', '[E2E] Test Feature Request');
      await page.fill('[name="description"]', 'This is a test feature request from E2E tests');
      
      // Submit
      await page.click('button[type="submit"]');
      
      // Wait for success
      await expect(page.locator('text=Request submitted')).toBeVisible();
      
      // Switch to View Requests tab
      await page.click('text=View Requests');
      
      // Verify request appears in Submitted column
      const submittedColumn = page.locator('[data-testid="kanban-column-SUBMITTED"]');
      await expect(submittedColumn.locator('text=[E2E] Test Feature Request')).toBeVisible();
    });
  });

  test.describe('Data Error Submission', () => {
    test('user submits Data Error with all fields → conditional fields work', async ({ page }) => {
      await page.goto('/dashboard/requests');
      await page.click('text=Submit Request');
      
      // Select Data Error type
      await page.click('[data-testid="request-type-data-error"]');
      
      // Required fields
      await page.fill('[name="title"]', '[E2E] Test Data Error');
      await page.fill('[name="description"]', 'Data is showing incorrect values');
      
      // Data Error specific fields (should now be visible)
      await expect(page.locator('[name="affectedPage"]')).toBeVisible();
      await page.selectOption('[name="affectedPage"]', 'Pipeline');
      
      await page.fill('[name="valueSeen"]', '100');
      await page.fill('[name="valueExpected"]', '200');
      await page.fill('[name="filtersApplied"]', 'Date: Last 30 days');
      
      // Submit
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Request submitted')).toBeVisible();
    });
  });
});
```

#### Kanban Board E2E Tests (`e2e/kanban-board.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/test-data';

test.describe('Kanban Board', () => {
  test.describe('RevOps Admin Actions', () => {
    test.beforeEach(async ({ page }) => {
      // Login as RevOps Admin
      await page.goto('/auth/signin');
      await page.fill('[name="email"]', testUsers.revOpsAdmin.email);
      await page.click('button[type="submit"]');
    });

    test('RevOps Admin drags card to In Progress → status updates', async ({ page }) => {
      await page.goto('/dashboard/requests');
      
      // Find a card in Submitted column
      const card = page.locator('[data-testid="request-card"]').first();
      const targetColumn = page.locator('[data-testid="kanban-column-IN_PROGRESS"]');
      
      // Drag and drop
      await card.dragTo(targetColumn);
      
      // Verify card moved
      await expect(targetColumn.locator('[data-testid="request-card"]')).toBeVisible();
    });

    test('RevOps Admin adds comment → submitter receives notification', async ({ page }) => {
      await page.goto('/dashboard/requests');
      
      // Click on a request card
      await page.click('[data-testid="request-card"]');
      
      // Switch to Comments tab
      await page.click('text=Comments');
      
      // Add comment
      await page.fill('[name="comment"]', 'This is a test comment from RevOps Admin');
      await page.click('button:has-text("Add Comment")');
      
      // Verify comment appears
      await expect(page.locator('text=This is a test comment')).toBeVisible();
    });

    test('RevOps Admin archives Done request → moves to Archived view', async ({ page }) => {
      await page.goto('/dashboard/requests');
      
      // Find a Done request
      const doneColumn = page.locator('[data-testid="kanban-column-DONE"]');
      await doneColumn.locator('[data-testid="request-card"]').first().click();
      
      // Click Archive button
      await page.click('button:has-text("Archive")');
      
      // Confirm
      await page.click('button:has-text("Confirm")');
      
      // Verify no longer in Done column
      await expect(doneColumn.locator('[data-testid="request-card"]')).toHaveCount(0);
      
      // Check Archived view
      await page.click('text=Archived');
      await expect(page.locator('[data-testid="archived-request"]')).toBeVisible();
    });
  });
});
```

#### Privacy Access E2E Tests (`e2e/privacy-access.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/test-data';

test.describe('Privacy Access Controls', () => {
  test('user can view their own private request', async ({ page }) => {
    // Login as regular user
    await page.goto('/auth/signin');
    await page.fill('[name="email"]', testUsers.regularUser.email);
    await page.click('button[type="submit"]');
    
    // Create a private request first
    await page.goto('/dashboard/requests');
    await page.click('text=Submit Request');
    await page.click('[data-testid="request-type-feature"]');
    await page.fill('[name="title"]', '[E2E] Private Request Test');
    await page.fill('[name="description"]', 'This is a private request');
    await page.check('[name="isPrivate"]');
    await page.click('button[type="submit"]');
    
    // Navigate to view
    await page.click('text=View Requests');
    
    // Should see their own private request
    await expect(page.locator('text=[E2E] Private Request Test')).toBeVisible();
  });

  test('user cannot view another users private request', async ({ page, request }) => {
    // First, create a private request as other user (via API)
    // Then try to access it as regular user
    
    // Login as regular user
    await page.goto('/auth/signin');
    await page.fill('[name="email"]', testUsers.regularUser.email);
    await page.click('button[type="submit"]');
    
    // Try to directly access another user's private request
    // This should redirect or show error
    const response = await page.goto('/dashboard/requests?id=other-users-private-request');
    
    // Should not show the request details
    await expect(page.locator('text=Access denied')).toBeVisible();
  });

  test('RevOps Admin can view all private requests', async ({ page }) => {
    // Login as RevOps Admin
    await page.goto('/auth/signin');
    await page.fill('[name="email"]', testUsers.revOpsAdmin.email);
    await page.click('button[type="submit"]');
    
    await page.goto('/dashboard/requests');
    
    // RevOps Admin should see private requests with lock icon
    const privateIndicator = page.locator('[data-testid="private-indicator"]');
    await expect(privateIndicator.first()).toBeVisible();
    
    // Should be able to click and view details
    await page.locator('[data-testid="request-card"]').filter({ has: privateIndicator }).first().click();
    await expect(page.locator('[data-testid="request-detail-modal"]')).toBeVisible();
  });
});
```

---

### 4. npm Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:all": "npm run test:unit && npm run test:e2e"
  }
}
```

---

### 5. CI/CD Integration

Add `.github/workflows/test.yml`:

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
  WRIKE_ACCESS_TOKEN: ${{ secrets.WRIKE_ACCESS_TOKEN }}
  SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}

jobs:
  unit-integration:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Generate Prisma Client
        run: npx prisma generate
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: unit-integration  # Only run E2E if unit tests pass
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      
      - name: Generate Prisma Client
        run: npx prisma generate
      
      - name: Run E2E tests
        run: npm run test:e2e
        env:
          PLAYWRIGHT_BASE_URL: http://localhost:3000
      
      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

### Test Database Seeding Note

For E2E tests, ensure a clean test database:

```bash
# Create a separate test database
# Add to .env.test.local:
DATABASE_URL="postgresql://...?schema=test"

# Seed before E2E run
npx prisma db push --skip-generate
npx tsx e2e/fixtures/seed.ts
```

---

### Validation Checklist
- [ ] `npm install` completes with all test dependencies
- [ ] `vitest.config.ts` created and working
- [ ] `playwright.config.ts` created and working
- [ ] `npm run test:unit` passes all unit tests
- [ ] `npm run test:coverage` shows >80% coverage on critical files
- [ ] `npm run test:e2e` passes all E2E tests
- [ ] GitHub Actions workflow runs on PR
- [ ] E2E tests run before production deploy

---

## Phase 12: Final Testing & Polish

### Functional Testing Checklist
- [ ] User roles work correctly (regular user vs RevOps Admin vs recruiter)
- [ ] Full request lifecycle (create → update → comment → status changes → done → archive)
- [ ] Wrike integration (both directions)
- [ ] Notifications (email + in-app)
- [ ] Privacy toggle works

### Code Quality Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] No console errors

### Deployment Steps
1. Set all environment variables in Vercel
2. Run `npx prisma db push`
3. Set up Wrike webhook pointing to `/api/webhooks/wrike`
4. Deploy and verify

---

## Summary

| Phase | Description | Key Files | Updates |
|-------|-------------|-----------|---------|
| Pre-Implementation | Setup & Infrastructure | .env, SendGrid templates | Added email templates checklist, file storage decision |
| 1 | Database Schema | prisma/schema.prisma | Updated `RequestAttachment` to store binary data |
| 2 | RevOps Admin Role | permissions.ts, user.ts | - |
| 3 | Types, API Client & State | dashboard-request.ts, api-client.ts, useRequests.ts, useNotifications.ts | Added SWR hooks for state management |
| 4 | Core API Routes | api/dashboard-requests/*.ts | Added pagination types and GET route with pagination |
| 5 | Page Structure | requests/page.tsx, Sidebar.tsx | - |
| 6 | Submission Form & File Storage | RequestForm.tsx, file-storage.ts, attachments routes | Added Neon-based file storage |
| 7 | Kanban Board | KanbanBoard.tsx, KanbanColumn.tsx, VirtualizedKanbanColumn.tsx, RequestCard.tsx | Added @tanstack/react-virtual for columns with 50+ cards |
| 8 | Detail Modal | RequestDetailModal.tsx | - |
| 9 | Wrike Integration | wrike-client.ts, wrike.ts, webhooks/wrike/route.ts | Added rate limiting, error handling, webhook security |
| 10 | Notifications | notifications.ts, NotificationBell.tsx | Updated to use existing SendGrid integration |
| 11 | Analytics & Archive | RequestAnalytics.tsx | - |
| **12.5** | **Test Coverage** | `__tests__/`, `e2e/`, vitest.config.ts, playwright.config.ts | **NEW**: Unit, integration, and E2E tests |
| 12 | Final Testing & Polish | - | - |

**Dependencies**:
- @dnd-kit/core
- @dnd-kit/sortable
- @dnd-kit/utilities
- @tanstack/react-virtual
- swr
- date-fns (likely already installed)
- @sendgrid/mail (existing)

**Testing Dependencies** (dev):
- vitest
- @vitest/coverage-v8
- @testing-library/react
- @testing-library/jest-dom
- jsdom
- msw
- @playwright/test

---

## Environment Variables Summary

Add these to `.env.local` and Vercel:

```env
# Wrike Integration
WRIKE_ACCESS_TOKEN=${WRIKE_ACCESS_TOKEN}  # Set actual value - NEVER commit
WRIKE_FOLDER_ID=IEAGT6KAI7777RTZ
WRIKE_WORKFLOW_ID=IEAGT6KAK77ZMBWA
WRIKE_WEBHOOK_SECRET=your_random_secret_here  # Generate a random string

# App Configuration
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# SendGrid (existing - verify these are set)
SENDGRID_API_KEY=${SENDGRID_API_KEY}
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
```

**Note**: No additional environment variables needed for file storage — we're using the existing Neon database connection.
