# Agentic Reporting — Build Guide

> Executable by a single Claude Code agent, phase by phase, with human checkpoints at every gate.

## Reference Documents

All decisions in this guide are based on:
- `agentic-reporting-architecture.md` — the architecture spec (single source of truth)
- `exploration/agentic-reporting-exploration-results.md` — synthesized exploration findings
- `exploration/code-inspector-findings.md` — User model, session, dependency status
- `exploration/pattern-finder-findings.md` — permissions, auth, page patterns, email
- `exploration/data-verifier-findings.md` — full BQ column listings, type anomalies

---

## Feature Summary

| Capability | Description |
|-----------|-------------|
| **4 Report Types** | Won Deal Intelligence, SGA Performance, SGM Analysis, Competitive Intel |
| **Three-Pass Generation** | Pass 1 (analysis + narrative) → Pass 1.5 (data verification) → Pass 2 (structured JSON) |
| **Interactive Reports** | Recharts-rendered charts, sortable tables, KPI cards with deltas |
| **Conversational Follow-Up** | Streaming chat against report data with inline visuals |
| **PDF Export** | Client-side `window.print()` with `@media print` stylesheet |
| **Email Notifications** | Email notification on report completion |

---

## Pre-Flight Checklist

### Step 0.1: Verify Clean Build

```bash
npm run build 2>&1 | head -50
```

**If pre-existing errors exist, STOP AND REPORT. Do not proceed with a broken baseline.**

### Step 0.2: Install Dependencies

```bash
npm install ai @ai-sdk/anthropic zod
```

**Do NOT install:**
- `@google-cloud/bigquery` — already installed v7.9.4
- `recharts` — already installed v3.6.0
- `react-markdown` — defer to Phase 3 (only if follow-up narrative uses markdown)

### Step 0.3: Add Environment Variable

Add to `.env.example`:
```
# Agentic Reporting — Competitive Intel only
TAVILY_API_KEY=
```

Add `TAVILY_API_KEY` to Vercel environment variables before deploying competitive-intel reports.

### Step 0.4: Verify Build After Install

```bash
npm run build 2>&1 | head -50
```

Must still pass. If lockfile changes break anything, fix before proceeding.

### Files to Create (Full Inventory)

| # | File Path | Phase | Architecture Doc Section |
|---|-----------|-------|------------------------|
| 1 | `src/types/reporting.ts` | 1 | "Structured JSON Report Schema" (lines 289-423) |
| 2 | `src/lib/reporting/schema.ts` | 1 | "Zod Validation on the Backend" (lines 540-691) + "Verification Zod Schema" (lines 470-491) |
| 3 | `src/lib/reporting/tools.ts` | 1 | "Tool Definitions" (lines 695-810) |
| 4 | `src/lib/reporting/agents.ts` | 2 | "Agent Structure" (lines 178-191) |
| 5 | `src/lib/reporting/prompts/sgm-analysis.ts` | 2 | "Agent: SGM Analysis" (lines 229-245) |
| 6 | `src/lib/reporting/prompts/analyze-wins.ts` | 2 | "Agent: Won Deal Intelligence" (lines 193-208) |
| 7 | `src/lib/reporting/prompts/sga-performance.ts` | 2 | "Agent: SGA Performance" (lines 210-227) |
| 8 | `src/lib/reporting/prompts/competitive-intel.ts` | 2 | "Agent: Competitive Intelligence" (lines 247-271) |
| 9 | `src/lib/reporting/prompts/verification.ts` | 2 | "Pass 1.5 System Prompt" (lines 426-468) |
| 10 | `src/lib/reporting/prompts/structure-conversion.ts` | 2 | "Pass 2 System Prompt" (lines 493-538) |
| 11 | `src/lib/reporting/finalize.ts` | 2 | "Email Notification" (lines 1705-1731) |
| 12 | `src/lib/reporting/follow-up.ts` | 3 | "Follow-Up Context Builder" (lines 1194-1224) + "Suggested Follow-Ups" (lines 1494-1588) |
| 13 | `src/app/api/reports/generate/route.ts` | 2 | "POST /api/reports/generate" (lines 890-1097) |
| 14 | `src/app/api/reports/route.ts` | 2 | "GET /api/reports" (line 1259) |
| 15 | `src/app/api/reports/[id]/route.ts` | 2 | "GET, DELETE /api/reports/[id]" (line 1260-1263) |
| 16 | `src/app/api/reports/[id]/follow-up/route.ts` | 3 | "POST /api/reports/[id]/follow-up" (lines 1099-1189) |
| 17 | `src/app/api/reports/[id]/retry/route.ts` | 4 | "POST /api/reports/[id]/retry" (lines 1286-1345) |
| 18 | `src/app/api/reports/[id]/share/route.ts` | **Deferred** | Sharing deferred to future phase |
| 19 | `src/app/dashboard/reports/page.tsx` | 1 | "Page: /dashboard/reports" (lines 1591-1606) |
| 20 | `src/app/dashboard/reports/ReportsClient.tsx` | 1 | "Frontend" section (lines 1349-1373) |
| 21 | `src/app/dashboard/reports/[id]/page.tsx` | 1 | "Report Detail View" (lines 1608-1615) |
| 22 | `src/app/dashboard/reports/components/ChartRenderer.tsx` | 1 | "ChartRenderer" (lines 1375-1438) |
| 23 | `src/app/dashboard/reports/components/TableRenderer.tsx` | 1 | "Frontend" component tree |
| 24 | `src/app/dashboard/reports/components/KPICardRow.tsx` | 1 | "Frontend" component tree |
| 25 | `src/app/dashboard/reports/components/ReportDetail.tsx` | 1 | "Frontend" component tree (lines 1354-1373) |
| 26 | `src/app/dashboard/reports/components/ReportGenerator.tsx` | 2 | "Page: /dashboard/reports" (lines 1591-1601) |
| 27 | `src/app/dashboard/reports/components/ReportProgress.tsx` | 2 | "Page: /dashboard/reports" (line 1600) |
| 28 | `src/app/dashboard/reports/components/ReportLibrary.tsx` | 4 | "Page: /dashboard/reports" (lines 1602-1606) |
| 29 | `src/app/dashboard/reports/components/Recommendations.tsx` | 1 | "Frontend" component tree |
| 30 | `src/app/dashboard/reports/components/SuggestedFollowUps.tsx` | 3 | "Suggested Follow-Up Questions" (lines 1494-1588) |
| 31 | `src/app/dashboard/reports/components/FollowUpChat.tsx` | 3 | "Follow-Up Chat" (lines 1441-1492) |
| 32 | `src/app/dashboard/reports/components/ExportPDFButton.tsx` | 4 | "PDF Export" (lines 1226-1250) |
| 33 | `src/app/dashboard/reports/components/ShareModal.tsx` | **Deferred** | Sharing deferred to future phase |
| 34 | `src/app/dashboard/reports/print.css` | 4 | "Print-Optimized Styles" (lines 1617-1668) |

### Files to Modify (Full Inventory)

| # | File Path | Phase | What Changes |
|---|-----------|-------|-------------|
| 1 | `prisma/schema.prisma` | 1 | Add ReportJob, ReportShare, ReportConversation models + User relations |
| 2 | `src/lib/permissions.ts` | 1 | Add page 17 to revops_admin and admin in ROLE_PERMISSIONS |
| 3 | `src/lib/email.ts` | 2 | Add `sendReportReadyEmail` helper function |
| 4 | `.env.example` | 0 | Add TAVILY_API_KEY |

---

## Architecture Rules

These apply to every phase:

1. **BigQuery queries**: Never use string interpolation — always `@paramName` syntax in SQL
2. **Auth pattern**: Use `getSessionPermissions(session)` from `@/types/auth` — never `getUserPermissions(email)`
3. **User ID**: Use `getSessionUserId(session)` from `@/lib/auth` — never `session.user.id` directly
4. **Logging**: Use `logger` from `@/lib/logger` — never `console.error`
5. **Role exclusion**: Use `forbidRecruiter(permissions)` and `forbidCapitalPartner(permissions)` from `@/lib/api-authz`
6. **Page pattern**: Every new `page.tsx` must have `export const dynamic = 'force-dynamic'`
7. **Server/client split**: `page.tsx` (async server) + `*Content.tsx` or `*Client.tsx` (`'use client'`)
8. **Recharts**: All chart components must use `isAnimationActive={false}` (D3 selectAll crash fix)
9. **Error responses**: Follow existing convention (401/403/404/400/500 patterns from exploration)
10. **Imports**: Merge into existing import statements — never add a duplicate import from the same module

### BigQuery Type Rules (MUST be encoded in all agent system prompts)

| View | Column | Type | Rule |
|------|--------|------|------|
| vw_funnel_master | All `is_*` flags | INT64 | Use `= 1`, never `IS TRUE` |
| vw_funnel_master | `Date_Became_SQO__c` | TIMESTAMP | Wrap in `DATE()` for date comparisons |
| vw_funnel_master | `Opportunity_AUM_M` | FLOAT64 | Already in millions — do NOT divide by 1M again |
| vw_lost_to_competition | `months_to_move` | FLOAT64 | Use `ROUND()` for display |
| vw_sga_activity_performance | `Company`, `Lead_Original_Source` | INT64 | Do NOT use — use `Original_source` and `Channel_Grouping_Name` instead |
| sms_weekly_metrics_daily | `slow_response_details` | ARRAY\<STRUCT\> | Requires `UNNEST` — cannot flat SELECT |

---

# PHASE 1: Structured JSON Foundation + Prisma + Rendering Components

## Context

This phase establishes the data layer (Prisma models), type system (TypeScript + Zod), permissions, and all rendering components. At the end of this phase, a hardcoded `ReportOutput` JSON fixture renders correctly in the browser — proving the rendering layer works before any agent integration.

## Step 1.1: Prisma Schema — Add 3 New Models

**File**: `prisma/schema.prisma`

Add these 3 models after the existing `GcSyncLog` model (after line 426):

```prisma
// =============================================================================
// AGENTIC REPORTING MODELS
// AI-generated intelligence reports with conversational follow-up
// =============================================================================

model ReportJob {
  id             String    @id @default(cuid())
  type           String    // "analyze-wins" | "sga-performance" | "sgm-analysis" | "competitive-intel"
  status         String    @default("pending") // pending | running | complete | failed

  // Who requested it
  requestedById  String
  requestedBy    User      @relation(fields: [requestedById], references: [id])

  // Input
  customPrompt   String?   // null = default report
  parameters     Json?     // { "name": "Corey Marcello" } for SGM-analysis

  // Output
  reportJson     Json?     // ReportOutput schema — structured data for frontend rendering
  queryLog       Json?     // QueryLogEntry[] — full query results for conversational follow-up
  extractedMetrics Json?   // KeyMetric[] — copied from reportJson.keyMetrics for fast temporal diffing
  verificationResult Json? // VerificationResult — Pass 1.5 data audit (verified: bool, issues[])

  // Sharing
  visibility     String    @default("private") // private | shared | all
  sharedWith     ReportShare[]

  // Follow-up conversations
  conversations  ReportConversation[]

  // Metadata
  stepsCompleted Int       @default(0)  // tool calls completed (for progress UI)
  totalTokens    Int?      // cost tracking (Pass 1 + Pass 2 combined)
  durationMs     Int?      // how long generation took
  error          String?   // error message if failed
  promptVersion  String?   // hash of the prompt version used

  createdAt      DateTime  @default(now())
  completedAt    DateTime?

  @@index([type, requestedById, createdAt(sort: Desc)])
  @@index([requestedById])
  @@index([status])
  @@index([type])
}

model ReportShare {
  id           String    @id @default(cuid())
  reportId     String
  report       ReportJob @relation(fields: [reportId], references: [id], onDelete: Cascade)
  sharedWithId String
  sharedWith   User      @relation("ReportShareRecipient", fields: [sharedWithId], references: [id])
  createdAt    DateTime  @default(now())

  @@unique([reportId, sharedWithId])
  @@index([reportId])
  @@index([sharedWithId])
}

model ReportConversation {
  id        String   @id @default(cuid())
  reportId  String
  report    ReportJob @relation(fields: [reportId], references: [id], onDelete: Cascade)
  role      String   // "user" | "assistant"
  content   String   @db.Text
  createdAt DateTime @default(now())

  @@index([reportId, createdAt])
}
```

Add these relation fields to the **User model** (inside the `model User { ... }` block, after the Dashboard Requests relations at line 34):

```prisma
  // Agentic Reporting relations
  reportJobs              ReportJob[]
  reportShares            ReportShare[]   @relation("ReportShareRecipient")
  reportConversations     ReportConversation[]
```

**Note on ReportShare**: The architecture doc only has one User FK (the recipient `sharedWithId`). We use the named relation `"ReportShareRecipient"` for forward-compatibility if a `sharedById` field is added later. The `sharedReports` / `ReportShareSender` relation from the code-inspector findings is NOT added yet — only add when there's a `sharedById` FK.

## Step 1.2: Generate Migration SQL

**NEVER run `npx prisma migrate dev`** — it does not work in this environment.

Generate a manual SQL migration file:

```sql
-- Migration: Add Agentic Reporting Models
-- Apply manually in Neon SQL Editor

CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "customPrompt" TEXT,
    "parameters" JSONB,
    "reportJson" JSONB,
    "queryLog" JSONB,
    "extractedMetrics" JSONB,
    "verificationResult" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "stepsCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReportConversation" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportConversation_pkey" PRIMARY KEY ("id")
);

-- Indexes for ReportJob
CREATE INDEX "ReportJob_type_requestedById_createdAt_idx" ON "ReportJob"("type", "requestedById", "createdAt" DESC);
CREATE INDEX "ReportJob_requestedById_idx" ON "ReportJob"("requestedById");
CREATE INDEX "ReportJob_status_idx" ON "ReportJob"("status");
CREATE INDEX "ReportJob_type_idx" ON "ReportJob"("type");

-- Indexes for ReportShare
CREATE UNIQUE INDEX "ReportShare_reportId_sharedWithId_key" ON "ReportShare"("reportId", "sharedWithId");
CREATE INDEX "ReportShare_reportId_idx" ON "ReportShare"("reportId");
CREATE INDEX "ReportShare_sharedWithId_idx" ON "ReportShare"("sharedWithId");

-- Indexes for ReportConversation
CREATE INDEX "ReportConversation_reportId_createdAt_idx" ON "ReportConversation"("reportId", "createdAt");

-- Foreign Keys
ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportConversation" ADD CONSTRAINT "ReportConversation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Save this as `prisma/migrations/manual/add_agentic_reporting.sql`.

**STOP AND REPORT** to the user: "Migration SQL generated. Please apply it in the Neon SQL Editor, then I'll run `npx prisma generate`."

After user confirms migration applied:

```bash
npx prisma generate
```

## Step 1.3: Update Permissions — Add Page 17

**File**: `src/lib/permissions.ts`

Add `17` to the `allowedPages` array for these 2 roles ONLY:

- **revops_admin**: `allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]`
- **admin**: `allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17]`

Do NOT add 17 to: manager, sgm, sga, viewer, recruiter, or capital_partner.

Update the comments on revops_admin and admin lines to include `17 = Reports (revops_admin + admin only)`.

## Step 1.4: TypeScript Types

**File**: `src/types/reporting.ts` (NEW)

Create this file with all TypeScript interfaces from architecture doc section "Structured JSON Report Schema" (lines 289-423):

```typescript
// src/types/reporting.ts
// TypeScript types for the Agentic Reporting feature

export type ReportType = 'analyze-wins' | 'sga-performance' | 'sgm-analysis' | 'competitive-intel';

/** Top-level report output from the agent */
export interface ReportOutput {
  title: string;
  reportType: ReportType;
  generatedAt: string; // ISO 8601

  /** 2-4 sentence executive summary for email notifications and report cards */
  executiveSummary: string;

  /** Headline metrics displayed as KPI cards at the top of the report */
  keyMetrics: KeyMetric[];

  /** Ordered report sections — each rendered as a distinct visual block */
  sections: ReportSection[];

  /** Actionable recommendations, ranked by expected impact */
  recommendations: Recommendation[];
}

export interface KeyMetric {
  id: string;
  label: string;
  value: number | string;
  format: 'number' | 'currency' | 'percent' | 'text';
  delta?: {
    value: number;
    direction: 'up' | 'down' | 'flat';
    label: string;
    favorable: boolean;
  };
}

export interface ReportSection {
  id: string;
  title: string;
  narrative: string;
  charts: ChartSpec[];
  tables: TableSpec[];
  callouts: KeyMetric[];
}

// ─── Chart Specifications ───────────────────────────────────────────

export type ChartSpec = BarChartSpec | LineChartSpec | PieChartSpec | ComposedChartSpec;

interface BaseChartSpec {
  id: string;
  title: string;
  subtitle?: string;
  height?: number;
}

export interface BarChartSpec extends BaseChartSpec {
  type: 'bar';
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: { key: string; label: string; color?: string; stackId?: string }[];
  layout?: 'vertical' | 'horizontal';
  showValues?: boolean;
}

export interface LineChartSpec extends BaseChartSpec {
  type: 'line';
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: { key: string; label: string; color?: string; strokeDasharray?: string }[];
  showDots?: boolean;
  referenceLines?: { y: number; label: string; color: string }[];
}

export interface PieChartSpec extends BaseChartSpec {
  type: 'pie';
  data: { name: string; value: number; color?: string }[];
  innerRadius?: number;
}

export interface ComposedChartSpec extends BaseChartSpec {
  type: 'composed';
  data: Record<string, unknown>[];
  xKey: string;
  series: {
    key: string;
    label: string;
    chartType: 'bar' | 'line' | 'area';
    yAxisId?: 'left' | 'right';
    color?: string;
  }[];
  dualAxis?: boolean;
}

// ─── Table Specifications ───────────────────────────────────────────

export interface TableSpec {
  id: string;
  title: string;
  columns: {
    key: string;
    label: string;
    format?: 'number' | 'currency' | 'percent' | 'text' | 'date';
    sortable?: boolean;
    align?: 'left' | 'center' | 'right';
    highlight?: 'high-is-good' | 'low-is-good';
  }[];
  rows: Record<string, unknown>[];
  sortBy?: { key: string; direction: 'asc' | 'desc' };
  highlightRow?: { key: string; value: unknown };
  maxRows?: number;
}

// ─── Recommendations ────────────────────────────────────────────────

export interface Recommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  category: 'source-allocation' | 'sga-coaching' | 'process' | 'positioning' | 'product' | 'monitoring';
  title: string;
  rationale: string;
  expectedImpact?: string;
  timeframe: 'immediate' | 'this-quarter' | 'next-quarter';
}

// ─── Query Log ──────────────────────────────────────────────────────

export interface QueryLogEntry {
  stepIndex: number;
  sql: string;
  description: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  bytesScanned: number;
  durationMs: number;
  timestamp: string;
}

// ─── Report Labels ──────────────────────────────────────────────────

export const REPORT_LABELS: Record<ReportType, string> = {
  'analyze-wins': 'Won Deal Intelligence',
  'sga-performance': 'SGA Performance',
  'sgm-analysis': 'SGM Analysis',
  'competitive-intel': 'Competitive Intelligence',
};

// ─── Suggested Follow-Up Questions ──────────────────────────────────

export interface SuggestedQuestion {
  label: string;
  prompt: string;
  audience: ('revops' | 'manager' | 'leadership')[];
}
```

## Step 1.5: Zod Schemas

**File**: `src/lib/reporting/schema.ts` (NEW)

Create this file with the full Zod schemas from architecture doc lines 540-691 + 470-491. This is a direct copy of the Zod schemas shown in the architecture doc. Key points:

- Include `ReportOutputSchema` (the main validation schema)
- Include `VerificationResultSchema` (Pass 1.5 output validation)
- Export both schemas and their inferred types
- Ensure `sections.charts`, `sections.tables`, `sections.callouts` all have `.default([])`

```typescript
import { z } from 'zod';

// ─── Verification Schema (Pass 1.5) ────────────────────────────────

const VerificationIssueSchema = z.object({
  claim: z.string(),
  cited: z.string(),
  actual: z.string(),
  queryIndex: z.number().optional(),
  severity: z.enum(['error', 'warning']),
});

export const VerificationResultSchema = z.object({
  verified: z.boolean(),
  issueCount: z.number(),
  issues: z.array(VerificationIssueSchema),
  corrections: z.string().optional(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

// ─── Report Output Schema ───────────────────────────────────────────

const KeyMetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  format: z.enum(['number', 'currency', 'percent', 'text']),
  delta: z.object({
    value: z.number(),
    direction: z.enum(['up', 'down', 'flat']),
    label: z.string(),
    favorable: z.boolean(),
  }).optional(),
});

const BarChartSpecSchema = z.object({
  type: z.literal('bar'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.unknown())),
  xKey: z.string(),
  yKeys: z.array(z.object({
    key: z.string(),
    label: z.string(),
    color: z.string().optional(),
    stackId: z.string().optional(),
  })),
  layout: z.enum(['vertical', 'horizontal']).optional(),
  showValues: z.boolean().optional(),
});

const LineChartSpecSchema = z.object({
  type: z.literal('line'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.unknown())),
  xKey: z.string(),
  yKeys: z.array(z.object({
    key: z.string(),
    label: z.string(),
    color: z.string().optional(),
    strokeDasharray: z.string().optional(),
  })),
  showDots: z.boolean().optional(),
  referenceLines: z.array(z.object({
    y: z.number(),
    label: z.string(),
    color: z.string(),
  })).optional(),
});

const PieChartSpecSchema = z.object({
  type: z.literal('pie'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.object({
    name: z.string(),
    value: z.number(),
    color: z.string().optional(),
  })),
  innerRadius: z.number().optional(),
});

const ComposedChartSpecSchema = z.object({
  type: z.literal('composed'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.unknown())),
  xKey: z.string(),
  series: z.array(z.object({
    key: z.string(),
    label: z.string(),
    chartType: z.enum(['bar', 'line', 'area']),
    yAxisId: z.enum(['left', 'right']).optional(),
    color: z.string().optional(),
  })),
  dualAxis: z.boolean().optional(),
});

const ChartSpecSchema = z.discriminatedUnion('type', [
  BarChartSpecSchema,
  LineChartSpecSchema,
  PieChartSpecSchema,
  ComposedChartSpecSchema,
]);

const TableSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    format: z.enum(['number', 'currency', 'percent', 'text', 'date']).optional(),
    sortable: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    highlight: z.enum(['high-is-good', 'low-is-good']).optional(),
  })),
  rows: z.array(z.record(z.unknown())),
  sortBy: z.object({
    key: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  highlightRow: z.object({
    key: z.string(),
    value: z.unknown(),
  }).optional(),
  maxRows: z.number().optional(),
});

const RecommendationSchema = z.object({
  id: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  category: z.enum(['source-allocation', 'sga-coaching', 'process', 'positioning', 'product', 'monitoring']),
  title: z.string(),
  rationale: z.string(),
  expectedImpact: z.string().optional(),
  timeframe: z.enum(['immediate', 'this-quarter', 'next-quarter']),
});

const ReportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  narrative: z.string(),
  charts: z.array(ChartSpecSchema).default([]),
  tables: z.array(TableSpecSchema).default([]),
  callouts: z.array(KeyMetricSchema).default([]),
});

export const ReportOutputSchema = z.object({
  title: z.string(),
  reportType: z.string(),
  generatedAt: z.string(),
  executiveSummary: z.string(),
  keyMetrics: z.array(KeyMetricSchema).min(3).max(12),
  sections: z.array(ReportSectionSchema).min(1),
  recommendations: z.array(RecommendationSchema),
});

export type ReportOutput = z.infer<typeof ReportOutputSchema>;
```

## Step 1.6: Rendering Components

Create these 5 components in `src/app/dashboard/reports/components/`. Each is a `'use client'` component.

**CRITICAL**: Every Recharts component MUST include `isAnimationActive={false}` on every `<Bar>`, `<Line>`, `<Pie>`, `<Area>` element.

### ChartRenderer.tsx

**File**: `src/app/dashboard/reports/components/ChartRenderer.tsx` (NEW)

Implement the chart dispatch component from architecture doc lines 1375-1438. Must handle all 4 chart types: bar, line, pie, composed. Use the `COLORS` array from the architecture doc. Remember `isAnimationActive={false}` on every animated element.

Key implementation details:
- `BarChartComponent`: `layout` defaults to `'vertical'`. `showValues` renders `<LabelList>`.
- `LineChartComponent`: `showDots` defaults to `false`. `referenceLines` renders `<ReferenceLine>`.
- `PieChartComponent`: `innerRadius > 0` = donut chart. Use `<Cell>` for colors.
- `ComposedChartComponent`: `dualAxis` adds a second `<YAxis yAxisId="right" orientation="right">`. `series[].chartType` dispatches to `<Bar>`, `<Line>`, or `<Area>`.

### TableRenderer.tsx

**File**: `src/app/dashboard/reports/components/TableRenderer.tsx` (NEW)

Sortable data table rendered from `TableSpec`. Features:
- Click column header to sort (toggle asc/desc)
- Format values based on column `format` (currency: `$X.XM`, percent: `X.X%`, number: locale string)
- Conditional formatting via `highlight` (green for "high-is-good" on high values, red for "low-is-good")
- `highlightRow` highlights the matching row
- `maxRows` truncates with "Show more" button
- Use Tailwind classes consistent with existing dashboard tables

### KPICardRow.tsx

**File**: `src/app/dashboard/reports/components/KPICardRow.tsx` (NEW)

Horizontal row of metric cards. Each card shows:
- `label` (muted text)
- `value` (large, formatted per `format`)
- `delta` badge if present (green/red based on `favorable`, arrow based on `direction`)

Use the `kpi-card-row` CSS class for print compatibility.

### Recommendations.tsx

**File**: `src/app/dashboard/reports/components/Recommendations.tsx` (NEW)

Renders an array of `Recommendation` objects as cards:
- Priority badge (high=red, medium=yellow, low=green)
- Category tag
- Title (bold)
- Rationale (body text)
- Expected impact + timeframe (footer)

Use the `recommendation-card` CSS class for print compatibility.

### ReportDetail.tsx

**File**: `src/app/dashboard/reports/components/ReportDetail.tsx` (NEW)

The full interactive report view. Component tree from architecture doc lines 1354-1373:

```
<ReportDetail report={reportOutput}>
  <ReportHeader />          // title, date, actions (PDF export)
  <KPICardRow metrics={keyMetrics} />
  {sections.map(section => (
    <div key={section.id} className="report-section">
      <h2>{section.title}</h2>
      <div>{section.narrative}</div>   // prose paragraphs
      {section.charts.map(chart => <ChartRenderer key={chart.id} spec={chart} />)}
      {section.tables.map(table => <TableRenderer key={table.id} spec={table} />)}
      {section.callouts.length > 0 && <KPICardRow metrics={section.callouts} />}
    </div>
  ))}
  <Recommendations items={recommendations} />
</ReportDetail>
```

## Step 1.7: Hardcoded Report Fixture for Rendering Validation

**File**: `src/app/dashboard/reports/fixtures/sample-report.ts` (NEW)

Create a hardcoded `ReportOutput` JSON object for SGM Analysis. This fixture validates the rendering layer before agent integration. Include:

- `title`: "SGM Analysis — Sample Report"
- `reportType`: `"sgm-analysis"`
- `executiveSummary`: 2 sentences
- `keyMetrics`: 4 KPI cards (total SQOs, close rate, avg AUM, pipeline value — all hardcoded numbers)
- `sections`: 2 sections:
  - Section 1: "Qualification Discipline" — 1 paragraph narrative + 1 bar chart (5 SGMs with SQL→SQO rates) + 1 table (same data with additional columns)
  - Section 2: "Pipeline Health" — 1 paragraph narrative + 1 composed chart (monthly SQOs as bars + close rate as line, dual axis)
- `recommendations`: 2 recommendations (1 high, 1 medium)

All data must be realistic but hardcoded — no API calls.

## Step 1.8: Dashboard Page Scaffold

### page.tsx (Server Component)

**File**: `src/app/dashboard/reports/page.tsx` (NEW)

```typescript
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import ReportsClient from './ReportsClient';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  if (!permissions.allowedPages.includes(17)) {
    redirect('/dashboard');
  }

  return <ReportsClient permissions={permissions} />;
}
```

### ReportsClient.tsx (Client Component)

**File**: `src/app/dashboard/reports/ReportsClient.tsx` (NEW)

```typescript
'use client';

import { UserPermissions } from '@/types/user';
import { ReportDetail } from './components/ReportDetail';
import { SAMPLE_REPORT } from './fixtures/sample-report';

interface ReportsClientProps {
  permissions: UserPermissions;
}

export default function ReportsClient({ permissions }: ReportsClientProps) {
  // Phase 1: Render hardcoded fixture to validate rendering components
  // Phase 2: Replace with report generator + library
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Intelligence Reports</h1>
      <p className="text-muted-foreground">
        Phase 1 rendering validation — hardcoded fixture below.
      </p>
      <ReportDetail report={SAMPLE_REPORT} />
    </div>
  );
}
```

### Report Detail Page (placeholder)

**File**: `src/app/dashboard/reports/[id]/page.tsx` (NEW)

```typescript
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = getSessionPermissions(session);
  if (!permissions || !permissions.allowedPages.includes(17)) {
    redirect('/dashboard');
  }

  // Phase 2: Fetch report by params.id and render ReportDetail
  return (
    <div className="p-6">
      <p>Report detail page — Phase 2 implementation. Report ID: {params.id}</p>
    </div>
  );
}
```

## PHASE 1 — VALIDATION GATE

```bash
# TypeScript check
npx tsc --noEmit 2>&1 | head -80

# Lint check
npx next lint 2>&1 | head -30

# Full build
npm run build 2>&1 | tail -20

# Verify page 17 added to permissions
grep -n "17" src/lib/permissions.ts

# Verify Prisma models exist
grep -n "model Report" prisma/schema.prisma

# Verify types file
grep -n "export interface ReportOutput" src/types/reporting.ts
```

**Expected**: Build passes with zero errors. Page 17 present in revops_admin and admin only. 3 new Prisma models in schema. ReportOutput interface exported.

**STOP AND REPORT**: Tell the user:
- "Phase 1 complete: Prisma models, types, Zod schemas, rendering components, permissions, and hardcoded fixture."
- "Build status: [pass/fail with error count]"
- "Next: Navigate to `/dashboard/reports` in the browser to verify the hardcoded fixture renders correctly — KPI cards, bar chart, composed chart, table, and recommendations should all be visible."
- "Ready to proceed to Phase 2?"

---

# PHASE 2: Agent Integration — Three-Pass Report Generation

## Context

This phase builds the complete agent infrastructure: system prompts for all 4 report types, the `runBigQuery` and `webSearch` tools, the three-pass generation flow (Pass 1 → Pass 1.5 → Pass 2), and the API routes. **Start with SGM Analysis as the test case** — it's the simplest and fastest report (~60-90s).

## Step 2.1: BigQuery + Web Search Tools

**File**: `src/lib/reporting/tools.ts` (NEW)

Implement the `createRunBigQueryTool()` factory and `webSearch` tool from architecture doc lines 695-810. Key details:

- `createRunBigQueryTool()` returns `{ runBigQuery, getQueryLog }` — fresh query log per report
- Read-only guard: reject anything not starting with `SELECT` or `WITH` (case-insensitive, trimmed)
- Row cap: 200 rows per query result
- `maximumBytesBilled: '1000000000'` (1GB safety cap)
- `timeoutMs: 30000` (30s per query)
- `projectId: 'savvy-gtm-analytics'`
- `webSearch` uses `fetch('https://api.tavily.com/search')` with `process.env.TAVILY_API_KEY`
- `webSearch` `include_domains` from architecture doc line 794-798

Import pattern:
```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';
import type { QueryLogEntry } from '@/types/reporting';
```

## Step 2.2: Verification Prompt (Pass 1.5)

**File**: `src/lib/reporting/prompts/verification.ts` (NEW)

Export `VERIFICATION_PROMPT` — the exact string from architecture doc lines 433-467.

## Step 2.3: Structure Conversion Prompt (Pass 2)

**File**: `src/lib/reporting/prompts/structure-conversion.ts` (NEW)

Export `STRUCTURE_CONVERSION_PROMPT` — the exact string from architecture doc lines 500-537.

## Step 2.4: SGM Analysis Agent Prompt (Test Case)

**File**: `src/lib/reporting/prompts/sgm-analysis.ts` (NEW)

Export `SGM_ANALYSIS_PROMPT`. This is the system prompt for the SGM Analysis agent. Build it from the architecture doc description (lines 229-245) combined with the existing `/SGM-analysis` skill file.

The prompt MUST include the **BigQuery Type Rules** section:

```
## BigQuery Type Rules (CRITICAL — follow exactly)
- All `is_*` flag columns (is_joined, is_sqo, is_mql, etc.) are INT64: use `= 1`, NEVER `IS TRUE`
- `Date_Became_SQO__c` is TIMESTAMP: wrap in `DATE()` for date comparisons
- `Opportunity_AUM_M` is already in millions: do NOT divide by 1,000,000 again
- `months_to_move` is FLOAT64: use `ROUND()` for display
- Use `Original_source` and `Channel_Grouping_Name` for source labels (NOT `Company` or `Lead_Original_Source` which are INT64)
```

The prompt should instruct the agent to:
1. Determine if the name is an SGM or SGA
2. Pull SQL→SQO qualification rates for ALL SGMs (comparison)
3. Analyze SGA routing for this SGM
4. Check current pipeline
5. Quarterly production trend
6. Won/lost analysis by source
7. Output as detailed narrative prose (Pass 2 converts to JSON)

## Step 2.5: Remaining 3 Agent Prompts

**Files** (all NEW):
- `src/lib/reporting/prompts/analyze-wins.ts` — export `ANALYZE_WINS_PROMPT`
- `src/lib/reporting/prompts/sga-performance.ts` — export `SGA_PERFORMANCE_PROMPT`
- `src/lib/reporting/prompts/competitive-intel.ts` — export `COMPETITIVE_INTEL_PROMPT`

Each prompt MUST include:
1. The BigQuery Type Rules section (same as SGM Analysis)
2. Specific query patterns from the architecture doc for that report type
3. Which views/tables to query (from architecture doc report type descriptions)
4. Chart limit guidance: "Bar charts: max 15 categories. Line charts: max 24 data points."
5. Output format: "Write detailed prose narrative with findings. Structure conversion is handled separately."

Build each from the architecture doc's agent descriptions:
- `analyze-wins`: lines 193-208
- `sga-performance`: lines 210-227
- `competitive-intel`: lines 247-271 (include FinTrx scoping for web search)

## Step 2.6: Agent Configuration Registry

**File**: `src/lib/reporting/agents.ts` (NEW)

```typescript
import { SGM_ANALYSIS_PROMPT } from './prompts/sgm-analysis';
import { ANALYZE_WINS_PROMPT } from './prompts/analyze-wins';
import { SGA_PERFORMANCE_PROMPT } from './prompts/sga-performance';
import { COMPETITIVE_INTEL_PROMPT } from './prompts/competitive-intel';
import type { ReportType } from '@/types/reporting';

export interface ReportAgent {
  type: ReportType;
  systemPrompt: string;
  maxSteps: number;
  hasWebSearch: boolean;
  defaultUserPrompt: string;
  requiredParams?: string[];
}

export const REPORT_AGENTS: Record<ReportType, ReportAgent> = {
  'sgm-analysis': {
    type: 'sgm-analysis',
    systemPrompt: SGM_ANALYSIS_PROMPT,
    maxSteps: 10,
    hasWebSearch: false,
    defaultUserPrompt: 'Generate a performance report for {name}.',
    requiredParams: ['name'],
  },
  'analyze-wins': {
    type: 'analyze-wins',
    systemPrompt: ANALYZE_WINS_PROMPT,
    maxSteps: 15,
    hasWebSearch: false,
    defaultUserPrompt: 'Generate a Won Deal Intelligence report.',
  },
  'sga-performance': {
    type: 'sga-performance',
    systemPrompt: SGA_PERFORMANCE_PROMPT,
    maxSteps: 15,
    hasWebSearch: false,
    defaultUserPrompt: 'Generate an SGA Performance Intelligence report.',
  },
  'competitive-intel': {
    type: 'competitive-intel',
    systemPrompt: COMPETITIVE_INTEL_PROMPT,
    maxSteps: 15,
    hasWebSearch: true,
    defaultUserPrompt: 'Generate a Competitive Intelligence report.',
  },
};

export function buildUserMessage(
  type: ReportType,
  customPrompt?: string | null,
  parameters?: Record<string, string> | null
): string {
  const agent = REPORT_AGENTS[type];
  let base = agent.defaultUserPrompt;

  // Substitute parameters (e.g., {name} for SGM-analysis)
  if (parameters) {
    for (const [key, value] of Object.entries(parameters)) {
      base = base.replace(`{${key}}`, value);
    }
  }

  if (customPrompt) {
    return `${base}\n\nAdditional focus from the user: ${customPrompt}`;
  }
  return base;
}

export function getPromptVersionHash(type: ReportType): string {
  // Simple hash of the system prompt for reproducibility tracking
  const prompt = REPORT_AGENTS[type].systemPrompt;
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `v1-${Math.abs(hash).toString(36)}`;
}
```

## Step 2.7: Email Notification Helper

**File**: `src/lib/email.ts` (MODIFY — add function)

Add `sendReportReadyEmail` to the existing file, following the `sendPasswordResetEmail` pattern:

```typescript
export async function sendReportReadyEmail(
  to: string,
  reportTitle: string,
  executiveSummary: string,
  reportUrl: string
): Promise<boolean> {
  const subject = `${reportTitle} — Your report is ready`;

  const text = `
${reportTitle}

${executiveSummary}

View the full interactive report:
${reportUrl}

- The Savvy Dashboard Team
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Savvy Dashboard</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Intelligence Report Ready</p>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="margin-top: 0;">${reportTitle}</h2>
    <p>${executiveSummary}</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${reportUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">View Full Report</a>
    </div>
  </div>
  <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 11px;">
    <p style="margin: 0;">Savvy Wealth | New York, NY</p>
    <p style="margin: 5px 0 0 0;">This is an automated message from the Savvy Dashboard.</p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail({ to, subject, text, html });
}
```

## Step 2.8: Finalize Helper

**File**: `src/lib/reporting/finalize.ts` (NEW)

```typescript
import { prisma } from '@/lib/prisma';
import { sendReportReadyEmail } from '@/lib/email';
import { REPORT_LABELS } from '@/types/reporting';
import type { ReportOutput } from '@/types/reporting';
import { logger } from '@/lib/logger';

export async function notifyReportComplete(jobId: string, userEmail: string) {
  try {
    const job = await prisma.reportJob.findUnique({ where: { id: jobId } });
    if (!job?.reportJson) return;

    const reportJson = job.reportJson as unknown as ReportOutput;
    const reportTitle = REPORT_LABELS[job.type as keyof typeof REPORT_LABELS] || job.type;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const reportUrl = `${appUrl}/dashboard/reports/${job.id}`;

    await sendReportReadyEmail(
      userEmail,
      reportTitle,
      reportJson.executiveSummary,
      reportUrl
    );
  } catch (error) {
    logger.error('[notifyReportComplete] Failed to send email', error);
    // Non-blocking — report is already saved
  }
}
```

## Step 2.9: Generate Route — Three-Pass Flow

**File**: `src/app/api/reports/generate/route.ts` (NEW)

**IMPORTANT**: The exact implementation code for the three-pass flow is in `agentic-reporting-architecture.md` lines 890-1097. Copy the implementation from there — do NOT write it from scratch based on the descriptions below. The descriptions below are a summary for human review; the architecture doc is the executable source of truth.

Key implementation details:

- `export const maxDuration = 300;` (requires Vercel Pro)
- `export const dynamic = 'force-dynamic';`
- Auth block: `getServerSession` → `getSessionPermissions` → `forbidRecruiter` → `forbidCapitalPartner` → `allowedPages.includes(17)`
- User ID: `getSessionUserId(session)` — return 404 if null
- Validate `type` is one of the 4 ReportType values
- Validate `parameters` — SGM-analysis requires `name`
- Create `ReportJob` with `status: 'running'`
- **Pass 1**: `streamText()` with agent system prompt + tools + `maxSteps`
- `onStepFinish`: increment `stepsCompleted` on the job
- After Pass 1: persist `queryLog` immediately
- **Pass 1.5**: `generateText()` with `VERIFICATION_PROMPT` — input is narrative + query results
- Parse verification JSON, persist `verificationResult` on job
- If verification finds errors with `severity: 'error'`, apply corrections via a correction call
- **Pass 2**: `generateText()` with `STRUCTURE_CONVERSION_PROMPT`
- Validate output with `ReportOutputSchema.parse()`
- If validation fails, retry Pass 2 once with the Zod error message
- If retry fails: save as `status: 'failed'` with `rawNarrative` preserved, return `{ retryable: true }`
- If success: save `reportJson`, `extractedMetrics`, `totalTokens`, `durationMs`, `completedAt`, `status: 'complete'`
- Call `notifyReportComplete()`
- Return `{ id, status: 'complete', reportJson }`

Import pattern:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getSessionUserId } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { streamText, generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createRunBigQueryTool, webSearch } from '@/lib/reporting/tools';
import { REPORT_AGENTS, buildUserMessage, getPromptVersionHash } from '@/lib/reporting/agents';
import { ReportOutputSchema, VerificationResultSchema } from '@/lib/reporting/schema';
import { VERIFICATION_PROMPT } from '@/lib/reporting/prompts/verification';
import { STRUCTURE_CONVERSION_PROMPT } from '@/lib/reporting/prompts/structure-conversion';
import { notifyReportComplete } from '@/lib/reporting/finalize';
import type { ReportType, ReportOutput } from '@/types/reporting';
```

## Step 2.10: List Reports Route

**File**: `src/app/api/reports/route.ts` (NEW)

`GET` handler: Returns reports for the current user (own reports only — sharing deferred to future phase).

```typescript
// Auth block (canonical pattern)
// Query: prisma.reportJob.findMany where requestedById = userId
// Order by createdAt desc, select id, type, status, createdAt, completedAt, extractedMetrics (for preview)
// Do NOT return full reportJson in list view (too large)
```

## Step 2.11: Single Report + Delete Routes

**File**: `src/app/api/reports/[id]/route.ts` (NEW)

- `GET`: Fetch single report by ID. Auth check: user must be owner. Include conversations.
- `DELETE`: Delete report. Owner only. Use `prisma.reportJob.delete` (cascade deletes conversations).

## Step 2.12: Report Generator UI

**File**: `src/app/dashboard/reports/components/ReportGenerator.tsx` (NEW)

Form component with:
- 4 report type cards (each with icon, title, description from `REPORT_LABELS`)
- When SGM Analysis selected: show `name` text input (required)
- "Additional instructions" textarea (optional `customPrompt`)
- "Generate Report" button → `POST /api/reports/generate`

## Step 2.13: Report Progress UI

**File**: `src/app/dashboard/reports/components/ReportProgress.tsx` (NEW)

Shows generation progress:
- Poll `GET /api/reports/[id]` every 3 seconds
- Display `stepsCompleted` as a step counter (e.g., "Analyzing data... Step 5 of ~10")
- Show status transitions: pending → running → complete/failed
- On complete: navigate to report detail view
- On failed: show error message + "Retry Formatting" button if `retryable`

## Step 2.14: Update ReportsClient for Phase 2

**File**: `src/app/dashboard/reports/ReportsClient.tsx` (MODIFY)

Replace the Phase 1 fixture rendering with:
- `<ReportGenerator>` at the top
- `<ReportProgress>` when a report is generating
- Report list placeholder (Phase 4 adds full library)

## PHASE 2 — VALIDATION GATE

```bash
# TypeScript check
npx tsc --noEmit 2>&1 | head -80

# Lint check
npx next lint 2>&1 | head -30

# Full build
npm run build 2>&1 | tail -20

# Verify API routes exist
ls -la src/app/api/reports/generate/route.ts
ls -la src/app/api/reports/route.ts
ls -la src/app/api/reports/\[id\]/route.ts

# Verify agent prompts exist
ls -la src/lib/reporting/prompts/

# Verify tools
grep -n "createRunBigQueryTool" src/lib/reporting/tools.ts
```

**Expected**: Build passes. All API routes compile. All 4 agent prompts + verification + structure-conversion prompts exist.

**STOP AND REPORT**: Tell the user:
- "Phase 2 complete: Agent infrastructure, three-pass flow, 4 report types, API routes, and generator UI."
- "Build status: [pass/fail]"
- "**Test now**: Navigate to `/dashboard/reports`, select 'SGM Analysis', enter a name (e.g., 'Corey Marcello'), and generate a report. Verify:"
- "  1. Progress UI shows steps completing"
- "  2. Report completes within 60-90 seconds"
- "  3. Rendered report has KPI cards, charts, tables, and recommendations"
- "  4. Check browser console for any errors"
- "Ready to proceed to Phase 3?"

---

# PHASE 3: Conversational Follow-Up

## Context

This phase adds the follow-up chat feature: users can ask drill-down questions against a completed report's data. The agent has access to the full report, all query results, and can run new BigQuery queries. Follow-up responses can include inline charts/tables via `<<<VISUAL>>>` delimiters.

## Step 3.1: Follow-Up Context Builder + Suggested Questions

**File**: `src/lib/reporting/follow-up.ts` (NEW)

Implement `buildFollowUpContext()` from architecture doc lines 1194-1224:
- Include compact ReportOutput JSON
- Include query summaries (description + SQL + row count)
- Include full result sets, truncated to top 100 rows per query if estimated tokens > 40K

Implement `getSuggestedFollowUps()` from architecture doc lines 1494-1588:
- Return suggested questions per report type
- Each question has `label` (chip text), `prompt` (actual message), `audience` (kept for forward-compatibility, not used for filtering)

## Step 3.2: Follow-Up API Route

**File**: `src/app/api/reports/[id]/follow-up/route.ts` (NEW)

Implement from architecture doc lines 1099-1189:
- `export const maxDuration = 120;`
- Auth: user must be owner (sharing deferred to future phase)
- Load report + conversations (last 20, ordered by createdAt asc)
- Persist user message as `ReportConversation` (role: 'user')
- Cap: 20 messages max, return 400 if exceeded
- Build follow-up context from report data
- `streamText()` with:
  - System prompt from architecture doc (lines 1152-1172) — includes `<<<VISUAL>>>` delimiter instructions
  - Conversation history + new user message
  - `runBigQuery` tool (fresh instance, maxSteps: 5)
  - `onFinish`: persist assistant response as `ReportConversation` (role: 'assistant')
- Return `result.toDataStreamResponse()` for streaming

**CRITICAL**: The `<<<VISUAL>>>` delimiter parsing is in the system prompt:
```
Wrap each JSON block in <<<VISUAL>>> and <<<END_VISUAL>>> delimiters.
Everything outside these delimiters is narrative prose (markdown allowed).
```

## Step 3.3: Follow-Up Chat Component

**File**: `src/app/dashboard/reports/components/FollowUpChat.tsx` (NEW)

Implement from architecture doc lines 1441-1492:
- Chat input at the bottom
- Message list above (user + assistant messages)
- `parseFollowUpResponse(text)` — splits on `<<<VISUAL>>>...<<<END_VISUAL>>>` regex
- Renders blocks: narrative → markdown, chart → `<ChartRenderer>`, table → `<TableRenderer>`, metrics → `<KPICardRow>`
- Streaming support: use `useChat` from the `ai/react` package or manual fetch with ReadableStream
- If using `react-markdown` for narrative blocks: `npm install react-markdown` now

## Step 3.4: Suggested Follow-Up Chips

**File**: `src/app/dashboard/reports/components/SuggestedFollowUps.tsx` (NEW)

- Row of clickable chips above the chat input
- Render ALL suggested questions as chips — no role-based filtering (only revops_admin and admin have access anyway)
- Keep the `audience` field in the `SuggestedQuestion` data structure for forward-compatibility, but do NOT filter on it
- On click: send the `prompt` to the follow-up chat

## Step 3.5: Wire Follow-Up into ReportDetail

**File**: `src/app/dashboard/reports/components/ReportDetail.tsx` (MODIFY)

Add below `<Recommendations>`:
```tsx
<SuggestedFollowUps questions={suggestedQuestions} onSelect={handleFollowUp} />
<FollowUpChat reportId={report.id} />
```

## Step 3.6: Update Report Detail Page

**File**: `src/app/dashboard/reports/[id]/page.tsx` (MODIFY)

Replace placeholder with actual report fetching:
- Fetch report by `params.id` via `prisma.reportJob.findUnique`
- Auth check: user must be owner
- Pass `reportJson` to `<ReportDetail>`

## PHASE 3 — VALIDATION GATE

```bash
# TypeScript check
npx tsc --noEmit 2>&1 | head -80

# Lint check
npx next lint 2>&1 | head -30

# Full build
npm run build 2>&1 | tail -20

# Verify follow-up route exists
ls -la src/app/api/reports/\[id\]/follow-up/route.ts

# Verify VISUAL delimiter parsing
grep -n "VISUAL" src/app/dashboard/reports/components/FollowUpChat.tsx
```

**Expected**: Build passes. Follow-up route compiles. VISUAL delimiter parsing in FollowUpChat.

**STOP AND REPORT**: Tell the user:
- "Phase 3 complete: Follow-up chat with streaming, inline visuals, suggested questions, and conversation persistence."
- "Build status: [pass/fail]"
- "**Test now**: Open a completed report, try these follow-up interactions:"
- "  1. Click a suggested follow-up question chip"
- "  2. Verify streaming response appears"
- "  3. If the agent produces an inline chart (<<<VISUAL>>> block), verify it renders"
- "  4. Ask a custom question: 'Show me the top 5 deals by AUM in a table'"
- "  5. Verify conversation persists — reload the page and check messages are still there"
- "Ready to proceed to Phase 4?"

---

# PHASE 4: PDF Export + Report Library + Error UX

## Context

This phase adds the remaining user-facing features: PDF export via `window.print()`, the report library (list/filter/search), email notifications, and the error retry UX for failed reports. Sharing is deferred to a future phase.

## Step 4.1: Print Stylesheet

**File**: `src/app/dashboard/reports/print.css` (NEW)

Implement from architecture doc lines 1619-1668. The exact CSS is in the architecture doc. Key rules:
- Hide: `.follow-up-chat`, `.suggested-follow-ups`, `.report-actions`, `nav`, `aside`
- Charts: `page-break-inside: avoid` on `.recharts-responsive-container`
- Tables: `page-break-inside: avoid` on `tr`
- KPI cards: `.kpi-card-row` stays together
- Sections: `.report-section` avoids breaking
- Typography: 11pt, 1.5 line-height, black text

Import this CSS in the report layout or page component.

## Step 4.2: PDF Export Button

**File**: `src/app/dashboard/reports/components/ExportPDFButton.tsx` (NEW)

From architecture doc lines 1230-1250:
- Simple button: `onClick={() => window.print()}`
- The print CSS handles all formatting automatically
- NO Puppeteer, NO server-side rendering

## Step 4.3: Report Library

**File**: `src/app/dashboard/reports/components/ReportLibrary.tsx` (NEW)

Table/card list of reports:
- Fetch from `GET /api/reports`
- Columns: type (with icon), date, requested by, status, actions
- Filter by: type dropdown, date range
- Actions per row: View, Export PDF, Delete (if owner)
- Status badges: pending (yellow), running (blue), complete (green), failed (red)
- Failed reports with `retryable: true` show "Retry" button

## Step 4.4: Retry Route

**File**: `src/app/api/reports/[id]/retry/route.ts` (NEW)

Implement from architecture doc lines 1286-1345:
- `export const maxDuration = 30;`
- Auth: owner only, status must be 'failed'
- Re-run Pass 2 only using saved `rawNarrative` + `queryLog`
- If success: update to `status: 'complete'`
- If fail: return `{ retryable: false }` with suggestion to regenerate

## Step 4.5: Error UX — Retry Flow

Update `ReportDetail.tsx` to handle failed reports:
- If `status === 'failed'` and `retryable === true`: show "Report analysis completed but formatting failed" + "Retry Formatting" button
- Retry button calls `POST /api/reports/[id]/retry`
- On retry success: re-render with new `reportJson`
- On retry failure: show "Try regenerating the full report" message

## Step 4.6: Wire Everything Together

Update `ReportsClient.tsx` to include:
- `<ReportGenerator>` at the top
- `<ReportLibrary>` below (replaces the Phase 1 fixture)
- Remove hardcoded fixture import

Update `ReportDetail.tsx` to include:
- `<ExportPDFButton>` in the header actions

## PHASE 4 — VALIDATION GATE

```bash
# TypeScript check
npx tsc --noEmit 2>&1 | head -80

# Lint check
npx next lint 2>&1 | head -30

# Full build
npm run build 2>&1 | tail -20

# Verify all routes
find src/app/api/reports -name "route.ts" | sort

# Verify all components
find src/app/dashboard/reports/components -name "*.tsx" | sort

# Verify print CSS
ls -la src/app/dashboard/reports/print.css
```

**Expected**: Build passes with zero errors. 5 API routes. 11+ components. Print CSS exists.

**STOP AND REPORT**: Tell the user:
- "Phase 4 complete: PDF export, report library, email notifications, and error retry UX."
- "Build status: [pass/fail]"
- "**Test groups** (verify in browser):"
- ""
- "**Group 1 — Report Library**:"
- "  1. Navigate to `/dashboard/reports`"
- "  2. Verify previously generated reports appear in the library"
- "  3. Filter by type, verify filtering works"
- "  4. Click 'View' on a report, verify detail page loads"
- ""
- "**Group 2 — PDF Export**:"
- "  1. Open a completed report"
- "  2. Click 'Export PDF' button"
- "  3. Verify print dialog opens"
- "  4. Verify: no chat, no nav, no follow-up chips visible in print preview"
- "  5. Verify: charts render correctly in print preview"
- ""
- "**Group 3 — Error Retry**:"
- "  1. If you have a failed report, verify 'Retry Formatting' button appears"
- "  2. Click retry, verify it either succeeds or shows 'regenerate' message"
- ""
- "Ready to proceed to Phase 5?"

---

# PHASE 5: Documentation Sync + Final Cleanup

## Step 5.1: Run Documentation Generators

```bash
npm run gen:all
```

## Step 5.2: Run Agent-Guard Sync

```bash
npx agent-guard sync
```

Review changes to `ARCHITECTURE.md` and generated inventories. Stage if correct.

## Step 5.3: Verify Everything

```bash
# Final build check
npm run build 2>&1 | tail -20

# Count new API routes
find src/app/api/reports -name "route.ts" | wc -l

# Count new components
find src/app/dashboard/reports -name "*.tsx" | wc -l

# Count new lib files
find src/lib/reporting -name "*.ts" | wc -l
```

## PHASE 5 — VALIDATION GATE

**Expected**: Build passes. Documentation updated. All inventories regenerated.

**STOP AND REPORT**: Tell the user:
- "Phase 5 complete: Documentation synced, inventories regenerated."
- "Full feature inventory: [N] API routes, [M] components, [K] lib files"
- "Ready for final review and commit."

---

# Troubleshooting Appendix

## Common TypeScript Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Type 'any' is not assignable to type 'ReportOutput'` | Prisma Json fields need explicit cast | Cast: `report.reportJson as unknown as ReportOutput` |
| `Property 'reportJobs' does not exist on type 'User'` | Forgot to run `npx prisma generate` after schema change | Run `npx prisma generate` |
| `Module '"ai"' has no exported member 'streamText'` | `ai` package not installed | `npm install ai @ai-sdk/anthropic` |
| `Cannot find module '@ai-sdk/anthropic'` | Package not installed | `npm install @ai-sdk/anthropic` |
| `Module '"zod"' has no exported member 'z'` | `zod` not installed | `npm install zod` |
| `isAnimationActive is not a valid prop` | Using wrong Recharts component | Only applies to `<Bar>`, `<Line>`, `<Pie>`, `<Area>` — not container components |

## BigQuery Query Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `400 Syntax error` | String interpolation in SQL | Use parameterized queries or inline values safely |
| `403 Access denied` | Missing service account permissions | Check `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_APPLICATION_CREDENTIALS_JSON` |
| `Exceeded maximum bytes billed` | Query scans too much data | Narrow date range or add WHERE clause |
| `Query timed out` | Query takes >30s | Optimize query or increase `timeoutMs` |

## Rendering Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| D3 selectAll crash | Missing `isAnimationActive={false}` | Add to every `<Bar>`, `<Line>`, `<Pie>`, `<Area>` element |
| Charts not visible in print | SVG not rendering in print mode | Ensure `ResponsiveContainer` has explicit width/height |
| Tables breaking mid-row in PDF | Missing print CSS | Verify `print.css` has `tr { page-break-inside: avoid; }` |

## Known Limitations

| Limitation | Rationale |
|-----------|-----------|
| 200-row cap per query result | Keeps follow-up context lean; agent rarely needs more for narrative |
| 20-message conversation cap | Prevents context window overflow in follow-up; suggest new report instead |
| No server-side PDF | `window.print()` is free and instant; Puppeteer deferred to Phase 5+ only if needed |
| `slow_response_details` (ARRAY\<STRUCT\>) not directly usable | Requires UNNEST; agent prompt should instruct appropriate handling |
| `Company`/`Lead_Original_Source` in vw_sga_activity_performance are INT64 | Misleading names; agent prompts direct to `Original_source`/`Channel_Grouping_Name` instead |
| Single Anthropic model (`claude-sonnet-4-6`) for all passes | Consistent behavior; Opus could improve Pass 1 quality but at 5x cost |
| No scheduling (Phase 5+) | Vercel cron can be added later for weekly auto-generation |
| Access restricted to revops_admin and admin roles | Sharing and broader role access deferred to future phase |

---

# Phase 5+ / Future — Deferred Features

These features are designed but intentionally deferred from the initial build. The Prisma models (`ReportShare`) and data structures (`audience` on `SuggestedQuestion`) are already in place for forward-compatibility.

## Report Sharing

**Files to create when ready:**
- `src/app/api/reports/[id]/share/route.ts` — `POST`: Accept `{ userIds: string[] }`, create `ReportShare` records, update visibility to 'shared'. Auth: owner only. Validate userIds exist and have page 17 access.
- `src/app/dashboard/reports/components/ShareModal.tsx` — User picker with search by name/email, checkbox multi-select, "Share" button calling the share route.

**Changes required:**
- Update `GET /api/reports` to include reports shared with the user (add OR clause: `sharedWith contains userId`)
- Update `GET /api/reports/[id]` auth check to allow shared-with users
- Update `POST /api/reports/[id]/follow-up` auth check to allow shared-with users
- Add Share button to `ReportDetail.tsx` header actions
- Add "Shared with me" filter to `ReportLibrary.tsx`
- Add `.share-button` to `print.css` hide list

## Broader Role Access

When ready to expand beyond revops_admin and admin:
- Add page 17 to target roles in `ROLE_PERMISSIONS` (manager, sgm, sga)
- Consider per-report-type role gating (e.g., SGAs can only generate SGM Analysis for themselves)
- Re-enable audience-based filtering in `SuggestedFollowUps.tsx`
