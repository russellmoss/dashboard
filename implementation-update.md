# Implementation Plan Updates

> **Purpose**: Addendum to `dashboard_request_implementation.md` addressing gaps in infrastructure, error handling, and production readiness
> **Action**: Merge these updates into the main implementation plan at the specified phases

---

## 🔴 IMMEDIATE: Security Fix

**Remove the exposed Wrike access token from the implementation plan.**

In `dashboard_request_implementation.md`, replace all instances of the actual token with environment variable references only:

```diff
- WRIKE_ACCESS_TOKEN=eyJ0dCI6InAiLCJhbGci...
+ WRIKE_ACCESS_TOKEN=${WRIKE_ACCESS_TOKEN}  # Set in .env - NEVER commit actual token
```

Rotate the compromised token in Wrike immediately.

---

## Infrastructure Decisions (Add to Phase 0 or Pre-Implementation)

### Email Provider
**Decision**: Use existing SendGrid integration (already configured for password reset)

Add to Pre-Implementation Checklist:
```markdown
- [x] SendGrid credentials in .env (SENDGRID_API_KEY, etc.)
- [ ] Create email templates for:
  - Request submitted confirmation
  - Status change notification
  - New comment notification
```

### File Storage
**Decision**: Use existing Neon (Postgres) database for attachment storage

No additional setup needed — we'll store files as binary data in the `RequestAttachment` table using Prisma's `Bytes` type. This keeps the architecture simple for an internal tool with low attachment volume.

---

## Phase 3 Update: Add State Management

### Add to Dependencies
```bash
npm install swr
```

### New File to Create
`src/lib/hooks/useRequests.ts`

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

### New File to Create
`src/lib/hooks/useNotifications.ts`

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

---

## Phase 4 Update: Add Pagination

### Update Types
Add to `src/types/dashboard-request.ts`:

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

### Update GET Route
Modify `src/app/api/dashboard-requests/route.ts`:

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

### Kanban Note
For the Kanban board specifically, pagination works differently—load all non-archived requests but consider virtual scrolling if columns get large (50+ cards). Add this to Phase 7 notes:

```markdown
### Kanban Pagination Strategy
- Initial load: Fetch all non-archived requests (typically <200)
- If performance issues arise with 200+ requests, implement:
  - Virtual scrolling within columns using @tanstack/react-virtual
  - Or lazy-load older "Done" items
```

---

## Phase 1 Update: Schema Change for File Storage in Neon

Since we're using Neon (Postgres) for file storage, update the `RequestAttachment` model in `prisma/schema.prisma`:

```prisma
model RequestAttachment {
  id           String   @id @default(cuid())
  filename     String
  mimeType     String
  size         Int
  data         Bytes    // Store file as binary in Postgres
  createdAt    DateTime @default(now())
  requestId    String
  request      DashboardRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  uploadedById String
  uploadedBy   User     @relation("UploadedAttachments", fields: [uploadedById], references: [id])
  
  @@index([requestId])
}
```

**Note**: Remove `wrikeAttachmentId` and `wrikeDownloadUrl` fields from the original schema — we're storing file data directly.

---

## Phase 6 Update: File Storage with Neon (No External Service)

We're storing attachments directly in Postgres via Prisma. No additional dependencies needed.

### New File to Create
`src/lib/file-storage.ts`

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

### New API Route: Upload Attachment
`src/app/api/dashboard-requests/[id]/attachments/route.ts`

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

### New API Route: Serve/Delete Individual Attachment
`src/app/api/attachments/[id]/route.ts`

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

### Frontend: Attachment Component
`src/components/requests/AttachmentUpload.tsx`

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

---

## Phase 9 Update: Wrike Error Handling & Rate Limiting

### New File to Create
`src/lib/wrike-client.ts`

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

### Update Wrike Service
Modify `src/lib/wrike.ts` to handle failures gracefully:

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

---

## Phase 9 Update: Webhook Security

### Update Webhook Route
Modify `src/app/api/webhooks/wrike/route.ts`:

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

### Environment Variable
Add to `.env`:
```
WRIKE_WEBHOOK_SECRET=your_webhook_secret_here
```

---

## Phase 10 Update: SendGrid Integration

### Update Notifications Service
Modify `src/lib/notifications.ts`:

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

---

## Updated Phase Summary

| Phase | Updates |
|-------|---------|
| Pre-Implementation | Add SendGrid templates checklist |
| Phase 1 | Update `RequestAttachment` schema to store binary data |
| Phase 3 | Add SWR hooks (`useRequests.ts`, `useNotifications.ts`) |
| Phase 4 | Add pagination types, update GET route with pagination |
| Phase 6 | Add Neon-based file storage (routes + validation + component) |
| Phase 9 | Add rate limiting client, error handling, webhook security |
| Phase 10 | Update to use existing SendGrid integration |

---

## New Environment Variables

Add these to `.env.local` and Vercel:

```env
# Wrike Webhook Secret (generate a random string)
WRIKE_WEBHOOK_SECRET=your_random_secret_here

# App URL for email links
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

**Note**: No additional environment variables needed for file storage — we're using the existing Neon database connection.

---

## New Validation Checkpoints

### After Phase 3 Update
- [ ] `useRequests()` hook fetches data correctly
- [ ] SWR caching works (no duplicate requests on re-render)
- [ ] `invalidateRequests()` triggers refetch

### After Phase 4 Update
- [ ] API returns pagination metadata
- [ ] Page/limit params work correctly
- [ ] Default limit is reasonable (50)

### After Phase 6 Update
- [ ] File upload to Neon works (creates RequestAttachment record with binary data)
- [ ] File size validation works (rejects >5MB)
- [ ] File type validation works
- [ ] File serving works via `/api/attachments/[id]`
- [ ] File deletion works
- [ ] Privacy check works (private request attachments only visible to submitter/RevOps Admin)

### After Phase 9 Updates
- [ ] Wrike sync retries on failure
- [ ] Rate limit doesn't cause crashes
- [ ] Webhook signature verification works
- [ ] Sync loop prevention works (5s window)
- [ ] Failed syncs are logged and can be retried

### After Phase 10 Update
- [ ] Email sends on status change
- [ ] In-app notification created simultaneously
- [ ] Email failure doesn't break notification flow
