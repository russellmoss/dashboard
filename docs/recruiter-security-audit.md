## Recruiter Security Audit

### 1. High‑level summary (non‑technical)

We’ve added a dedicated “Recruiter Hub” experience inside the Savvy dashboard for external recruiters. The critical requirement is that **a recruiter must only ever see the data we explicitly choose to share with them** and **must never be able to see internal pipeline data, SGA/Sales performance, or any other advisor records**.

To achieve this, we made changes in three layers:

- **Login & identity**: When a user signs in, the system knows their **role** (e.g. admin, manager, SGA, recruiter) and, for recruiters, which **agency** they belong to.
- **Front‑end navigation**: The visible sidebar and pages in the browser redirect recruiters away from any part of the dashboard that is not theirs.
- **Back‑end (server) protections**: All of the important protections live on the server, not in the browser. Even if a recruiter:
  - Types a forbidden URL manually,
  - Calls an API directly from the browser console, or
  - Uses a script to hit our API endpoints,
  the **server** will reject access or filter the data down to only their agency.

We also put in place a **“default deny” policy** for recruiters:

- Any new dashboard page or API we create in the future is **blocked for recruiters by default** unless we deliberately allow it.

In plain English: **we assume recruiters are untrusted and we only open very specific, narrow doors for them.**

---

### 2. What a recruiter can and cannot access (behavioral view)

When a user with `role = recruiter` logs in:

- They are automatically taken to the **Recruiter Hub**.
- They can also access the **Settings** page to change their password and view basic account info.
- They **cannot** navigate to:
  - Funnel Performance
  - Open Pipeline
  - SGA Hub
  - SGA Activity
  - Explore (AI agent)
  - Any future dashboard pages we add (unless we explicitly allow them).

If a recruiter tries to:

- Open `/dashboard`, `/dashboard/pipeline`, `/dashboard/sga-hub`, `/dashboard/explore`, etc. via the URL bar:
  - They are immediately redirected to `/dashboard/recruiter-hub` **before** the forbidden page can render.
- Call internal APIs like `/api/dashboard/funnel-metrics` or `/api/sga-hub/weekly-actuals` directly from the console:
  - The server responds with **HTTP 403 Forbidden**.
- Call a **new** API we add under `/api/...` in the future:
  - The server will also respond with **HTTP 403 Forbidden**, unless we deliberately put that API on a small recruiter allowlist.

Inside the **Recruiter Hub**, even the data they do receive is:

- **Filtered by their agency** on the server (using their `External_Agency__c`).
- Structured so that:
  - Prospect lists only include prospects associated with their agency.
  - Opportunity lists only include opportunities associated with their agency.

So **“what they see” is limited both by page access and by record‑level filtering**.

---

### 3. Architecture overview (for technical readers / CTO)

This section explains the design at the level of concerns a CTO or security‑minded engineer would have.

#### 3.1 Roles & permissions

Core concepts:

- **User role** (from the `User` table, via Prisma):
  - `admin`, `manager`, `sgm`, `sga`, `viewer`, `recruiter`.
- **User permissions** (`UserPermissions` in `src/types/user.ts`, computed in `src/lib/permissions.ts`):
  - `role` – normalized role string.
  - `allowedPages` – which numbered dashboard pages the role can see.
  - `sgaFilter`, `sgmFilter` – used to filter data by SGA/SGM.
  - `recruiterFilter` – for recruiters, this is the **External Agency** they are bound to.
  - `canExport`, `canManageUsers`.

For recruiters specifically:

- `allowedPages = [7, 12]` meaning:
  - 7 = Settings
  - 12 = Recruiter Hub
- `recruiterFilter = user.externalAgency` (or `null` for non‑recruiters).

These permissions are:

- Used **server‑side** in API routes and page loaders.
- Also injected into the **NextAuth session** for convenience on the client.

#### 3.2 JWT & session: embedding role into the token

In `src/lib/auth.ts` (NextAuth config):

- During **credentials login**, we return:
  - `id`, `email`, `name`, and **`role`** from our own `User` table.
- In the **`jwt` callback**:
  - We look up the DB user via `getUserByEmail()` and set:
    - `token.id = dbUser.id`
    - `token.role = dbUser.role`
  - We added a **backfill** path:
    - If `token.role` is missing (e.g. old JWTs), we re‑fetch the user by email once and populate `token.role`.

Why this matters:

- The **middleware** uses `getToken()` (NextAuth JWT) to read `token.role` and make **pre‑request decisions** (redirect/403) before any React or page code runs.
- This means even if a page or route forgets to check role, the middleware can still enforce a **global default‑deny** policy.

#### 3.3 Middleware: global default‑deny for recruiters

`src/middleware.ts` is configured with:

```ts
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/:path*',
  ],
};
```

This means the middleware runs for:

- All dashboard pages under `/dashboard/...`
- All APIs under `/api/...`

##### 3.3.1 Public exceptions

We explicitly skip the middleware’s auth checks for:

- `/_next` (Next.js internals, assets)
- `/api/auth/*` (NextAuth, password flows)
- `/api/cron/*` (CRON endpoints protected via `CRON_SECRET` header)
- `/login`
- `/static/*`
- `/monitoring/*` (Sentry tunnel)
- Requests for files (paths containing a dot, e.g. `.js`, `.css`)

Everything else under `/dashboard/*` and `/api/*` is considered **protected**.

##### 3.3.2 Dashboard routing for recruiters (page‑level isolation)

Middleware logic:

- If **no token** and path starts with `/dashboard`:
  - Redirect to `/login` with `callbackUrl`.
- If token exists and path starts with `/dashboard`:
  - Read `role` from the token.
  - If `role === 'recruiter'`:
    - Only allow:
      - `/dashboard/recruiter-hub...`
      - `/dashboard/settings...`
    - For **any other** `/dashboard/...` path:
      - Immediately redirect to `/dashboard/recruiter-hub` with a clean query string.

Result:

- A recruiter cannot render any other dashboard page; even “typing the URL in the address bar” is intercepted at the middleware layer and redirected.

##### 3.3.3 API gating for recruiters (API‑level isolation)

For API routes:

- If **no token** and path starts with `/api` (and is not in the public exceptions):
  - Return `401 Unauthorized`.
- If token exists and path starts with `/api`:
  - Read `role` from token.
  - For `role === 'recruiter'`:
    - We use a **tight allowlist**:
      - `/api/auth/*` (already excluded above)
      - `/api/recruiter-hub/*` – recruiter queries
      - `/api/users/me/change-password` – change password flow
      - `/api/dashboard/data-freshness` – non‑sensitive data freshness info
    - If the path is **not** on this allowlist:
      - Return `403 Forbidden`.

This gives us:

- A **global, centralized guarantee** that recruiters cannot call any other APIs:
  - `/api/dashboard/*` – blocked by middleware + route code.
  - `/api/sga-hub/*`, `/api/sga-activity/*`, `/api/agent/query`, `/api/saved-reports/*`, etc. – blocked by middleware even if a route forgot to check.
  - Future `/api/new-feature/*` – blocked by default until we explicitly add it to the recruiter allowlist.

In other words: **the default posture for recruiters is “no API access unless we opt in.”**

---

### 4. Route‑level defenses (defense in depth)

Even with middleware in place, we maintain **route‑level checks** as a second layer:

- Most sensitive APIs already:
  - Call `getServerSession(authOptions)` to ensure the user is authenticated.
  - Call `getUserPermissions(session.user.email)` to know their role and filters.
  - Enforce role‑based allow/deny logic.

Examples:

- `/api/dashboard/*`:
  - Recruiters get `403` from the route itself (even before middleware changes).
- `/api/agent/query` (Explore backend):
  - Recruiters get `403`.
- `/api/sga-hub/*` and `/api/sga-activity/*`:
  - Only `admin`, `manager`, and `sga` roles are allowed.
- `/api/recruiter-hub/*`:
  - They verify `permissions.allowedPages` includes the Recruiter Hub page (12).
  - They pass `permissions.recruiterFilter` down into BigQuery/SQL queries to filter by `External_Agency__c`.

We also added a small **helper** in `src/lib/api-authz.ts`:

```ts
export function forbidRecruiter(permissions: UserPermissions) {
  if (permissions.role !== 'recruiter') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

This gives us a simple pattern for future sensitive routes:

```ts
const permissions = await getUserPermissions(session.user.email);
const forbidden = forbidRecruiter(permissions);
if (forbidden) return forbidden;
```

While middleware already does the heavy lifting, this keeps our API code self‑documenting and robust.

---

### 5. Data‑level isolation inside Recruiter Hub

For the views that recruiters *are* allowed to see, we still enforce **row‑level security semantics**:

- The **Recruiter Hub** queries (in `src/lib/queries/recruiter-hub.ts`) take a `recruiterFilter` parameter.
- For recruiters:
  - `recruiterFilter` is always set to their `externalAgency`.
  - BigQuery / SQL conditions include:
    - `WHERE External_Agency__c = @recruiterFilter`
  - This ensures:
    - Prospects and opportunities for **other agencies** are never returned to that recruiter, even if they guess IDs or try to pivot.

For admins/managers:

- They can see **all** agencies in the Recruiter Hub and can filter by external agency explicitly.

So recruiter visibility is constrained in **two dimensions**:

1. **Which API routes they can call** (middleware + route checks).
2. **Which rows those APIs return** (agency filter in queries).

---

### 6. Confidence level and robustness

#### 6.1 What we’re very confident about

Given the current design, we are **very confident** that:

1. **A recruiter cannot render any non‑Recruiter‑Hub dashboard content**
   - Middleware reads `token.role` and **redirects**:
     - `/dashboard/*` pages other than Recruiter Hub + Settings → `/dashboard/recruiter-hub`.
2. **A recruiter cannot access any non‑Recruiter‑Hub API**
   - Middleware enforces a **global allowlist** for recruiters under `/api/*`.
   - New APIs added anywhere under `/api/...` are automatically **403** for recruiters unless we consciously add them to the allowlist.
3. **Recruiter Hub data is scoped to their agency**
   - Server‑side filtering uses `permissions.recruiterFilter` (mapped to external agency).
   - There is no client‑side “filter only” – the server never returns other agencies’ rows to that user.

Together, this gives us:

- **Strong isolation by role** (recruiter vs internal users).
- **Strong isolation by agency** among recruiters.
- **Defense in depth**:
  - Middleware (token‑based, early).
  - Route‑level checks.
  - Query‑level filters.

#### 6.2 Remaining risks and honest limitations

No design is absolutely perfect; the realistic residual risks are:

1. **Misconfiguration inside `/api/recruiter-hub/*`**
   - These APIs are intentionally reachable by recruiters.
   - If a future developer forgets to apply `permissions.recruiterFilter` when adding a new recruiter‑hub query, they could accidentally return all agencies’ records.
   - Mitigation:
     - Follow the existing query patterns religiously.
     - Add tests that assert a recruiter only sees their agency’s records.

2. **Expanding the recruiter allowlist in middleware**
   - If we later add more allowlisted paths for recruiters (e.g. `/api/some-shared-utility`), we must treat that as a **security‑sensitive decision** and ensure those endpoints:
     - Either return only non‑sensitive aggregate/metadata data, or
     - Enforce their own row‑level filters.

3. **Human error in future code**
   - Middleware and helpers significantly reduce the chance of mistakes, but a developer could still:
     - Bypass our helper patterns.
     - Add a public route outside the protected prefixes (e.g. mistakenly under `/public-api/*`) that surfaces sensitive data.
   - Mitigation:
     - Architectural discipline: keep **all** internal data APIs under `/api/...`.
     - Periodic security review of new endpoints.
     - Automated tests that log in as a recruiter and:
       - Crawl known routes.
       - Probe a curated list of sensitive APIs and assert `403`.

4. **Session / token anomalies**
   - We rely on `token.role` being correct. The JWT callback backfills missing roles by re‑reading the DB, which is robust, but:
     - If the DB were manually corrupted (e.g. recruiter’s role changed to `admin` incorrectly), middleware would trust that.
   - Mitigation:
     - Treat role assignments as privileged operations (only admins).
     - Consider adding admin tooling/logging around role changes.

Overall, these are **normal operational risks** rather than design flaws.

#### 6.3 Practical assurance level

Given:

- Default‑deny at the middleware layer for all `/dashboard/*` and `/api/*` for recruiters.
- Route‑level role checks for sensitive routes.
- Query‑level filtering by `External_Agency__c`.
- Sticky Cursor rules that remind future coding sessions to treat recruiters as untrusted.

We can reasonably say:

- **It is very unlikely that a recruiter can see any data outside what we explicitly expose in Recruiter Hub.**
- Any regression would most likely come from:
  - A new recruiter‑hub query that forgets to filter by agency, or
  - A consciously added allowlist exception that is misdesigned.

With periodic review and basic automated tests around recruiter permissions, this design should be **robust enough for production use and external recruiter access**, even as the dashboard evolves. 

