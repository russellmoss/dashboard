# Agentic Implementation Guide — Coaching Usage Tab

**Generated:** 2026-05-04
**Inputs:** `exploration-results.md`, `code-inspector-findings.md`, `data-verifier-findings.md`, `pattern-finder-findings.md`
**Target:** Add a "Coaching Usage" tab to `/dashboard/explore`, gated to `revops_admin`, reading the sales-coaching Neon DB via raw `pg`, with 6 KPIs, monthly trend, and a sortable drill-down.

---

## How to Use This Guide

Execute phases **strictly in order**. Each phase ends with a **Validation Gate** (concrete bash/grep commands to run) and a **STOP AND REPORT** checkpoint where you must paste the gate's output before continuing.

**If a validation gate fails:** do not proceed. Fix the issue, re-run the gate, then continue.

**Hard rules (apply to every phase):**
- Never use string interpolation of user input in SQL — `$N` positional params or const-allowlist fragments only.
- Never edit `prisma/schema.prisma` for this feature.
- Never edit `.env.local` or `.env` directly — only `.env.example`.
- Imports merge — never add a second import from the same module.
- Use `reps.full_name` (NOT `reps.name`).
- Use `attendees[i].name` and `attendees[i].email` (NOT `attendees[i].role`).
- Coerce every NUMERIC value from pg with `Number(...)`.
- Always filter `WHERE source_deleted_at IS NULL` on `call_notes`.
- Always filter `WHERE is_system = false` on `reps` joins.
- Always filter `WHERE is_synthetic_test_data = false` on `ai_feedback` queries.
- The "call date" timestamp is `call_notes.call_started_at`, NOT `created_at`.

---

## Pre-Flight Checklist

Before Phase 0:

```bash
npm run build 2>&1 | tail -20
npx tsc --noEmit 2>&1 | tail -20
git status --short
```

Expected: build passes; typecheck passes; only the working-tree files listed in the session start status are modified.

If pre-flight fails: **STOP** — investigate before proceeding.

---

## Phase 0 — Install `pg` Dependency

**Why first:** every subsequent phase imports from `pg`.

### Steps

```bash
npm install pg
npm install --save-dev @types/pg
```

### Validation Gate

```bash
node -e "console.log(require('pg').Pool ? 'pg ok' : 'pg missing')"
node -e "console.log(require.resolve('@types/pg/package.json'))"
npx tsc --noEmit 2>&1 | tail -5
```

Expected: `pg ok`, the @types/pg path resolves, typecheck still clean.

### STOP AND REPORT

Paste the three commands' output.

---

## Phase 1 — Connection Helper & Cache Tag

**Goal:** scaffold infrastructure consumed by Phase 3.

### 1a) Create `src/lib/coachingDb.ts`

```typescript
// src/lib/coachingDb.ts
//
// Raw pg Pool against the sales-coaching Neon DB.
//
// FIRST raw pg helper in this codebase. The main app DB goes through Prisma
// (src/lib/prisma.ts). The sales-coaching DB is a SEPARATE Neon project, hence
// raw pg here. Read-only, analytics-only.
//
// CONSTRAINTS.md "all Postgres goes through Prisma" applies to the main DB,
// not this secondary DB. If you extend with another secondary DB later, add a
// sibling helper alongside this one rather than overloading it.

import { Pool } from 'pg';

const globalForCoaching = globalThis as unknown as {
  coachingPool: Pool | undefined;
};

function getCoachingUrl(): string {
  // Use UNPOOLED (direct) — Neon's pooler is PgBouncer (transaction mode), which
  // disables prepared statements. Raw pg uses prepared statements by default,
  // so the pooler URL would fail at runtime.
  const url =
    process.env.SALES_COACHING_DATABASE_URL_UNPOOLED ||
    process.env.SALES_COACHING_DATABASE_URL ||
    '';
  if (!url) {
    throw new Error(
      'SALES_COACHING_DATABASE_URL_UNPOOLED is required. ' +
      'See .env.example for the Sales-Coaching Neon DB section.'
    );
  }
  return url;
}

export function getCoachingPool(): Pool {
  if (globalForCoaching.coachingPool) return globalForCoaching.coachingPool;
  globalForCoaching.coachingPool = new Pool({
    connectionString: getCoachingUrl(),
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  return globalForCoaching.coachingPool;
}

export type AllowedRange = '7d' | '30d' | '90d' | 'all';
export const ALLOWED_RANGES: readonly AllowedRange[] = ['7d', '30d', '90d', 'all'];
export type AllowedSortField = 'call_date' | 'sga_name' | 'sgm_name';
export const ALLOWED_SORT_FIELDS: readonly AllowedSortField[] = ['call_date', 'sga_name', 'sgm_name'];
export type AllowedSortDir = 'asc' | 'desc';
export const ALLOWED_SORT_DIRS: readonly AllowedSortDir[] = ['asc', 'desc'];
```

### 1b) Add `COACHING_USAGE` to `CACHE_TAGS`

Edit `src/lib/cache.ts`. Inside the `CACHE_TAGS` object literal (lines 11-16), add:

```typescript
export const CACHE_TAGS = {
  DASHBOARD: 'dashboard',
  SGA_HUB: 'sga-hub',
  SGM_HUB: 'sgm-hub',
  BOT_USAGE: 'bot-usage',
  COACHING_USAGE: 'coaching-usage',
} as const;
```

### 1c) Wire `refresh-cache` route

Edit `src/app/api/admin/refresh-cache/route.ts`. The file calls `revalidateTag()` for each existing CACHE_TAGS entry and lists them in a response body array (lines 29-32 and 40-43). Add:

```typescript
revalidateTag(CACHE_TAGS.COACHING_USAGE);
```

…alongside the existing revalidateTag calls, and add `'coaching-usage'` to the tags array in the JSON response.

### Validation Gate

```bash
npx tsc --noEmit 2>&1 | tail -10
grep -n "COACHING_USAGE" src/lib/cache.ts
grep -n "COACHING_USAGE" src/app/api/admin/refresh-cache/route.ts
grep -n "globalForCoaching" src/lib/coachingDb.ts
grep -n "SALES_COACHING_DATABASE_URL_UNPOOLED" src/lib/coachingDb.ts
```

Expected: typecheck clean; all four greps find at least one match.

### STOP AND REPORT

Paste outputs.

---

## Phase 2 — Type Definitions

**Goal:** types are inlined in Phases 3 and 4. This phase exists as an explicit checkpoint to confirm the convention before code is written.

Re-read `pattern-finder-findings.md` Patterns 1 and 2 to confirm.

### Validation Gate

```bash
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

### STOP AND REPORT

Single-line confirmation.

---

## Phase 3 — API Route & Queries

**Goal:** create `src/app/api/admin/coaching-usage/route.ts` with auth gate, allowlist parsing, parameterized SQL, and cache wrap.

### 3a) File header

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getCoachingPool,
  ALLOWED_RANGES,
  ALLOWED_SORT_FIELDS,
  ALLOWED_SORT_DIRS,
  type AllowedRange,
  type AllowedSortField,
  type AllowedSortDir,
} from '@/lib/coachingDb';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

export const dynamic = 'force-dynamic';
const COACHING_TTL = 300; // 5 minutes per spec

interface KpiRow {
  active_coaching_users: string;     // census: is_active=true AND is_system=false (independent of range)
  active_users_in_range: string;     // distinct reps with >= 1 advisor-facing call in range
  total_advisor_facing_calls: string;
  pushed_to_sfdc: string;
  with_ai_feedback: string;
  with_manager_edit_eval: string;
  raw_granola: string;
  raw_kixie: string;
}
interface TrendRow {
  month: Date;
  advisor_facing_calls: string;
  pushed_to_sfdc: string;
  with_ai_feedback: string;
  with_manager_edit_eval: string;
  raw_note_volume: string;
}
interface DetailRow {
  call_note_id: string;
  call_date: Date;
  sga_name: string | null;
  sgm_name: string | null;
  source: 'granola' | 'kixie';
  pushed_to_sfdc: boolean;
  has_ai_feedback: boolean;
  has_manager_edit_eval: boolean;
}
```

### 3b) Helpers and lookup tables

```typescript
function getInsiderDomains(): string[] {
  return (process.env.COACHING_INSIDER_DOMAINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// Day-truncated cutoffs avoid the "calls disappearing mid-shift" effect of a
// millisecond-rolling now(). 'all' emits no lower-bound predicate at all
// (cleaner than '-infinity'::timestamptz).
const RANGE_WHERE: Record<AllowedRange, string> = {
  '7d':  "AND cn.call_started_at >= date_trunc('day', now()) - interval '7 days'",
  '30d': "AND cn.call_started_at >= date_trunc('day', now()) - interval '30 days'",
  '90d': "AND cn.call_started_at >= date_trunc('day', now()) - interval '90 days'",
  'all': '',
};
const SORT_COL: Record<AllowedSortField, string> = {
  call_date: 'cn.call_started_at',
  sga_name:  'sga.full_name',
  sgm_name:  'sgm.full_name',
};
const SORT_DIR: Record<AllowedSortDir, string> = {
  asc:  'ASC NULLS LAST',
  desc: 'DESC NULLS LAST',
};
```

These three maps are the **only** places where SQL fragments are embedded. Each value is a hardcoded constant — never user input. Keys are checked against the allowlist before lookup.

### 3c) Inner data function

```typescript
const _getCoachingUsageData = async (args: {
  range: AllowedRange;
  sortBy: AllowedSortField;
  sortDir: AllowedSortDir;
}) => {
  const { range, sortBy, sortDir } = args;
  const rangeWhere = RANGE_WHERE[range];
  const orderBy = `${SORT_COL[sortBy]} ${SORT_DIR[sortDir]}`;
  // COACHING_INSIDER_DOMAINS entries are stored as bare domains (e.g. 'acme.com');
  // matched against `LIKE '%@' || d` to anchor on the @ boundary and prevent
  // false positives like 'foo@notacme.com' against an entry of 'acme.com'.
  const insiderDomains = getInsiderDomains();
  const pool = getCoachingPool();

  const ADVISOR_FACING_CTE = `
    advisor_calls AS (
      SELECT cn.id, cn.source, cn.call_started_at, cn.rep_id
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        ${rangeWhere}
        AND (
          cn.source = 'kixie'
          OR (
            cn.source = 'granola'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(cn.attendees, '[]'::jsonb)) AS att
              WHERE att->>'email' IS NOT NULL
                AND att->>'email' <> ''
                AND LOWER(att->>'email') NOT LIKE '%@savvywealth.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.co'
                AND LOWER(att->>'email') NOT LIKE '%.calendar.google.com'
                AND NOT EXISTS (
                  SELECT 1 FROM unnest($1::text[]) AS d
                  WHERE LOWER(att->>'email') LIKE '%@' || d
                )
            )
          )
        )
    )
  `;

  const KPI_SQL = `
    WITH
    ${ADVISOR_FACING_CTE},
    sfdc_pushed AS (
      SELECT DISTINCT swl.call_note_id
      FROM sfdc_write_log swl
      JOIN advisor_calls ac ON ac.id = swl.call_note_id
      WHERE swl.status = 'success'
    ),
    ai_flagged AS (
      SELECT DISTINCT e.call_note_id
      FROM ai_feedback af
      JOIN evaluations e ON e.id = af.evaluation_id
      JOIN advisor_calls ac ON ac.id = e.call_note_id
      WHERE af.status = 'approved'
        AND af.is_synthetic_test_data = false
    ),
    mgr_edited AS (
      -- Counts BOTH the direct-text-editor flow (slack_dm_edit_eval_text) AND the
      -- multi-claim modal flow (slack_dm_edit_eval). Excludes slack_dm_single_claim
      -- (which is the AI-Feedback flag flow — covered by metric #4 instead).
      SELECT DISTINCT e.call_note_id
      FROM evaluation_edit_audit_log eal
      JOIN evaluations e ON e.id = eal.evaluation_id
      JOIN advisor_calls ac ON ac.id = e.call_note_id
      WHERE eal.edit_source IN ('slack_dm_edit_eval_text', 'slack_dm_edit_eval')
    ),
    raw_volume AS (
      SELECT
        COALESCE(SUM(CASE WHEN cn.source = 'granola' THEN 1 ELSE 0 END), 0) AS raw_granola,
        COALESCE(SUM(CASE WHEN cn.source = 'kixie'   THEN 1 ELSE 0 END), 0) AS raw_kixie
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        ${rangeWhere}
    )
    SELECT
      (SELECT count(*) FROM reps WHERE is_active = true AND is_system = false)::text AS active_coaching_users,
      (SELECT count(DISTINCT rep_id) FROM advisor_calls)::text                       AS active_users_in_range,
      (SELECT count(*) FROM advisor_calls)::text                                     AS total_advisor_facing_calls,
      (SELECT count(*) FROM sfdc_pushed)::text                                       AS pushed_to_sfdc,
      (SELECT count(*) FROM ai_flagged)::text                                        AS with_ai_feedback,
      (SELECT count(*) FROM mgr_edited)::text                                        AS with_manager_edit_eval,
      (SELECT raw_granola FROM raw_volume)::text                                     AS raw_granola,
      (SELECT raw_kixie FROM raw_volume)::text                                       AS raw_kixie
  `;

  const TREND_SQL = `
    WITH
    months AS (
      SELECT generate_series(
        date_trunc('month', now()) - interval '5 months',
        date_trunc('month', now()),
        interval '1 month'
      ) AS month
    ),
    advisor_calls_all AS (
      SELECT cn.id, cn.source, cn.call_started_at
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        AND cn.call_started_at >= date_trunc('month', now()) - interval '5 months'
        AND (
          cn.source = 'kixie'
          OR (
            cn.source = 'granola'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(cn.attendees, '[]'::jsonb)) AS att
              WHERE att->>'email' IS NOT NULL
                AND att->>'email' <> ''
                AND LOWER(att->>'email') NOT LIKE '%@savvywealth.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.co'
                AND LOWER(att->>'email') NOT LIKE '%.calendar.google.com'
                AND NOT EXISTS (
                  SELECT 1 FROM unnest($1::text[]) AS d
                  WHERE LOWER(att->>'email') LIKE '%@' || d
                )
            )
          )
        )
    ),
    raw_volume_monthly AS (
      SELECT date_trunc('month', cn.call_started_at) AS m, count(*) AS n
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        AND cn.call_started_at >= date_trunc('month', now()) - interval '5 months'
      GROUP BY 1
    )
    SELECT
      m.month,
      (SELECT count(*) FROM advisor_calls_all ac
        WHERE date_trunc('month', ac.call_started_at) = m.month)::text AS advisor_facing_calls,
      (SELECT count(DISTINCT swl.call_note_id) FROM sfdc_write_log swl
        JOIN advisor_calls_all ac ON ac.id = swl.call_note_id
        WHERE swl.status = 'success' AND date_trunc('month', ac.call_started_at) = m.month)::text AS pushed_to_sfdc,
      (SELECT count(DISTINCT e.call_note_id) FROM ai_feedback af
        JOIN evaluations e ON e.id = af.evaluation_id
        JOIN advisor_calls_all ac ON ac.id = e.call_note_id
        WHERE af.status = 'approved' AND af.is_synthetic_test_data = false
          AND date_trunc('month', ac.call_started_at) = m.month)::text AS with_ai_feedback,
      (SELECT count(DISTINCT e.call_note_id) FROM evaluation_edit_audit_log eal
        JOIN evaluations e ON e.id = eal.evaluation_id
        JOIN advisor_calls_all ac ON ac.id = e.call_note_id
        WHERE eal.edit_source IN ('slack_dm_edit_eval_text', 'slack_dm_edit_eval')
          AND date_trunc('month', ac.call_started_at) = m.month)::text AS with_manager_edit_eval,
      COALESCE((SELECT n FROM raw_volume_monthly rv WHERE rv.m = m.month), 0)::text AS raw_note_volume
    FROM months m
    ORDER BY m.month ASC
  `;

  const DETAIL_SQL = `
    WITH ${ADVISOR_FACING_CTE}
    SELECT
      cn.id AS call_note_id,
      cn.call_started_at AS call_date,
      sga.full_name AS sga_name,
      sgm.full_name AS sgm_name,
      cn.source AS source,
      EXISTS (SELECT 1 FROM sfdc_write_log swl WHERE swl.call_note_id = cn.id AND swl.status = 'success') AS pushed_to_sfdc,
      EXISTS (
        SELECT 1 FROM ai_feedback af
        JOIN evaluations e ON e.id = af.evaluation_id
        WHERE e.call_note_id = cn.id AND af.status = 'approved' AND af.is_synthetic_test_data = false
      ) AS has_ai_feedback,
      EXISTS (
        SELECT 1 FROM evaluation_edit_audit_log eal
        JOIN evaluations e ON e.id = eal.evaluation_id
        WHERE e.call_note_id = cn.id
          AND eal.edit_source IN ('slack_dm_edit_eval_text', 'slack_dm_edit_eval')
      ) AS has_manager_edit_eval
    FROM call_notes cn
    JOIN advisor_calls ac ON ac.id = cn.id
    -- LEFT JOIN deliberately omits is_active filter: per Russell's Q2 answer,
    -- we always show SGA/SGM names in the drill-down even if the rep has left
    -- the company. Only the System Admin placeholder is suppressed.
    -- SGM may be NULL when the SGA's manager isn't an SGM (e.g., role='manager'
    -- or 'admin') or when the SGA has no manager_id set — render as "—".
    LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
    LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
    ORDER BY ${orderBy}
    LIMIT 500
  `;

  const params = [insiderDomains];
  const [kpiResult, trendResult, detailResult] = await Promise.all([
    pool.query<KpiRow>(KPI_SQL, params),
    pool.query<TrendRow>(TREND_SQL, params),
    pool.query<DetailRow>(DETAIL_SQL, params),
  ]);

  const k = kpiResult.rows[0] ?? {} as KpiRow;
  const totalAdvisorFacingCalls = Number(k.total_advisor_facing_calls) || 0;
  const safeRatio = (n: number) =>
    totalAdvisorFacingCalls === 0 ? 0 : n / totalAdvisorFacingCalls;

  return {
    kpis: {
      activeCoachingUsers:    Number(k.active_coaching_users) || 0,
      activeUsersInRange:     Number(k.active_users_in_range) || 0,
      totalAdvisorFacingCalls,
      pctPushedToSfdc:        safeRatio(Number(k.pushed_to_sfdc) || 0),
      pctWithAiFeedback:      safeRatio(Number(k.with_ai_feedback) || 0),
      pctWithManagerEditEval: safeRatio(Number(k.with_manager_edit_eval) || 0),
      rawNoteVolume: {
        granola: Number(k.raw_granola) || 0,
        kixie:   Number(k.raw_kixie)   || 0,
        total:  (Number(k.raw_granola) || 0) + (Number(k.raw_kixie) || 0),
      },
    },
    trend: trendResult.rows.map(r => {
      const calls = Number(r.advisor_facing_calls) || 0;
      const ratio = (n: number) => calls === 0 ? 0 : n / calls;
      return {
        month: r.month.toISOString().slice(0, 10),
        advisorFacingCalls:     calls,
        pctPushedToSfdc:        ratio(Number(r.pushed_to_sfdc) || 0),
        pctWithAiFeedback:      ratio(Number(r.with_ai_feedback) || 0),
        pctWithManagerEditEval: ratio(Number(r.with_manager_edit_eval) || 0),
        rawNoteVolume:          Number(r.raw_note_volume) || 0,
      };
    }),
    drillDown: detailResult.rows.map(r => ({
      callNoteId: r.call_note_id,
      callDate: r.call_date instanceof Date ? r.call_date.toISOString() : String(r.call_date),
      sgaName: r.sga_name,
      sgmName: r.sgm_name,
      source: r.source,
      pushedToSfdc: r.pushed_to_sfdc,
      hasAiFeedback: r.has_ai_feedback,
      hasManagerEditEval: r.has_manager_edit_eval,
    })),
    range,
    sortBy,
    sortDir,
    generated_at: new Date().toISOString(),
  };
};

const getCoachingUsageData = cachedQuery(
  _getCoachingUsageData,
  'getCoachingUsageData',
  CACHE_TAGS.COACHING_USAGE,
  COACHING_TTL,
);
```

### 3d) GET handler

```typescript
export async function GET(request: NextRequest) {
  try {
    // Auth gate (verbatim copy from /api/admin/bot-usage/route.ts lines 265-279)
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawRange = searchParams.get('range') ?? '30d';
    const range: AllowedRange = (ALLOWED_RANGES as readonly string[]).includes(rawRange)
      ? (rawRange as AllowedRange) : '30d';

    const rawSort = searchParams.get('sortBy') ?? 'call_date';
    const sortBy: AllowedSortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(rawSort)
      ? (rawSort as AllowedSortField) : 'call_date';

    const rawDir = searchParams.get('sortDir') ?? 'desc';
    const sortDir: AllowedSortDir = (ALLOWED_SORT_DIRS as readonly string[]).includes(rawDir)
      ? (rawDir as AllowedSortDir) : 'desc';

    const data = await getCoachingUsageData({ range, sortBy, sortDir });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error fetching coaching usage:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch coaching usage' },
      { status: 500 }
    );
  }
}
```

### Validation Gate

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run lint 2>&1 | tail -20

grep -n "permissions.role !== 'revops_admin'" src/app/api/admin/coaching-usage/route.ts
grep -n 'unnest($1::text\[\])' src/app/api/admin/coaching-usage/route.ts
grep -n "slack_dm_edit_eval_text" src/app/api/admin/coaching-usage/route.ts
grep -n "slack_dm_edit_eval'" src/app/api/admin/coaching-usage/route.ts
grep -n "active_users_in_range" src/app/api/admin/coaching-usage/route.ts
grep -n "is_synthetic_test_data = false" src/app/api/admin/coaching-usage/route.ts
grep -n "is_system = false" src/app/api/admin/coaching-usage/route.ts
grep -n "call_started_at" src/app/api/admin/coaching-usage/route.ts
grep -n "date_trunc('day', now())" src/app/api/admin/coaching-usage/route.ts
grep -n "att->>'email' <> ''" src/app/api/admin/coaching-usage/route.ts
grep -n "LIKE '%@' || d" src/app/api/admin/coaching-usage/route.ts
grep -n "COALESCE(SUM" src/app/api/admin/coaching-usage/route.ts
```

Expected: typecheck + lint clean; every grep finds at least one match.

### STOP AND REPORT

Paste outputs.

---

## Phase 4 — Client Component

**Goal:** create `src/app/dashboard/explore/CoachingUsageClient.tsx`.

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Card, Title, Text, Metric } from '@tremor/react';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type AllowedRange = '7d' | '30d' | '90d' | 'all';
type AllowedSortField = 'call_date' | 'sga_name' | 'sgm_name';
type AllowedSortDir = 'asc' | 'desc';

interface CoachingUsageKpis {
  activeCoachingUsers: number;       // census, all-time, ignores date range
  activeUsersInRange: number;        // distinct reps with >= 1 call in selected range
  totalAdvisorFacingCalls: number;
  pctPushedToSfdc: number;
  pctWithAiFeedback: number;
  pctWithManagerEditEval: number;
  rawNoteVolume: { granola: number; kixie: number; total: number };
}
interface CoachingUsageTrendRow {
  month: string;
  advisorFacingCalls: number;
  pctPushedToSfdc: number;
  pctWithAiFeedback: number;
  pctWithManagerEditEval: number;
  rawNoteVolume: number;
}
interface CoachingUsageDetailRow {
  callNoteId: string;
  callDate: string;
  sgaName: string | null;
  sgmName: string | null;
  source: 'granola' | 'kixie';
  pushedToSfdc: boolean;
  hasAiFeedback: boolean;
  hasManagerEditEval: boolean;
}
interface CoachingUsageResponse {
  kpis: CoachingUsageKpis;
  trend: CoachingUsageTrendRow[];
  drillDown: CoachingUsageDetailRow[];
  range: AllowedRange;
  sortBy: AllowedSortField;
  sortDir: AllowedSortDir;
  generated_at: string;
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}
function formatMonthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
const RANGE_LABELS: Record<AllowedRange, string> = {
  '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', 'all': 'All time',
};

export function CoachingUsageClient() {
  const [range, setRange] = useState<AllowedRange>('30d');
  const [sortBy, setSortBy] = useState<AllowedSortField>('call_date');
  const [sortDir, setSortDir] = useState<AllowedSortDir>('desc');
  const [data, setData] = useState<CoachingUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams({ range, sortBy, sortDir });
        const res = await fetch(`/api/admin/coaching-usage?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as CoachingUsageResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [range, sortBy, sortDir, cacheBuster]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/admin/refresh-cache', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Refresh failed (${res.status})`);
      }
      setCacheBuster(n => n + 1);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to refresh cache');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !data) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <LoadingSpinner />
        <Text className="text-center text-gray-500 dark:text-gray-400 pb-4">Loading coaching usage…</Text>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as AllowedRange)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                     focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {fetchError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {fetchError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active coaching users</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.activeCoachingUsers ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Census · all-time</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active users in range</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.activeUsersInRange ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Reps with ≥1 call · {RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Advisor-facing calls</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.totalAdvisorFacingCalls ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% pushed to SFDC</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(data?.kpis.pctPushedToSfdc ?? 0)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% with AI Feedback</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(data?.kpis.pctWithAiFeedback ?? 0)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% with manager Edit Eval</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(data?.kpis.pctWithManagerEditEval ?? 0)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Raw note volume</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.rawNoteVolume.total ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {loading ? '—' : `${data?.kpis.rawNoteVolume.granola ?? 0} Granola · ${data?.kpis.rawNoteVolume.kixie ?? 0} Kixie`}
          </Text>
        </Card>
      </div>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Title className="dark:text-white">Monthly trend (rolling 6 months)</Title>
        <Text className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
          Always shows the last 6 calendar months — independent of the date-range selector above.
        </Text>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-600 dark:text-gray-300">
                <th className="py-2 px-2">Month</th>
                <th className="py-2 px-2">Advisor calls</th>
                <th className="py-2 px-2">% SFDC</th>
                <th className="py-2 px-2">% AI FB</th>
                <th className="py-2 px-2">% Edit Eval</th>
                <th className="py-2 px-2">Raw notes</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trend ?? []).map(row => (
                <tr key={row.month} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-2 dark:text-gray-200">{formatMonthLabel(row.month)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.advisorFacingCalls}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{formatPct(row.pctPushedToSfdc)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{formatPct(row.pctWithAiFeedback)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{formatPct(row.pctWithManagerEditEval)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.rawNoteVolume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Title className="dark:text-white">Call drill-down</Title>
          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split(':') as [AllowedSortField, AllowedSortDir];
              setSortBy(f); setSortDir(d);
            }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="call_date:desc">Call date (newest first)</option>
            <option value="call_date:asc">Call date (oldest first)</option>
            <option value="sga_name:asc">SGA name (A–Z)</option>
            <option value="sga_name:desc">SGA name (Z–A)</option>
            <option value="sgm_name:asc">SGM name (A–Z)</option>
            <option value="sgm_name:desc">SGM name (Z–A)</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-600 dark:text-gray-300">
                <th className="py-2 px-2">Call date</th>
                <th className="py-2 px-2">SGA</th>
                <th className="py-2 px-2">SGM</th>
                <th className="py-2 px-2">Source</th>
                <th className="py-2 px-2">SFDC</th>
                <th className="py-2 px-2">AI FB</th>
                <th className="py-2 px-2">Edit Eval</th>
              </tr>
            </thead>
            <tbody>
              {(data?.drillDown ?? []).map(row => (
                <tr key={row.callNoteId} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-2 dark:text-gray-200">{formatTimestamp(row.callDate)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.sgaName ?? '—'}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.sgmName ?? '—'}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.source}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.pushedToSfdc ? '✓' : '—'}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.hasAiFeedback ? '✓' : '—'}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.hasManagerEditEval ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.drillDown.length === 0 && (
            <Text className="text-center text-gray-500 dark:text-gray-400 py-6">
              No advisor-facing calls in this range.
            </Text>
          )}
        </div>
      </Card>

      {data?.generated_at && (
        <Text className="text-xs text-gray-500 dark:text-gray-400 text-right">
          Cached at {formatTimestamp(data.generated_at)}
        </Text>
      )}
    </div>
  );
}
```

### Validation Gate

```bash
npx tsc --noEmit 2>&1 | tail -10
npm run lint 2>&1 | tail -20
grep -n "export function CoachingUsageClient" src/app/dashboard/explore/CoachingUsageClient.tsx
grep -nE 'value="call_date:(desc|asc)"' src/app/dashboard/explore/CoachingUsageClient.tsx
grep -nE 'value="(sga|sgm)_name:(asc|desc)"' src/app/dashboard/explore/CoachingUsageClient.tsx
```

Expected: typecheck + lint clean; named export confirmed; all 6 sort options present.

### STOP AND REPORT

Paste outputs.

---

## Phase 5 — Tab Integration

**Goal:** wire the new tab into `ExploreClient.tsx`.

### Steps

Edit `src/app/dashboard/explore/ExploreClient.tsx`:

1. **Imports — merge into existing import block:**
   - Add `PhoneCall` to the existing `lucide-react` import. Do NOT add a second `from 'lucide-react'` line.
   - Add `import { CoachingUsageClient } from './CoachingUsageClient';` near other client imports.

2. **Tab type (line 16):**
   ```typescript
   type ExploreTab = 'ask' | 'bot-usage' | 'coaching-usage';
   ```

3. **Tab nav button — insert after the bot-usage button at ~line 232:**
   ```tsx
   <button
     type="button"
     onClick={() => setActiveTab('coaching-usage')}
     className={`flex items-center gap-2 py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
       activeTab === 'coaching-usage'
         ? 'border-blue-500 text-blue-600 dark:text-blue-400'
         : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
     }`}
   >
     <PhoneCall className="w-4 h-4" />
     Coaching Usage
   </button>
   ```

4. **Conditional render — insert after the bot-usage render at ~line 238:**
   ```tsx
   {isRevopsAdmin && activeTab === 'coaching-usage' && <CoachingUsageClient />}
   ```

The Ask-tab condition at line 241 needs no change.

### Validation Gate

```bash
npm run build 2>&1 | tail -30
npx tsc --noEmit 2>&1 | tail -5
grep -n "CoachingUsageClient" src/app/dashboard/explore/ExploreClient.tsx
grep -n "'coaching-usage'" src/app/dashboard/explore/ExploreClient.tsx
grep -c "from 'lucide-react'" src/app/dashboard/explore/ExploreClient.tsx
```

Expected: build clean; typecheck clean; CoachingUsageClient and 'coaching-usage' both referenced; the `lucide-react` import count is **exactly 1**.

### STOP AND REPORT

Paste outputs. Confirm `lucide-react` import count = 1.

---

## Phase 6 — help.md and .env.example

### 6a) Append to `src/app/dashboard/explore/help.md`

```markdown
## Coaching Usage

The Coaching Usage tab is visible to RevOps Admins only. It surfaces six rollup
metrics from the sales-coaching pipeline (a separate Neon DB) over a selectable
date range (7 days, 30 days, 90 days, or All time).

### Metric definitions

1. **Active coaching users** (census) — `reps` rows where `is_active = true AND is_system = false`.
   Independent of the date-range selector. Answers "how many seats are provisioned today?"
2. **Active users in range** (period usage) — distinct `reps` with at least one
   advisor-facing call within the selected date range. Answers "how many reps actually
   used the system in this period?" The two together let you see provisioned-vs-engaged
   without conflating them.
3. **Total advisor-facing calls** — `call_notes` in range, excluding tombstoned rows
   and Granola calls with no external attendees. Kixie calls are advisor-facing
   by upstream filter.
4. **% pushed to SFDC** — share of in-range advisor-facing calls with at least one
   `sfdc_write_log` row at `status = 'success'`.
5. **% with AI Feedback** — share of in-range advisor-facing calls whose evaluation
   has at least one `ai_feedback` row at `status = 'approved'` and
   `is_synthetic_test_data = false`.
6. **% with manager Edit Evaluation** — share of in-range advisor-facing calls whose
   evaluation has at least one `evaluation_edit_audit_log` row with `edit_source` in
   (`slack_dm_edit_eval_text`, `slack_dm_edit_eval`). The first is the single-claim
   direct-text editor; the second is the multi-claim modal flow. Both count as a
   manager edit. `slack_dm_single_claim` (the AI-Feedback flag flow) is excluded —
   it's covered by metric #5 (% with AI Feedback) instead.
7. **Raw note volume** — total `call_notes` in range broken out by source
   ('granola' / 'kixie'), with no advisor-facing filter applied.

### Date column

The date for both range filtering and the call-date sort is `call_started_at`
(actual call time), not `created_at` (row insertion time).

### Insider-domain mirror

The advisor-facing CTE excludes attendees on `@savvywealth.com`,
`@savvyadvisors.com`, `@savvyadvisors.co`, and `*.calendar.google.com`. Per-firm
joined-advisor domains are appended via the `COACHING_INSIDER_DOMAINS` env var
(comma-separated) so the Dashboard and the sales-coaching repo can stay in
lockstep without coupling their `.env` files.
```

### 6b) Append to `.env.example`

After the existing `SALES_COACHING_*` block (after line 121):

```
# Optional: per-firm joined-advisor domains, comma-separated.
# Used to mirror sales-coaching's JOINED_ADVISOR_DOMAINS for the Coaching Usage tab.
# Enter BARE domains without a leading "@" (e.g. "acme.com,foo.com" — NOT "@acme.com").
# Matched in SQL with LIKE '%@' || domain to anchor on the @ boundary.
COACHING_INSIDER_DOMAINS=
```

### Validation Gate

```bash
grep -n "## Coaching Usage" src/app/dashboard/explore/help.md
grep -n "COACHING_INSIDER_DOMAINS" .env.example
```

Expected: both grep targets find a match.

### STOP AND REPORT

Paste outputs.

---

## Phase 7 — Tests

**Goal:** create `src/app/api/admin/coaching-usage/__tests__/route.test.ts`.

```typescript
const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock('@/lib/coachingDb', () => ({
  getCoachingPool: () => ({ query: mockQuery }),
  ALLOWED_RANGES: ['7d', '30d', '90d', 'all'],
  ALLOWED_SORT_FIELDS: ['call_date', 'sga_name', 'sgm_name'],
  ALLOWED_SORT_DIRS: ['asc', 'desc'],
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

const mockGetSessionPermissions = jest.fn();
jest.mock('@/types/auth', () => ({
  getSessionPermissions: (...args: unknown[]) => mockGetSessionPermissions(...args),
}));
jest.mock('@/lib/cache', () => ({
  cachedQuery: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
  CACHE_TAGS: { COACHING_USAGE: 'coaching-usage' },
}));

import { GET } from '../route';
import { getServerSession } from 'next-auth';

function makeReq(qs = ''): Request {
  return new Request(`http://localhost/api/admin/coaching-usage${qs ? '?' + qs : ''}`);
}

describe('GET /api/admin/coaching-usage', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue({
      rows: [{
        active_coaching_users: '0', active_users_in_range: '0',
        total_advisor_facing_calls: '0',
        pushed_to_sfdc: '0', with_ai_feedback: '0', with_manager_edit_eval: '0',
        raw_granola: '0', raw_kixie: '0',
      }],
      rowCount: 1,
    });
    mockGetSessionPermissions.mockReset();
  });

  it('returns 401 when no session', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not revops_admin', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'admin' });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('200 when role is revops_admin', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq('range=30d&sortBy=call_date&sortDir=desc') as never);
    expect(res.status).toBe(200);
  });

  it('clamps invalid range to 30d', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq('range=evil') as never);
    expect(res.status).toBe(200);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("interval '30 days'");
  });

  it('clamps invalid sortBy to call_date', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq('sortBy=DROP TABLE') as never);
    expect(res.status).toBe(200);
    const detailSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('LIMIT 500')) ?? '';
    expect(detailSql).toContain('cn.call_started_at');
    expect(detailSql).not.toContain('DROP TABLE');
  });

  it('passes insider domains as text[] param, not concatenated', async () => {
    process.env.COACHING_INSIDER_DOMAINS = 'foo.com,bar.com';
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    for (const call of mockQuery.mock.calls) {
      const params = call[1] as unknown[];
      expect(Array.isArray(params)).toBe(true);
      expect(Array.isArray(params[0])).toBe(true);
      expect(params[0]).toEqual(['foo.com', 'bar.com']);
    }
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toMatch(/unnest\(\$1::text\[\]\)/);
    expect(allCalls).not.toContain('foo.com');
    expect(allCalls).not.toContain('bar.com');
    delete process.env.COACHING_INSIDER_DOMAINS;
  });

  it('counts both slack_dm_edit_eval_text AND slack_dm_edit_eval; never _single_claim', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("'slack_dm_edit_eval_text'");
    expect(allCalls).toContain("'slack_dm_edit_eval'");      // multi-claim flow ALSO counts
    expect(allCalls).not.toContain("'slack_dm_single_claim'"); // AI-Feedback flag flow — covered by metric #4 instead
  });

  it('exposes both census and period-usage active-user counts', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { kpis: { activeCoachingUsers: number; activeUsersInRange: number } };
    expect(typeof body.kpis.activeCoachingUsers).toBe('number');
    expect(typeof body.kpis.activeUsersInRange).toBe('number');
    // KPI SQL produces both columns
    const kpiSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('active_coaching_users')) ?? '';
    expect(kpiSql).toContain('active_users_in_range');
  });

  it('uses call_started_at, not created_at, for date filtering', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain('cn.call_started_at >=');
  });

  it("range='all' omits the lower-bound predicate entirely", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq('range=all') as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    // No 'interval ... days' should appear from the RANGE_WHERE map for 'all'
    expect(allCalls).not.toMatch(/interval '\d+ days'/);
    expect(allCalls).not.toContain("'-infinity'");
  });

  it('uses date_trunc-day cutoffs (calendar-day, not millisecond-rolling)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq('range=30d') as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("date_trunc('day', now())");
  });

  it("anchors insider-domain match on '@' boundary", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toMatch(/LIKE '%@' \|\| d/);
  });

  it("excludes empty-string emails from advisor-facing filter", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("att->>'email' <> ''");
  });

  it('handles empty insider-domain env (no false matches, no SQL errors)', async () => {
    delete process.env.COACHING_INSIDER_DOMAINS;
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    // domain-list param is still passed as text[] (empty array), never concatenated
    for (const call of mockQuery.mock.calls) {
      const params = call[1] as unknown[];
      expect(Array.isArray(params)).toBe(true);
      expect(Array.isArray(params[0])).toBe(true);
      expect(params[0]).toEqual([]);
    }
  });

  it('does not crash when SGA/SGM rows are NULL (LEFT JOIN system rep)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    // Detail query returns a row with null sga_name/sgm_name
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'abc', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: null, sgm_name: null, source: 'granola',
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return Promise.resolve({
        rows: [{
          active_coaching_users: '0', active_users_in_range: '0',
          total_advisor_facing_calls: '0',
          pushed_to_sfdc: '0', with_ai_feedback: '0', with_manager_edit_eval: '0',
          raw_granola: '0', raw_kixie: '0',
        }],
        rowCount: 1,
      });
    });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { drillDown: Array<{ sgaName: string|null; sgmName: string|null }> };
    expect(body.drillDown[0].sgaName).toBeNull();
    expect(body.drillDown[0].sgmName).toBeNull();
  });
});
```

### Validation Gate

```bash
npm test -- --testPathPattern=coaching-usage 2>&1 | tail -40
```

Expected: all tests pass.

### STOP AND REPORT

Paste outputs.

---

## Phase 7.5 — Documentation Sync

```bash
npx agent-guard sync 2>&1 | tail -20
git status --short docs/
```

Stage any updated `docs/_generated/` files alongside the rest of the changes.

### STOP AND REPORT

Paste outputs.

---

## Phase 8 — Manual UI Smoke (Human-Required)

Russell's checklist:

1. Copy `DATABASE_URL_UNPOOLED` from `C:\Users\russe\Documents\sales-coaching\.env` into `.env.local` under the name `SALES_COACHING_DATABASE_URL_UNPOOLED`.
2. (Optional) set `COACHING_INSIDER_DOMAINS` if any joined-advisor firms exist.
3. `npm run dev`.
4. Log in as a revops_admin user.
5. Navigate to `/dashboard/explore`.
6. Confirm three tabs: Ask, Bot Usage, **Coaching Usage**.
7. Click **Coaching Usage** → 7 KPI cards render. Expected ballparks (all-time):
   - Active coaching users (census) ≈ 26
   - Active users in range ≈ 5–10 (varies by range; smaller than census)
   - Total advisor-facing calls ≈ 230
   - SFDC pushes ≈ 29 / 230
   - AI feedback ≈ 2 / 230
   - Manager edit-eval ≈ low single digits / 230 (now includes multi-claim flow too)
   - Raw note volume ≈ 230 (Granola + Kixie)
8. Toggle range 7d / 30d / 90d / all → numbers update.
9. Sort dropdown: each of the 6 options re-orders the drill-down.
10. Trend table shows last 6 months with sane numbers.
11. DevTools → Network → response is JSON; **no `SALES_COACHING_DATABASE_URL_UNPOOLED` literal** in the payload.
12. Log in as a non-admin → Coaching Usage tab is **hidden**; direct GET to `/api/admin/coaching-usage` returns **403**.

If any step fails, file an issue with screenshot + Network panel response.

---

## Refinement Log

### Bucket 1 — Applied autonomously (council feedback resolved)

| Change | Source | Where applied |
|---|---|---|
| `RANGE_SQL` → `RANGE_WHERE` shape; `'all'` emits empty string (no lower-bound predicate); 7d/30d/90d use `date_trunc('day', now()) - interval 'N days'` instead of millisecond-rolling `now() - interval`. | Codex S4 / Q1 + Gemini C4 (rolling timezone boundaries) | Phase 3, RANGE_WHERE map; CTE `${rangeWhere}` insertions; raw_volume CTE; new test cases for `range='all'` and `date_trunc('day', now())`. |
| `att->>'email' <> ''` added to advisor-facing email filter (excludes integrations that pass empty strings). | Gemini Suggestion #2 | Phase 3, ADVISOR_FACING_CTE + trend table CTE; new test case. |
| Insider-domain match anchored on `@` boundary: `LIKE '%@' \|\| d` (was `LIKE '%' \|\| d`). Prevents `notacme.com` matching against `acme.com` entry. | Codex Q5 / Gemini Suggestion #2 | Phase 3, both CTEs; Phase 6 .env.example comment updated to require BARE domains; new test case. |
| `COALESCE(SUM(...), 0)` on `raw_granola` / `raw_kixie` — explicit zero default rather than relying on JS coercion of NULL. | Codex C4 (raw_volume nullable aggregates) | Phase 3, raw_volume CTE; new grep added to validation gate. |
| Trend table title: "Monthly trend (rolling 6 months)" + sub-text "Always shows the last 6 calendar months — independent of the date-range selector above." | Gemini S2 (trend vs KPI disconnect) | Phase 4, client component. |
| Test suite extended: empty-domain env var, `range='all'` shape, day-truncated cutoffs, `@`-anchored domain match, empty-email filter, NULL `sga_name`/`sgm_name` row mapping. | Codex Suggested Improvements (null-name tests) + my cross-checks | Phase 7, route.test.ts. |
| Validation gate in Phase 3 extended to grep for `date_trunc('day', now())`, `att->>'email' <> ''`, `LIKE '%@' \|\| d`, `COALESCE(SUM`. | Self | Phase 3 STOP AND REPORT. |

### Decisions auto-applied (Codex Q2, Q3 — recommended defaults)

| Decision | Rationale |
|---|---|
| **NULL `sga_name`/`sgm_name` returned as `null`** in API; client renders "—". | Cleanest contract; mirrors the ‑‑ convention BotUsageClient uses elsewhere. |
| **`'all'` SQL branch omits the lower-bound predicate** (no `'-infinity'::timestamptz`). | Codex Q3 — cleaner planner-wise and easier to read. |
| **Page-level server gate skipped** (existing API 403 + tab visibility is the trust boundary). | Codex Q1 — API enforcement is sufficient for data security; tab gate is the UX layer. |
| **Cache key remains object-arg-shaped** (single caller is stable). | Codex Q4 — flagged to backlog if more callers added later. |

### Bucket 3 — Noted but deferred

- Connection pool size remains `max: 5` (correct for production; dev experience is acceptable). [Codex S7]
- Drill-down planner perf at 50K rows — defer until row count justifies an index. [Gemini S8]
- LOWER(att->>'email') expression-index defeat — performance only, irrelevant at 230 rows. [Codex S6]
- Tooltip showing raw fraction (e.g., "1 / 230 calls") on % cards — UX polish, defer. [Gemini Suggestion #4]
- Cache-key canonicalization helper — single caller is stable; revisit if more callers emerge. [Codex S5]
- Move divide-by-zero math into SQL via `NULLIF` — defensive; current client-side `safeRatio` correctly handles div/0 and keeps raw counts available for future drill-downs. [Gemini S3]

### Bucket 2 — Resolved by Russell (2026-05-04)

| Q | Russell's answer | Applied at |
|---|---|---|
| Q1 (Active coaching users semantic) | **Two cards: Census + Period.** Added a `activeUsersInRange` KPI alongside the census card. Grid now `lg:grid-cols-4`. SQL adds `(SELECT count(DISTINCT rep_id) FROM advisor_calls)::text AS active_users_in_range`. | Phase 3 KpiRow + KPI_SQL + mapper; Phase 4 client interface + new card; Phase 6 help.md. |
| Q2 (SGM-name historical accuracy) | **Keep live `reps.manager_id`.** Always show all SGAs and SGMs in drill-down regardless of `is_active` (only suppress System Admin). NULL SGM is expected and OK because not all SGMs manage SGAs (some SGAs have no manager, or have a `role='manager'` admin manager rather than an SGM). Client renders NULL as "—". | Phase 3 DETAIL_SQL — added comment explaining the deliberate omission of `is_active` filter and the NULL semantic; no code change needed (already correct). |
| Q3 (Refresh button scope) | **Keep shared.** No code change. | n/a |
| Q4 (Metric 5 enum scope) | **Include both `slack_dm_edit_eval_text` AND `slack_dm_edit_eval`.** Excludes `slack_dm_single_claim` (which stays in metric #4). | Phase 3 mgr_edited CTE, TREND_SQL with_manager_edit_eval, DETAIL_SQL has_manager_edit_eval; Phase 7 test updated; Phase 6 help.md updated. |
