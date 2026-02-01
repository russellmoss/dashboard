# Coach AI Implementation - Codebase Questions

> **Purpose**: Systematic exploration of the existing codebase to inform Coach AI implementation
> **For**: Claude Code to work through and answer each question directly in this document
> **Instructions**: Answer each question by adding an `**Answer:**` section below it. Mark phases as complete when done.

---

## Overview

The Coach AI feature will provide weekly AI-powered coaching insights for SGAs (Sales Growth Advisors). The feature should:
- Parse performance data for each SGA
- Compare individuals to peers and to goals
- Identify what top performers do differently
- Provide specific, actionable coaching recommendations
- Support individual SGA views AND admin/manager team overview

---

# PHASE 1: Existing Architecture & Patterns ✅ COMPLETE

## 1.1 SGA Hub Structure
**Goal**: Understand how the current SGA Hub is built

**Q1.1.1**: Examine `src/app/dashboard/sga-hub/page.tsx` and `src/app/dashboard/sga-hub/SGAHubContent.tsx`. Document:
- What tabs/sections currently exist in the SGA Hub?
- How is tab navigation implemented?
- How does the page handle different user roles (SGA vs Admin)?

**Answer:**

**Tabs/Sections (5 total):**
1. **Leaderboard** - Shows SGA rankings with SQO counts, filterable by quarter/channels/sources/SGAs
2. **Weekly Goals** - Tracks initial calls, qualification calls, and SQOs against weekly goals
3. **Closed Lost Follow-Up** - Shows closed lost records and re-engagement opportunities
4. **Quarterly Progress** - Shows quarterly SQO progress with pacing against goals
5. **Activity** - Embedded SGA Activity content (calls scheduled, etc.)

**Tab Navigation:**
- Uses a custom `SGAHubTabs` component with a `SGAHubTab` type union: `'leaderboard' | 'weekly-goals' | 'closed-lost' | 'quarterly-progress' | 'activity'`
- State managed via `useState<SGAHubTab>('leaderboard')` (leaderboard is default)
- Tab change triggers different content rendering via conditional rendering
- Each tab has its own loading state, error state, and data fetch logic

**Role Handling:**
- `page.tsx` checks `getSessionPermissions(session)` and allows: `['admin', 'manager', 'sga', 'sgm', 'revops_admin']`
- `SGAHubContent.tsx` determines `isAdmin = ['admin', 'manager', 'revops_admin']`
- Admin role differences:
  - Admins see `AdminQuarterlyProgressView` instead of individual quarterly progress
  - Admins can toggle to see all closed lost records (`showAll`)
  - Admins always see re-engagement for all SGAs
  - Admins can view/edit any SGA's weekly goals via `userEmail` parameter

---

**Q1.1.2**: What is the folder/file structure for SGA Hub components in `src/components/sga-hub/`? List all components and their purposes.

**Answer:**

24 components in `src/components/sga-hub/`:

| Component | Purpose |
|-----------|---------|
| `SGAHubTabs.tsx` | Tab navigation with icons (Trophy, Target, AlertCircle, TrendingUp, PhoneCall) |
| `LeaderboardTable.tsx` | Displays SGA rankings with SQO counts |
| `LeaderboardFilters.tsx` | Quarter, channel, source, SGA filters for leaderboard |
| `WeeklyGoalsTable.tsx` | Shows weekly goals vs actuals with differences |
| `WeeklyGoalEditor.tsx` | Modal for editing weekly goals |
| `BulkGoalEditor.tsx` | Bulk editing of goals |
| `IndividualGoalEditor.tsx` | Individual goal editing |
| `TeamGoalEditor.tsx` | Team-level goal editing (admin) |
| `ClickableMetricValue.tsx` | Metric values that open drill-down modals on click |
| `QuarterlyProgressCard.tsx` | Card showing SQO progress with pacing badge (ahead/behind/on-track) |
| `QuarterlyProgressChart.tsx` | Line chart of historical quarterly progress |
| `SQODetailTable.tsx` | Table showing individual SQO records |
| `AdminQuarterlyProgressView.tsx` | Admin-only view with team totals and SGA breakdown |
| `AdminQuarterlyFilters.tsx` | Filters for admin quarterly view |
| `AdminSGATable.tsx` | Admin table showing all SGA data |
| `SGABreakdownTable.tsx` | Breakdown of SGAs within a team |
| `TeamProgressCard.tsx` | Team-level progress card |
| `StatusSummaryStrip.tsx` | Summary strip showing status indicators |
| `ClosedLostTable.tsx` | Table of closed lost records |
| `ClosedLostFilters.tsx` | Filters for closed lost view |
| `ClosedLostFollowUpTabs.tsx` | Sub-tabs for closed lost and re-engagement |
| `ReEngagementOpportunitiesTable.tsx` | Table of re-engagement opportunities |
| `ReEngagementFilters.tsx` | Filters for re-engagement |
| `MetricDrillDownModal.tsx` | Modal for drilling into metric details (initial calls, qual calls, SQOs) |

---

**Q1.1.3**: How does the SGA Hub fetch data? Examine the API client calls in `SGAHubContent.tsx`. Document each API endpoint used.

**Answer:**

Data fetching uses `dashboardApi` from `src/lib/api-client.ts`. Endpoints used:

| API Function | Endpoint | Purpose |
|--------------|----------|---------|
| `getFilterOptions()` | `GET /api/dashboard/filters` | Get channel/source options for filters |
| `getLeaderboardSGAOptions()` | `GET /api/sga-hub/leaderboard-sga-options` | Get SGA names for leaderboard filter |
| `getSGALeaderboard({...})` | `POST /api/sga-hub/leaderboard` | Fetch leaderboard entries with filters |
| `getWeeklyGoals(start, end)` | `GET /api/sga-hub/weekly-goals` | Fetch user's weekly goals |
| `getWeeklyActuals(start, end)` | `GET /api/sga-hub/weekly-actuals` | Fetch actual call/SQO counts from BigQuery |
| `getClosedLostRecords(buckets, email, showAll)` | `GET /api/sga-hub/closed-lost` | Fetch closed lost records |
| `getReEngagementOpportunities(showAll)` | `GET /api/sga-hub/re-engagement` | Fetch re-engagement opportunities |
| `getQuarterlyProgress(quarter)` | `GET /api/sga-hub/quarterly-progress` | Fetch quarterly SQO progress with pacing |
| `getSQODetails(quarter)` | `GET /api/sga-hub/sqo-details` | Fetch individual SQO records for quarter |
| `getInitialCallsDrillDown(sga, start, end)` | `GET /api/sga-hub/drill-down/initial-calls` | Drill-down records for initial calls |
| `getQualificationCallsDrillDown(sga, start, end)` | `GET /api/sga-hub/drill-down/qualification-calls` | Drill-down records for qual calls |
| `getSQODrillDown(sga, options, email, channels, sources, teamLevel)` | `GET /api/sga-hub/drill-down/sqos` | Drill-down records for SQOs |

**Pattern**: Uses `Promise.all()` for parallel fetching, `useEffect` for triggering fetches on tab/filter changes.

---

## 1.2 API Route Patterns
**Goal**: Understand how to create new API routes following existing patterns

**Q1.2.1**: Examine 2-3 existing SGA Hub API routes (e.g., `src/app/api/sga-hub/weekly-goals/route.ts`, `src/app/api/sga-hub/quarterly-progress/route.ts`). Document the standard pattern for:
- Authentication handling
- Permission checking (especially Admin vs SGA differences)
- How BigQuery queries are constructed
- Response format

**Answer:**

**Authentication Pattern:**
```typescript
const session = await getServerSession(authOptions);
if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const permissions = getSessionPermissions(session);
if (!permissions) {
  return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
}
```

**Permission Checking (Admin vs SGA):**
```typescript
// Check if viewing own data or other user's data
let userEmail = session.user.email;
const targetUserEmail = searchParams.get('userEmail');

if (targetUserEmail) {
  // Only admin/manager/revops_admin can view other users' data
  if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  userEmail = targetUserEmail;
} else {
  // SGA role required for own data
  if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}
```

**BigQuery Query Construction:**
- Uses `runQuery<T>(sql, params)` from `src/lib/bigquery.ts`
- Parameters passed via `@paramName` syntax (parameterized queries)
- Queries are in dedicated files under `src/lib/queries/`
- Example: `getQuarterlySQOCount(userName, quarter)` returns `{ sqoCount, totalAum }`

**Response Format:**
```typescript
// Success
return NextResponse.json({ goals });  // or { actuals }, { records }, etc.
return NextResponse.json(progress);   // Direct object for single items

// Error
return NextResponse.json({ error: 'Error message' }, { status: 500 });
```

---

**Q1.2.2**: How does `src/lib/api-client.ts` define API client functions? What pattern should Coach AI follow for its client functions?

**Answer:**

**Pattern for API Client Functions:**

```typescript
// Simple GET with query params
getWeeklyGoals: (startDate?: string, endDate?: string, userEmail?: string) =>
  apiFetch<{ goals: WeeklyGoal[] }>(`/api/sga-hub/weekly-goals?${new URLSearchParams({
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
    ...(userEmail && { userEmail })
  }).toString()}`),

// POST with body
getSGALeaderboard: (filters: {
  startDate: string;
  endDate: string;
  channels: string[];
  sources?: string[];
  sgaNames?: string[];
}) =>
  apiFetch<{ entries: LeaderboardEntry[] }>('/api/sga-hub/leaderboard', {
    method: 'POST',
    body: JSON.stringify(filters),
  }),
```

**Key Patterns:**
1. Use `apiFetch<T>()` helper for consistent error handling
2. Type the response with generics
3. Optional params handled with spread: `...(param && { param })`
4. POST for complex filters, GET for simple queries
5. Use URLSearchParams for query string building

**Coach AI should follow:**
```typescript
// Individual coaching
getCoachingInsights: (sgaEmail?: string, quarter?: string) =>
  apiFetch<{ insights: CoachingInsight }>(`/api/coach-ai/insights?${...}`),

// Team overview
getTeamCoachingOverview: (quarter: string, channels?: string[]) =>
  apiFetch<{ overview: TeamCoachingOverview }>('/api/coach-ai/team-overview', {
    method: 'POST',
    body: JSON.stringify({ quarter, channels }),
  }),
```

---

## 1.3 Existing Anthropic Integration
**Goal**: Understand how Claude is already integrated

**Q1.3.1**: Examine `src/app/api/agent/query/route.ts`. Document:
- How is the Anthropic client initialized?
- What model is used?
- How are system prompts constructed?
- How is streaming handled (if applicable)?
- What timeout configurations exist?

**Answer:**

**Anthropic Client Initialization:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

**Model Used:**
```typescript
model: 'claude-sonnet-4-20250514'
```

**System Prompt Construction:**
- Generated via `generateAgentSystemPrompt()` from `src/lib/semantic-layer/agent-prompt.ts`
- Includes: role definition, available templates, metrics, dimensions, date ranges, output format, visualization rules, example mappings
- Passed as `system` parameter to `messages.create()`

**Claude API Call:**
```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system: systemPrompt,
  messages,  // User messages and conversation history
});
```

**Streaming:**
- Checks `Accept: text/event-stream` header for streaming requests
- Uses `ReadableStream` with `TextEncoder`
- Sends SSE chunks: `data: ${JSON.stringify(chunk)}\n\n`
- Chunk types: `thinking`, `template_selected`, `query_compiled`, `executing`, `result`, `complete`, `error`

**Timeout Configurations:**
```typescript
const CLAUDE_TIMEOUT_MS = 30000; // 30 seconds for Claude API
const BIGQUERY_TIMEOUT_MS = 30000; // 30 seconds for BigQuery
const MAX_QUESTION_LENGTH = 500; // Max question length

// Timeout wrapper:
async function withTimeout<T>(promise, timeoutMs, errorMessage): Promise<T>
```

---

**Q1.3.2**: Examine `src/lib/semantic-layer/agent-prompt.ts`. How is the prompt structured? What key sections does it include?

**Answer:**

**Prompt Structure:**

The prompt is generated by `generateAgentSystemPrompt()` and includes these sections:

1. **Role Definition**
   - "You are a funnel analytics agent for Savvy Wealth's recruiting dashboard"
   - Defines purpose: parse natural language → template selection

2. **Capabilities Section**
   - Lists what questions it can answer (volume metrics, conversion rates, trends, etc.)

3. **Available Query Templates**
   - Dynamically formatted from `QUERY_TEMPLATES` object
   - Shows template ID, description, visualization, example questions

4. **Available Metrics**
   - **Volume Metrics**: prospects, MQLs, SQLs, SQOs, signed, joined
   - **AUM Metrics**: pipeline AUM, advisor AUM
   - **Conversion Metrics**: contacted→MQL, MQL→SQL, SQL→SQO, SQO→Joined (with aliases)

5. **Available Dimensions**
   - channel, source, SGA, SGM, experimentation_tag (with aliases)

6. **Date Range Presets**
   - this_quarter, last_quarter, this_month, ytd, etc.

7. **Output Format**
   - Strict JSON schema with `templateId`, `parameters`, `confidence`, `explanation`, `preferredVisualization`, `visualizationReasoning`

8. **Visualization Selection Rules**
   - When to use: metric card, bar chart, line chart, funnel, comparison, table
   - Override rules for better visualization choices

9. **Critical Rules**
   - Never generate raw SQL
   - Always use cohort mode for conversions
   - Unsupported question handling
   - Date range defaults

10. **Example Mappings**
    - Extensive examples mapping natural language → template + parameters

---

**Q1.3.3**: What environment variables are used for Claude integration? Check `.env.example` or documented variables.

**Answer:**

From `.env.example`:

```bash
# Anthropic AI (Claude) API - For Explore Feature
# Required for the self-service analytics explore feature
# Get your API key from https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Usage in code:**
```typescript
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

**No other Anthropic-related env vars** - the SDK handles defaults.

---

## 1.4 Permission System
**Goal**: Understand role-based access for Coach AI

**Q1.4.1**: Examine `src/lib/permissions.ts`. Document the permissions for each role relevant to Coach AI:
- `admin` - What pages/actions can they access?
- `revops_admin` - What pages/actions can they access?
- `manager` - What pages/actions can they access?
- `sga` - What pages/actions can they access?

**Answer:**

**Role Permissions (from `ROLE_PERMISSIONS`):**

| Role | Allowed Pages | canExport | canManageUsers | canManageRequests |
|------|---------------|-----------|----------------|-------------------|
| `revops_admin` | 1,3,7,8,9,10,11,12,13,14,15 | ✅ | ✅ | ✅ |
| `admin` | 1,3,7,8,9,10,11,12,13,14,15 | ✅ | ✅ | ❌ |
| `manager` | 1,3,7,8,9,10,11,12,13,14,15 | ✅ | ❌ | ❌ |
| `sgm` | 1,3,7,10,13,14,15 | ✅ | ❌ | ❌ |
| `sga` | 1,3,7,8,10,11,13,14,15 | ✅ | ❌ | ❌ |
| `viewer` | 1,3,7,10,13,15 | ❌ | ❌ | ❌ |
| `recruiter` | 7,12 | ✅ | ❌ | ❌ |

**Page Numbers:**
- 1 = Funnel Performance
- 3 = Open Pipeline
- 7 = Settings
- 8 = SGA Hub
- 9 = SGA Management
- 10 = Explore
- 11 = SGA Activity
- 12 = Recruiter Hub
- 13 = Dashboard Requests
- 14 = Chart Builder
- 15 = Advisor Map

**Special Filters:**
- `sga` role: `sgaFilter = user.name` (sees only own data)
- `sgm` role: `sgmFilter = user.name` (sees their team's data)
- `recruiter` role: `recruiterFilter = user.externalAgency`

**For Coach AI:**
- Page 8 (SGA Hub) is accessible to: sga, sgm, admin, manager, revops_admin
- Admin/manager/revops_admin can view any SGA's coaching
- SGAs can only view their own coaching

---

**Q1.4.2**: How do API routes differentiate between an SGA viewing their own data vs an Admin viewing any SGA's data? Find examples in existing SGA Hub routes.

**Answer:**

**Pattern from `weekly-goals/route.ts`:**

```typescript
// Determine which user's data to fetch
let userEmail = session.user.email;  // Default to current user
const targetUserEmail = searchParams.get('userEmail');  // Admin can specify

if (targetUserEmail) {
  // Only admin/manager/revops_admin can view other users' data
  if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  userEmail = targetUserEmail;
} else {
  // Non-admins can only access if they have SGA Hub access
  if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}

// Use userEmail for the query
const goals = await getWeeklyGoals(userEmail, startDate, endDate);
```

**Key Points:**
1. Default to `session.user.email` for own data
2. `userEmail` query param allows admins to specify target user
3. Check role BEFORE overriding userEmail
4. Same user lookup used for Prisma and BigQuery queries

---

# PHASE 2: Data Model Understanding ✅ COMPLETE

## 2.1 SGA-Related Types
**Goal**: Understand existing type definitions

**Q2.1.1**: Examine `src/types/sga-hub.ts`. Document all interfaces related to:
- Weekly goals and actuals
- Quarterly progress
- Drill-down records
- Any performance-related types

**Answer:**

**Weekly Goals & Actuals:**
```typescript
interface WeeklyGoal {
  id: string;
  userEmail: string;
  weekStartDate: string;  // ISO Monday
  initialCallsGoal: number;
  qualificationCallsGoal: number;
  sqoGoal: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

interface WeeklyActual {
  weekStartDate: string;
  initialCalls: number;
  qualificationCalls: number;
  sqos: number;
}

interface WeeklyGoalWithActuals {
  weekStartDate: string;
  weekEndDate: string;
  weekLabel: string;
  initialCallsGoal: number | null;
  qualificationCallsGoal: number | null;
  sqoGoal: number | null;
  initialCallsActual: number;
  qualificationCallsActual: number;
  sqoActual: number;
  initialCallsDiff: number | null;
  qualificationCallsDiff: number | null;
  sqoDiff: number | null;
  hasGoal: boolean;
  canEdit: boolean;
}
```

**Quarterly Progress:**
```typescript
interface QuarterlyGoal {
  id: string;
  userEmail: string;
  quarter: string;  // "2026-Q1" format
  sqoGoal: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

interface QuarterlyProgress {
  quarter: string;
  quarterLabel: string;
  sqoGoal: number | null;
  hasGoal: boolean;
  sqoActual: number;
  totalAum: number;
  totalAumFormatted: string;
  progressPercent: number | null;
  quarterStartDate: string;
  quarterEndDate: string;
  daysInQuarter: number;
  daysElapsed: number;
  expectedSqos: number;
  pacingDiff: number;
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
}

interface SQODetail {
  id: string;  // primary_key
  advisorName: string;
  sqoDate: string;
  aum: number;
  aumFormatted: string;
  aumTier: string;
  channel: string;
  source: string;
  stageName: string;
  leadUrl: string | null;
  opportunityUrl: string | null;
  salesforceUrl: string;
}
```

**Leaderboard:**
```typescript
interface LeaderboardEntry {
  sgaName: string;
  sqoCount: number;
  rank: number;
}
```

**Admin Quarterly Progress:**
```typescript
interface AdminQuarterlyProgress {
  year: number;
  quarter: number;
  teamTotalSQOs: number;
  sgaIndividualGoalsAggregate: number;
  sgaManagerGoal: number | null;
  sgaBreakdown: Array<{ sgaName: string; sqoCount: number }>;
}
```

---

**Q2.1.2**: What type definitions exist for conversion rates? Check `src/types/dashboard.ts` or related files.

**Answer:**

From `src/types/dashboard.ts`:

```typescript
interface ConversionRates {
  contactedToMql: { rate: number; label: string };
  mqlToSql: { rate: number; label: string };
  sqlToSqo: { rate: number; label: string };
  sqoToJoined: { rate: number; label: string };
}

interface ConversionRatesResponse {
  contactedToMql: { rate: number; numerator: number; denominator: number; label: string };
  mqlToSql: { rate: number; numerator: number; denominator: number; label: string };
  sqlToSqo: { rate: number; numerator: number; denominator: number; label: string };
  sqoToJoined: { rate: number; numerator: number; denominator: number; label: string };
  mode?: 'period' | 'cohort';
}

interface TrendDataPoint {
  period: string;  // "2025-Q1" or "2025-01"
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  isSelectedPeriod: boolean;
}
```

---

## 2.2 Database Models (Prisma)
**Goal**: Understand what's stored locally vs BigQuery

**Q2.2.1**: Examine `prisma/schema.prisma`. What models exist related to SGAs? (Goals, users, etc.)

**Answer:**

**SGA-Related Prisma Models:**

```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String
  role           String   @default("viewer")
  isActive       Boolean  @default(true)
  externalAgency String?  // For recruiters
  // ... relations
}

model WeeklyGoal {
  id                     String   @id @default(cuid())
  userEmail              String   // Links to User.email
  weekStartDate          DateTime @db.Date  // Monday
  initialCallsGoal       Int      @default(0)
  qualificationCallsGoal Int      @default(0)
  sqoGoal                Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  createdBy              String?
  updatedBy              String?
  @@unique([userEmail, weekStartDate])
}

model QuarterlyGoal {
  id        String   @id @default(cuid())
  userEmail String
  quarter   String   // "2026-Q1" format
  sqoGoal   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdBy String?
  updatedBy String?
  @@unique([userEmail, quarter])
}

model ManagerQuarterlyGoal {
  id        String   @id @default(cuid())
  quarter   String   @unique  // "2026-Q1" format
  sqoGoal   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdBy String?
  updatedBy String?
}
```

**What's in Prisma (local DB):**
- User profiles and roles
- Weekly goals (user-set targets)
- Quarterly goals (user-set or admin-set)
- Manager quarterly goals (team-level targets)

**What's in BigQuery:**
- Actual performance data (calls, SQOs, conversions)
- Historical records
- All funnel metrics

---

**Q2.2.2**: Should Coach AI coaching insights be stored in Prisma (for historical reference) or generated fresh each time? What are the tradeoffs?

**Answer:**

**Recommendation: Hybrid approach - Generate fresh but cache weekly**

**Option 1: Generate Fresh Each Time**
- ✅ Always uses latest data
- ✅ No storage costs
- ❌ Slow (~3-5 sec Claude API + BigQuery)
- ❌ API costs for every view
- ❌ No historical comparison

**Option 2: Store in Prisma**
- ✅ Fast retrieval
- ✅ Historical reference ("What did AI recommend last week?")
- ✅ Reduced API costs
- ❌ Stale data until regenerated
- ❌ Storage overhead
- ❌ Complex invalidation logic

**Recommended: Hybrid Approach**
1. **Generate weekly via cron job** (Sunday night/Monday morning)
2. **Store in Prisma** for fast retrieval during the week:
```prisma
model CoachingInsight {
  id           String   @id @default(cuid())
  userEmail    String
  weekStartDate DateTime @db.Date
  quarter      String
  insightJson  Json     // Full coaching response
  generatedAt  DateTime @default(now())
  @@unique([userEmail, weekStartDate])
  @@index([userEmail])
}
```
3. **Offer "Refresh Insights" button** for on-demand regeneration
4. **Keep last 4-8 weeks** for historical trend analysis

---

## 2.3 BigQuery Query Patterns
**Goal**: Understand how to query performance data

**Q2.3.1**: Examine `src/lib/queries/`. What query files exist? Which ones are most relevant for Coach AI (conversion rates, funnel metrics, etc.)?

**Answer:**

**Query Files (24 total in `src/lib/queries/`):**

| File | Relevance to Coach AI | Description |
|------|----------------------|-------------|
| `conversion-rates.ts` | 🔴 HIGH | Period/Cohort mode conversions, trend calculations |
| `funnel-metrics.ts` | 🔴 HIGH | Volume metrics (MQLs, SQLs, SQOs, Joined) |
| `quarterly-progress.ts` | 🔴 HIGH | `getQuarterlySQOCount(userName, quarter)` |
| `weekly-actuals.ts` | 🔴 HIGH | Weekly call and SQO actuals |
| `sga-leaderboard.ts` | 🔴 HIGH | SGA rankings and peer comparison |
| `admin-quarterly-progress.ts` | 🟡 MEDIUM | Team-level aggregations |
| `drill-down.ts` | 🟡 MEDIUM | Record-level details for coaching examples |
| `source-performance.ts` | 🟡 MEDIUM | Channel/source breakdowns |
| `sga-activity.ts` | 🟡 MEDIUM | Activity tracking |
| `closed-lost.ts` | 🟡 MEDIUM | Closed lost patterns |
| `weekly-goals.ts` | 🟡 MEDIUM | Goal retrieval from Prisma |
| `quarterly-goals.ts` | 🟡 MEDIUM | Goal retrieval from Prisma |
| `forecast.ts` | 🟢 LOW | Forecasting (future enhancement) |
| `forecast-goals.ts` | 🟢 LOW | Goal-based forecasting |
| `open-pipeline.ts` | 🟢 LOW | Current pipeline state |
| `data-freshness.ts` | 🟢 LOW | Data last updated timestamp |
| `record-detail.ts` | 🟢 LOW | Single record lookup |
| `detail-records.ts` | 🟢 LOW | Filtered record lists |
| `filter-options.ts` | 🟢 LOW | Dropdown options |
| `export-records.ts` | 🟢 LOW | Export functionality |
| `recruiter-hub.ts` | ⚪ N/A | Recruiter-specific |
| `pipeline-catcher.ts` | ⚪ N/A | Game data |
| `re-engagement.ts` | ⚪ N/A | Re-engagement queries |
| `advisor-locations.ts` | ⚪ N/A | Map feature |

---

**Q2.3.2**: How does `src/lib/bigquery.ts` handle query execution? Document the `runQuery` function signature and usage.

**Answer:**

```typescript
// Signature
export async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]>

// Usage
const results = await runQuery<{
  sqoCount: number;
  totalAum: number;
}>(query, { userName, startDate, endDate });
```

**Key Features:**
- Generic type parameter for result typing
- Parameterized queries using `@paramName` syntax
- OAuth scopes include BigQuery + Drive (for external tables)
- Handles credentials via `GOOGLE_APPLICATION_CREDENTIALS_JSON` (Vercel) or `GOOGLE_APPLICATION_CREDENTIALS` (local)

**Helper Function:**
```typescript
export function buildQueryParams(filters): { conditions: string[]; params: Record<string, any> }
// Builds WHERE clauses for channel, source, SGA, SGM filters
```

---

**Q2.3.3**: What is the pattern for parameterized queries (to prevent SQL injection)? Find examples.

**Answer:**

**Pattern:**
```typescript
const query = `
  SELECT COUNT(*) as count
  FROM \`${FULL_TABLE}\` v
  WHERE v.SGA_Owner_Name__c = @sgaName
    AND DATE(v.Date_Became_SQO__c) >= DATE(@startDate)
    AND DATE(v.Date_Became_SQO__c) <= DATE(@endDate)
`;

const params = {
  sgaName: 'John Doe',
  startDate: '2026-01-01',
  endDate: '2026-03-31',
};

const results = await runQuery(query, params);
```

**Key Points:**
1. Use `@paramName` in SQL (not `$1` or `?`)
2. Pass params object as second arg to `runQuery()`
3. BigQuery handles escaping automatically
4. Works with strings, numbers, dates, arrays
5. Table names use template literals with constants: `` `${FULL_TABLE}` ``

**Array Parameters:**
```typescript
// For IN clauses
const params = {
  channels: ['Outbound', 'Marketing'],
};
// SQL: WHERE Channel_Grouping_Name IN UNNEST(@channels)
```

---

# PHASE 3: Conversion Rate Logic ✅ COMPLETE

## 3.1 Cohort Mode vs Period Mode
**Goal**: Understand conversion rate calculation nuances

**Q3.1.1**: Examine `docs/CALCULATIONS.md` or similar documentation. Explain the difference between:
- **Cohort Mode**: How it works, when to use it
- **Period Mode**: How it works, when to use it
- Which mode should Coach AI use for comparing SGAs?

**Answer:**

**Period Mode (Activity-Based):**
- **Question answered**: "What conversion activity happened in this period?"
- **How it works**: Records must ENTER and RESOLVE (progress or close) within the SAME period
- **Populations**: Different for numerator/denominator → can exceed 100%
- **Excludes**: In-flight records (entered but not yet resolved)
- **Best for**: Operational dashboards, activity tracking, "what did we accomplish?"

**Cohort Mode (Resolved-Only):**
- **Question answered**: "Of records from this period, what % ultimately converted?"
- **How it works**: Uses pre-calculated `eligible_for_*_conversions` and `*_progression` flags
- **Populations**: Same cohort for both → always 0-100%
- **Excludes**: Open records (not yet resolved)
- **Best for**: Funnel efficiency, forecasting, conversion optimization

**For Coach AI: Use COHORT MODE**

Reasons:
1. Fairer comparison between SGAs (same population basis)
2. Rates always 0-100% (easier to communicate)
3. Better reflects true conversion efficiency
4. Already used by the Explore feature for conversions
5. Pre-calculated flags make it more efficient

---

**Q3.1.2**: The user mentioned that "contacting to MQL conversion rates are strange because... we can move someone into contacting and then not close it for 90 days." How does the codebase handle this? What is `eligible_for_*_conversions` and how does it relate to "resolved records"?

**Answer:**

**The Problem:**
A lead can sit in "Contacting" stage for months without being resolved. This creates denominator inflation - you're counting leads that haven't had a chance to convert yet.

**The Solution: Eligibility Flags**

Eligibility flags (from `vw_funnel_master`) identify RESOLVED records only:

```sql
-- eligible_for_contacted_conversions
CASE
  WHEN is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0
END
```

**Translation**: A contacted lead is "eligible" for conversion calculation ONLY IF:
- It became MQL (progressed), OR
- It was closed (resolved negatively)

**NOT eligible**: Leads still sitting in Contacting with no resolution.

**All Eligibility Flags:**
| Flag | Resolved When |
|------|--------------|
| `eligible_for_contacted_conversions` | Became MQL OR lead closed |
| `eligible_for_mql_conversions` | Became SQL OR lead closed |
| `eligible_for_sql_conversions` | Became SQO OR opportunity closed lost |
| `eligible_for_sqo_conversions` | Joined OR opportunity closed lost |

**For Coach AI**: Always use cohort mode with eligibility flags to get accurate conversion rates that aren't distorted by in-flight records.

---

## 3.2 Conversion Rate Calculation
**Goal**: Understand exact formulas

**Q3.2.1**: Examine how conversion rates are calculated in the codebase. For each conversion, document:
- **Contacted → MQL**: Numerator flag, denominator flag, date field
- **MQL → SQL**: Numerator flag, denominator flag, date field
- **SQL → SQO**: Numerator flag, denominator flag, date field
- **SQO → Joined**: Numerator flag, denominator flag, date field

**Answer:**

**Cohort Mode Calculations (from `conversion-rates.ts`):**

| Conversion | Numerator | Denominator | Cohort Date Field |
|------------|-----------|-------------|-------------------|
| Contacted → MQL | `contacted_to_mql_progression` | `eligible_for_contacted_conversions` | `stage_entered_contacting__c` |
| MQL → SQL | `mql_to_sql_progression` | `eligible_for_mql_conversions` | `mql_stage_entered_ts` |
| SQL → SQO | `sql_to_sqo_progression` | `eligible_for_sql_conversions` | `converted_date_raw` |
| SQO → Joined | `sqo_to_joined_progression` | `eligible_for_sqo_conversions` | `Date_Became_SQO__c` |

**SQL Pattern (Cohort Mode):**
```sql
-- Example: SQL → SQO
SUM(CASE
  WHEN v.converted_date_raw IS NOT NULL
    AND DATE(v.converted_date_raw) >= DATE(@startDate)
    AND DATE(v.converted_date_raw) <= DATE(@endDate)
  THEN v.sql_to_sqo_progression ELSE 0
END) as sql_numer,

SUM(CASE
  WHEN v.converted_date_raw IS NOT NULL
    AND DATE(v.converted_date_raw) >= DATE(@startDate)
    AND DATE(v.converted_date_raw) <= DATE(@endDate)
  THEN v.eligible_for_sql_conversions ELSE 0
END) as sql_denom
```

---

**Q3.2.2**: What deduplication logic is required? When do we use `is_sqo_unique` vs `is_sqo`?

**Answer:**

**The Problem:**
Multiple leads can convert to the same opportunity. Without deduplication:
- 3 leads → 1 opportunity = 3 SQOs counted (wrong!)
- Should be = 1 SQO counted (correct)

**Deduplication Flags:**

| Flag | Use Case | Logic |
|------|----------|-------|
| `is_sqo` | Binary check (0/1) | `LOWER(SQO_raw) = 'yes'` |
| `is_sqo_unique` | Volume counting | `is_sqo = 1 AND (no opp OR opp_row_num = 1)` |
| `is_joined_unique` | Joined counting | `(advisor_join_date IS NOT NULL OR stage='Joined') AND (no opp OR opp_row_num = 1)` |
| `is_primary_opp_record` | AUM calculations | `Full_Opportunity_ID__c IS NULL OR opp_row_num = 1` |

**When to Use Each:**

```sql
-- For VOLUME counts (SQOs this quarter):
COUNTIF(is_sqo_unique = 1)  -- ✅ Correct

-- For CONVERSION RATE progression flags:
sql_to_sqo_progression      -- Already handles dedup internally

-- For AUM calculations:
SUM(CASE WHEN is_primary_opp_record = 1 THEN Opportunity_AUM ELSE 0 END)
```

**Coach AI should:**
- Use `is_sqo_unique = 1` for SQO counts
- Use `is_joined_unique = 1` for Joined counts
- Use progression/eligibility flags for conversion rates (built-in dedup)

---

# PHASE 4: UI Component Patterns ✅ COMPLETE

## 4.1 Modal Components
**Goal**: Understand how to build Coach AI display modal/section

**Q4.1.1**: Examine `src/components/sga-hub/MetricDrillDownModal.tsx`. Document:
- Props interface
- How loading states are handled
- How data is displayed
- How the modal opens/closes

**Answer:**

**Props Interface:**
```typescript
interface MetricDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  metricType: MetricType;  // 'initial-calls' | 'qualification-calls' | 'sqos'
  records: DrillDownRecord[];
  title: string;
  loading: boolean;
  error: string | null;
  onRecordClick: (primaryKey: string) => void;
  canExport?: boolean;
}
```

**Loading State:**
- Shows skeleton rows (`SkeletonRow` component) when `loading = true`
- 5 animated placeholder rows with `bg-gray-200 animate-pulse`

**Data Display:**
- Uses Tremor `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell`
- Column configs defined per metric type (`COLUMN_CONFIGS`)
- Supports conditional SGA name column for team-level drill-downs
- Export button with CSV download

**Open/Close:**
- Controlled by `isOpen` prop
- Close via: ESC key, backdrop click, X button
- Prevents body scroll when open: `document.body.style.overflow = 'hidden'`

**Structure:**
```
<div className="fixed inset-0 z-50">
  <div className="backdrop bg-black/50" onClick={onClose} />
  <div className="modal bg-white rounded-xl max-w-5xl max-h-[85vh]">
    <header> Title | Record count | Export | Close </header>
    <div className="flex-1 overflow-auto"> Table </div>
    <footer> Hint text </footer>
  </div>
</div>
```

---

**Q4.1.2**: Examine how existing components handle tabular data display. What table components are used (Tremor Table, custom, etc.)?

**Answer:**

**Tremor Table Components Used:**
```typescript
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from '@tremor/react';
```

**Usage Pattern:**
```tsx
<Table>
  <TableHead>
    <TableRow>
      {columns.map(col => (
        <TableHeaderCell key={col.key} className={col.width}>
          {col.label}
        </TableHeaderCell>
      ))}
    </TableRow>
  </TableHead>
  <TableBody>
    {loading ? (
      <SkeletonRows />
    ) : records.length === 0 ? (
      <EmptyState />
    ) : (
      records.map(record => (
        <TableRow key={record.id} onClick={() => onRowClick(record)} className="cursor-pointer hover:bg-blue-50">
          {columns.map(col => (
            <TableCell key={col.key}>{getCellValue(record, col.key)}</TableCell>
          ))}
        </TableRow>
      ))
    )}
  </TableBody>
</Table>
```

**Styling:**
- Column widths via Tailwind: `w-24`, `w-32`, `w-48`
- Hover states: `hover:bg-blue-50 dark:hover:bg-blue-950/20`
- Dark mode support throughout

---

## 4.2 Card/Section Components
**Goal**: Understand how to display coaching insights

**Q4.2.1**: Examine `src/components/sga-hub/QuarterlyProgressCard.tsx` or similar. How are performance summary cards structured?

**Answer:**

**Component Structure:**
```tsx
<Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
  {/* Header */}
  <div className="flex items-center justify-between mb-4">
    <div>
      <Text className="text-gray-600 text-sm">Quarterly Progress</Text>
      <Metric className="text-2xl font-bold">Q1 2026</Metric>
    </div>
    <Badge className={getPacingBadgeColor(status)} size="lg">
      <TrendingUp className="w-4 h-4" />
      <span>Ahead by 2.5 SQOs</span>
    </Badge>
  </div>

  {/* Main Metric */}
  <div className="mb-6">
    <div className="flex items-center gap-2">
      <Text>SQOs:</Text>
      <ClickableMetricValue value={12} onClick={onSQOClick} />
      <Text className="text-gray-500">of 15</Text>
    </div>
    {/* Progress Bar */}
    <div className="w-full bg-gray-200 rounded-full h-3">
      <div className={progressBarColor} style={{ width: `${percent}%` }} />
    </div>
  </div>

  {/* Stats Grid */}
  <div className="grid grid-cols-2 gap-4 mb-4">
    <StatBox label="Total AUM" value="$45.2M" />
    <StatBox label="Expected SQOs" value="10.5" />
  </div>

  {/* Footer */}
  <div className="pt-4 border-t border-gray-200">
    <span>Days Elapsed: 45 / 91 (49%)</span>
  </div>
</Card>
```

**Tremor Components:**
- `Card` - Container with padding/borders
- `Metric` - Large bold text for key values
- `Text` - Standard text with color variants
- `Badge` - Status indicators with color

---

**Q4.2.2**: What visual indicators are used for performance status (ahead/behind, good/bad conversion rates, etc.)? Document the color schemes and patterns.

**Answer:**

**Pacing Status Colors:**
```typescript
function getPacingBadgeColor(status: 'ahead' | 'on-track' | 'behind' | 'no-goal'): string {
  switch (status) {
    case 'ahead':    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'on-track': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'behind':   return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'no-goal':  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}
```

**Progress Bar Colors:**
```typescript
progressBarPercent >= 100 ? 'bg-green-500' :
progressBarPercent >= 75  ? 'bg-blue-500' :
progressBarPercent >= 50  ? 'bg-yellow-500' :
                            'bg-red-500'
```

**Icons:**
- Ahead: `<TrendingUp />` (lucide-react)
- Behind: `<TrendingDown />`
- On-track: `<Minus />`
- No goal: `<Target />`

**Difference Display (Goal vs Actual):**
```typescript
// Positive = green, Negative = red
diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-500'
```

---

## 4.3 Loading & Error States
**Goal**: Ensure good UX for AI-generated content

**Q4.3.1**: How do existing components handle loading states while waiting for API responses?

**Answer:**

**Pattern 1: Loading Spinner**
```tsx
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

{loading && <LoadingSpinner />}
```

**Pattern 2: Skeleton Loading (Tables)**
```tsx
function SkeletonRow({ columns }: { columns: number }) {
  return (
    <TableRow>
      {Array.from({ length: columns }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </TableCell>
      ))}
    </TableRow>
  );
}

// Usage
{loading ? (
  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={7} />)
) : (
  data.map(row => <DataRow key={row.id} {...row} />)
)}
```

**Pattern 3: Loading State with Count**
```tsx
<span className="text-sm text-gray-500">
  {loading ? 'Loading...' : `${records.length} records`}
</span>
```

**Pattern 4: Disabled Buttons**
```tsx
<Button disabled={loading || goalsWithActuals.length === 0}>
  Export CSV
</Button>
```

---

**Q4.3.2**: How are error states displayed? What patterns exist for retry logic?

**Answer:**

**Error Display Pattern:**
```tsx
{error && (
  <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
    <Text className="text-red-600 dark:text-red-400">{error}</Text>
  </Card>
)}
```

**Error in Modal:**
```tsx
{error && (
  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
    <p className="text-red-800 dark:text-red-200">{error}</p>
  </div>
)}
```

**Error Handling in API Client:**
```typescript
export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Please sign in to continue';
    if (error.status === 403) return 'You do not have permission';
    return error.message;
  }
  return 'An unexpected error occurred';
}
```

**Retry Logic (in Agent route):**
```typescript
// Timeout wrapper with retry suggestion in error message
async function withTimeout<T>(promise, timeoutMs, errorMessage): Promise<T> {
  // Returns specific error: "AI response timed out. Please try a simpler question."
}
```

**For Coach AI:**
```tsx
{error && (
  <Card className="bg-amber-50 border-amber-200 p-4">
    <div className="flex items-center gap-2">
      <AlertTriangle className="text-amber-600" />
      <Text>{error}</Text>
    </div>
    <Button onClick={refetch} className="mt-2">Try Again</Button>
  </Card>
)}
```

---

# PHASE 5: Coach AI Specific Requirements ✅ COMPLETE

## 5.1 Individual SGA View
**Goal**: Define what individual SGAs see

**Q5.1.1**: Based on the existing weekly report Python script (generate_sga_weekly_report.py), what sections should the individual Coach AI view include?
- List each section
- What data does each section require?

**Answer:**

**Recommended Sections (based on existing SGA Hub + coaching best practices):**

1. **Performance Summary**
   - Data: Current quarter SQOs vs goal, pacing status
   - Data: Week-over-week trend (last 4 weeks)
   - Data: Conversion rates (SQL→SQO, SQO→Joined)

2. **Peer Comparison**
   - Data: Rank among active SGAs
   - Data: Distance from top performers
   - Data: Comparison to team average

3. **What's Working**
   - Data: Best performing channels/sources for this SGA
   - Data: High-converting lead types
   - Data: Successful patterns (time to SQO, etc.)

4. **Areas for Improvement**
   - Data: Conversion rate gaps vs top performers
   - Data: Underperforming channels
   - Data: Lost opportunity patterns (closed lost reasons)

5. **Specific Action Items**
   - Data: Number of leads in each stage
   - Data: Stale leads needing attention
   - Data: Re-engagement opportunities

6. **Weekly Focus Recommendation**
   - AI-generated based on above data
   - 1-3 specific, actionable items

---

**Q5.1.2**: How should the UI present AI-generated coaching insights? Consider:
- Text formatting (markdown rendering?)
- Highlighting key metrics
- Expandable/collapsible sections

**Answer:**

**Recommended UI Structure:**

```tsx
<div className="space-y-6">
  {/* Summary Card - Always Visible */}
  <Card className="bg-gradient-to-r from-blue-50 to-indigo-50">
    <div className="flex items-center gap-3">
      <Bot className="w-8 h-8 text-blue-600" />
      <div>
        <Text className="text-sm text-gray-500">Weekly Coaching Insight</Text>
        <Metric>Great progress this week!</Metric>
      </div>
    </div>
    <Text className="mt-4">{summaryParagraph}</Text>
  </Card>

  {/* Expandable Sections */}
  <Accordion type="multiple" defaultValue={['focus']}>
    <AccordionItem value="focus">
      <AccordionTrigger>
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5" />
          <span>This Week's Focus</span>
          <Badge>3 items</Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <ul className="space-y-3">
          {focusItems.map(item => (
            <li className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
              <div>
                <Text className="font-medium">{item.title}</Text>
                <Text className="text-sm text-gray-500">{item.detail}</Text>
              </div>
            </li>
          ))}
        </ul>
      </AccordionContent>
    </AccordionItem>

    <AccordionItem value="metrics">
      <AccordionTrigger>Key Metrics</AccordionTrigger>
      <AccordionContent>
        {/* Metrics grid with highlighting */}
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="SQL→SQO Rate"
            value="78%"
            comparison="+12% vs avg"
            trend="up"
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>

  {/* Refresh Button */}
  <Button variant="secondary" onClick={refreshInsights}>
    <RefreshCw className="w-4 h-4 mr-2" />
    Refresh Insights
  </Button>
</div>
```

**Markdown Rendering:**
```tsx
import ReactMarkdown from 'react-markdown';

<ReactMarkdown
  components={{
    strong: ({ children }) => <span className="font-semibold text-blue-700">{children}</span>,
    li: ({ children }) => <li className="flex items-start gap-2"><span>•</span>{children}</li>,
  }}
>
  {insightText}
</ReactMarkdown>
```

---

## 5.2 Admin/Manager Team Overview
**Goal**: Define the team-level view

**Q5.2.1**: What existing admin views can we reference for the team overview pattern? Examine `src/app/dashboard/sga-management/` or `src/components/admin/`.

**Answer:**

**Existing Admin Patterns:**

1. **AdminQuarterlyProgressView** (`src/components/sga-hub/AdminQuarterlyProgressView.tsx`)
   - Team totals card with aggregate SQOs
   - SGA breakdown table with individual stats
   - Filters: Year, Quarter, Channels, Sources
   - Click-through to individual SGA drill-downs

2. **SGA Management Page** (`src/app/dashboard/sga-management/`)
   - Table of all SGAs with status
   - Active/inactive filtering
   - Goal setting capabilities

3. **Leaderboard with Filters**
   - Quarter selector
   - Multi-select for channels/sources/SGAs
   - Ranking table with drill-down

**Pattern for Team Coach AI:**
```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  {/* Team Summary */}
  <Card className="lg:col-span-3">
    <TeamCoachingSummary
      teamTotal={144}
      teamGoal={160}
      topThemes={['Channel focus', 'Follow-up timing']}
    />
  </Card>

  {/* SGA Cards */}
  {sgaBreakdown.map(sga => (
    <SGACoachingCard
      key={sga.name}
      sgaName={sga.name}
      sqoCount={sga.sqoCount}
      status={sga.pacingStatus}
      topInsight={sga.quickInsight}
      onClick={() => openSGADetail(sga.email)}
    />
  ))}
</div>
```

---

**Q5.2.2**: What should the team-level Coach AI view include that's different from individual views?
- Team-wide trends
- Peer comparisons
- Top/bottom performer analysis
- Aggregate coaching themes

**Answer:**

**Team-Level Unique Elements:**

1. **Team Performance Dashboard**
   - Total team SQOs vs combined goal
   - Team pacing (ahead/behind)
   - Week-over-week team trend

2. **Performer Distribution**
   - Visual breakdown: Ahead (green), On-track (yellow), Behind (red)
   - Quick stats: "7 of 12 SGAs are on pace"

3. **Top Performers Analysis**
   - Who's leading and why
   - Best practices to share with team
   - Specific techniques that are working

4. **At-Risk SGAs**
   - Who needs attention
   - Specific blockers identified
   - Suggested interventions

5. **Team-Wide Coaching Themes**
   - Common improvement areas
   - Channel/source patterns
   - Training recommendations

6. **Comparative Metrics Table**
   ```
   | SGA | SQOs | Goal | Pacing | SQL→SQO | Focus Area |
   |-----|------|------|--------|---------|------------|
   | John | 12 | 15 | Behind | 65% | Qualification |
   | Jane | 18 | 15 | Ahead | 82% | -- |
   ```

7. **Manager Action Items**
   - Specific 1:1 talking points per SGA
   - Team meeting topics
   - Resource allocation suggestions

---

## 5.3 AI Prompt Engineering
**Goal**: Define the coaching prompt strategy

**Q5.3.1**: Based on the existing `agent-prompt.ts` pattern, what should the Coach AI system prompt include?
- Role definition
- Data context (what metrics are provided)
- Output format expectations
- Coaching principles (specific, actionable, data-driven)

**Answer:**

**Recommended System Prompt Structure:**

```typescript
export function generateCoachingSystemPrompt(role: 'sga' | 'manager'): string {
  return `You are a performance coach for Savvy Wealth's recruiting team. Your role is to analyze SGA performance data and provide specific, actionable coaching insights.

## YOUR ROLE
${role === 'sga'
  ? 'You are coaching an individual SGA (Sales Growth Advisor) on improving their recruiting funnel performance.'
  : 'You are coaching a manager on how to improve their team\'s overall performance and support individual SGAs.'}

## COACHING PRINCIPLES
1. **Be Specific**: Reference actual numbers, not vague statements
   - ❌ "Your conversion rate could improve"
   - ✅ "Your SQL→SQO rate is 65% vs team average of 78%. Focus on qualification call quality."

2. **Be Actionable**: Every insight should have a clear next step
   - ❌ "You're behind on SQOs"
   - ✅ "You need 4 more SQOs in 6 weeks. Prioritize your 3 Discovery-stage opportunities."

3. **Be Balanced**: Acknowledge wins before addressing gaps
   - Start with what's working well
   - Then address areas for improvement

4. **Be Contextual**: Consider the SGA's specific situation
   - Their channel mix
   - Their experience level
   - Recent trends (improving or declining)

5. **Be Concise**: Limit to 3-5 key insights per session

## DATA PROVIDED
You will receive JSON with:
- Current quarter progress (SQOs, goal, pacing)
- Conversion rates (cohort mode, 0-100%)
- Peer comparison (rank, team average)
- Channel/source breakdown
- Recent activity (calls, meetings)
- Pipeline snapshot (leads by stage)

## OUTPUT FORMAT
Return JSON:
\`\`\`json
{
  "summary": "One paragraph executive summary",
  "status": "ahead" | "on-track" | "behind",
  "focusAreas": [
    {
      "title": "Short title",
      "insight": "Detailed observation with data",
      "action": "Specific action to take",
      "priority": "high" | "medium" | "low"
    }
  ],
  "wins": ["Specific win #1", "Specific win #2"],
  "metrics": {
    "highlight": "Key metric to focus on",
    "comparison": "vs peer or goal comparison"
  }
}
\`\`\`

## METRIC DEFINITIONS
- **SQO**: Sales Qualified Opportunity (pipeline-ready opportunity)
- **SQL→SQO Rate**: % of converted leads that become SQOs
- **SQO→Joined Rate**: % of SQOs that become joined advisors
- **Pacing**: Prorated progress based on days elapsed in quarter

## AVOID
- Generic advice that could apply to anyone
- Negative framing without solutions
- Overwhelming with too many action items
- Comparing to specific named peers (preserve privacy)
`;
}
```

---

**Q5.3.2**: Should we consider using multiple LLM providers (OpenAI, Gemini, Anthropic) as the Python script does? What are the tradeoffs?

**Answer:**

**Recommendation: Stick with Anthropic (Claude) only**

**Reasons to use single provider (Anthropic):**
1. ✅ Already integrated and working
2. ✅ Consistent prompt engineering
3. ✅ Single API key to manage
4. ✅ Simpler error handling
5. ✅ Consistent output format
6. ✅ Claude excels at structured analysis

**Tradeoffs of multi-provider:**

| Factor | Single (Anthropic) | Multi-Provider |
|--------|-------------------|----------------|
| Complexity | Low | High |
| Reliability | Depends on one provider | Fallback available |
| Cost | Predictable | Variable |
| Consistency | High | Low (different outputs) |
| Maintenance | Easy | Complex |
| Latency | Consistent | Variable |

**If fallback needed later:**
```typescript
async function getCoachingInsight(data: CoachingData): Promise<CoachingInsight> {
  try {
    return await callClaude(data);
  } catch (error) {
    if (error.code === 'rate_limit' || error.code === 'service_unavailable') {
      console.warn('Claude unavailable, falling back to cached insights');
      return getCachedInsight(data.sgaEmail);
    }
    throw error;
  }
}
```

**For MVP: Use Claude only, cache results weekly, show "AI temporarily unavailable" for errors.**

---

## 5.4 Caching & Refresh Strategy
**Goal**: Define when coaching insights are generated

**Q5.4.1**: Examine `src/lib/cache.ts` and `src/app/api/cron/refresh-cache/route.ts`. How does the caching system work?

**Answer:**

**Cache System:**

```typescript
// src/lib/cache.ts
import { unstable_cache } from 'next/cache';

export const CACHE_TAGS = {
  DASHBOARD: 'dashboard',
  SGA_HUB: 'sga-hub',
};

export const DEFAULT_CACHE_TTL = 14400; // 4 hours

export function cachedQuery<T>(
  fn: T,
  keyName: string,
  tag: string,
  ttl: number = DEFAULT_CACHE_TTL
): T {
  return unstable_cache(
    async (...args) => fn(...args),
    [keyName],
    { tags: [tag], revalidate: ttl }
  );
}
```

**Usage:**
```typescript
export const getConversionRates = cachedQuery(
  _getConversionRates,
  'getConversionRates',
  CACHE_TAGS.DASHBOARD
);
```

**Cache Refresh Cron:**
```typescript
// /api/cron/refresh-cache/route.ts
export async function GET(request: NextRequest) {
  // Verify CRON_SECRET
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Invalidate cache tags
  revalidateTag(CACHE_TAGS.DASHBOARD);
  revalidateTag(CACHE_TAGS.SGA_HUB);

  return NextResponse.json({ success: true, tags: [...] });
}
```

**Scheduled via Vercel Cron:**
- Runs 10 minutes after BigQuery data transfer
- Invalidates all cached queries

---

**Q5.4.2**: Should Coach AI insights be:
- Generated on-demand when the user views the page?
- Pre-generated weekly via cron job?
- Cached after first generation?

Document the tradeoffs of each approach.

**Answer:**

**Recommended: Pre-generated weekly + on-demand refresh**

| Approach | Pros | Cons |
|----------|------|------|
| **On-demand only** | Always fresh | Slow (3-5s), high API costs, bad UX |
| **Pre-generated only** | Fast, low cost | Stale if data changes mid-week |
| **Cached after first gen** | Balanced | First user waits, inconsistent experience |
| **Pre-generated + on-demand refresh** | Best of both | Slightly more complex |

**Recommended Implementation:**

1. **Cron Job (Weekly - Sunday night)**
   ```typescript
   // /api/cron/generate-coaching/route.ts
   async function GET(request: NextRequest) {
     const activeSGAs = await getActiveSGAs();
     for (const sga of activeSGAs) {
       const insight = await generateCoachingInsight(sga.email);
       await saveCoachingInsight(sga.email, insight);
     }
     // Also generate team overview
     await generateTeamCoachingInsight();
   }
   ```

2. **Storage (Prisma)**
   ```prisma
   model CoachingInsight {
     id           String   @id @default(cuid())
     userEmail    String
     weekStartDate DateTime @db.Date
     insightJson  Json
     generatedAt  DateTime @default(now())
     @@unique([userEmail, weekStartDate])
   }
   ```

3. **API Endpoint**
   ```typescript
   // GET: Return cached insight
   // POST: Force regenerate (admin only or rate-limited)
   ```

4. **UI**
   ```tsx
   <div className="flex items-center justify-between">
     <Text className="text-xs text-gray-400">
       Generated {formatRelative(insight.generatedAt)}
     </Text>
     <Button size="sm" variant="ghost" onClick={refresh} disabled={isRefreshing}>
       <RefreshCw className={isRefreshing ? 'animate-spin' : ''} />
     </Button>
   </div>
   ```

---

# PHASE 6: Implementation Planning ✅ COMPLETE

## 6.1 File Structure
**Goal**: Define where new code will live

**Q6.1.1**: Based on existing patterns, propose the file structure for Coach AI:
- API routes
- Components
- Types
- Lib/utility functions
- Prompts

**Answer:**

```
src/
├── app/
│   ├── api/
│   │   └── coach-ai/
│   │       ├── insights/
│   │       │   └── route.ts          # GET/POST individual coaching
│   │       ├── team-overview/
│   │       │   └── route.ts          # GET team-level coaching
│   │       └── generate/
│   │           └── route.ts          # POST force regenerate (cron/admin)
│   │
│   └── dashboard/
│       └── sga-hub/
│           └── SGAHubContent.tsx     # Add new 'coaching' tab
│
├── components/
│   └── sga-hub/
│       ├── CoachingTab.tsx           # Main coaching tab container
│       ├── CoachingInsightCard.tsx   # Summary card with AI icon
│       ├── FocusAreaList.tsx         # Expandable action items
│       ├── WinsSection.tsx           # What's working well
│       ├── MetricHighlight.tsx       # Key metric callout
│       ├── TeamCoachingOverview.tsx  # Admin team view
│       ├── SGACoachingGrid.tsx       # Grid of SGA cards for admins
│       └── RefreshInsightsButton.tsx # Refresh with loading state
│
├── lib/
│   ├── coach-ai/
│   │   ├── prompt.ts                 # System prompt generator
│   │   ├── data-collector.ts         # Gather all metrics for prompt
│   │   ├── insight-generator.ts      # Call Claude, parse response
│   │   └── storage.ts                # Save/retrieve from Prisma
│   │
│   └── queries/
│       └── coach-ai-metrics.ts       # BigQuery queries for coaching data
│
├── types/
│   └── coach-ai.ts                   # CoachingInsight, FocusArea, etc.
│
└── prisma/
    └── schema.prisma                 # Add CoachingInsight model
```

---

## 6.2 API Design
**Goal**: Define the API endpoints needed

**Q6.2.1**: Design the API endpoints for Coach AI:
- Individual SGA coaching: Route, method, params, response
- Team overview coaching: Route, method, params, response
- Historical coaching data (if stored): Route, method, params, response

**Answer:**

**1. Individual SGA Coaching**
```typescript
// GET /api/coach-ai/insights
// Query params: quarter?, forceRefresh?
// Response:
{
  insight: {
    id: string;
    userEmail: string;
    weekStartDate: string;
    generatedAt: string;
    summary: string;
    status: 'ahead' | 'on-track' | 'behind';
    focusAreas: FocusArea[];
    wins: string[];
    metrics: { highlight: string; comparison: string };
  };
  fromCache: boolean;
}

// POST /api/coach-ai/insights
// Body: { quarter?: string }
// Forces regeneration, returns same structure
```

**2. Team Overview Coaching (Admin)**
```typescript
// GET /api/coach-ai/team-overview
// Query params: quarter?
// Response:
{
  overview: {
    id: string;
    generatedAt: string;
    teamSummary: string;
    teamStatus: 'ahead' | 'on-track' | 'behind';
    performerDistribution: { ahead: number; onTrack: number; behind: number };
    topPerformers: Array<{ name: string; sqos: number; insight: string }>;
    atRiskSGAs: Array<{ name: string; issue: string; suggestion: string }>;
    teamThemes: string[];
    managerActions: string[];
  };
  sgaSnapshots: Array<{
    sgaName: string;
    sqoCount: number;
    status: string;
    quickInsight: string;
  }>;
}
```

**3. Historical Insights**
```typescript
// GET /api/coach-ai/history
// Query params: weeks? (default 4), userEmail? (admin only)
// Response:
{
  history: Array<{
    weekStartDate: string;
    summary: string;
    status: string;
    focusAreas: FocusArea[];
  }>;
}
```

---

## 6.3 Data Flow
**Goal**: Document the complete data flow

**Q6.3.1**: Document the data flow for generating individual SGA coaching:
1. User action (what triggers it?)
2. API call (what data is sent?)
3. BigQuery queries (what data is fetched?)
4. Claude API call (what prompt + data is sent?)
5. Response processing (how is the response formatted?)
6. UI rendering (how is it displayed?)

**Answer:**

**Data Flow Diagram:**

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ User clicks │────▶│ API: /coach-ai/ │────▶│ Check Prisma for │
│ Coaching tab│     │    insights     │     │ cached insight   │
└─────────────┘     └─────────────────┘     └──────────────────┘
                                                    │
                           ┌────────────────────────┴───────────────────────┐
                           │                                                │
                           ▼ Cache Hit                                      ▼ Cache Miss / Stale
                    ┌──────────────┐                               ┌──────────────────┐
                    │Return cached │                               │ Collect metrics  │
                    │   insight    │                               │   from BigQuery  │
                    └──────────────┘                               └──────────────────┘
                                                                           │
                                                                           ▼
                                                                  ┌──────────────────┐
                                                                  │ Build prompt with│
                                                                  │   SGA data JSON  │
                                                                  └──────────────────┘
                                                                           │
                                                                           ▼
                                                                  ┌──────────────────┐
                                                                  │  Call Claude API │
                                                                  │  (30s timeout)   │
                                                                  └──────────────────┘
                                                                           │
                                                                           ▼
                                                                  ┌──────────────────┐
                                                                  │ Parse JSON from  │
                                                                  │ Claude response  │
                                                                  └──────────────────┘
                                                                           │
                                                                           ▼
                                                                  ┌──────────────────┐
                                                                  │ Save to Prisma   │
                                                                  │ for future cache │
                                                                  └──────────────────┘
                                                                           │
                                                                           ▼
                                                                  ┌──────────────────┐
                                                                  │ Return to client │
                                                                  └──────────────────┘
```

**Detailed Steps:**

1. **User Action**
   - User navigates to SGA Hub → Clicks "Coaching" tab
   - OR: User clicks "Refresh Insights" button

2. **API Call**
   ```typescript
   const { insight } = await dashboardApi.getCoachingInsight(quarter);
   // Sends: GET /api/coach-ai/insights?quarter=2026-Q1
   // Headers: Session cookie (authentication)
   ```

3. **BigQuery Queries**
   ```typescript
   const metrics = await collectCoachingMetrics(userEmail, quarter);
   // Fetches:
   // - getQuarterlySQOCount(userName, quarter) → { sqoCount, totalAum }
   // - getQuarterlyGoal(userEmail, quarter) → { sqoGoal }
   // - getConversionRates(filters, 'cohort') → { sqlToSqo, sqoToJoined, ... }
   // - getLeaderboardData(quarter) → { rank, teamAverage }
   // - getWeeklyActuals(last4Weeks) → activity trends
   ```

4. **Claude API Call**
   ```typescript
   const systemPrompt = generateCoachingSystemPrompt('sga');
   const userMessage = JSON.stringify(metrics);

   const response = await anthropic.messages.create({
     model: 'claude-sonnet-4-20250514',
     max_tokens: 2048,
     system: systemPrompt,
     messages: [{ role: 'user', content: userMessage }],
   });
   ```

5. **Response Processing**
   ```typescript
   const textBlock = response.content.find(b => b.type === 'text');
   const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
   const insight: CoachingInsight = JSON.parse(jsonMatch[0]);

   // Validate structure
   if (!insight.summary || !insight.focusAreas) {
     throw new Error('Invalid coaching response structure');
   }

   // Save to Prisma
   await prisma.coachingInsight.upsert({
     where: { userEmail_weekStartDate: { userEmail, weekStartDate } },
     update: { insightJson: insight, generatedAt: new Date() },
     create: { userEmail, weekStartDate, insightJson: insight },
   });
   ```

6. **UI Rendering**
   ```tsx
   // CoachingTab.tsx
   const { data: insight, isLoading, error, refetch } = useCoachingInsight(quarter);

   return (
     <div>
       {isLoading && <CoachingSkeleton />}
       {error && <ErrorCard message={error} onRetry={refetch} />}
       {insight && (
         <>
           <CoachingInsightCard insight={insight} />
           <FocusAreaList areas={insight.focusAreas} />
           <WinsSection wins={insight.wins} />
         </>
       )}
     </div>
   );
   ```

---

## 6.4 Security Considerations
**Goal**: Ensure Coach AI follows security best practices

**Q6.4.1**: What security considerations apply to Coach AI?
- SGA data isolation (can SGAs see others' coaching?)
- Rate limiting Claude API calls
- Input validation
- Prompt injection prevention

**Answer:**

**1. Data Isolation**
```typescript
// Same pattern as existing SGA Hub routes
let userEmail = session.user.email;
const targetUserEmail = searchParams.get('userEmail');

if (targetUserEmail && targetUserEmail !== userEmail) {
  // Only admins can view other SGAs' coaching
  if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  userEmail = targetUserEmail;
}

// Query uses authenticated userEmail only
const insight = await getCoachingInsight(userEmail);
```

**2. Rate Limiting**
```typescript
// Use existing Upstash Redis rate limiting
import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({
  interval: 60 * 1000, // 1 minute
  uniqueTokenPerInterval: 100,
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  try {
    await limiter.check(5, session.user.email); // 5 regenerates per minute
  } catch {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before refreshing.' },
      { status: 429 }
    );
  }
  // ... continue
}
```

**3. Input Validation**
```typescript
// Quarter format validation
const quarterRegex = /^\d{4}-Q[1-4]$/;
if (quarter && !quarterRegex.test(quarter)) {
  return NextResponse.json({ error: 'Invalid quarter format' }, { status: 400 });
}

// Sanitize any user-provided text before including in prompts
const sanitizedNotes = userNotes?.slice(0, 500).replace(/[<>]/g, '');
```

**4. Prompt Injection Prevention**
```typescript
// Never include raw user input in prompts
// Only pass structured, validated data

const metricsForPrompt = {
  sqoCount: Number(metrics.sqoCount),  // Ensure number
  sqoGoal: Number(metrics.sqoGoal),
  rank: Number(metrics.rank),
  // ... structured data only
};

// System prompt is static, user data is JSON-structured
const response = await anthropic.messages.create({
  system: STATIC_SYSTEM_PROMPT,  // No user input here
  messages: [{
    role: 'user',
    content: JSON.stringify(metricsForPrompt)  // Structured data only
  }],
});
```

**5. Output Validation**
```typescript
// Validate Claude's response before displaying
const insight = JSON.parse(response);

// Sanitize any strings that will be rendered
insight.summary = DOMPurify.sanitize(insight.summary);
insight.focusAreas = insight.focusAreas.map(area => ({
  ...area,
  insight: DOMPurify.sanitize(area.insight),
  action: DOMPurify.sanitize(area.action),
}));
```

---

# PHASE 7: Integration Points ✅ COMPLETE

## 7.1 Navigation
**Goal**: How will users access Coach AI?

**Q7.1.1**: Examine `src/components/layout/Sidebar.tsx`. How would Coach AI be added to navigation? Should it be:
- A new tab in SGA Hub?
- A new page entirely?
- A modal from the SGA Hub?

**Answer:**

**Recommendation: New tab in SGA Hub**

**Reasons:**
1. Coaching is contextually related to SGA performance data
2. Users already go to SGA Hub for performance tracking
3. Keeps navigation simple (no new sidebar item)
4. Follows existing pattern of SGA Hub tabs

**Implementation:**

1. **Add to SGAHubTabs.tsx:**
```typescript
export type SGAHubTab = 'leaderboard' | 'weekly-goals' | 'closed-lost' | 'quarterly-progress' | 'activity' | 'coaching';

const tabs = [
  // ... existing tabs
  { id: 'coaching', label: 'AI Coach', icon: <Bot className="w-4 h-4" /> },
];
```

2. **Add to SGAHubContent.tsx:**
```typescript
{activeTab === 'coaching' && (
  <CoachingTab
    quarter={selectedQuarter}
    isAdmin={isAdmin}
  />
)}
```

**Alternative: If coaching becomes very feature-rich, could become its own page:**
```typescript
// Sidebar.tsx - PAGES array
{ id: 16, name: 'AI Coach', href: '/dashboard/coach', icon: Bot },
```

But for MVP, tab within SGA Hub is recommended.

---

## 7.2 Notifications (Future)
**Goal**: Consider future notification capabilities

**Q7.2.1**: Does the codebase have any notification/email infrastructure? If Coach AI insights are generated weekly, could they be emailed to SGAs?

**Answer:**

**Existing Email Infrastructure:**

Yes, the codebase has SendGrid integration for password reset:
```typescript
// From .env.example
SENDGRID_API_KEY=SG.xxxx
EMAIL_FROM=your-personal-gmail@gmail.com
```

**Notification System:**
- `RequestNotification` model in Prisma for in-app notifications
- `notificationsApi` in api-client.ts
- Bell icon with unread count in UI

**For Weekly Coaching Emails:**

```typescript
// lib/email/coaching-email.ts
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendWeeklyCoachingEmail(
  to: string,
  sgaName: string,
  insight: CoachingInsight
): Promise<void> {
  await sgMail.send({
    to,
    from: process.env.EMAIL_FROM!,
    subject: `Your Weekly Coaching Insights - ${insight.status === 'ahead' ? '🎉' : '📊'}`,
    html: `
      <h2>Hi ${sgaName},</h2>
      <p>${insight.summary}</p>
      <h3>This Week's Focus:</h3>
      <ul>
        ${insight.focusAreas.map(f => `<li><strong>${f.title}</strong>: ${f.action}</li>`).join('')}
      </ul>
      <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/sga-hub?tab=coaching">View full insights →</a></p>
    `,
  });
}
```

**Cron Job Integration:**
```typescript
// /api/cron/weekly-coaching/route.ts
export async function GET(request: NextRequest) {
  // 1. Generate insights for all active SGAs
  // 2. Send emails with summaries
  // 3. Log success/failures
}
```

**Note**: Consider user preferences (opt-in/out) before implementing.

---

# PHASE 8: Testing Strategy ✅ COMPLETE

## 8.1 Testing Patterns
**Goal**: Understand how to test Coach AI

**Q8.1.1**: What testing patterns exist in the codebase? Check for:
- Unit tests
- Integration tests
- API route tests

**Answer:**

**Current Testing Status:**
- No test files found matching `**/*.test.ts` pattern
- No `__tests__` directories
- No Jest or Vitest configuration detected

**Recommended Testing Approach for Coach AI:**

1. **Unit Tests (Vitest/Jest)**
```typescript
// lib/coach-ai/__tests__/prompt.test.ts
describe('generateCoachingSystemPrompt', () => {
  it('generates SGA prompt with correct role', () => {
    const prompt = generateCoachingSystemPrompt('sga');
    expect(prompt).toContain('coaching an individual SGA');
  });

  it('generates manager prompt with team focus', () => {
    const prompt = generateCoachingSystemPrompt('manager');
    expect(prompt).toContain('team\'s overall performance');
  });
});
```

2. **Integration Tests**
```typescript
// lib/coach-ai/__tests__/data-collector.test.ts
describe('collectCoachingMetrics', () => {
  it('returns all required metrics for prompt', async () => {
    const metrics = await collectCoachingMetrics('test@example.com', '2026-Q1');
    expect(metrics).toHaveProperty('sqoCount');
    expect(metrics).toHaveProperty('sqoGoal');
    expect(metrics).toHaveProperty('conversionRates');
  });
});
```

3. **API Route Tests (Mock Claude)**
```typescript
// app/api/coach-ai/__tests__/insights.test.ts
import { POST } from '../insights/route';
import { mockAnthropicResponse } from '@/test/mocks';

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicResponse }
  }))
}));

describe('POST /api/coach-ai/insights', () => {
  it('returns coaching insight for authenticated SGA', async () => {
    const response = await POST(mockRequest);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.insight).toHaveProperty('summary');
  });
});
```

---

**Q8.1.2**: How should Coach AI be tested?
- Mock Claude API responses
- Test with sample SGA data
- Validate prompt construction

**Answer:**

**1. Mock Claude API Responses**
```typescript
// test/mocks/anthropic.ts
export const mockCoachingResponse = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      summary: "You're making great progress this quarter!",
      status: 'ahead',
      focusAreas: [
        {
          title: 'Qualification Calls',
          insight: 'Your 78% SQL→SQO rate is 12% above team average',
          action: 'Schedule 3 additional qualification calls this week',
          priority: 'medium'
        }
      ],
      wins: ['Best SQL→SQO rate on team', '3 SQOs ahead of pace'],
      metrics: { highlight: 'SQL→SQO: 78%', comparison: '+12% vs team avg' }
    })
  }]
};

export const mockAnthropicClient = {
  messages: {
    create: jest.fn().mockResolvedValue(mockCoachingResponse)
  }
};
```

**2. Sample SGA Test Data**
```typescript
// test/fixtures/coaching-data.ts
export const sampleSGAMetrics = {
  userEmail: 'john.doe@savvywealth.com',
  userName: 'John Doe',
  quarter: '2026-Q1',
  sqoCount: 12,
  sqoGoal: 15,
  daysElapsed: 45,
  daysInQuarter: 91,
  expectedSqos: 7.4,
  pacingDiff: 4.6,
  conversionRates: {
    sqlToSqo: 0.78,
    sqoToJoined: 0.12,
  },
  peerComparison: {
    rank: 3,
    totalSGAs: 12,
    teamAverage: 9.5,
  },
  channelBreakdown: [
    { channel: 'Outbound', sqos: 8 },
    { channel: 'Marketing', sqos: 4 },
  ],
};
```

**3. Prompt Validation Tests**
```typescript
// lib/coach-ai/__tests__/prompt-validation.test.ts
describe('Prompt Construction', () => {
  it('includes all required sections', () => {
    const prompt = generateCoachingSystemPrompt('sga');
    expect(prompt).toContain('COACHING PRINCIPLES');
    expect(prompt).toContain('DATA PROVIDED');
    expect(prompt).toContain('OUTPUT FORMAT');
  });

  it('produces valid JSON output format example', () => {
    const prompt = generateCoachingSystemPrompt('sga');
    const jsonMatch = prompt.match(/```json\n([\s\S]*?)\n```/);
    expect(() => JSON.parse(jsonMatch![1])).not.toThrow();
  });
});
```

**4. Response Validation Tests**
```typescript
// lib/coach-ai/__tests__/response-validation.test.ts
describe('validateCoachingResponse', () => {
  it('accepts valid response structure', () => {
    const valid = { summary: 'text', status: 'ahead', focusAreas: [], wins: [] };
    expect(() => validateCoachingResponse(valid)).not.toThrow();
  });

  it('rejects missing required fields', () => {
    const invalid = { summary: 'text' };
    expect(() => validateCoachingResponse(invalid)).toThrow('missing focusAreas');
  });
});
```

---

# SUMMARY

## Key Findings

**Architecture:**
- SGA Hub has 5 tabs with tab-based navigation using React state
- API routes follow consistent auth pattern: `getServerSession` → `getSessionPermissions` → role check
- Anthropic SDK already integrated with 30s timeout, streaming support, and structured prompts
- Caching uses Next.js `unstable_cache` with 4-hour TTL and tag-based invalidation

**Data Model:**
- Goals stored in Prisma (WeeklyGoal, QuarterlyGoal)
- Actuals fetched from BigQuery in real-time
- Cohort mode conversion rates use pre-calculated eligibility flags

**Permissions:**
- SGAs see own data only
- Admin/Manager/RevOps Admin can view any SGA
- `userEmail` query param enables admin data access

**UI Patterns:**
- Tremor components for cards, tables, badges
- Skeleton loading for async content
- Error cards with red background
- Pacing status uses green/yellow/red color scheme

## Recommended Implementation Approach

1. **MVP (Week 1-2):**
   - Add "Coaching" tab to SGA Hub
   - Create `/api/coach-ai/insights` endpoint
   - Implement single SGA coaching view
   - Use Claude with structured JSON output

2. **Phase 2 (Week 3-4):**
   - Add team overview for admins
   - Implement Prisma caching
   - Add weekly cron job generation
   - Add "Refresh Insights" button

3. **Phase 3 (Future):**
   - Historical insight comparison
   - Email notifications
   - Manager 1:1 prep notes

## Open Questions / Decisions Needed

1. **Caching Strategy**: Should insights be generated on-demand or pre-generated weekly? (Recommended: Pre-generate weekly with on-demand refresh)

2. **Tab Placement**: Should Coach AI be a tab in SGA Hub or its own page? (Recommended: Tab in SGA Hub for MVP)

3. **Email Notifications**: Should weekly coaching be emailed? Need to consider opt-in preferences.

4. **Model Selection**: Use claude-sonnet-4 (faster, cheaper) or claude-opus-4.5 (more sophisticated)? (Recommended: Sonnet for MVP, matching existing agent)

## Estimated Complexity

| Component | Complexity | Notes |
|-----------|------------|-------|
| API Route (individual) | Medium | Similar to existing agent route |
| API Route (team) | Medium | Aggregation + multiple SGA data |
| Prisma Model | Low | Single table with JSON field |
| UI - Coaching Tab | Medium | New components, markdown rendering |
| UI - Team Overview | Medium-High | Grid layout, SGA cards |
| Prompt Engineering | Medium | Requires iteration and testing |
| Caching/Cron | Medium | Follow existing patterns |
| Testing | Medium | Mock Claude, fixture data |

**Total Estimated Effort**: 2-3 weeks for full feature

---

*Document created: 2026-02-01*
*Last updated by Claude Code: 2026-02-01*

---

# PHASE 9: FOLLOW-UP QUESTIONS

> **Note**: The following phases (9-19) were added from the follow-up investigation based on gaps identified from initial analysis and SMS research integration needs.

---

# PHASE 9: SMS Activity Integration

The SMS analysis research revealed critical behavioral metrics that should inform coaching. We need to understand how to integrate this data.

## 9.1 SGA Activity Tab Integration
**Goal**: Understand the existing Activity tab and how SMS metrics could be added

**Q9.1.1**: Examine `src/app/dashboard/sga-activity/` and `src/components/sga-activity/`. Document:
- What metrics are currently displayed in the Activity tab?
- How is activity data fetched (which API endpoints)?
- Is SMS data already being displayed? If so, what fields?
- Could Coach AI reuse these components or data sources?

**Answer:**
The Activity tab is a comprehensive dashboard with these components:

**Metrics Currently Displayed:**
| Component | Metrics |
|-----------|---------|
| `ActivityTotalsCards` | Cold Calls, Outbound Calls, SMS Sent, SMS Received, LinkedIn Messages, Emails |
| `RateCards` | SMS Response Rate (leads texted → leads responded), Call Answer Rate |
| `ScheduledCallsCards` | Initial Calls Scheduled (this week/next week), Qualification Calls Scheduled |
| `ActivityDistributionTable` | Activity counts by day of week per channel (Call, SMS, LinkedIn, Email) |

**API Endpoints:**
- `POST /api/sga-activity/dashboard` - Main dashboard data (all metrics)
- `POST /api/sga-activity/activity-records` - Drill-down records with pagination
- `POST /api/sga-activity/scheduled-calls` - Scheduled call records
- `GET /api/sga-activity/filters` - SGA filter options

**SMS Data Already Displayed:**
- `smsOutbound` - Outbound SMS count
- `smsInbound` - Inbound SMS count
- `SMSResponseRate` - Contains: outboundCount, inboundCount, responseRate, responseRatePercent

**Reusability for Coach AI:**
- `getActivityTotals()` - Provides cold calls, outbound calls, SMS counts
- `getSMSResponseRate()` - Provides SMS response rate calculation
- Activity distribution data - Shows activity patterns by day/channel
- Can filter by SGA via `task_executor_name` parameter

**Q9.1.2**: Examine the SGA Activity API routes. What data transformations happen server-side?

**Answer:**
Key transformations in `src/lib/queries/sga-activity.ts`:

1. **Channel Classification** - Complex priority-based channel classification (lines 629-701):
   - Priority 1: Explicit subjects ("LinkedIn Message", "Outgoing SMS")
   - Priority 2: Subject patterns (text, linkedin keywords)
   - Priority 3: Raw channel group
   - Priority 4: Description-based classification
   - Priority 5: Email fallback (only for ambiguous Call channel)

2. **Date Range Handling** - `getDateRange()` converts filter types to start/end dates:
   - Presets: this_week, last_30, last_60, last_90, qtd, all_time, custom
   - Current week is capped to today (not future dates)

3. **SMS Response Rate** - Unique person-based calculation (lines 886-961):
   ```sql
   -- Count distinct leads_texted and leads_responded
   SAFE_DIVIDE(leads_responded, leads_texted) as response_rate
   ```

4. **Activity Distribution** - Calculates per-day averages (not just totals):
   - Counts occurrences of each day in the period
   - Average = total_activities / num_occurrences

---

## 9.2 SMS Metrics Data Access
**Goal**: Determine how to access SMS behavioral metrics for coaching

**Q9.2.1**: Is there existing code that queries `vw_sga_activity_performance`? Search the codebase for references to this view.

**Answer:**
Yes, the view is used in `src/lib/queries/sga-activity.ts`:

```typescript
const ACTIVITY_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance';
```

It's used in 10 query functions:
1. `getScheduledInitialCalls` - Uses FUNNEL_VIEW, not activity view
2. `getScheduledQualificationCalls` - Uses FUNNEL_VIEW
3. `getActivityDistribution` - Uses ACTIVITY_VIEW
4. `getSMSResponseRate` - Uses ACTIVITY_VIEW
5. `getCallAnswerRate` - Uses ACTIVITY_VIEW
6. `getActivityBreakdown` - Uses ACTIVITY_VIEW
7. `getActivityRecords` - Uses ACTIVITY_VIEW
8. `getActivityTotals` - Uses ACTIVITY_VIEW
9. `getSGAActivityFilterOptions` - Uses both ACTIVITY_VIEW and FUNNEL_VIEW

**Q9.2.2**: The SMS analysis used these key metrics. For each, determine if the data is currently accessible in the dashboard:

**Answer:**
| SMS Metric | Available? | How to Access | Notes |
|------------|------------|---------------|-------|
| Response time to lead replies | NOT AVAILABLE | Would need new query on Task timestamps | Need: inbound SMS timestamp - last outbound SMS timestamp per lead |
| Link presence in first SMS | NOT AVAILABLE | Would need Task.Description parsing | Task description contains SMS body content |
| Time of day of first SMS (golden window 8-10 AM) | PARTIAL | `task_created_date_est` available | Need new query to extract hour and filter first SMS per lead |
| AM/PM bookend strategy usage | NOT AVAILABLE | Would need complex query | Check for SMS in AM (before 12pm) AND PM (after 3pm) same day |
| Text count per lead (persistence) | NOT AVAILABLE | Would need COUNT(SMS) per lead | Group by task_who_id, count outbound SMS |

**Recommendation**: Create new BigQuery queries for SMS behavioral metrics:
1. `getSGASMSBehaviorMetrics(sgaName, dateRange)` - Returns all behavioral metrics
2. These queries would join Task table with Lead for response time calculations

---

# PHASE 10: Markdown/Rich Text Rendering

## 10.1 AI Response Rendering
**Goal**: Understand how to render AI-generated coaching content

**Q10.1.1**: Does the codebase have existing markdown rendering capabilities?

**Answer:**
**No dedicated markdown library currently installed.**

Searched for:
- `react-markdown` - Not found
- Markdown components - Not found

**Current AI response rendering pattern** (from `ExploreResults.tsx`):
- Responses rendered as plain text in template explanation cards
- Uses standard HTML elements with Tailwind CSS
- `templateSelection.explanation` shown in `<span>` tags

**Recommendation**: For Coach AI, consider:
1. Install `react-markdown` for rich text coaching insights
2. Or use structured JSON responses (like Explore) with custom React components

**Q10.1.2**: Examine `ExploreResults.tsx`. How are AI-generated responses currently displayed?

**Answer:**
Analysis of `src/components/dashboard/ExploreResults.tsx`:

**Rendering Pattern:**
1. **Template Explanation** (line 1072-1080):
   ```tsx
   <code className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
     {templateSelection.templateId}
   </code>
   <span>{templateSelection.explanation}</span>
   ```

2. **Error States** - Multiple error displays with icons, titles, messages, suggestions
3. **Loading States** - Skeleton placeholders with animated spinner
4. **Feedback Component** - Thumbs up/down with comment collection
5. **Follow-up Suggestions** - Rendered as clickable pills/buttons

**Key UX Patterns to Reuse:**
- Status icons (AlertCircle, Loader2, TrendingUp)
- Color-coded states (blue for info, red for error, green for success)
- Card-based layouts with headers and content sections
- Collapsible sections (`<details>` for conversation history)

**Q10.1.3**: Design a `CoachingInsightCard` component structure.

**Answer:**
Proposed component structure:

```tsx
// src/components/coach-ai/CoachingInsightCard.tsx

interface CoachingInsightCardProps {
  insight: {
    summary: string;
    pacingStatus: 'ahead' | 'on-track' | 'behind';
    sqoCount: number;
    sqoGoal: number;
    focusAreas: FocusArea[];
    wins: string[];
    actionItems: ActionItem[];
    metricHighlights: MetricHighlight[];
  };
  generatedAt: string;
  onRefresh?: () => void;
  isLoading?: boolean;
}

interface FocusArea {
  area: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  suggestion: string;
}

interface ActionItem {
  action: string;
  metric?: string;
  target?: string | number;
  timeline?: string;
}

interface MetricHighlight {
  label: string;
  value: number;
  comparison: { type: 'team_avg' | 'prev_period'; value: number };
  trend: 'up' | 'down' | 'flat';
}

// Component structure:
<Card>
  {/* Header with status badge */}
  <div className="flex justify-between items-center">
    <h3>Weekly Coaching Insight</h3>
    <Badge color={pacingStatusColors[status]}>{status}</Badge>
  </div>

  {/* Summary */}
  <p className="text-gray-700">{summary}</p>

  {/* Pacing Metrics */}
  <ProgressBar value={sqoCount} max={sqoGoal} />

  {/* Focus Areas (collapsible) */}
  <details open>
    <summary>Focus Areas ({focusAreas.length})</summary>
    {focusAreas.map(area => <FocusAreaItem {...area} />)}
  </details>

  {/* Wins */}
  {wins.length > 0 && (
    <div className="bg-green-50 p-3 rounded">
      <h4>Wins This Week</h4>
      <ul>{wins.map(win => <li>{win}</li>)}</ul>
    </div>
  )}

  {/* Action Items */}
  <div>
    <h4>Action Items</h4>
    {actionItems.map(item => <ActionItemRow {...item} />)}
  </div>

  {/* Metric Comparisons */}
  <div className="grid grid-cols-2 gap-4">
    {metricHighlights.map(m => <MetricCompareCard {...m} />)}
  </div>
</Card>
```

---

# PHASE 11: Multi-Model Strategy

## 11.1 Model Selection Architecture
**Goal**: Determine if/how to support multiple AI providers

**Q11.1.1**: Should Coach AI support multiple providers?

**Answer:**
Analysis of current integration:

**Current Anthropic-Only Integration** (`/api/agent/query/route.ts`):
```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Model used:
model: 'claude-sonnet-4-20250514',
max_tokens: 1024,
```

**Environment Variables Pattern:**
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**No abstraction layer exists** - Direct SDK usage in route.ts

**Recommendation**: For MVP, **stick with Anthropic only**:
1. Simpler implementation
2. Consistent with existing Explore feature
3. Claude is well-suited for coaching/advice generation
4. Add abstraction layer only if needed later

**Q11.1.2**: If we wanted to add fallback to a secondary model, what code changes would be needed?

**Answer:**
Proposed abstraction:

```typescript
// src/lib/llm/provider.ts

interface LLMProvider {
  generateCompletion(params: {
    systemPrompt: string;
    userMessage: string;
    maxTokens?: number;
  }): Promise<string>;
}

class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  async generateCompletion(params) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: params.maxTokens || 1024,
      system: params.systemPrompt,
      messages: [{ role: 'user', content: params.userMessage }],
    });
    return response.content[0].text;
  }
}

class GeminiProvider implements LLMProvider {
  // Fallback implementation
}

// Usage with fallback:
async function generateWithFallback(params) {
  try {
    return await anthropicProvider.generateCompletion(params);
  } catch (error) {
    logger.warn('Anthropic failed, falling back to Gemini', error);
    return await geminiProvider.generateCompletion(params);
  }
}
```

**Required changes:**
1. Create `src/lib/llm/` directory with provider abstraction
2. Add `GOOGLE_AI_API_KEY` to env variables
3. Install `@google/generative-ai` package
4. Update timeout handling for different provider SLAs

---

# PHASE 12: Notification/Email Infrastructure

## 12.1 Email Capabilities
**Goal**: Understand if weekly coaching can be emailed to SGAs

**Q12.1.1**: What email capabilities exist?

**Answer:**
Analysis of `src/lib/email.ts`:

**Provider**: SendGrid
```typescript
import sgMail from '@sendgrid/mail';
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
```

**Environment Variables:**
- `SENDGRID_API_KEY` - API key
- `EMAIL_FROM` - Sender email (use personal Gmail, not @savvywealth.com due to DMARC)

**Existing Templates:**
1. `sendPasswordResetEmail()` - HTML + plain text template
   - Professional styling with gradient headers
   - Button CTAs
   - Responsive design
   - Spam folder warning notice

**Rate Limiting**: Yes, via Upstash Redis for forgot-password:
```typescript
// src/lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
const getForgotPasswordLimiter = () => new Ratelimit({...});
```

**Q12.1.2**: What could be reused for coaching emails?

**Answer:**
From `src/app/api/auth/forgot-password/route.ts`:

**Reusable Patterns:**
1. **Rate Limiting Pattern:**
   ```typescript
   const rateLimit = await checkRateLimit(getCoachingEmailLimiter(), userEmail);
   if (!rateLimit.success) {
     return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
   }
   ```

2. **Email Sending Pattern:**
   ```typescript
   const emailSent = await sendCoachingEmail(user.email, coachingInsight, user.name);
   if (!emailSent) {
     logger.error(`Failed to send coaching email to ${user.email}`);
   }
   ```

3. **User Lookup Pattern:**
   ```typescript
   const user = await prisma.user.findUnique({ where: { email } });
   if (!user || !user.isActive) return; // Skip inactive users
   ```

**Q12.1.3**: Design an email notification system for weekly coaching.

**Answer:**
Design:

**When to Send:**
- **Day**: Monday morning (gives SGAs week-ahead planning)
- **Time**: 7:00 AM EST (before workday starts)
- **Trigger**: Cron job + Prisma lookup for users with coaching enabled

**Email Content:**
- **Subject**: "Your Weekly Coaching Insight - Week of {date}"
- **Body**: Summary only (not full report)
  - Pacing status (ahead/on-track/behind)
  - Top 2-3 focus areas
  - "View full coaching" CTA button linking to dashboard

**Opt-in/Opt-out:**
```prisma
model User {
  // Add to schema
  coachingEmailEnabled Boolean @default(true)
  coachingEmailFrequency String @default("weekly") // "weekly" | "daily" | "none"
}
```

**Implementation:**
```typescript
// src/lib/email.ts
export async function sendWeeklyCoachingEmail(
  to: string,
  userName: string,
  insight: {
    pacingStatus: string;
    sqoCount: number;
    sqoGoal: number;
    topFocusAreas: string[];
  }
): Promise<boolean> {
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/sga-hub?tab=coaching`;

  const html = `
    <h2>Good morning, ${userName}!</h2>
    <p>Here's your weekly coaching summary:</p>
    <div style="background: ${pacingColors[insight.pacingStatus]}; padding: 16px; border-radius: 8px;">
      <strong>Pacing: ${insight.pacingStatus.toUpperCase()}</strong>
      <p>${insight.sqoCount} / ${insight.sqoGoal} SQOs</p>
    </div>
    <h3>This Week's Focus:</h3>
    <ul>${insight.topFocusAreas.map(a => `<li>${a}</li>`).join('')}</ul>
    <a href="${dashboardUrl}" style="...">View Full Coaching</a>
  `;

  return sendEmail({ to, subject, text, html });
}
```

---

# PHASE 13: Cron Job Patterns

## 13.1 Scheduled Task Infrastructure
**Goal**: Understand how to schedule weekly coaching generation

**Q13.1.1**: Document the existing cron job pattern.

**Answer:**
From `src/app/api/cron/refresh-cache/route.ts` and `vercel.json`:

**Configuration** (vercel.json):
```json
{
  "crons": [
    { "path": "/api/cron/refresh-cache", "schedule": "10 4 * * *" },
    { "path": "/api/cron/refresh-cache", "schedule": "10 10 * * *" },
    { "path": "/api/cron/refresh-cache", "schedule": "10 16 * * *" },
    { "path": "/api/cron/refresh-cache", "schedule": "10 22 * * *" },
    { "path": "/api/cron/geocode-advisors", "schedule": "0 5 * * *" }
  ]
}
```

**Authentication** (CRON_SECRET):
```typescript
const authHeader = request.headers.get('authorization');
const cronSecret = process.env.CRON_SECRET;
if (authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Max Duration**: Set in vercel.json functions config:
```json
"functions": {
  "src/app/api/agent/query/route.ts": { "maxDuration": 60 }
}
```

**Error Handling**:
- Try/catch with logger.error
- Returns 500 status on failure
- No automatic retry (Vercel handles retries)

**Q13.1.2**: Design a `/api/cron/generate-coaching` endpoint.

**Answer:**
Proposed implementation:

```typescript
// src/app/api/cron/generate-coaching/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { generateCoachingInsight } from '@/lib/coach-ai/generate';
import { sendWeeklyCoachingEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // 1. Validate CRON_SECRET
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get all active SGAs
    const sgas = await prisma.user.findMany({
      where: {
        role: 'sga',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        coachingEmailEnabled: true,
      },
    });

    logger.info(`[Coaching Cron] Starting generation for ${sgas.length} SGAs`);

    const results = {
      success: [] as string[],
      failed: [] as string[],
      emailsSent: 0,
    };

    // 3. Generate coaching for each SGA
    for (const sga of sgas) {
      try {
        // Generate insight
        const insight = await generateCoachingInsight(sga.email, sga.name);

        // Store in Prisma
        await prisma.coachingInsight.upsert({
          where: {
            userEmail_weekStartDate: {
              userEmail: sga.email,
              weekStartDate: getWeekStartDate(),
            },
          },
          create: {
            userEmail: sga.email,
            quarter: getCurrentQuarter(),
            weekStartDate: getWeekStartDate(),
            ...insight,
          },
          update: {
            ...insight,
            generatedAt: new Date(),
          },
        });

        results.success.push(sga.email);

        // 4. Send email if enabled
        if (sga.coachingEmailEnabled) {
          const emailSent = await sendWeeklyCoachingEmail(
            sga.email,
            sga.name,
            {
              pacingStatus: insight.pacingStatus,
              sqoCount: insight.sqoCount,
              sqoGoal: insight.sqoGoal,
              topFocusAreas: insight.focusAreas.slice(0, 3).map(f => f.area),
            }
          );
          if (emailSent) results.emailsSent++;
        }

      } catch (error) {
        logger.error(`[Coaching Cron] Failed for ${sga.email}`, error);
        results.failed.push(sga.email);
      }
    }

    logger.info('[Coaching Cron] Complete', results);

    return NextResponse.json({
      success: true,
      generated: results.success.length,
      failed: results.failed.length,
      emailsSent: results.emailsSent,
    });

  } catch (error) {
    logger.error('[Coaching Cron] Fatal error', error);
    return NextResponse.json({ error: 'Failed to generate coaching' }, { status: 500 });
  }
}
```

**vercel.json addition:**
```json
{
  "functions": {
    "src/app/api/cron/generate-coaching/route.ts": { "maxDuration": 300 }
  },
  "crons": [
    { "path": "/api/cron/generate-coaching", "schedule": "0 12 * * 0" }
  ]
}
```

---

# PHASE 14: Admin Team Overview Design

## 14.1 Team-Level Coaching View
**Goal**: Design the admin/manager team overview

**Q14.1.1**: What patterns can be reused from `AdminQuarterlyProgressView.tsx`?

**Answer:**
Reusable patterns from `src/components/sga-hub/AdminQuarterlyProgressView.tsx`:

**State Management:**
```typescript
const [selectedSGAs, setSelectedSGAs] = useState<string[]>([]);
const [selectedPacingStatuses, setSelectedPacingStatuses] = useState<string[]>(['ahead', 'on-track', 'behind', 'no-goal']);
const [loading, setLoading] = useState(true);
```

**Filter Components:**
- `AdminQuarterlyFilters` - Quarter selector, SGA multi-select, channel/source filters, pacing status filter
- `StatusSummaryStrip` - Quick counts (ahead: X, on-track: Y, behind: Z)

**Data Fetching Pattern:**
```typescript
useEffect(() => {
  const fetchProgress = async () => {
    const progress = await dashboardApi.getAdminQuarterlyProgress({
      year, quarter, sgaNames, channels, sources
    });
    setAdminProgress(progress);
  };
  fetchProgress();
}, [year, quarter, selectedSGAs, selectedChannels, selectedSources]);
```

**Breakdown Table:**
- `SGABreakdownTable` - Sortable table with SGA rows
- Columns: SGA Name, Goal, Current, Progress %, Expected, Pacing Diff, Status
- Click handler for drill-down to SGA details

**Q14.1.2**: Design the Team Coaching Overview UI.

**Answer:**
Proposed design:

```tsx
// src/components/coach-ai/TeamCoachingOverview.tsx

interface TeamCoachingOverviewProps {
  quarter: string;
  onSGAClick: (sgaEmail: string) => void;
}

export function TeamCoachingOverview({ quarter, onSGAClick }: TeamCoachingOverviewProps) {
  return (
    <div className="space-y-6">
      {/* 1. Team-Wide Alerts */}
      <Card className="bg-amber-50 border-amber-200">
        <h3>Team Alerts</h3>
        <ul>
          <li>3 SGAs are below team average on SQL to SQO conversion</li>
          <li>Average response time is 4.2 hours (target: less than 1 hour)</li>
        </ul>
      </Card>

      {/* 2. Status Summary Strip (reuse existing component) */}
      <StatusSummaryStrip
        totalSGAs={12}
        aheadCount={4}
        onTrackCount={5}
        behindCount={3}
        noGoalCount={0}
      />

      {/* 3. Aggregated Coaching Themes */}
      <Card>
        <h3>Common Coaching Themes</h3>
        <div className="grid grid-cols-2 gap-4">
          <ThemeCard theme="Response Time" count={4} icon={<Clock />} />
          <ThemeCard theme="SQL to SQO Conversion" count={3} icon={<TrendingUp />} />
          <ThemeCard theme="Golden Window Texting" count={2} icon={<MessageSquare />} />
          <ThemeCard theme="Activity Volume" count={2} icon={<Activity />} />
        </div>
      </Card>

      {/* 4. SGA Coaching Grid */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3>Individual SGA Coaching</h3>
          <ExportButton label="Export Team Summary" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sgaCoachingList.map(sga => (
            <SGACoachingCard
              key={sga.email}
              sgaName={sga.name}
              pacingStatus={sga.pacingStatus}
              sqoCount={sga.sqoCount}
              sqoGoal={sga.sqoGoal}
              topFocusArea={sga.focusAreas[0]?.area}
              lastUpdated={sga.generatedAt}
              onClick={() => onSGAClick(sga.email)}
            />
          ))}
        </div>
      </div>

      {/* 5. Top Performers Section */}
      <Card className="bg-green-50 border-green-200">
        <h3>Top Performers to Learn From</h3>
        <div className="space-y-2">
          {topPerformers.map(sga => (
            <div className="flex justify-between">
              <span>{sga.name}</span>
              <span className="text-green-600">+{sga.pacingDiff} SQOs ahead</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
```

---

# PHASE 15: Historical Coaching Storage

## 15.1 Coaching History Model
**Goal**: Design storage for historical coaching data

**Q15.1.1**: Review and improve the proposed Prisma model.

**Answer:**
Improved model based on codebase patterns:

```prisma
// Add to prisma/schema.prisma

model CoachingInsight {
  id            String   @id @default(cuid())
  userEmail     String   // Links to User.email
  quarter       String   // "2026-Q1" format (matches QuarterlyGoal)
  weekStartDate DateTime @db.Date // Monday of the week

  // Metrics snapshot at time of generation
  sqoCount         Int
  sqoGoal          Int
  sqoRank          Int?      // Rank among all SGAs
  expectedSqos     Float     // Pacing expectation
  pacingDiff       Float     // Actual - Expected
  pacingStatus     String    // "ahead" | "on-track" | "behind"

  // AI-generated content (JSON for flexibility)
  summary       String   @db.Text
  focusAreas    Json     // Array<{area: string, priority: string, reason: string, suggestion: string}>
  wins          Json     // Array<string>
  actionItems   Json     // Array<{action: string, metric?: string, target?: string}>

  // Conversion rates snapshot (last 90 days at generation)
  contactedToMql Float?
  mqlToSql       Float?
  sqlToSqo       Float?
  teamAvgSqlToSqo Float?  // For comparison display

  // Activity metrics snapshot (last 7 days)
  weeklyContacts     Int?
  weeklyInitialCalls Int?
  weeklyQualCalls    Int?

  // SMS Behavioral metrics (if available)
  smsResponseTimeAvg   Float?
  smsGoldenWindowPct   Float?
  smsBookendStrategyPct Float?

  // Metadata
  modelUsed     String   @default("claude-sonnet-4") // Track model for debugging
  promptVersion String?  // Track prompt version for A/B testing
  generatedAt   DateTime @default(now())
  viewedAt      DateTime? // Track engagement

  // User relation
  // Note: Using email instead of id for consistency with WeeklyGoal pattern

  @@unique([userEmail, weekStartDate])
  @@index([userEmail])
  @@index([weekStartDate])
  @@index([quarter])
  @@index([pacingStatus])
  @@map("coaching_insights")
}

// Also add to User model:
model User {
  // ... existing fields ...

  // Coach AI preferences
  coachingEmailEnabled Boolean @default(true)
  coachingEmailFrequency String @default("weekly") // "weekly" | "none"
}
```

**Why These Changes:**
1. Added `expectedSqos` and `pacingDiff` for pacing display without recalculation
2. Added `promptVersion` for A/B testing prompts
3. Added `sqoRank` for leaderboard context
4. Split SMS metrics into separate fields for easier querying
5. Used `@db.Text` for long strings (summary)
6. Added `@@map("coaching_insights")` for cleaner table name
7. Added index on `pacingStatus` for filtering team views

---

# PHASE 16: Error Handling & Fallbacks

## 16.1 AI Generation Failures
**Goal**: Handle cases where AI generation fails

**Q16.1.1**: What happens in the Explore page if Claude API fails?

**Answer:**
Error handling in `src/app/api/agent/query/route.ts`:

**Timeout Handling:**
```typescript
const CLAUDE_TIMEOUT_MS = 30000; // 30 seconds
const BIGQUERY_TIMEOUT_MS = 30000;

// Timeout wrapper:
const templateSelection = await withTimeout(
  callClaude(question, conversationHistory),
  CLAUDE_TIMEOUT_MS,
  'AI response timed out. Please try a simpler question or rephrase.'
);
```

**Error Response Format:**
```typescript
// Timeout error:
{
  success: false,
  error: {
    code: 'TIMEOUT',
    message: 'AI response timed out...',
    suggestion: 'Try simplifying your question...'
  },
  visualization: 'metric'
}

// Query error:
{
  success: false,
  error: {
    code: 'QUERY_ERROR',
    message: 'Query execution failed',
    suggestion: 'Check the Query Inspector...'
  }
}

// Unsupported question:
{
  success: false,
  error: {
    code: 'UNSUPPORTED_QUESTION',
    message: templateSelection.explanation,
    suggestion: 'Try rephrasing your question...'
  }
}
```

**UI Error Display** (`ExploreResults.tsx`):
- Color-coded error icons (red, orange, gray)
- Clear error title and message
- Actionable suggestion text
- "Try Again" retry button

**Q16.1.2**: Design fallback behavior for Coach AI.

**Answer:**
Proposed fallback strategy:

```typescript
// src/lib/coach-ai/generate.ts

interface CoachingGenerationResult {
  success: boolean;
  insight?: CoachingInsight;
  error?: {
    code: string;
    message: string;
    fallbackUsed?: boolean;
  };
}

export async function generateCoachingInsight(
  sgaEmail: string,
  sgaName: string
): Promise<CoachingGenerationResult> {

  // 1. Collect metrics (can fail partially)
  const metrics = await collectCoachingMetrics(sgaEmail);
  if (metrics.error) {
    // Partial data - continue with what we have
    logger.warn(`Partial metrics for ${sgaEmail}`, metrics.error);
  }

  // 2. Try Claude generation
  try {
    const insight = await withTimeout(
      callClaudeForCoaching(sgaName, metrics),
      45000, // 45 seconds for coaching (more complex)
      'Coaching generation timed out'
    );

    return { success: true, insight };

  } catch (error) {
    logger.error(`Claude failed for ${sgaEmail}`, error);

    // 3. FALLBACK: Generate rule-based coaching
    const fallbackInsight = generateRuleBasedCoaching(sgaName, metrics);

    return {
      success: true,
      insight: fallbackInsight,
      error: {
        code: 'FALLBACK_USED',
        message: 'AI unavailable, showing basic insights',
        fallbackUsed: true,
      },
    };
  }
}

// Rule-based fallback (no AI needed)
function generateRuleBasedCoaching(name: string, metrics: CoachingMetrics): CoachingInsight {
  const focusAreas: FocusArea[] = [];
  const wins: string[] = [];

  // Simple rules for common scenarios
  if (metrics.conversionRates.sqlToSqo.rate < metrics.conversionRates.sqlToSqo.teamAvg) {
    focusAreas.push({
      area: 'SQL to SQO Conversion',
      priority: 'high',
      reason: `Your rate (${metrics.conversionRates.sqlToSqo.rate.toFixed(1)}%) is below team average (${metrics.conversionRates.sqlToSqo.teamAvg.toFixed(1)}%)`,
      suggestion: 'Review qualification criteria and discovery call techniques',
    });
  }

  if (metrics.pacingStatus === 'ahead') {
    wins.push(`You're ahead of pace with ${metrics.sqoCount} SQOs!`);
  }

  return {
    summary: `${name}, here's your weekly snapshot. ${metrics.pacingStatus === 'ahead' ? 'Great work!' : 'Keep pushing!'}`,
    pacingStatus: metrics.pacingStatus,
    sqoCount: metrics.sqoCount,
    sqoGoal: metrics.sqoGoal,
    focusAreas,
    wins,
    actionItems: focusAreas.map(f => ({ action: f.suggestion })),
  };
}
```

**UI Fallback Display:**
```tsx
{insight.fallbackUsed && (
  <div className="bg-amber-50 border-amber-200 p-3 rounded text-sm">
    AI coaching temporarily unavailable. Showing data-based insights.
    <button onClick={onRefresh}>Try AI again</button>
  </div>
)}
```

**Last Week's Coaching Fallback:**
```typescript
// If generation fails completely, show last week's coaching
const lastWeek = await prisma.coachingInsight.findFirst({
  where: { userEmail: sgaEmail },
  orderBy: { weekStartDate: 'desc' },
});

if (lastWeek) {
  return {
    success: true,
    insight: { ...lastWeek, stale: true },
    error: {
      code: 'SHOWING_PREVIOUS',
      message: 'Showing last week\'s coaching while we generate new insights',
    },
  };
}
```

---

# PHASE 17: Prompt Versioning & A/B Testing

## 17.1 Prompt Management
**Goal**: Plan for prompt iteration and testing

**Q17.1.1**: How should coaching prompts be versioned and managed?

**Answer:**
Proposed strategy:

**Option A: Code-Based (Recommended for MVP)**
```typescript
// src/lib/coach-ai/prompts/index.ts

export const PROMPT_VERSIONS = {
  'v1.0': {
    version: 'v1.0',
    description: 'Initial coaching prompt',
    systemPrompt: `You are a sales performance coach...`,
    active: true,
    createdAt: '2026-02-01',
  },
  'v1.1': {
    version: 'v1.1',
    description: 'Added behavioral metrics emphasis',
    systemPrompt: `You are an expert sales performance coach...`,
    active: false,
    createdAt: '2026-02-15',
  },
} as const;

export const ACTIVE_PROMPT = PROMPT_VERSIONS['v1.0'];
```

**Pros:**
- Version controlled with code
- Easy to rollback via deployment
- No database migration needed
- Full diff visibility in git

**A/B Testing Approach:**
```typescript
// src/lib/coach-ai/ab-test.ts

const AB_TEST_CONFIG = {
  enabled: true,
  variants: {
    control: { promptVersion: 'v1.0', weight: 50 },
    treatment: { promptVersion: 'v1.1', weight: 50 },
  },
};

export function selectPromptVariant(userEmail: string): string {
  // Deterministic assignment based on email hash
  const hash = hashCode(userEmail);
  const bucket = Math.abs(hash) % 100;

  let cumulative = 0;
  for (const [variant, config] of Object.entries(AB_TEST_CONFIG.variants)) {
    cumulative += config.weight;
    if (bucket < cumulative) {
      return config.promptVersion;
    }
  }
  return 'v1.0'; // fallback
}
```

**Measuring Effectiveness:**
```sql
-- Query to compare prompt effectiveness
SELECT
  prompt_version,
  AVG(CASE WHEN pacing_status = 'ahead' THEN 1 ELSE 0 END) as pct_ahead,
  AVG(CASE WHEN viewed_at IS NOT NULL THEN 1 ELSE 0 END) as pct_viewed,
  COUNT(*) as total_generated
FROM coaching_insights
WHERE generated_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY prompt_version
```

**Q17.1.2**: Design a prompt template system.

**Answer:**
Template system design:

```typescript
// src/lib/coach-ai/prompts/template.ts

interface PromptTemplate {
  version: string;
  sections: {
    role: string;
    context: string;
    metricsGuide: string;
    outputFormat: string;
    examples: string;
    conditionals: ConditionalSection[];
  };
}

interface ConditionalSection {
  condition: (metrics: CoachingMetrics) => boolean;
  content: string;
}

export function buildCoachingPrompt(
  template: PromptTemplate,
  metrics: CoachingMetrics
): string {
  const { sections } = template;

  let prompt = `
${sections.role}

${sections.context}

## Metrics Provided:
${sections.metricsGuide}

## Data for This SGA:
${JSON.stringify(metrics, null, 2)}
`;

  // Add conditional sections
  for (const conditional of sections.conditionals) {
    if (conditional.condition(metrics)) {
      prompt += `\n\n${conditional.content}`;
    }
  }

  prompt += `
## Output Format:
${sections.outputFormat}

## Examples:
${sections.examples}
`;

  return prompt;
}

// Example template with conditionals
export const coachingTemplateV1: PromptTemplate = {
  version: 'v1.0',
  sections: {
    role: `You are an expert sales performance coach for financial advisor acquisition.`,

    context: `Your job is to provide weekly coaching insights for Sales Growth Advisors (SGAs).`,

    metricsGuide: `
- sqoCount / sqoGoal: Current vs target qualified opportunities
- pacingStatus: "ahead" (>110%), "on-track" (90-110%), "behind" (<90%)
- conversionRates: Compared to team averages
- smsBehavior: Response time, golden window usage (8-10 AM)
`,

    outputFormat: `
Return valid JSON:
{
  "summary": "2-3 sentence personalized summary",
  "focusAreas": [{"area": "...", "priority": "high|medium|low", "reason": "...", "suggestion": "..."}],
  "wins": ["Achievement 1", "Achievement 2"],
  "actionItems": [{"action": "...", "metric": "...", "target": "..."}]
}
`,

    examples: `
Good: "Great week! Your SQL to SQO conversion improved 5 points."
Bad: "Keep working on conversions." (Too generic)
`,

    conditionals: [
      {
        condition: (m) => m.daysSinceCreation < 90,
        content: `## Ramp Consideration:
This SGA is on ramp. Focus on activity building and process learning rather than conversion optimization.`,
      },
      {
        condition: (m) => m.smsBehavior !== undefined,
        content: `## SMS Behavioral Coaching:
SMS metrics are available. Emphasize response time and golden window texting in your coaching.`,
      },
    ],
  },
};
```

---

# PHASE 18: Data Collection for Prompt

## 18.1 Metrics Collector Function
**Goal**: Design the function that collects all data for the coaching prompt

**Q18.1.1**: Document which BigQuery queries and Prisma calls are needed for each field.

**Answer:**
Full mapping:

```typescript
// src/lib/coach-ai/collect-metrics.ts

export async function collectCoachingMetrics(
  sgaEmail: string,
  quarter: string
): Promise<CoachingMetrics> {

  // Get SGA name from email (Prisma)
  const user = await prisma.user.findUnique({
    where: { email: sgaEmail },
    select: { name: true, createdAt: true },
  });
  const sgaName = user?.name || '';

  // Parallel queries for performance
  const [
    productionData,
    conversionData,
    activityData,
    dispositionData,
    channelData,
    goalData,
    leaderboardData,
  ] = await Promise.all([
    // 1. Production (SQO count) - BigQuery
    fetchSQOProduction(sgaName, quarter),

    // 2. Conversion rates - BigQuery (existing query)
    fetchConversionRates(sgaName, quarter),

    // 3. Activity metrics - BigQuery (existing sga-activity queries)
    fetchActivityMetrics(sgaName),

    // 4. Disposition breakdown - BigQuery
    fetchDispositions(sgaName, quarter),

    // 5. Channel performance - BigQuery
    fetchChannelPerformance(sgaName, quarter),

    // 6. Goal data - Prisma
    fetchGoalData(sgaEmail, quarter),

    // 7. Leaderboard rank - BigQuery
    fetchLeaderboardRank(sgaName, quarter),
  ]);

  return buildMetricsObject(...allData);
}
```

**Field-by-Field Source Mapping:**

| Field | Source | Query/Function |
|-------|--------|----------------|
| **Identity** | | |
| sgaName | Prisma | `prisma.user.findUnique()` |
| sgaEmail | Input param | - |
| segment | BigQuery | `vw_funnel_master.Segment__c` |
| rampStatus | BigQuery | `vw_funnel_master.Ramp_Status__c` |
| daysSinceCreation | Prisma | `user.createdAt` then calculate |
| **Production** | | |
| sqoCount | BigQuery | `getLeaderboardData()` from sga-hub.ts |
| sqoGoal | Prisma | `prisma.quarterlyGoal.findUnique()` |
| sqoRank | BigQuery | `ROW_NUMBER() OVER (ORDER BY sqo_count DESC)` |
| totalSGAs | BigQuery | `COUNT(DISTINCT sga_name)` |
| last7DaysSqos | BigQuery | Filter sqo_date >= 7 days ago |
| **Pacing** | | |
| daysElapsed | JS calc | `getQuarterInfo()` helper |
| daysInQuarter | JS calc | `getQuarterInfo()` helper |
| expectedSqos | JS calc | `(sqoGoal / daysInQuarter) * daysElapsed` |
| pacingDiff | JS calc | `sqoCount - expectedSqos` |
| pacingStatus | JS calc | Based on pacingDiff thresholds |
| **Conversion Rates** | | |
| contactedToMql | BigQuery | `getConversionRates()` - cohort mode |
| mqlToSql | BigQuery | `getConversionRates()` - cohort mode |
| sqlToSqo | BigQuery | `getConversionRates()` - cohort mode |
| teamAvg | BigQuery | Same queries without SGA filter |
| **Activity** | | |
| contacts | BigQuery | `getActivityTotals()` |
| initialCalls | BigQuery | Scheduled calls this week |
| qualCalls | BigQuery | Scheduled calls this week |
| **SMS Behavior** (optional) | | |
| responseTimeAvg | BigQuery | NEW query needed |
| goldenWindowPct | BigQuery | NEW query needed |
| bookendStrategyPct | BigQuery | NEW query needed |
| **Trends** | | |
| conversionTrend | BigQuery | Compare 90d vs lifetime |
| **Dispositions** | | |
| mqlLosses | BigQuery | `getDispositionBreakdown()` |
| sqlLosses | BigQuery | `getDispositionBreakdown()` |
| **Channels** | | |
| channels | BigQuery | `getChannelPerformance()` existing |

---

# PHASE 19: Final System Prompt Design

## 19.1 Coaching System Prompt
**Goal**: Design the final system prompt for Coach AI

**Q19.1.1**: Write a complete system prompt for individual SGA coaching.

**Answer:**
Full system prompt:

```typescript
export function generateIndividualCoachingPrompt(metrics: CoachingMetrics): string {
  return `
# Role
You are an expert sales performance coach specializing in financial advisor recruitment. Your job is to provide weekly coaching insights for Sales Growth Advisors (SGAs) at Savvy Wealth.

# Context
Savvy Wealth recruits financial advisors to join their platform. SGAs are responsible for:
1. Contacting leads (Prospects to Contacted)
2. Qualifying leads (MQL to SQL)
3. Converting qualified leads to opportunities (SQL to SQO)
4. Supporting through join process (SQO to Joined)

Key performance metric: SQO (Sales Qualified Opportunity) count vs quarterly goal.

# SGA Being Coached
Name: ${metrics.sgaName}
Segment: ${metrics.segment}
Status: ${metrics.rampStatus} (${metrics.daysSinceCreation} days since start)
Quarter: ${metrics.quarter}

# Current Performance Data

## Production
- SQOs: ${metrics.sqoCount} of ${metrics.sqoGoal} goal (${Math.round((metrics.sqoCount / metrics.sqoGoal) * 100)}%)
- Rank: #${metrics.sqoRank} of ${metrics.totalSGAs} SGAs
- Last 7 days: ${metrics.last7DaysSqos} SQOs

## Pacing
- Days: ${metrics.daysElapsed} of ${metrics.daysInQuarter}
- Expected SQOs at this point: ${metrics.expectedSqos.toFixed(1)}
- Pacing: ${metrics.pacingDiff > 0 ? '+' : ''}${metrics.pacingDiff.toFixed(1)} vs expected
- Status: ${metrics.pacingStatus.toUpperCase()}

## Conversion Rates (Last 90 Days)
| Stage | SGA Rate | Team Avg | Diff |
|-------|----------|----------|------|
| Contacted to MQL | ${metrics.conversionRates.contactedToMql.rate.toFixed(1)}% | ${metrics.conversionRates.contactedToMql.teamAvg.toFixed(1)}% | ${metrics.conversionRates.contactedToMql.diff > 0 ? '+' : ''}${metrics.conversionRates.contactedToMql.diff.toFixed(1)}pp |
| MQL to SQL | ${metrics.conversionRates.mqlToSql.rate.toFixed(1)}% | ${metrics.conversionRates.mqlToSql.teamAvg.toFixed(1)}% | ${metrics.conversionRates.mqlToSql.diff > 0 ? '+' : ''}${metrics.conversionRates.mqlToSql.diff.toFixed(1)}pp |
| SQL to SQO | ${metrics.conversionRates.sqlToSqo.rate.toFixed(1)}% | ${metrics.conversionRates.sqlToSqo.teamAvg.toFixed(1)}% | ${metrics.conversionRates.sqlToSqo.diff > 0 ? '+' : ''}${metrics.conversionRates.sqlToSqo.diff.toFixed(1)}pp |

## Activity (Last 7 Days)
- Contacts: ${metrics.activity.contacts} (avg: ${metrics.activity.avgWeeklyContacts}/week)
- Initial Calls Completed: ${metrics.activity.initialCalls}
- Qual Calls Completed: ${metrics.activity.qualCalls}

${metrics.smsBehavior ? `
## SMS Behavioral Metrics
- Response Time (median): ${metrics.smsBehavior.responseTimeMedian.toFixed(1)} hours
- Golden Window (8-10 AM): ${metrics.smsBehavior.goldenWindowPct.toFixed(0)}% of first texts
- AM/PM Bookend Strategy: ${metrics.smsBehavior.bookendStrategyPct.toFixed(0)}% of leads
- Over-Texting (>2 with no reply): ${metrics.smsBehavior.overTextPct.toFixed(0)}% of leads
` : ''}

## Top Loss Reasons
MQL Losses: ${metrics.dispositions.mqlLosses.map(d => `${d.reason} (${d.sgaPct.toFixed(0)}% vs team ${d.teamPct.toFixed(0)}%)`).join(', ')}
SQL Losses: ${metrics.dispositions.sqlLosses.map(d => `${d.reason} (${d.sgaPct.toFixed(0)}% vs team ${d.teamPct.toFixed(0)}%)`).join(', ')}

# Coaching Principles
1. BE SPECIFIC: Reference actual numbers and comparisons. "Your SQL to SQO is 5pp below team" not "improve conversions"
2. BE ACTIONABLE: Provide concrete suggestions they can implement this week
3. BE BALANCED: Acknowledge wins before addressing areas for improvement
4. BE CONTEXTUAL: ${metrics.rampStatus === 'On Ramp' ? 'This SGA is on ramp - focus on activity and learning, not just conversion optimization' : 'This is a tenured SGA - hold to higher standards'}
5. PRIORITIZE: Focus on 2-3 focus areas max - don't overwhelm

# Bad Examples (Don't do this)
- "Keep working hard" (too generic)
- "Your conversions need work" (no specifics)
- "Try to improve response time" (no target or context)

# Good Examples
- "Your SQL to SQO rate of 32% is 5pp below team average. Review your last 5 closed-lost SQLs to identify qualification gaps."
- "Great week! 3 SQOs puts you +2 ahead of pace. Your golden window texting at 45% is driving results - keep it up."
- "Response time of 4.2 hours is contributing to your below-average MQL rate. This week, aim for less than 1 hour during business hours."

# Output Format
Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence personalized summary starting with their name. Be encouraging but honest.",
  "focusAreas": [
    {
      "area": "Name of focus area (e.g., 'SQL to SQO Conversion')",
      "priority": "high" | "medium" | "low",
      "reason": "Why this matters with specific numbers",
      "suggestion": "Concrete action to take this week"
    }
  ],
  "wins": ["Specific achievement 1", "Specific achievement 2"],
  "actionItems": [
    {
      "action": "Specific action to take",
      "metric": "Metric to track (optional)",
      "target": "Target value (optional)",
      "timeline": "When to complete (optional)"
    }
  ]
}

Maximum 3 focus areas, 3 wins, and 5 action items.
`;
}
```

**Q19.1.2**: Write a separate system prompt for team-level coaching.

**Answer:**
Team coaching prompt:

```typescript
export function generateTeamCoachingPrompt(teamMetrics: TeamCoachingMetrics): string {
  return `
# Role
You are a sales leadership coach providing weekly insights for SGA team managers at Savvy Wealth.

# Context
You're summarizing performance across ${teamMetrics.totalSGAs} SGAs. Your audience is sales leadership who needs:
1. Quick team health overview
2. Common coaching themes to address
3. Top/struggling performers to focus attention on
4. Actionable recommendations for leadership

# Team Performance Data

## Pacing Summary
| Status | Count | % |
|--------|-------|---|
| Ahead | ${teamMetrics.aheadCount} | ${((teamMetrics.aheadCount / teamMetrics.totalSGAs) * 100).toFixed(0)}% |
| On Track | ${teamMetrics.onTrackCount} | ${((teamMetrics.onTrackCount / teamMetrics.totalSGAs) * 100).toFixed(0)}% |
| Behind | ${teamMetrics.behindCount} | ${((teamMetrics.behindCount / teamMetrics.totalSGAs) * 100).toFixed(0)}% |

## Team Totals
- Total SQOs: ${teamMetrics.totalSQOs} of ${teamMetrics.teamGoal} (${((teamMetrics.totalSQOs / teamMetrics.teamGoal) * 100).toFixed(0)}%)
- Team Pacing: ${teamMetrics.teamPacingStatus}

## Conversion Rate Benchmarks
| Stage | Team Avg | Top Quartile | Bottom Quartile |
|-------|----------|--------------|-----------------|
| Contacted to MQL | ${teamMetrics.conversionBenchmarks.contactedToMql.avg.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.contactedToMql.top25.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.contactedToMql.bottom25.toFixed(1)}% |
| MQL to SQL | ${teamMetrics.conversionBenchmarks.mqlToSql.avg.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.mqlToSql.top25.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.mqlToSql.bottom25.toFixed(1)}% |
| SQL to SQO | ${teamMetrics.conversionBenchmarks.sqlToSqo.avg.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.sqlToSqo.top25.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.sqlToSqo.bottom25.toFixed(1)}% |

## Common Coaching Themes
${teamMetrics.commonThemes.map(t => `- ${t.theme}: ${t.sgaCount} SGAs (${t.description})`).join('\n')}

## Top Performers
${teamMetrics.topPerformers.map(p => `- ${p.name}: ${p.sqoCount} SQOs (+${p.pacingDiff} ahead)`).join('\n')}

## Struggling SGAs (Need Attention)
${teamMetrics.strugglingPerformers.map(p => `- ${p.name}: ${p.sqoCount} SQOs (${p.pacingDiff} behind) - Issue: ${p.primaryIssue}`).join('\n')}

# Output Format
Return ONLY valid JSON:
{
  "teamSummary": "2-3 sentence overall team health summary",
  "coachingThemes": [
    {
      "theme": "Theme name",
      "sgaCount": 4,
      "recommendation": "What leadership should do about this"
    }
  ],
  "topPerformerInsights": "What top performers are doing right that can be shared",
  "attentionNeeded": [
    {
      "sgaName": "Name",
      "issue": "Primary issue",
      "suggestedAction": "What manager should do"
    }
  ],
  "weeklyFocus": "Single most important thing for leadership to focus on this week"
}
`;
}
```

---

# SUMMARY OF FOLLOW-UP FINDINGS

## New Components Needed
1. `CoachingInsightCard` - Individual SGA coaching display
2. `TeamCoachingOverview` - Admin/manager team view
3. `FocusAreaItem` - Individual focus area display
4. `ActionItemRow` - Action item with metric/target
5. `MetricCompareCard` - Metric vs team comparison
6. `SGACoachingCard` - Compact SGA card for grid view
7. `ThemeCard` - Coaching theme display for team view

## New API Routes Needed
1. `POST /api/coach-ai/generate` - On-demand coaching generation
2. `GET /api/coach-ai/insight` - Get coaching for current user
3. `GET /api/coach-ai/team` - Get team coaching overview (admin only)
4. `GET /api/cron/generate-coaching` - Weekly batch generation

## New Prisma Models Needed
```prisma
model CoachingInsight {
  id, userEmail, quarter, weekStartDate,
  sqoCount, sqoGoal, sqoRank, expectedSqos, pacingDiff, pacingStatus,
  summary, focusAreas (Json), wins (Json), actionItems (Json),
  conversionRates, activityMetrics, smsBehaviorMetrics,
  modelUsed, promptVersion, generatedAt, viewedAt
}

// User additions:
coachingEmailEnabled, coachingEmailFrequency
```

## Integration Points
1. **SGA Hub** - Add "Coaching" tab (id: 11) after Activity tab
2. **Sidebar** - No change needed (SGA Hub already in nav)
3. **Permissions** - Use existing SGA/admin role checks
4. **Email** - Extend `src/lib/email.ts` with coaching email function
5. **Cron** - Add to `vercel.json` crons array
6. **BigQuery** - Reuse existing `sga-activity.ts` queries
7. **Anthropic** - Reuse pattern from `/api/agent/query`

## Open Technical Decisions
1. **SMS Behavioral Metrics**: Need to confirm which metrics are worth the query complexity
2. **Prompt A/B Testing**: Start with single prompt or build A/B from day one?
3. **Email Frequency**: Weekly only or allow daily option?
4. **Caching Strategy**: Pre-generate weekly or on-demand with cache?
5. **Team View Granularity**: All SGAs or filterable by manager/segment?

---

*Follow-up questions answered: 2026-02-01*
*Last updated by Claude Code: 2026-02-01*
