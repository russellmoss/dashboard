# Dashboard ↔ Sales-Coaching Integration: This-Repo Context

> Audience: a Claude instance working in the **sales-coaching** repo (`C:\Users\russe\Documents\sales-coaching`) designing how its data/UI should be exposed inside the **Dashboard** repo as a new `/dashboard/call-intelligence` top-level page.
>
> This file describes only the **current state of the Dashboard repo** (`C:\Users\russe\Documents\Dashboard`) — file paths, code snippets, schema shapes. It does NOT prescribe an integration design.
>
> **Stack:** Next.js 14 App Router, TypeScript, Tailwind + Tremor, Prisma → Neon Postgres, BigQuery, NextAuth (JWT), deployed on Vercel. Node 22 only. Production: `https://dashboard-eta-lime-45.vercel.app` (see `src/lib/auth.ts:36`).

---

## 1. Auth model

### NextAuth config — `src/lib/auth.ts`

Two providers: **Google OAuth** (gated to `@savvywealth.com`) and **Credentials** (email + bcrypt password). JWT strategy, 24h expiry. Source-of-truth `User` row lives in Prisma/Neon.

```ts
// src/lib/auth.ts:40-244 (excerpt)
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({ clientId, clientSecret, authorization: { params: { hd: 'savvywealth.com' } } }),
    CredentialsProvider({ /* validateUser → bcrypt compare against users.passwordHash */ }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Google: must end with @savvywealth.com AND exist in dashboard User table AND isActive=true
      // Stores looked-up dbUser on (user as any)._dbUser to skip a DB hop in jwt callback
    },
    async jwt({ token, user }) {
      // On sign-in: token.id, token.email, token.name, token.role, token.externalAgency, token.sgaCanonicalName
      // No DB hits per request — all permission data lives on the JWT
    },
    async session({ session, token }) {
      session.user.id = token.id;
      (session as ExtendedSession).permissions = getPermissionsFromToken(tokenData);
    },
  },
  session: { strategy: 'jwt', maxAge: 86400 },
};
```

### Session shape — `src/types/auth.ts:5-19`

```ts
export interface ExtendedSession extends Session {
  permissions?: UserPermissions;   // attached in session callback
}
// session.user = { id, email, name, image }   (id added by callback)
```

### Roles + permissions — `src/lib/permissions.ts:17-82`, `src/types/user.ts:1`

8 roles: `revops_admin | admin | manager | sgm | sga | viewer | recruiter | capital_partner`. Each role has `allowedPages: number[]` — page IDs that drive sidebar visibility AND server-side route gating. Page numbering is hardcoded (Funnel=1, Pipeline=3, Explore=10, SGA Hub=8, SGM Hub=18, GC Hub=16, Forecast=19, etc — see `src/components/layout/Sidebar.tsx:49-62`).

```ts
// src/lib/permissions.ts:17 (excerpt)
revops_admin: { allowedPages: [1,3,7,8,10,11,12,13,14,15,16,17,18,19], canExport: true, canManageUsers: true, ... }
admin:        { allowedPages: [1,3,7,8,9,10,11,12,13,15,16,17,18], ... }
sga:          { allowedPages: [1,3,7,8,10,11,13,15], sgaFilter: <canonical name>, ... }
recruiter:    { allowedPages: [7,12], ... }   // hard-locked by middleware
```

### How API routes verify identity + role

Two layers:

1. **`src/middleware.ts`** runs on every `/dashboard/*` and `/api/*` request:
   - No JWT + `/dashboard/*` → 302 to `/login`.
   - No JWT + `/api/*` → `401 Unauthorized`.
   - `recruiter` role default-denied from all `/api/*` except an allowlist (`/api/auth`, `/api/recruiter-hub`, `/api/dashboard/record-detail`, `/api/users/me/change-password`, `/api/dashboard/data-freshness`).
   - Same default-deny for `capital_partner`.

2. **Per-route check** inside each `route.ts`:

```ts
// src/app/api/admin/coaching-usage/route.ts:300-318  (canonical pattern)
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const permissions = getSessionPermissions(session);
  if (!permissions) return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
  if (permissions.role !== 'revops_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // ... handler ...
}
```

There is **no shared `requireRole(...)` helper** — every route inlines this pattern. Helpers exist for getting the data: `getServerSession(authOptions)`, `getSessionPermissions(session)` from `src/types/auth.ts:23`, `getSessionUserId(session)` from `src/lib/auth.ts:13`.

### Page-level gating — `src/app/dashboard/explore/page.tsx`

Server components do their own redirect:

```tsx
// src/app/dashboard/explore/page.tsx:1-36
export default async function ExplorePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  const permissions = getSessionPermissions(session);
  if (!permissions || !permissions.allowedPages.includes(10)) redirect('/dashboard');
  return <ExploreClient isRevopsAdmin={permissions.role === 'revops_admin'} />;
}
```

### Non-NextAuth / service-to-service auth

**There is no general-purpose service token system for inbound calls into this app.** The middleware (`src/middleware.ts:76-81`) returns 401 for any `/api/*` request lacking a NextAuth JWT cookie.

The closest existing concept is `McpApiKey` (Prisma model, `prisma/schema.prisma:51-66`, helpers in `src/lib/mcp-key-utils.ts`): SHA-256-hashed per-user keys with prefix `sk-savvy-`. **But these are used by the Dashboard's *outbound* MCP clients to call the external `savvy-mcp-server` — they are not validated by any inbound dashboard route.** No middleware path consumes them.

If sales-coaching needs to push data INTO the dashboard, today there is **no precedent path**: a new auth check would have to be invented. Conversely, the dashboard already pulls FROM sales-coaching (see Section 3).

---

## 2. Coaching-usage tab (existing)

### Location

- **Page**: `/dashboard/explore` — `src/app/dashboard/explore/page.tsx` → `ExploreClient.tsx`.
- **Tab host**: `src/app/dashboard/explore/ExploreClient.tsx:206-254` renders three tabs (`'ask' | 'bot-usage' | 'coaching-usage'`), but **the tab strip + Coaching Usage tab only render for `revops_admin`**:

```tsx
// src/app/dashboard/explore/ExploreClient.tsx:206-254 (condensed)
{isRevopsAdmin && (
  <nav className="-mb-px flex gap-6" aria-label="Tabs">
    <button onClick={() => setActiveTab('ask')}>Ask</button>
    <button onClick={() => setActiveTab('bot-usage')}>Bot Usage</button>
    <button onClick={() => setActiveTab('coaching-usage')}>Coaching Usage</button>
  </nav>
)}
{isRevopsAdmin && activeTab === 'coaching-usage' && <CoachingUsageClient />}
```

- **Tab body**: `src/app/dashboard/explore/CoachingUsageClient.tsx` (~700 lines, Tremor `Card`/`Title`/`Metric` + custom Tailwind tri-state filters).
- **Drill-down modal**: `src/app/dashboard/explore/CallDetailModal.tsx`.

### Data sources — what it queries

This is the **only feature in the dashboard that talks to a non-Prisma Postgres** (raw `pg` Pool against the sales-coaching Neon DB), and it cross-references BigQuery for SFDC name resolution.

**Helper** — `src/lib/coachingDb.ts`:

```ts
// src/lib/coachingDb.ts:13-46
import { Pool } from 'pg';
const globalForCoaching = globalThis as unknown as { coachingPool: Pool | undefined };

export function getCoachingPool(): Pool {
  if (globalForCoaching.coachingPool) return globalForCoaching.coachingPool;
  // MUST use UNPOOLED — Neon's pgbouncer (txn mode) breaks raw pg's prepared statements
  const url = process.env.SALES_COACHING_DATABASE_URL_UNPOOLED || process.env.SALES_COACHING_DATABASE_URL || '';
  globalForCoaching.coachingPool = new Pool({
    connectionString: url, ssl: { rejectUnauthorized: false },
    max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
  });
  return globalForCoaching.coachingPool;
}
```

**API route** — `src/app/api/admin/coaching-usage/route.ts:90-153`:

```ts
const DETAIL_SQL = `
  WITH advisor_calls AS (
    SELECT cn.id FROM call_notes cn
    WHERE cn.source_deleted_at IS NULL ${rangeWhere}
      AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
  )
  SELECT cn.id AS call_note_id, cn.call_started_at AS call_date, cn.rep_id,
         sga.full_name AS sga_name, sga.role AS rep_role,
         sgm.full_name AS sgm_name, cn.source, cn.sfdc_who_id,
         cn.sfdc_record_type, cn.invitee_emails, cn.kixie_task_id,
         EXISTS (SELECT 1 FROM sfdc_write_log swl WHERE swl.call_note_id = cn.id AND swl.status='success') AS pushed_to_sfdc,
         EXISTS (SELECT 1 FROM ai_feedback af JOIN evaluations e ON e.id = af.evaluation_id
                 WHERE e.call_note_id = cn.id AND af.status='approved' AND af.is_synthetic_test_data=false) AS has_ai_feedback,
         EXISTS (SELECT 1 FROM evaluation_edit_audit_log eal JOIN evaluations e ON e.id = eal.evaluation_id
                 WHERE e.call_note_id = cn.id AND eal.edit_source IN ('slack_dm_edit_eval_text','slack_dm_edit_eval')) AS has_manager_edit_eval
  FROM call_notes cn JOIN advisor_calls ac ON ac.id = cn.id
  LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
  LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
  ORDER BY cn.call_started_at DESC NULLS LAST
`;
const CENSUS_SQL = `SELECT count(*)::text AS active_coaching_users
                    FROM reps WHERE is_active = true AND is_system = false`;
```

The dashboard then **post-processes** rows by hitting BigQuery (`src/lib/queries/resolve-advisor-names.ts` — not shown here) to map `sfdc_who_id`/`kixie_task_id`/`invitee_emails` → SFDC Lead/Contact name + funnel-status (didSql/didSqo/closedLost/currentStage/leadId/opportunityId). See `src/app/api/admin/coaching-usage/route.ts:176-291` for the full cascade.

**Detail route** — `src/app/api/admin/coaching-usage/call/[id]/route.ts:31-71` queries `call_notes` + `call_transcripts` + `evaluations` for the modal:

```ts
SELECT cn.source, cn.summary_markdown, ct.transcript, e.ai_original
FROM call_notes cn
LEFT JOIN call_transcripts ct ON ct.call_note_id = cn.id
LEFT JOIN (SELECT DISTINCT ON (call_note_id) call_note_id, ai_original
           FROM evaluations ORDER BY call_note_id, created_at DESC) e ON e.call_note_id = cn.id
WHERE cn.id = $1 AND cn.source_deleted_at IS NULL
```

UUID-validated against `^[0-9a-f]{8}-[0-9a-f]{4}-...` before going near SQL (`route.ts:22`). Source-specific markdown rendering lives in `src/lib/coaching-notes-markdown.ts`.

### Schema shape consumed

Tables touched in the sales-coaching DB: `call_notes`, `call_transcripts`, `evaluations`, `ai_feedback`, `evaluation_edit_audit_log`, `sfdc_write_log`, `reps`. Columns the dashboard relies on:

```
call_notes:        id (uuid), call_started_at (timestamptz), source ('granola'|'kixie'),
                   likely_call_type, rep_id, sfdc_who_id, sfdc_record_type, invitee_emails (text[]),
                   kixie_task_id, summary_markdown, source_deleted_at
call_transcripts:  call_note_id (FK), transcript (jsonb)
evaluations:       id, call_note_id, ai_original (jsonb), created_at
ai_feedback:       evaluation_id, status, is_synthetic_test_data
sfdc_write_log:    call_note_id, status
reps:              id, full_name, role, manager_id, is_active, is_system
evaluation_edit_audit_log: evaluation_id, edit_source
```

The dashboard **does not write** to this DB — read-only.

### UI components used

Tremor (`@tremor/react@^3.18.7`): `Card`, `Title`, `Text`, `Metric`. Plus `lucide-react` icons (`RefreshCw`, `PhoneCall`). Filters are hand-rolled Tailwind tri-state segmented buttons (`CoachingUsageClient.tsx:99-131`). Modal is `CallDetailModal.tsx` (custom). No shared "DataTable" abstraction — the table is bespoke Tailwind + Tremor.

Caching: `cachedQuery(...)` wrapper from `src/lib/cache.ts` (Next.js `unstable_cache`), tag `CACHE_TAGS.COACHING_USAGE`, 5-min TTL, busted by `/api/admin/refresh-cache`.

---

## 3. Data layer

### Databases this app talks to

| DB | Driver | Where | Purpose |
|---|---|---|---|
| **Dashboard Neon Postgres** (primary) | Prisma 6.19 | `src/lib/prisma.ts` | Users, MCP keys, saved reports, weekly/quarterly goals, forecast scenarios, dashboard requests, game scores, request notifications, etc. (17 models) |
| **BigQuery** (`savvy-gtm-analytics`) | `@google-cloud/bigquery@^7.9.4` | `src/lib/bigquery.ts` | All funnel analytics. Primary view: `Tableau_Views.vw_funnel_master` |
| **Sales-coaching Neon Postgres** (secondary) | raw `pg@^8.20.0` | `src/lib/coachingDb.ts` | Read-only — Coaching Usage tab + Kixie call-transcriber writes (out-of-process, separate Cloud Run job in `packages/call-transcriber/`) |

The "all Postgres goes through Prisma" rule (CONSTRAINTS.md) applies to the **primary** DB; sales-coaching is the explicit exception (`src/lib/coachingDb.ts:9-11`).

### Prisma models relevant to coaching/users/reps

There is **no rep/coach/team model in the dashboard's Prisma**. Users live in `User` (`prisma/schema.prisma:12-36`). Rep identity flows entirely through:
- `User.email` → matched against BigQuery `SavvyGTMData.User` to resolve canonical SGA name (`src/lib/sga-canonical-name.ts`).
- Sales-coaching `reps` table — joined on `cn.rep_id`, but only consumed via raw SQL.

```prisma
// prisma/schema.prisma:12 (User model — primary identity)
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  name            String
  passwordHash    String?  // bcrypt; null for OAuth-only users
  role            String   @default("viewer")  // see UserRole union
  isActive        Boolean  @default(true)
  externalAgency  String?  // recruiter/capital_partner data scope
  bqAccess        Boolean  @default(false)
  mcpApiKeys      McpApiKey[]
  // + 8 more relations: requests, notifications, savedReports, scenarios, ...
}
```

### BigQuery datasets/tables

Project: `savvy-gtm-analytics` (us-east1). Auth in `src/lib/bigquery.ts:5-79`:
- **Vercel**: `GOOGLE_APPLICATION_CREDENTIALS_JSON` env var (single-line JSON service-account key, `private_key` newline-fix logic at line 34).
- **Local**: `GOOGLE_APPLICATION_CREDENTIALS` file path.
- Scopes: `bigquery`, `cloud-platform`, `drive.readonly`.

The MUST-NOT-be-set-on-Vercel gotcha is documented at `src/lib/bigquery.ts:18-25`: `GOOGLE_APPLICATION_CREDENTIALS` would be auto-detected as a path and break.

Datasets in use: `Tableau_Views` (vw_funnel_master + others), `SavvyGTMData` (User, Task, etc — Salesforce sync via Fivetran), `savvy_analytics` (derived views — sms_intent_classified, vw_sga_sms_timing_analysis_v2, sms_weekly_metrics_daily).

### Connection between Dashboard and sales-coaching today

- **Inbound to dashboard from sales-coaching:** none.
- **Outbound from dashboard to sales-coaching:**
  - Read-only `pg` queries from API routes under `/api/admin/coaching-usage/**` (Section 2 above).
  - The `packages/call-transcriber/` Cloud Run job writes Kixie transcripts INTO `call_notes` with `source='kixie'`. It runs out-of-band (not Vercel).
- **Outbound from dashboard to sales-coaching's Cloud Run app:** **none** — the dashboard does not call the sales-coaching Next.js service over HTTP.
- The dashboard does NOT share a DB read-replica or BigQuery mirror with sales-coaching — both currently rely on direct Neon `SALES_COACHING_DATABASE_URL_UNPOOLED`.

---

## 4. Page / route conventions

### Adding a new top-level page

Pure App Router (`next@^14.2.35`). All dashboard pages live under `src/app/dashboard/<slug>/page.tsx`. Layout chain: `src/app/layout.tsx` (root, providers) → `src/app/dashboard/layout.tsx` (sidebar + header + permission guard).

To add `/dashboard/call-intelligence`:

1. **Create** `src/app/dashboard/call-intelligence/page.tsx` (server component) and any `*Client.tsx` siblings (`'use client'`).
2. **Add page ID + route + icon** to `src/components/layout/Sidebar.tsx:49-62`:

```tsx
const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  // ...
  { id: 20, name: 'Call Intelligence', href: '/dashboard/call-intelligence', icon: PhoneCall },
];
```

3. **Add the new ID to relevant role allowedPages** in `src/lib/permissions.ts:17-82` (e.g. `revops_admin`, `manager`, `sgm`, `admin`).
4. **Server-side guard** in the page (mirrors `src/app/dashboard/explore/page.tsx:9-35`):

```tsx
export default async function CallIntelligencePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  const permissions = getSessionPermissions(session);
  if (!permissions || !permissions.allowedPages.includes(20)) redirect('/dashboard');
  return <CallIntelligenceClient role={permissions.role} />;
}
```

5. **No middleware change needed** unless you want to default-deny additional roles — middleware already gates all `/dashboard/*` and `/api/*`.

### API-route conventions

Pattern (canonical example: `src/app/api/admin/coaching-usage/route.ts`):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

export const dynamic = 'force-dynamic';   // disable static caching for auth'd routes

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || permissions.role !== 'revops_admin')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    // ... validate inputs (allowlist enums, regex, zod) ...
    // ... call cached query helper ...
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
```

- Validation: ad-hoc — `zod@^4.3.6` is in deps but used per-route only where needed; allowlists + regex are common (see UUID regex in `coaching-usage/call/[id]/route.ts:22`).
- Errors: try/catch, log to stderr, return `{ error: string }`. Sentry catches unhandled.
- BigQuery params: ALWAYS use `@paramName` parameterised queries — string interpolation is banned.

### Middleware

`src/middleware.ts` — single matcher (`/dashboard/:path*`, `/api/:path*`). Performs:

- Public path skiplist (`_next`, `/api/auth`, `/api/cron`, `/login`, `/static`, `/monitoring`, files with extensions).
- JWT presence check via `getToken({ req, secret: NEXTAUTH_SECRET })`.
- Role-based redirects + 403 (recruiter, capital_partner only — admins/SGAs/managers are not pre-filtered here, just by per-route checks).

### Rate limiting

Upstash Redis. **Currently only login / forgot-password / reset-password endpoints rate-limit.** Helper: `src/lib/rate-limit.ts:48-76`.

```ts
// src/lib/rate-limit.ts:48-58
export function getLoginLimiter(): Ratelimit | null {
  // 5 attempts per 15 min sliding window, prefix 'ratelimit:login'
}
```

If `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are missing, `checkRateLimit` returns `{ success: true }` with a console warning — fail-open in misconfigured envs. There is **no general API rate limiter**.

### CSRF

NextAuth handles CSRF for its own auth endpoints. Custom routes have **no CSRF token check** — they rely on the auth-cookie + same-origin model. There is no separate CSRF middleware.

---

## 5. UI shell

### Design system

- **Tremor** (`@tremor/react@^3.18.7`) is the canonical chart/card/table/metric library — use it first. Examples: `Card`, `Title`, `Metric`, `Text`, `BarChart`, `LineChart`. The whole dashboard page is built from Tremor primitives (`src/app/dashboard/page.tsx`).
- **Tailwind CSS** (`tailwindcss@^3.4.19`) for everything Tremor doesn't cover. Dark-mode is class-based — use `dark:` variants (e.g. `bg-white dark:bg-gray-800`).
- **lucide-react** icons — every page imports a handful (`PhoneCall`, `Bot`, `Sparkles`, `Activity`, etc.).
- **Recharts** + **Leaflet** are also available but secondary.
- No component library beyond Tremor (no shadcn, no Radix-direct, no MUI).

### Layout primitives

- Root: `src/app/layout.tsx` — `SessionProviderWrapper` + `ThemeProvider` (next-themes) + Vercel Analytics.
- Dashboard shell: `src/app/dashboard/layout.tsx` — `<Header />` + `<Sidebar />` + `<main>` flex layout, with permission-driven route protection redirecting recruiter / capital_partner to their hub. Sidebar default state: collapsed (`isSidebarCollapsed = true`, line 21).
- Header: `src/components/layout/Header.tsx`. Sidebar: `src/components/layout/Sidebar.tsx` (drives off `permissions.allowedPages`).

### Representative example page

`src/app/dashboard/explore/page.tsx` (server) → `src/app/dashboard/explore/ExploreClient.tsx` (client) is the smallest end-to-end pattern. It:
1. Server-side session + permission check.
2. Passes minimal props (`isRevopsAdmin`) to client.
3. Client owns state, tabs, fetches.

For tabbed-page-with-multiple-data-sources (which is the shape the new Call Intelligence page would take), `ExploreClient.tsx` IS the template — copy its tab pattern (`useState<ExploreTab>(...)`, conditional render).

### Theme / dark mode

`next-themes@^0.4.6` via `src/components/providers/ThemeProvider.tsx`. Applied as `class="dark"` on `<html>` (`suppressHydrationWarning` is set — `src/app/layout.tsx:26`). Every component must include `dark:` variants — there is no automatic theming.

---

## 6. Environments & deploy

- **Vercel project**: `dashboard-eta-lime-45` (production URL `https://dashboard-eta-lime-45.vercel.app`, hardcoded fallback at `src/lib/auth.ts:36`). Preview deploys auto-build on every push to non-main branches; `NEXTAUTH_URL` resolves from `VERCEL_URL` / `VERCEL_BRANCH_URL` (`src/lib/auth.ts:18-37`).
- **Env vars**: managed entirely in **Vercel Project Settings → Environment Variables** (no Infisical, no Doppler). `.env` is local only and gitignored. `.env.example` (`.env.example`) is the canonical names list.
- **Cron jobs**: `vercel.json` declares 9 — cache refresh (4× daily + Friday triple), GC Hub sync, geocoder, etc. Long-running routes also bumped to 60s `maxDuration` there.
- **Sentry**: org `savvy-wealth-se`, project `javascript-nextjs` (`next.config.js:42-43`). Both server (`src/instrumentation.ts`) and client (`src/instrumentation-client.ts`) are wired. DSN env vars: `SENTRY_DSN` (server), `NEXT_PUBLIC_SENTRY_DSN` (client). Source maps uploaded via `SENTRY_AUTH_TOKEN`. Tunnel route: `/monitoring` (`next.config.js:58`).

### Secrets currently configured (names only — values in Vercel)

```
NEXTAUTH_SECRET, NEXTAUTH_URL
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
DATABASE_URL  (+ DIRECT_URL, POSTGRES_*)            # primary Neon
SALES_COACHING_DATABASE_URL, SALES_COACHING_DATABASE_URL_UNPOOLED,
  SALES_COACHING_PGHOST, SALES_COACHING_PGHOST_UNPOOLED,
  SALES_COACHING_PGUSER, SALES_COACHING_PGDATABASE, SALES_COACHING_PGPASSWORD
GCP_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS_JSON  # BigQuery
GOOGLE_SHEETS_WEBAPP_URL, GOOGLE_SHEETS_CREDENTIALS_JSON
GC_REVENUE_ESTIMATES_SHEET_ID, GC_PAYOUTS_TRACKER_SHEET_ID, GC_Q3_2025_SHEET_ID, GC_Q4_2025_SHEET_ID
ANTHROPIC_API_KEY                                   # Explore feature
ASSEMBLYAI_API_KEY                                  # Kixie transcriber (Cloud Run, not Vercel)
SENDGRID_API_KEY, EMAIL_FROM, NEXT_PUBLIC_APP_URL
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN    # rate limit only
SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, SENTRY_AUTH_TOKEN
WRIKE_ACCESS_TOKEN, WRIKE_FOLDER_ID, WRIKE_WEBHOOK_SECRET
METABASE_SITE_URL, METABASE_SECRET_KEY, NEXT_PUBLIC_METABASE_SITE_URL,
  METABASE_API_EMAIL, METABASE_API_PASSWORD
CRON_SECRET
TAVILY_API_KEY
# MCP_SERVER_URL  (commented; only for local MCP runs)
```

---

## 7. Constraints / gotchas

- **Build memory bump is mandatory.** `package.json:11`: `cross-env NODE_OPTIONS=--max-old-space-size=8192 prisma generate && node --max-old-space-size=8192 ./node_modules/next/dist/bin/next build`. Removing it OOMs on Vercel.
- **`prisma generate` in postinstall** (`package.json:21`) — required because Prisma client is `engineType = "library"` with `binaryTargets = ["native", "rhel-openssl-3.0.x"]` (`prisma/schema.prisma:1-5`). New env that skips postinstall will fail at runtime with "Did not initialize yet."
- **Prisma client is lazy-instantiated via Proxy** (`src/lib/prisma.ts:125-131`) so build doesn't try to connect. Don't replace this with a top-level `new PrismaClient()`.
- **Neon URL parsing rewrites query params at request time** (`src/lib/prisma.ts:30-58`) — adds `connect_timeout`, `statement_timeout`, `sslmode=require`. In dev, prefers `DIRECT_URL` to bypass the pooler (Neon's pgbouncer is fine for Prisma but not for raw `pg` prepared statements — that's why coaching uses `_UNPOOLED`).
- **Sales-coaching pool MUST use the unpooled URL.** Kept duplicating this gotcha: `src/lib/coachingDb.ts:19-34`. PgBouncer txn-mode disables prepared statements; raw `pg` defaults to using them.
- **TypeScript build errors fail the build** (`next.config.js:13`: `ignoreBuildErrors: false`). ESLint errors do NOT fail the build (`ignoreDuringBuilds: true`).
- **`export const dynamic = 'force-dynamic'`** — every page that calls `getServerSession` and every authed API route sets this. Skipping it can break auth on Vercel via static optimization.
- **Sentry instrumentation hook is enabled** (`next.config.js:9`: `experimental: { instrumentationHook: true }`). The server `src/instrumentation.ts` registers an unhandled-rejection swallow for "data > 2MB" Next.js cache errors (`src/instrumentation.ts:30-44`) — these happen on Coaching Usage today when the response exceeds the cache cap and are intentionally non-fatal.
- **`getCoachingUsageData` is wrapped in `unstable_cache`** (`src/app/api/admin/coaching-usage/route.ts:293-298`) with the BigQuery resolver call INSIDE the cache. If the resolver returns >2MB (rare but possible), Next swallows the cache write but still returns data. Don't move the resolver outside the wrapper without rethinking cache stratification.
- **`McpApiKey` is for outbound calls FROM the dashboard, not inbound** (Section 1) — easy to misread the name.
- **NextAuth JWT contains role + externalAgency + sgaCanonicalName** — refreshed on sign-in only. Role changes for an existing logged-in user don't take effect until re-login. There IS a backfill path (`src/lib/auth.ts:195-210`) that re-queries the DB if the JWT is missing fields (migration aid).
- **Sidebar collapsed by default** (`src/app/dashboard/layout.tsx:21`).
- **Pre-commit hook auto-runs doc generators** (`.husky/pre-commit`). Pre-existing inventories live at `docs/_generated/`. CLAUDE.md describes the doc-update protocol.
- **Wrike post-commit hook** reads `.ai-session-context.md` to create kanban cards (`scripts/post-commit-wrike.js`). Not relevant to integration work, but commits without that file in the right shape will create empty/wrong tasks.

---

## 8. What's NOT here (the bridging gap)

This is the section that should drive the integration design.

### 8.1 No inbound service auth
- **No API key, no service token, no JWT-issuer, nothing accepts a non-NextAuth call into `/api/*`** (`src/middleware.ts:76-81` returns 401). `McpApiKey` is outbound-only.
- If sales-coaching wants to PUSH data into the dashboard (events, webhooks, whatever), the current code has no validation path. A new auth scheme would be net-new.

### 8.2 No HTTP client to sales-coaching's Cloud Run app
- The dashboard never makes an HTTP call to sales-coaching. There is no `fetch('https://sales-coaching.run.app/...')` anywhere. There is no service-account bridge to Cloud Run, no shared OIDC, no Workload Identity.
- BigQuery uses a SA key (env var). GCP-resident services would need their own auth — likely SA key reuse or a separate identity.

### 8.3 No shared identity with Cloud Run services
- Dashboard users are in **dashboard's** Neon `User` table. Sales-coaching presumably has its own user/auth (reps via the `reps` table). They are linked only by **email** today (no foreign-key, no SSO bridge).
- Resolution from dashboard `User.email` → sales-coaching `reps.full_name` happens implicitly via BigQuery → SFDC name (`src/lib/sga-canonical-name.ts`). It is **not bidirectional and not reliable as an identity primitive** — name drift is documented as a gotcha (CLAUDE.md mentions `feedback_sgm_role.md` and the SGA canonical-name resolution).

### 8.4 No DB read-replica or BigQuery mirror
- Sales-coaching's Postgres is queried **directly** with raw `pg`. There is no replica, no logical-replication snapshot in BigQuery, no Fivetran connector for sales-coaching.
- BigQuery only contains SFDC + dashboard-owned analytics (Tableau_Views, SavvyGTMData, savvy_analytics).

### 8.5 No iframe embed pattern
- The Metabase Chart Builder embeds a third-party iframe via JWT (`METABASE_SECRET_KEY` env). There is no equivalent for sales-coaching. If you want to embed the existing sales-coaching UI, no infra is wired up.

### 8.6 No event bus / queue
- No Redis pub/sub, no Pubsub topic consumed by the dashboard, no SQS, no Kafka. Upstash Redis exists ONLY for rate limit tokens.

### 8.7 No long-running tasks / streaming
- API route `maxDuration` cap is 60s (Vercel `vercel.json` for the few routes that bump it; default is shorter). No SSE except the Explore feature's agent stream. No WebSockets.

### 8.8 The bridge that DOES already exist
- **Direct Neon read** to sales-coaching's DB via `pg` Pool. Read-only by convention. No write-path validated. The Coaching Usage tab is built entirely on this.

---

## Quick checklist for the OTHER repo's integration design

When sales-coaching's Claude reads this, the open design questions are:

- Should Call Intelligence consume sales-coaching data via **(a) the existing direct Neon `pg` read** (cheapest, but couples schema), **(b) HTTP API on sales-coaching's Cloud Run** (needs new inbound-auth scheme on sales-coaching, plus dashboard-side outbound auth), **(c) a shared replica/mirror in BigQuery** (slowest to build, decouples), or **(d) iframe embed** (cheapest visually, identity-pass-through unsolved)?
- Whatever path is chosen, **identity is by email** today. There is no shared session.
- Existing Coaching Usage already proves path (a) works for the read-only pattern. Anything write-heavy or real-time is greenfield.

---

*End. Generated 2026-05-08. All file:line refs verified against the working tree at commit 3ac3250.*
