# Agentic Reporting — Exploration Results

**Date:** 2026-03-17
**Sources:** data-verifier-findings.md, pattern-finder-findings.md, code-inspector-findings.md

---

## 1. BigQuery Schema Status

### View Existence

| View | Dataset | Status | Columns |
|------|---------|--------|---------|
| vw_funnel_master | Tableau_Views | ✅ Exists | 87 |
| vw_sga_sms_timing_analysis_v2 | savvy_analytics | ✅ Exists | 48 |
| vw_sga_activity_performance | Tableau_Views | ✅ Exists | 57 |
| sms_intent_classified | savvy_analytics | ✅ Exists | 9 |
| sms_weekly_metrics_daily | savvy_analytics | ✅ Exists | 21 |
| vw_lost_to_competition | Tableau_Views | ✅ Exists | 12 |
| Opportunity | SavvyGTMData | ✅ Exists | 100 |
| Task | SavvyGTMData | ✅ Exists | 46 |

**All 8 views/tables exist. No access errors.**

### vw_lost_to_competition — Required Columns

| Column | Type | Status |
|--------|------|--------|
| moved_to_firm | STRING | ✅ |
| months_to_move | FLOAT64 | ✅ (fractional — use ROUND() for display) |
| closed_lost_date | DATE | ✅ |
| closed_lost_reason | STRING | ✅ |
| closed_lost_details | STRING | ✅ |
| opportunity_id | STRING | ✅ |

### vw_funnel_master — Required Columns

| Column | Type | Status | Notes |
|--------|------|--------|-------|
| is_joined | INT64 | ✅ | Use `= 1`, not `IS TRUE` |
| is_joined_unique | INT64 | ✅ | |
| is_sqo_unique | INT64 | ✅ | |
| is_sqo | INT64 | ✅ | |
| is_sql | INT64 | ✅ | |
| is_contacted | INT64 | ✅ | |
| is_mql | INT64 | ✅ | |
| is_primary_opp_record | INT64 | ✅ | |
| SGA_Owner_Name__c | STRING | ✅ | |
| SGM_Owner_Name__c | STRING | ✅ | |
| Opportunity_AUM_M | FLOAT64 | ✅ | Already in millions — do NOT divide by 1M again |
| advisor_join_date__c | DATE | ✅ | |
| Date_Became_SQO__c | TIMESTAMP | ⚠️ | Requires `DATE()` cast for date comparisons |
| StageName | STRING | ✅ | |
| Original_source | STRING | ✅ | |
| Channel_Grouping_Name | STRING | ✅ | |
| contacted_to_mql_progression | INT64 | ✅ | |
| eligible_for_sqo_conversions | INT64 | ✅ | |

### Type Anomalies to Encode in Agent Prompts

| View | Column | Type | Issue |
|------|--------|------|-------|
| vw_funnel_master | Date_Became_SQO__c | TIMESTAMP | Must use `DATE()` cast |
| vw_funnel_master | All `is_*` flags | INT64 | Use `= 1`, not boolean operators |
| vw_funnel_master | Opportunity_AUM_M | FLOAT64 | Already in millions |
| vw_lost_to_competition | months_to_move | FLOAT64 | Fractional — ROUND() for display |
| vw_sga_activity_performance | Company, Lead_Original_Source | INT64 | ⚠️ Misleading names — likely IDs/counts, not text. Use `Original_source` and `Channel_Grouping_Name` instead |
| sms_weekly_metrics_daily | slow_response_details | ARRAY<STRUCT> | Requires UNNEST — cannot flat SELECT |

### Join Key

`Full_prospect_id__c` (STRING) confirmed present in vw_funnel_master, vw_sga_sms_timing_analysis_v2, and vw_sga_activity_performance. 100% match rate.

---

## 2. Integration Surfaces

### Authentication & Authorization

**Auth pattern** (every API route):
```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { logger } from '@/lib/logger';

const session = await getServerSession(authOptions);
if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

const permissions = getSessionPermissions(session);
if (!permissions) return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
```

**User ID extraction**: `getSessionUserId(session)` from `@/lib/auth` — returns `string | null` (cuid).

**Permission check for page access**: `permissions.allowedPages.includes(N)` — next available page number is **17**.

**Role exclusion helpers**: `forbidRecruiter(permissions)` and `forbidCapitalPartner(permissions)` from `@/lib/api-authz`.

**Target roles for reports page**: revops_admin, admin, manager, sgm, sga. Exclude: recruiter, capital_partner, viewer.

### Email

**Function**: `sendEmail({ to, subject, text, html }): Promise<boolean>` from `@/lib/email`.
- Never throws — returns false on failure
- Caller cannot set `from` (always `process.env.EMAIL_FROM`)
- No new env vars needed

**Pattern to follow**: `sendPasswordResetEmail` — build `sendReportReadyEmail(to, reportName, reportUrl)` in same file.

### Prisma Schema Patterns

**FK convention**: `userId String` + `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`
**Index convention**: `@@index([fieldName])` on every FK, composite indexes for query patterns
**Audit fields**: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, `createdBy String?`
**Status field**: Plain `String @default("pending")` with string-literal comments (GcSyncLog pattern). Prisma enums also used (DashboardRequest cluster).

### Dashboard Page Pattern

**Two-file split** (universal):
1. `page.tsx` — async server component: auth → permission check → redirect or render
2. `*Content.tsx` — `'use client'` component with all interactivity

**Required on every page**: `export const dynamic = 'force-dynamic'`

### Error Response Convention

| Status | Body |
|--------|------|
| 401 | `{ error: "Unauthorized" }` or `{ error: "Session invalid" }` |
| 403 | `{ error: "Forbidden" }` |
| 404 | `{ error: "<Entity> not found" }` |
| 400 | `{ error: "<specific validation>" }` |
| 500 | `{ error: "Failed to <verb> <noun>" }` |

---

## 3. Dependency Status

| Package | Status | Version | Action |
|---------|--------|---------|--------|
| @google-cloud/bigquery | ✅ Installed | 7.9.4 | None |
| recharts | ✅ Installed | 3.6.0 | Use `isAnimationActive={false}` on all new charts |
| @anthropic-ai/sdk | ✅ Installed | 0.71.2 | Existing — Explore feature uses this directly |
| **ai** (Vercel AI SDK) | ❌ Not installed | — | `npm install ai @ai-sdk/anthropic` |
| **@ai-sdk/anthropic** | ❌ Not installed | — | (same command) |
| **zod** | ❌ Not installed | — | `npm install zod` |
| react-markdown | ❌ Not installed | — | Defer — install only if narrative renders as markdown |
| TAVILY_API_KEY | ❌ Not in env | — | Add to .env.example + Vercel (competitive-intel only) |

**Pre-development install command:**
```bash
npm install ai @ai-sdk/anthropic zod
```

---

## 4. Risks & Blockers

### No Blockers Found

All views exist, all required columns present, no route collisions, no relation conflicts.

### Risks to Mitigate

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | `Date_Became_SQO__c` is TIMESTAMP, not DATE | Medium | Agent system prompts must include `DATE(Date_Became_SQO__c)` guidance for all date comparisons |
| 2 | `is_*` flags are INT64, not BOOL | Medium | Agent system prompts must use `= 1` comparisons, never `IS TRUE` |
| 3 | `Opportunity_AUM_M` already in millions | Medium | Agent system prompts must warn against double-dividing |
| 4 | `Company` and `Lead_Original_Source` in vw_sga_activity_performance are INT64 | Low | Don't use these — use `Original_source` and `Channel_Grouping_Name` instead |
| 5 | `slow_response_details` is ARRAY<STRUCT> | Low | Requires UNNEST — document in agent prompt for SGA Performance report |
| 6 | `ReportShare` needs named relations if tracking both sender and recipient | Low | Use `@relation("ReportShareRecipient")` — architecture doc only has recipient, no sender FK |
| 7 | Two Anthropic SDK patterns will coexist | Low | @anthropic-ai/sdk (Explore) + @ai-sdk/anthropic (Reporting) — no conflict, just awareness |
| 8 | Vercel Pro required for 300s timeout | Info | Already noted in architecture doc — confirm Pro tier is active before deploying |

---

## 5. Recommendations — Architecture Doc Updates

### Must-Update

1. **Add type guidance to agent system prompts**: All four agent prompts need a "BigQuery Type Rules" section:
   - `is_*` flags: use `= 1`, not `IS TRUE`
   - `Date_Became_SQO__c`: wrap in `DATE()` for date comparisons
   - `Opportunity_AUM_M`: already in millions, do not divide again
   - `months_to_move`: FLOAT64, use `ROUND()` for display

2. **Route paths**: Architecture doc uses `/api/reports/` — no collision exists, but `/api/agentic-reports/` is also available if namespacing is preferred to avoid future conflict with the existing `saved-reports` concept.

3. **ReportShare model**: Architecture doc shows `requestedById` on ReportJob pointing to User, and `sharedWithId` on ReportShare. Since ReportShare only has one User FK (the recipient), a single unnamed relation works. However, if we later add a `sharedById` field, we'll need named relations. Recommend adding named relations now (`"ReportShareRecipient"`) for forward-compatibility.

4. **Page number**: Assign page **17** to the reports page in `ROLE_PERMISSIONS`.

### Should-Update

5. **Permission function**: Architecture doc references `canGenerate(session.user, type)` — this doesn't exist. Implement as a check on `permissions.allowedPages.includes(17)` plus optional per-report-type role gating.

6. **Session user ID**: Architecture doc uses `session.user.id` directly. Prefer the existing `getSessionUserId(session)` helper from `@/lib/auth` for consistency.

7. **Logging**: Architecture doc doesn't specify — all new routes must use `logger` from `@/lib/logger`, not `console.error`.

### Nice-to-Have

8. **react-markdown**: Not installed. If report narrative sections contain markdown formatting (bold, lists, links), install it. If they're plain prose, skip it.

9. **`isAnimationActive={false}`**: All new Recharts components in the report renderer must disable animations to avoid the D3 selectAll crash (per commits bc7ae3c, 6428682).

---

## Summary

**Green light to proceed with build guide.** All data sources verified, all integration patterns documented, all dependencies identified. Three npm packages to install (`ai`, `@ai-sdk/anthropic`, `zod`), one env var to add (`TAVILY_API_KEY` for competitive-intel only), and one page number to assign (17). No blockers.
