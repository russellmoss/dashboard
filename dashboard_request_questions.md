# Dashboard Requests Feature - Technical Codebase Discovery

> **Purpose**: This document contains questions and agentic prompts for Cursor.ai to explore the Savvy Dashboard codebase and gather technical context needed to implement the "Dashboard Requests" feature.
>
> **Instructions**: Work through each section sequentially. After each exploration prompt, document your findings in the "Answer" section before moving on.

---

## Prerequisites: Environment Setup

Before starting Phase 6 (Wrike API), verify you can access the environment variables:

```bash
# In terminal, verify these are set:
echo $WRIKE_ACCESS_TOKEN  # Should show the permanent token

# Or in Node.js context:
console.log(process.env.WRIKE_ACCESS_TOKEN)
```

**Available Wrike credentials in `.env`:**
- `WRIKE_CLIENT_ID` - OAuth client ID (for reference only)
- `WRIKE_CLIENT_SECRET` - OAuth client secret (for reference only)
- `WRIKE_ACCESS_TOKEN` - **Permanent access token - USE THIS for all API calls**

---

## Phase 1: Permissions & Role System Deep Dive

### 1.1 Current Role Definitions
**Explore**: Examine the permissions system to understand how to add a new "RevOps Admin" role.

```
Read src/lib/permissions.ts and src/types/user.ts completely. Document:
1. All current roles and their permission objects
2. How allowedPages array works
3. How special filters (sgaFilter, sgmFilter, recruiterFilter) are applied
4. What page IDs are currently assigned (list all)
```

**Answer**:

**Current Roles (from `src/lib/permissions.ts` and `src/types/user.ts`):**

| Role | allowedPages | canExport | canManageUsers | Special Filter |
|------|--------------|-----------|----------------|----------------|
| `admin` | [1, 3, 7, 8, 9, 10, 11, 12] | true | true | None |
| `manager` | [1, 3, 7, 8, 9, 10, 11, 12] | true | false | None |
| `sgm` | [1, 3, 7, 10] | true | false | `sgmFilter` = user's name |
| `sga` | [1, 3, 7, 8, 10, 11] | true | false | `sgaFilter` = user's name |
| `viewer` | [1, 3, 7, 10] | false | false | None |
| `recruiter` | [7, 12] | true | false | `recruiterFilter` = `externalAgency` |

**Page ID Mappings (from `src/components/layout/Sidebar.tsx`):**
- `1` - Funnel Performance (`/dashboard`)
- `3` - Open Pipeline (`/dashboard/pipeline`)
- `7` - Settings (`/dashboard/settings`)
- `8` - SGA Hub (`/dashboard/sga-hub`)
- `9` - SGA Management (`/dashboard/sga-management`)
- `10` - Explore (`/dashboard/explore`)
- `11` - SGA Activity (not in sidebar but used in permissions)
- `12` - Recruiter Hub (`/dashboard/recruiter-hub`)

**Next available page ID: `13`** (for Dashboard Requests)

**How allowedPages works:**
- The sidebar filters pages with `PAGES.filter(page => allowedPages.includes(page.id))`
- API routes use `permissions.allowedPages` to verify page access

**Special Filters:**
- `sgaFilter`: Applied when role is `sga`, set to user's `name` - filters data to only show their own records
- `sgmFilter`: Applied when role is `sgm`, set to user's `name` - filters data to their team
- `recruiterFilter`: Applied when role is `recruiter`, set to `user.externalAgency` - filters to their agency

---

### 1.2 Role-Based Route Protection
**Explore**: Understand how routes check for specific roles beyond page access.

```
Search the codebase for patterns like:
- `permissions.role ===`
- `['admin', 'manager'].includes(permissions.role)`
- Any role-specific logic in API routes

Document 3-5 examples of how role-specific access is enforced in API routes.
```

**Answer**:

**Pattern 1: Admin/Manager only operations**
```typescript
// src/app/api/sga-hub/weekly-goals/route.ts:42
if (!['admin', 'manager'].includes(permissions.role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```
Used for: Viewing other users' goals, editing past weeks

**Pattern 2: Role-based feature access**
```typescript
// src/app/dashboard/sga-hub/SGAHubContent.tsx:37
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
```
Used for: Showing admin-only UI controls (like "View All" toggles)

**Pattern 3: Role + filter combination**
```typescript
// src/app/api/sga-hub/re-engagement/route.ts:37
if (showAll && !['admin', 'manager'].includes(permissions.role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```
Used for: Restricting "show all records" to admins

**Pattern 4: Recruiter-specific filtering**
```typescript
// src/app/api/recruiter-hub/external-agencies/route.ts:26
if (permissions.role === 'recruiter' && permissions.recruiterFilter) {
  // Filter to their agency only
}
```
Used for: Enforcing recruiter data isolation

**Pattern 5: SGA self-restriction**
```typescript
// src/app/api/sga-hub/weekly-goals/route.ts:152
if (permissions.role === 'sga' && userEmail === session.user.email) {
  // SGAs can only edit current/future weeks
}
```
Used for: Restricting SGAs from editing historical data

---

### 1.3 User Management & Database Schema
**Explore**: Understand how users are stored and managed.

```
Read:
1. prisma/schema.prisma - Document the User model completely
2. src/lib/users.ts - Document the user CRUD functions available
3. src/components/settings/UserModal.tsx - How are new users created with roles?

Specifically note: How would we add a new role to the system?
```

**Answer**:

**User Model (from `prisma/schema.prisma`):**
```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String
  passwordHash   String?  // Optional for OAuth-only users
  role           String   @default("viewer")
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  createdBy      String?
  externalAgency String?  // Links recruiter to their External Agency

  // Relations
  savedReports        SavedReport[]
  gameScores          GameScore[]
  passwordResetTokens PasswordResetToken[]
}
```

**User CRUD Functions (from `src/lib/users.ts`):**
- `validateUser(email, password)` - Validate login credentials
- `getUserByEmail(email)` - Get user by email
- `getUserById(id)` - Get user by ID
- `getAllUsers()` - Get all users
- `createUser(data, createdBy)` - Create new user
- `updateUser(id, data)` - Update user
- `deleteUser(id)` - Delete user
- `resetPassword(id, newPassword?)` - Reset password

**How to add a new "RevOps Admin" role:**

1. **Update `src/types/user.ts`** - Add to role union types:
```typescript
role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin';
```

2. **Update `src/lib/permissions.ts`** - Add role definition:
```typescript
revops_admin: {
  role: 'revops_admin',
  allowedPages: [1, 3, 7, 10, 13], // Include new Dashboard Requests page (13)
  canExport: true,
  canManageUsers: false,
}
```

3. **Update `src/components/settings/UserModal.tsx`** - Add role option:
```jsx
<option value="revops_admin">RevOps Admin - Full access to Dashboard Requests</option>
```

---

## Phase 2: API Patterns & Integration Architecture

### 2.1 Standard API Route Pattern
**Explore**: Document the standard pattern for API routes in this codebase.

```
Examine 2-3 API routes (e.g., src/app/api/sga-hub/weekly-goals/route.ts) and document:
1. How authentication is handled
2. How permissions are checked
3. How database queries are made (Prisma vs BigQuery)
4. Standard error handling pattern
5. Response format pattern
```

**Answer**:

**Standard API Route Pattern:**

```typescript
// 1. Force dynamic rendering
export const dynamic = 'force-dynamic';

// 2. Authentication check
const session = await getServerSession(authOptions);
if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// 3. Get permissions
const permissions = await getUserPermissions(session.user.email);

// 4. Role/access check
if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// 5. Parse query params / body
const { searchParams } = new URL(request.url);
const body = await request.json(); // For POST/PUT

// 6. Database operations (Prisma for CRUD, BigQuery for analytics)
const data = await prisma.model.findMany({ ... });
// OR
const results = await bigQueryClient.query({ ... });

// 7. Success response
return NextResponse.json({ data });

// 8. Error handling (in catch block)
catch (error) {
  console.error('[API] Error:', error);
  return NextResponse.json(
    { error: 'Human-readable error message' },
    { status: 500 }
  );
}
```

**Key patterns:**
- Auth: `getServerSession(authOptions)` from NextAuth
- Permissions: `getUserPermissions(email)` from `@/lib/permissions`
- Responses: Always `NextResponse.json({ ... })`
- Error codes: 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 500 (Server Error)

---

### 2.2 External API Integrations
**Explore**: Find examples of external API integrations in the codebase.

```
Search for:
1. Any existing third-party API integrations (e.g., SendGrid, Google Sheets)
2. How API keys are handled from .env
3. How external API errors are handled
4. Any retry logic or rate limiting for external calls

Document the patterns found in: src/lib/email.ts, src/lib/sheets/, or similar files.
```

**Answer**:

**SendGrid Integration Pattern (from `src/lib/email.ts`):**

```typescript
import sgMail from '@sendgrid/mail';

// Initialize at module level with env var
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

// Function pattern
export async function sendEmail({ to, subject, text, html }): Promise<boolean> {
  const from = process.env.EMAIL_FROM;

  // Validate config exists
  if (!apiKey || !from) {
    console.error('Email configuration missing');
    return false;
  }

  try {
    await sgMail.send({ to, from, subject, text, html });
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error('SendGrid email error:', error);
    return false; // Returns false instead of throwing
  }
}
```

**Key patterns for external APIs:**
- Initialize client at module level
- Check for required env vars before operations
- Return `boolean` success indicator (don't throw on external failures)
- Log errors with descriptive prefix
- Use `process.env.VAR_NAME` directly (no validation library)

**Database retry logic (from `src/lib/users.ts`):**
```typescript
async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  // Exponential backoff for connection errors
  await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
}
```

---

### 2.3 Environment Variable Patterns
**Explore**: Understand how environment variables are accessed and validated.

```
Search the codebase for:
1. How SENDGRID_API_KEY is used
2. How GOOGLE_APPLICATION_CREDENTIALS is used
3. Any environment variable validation patterns
4. Check if there's an env.ts or similar validation file

Document the standard pattern for using env vars in this project.
```

**Answer**:

**Environment Variable Pattern:**

1. **Direct access** - No validation library, accessed directly:
```typescript
const apiKey = process.env.SENDGRID_API_KEY;
const from = process.env.EMAIL_FROM;
```

2. **Runtime checks** - Validation at function call time:
```typescript
if (!apiKey || !from) {
  console.error('Configuration missing: VAR_NAME not set');
  return false;
}
```

3. **No centralized env.ts validation file** - Each module validates what it needs

**Current env vars used (from `.env.example`):**
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL` - Auth
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth
- `DATABASE_URL` - PostgreSQL/Neon
- `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` - BigQuery
- `ANTHROPIC_API_KEY` - Claude for Explore feature
- `SENDGRID_API_KEY`, `EMAIL_FROM` - Email
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` - Rate limiting
- `SENTRY_DSN` - Error monitoring
- `WRIKE_ACCESS_TOKEN` - Wrike API (already added)

**Pattern for Wrike integration:**
```typescript
const WRIKE_ACCESS_TOKEN = process.env.WRIKE_ACCESS_TOKEN;
const WRIKE_FOLDER_ID = process.env.WRIKE_FOLDER_ID;

if (!WRIKE_ACCESS_TOKEN) {
  console.error('Wrike configuration missing: WRIKE_ACCESS_TOKEN not set');
  throw new Error('Wrike not configured');
}
```

---

## Phase 3: Database & Data Persistence

### 3.1 Prisma Schema Analysis
**Explore**: Understand the full Prisma schema for planning new models.

```
Read prisma/schema.prisma completely and document:
1. All existing models and their relationships
2. How IDs are generated (cuid, uuid, autoincrement?)
3. How timestamps are handled
4. Any enums defined
5. The database connection string pattern
```

**Answer**:

**Existing Models:**
1. `User` - Dashboard users (roles, auth)
2. `PasswordResetToken` - Password reset tokens (1:N with User)
3. `WeeklyGoal` - SGA weekly targets
4. `QuarterlyGoal` - SGA quarterly targets
5. `ManagerQuarterlyGoal` - Team-level quarterly targets
6. `ExploreFeedback` - AI explore feature feedback
7. `GameScore` - Pipeline Catcher game scores (1:N with User)
8. `SavedReport` - Saved filter configurations (1:N with User)

**ID Generation:** Uses `cuid()` for all models:
```prisma
id String @id @default(cuid())
```

**Timestamp Pattern:**
```prisma
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

**Audit Trail Pattern:**
```prisma
createdBy String?  // Email of user who created
updatedBy String?  // Email of user who last updated
```

**No enums defined** - Roles stored as `String` with validation in TypeScript

**Database Connection:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Proposed DashboardRequest Model:**
```prisma
model DashboardRequest {
  id               String   @id @default(cuid())
  title            String
  description      String   @db.Text
  requestType      String   // 'bug' | 'feature' | 'enhancement' | 'data'
  priority         String   @default("medium") // 'low' | 'medium' | 'high' | 'urgent'
  status           String   @default("submitted") // 'submitted' | 'planned' | 'in_progress' | 'done'

  // Wrike sync
  wrikeTaskId      String?  @unique
  wrikePermalink   String?

  // Submitter info
  submitterEmail   String
  submitterName    String

  // Timestamps
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  // Relations
  notes            DashboardRequestNote[]

  @@index([status])
  @@index([submitterEmail])
  @@index([wrikeTaskId])
}

model DashboardRequestNote {
  id        String   @id @default(cuid())
  requestId String
  request   DashboardRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  authorEmail String
  authorName  String
  content   String   @db.Text
  source    String   @default("dashboard") // 'dashboard' | 'wrike'
  createdAt DateTime @default(now())

  @@index([requestId])
}
```

---

### 3.2 Data Mutation Patterns
**Explore**: Understand how data is created/updated in this codebase.

```
Find examples of:
1. Creating records via Prisma (e.g., WeeklyGoal creation)
2. Updating records via Prisma
3. How transactions are used (if any)
4. How audit trails are maintained (createdBy, updatedAt, etc.)

Document the patterns from src/app/api/sga-hub/ routes.
```

**Answer**:

**Create Pattern (upsert with audit):**
```typescript
const goal = await prisma.weeklyGoal.upsert({
  where: {
    userEmail_weekStartDate: {
      userEmail,
      weekStartDate: new Date(goalInput.weekStartDate),
    },
  },
  update: {
    initialCallsGoal: goalInput.initialCallsGoal,
    updatedBy: createdBy, // Audit trail
  },
  create: {
    userEmail,
    weekStartDate: new Date(goalInput.weekStartDate),
    initialCallsGoal: goalInput.initialCallsGoal,
    createdBy, // Audit trail
  },
});
```

**Update Pattern:**
```typescript
const user = await prisma.user.update({
  where: { id },
  data: {
    name: data.name,
    role: data.role,
    // updatedAt is automatic via @updatedAt
  },
});
```

**No explicit transactions found** - Single operations are atomic

**Audit Trail Pattern:**
- `createdBy`: Email of user who created (from `session.user.email`)
- `updatedBy`: Email of user who last updated
- `createdAt`: Auto-set via `@default(now())`
- `updatedAt`: Auto-updated via `@updatedAt`

---

## Phase 4: UI Component Patterns

### 4.1 Modal Components
**Explore**: Understand how modals are implemented in this codebase.

```
Examine:
1. src/components/dashboard/RecordDetailModal.tsx
2. src/components/sga-hub/MetricDrillDownModal.tsx
3. src/components/settings/UserModal.tsx

Document:
- Modal structure pattern
- How open/close state is managed
- How forms within modals work
- How loading/error states are displayed
```

**Answer**:

**Modal Structure Pattern (from `UserModal.tsx`):**

```tsx
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;  // Callback after successful save
  data?: DataType | null; // Optional for edit mode
}

function Modal({ isOpen, onClose, onSaved, data }: ModalProps) {
  const [formData, setFormData] = useState({...});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Modal content */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        {/* Header with close button */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Form fields */}
          <button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

**State management:** Parent component manages `isOpen` state:
```tsx
const [modalOpen, setModalOpen] = useState(false);
<Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
```

---

### 4.2 Table Components
**Explore**: Find table/list component patterns.

```
Examine table components like:
1. src/components/sga-hub/AdminSGATable.tsx
2. Any other table components in src/components/

Document:
- How data is passed and rendered
- How sorting/filtering works
- How pagination works (if any)
- How row actions (click, edit, delete) are handled
```

**Answer**:

**Table Pattern (from `RecruiterHubContent.tsx`):**

```tsx
// Pagination state
const ROWS_PER_PAGE = 150;
const [page, setPage] = useState(1);
const totalPages = Math.ceil(filteredData.length / ROWS_PER_PAGE);
const paginatedData = filteredData.slice(
  (page - 1) * ROWS_PER_PAGE,
  page * ROWS_PER_PAGE
);

// Sorting state
const [sortKey, setSortKey] = useState<string | null>('advisor_name');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

// Sort function
const sortedData = [...filteredData].sort((a, b) => {
  const mult = sortDir === 'asc' ? 1 : -1;
  return mult * (a[key] < b[key] ? -1 : 1);
});

// Sortable header component
const SortableTh = ({ label, sortKey, currentKey, currentDir, onSort }) => (
  <th>
    <button onClick={() => onSort(sortKey)}>
      {label}
      <ArrowUp className={currentDir === 'asc' ? 'text-blue-600' : ''} />
      <ArrowDown className={currentDir === 'desc' ? 'text-blue-600' : ''} />
    </button>
  </th>
);

// Row click handler
<tr onClick={() => setSelectedRecordId(record.id)} className="cursor-pointer">
```

**Pagination controls:**
```tsx
<button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
  <ChevronLeft />
</button>
<span>Page {page} of {totalPages}</span>
<button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
  <ChevronRight />
</button>
```

---

### 4.3 Form Components
**Explore**: Understand form patterns in the codebase.

```
Look for form implementations:
1. src/components/settings/UserModal.tsx form
2. Any filter forms in dashboard components
3. How validation is handled
4. How form state is managed (useState vs react-hook-form vs other)

Document the standard form pattern used.
```

**Answer**:

**Form Pattern:** Uses `useState` (no react-hook-form library)

```tsx
const [formData, setFormData] = useState({
  email: '',
  name: '',
  role: 'viewer' as const,
});

// Field change handlers
onChange={(e) => setFormData({ ...formData, name: e.target.value })}

// Select handler
onChange={(e) => handleRoleChange(e.target.value)}

// Validation: HTML5 + runtime checks
<input type="email" required minLength={8} />

// Submit handler
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);
  setError(null);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to save');
    }

    onSaved(); // Success callback
  } catch (err: any) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

---

### 4.4 Status/Badge Components
**Explore**: Find components that display status indicators.

```
Search for:
1. How stage badges are rendered (see RecruiterHubContent.tsx STAGE_COLORS)
2. Any status pill/badge components
3. How priority indicators are displayed elsewhere

Document how we could create status badges for: Submitted, Planned/Prioritized, In Progress, Done
```

**Answer**:

**Status Badge Pattern (from `RecruiterHubContent.tsx`):**

```tsx
const STAGE_COLORS: Record<string, string> = {
  Qualifying: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Discovery: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  Signed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Closed Lost': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

// Usage
<span className={`px-2 py-1 text-xs font-medium rounded ${STAGE_COLORS[status]}`}>
  {status}
</span>
```

**Proposed Dashboard Request Status Colors:**

```tsx
const REQUEST_STATUS_COLORS: Record<string, string> = {
  'Submitted': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  'Planned': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  'In Progress': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  'Done': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  'On Hold': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

const REQUEST_PRIORITY_COLORS: Record<string, string> = {
  'Low': 'bg-green-100 text-green-800',
  'Medium': 'bg-yellow-100 text-yellow-800',
  'High': 'bg-red-100 text-red-800',
  'Urgent': 'bg-red-200 text-red-900 font-semibold',
};
```

---

## Phase 5: Page Structure Patterns

### 5.1 Page Layout Pattern
**Explore**: Understand how dashboard pages are structured.

```
Examine:
1. src/app/dashboard/sga-hub/page.tsx (server component)
2. src/app/dashboard/sga-hub/SGAHubContent.tsx (client component)

Document:
- How server-side auth/permission checks work
- How the page content is split between server and client components
- How page-level state is managed
```

**Answer**:

**Server Component (page.tsx):**
```tsx
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { PageContent } from './PageContent';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // 1. Check authentication
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect('/login');
  }

  // 2. Check permissions
  const permissions = await getUserPermissions(session.user.email);
  if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
    redirect('/dashboard');
  }

  // 3. Render client component (no props needed - it fetches its own data)
  return <PageContent />;
}
```

**Client Component (PageContent.tsx):**
```tsx
'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

export function PageContent() {
  const { data: session } = useSession();
  const [permissions, setPermissions] = useState(null);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch permissions client-side
  useEffect(() => {
    fetch('/api/auth/permissions')
      .then(res => res.json())
      .then(setPermissions);
  }, []);

  // Fetch page data
  useEffect(() => {
    fetchData();
  }, [filters]);

  return (
    <div className="space-y-6">
      <Title>Page Title</Title>
      <Card>{/* Content */}</Card>
    </div>
  );
}
```

---

### 5.2 Tab/Section Navigation
**Explore**: Find examples of tabbed interfaces or section navigation.

```
Search for tab implementations:
1. Look for any TabGroup, Tabs components
2. How does SGA Hub handle different sections (Weekly Goals, Quarterly Progress, etc.)?
3. How is active tab state managed?

Document how tabs/sections are implemented if we need a Kanban view.
```

**Answer**:

**No formal tab components found.** The codebase uses:

1. **Collapsible sections** with chevrons (see RecruiterHubContent filters)
2. **View mode toggles** via buttons/state

**For Kanban view, recommend:**
```tsx
const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');

// Toggle buttons
<div className="flex gap-2">
  <button
    onClick={() => setViewMode('list')}
    className={viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-200'}
  >
    <List className="w-4 h-4" /> List
  </button>
  <button
    onClick={() => setViewMode('kanban')}
    className={viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'bg-gray-200'}
  >
    <Columns className="w-4 h-4" /> Board
  </button>
</div>

// Conditional render
{viewMode === 'list' ? <RequestsTable /> : <KanbanBoard />}
```

---

### 5.3 Sidebar Integration
**Explore**: Understand how to add a new page to the sidebar.

```
Read src/components/layout/Sidebar.tsx and document:
1. The PAGES array structure
2. How page icons are assigned
3. How the sidebar filters pages based on allowedPages
4. What the next available page ID would be
```

**Answer**:

**PAGES Array Structure (from `Sidebar.tsx`):**
```tsx
import { BarChart3, Settings, Target, Bot, Users, Layers, Briefcase } from 'lucide-react';

const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Layers },
  { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot },
  { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: Target },
  { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
  { id: 12, name: 'Recruiter Hub', href: '/dashboard/recruiter-hub', icon: Briefcase },
  { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
];
```

**Filtering:**
```tsx
const filteredPages = PAGES.filter(page => allowedPages.includes(page.id));
```

**To add Dashboard Requests page:**
```tsx
import { ClipboardList } from 'lucide-react'; // or MessageSquarePlus, FileText

// Add to PAGES array (before Settings)
{ id: 13, name: 'Dashboard Requests', href: '/dashboard/requests', icon: ClipboardList },
```

**Then update permissions.ts** to include page `13` for appropriate roles.

---

## Phase 6: Wrike API Exploration

> **Environment Variables Available:**
> - `WRIKE_CLIENT_ID` - OAuth client ID (not needed for API calls)
> - `WRIKE_CLIENT_SECRET` - OAuth client secret (not needed for API calls)
> - `WRIKE_ACCESS_TOKEN` - **Permanent access token - USE THIS for all API calls**
>
> **Wrike API Base URL:** `https://www.wrike.com/api/v4`
>
> **Target Project ID:** `4362507163` (from URL: https://www.wrike.com/open.htm?id=4362507163)

### 6.1 Wrike API Authentication Test
**Explore**: Verify the permanent access token works and understand the API.

```bash
# Test 1: Verify token works - Get current user info
curl -X GET "https://www.wrike.com/api/v4/contacts?me=true" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"

# Test 2: Get account information
curl -X GET "https://www.wrike.com/api/v4/account" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"
```

**Document:**
1. Confirm the API responds successfully (200 OK)
2. Note the account ID returned
3. Note the user ID for the token owner
4. Document the response structure pattern

**Answer**:

**API Authentication: CONFIRMED WORKING**

**Account Information:**
- Account ID: `IEAGT6KA`
- Account Name: `Savvy`
- Root Folder ID: `IEAGT6KAI7777777`
- Recycle Bin ID: `IEAGT6KAI7777776`

**Token Owner:**
- User ID: `KUAW54XY`
- Name: Russell Moss
- Email: russell.moss@savvywealth.com
- Role: User (not Admin)
- Title: RevOps Manager

**Response Structure Pattern:**
```json
{
  "kind": "contacts",  // or "accounts", "tasks", etc.
  "data": [
    { /* item 1 */ },
    { /* item 2 */ }
  ]
}
```

---

### 6.2 Wrike Folder/Project Structure Discovery
**Explore**: Find and understand the target project structure.

```bash
# The ID 4362507163 from the URL needs to be converted to Wrike's permalink format
# First, let's get all folders to find our project

# Get all folders in the account
curl -X GET "https://www.wrike.com/api/v4/folders" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"

# Once you find the folder ID, get its details:
curl -X GET "https://www.wrike.com/api/v4/folders/{FOLDER_ID}" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"

# Get tasks within the folder:
curl -X GET "https://www.wrike.com/api/v4/folders/{FOLDER_ID}/tasks" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"
```

**Document:**
1. The actual folder/project ID for "Dashboard Requests" project
2. Any subfolders structure
3. Existing tasks (if any) and their structure
4. The folder's workflow ID (for status management)

**Answer**:

**Dashboard Requests Folder:**
- **Folder ID: `MQAAAAEEBpOb`**
- **Title: "Dashboards"**
- **Scope: WsFolder (Workspace Folder)**
- **Parent: "Rev Ops Q1" (`MQAAAAECDb_7`)**
- **No subfolders**

**Folder Hierarchy:**
```
Root (IEAGT6KAI7777777)
└── Rev Ops Q1 (MQAAAAECDb_7)
    ├── Marketing + Partnerships
    ├── SGA
    ├── SGM
    ├── Advisor Success
    ├── Dashboards (MQAAAAEEBpOb) ← TARGET FOLDER
    └── Rev Ops
```

**Folder uses Default Workflow** (customStatusId: `IEAGT6KAJMAAAAAA` = "Requested")

---

### 6.3 Wrike Workflows & Custom Statuses
**Explore**: Understand how task statuses work in Wrike.

```bash
# Get all workflows in the account
curl -X GET "https://www.wrike.com/api/v4/workflows" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"

# This will show you:
# - Available workflow IDs
# - Custom statuses within each workflow
# - Status IDs needed for creating/updating tasks
```

**Document:**
1. List all available workflows
2. For each workflow, list the custom statuses (name and ID)
3. Identify which workflow/statuses map to: Submitted, Planned/Prioritized, In Progress, Done
4. Note the default workflow ID

**Answer**:

**Default Workflow (ID: `IEAGT6KAK77ZMBWA`)** - USE THIS

| Status | ID | Color | Group | Map To |
|--------|-----|-------|-------|--------|
| **Requested** | `IEAGT6KAJMAAAAAA` | Gray | Active | **Submitted** |
| **In Progress** | `IEAGT6KAJMF7ZXTO` | Blue | Active | **In Progress** |
| Compliance Review | `IEAGT6KAJMGFKCK6` | Yellow | Active | - |
| Needs Changes | `IEAGT6KAJMGFOACW` | DarkRed | Active | - |
| In Design | `IEAGT6KAJMGFKCLS` | Indigo | Active | **Planned** |
| **Completed** | `IEAGT6KAJMAAAAAB` | Green | Completed | **Done** |
| Compliance Approved | `IEAGT6KAJMGIAG2Z` | Green | Completed | - |
| **On Hold** | `IEAGT6KAJMAAAAAC` | Gray | Deferred | On Hold |
| **Cancelled** | `IEAGT6KAJMAAAAAD` | DarkRed | Cancelled | Cancelled |

**Status Mapping for Dashboard Requests:**
- **Submitted** → `IEAGT6KAJMAAAAAA` (Requested)
- **Planned/Prioritized** → `IEAGT6KAJMGFKCLS` (In Design) - repurpose
- **In Progress** → `IEAGT6KAJMF7ZXTO` (In Progress)
- **Done** → `IEAGT6KAJMAAAAAB` (Completed)

---

### 6.4 Wrike Custom Fields
**Explore**: Discover available custom fields for tasks.

```bash
# Get all custom fields in the account
curl -X GET "https://www.wrike.com/api/v4/customfields" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"
```

**Document:**
1. List all custom fields (ID, title, type)
2. Identify fields that could map to: Priority, Request Type, Submitter, etc.
3. Note any dropdown fields and their options
4. Determine if we need to create new custom fields

**Answer**:

**Relevant Custom Fields Found:**

| Field | ID | Type | Values | Use For |
|-------|-----|------|--------|---------|
| **Priority** | `IEAGT6KAJUAKJULP` | DropDown | Low, Medium, High, Pre-Committed | Request Priority |
| **Requesting Team** | `IEAGT6KAJUAKEJUP` | Multiple | Marketing, SGA, SGM, Post-Sales, Finance, Platform Services, Rev Ops, Other | Submitter Team |
| **Size of Ask** | `IEAGT6KAJUAKEJVQ` | DropDown | Small, Medium, Large, Project/Epic | Effort estimate |
| **Latest Status** | `IEAGT6KAJUAKJM2W` | Text | - | Status notes |
| **Blocked Reason** | `IEAGT6KAJUAKJULA` | Text | - | Blocker notes |
| **Target Complete Week** | `IEAGT6KAJUAKEJWL` | Date | - | ETA |

**May need to create:**
- **Request Type** (Bug, Feature, Enhancement, Data Request)
- **Submitter Email** (for mapping back to dashboard users)

OR use the task description to embed this metadata as structured text.

---

### 6.5 Wrike Task Creation Test
**Explore**: Test creating a task via API.

```bash
# Create a test task in the target folder
# Replace {FOLDER_ID} with the actual folder ID from 6.2

curl -X POST "https://www.wrike.com/api/v4/folders/{FOLDER_ID}/tasks" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "TEST - Dashboard Request API Test",
    "description": "This is a test task created via API. Safe to delete.",
    "status": "Active",
    "importance": "Normal"
  }'
```

**Document:**
1. The response structure when creating a task
2. The task ID format returned
3. Required vs optional fields for task creation
4. How to set custom field values on creation

**Answer**:

**Task Creation: CONFIRMED WORKING**

**Request:**
```bash
POST /api/v4/folders/MQAAAAEEBpOb/tasks
{
  "title": "TEST - Dashboard Request API Test",
  "description": "This is a test task created via API.",
  "customStatus": "IEAGT6KAJMAAAAAA",
  "importance": "Normal"
}
```

**Response:**
```json
{
  "kind": "tasks",
  "data": [{
    "id": "MAAAAAEEBsb7",
    "permalink": "https://www.wrike.com/open.htm?id=4362520315",
    "customStatusId": "IEAGT6KAJMAAAAAA",
    "status": "Active",
    ...
  }]
}
```

**Task ID format:** 12-character alphanumeric (e.g., `MAAAAAEEBsb7`)

**Required fields:** `title` only

**Setting custom fields on creation:**
```json
{
  "title": "Request Title",
  "description": "Description",
  "customStatus": "IEAGT6KAJMAAAAAA",
  "customFields": [
    {"id": "IEAGT6KAJUAKJULP", "value": "Medium"},
    {"id": "IEAGT6KAJUAKEJUP", "value": ["Rev Ops"]}
  ]
}
```

---

### 6.6 Wrike Task Update Test
**Explore**: Test updating a task's status and fields.

```bash
# Update the test task created above
# Replace {TASK_ID} with the ID from 6.5

# Update status (use a status ID from 6.3)
curl -X PUT "https://www.wrike.com/api/v4/tasks/{TASK_ID}" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customStatus": "{STATUS_ID}"
  }'

# Add a comment to the task
curl -X POST "https://www.wrike.com/api/v4/tasks/{TASK_ID}/comments" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Test comment from Dashboard API integration"
  }'

# Delete the test task when done
curl -X DELETE "https://www.wrike.com/api/v4/tasks/{TASK_ID}" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"
```

**Document:**
1. How to update task status using customStatus
2. How comments are added and structured
3. Response format for updates
4. Confirm delete works

**Answer**:

**All operations CONFIRMED WORKING:**

**Update Status:**
```bash
PUT /api/v4/tasks/MAAAAAEEBsb7
{"customStatus": "IEAGT6KAJMF7ZXTO"}
# Response: Updated task with new customStatusId
```

**Add Comment:**
```bash
POST /api/v4/tasks/MAAAAAEEBsb7/comments
{"text": "Comment text here"}
# Response:
{
  "kind": "comments",
  "data": [{
    "id": "IEAGT6KAIMGALS45",
    "authorId": "KUAW54XY",
    "text": "Test comment from Dashboard API integration",
    "taskId": "MAAAAAEEBsb7"
  }]
}
```

**Delete Task:**
```bash
DELETE /api/v4/tasks/MAAAAAEEBsb7
# Response: Task data with scope changed to "RbTask" (Recycle Bin)
```

---

### 6.7 Wrike Webhooks for Bi-Directional Sync
**Explore**: Research and test webhook capabilities.

```bash
# List existing webhooks
curl -X GET "https://www.wrike.com/api/v4/webhooks" \
  -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN"

# Webhook creation would look like this (DON'T RUN YET - need endpoint first):
# curl -X POST "https://www.wrike.com/api/v4/webhooks" \
#   -H "Authorization: Bearer $WRIKE_ACCESS_TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{
#     "hookUrl": "https://your-dashboard-url/api/webhooks/wrike",
#     "events": ["TaskStatusChanged", "TaskUpdated", "CommentAdded"]
#   }'
```

**Document from API response AND Wrike docs (https://developers.wrike.com/webhooks/):**
1. Available webhook event types
2. Webhook payload structure for task updates
3. Webhook security (how to verify requests are from Wrike)
4. Webhook limitations (rate limits, retry behavior)
5. Whether we need a publicly accessible URL (implications for Vercel deployment)

**Answer**:

**Current Webhooks:** None configured (`{"kind": "webhooks", "data": []}`)

**Available Webhook Events:**
- `TaskCreated`, `TaskDeleted`, `TaskTitleChanged`
- `TaskStatusChanged`, `TaskDatesChanged`, `TaskImportanceChanged`
- `TaskAssigneesChanged`, `TaskParentsChanged`
- `CommentAdded`, `CommentDeleted`
- `AttachmentAdded`, `AttachmentDeleted`

**Webhook Security:**
- Wrike sends `X-Hook-Secret` header on first request (handshake)
- Dashboard must store this secret and verify subsequent requests
- Can filter by folder: `"folderId": "MQAAAAEEBpOb"`

**Webhook Payload Example:**
```json
{
  "event": "TaskStatusChanged",
  "taskId": "MAAAAAEEBsb7",
  "oldStatus": "IEAGT6KAJMAAAAAA",
  "newStatus": "IEAGT6KAJMF7ZXTO"
}
```

**Vercel Deployment:** Works fine - webhooks just need a publicly accessible HTTPS endpoint

**Recommendation:** Start with one-way sync (Dashboard → Wrike), add webhooks later for bi-directional sync

---

### 6.8 Wrike API Summary
**Synthesize**: Create a summary of the Wrike integration approach.

Based on all the exploration above, document:

```
1. FOLDER_ID for Dashboard Requests project: MQAAAAEEBpOb
2. WORKFLOW_ID to use: IEAGT6KAK77ZMBWA (Default Workflow)
3. STATUS MAPPINGS:
   - Submitted → Status ID: IEAGT6KAJMAAAAAA (Requested)
   - Planned/Prioritized → Status ID: IEAGT6KAJMGFKCLS (In Design)
   - In Progress → Status ID: IEAGT6KAJMF7ZXTO (In Progress)
   - Done → Status ID: IEAGT6KAJMAAAAAB (Completed)

4. CUSTOM FIELDS TO USE:
   - Priority → Field ID: IEAGT6KAJUAKJULP (Low/Medium/High/Pre-Committed)
   - Request Type → Use description (needs creation or embed in title/desc)
   - Submitter Email → Use description (embed as metadata)
   - Requesting Team → Field ID: IEAGT6KAJUAKEJUP

5. API PATTERNS:
   - Create task: POST /folders/{folderId}/tasks
   - Update status: PUT /tasks/{taskId} with customStatus
   - Add note: POST /tasks/{taskId}/comments
   - Get task: GET /tasks/{taskId}

6. WEBHOOK SETUP REQUIRED:
   - Not immediately (start with one-way sync)
   - Events needed: TaskStatusChanged, CommentAdded
   - Endpoint URL pattern: /api/webhooks/wrike
```

**Answer**:

**WRIKE INTEGRATION SUMMARY - READY FOR IMPLEMENTATION**

```
FOLDER_ID:    MQAAAAEEBpOb
WORKFLOW_ID:  IEAGT6KAK77ZMBWA (Default Workflow)

STATUS MAPPINGS:
┌─────────────────────┬──────────────────────┬────────────┐
│ Dashboard Status    │ Wrike Status ID      │ Wrike Name │
├─────────────────────┼──────────────────────┼────────────┤
│ Submitted           │ IEAGT6KAJMAAAAAA     │ Requested  │
│ Planned/Prioritized │ IEAGT6KAJMGFKCLS     │ In Design  │
│ In Progress         │ IEAGT6KAJMF7ZXTO     │ In Progress│
│ Done                │ IEAGT6KAJMAAAAAB     │ Completed  │
│ On Hold             │ IEAGT6KAJMAAAAAC     │ On Hold    │
│ Cancelled           │ IEAGT6KAJMAAAAAD     │ Cancelled  │
└─────────────────────┴──────────────────────┴────────────┘

CUSTOM FIELDS:
- Priority:        IEAGT6KAJUAKJULP (DropDown: Low/Medium/High/Pre-Committed)
- Requesting Team: IEAGT6KAJUAKEJUP (Multiple: Marketing/SGA/SGM/etc.)
- Size of Ask:     IEAGT6KAJUAKEJVQ (DropDown: Small/Medium/Large/Project)

API ENDPOINTS:
- Create: POST /api/v4/folders/MQAAAAEEBpOb/tasks
- Update: PUT /api/v4/tasks/{taskId}
- Comment: POST /api/v4/tasks/{taskId}/comments
- Get: GET /api/v4/tasks/{taskId}
- Delete: DELETE /api/v4/tasks/{taskId}

WEBHOOK SETUP: Phase 2 (not required for MVP)
```

---

## Phase 7: Existing Similar Features

### 7.1 Closed Lost / Re-Engagement Pattern
**Explore**: The SGA Hub has a similar "workflow" feature - analyze it.

```
Examine:
1. src/app/api/sga-hub/closed-lost/ routes
2. src/app/api/sga-hub/re-engagement/ routes
3. How records move between states
4. How notes/comments are stored and displayed

This pattern may be similar to what we need for Dashboard Requests.
```

**Answer**:

**Closed Lost / Re-Engagement Pattern:**

These routes query BigQuery for Salesforce data, not Prisma. They don't create/update local records.

**Key patterns that apply:**
1. **Filter by user context:**
   - `showAll` param for admins to see everything
   - `sgaName` filter for non-admins

2. **Time bucket filtering:**
   - `timeBuckets` param with values like `'30-60'`, `'60-90'`

3. **User lookup pattern:**
   ```typescript
   const user = await prisma.user.findUnique({
     where: { email: session.user.email },
     select: { name: true },
   });
   sgaName = user.name;
   ```

**Notes are NOT stored locally** - they likely use Salesforce fields. For Dashboard Requests, we'll store notes in a separate `DashboardRequestNote` model AND sync to Wrike comments.

---

### 7.2 Any Kanban-like Components
**Explore**: Search for any drag-and-drop or Kanban implementations.

```
Search the codebase for:
1. Any existing drag-and-drop libraries (e.g., react-beautiful-dnd, dnd-kit)
2. Any Kanban or board-style components
3. Any column/lane layouts

If none exist, note what libraries are already in package.json that could be used.
```

**Answer**:

**No existing drag-and-drop or Kanban components found.**

**Current dependencies that could help:**
- `@tremor/react` - Has Card, Grid components but no Kanban
- `lucide-react` - Has icons (Columns, LayoutGrid, List)
- `tailwindcss` - CSS for styling

**Recommendation for Kanban:**

Option 1: **Simple CSS Grid (No library)** - Recommended for MVP
```tsx
<div className="grid grid-cols-4 gap-4">
  {['Submitted', 'Planned', 'In Progress', 'Done'].map(status => (
    <div key={status} className="bg-gray-100 rounded-lg p-4">
      <h3 className="font-semibold mb-4">{status}</h3>
      {requests.filter(r => r.status === status).map(request => (
        <RequestCard key={request.id} request={request} />
      ))}
    </div>
  ))}
</div>
```

Option 2: **@dnd-kit/core** - For drag-and-drop later
- Lightweight, accessible, modern
- Would need to install: `npm install @dnd-kit/core @dnd-kit/sortable`

---

## Phase 8: Testing & Error Handling

### 8.1 Error Handling Patterns
**Explore**: Document how errors are handled throughout the app.

```
Search for:
1. How API errors are returned (status codes, error format)
2. How client-side errors are displayed (toast notifications? inline errors?)
3. How Sentry is used for error tracking
4. Any ErrorBoundary components
```

**Answer**:

**API Error Pattern:**
```typescript
// Standard error responses
return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
return NextResponse.json({ error: 'Not found' }, { status: 404 });
return NextResponse.json({ error: 'Failed to save' }, { status: 500 });

// With logging
catch (error) {
  console.error('[API] Error fetching data:', error);
  return NextResponse.json({ error: 'Human-readable message' }, { status: 500 });
}
```

**Client-Side Error Display:**
- Inline error messages (no toast library):
```tsx
{error && (
  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
    {error}
  </div>
)}
```

**Sentry Integration:**
- `@sentry/nextjs` is installed
- Configured via `instrumentation.ts` and `sentry.*.config.ts`
- Auto-captures unhandled errors

**ErrorBoundary Component (`src/components/ui/ErrorBoundary.tsx`):**
```tsx
<ErrorBoundary
  fallbackTitle="Something went wrong"
  fallbackMessage="An error occurred. Please try again."
  onReset={() => refetchData()}
>
  <ComponentThatMightFail />
</ErrorBoundary>
```

---

### 8.2 Loading State Patterns
**Explore**: Document how loading states are handled.

```
Search for:
1. LoadingSpinner component usage
2. Skeleton loading components
3. How loading states are managed in data fetching
4. Any suspense boundaries
```

**Answer**:

**LoadingSpinner Component (`src/components/ui/LoadingSpinner.tsx`):**
```tsx
export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  );
}
```

**Inline Loading Pattern:**
```tsx
const [loading, setLoading] = useState(true);

{loading ? (
  <div className="flex justify-center py-8">
    <Text>Loading...</Text>
  </div>
) : (
  <DataContent />
)}
```

**Button Loading State:**
```tsx
<button disabled={loading}>
  {loading ? 'Saving...' : 'Save'}
</button>
```

**No Suspense boundaries or skeleton components found** - Could add for better UX.

---

## Phase 9: Summary & Recommendations

### 9.1 Technical Summary
**Synthesize**: Based on all exploration above, create a summary.

```
Create a summary that includes:
1. Recommended approach for adding "RevOps Admin" role
2. Recommended page IDs for new pages
3. Database model design for DashboardRequest
4. API route structure recommendations
5. UI component recommendations
6. Wrike integration approach
```

**Answer**:

## TECHNICAL IMPLEMENTATION SUMMARY

### 1. Role System Changes

**Add RevOps Admin role:**
```typescript
// src/types/user.ts - Add to union type
role: '...' | 'revops_admin';

// src/lib/permissions.ts - Add role config
revops_admin: {
  role: 'revops_admin',
  allowedPages: [1, 3, 7, 10, 13], // Include Dashboard Requests (13)
  canExport: true,
  canManageUsers: false,
}
```

### 2. Page Configuration

- **Page ID: 13** for Dashboard Requests
- **Route: `/dashboard/requests`**
- **Icon: `ClipboardList` from lucide-react**

### 3. Database Schema

```prisma
model DashboardRequest {
  id               String   @id @default(cuid())
  title            String
  description      String   @db.Text
  requestType      String   // 'bug' | 'feature' | 'enhancement' | 'data'
  priority         String   @default("medium")
  status           String   @default("submitted")
  wrikeTaskId      String?  @unique
  wrikePermalink   String?
  submitterEmail   String
  submitterName    String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  notes            DashboardRequestNote[]
}

model DashboardRequestNote {
  id          String   @id @default(cuid())
  requestId   String
  request     DashboardRequest @relation(...)
  authorEmail String
  authorName  String
  content     String   @db.Text
  source      String   @default("dashboard")
  createdAt   DateTime @default(now())
}
```

### 4. API Routes

```
/api/dashboard-requests
  GET  - List all requests (filtered by role)
  POST - Create new request → Creates Wrike task

/api/dashboard-requests/[id]
  GET    - Get single request
  PUT    - Update request → Updates Wrike task
  DELETE - Delete request → Moves Wrike task to recycle bin

/api/dashboard-requests/[id]/notes
  GET  - Get notes for request
  POST - Add note → Creates Wrike comment

/api/webhooks/wrike (Phase 2)
  POST - Handle Wrike webhook events
```

### 5. UI Components

```
src/components/requests/
├── RequestForm.tsx        - Create/edit form (modal)
├── RequestCard.tsx        - Card for kanban/list view
├── RequestDetailModal.tsx - Full detail view
├── RequestsTable.tsx      - List view
├── KanbanBoard.tsx        - Board view (Phase 2)
└── StatusBadge.tsx        - Status/priority badges

src/app/dashboard/requests/
├── page.tsx               - Server component (auth)
└── RequestsContent.tsx    - Client component (UI)
```

### 6. Wrike Integration

**Phase 1 (MVP):** One-way sync (Dashboard → Wrike)
- Create task when request submitted
- Update task when request updated
- Add comment when note added

**Phase 2:** Bi-directional sync via webhooks
- Listen for status changes in Wrike
- Sync comments from Wrike to Dashboard

---

### 9.2 Identified Risks & Questions
**Document**: List any technical concerns or questions for the product owner.

```
Based on your exploration, list:
1. Technical risks or challenges
2. Questions that need product decisions
3. Dependencies that need to be installed
4. Any performance concerns
```

**Answer**:

## RISKS & OPEN QUESTIONS

### Technical Risks

1. **Wrike API Rate Limits**
   - Unknown exact limits
   - Mitigation: Implement request queuing if needed

2. **Webhook Reliability**
   - Webhooks can fail/miss events
   - Mitigation: Add manual "Sync from Wrike" button

3. **Data Consistency**
   - Dashboard and Wrike can get out of sync
   - Mitigation: Use Wrike as source of truth, periodic sync job

### Product Decisions Needed

1. **Who can submit requests?**
   - All users? Only certain roles?
   - Can users see only their own requests or all?

2. **Who can change status?**
   - Only RevOps Admin? Original submitter?

3. **Request Types**
   - Confirm: Bug, Feature, Enhancement, Data Request
   - Any others needed?

4. **Priority Levels**
   - Confirm: Low, Medium, High, Urgent
   - Who can set priority?

5. **Notifications**
   - Email on status change? On new comment?
   - Use existing SendGrid integration?

### Dependencies to Install

None required for MVP. Optional for Phase 2:
- `@dnd-kit/core` + `@dnd-kit/sortable` - For drag-and-drop Kanban

### Performance Concerns

1. **Wrike API Latency**
   - External API calls add ~200-500ms
   - Consider: Create in DB immediately, sync to Wrike async

2. **List View with Many Requests**
   - Current pagination (150/page) should handle
   - Add filters by status/submitter if needed

---

## Appendix: Key File References

After completing exploration, list the key files that will need to be modified or serve as templates:

### Files to MODIFY:

| Purpose | File Path |
|---------|-----------|
| Add RevOps Admin role | `src/lib/permissions.ts` |
| Add role type | `src/types/user.ts` |
| Add to sidebar | `src/components/layout/Sidebar.tsx` |
| Add Prisma model | `prisma/schema.prisma` |
| Update user modal for new role | `src/components/settings/UserModal.tsx` |

### Files to CREATE (new):

| Purpose | Suggested Path |
|---------|----------------|
| Wrike API client | `src/lib/wrike.ts` |
| Wrike types | `src/types/wrike.ts` |
| Dashboard Request types | `src/types/dashboard-request.ts` |
| Submit request API | `src/app/api/dashboard-requests/route.ts` |
| Update request API | `src/app/api/dashboard-requests/[id]/route.ts` |
| Wrike webhook handler | `src/app/api/webhooks/wrike/route.ts` |
| Request page (server) | `src/app/dashboard/requests/page.tsx` |
| Request page (client) | `src/app/dashboard/requests/RequestsContent.tsx` |
| Request form component | `src/components/requests/RequestForm.tsx` |
| Request card component | `src/components/requests/RequestCard.tsx` |
| Kanban board component | `src/components/requests/KanbanBoard.tsx` |
| Request detail modal | `src/components/requests/RequestDetailModal.tsx` |

### Template Files (use as reference):

| Purpose | Template File |
|---------|---------------|
| API route pattern | `src/app/api/sga-hub/weekly-goals/route.ts` |
| Page with auth check | `src/app/dashboard/sga-hub/page.tsx` |
| Client content component | `src/app/dashboard/sga-hub/SGAHubContent.tsx` |
| Modal component | `src/components/settings/UserModal.tsx` |
| Table component | `src/components/sga-hub/AdminSGATable.tsx` |
| Status badges | `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` (STAGE_COLORS) |
| External API integration | `src/lib/email.ts` (SendGrid pattern) |

### Environment Variables to Add:

```env
# Already added:
WRIKE_CLIENT_ID=xxx
WRIKE_CLIENT_SECRET=xxx
WRIKE_ACCESS_TOKEN=xxx

# Add for implementation:
WRIKE_FOLDER_ID=MQAAAAEEBpOb
# WRIKE_WEBHOOK_SECRET=xxx  # Add when implementing webhooks
```

---

### Wrike API Quick Reference

After completing Phase 6, fill in these values for easy reference during implementation:

```
WRIKE API BASE: https://www.wrike.com/api/v4
FOLDER_ID: MQAAAAEEBpOb
WORKFLOW_ID: IEAGT6KAK77ZMBWA

Status IDs:
- Submitted: IEAGT6KAJMAAAAAA
- Planned/Prioritized: IEAGT6KAJMGFKCLS
- In Progress: IEAGT6KAJMF7ZXTO
- Done: IEAGT6KAJMAAAAAB
- On Hold: IEAGT6KAJMAAAAAC
- Cancelled: IEAGT6KAJMAAAAAD

Custom Field IDs:
- Priority: IEAGT6KAJUAKJULP
- Requesting Team: IEAGT6KAJUAKEJUP
- Size of Ask: IEAGT6KAJUAKEJVQ
```

---

*Document completed by Claude Code on: 2026-01-29*
