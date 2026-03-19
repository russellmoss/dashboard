# Code Inspector Findings: Agentic Reporting Feature

**Date**: 2026-03-17
**Codebase**: Savvy Wealth Dashboard (Next.js 14, TypeScript)
**Scope**: User model integration surface and dependency status for Agentic Reporting

---

## Task 1: User Model Relations

**File**: /prisma/schema.prisma, lines 12-35

### Current User model relations (8 total)

| Relation field | Type | Relation name | Model |
|---|---|---|---|
| savedReports | SavedReport[] | (unnamed) | SavedReport |
| gameScores | GameScore[] | (unnamed) | GameScore |
| passwordResetTokens | PasswordResetToken[] | (unnamed) | PasswordResetToken |
| submittedRequests | DashboardRequest[] | SubmittedRequests | DashboardRequest |
| requestComments | RequestComment[] | RequestComments | RequestComment |
| uploadedAttachments | RequestAttachment[] | UploadedAttachments | RequestAttachment |
| requestEdits | RequestEditHistory[] | RequestEdits | RequestEditHistory |
| notifications | RequestNotification[] | UserNotifications | RequestNotification |

### Analysis: Adding ReportJob, ReportShare, ReportConversation

**No conflicts found.** The three proposed relation names are entirely new and do not collide with any existing relation names. All existing named relations use Request-prefixed names.

Caution: ReportShare will likely need a named relation if User appears on both sides (sharedBy and sharedWith). Plan for two named relations on that model.

Recommended additions to the User model in schema.prisma:

```prisma
reportJobs              ReportJob[]
reportShares            ReportShare[]   @relation("ReportShareRecipient")
sharedReports           ReportShare[]   @relation("ReportShareSender")
reportConversations     ReportConversation[]
```

---

## Task 2: Session Token Access

**Primary file**: /src/lib/auth.ts

### session.user.id confirmed present and typed as string

The session callback at line 133 explicitly sets:

```typescript
(session.user as { id?: string }).id = (token.sub ?? token.id) as string;
```

The id field is type-cast as string (not number). Matches User model primary key: String @id @default(cuid()) (schema.prisma line 13).

### getSessionUserId helper

**File**: /src/lib/auth.ts, lines 12-14

```typescript
export function getSessionUserId(session: Session | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}
```

Already used in production at /src/app/api/games/pipeline-catcher/leaderboard/route.ts line 20. Return type is string | null.

### Session field inventory

| Field | Type | Source |
|---|---|---|
| id | string (cuid) | token.sub ?? token.id |
| email | string | token |
| name | string | token |
| role | string | token (one of 8 roles) |
| externalAgency | string or null | token |

### Usage pattern in existing API routes

Most API routes use session?.user?.email for identity checks. Only the games routes use getSessionUserId() for DB foreign key lookups. The Agentic Reporting feature should use getSessionUserId(session) as the FK for ReportJob.userId.

---
## Task 3: Similar Job/Task Models

### Closest match: GcSyncLog

**File**: /prisma/schema.prisma, lines 408-426

Pattern established by GcSyncLog:
- status as a plain String with string-literal comments (not a Prisma enum)
- startedAt / completedAt timestamps rather than a single updatedAt
- errorMessage String? @db.Text plus errorDetails Json? for structured error capture
- triggeredBy String? for loose user attribution (email string, not a FK)

### Second closest match: ExploreFeedback

**File**: /prisma/schema.prisma, lines 100-121

- Uses Json? fields for structured output (compiledQuery Json?, resultSummary Json?)
- Has userId String? (email string, not FK) as loose attribution pattern
- error String? for error storage

### Recommendation for ReportJob

The codebase uses a String-status pattern for job/sync models. However, the DashboardRequest cluster uses Prisma enums (RequestStatus, RequestType, RequestPriority). Since report states are well-defined (pending, running, complete, failed), a Prisma enum is defensible and consistent with the more recent Request models. Either approach is valid.

---

## Task 4: @google-cloud/bigquery

**Status: Already installed (v7.9.4). No action needed.**

File: /package.json, line 33. Also present: @google-cloud/bigquery-data-transfer v5.1.2 (line 34).

BigQuery auth is already wired for both environments (documented in /.env.example):
- Local: GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
- Vercel: GOOGLE_APPLICATION_CREDENTIALS_JSON (single-line JSON string)

---

## Task 5: Vercel AI SDK

**Status: NOT installed.**

Neither ai nor @ai-sdk/anthropic appear in dependencies or devDependencies.
The current AI integration uses @anthropic-ai/sdk v0.71.2 (package.json line 28) directly.

**Action required:**

```bash
npm install ai @ai-sdk/anthropic
```

The architecture spec (agentic-reporting-architecture.md line 42) requires these for streamText(), maxSteps (automatic multi-step tool loops), and Zod tool definitions.

Compatibility note: @anthropic-ai/sdk and @ai-sdk/anthropic are different packages that coexist without conflict. The Explore feature continues using the raw SDK; the Reporting feature uses the Vercel AI SDK. Two different Anthropic client patterns will exist in the codebase.

---

## Task 6: recharts and react-markdown

### recharts

**Status: Already installed (v3.6.0). No action needed.**

File: /package.json, line 58

Animations are disabled on existing chart components per commits eaf6d70 and bc7ae3c (D3 selectAll crash fix). All new report chart components must use isAnimationActive={false} on every chart instance.

### react-markdown

**Status: NOT installed.** Does not appear in package.json.

Action required if needed: Install react-markdown if the report rendering component renders narrative sections as markdown strings. Defer until the rendering component design is finalized.

---

## Task 7: zod

**Status: NOT installed as a direct dependency.**

zod does not appear in package.json. Confirmed by grep: no files in src/ import from zod.

**Action required:**

```bash
npm install zod
```

The architecture spec uses Zod in two places:
1. Tool definitions via the Vercel AI SDK (z.object() for runBigQuery and webSearch parameter schemas)
2. The ReportOutput Zod schema for validating Pass 2 structured JSON output (architecture doc lines 116-121)

Note: The ai package lists Zod as a peer dependency, but explicit declaration in package.json is required since the codebase defines its own schemas directly against it.

---

## Task 8: Tavily / Web Search

**Status: NOT installed and NOT in env.**

Findings:
- No TAVILY_API_KEY env var in /.env.example
- No Tavily client package in package.json
- No existing web search utility in src/
- References to Tavily appear only in agentic-reporting-architecture.md -- planned, not implemented

**Action required for Competitive Intel report only:**

1. Add TAVILY_API_KEY to /.env.example with a comment scoping it to competitive-intel reports
2. No npm package needed -- the architecture spec uses direct fetch() to https://api.tavily.com/search (architecture doc line 698)
3. Add TAVILY_API_KEY to Vercel environment variables before deploying the competitive-intel report type
4. Build the webSearch tool from scratch in src/lib/reporting/tools.ts

Scope note: Web search is used only by the competitive-intel agent. The other three report types (analyze-wins, sga-performance, sgm-analysis) do not require Tavily.

---

## Summary Matrix

| Dependency / Feature | Status | Action Required |
|---|---|---|
| @google-cloud/bigquery | Installed v7.9.4 | None |
| ai (Vercel AI SDK) | NOT installed | npm install ai @ai-sdk/anthropic |
| @ai-sdk/anthropic | NOT installed | (same command as above) |
| recharts | Installed v3.6.0 | None -- use isAnimationActive={false} on all new charts |
| react-markdown | NOT installed | Install only if narrative sections render markdown strings |
| zod | NOT installed | npm install zod |
| TAVILY_API_KEY env var | NOT present | Add to .env.example + Vercel env (competitive-intel only) |
| Tavily npm package | N/A (raw fetch) | None |
| session.user.id type | string (cuid) confirmed | Use getSessionUserId() from /src/lib/auth.ts |
| User model relation conflicts | None | Safe to add 3 new relations |
| Job model pattern | Established by GcSyncLog | Consider enum for ReportJob.status |

**npm installs required before development begins:**

```bash
npm install ai @ai-sdk/anthropic zod
```

---

## User Model: Recommended Prisma Additions

```prisma
model User {
  // ... all existing fields and 8 relations unchanged ...

  // Agentic Reporting relations (new)
  reportJobs              ReportJob[]
  reportShares            ReportShare[]   @relation("ReportShareRecipient")
  sharedReports           ReportShare[]   @relation("ReportShareSender")
  reportConversations     ReportConversation[]
}
```

No migration conflicts with existing relations. Named relations on ReportShare (ReportShareRecipient / ReportShareSender) are required only if both sides reference User. If the share model only tracks the recipient, a single unnamed relation suffices.

---

## Files Relevant to This Investigation

- /prisma/schema.prisma -- User model and all 8 existing relations (lines 12-35); GcSyncLog job pattern (lines 408-426); ExploreFeedback JSON output pattern (lines 100-121)
- /src/lib/auth.ts -- getSessionUserId() helper (lines 12-14); session callback setting session.user.id as string (lines 130-148)
- /src/app/api/games/pipeline-catcher/leaderboard/route.ts -- Live example of getSessionUserId() usage (line 20)
- /package.json -- All dependency versions (lines 27-79)
- /.env.example -- All documented env vars; no TAVILY_API_KEY present
- /agentic-reporting-architecture.md -- Architecture spec driving these requirements