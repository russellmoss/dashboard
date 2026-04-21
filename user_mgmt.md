# User Management — Architecture & Extension Plan

## How It Works Today

### Authentication

The dashboard uses **NextAuth.js** with JWT-based sessions (24-hour max age), configured in `src/lib/auth.ts`.

Two sign-in methods:

1. **Google OAuth** — restricted to `@savvywealth.com` domain. Users must be pre-provisioned in the database before they can sign in — Google login alone won't create an account. If an unprovisioned user tries to sign in, they get "You must be invited by an administrator."

2. **Email/Password** — traditional credentials flow. Passwords are hashed with bcrypt (10 salt rounds). Login attempts are rate-limited via Upstash Redis.

There is no self-registration. An admin creates every user manually through the Settings page.

### Session Flow

1. User signs in via Google OAuth or email/password
2. JWT callback populates the token with user data (id, email, name, role, externalAgency)
3. Session callback derives a `UserPermissions` object from the token — no DB query on every request
4. The `ExtendedSession` carries permissions to every page and API route

### Roles & Permissions (RBAC)

Eight roles defined in `src/types/user.ts`:

```
admin | revops_admin | manager | sgm | sga | viewer | recruiter | capital_partner
```

The permissions matrix lives in `src/lib/permissions.ts` (lines 13-78):

| Role | Manage Users | Manage Requests | Run Scenarios | Export | Data Filter |
|------|:---:|:---:|:---:|:---:|---|
| revops_admin | Y | Y | Y | Y | None (full access) |
| admin | Y | - | Y | Y | None (full access) |
| manager | - | - | - | Y | None |
| sgm | - | - | - | Y | Own team only |
| sga | - | - | - | Y | Own leads only |
| viewer | - | - | - | - | None |
| recruiter | - | - | - | Y | Own agency only |
| capital_partner | - | - | - | Y | Own agency (anonymized) |

Each role also has a whitelist of allowed page IDs that controls navigation visibility and route access.

**Data filtering** is role-aware:
- **SGAs** see only their own name's data
- **SGMs** see their team's data
- **Recruiters** and **capital_partners** are filtered by their `externalAgency` field

### Route Protection

Three layers of defense:

1. **Middleware** (`src/middleware.ts`) — runs before page load. Protects `/dashboard/*` and `/api/*` (except `/api/auth/*` and `/api/cron/*`). Recruiters can only reach `/dashboard/recruiter-hub` and `/dashboard/settings`. Capital partners can only reach `/dashboard/gc-hub` and `/dashboard/settings`.

2. **API endpoint checks** — every user management endpoint validates `canManageUsers` permission from the session.

3. **Authorization helpers** (`src/lib/api-authz.ts`) — `forbidRecruiter()` and `forbidCapitalPartner()` return 403 on restricted API routes.

### User Model (Prisma)

Defined in `prisma/schema.prisma` (lines 12-34):

```
User
  id             String   (CUID, primary key)
  email          String   (unique, lowercase)
  name           String
  passwordHash   String?  (nullable for OAuth-only users)
  role           String   (default: "viewer")
  isActive       Boolean  (default: true)
  externalAgency String?  (for recruiter/capital_partner)
  createdAt      DateTime
  updatedAt      DateTime
  createdBy      String?  (admin who created this user)
```

Relations: dashboard requests, game scores, password reset tokens, report jobs, notifications, saved reports.

### User Management UI

Admins manage users at **Settings > User Management** (`src/app/dashboard/settings/page.tsx`). Visible only when `canManageUsers` is true (admin, revops_admin).

Components:
- `UserManagement.tsx` — user list with search, add/edit/delete/disable controls
- `UserModal.tsx` — add/edit user form (name, email, role, password, externalAgency)
- `ResetPasswordModal.tsx` — admin resets a user's password
- `ChangePasswordModal.tsx` — any user changes their own password

### User CRUD API

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/api/users` | GET | List all users (returns `SafeUser`, no password hash) | canManageUsers |
| `/api/users` | POST | Create user (email, name, role required; recruiters/capital_partners must have externalAgency) | canManageUsers |
| `/api/users/[id]` | GET | Get single user | canManageUsers |
| `/api/users/[id]` | PUT | Update user (auto-clears externalAgency when role changes away from recruiter/capital_partner) | canManageUsers |
| `/api/users/[id]` | DELETE | Delete user (prevents self-deletion) | canManageUsers |
| `/api/users/[id]/reset-password` | POST | Admin reset password (min 8 chars) | canManageUsers |
| `/api/users/me/change-password` | POST | User changes own password | Any authenticated user |
| `/api/auth/permissions` | GET | Returns current user's permissions object | Any authenticated user |

### Password Reset Flow

Two paths:

1. **Self-service** — user clicks "Forgot Password" on login page. Rate-limited. Sends a SendGrid email with a 1-hour token link. Token validated for expiration, uniqueness, prior use, and active account. Response never leaks whether email exists.

2. **Admin-initiated** — admin opens ResetPasswordModal from the user list, enters a new password directly.

### Login Redirects

After login, users land on role-appropriate pages (`src/app/login/page.tsx`, lines 55-74):
- SGA -> `/dashboard/sga-hub`
- SGM -> `/dashboard/sgm-hub`
- Recruiter -> `/dashboard/recruiter-hub`
- Everyone else -> `/dashboard` (Funnel Performance)

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/auth.ts` | NextAuth config, JWT/session callbacks, Google OAuth + credentials providers |
| `src/lib/permissions.ts` | RBAC matrix, `getPermissions()`, page access lists |
| `src/lib/users.ts` | User CRUD operations, DB queries, password validation |
| `src/lib/password-utils.ts` | bcrypt hashing, reset token generation/validation (64-char hex, 1-hour expiry) |
| `src/lib/email.ts` | SendGrid integration for password reset emails |
| `src/lib/api-authz.ts` | API-level role guards |
| `src/middleware.ts` | Route protection, role-based redirects |
| `src/types/user.ts` | UserRole, UserPermissions, SafeUser type definitions |
| `src/types/auth.ts` | ExtendedSession type |
| `src/app/api/users/route.ts` | List & create endpoints |
| `src/app/api/users/[id]/route.ts` | Get, update, delete endpoints |
| `src/app/api/users/[id]/reset-password/route.ts` | Admin password reset |
| `src/app/api/users/me/change-password/route.ts` | Self-service password change |
| `src/app/api/auth/forgot-password/route.ts` | Forgot password (sends email) |
| `src/app/api/auth/reset-password/route.ts` | Token-based password reset |
| `src/components/settings/UserManagement.tsx` | User list and management UI |
| `src/components/settings/UserModal.tsx` | Add/edit user form modal |
| `src/components/settings/ResetPasswordModal.tsx` | Admin password reset modal |
| `src/components/settings/ChangePasswordModal.tsx` | Self-service password change modal |
| `prisma/schema.prisma` | User model definition |

---

## Where to Extend: Remote MCP Server with API Key Access

### The Vision

Deploy a containerized MCP server to Cloud Run that exposes BigQuery tools and schema context over SSE. Teammates connect by adding a URL and their personal API key to their Claude Code config. No GCP credentials, no npm installs, no setup beyond one JSON block.

A teammate's entire setup:

```json
{
  "mcpServers": {
    "savvy-bq": {
      "url": "https://savvy-mcp-server-xxxxx.run.app/sse",
      "headers": {
        "Authorization": "Bearer sk-savvy-xxxxxxxx"
      }
    }
  }
}
```

Then they open Claude Code and start asking "show me all leads from last week" and it works — BQ access, schema context, query validation, everything.

### Architecture

```
Teammate's Claude Code
    |
    | SSE connection + Authorization header
    v
Cloud Run (savvy-mcp-server)
    |
    |-- Auth middleware: validate API key against user allowlist
    |-- Query guardrails: SELECT only, block DELETE/UPDATE/DROP/INSERT/CREATE/ALTER/TRUNCATE
    |-- Dataset scoping: only SavvyGTMData, Tableau_Views, savvy_analytics
    |-- Audit logging: timestamp, user email, query text, success/failure
    |-- Schema context: bundled .claude/schema-config.yaml
    |
    v
BigQuery (savvy-gtm-analytics)
    SA key: savvy-gtm-analytics-2233e5984994.json
```

### Security Requirements

1. **Read-only enforcement** — every query validated before execution. Only `SELECT` allowed. Any DDL/DML (DELETE, UPDATE, DROP, INSERT, CREATE, ALTER, TRUNCATE) is rejected at the server level, not just by convention.

2. **Per-user API keys** — each user gets a unique key generated by the admin. Keys are stored in a Cloud Storage JSON file or small BigQuery table. No shared secrets.

3. **User allowlist** — only `@savvywealth.com` emails. Admin controls who has access. Revoke = immediate (key stops working on next request).

4. **Audit logging** — every query logged with timestamp, user email, query text, and success/failure. Stored in a BQ audit table for review.

5. **Dataset scoping** — only three datasets exposed: `SavvyGTMData`, `Tableau_Views`, `savvy_analytics`. The other 13 datasets in the project are invisible.

### Admin CLI for User Management

```bash
# Add a user — generates and prints their API key
node admin.js add-user --email mike@savvywealth.com
# Output: User added: mike@savvywealth.com | API Key: sk-savvy-a8f3b2c1d4e5...

# Remove a user — key stops working immediately
node admin.js remove-user --email mike@savvywealth.com

# List all users and their status
node admin.js list-users

# Rotate a user's key
node admin.js rotate-key --email mike@savvywealth.com
```

The allowlist can live in Cloud Storage (simple JSON file) or a small BigQuery table (`savvy_analytics.mcp_users`). Cloud Storage is simpler; BQ is easier to query for audit purposes.

### How API Keys Fit With Existing User Management

The dashboard already has a user management system with RBAC. The MCP API keys are a separate auth layer for a separate system, but they should share the same source of truth about who is authorized.

Options for integration:

1. **Standalone** — `admin.js` manages its own user list. Simplest to build. Admin manages dashboard users in the Settings UI and MCP users via CLI separately.

2. **Shared allowlist** — MCP server checks the dashboard's Prisma `User` table directly. If a user exists and `isActive = true`, they can use the MCP. API keys still stored separately (new `McpApiKey` Prisma model or BQ table). Tighter coupling but single source of truth for who's authorized.

3. **Dashboard UI integration** — add an "API Keys" section to the existing Settings > User Management page. Admins can generate/revoke MCP API keys from the same place they manage dashboard accounts. Requires a new Prisma model and API routes but provides the best UX.

Recommended path: start with option 1, migrate to option 3 once the MCP server is stable.

### Phase 2: Web Query Frontend

The same Cloud Run server can also serve a web UI:

```
Cloud Run (savvy-mcp-server)
    |
    |-- /sse          -> MCP protocol (Claude Code connects here)
    |-- /              -> Web UI (browser connects here)
    |-- /api/query     -> REST endpoint for web UI queries
    |-- /api/auth      -> Login for web UI (same API key or Google OAuth)
```

Features:
- Authorized users log in, write SQL queries, see results in a table
- Export to CSV
- Query history per user
- Same read-only guardrails, same audit logging, same dataset scoping
- No additional infrastructure — just a frontend layer on the existing server

### Deployment Prompt (for Claude Code)

When ready to build, paste this into Claude Code:

```
Containerize an MCP server that exposes our BigQuery tools over SSE for
remote access. Use the SA key file savvy-gtm-analytics-2233e5984994.json
for BQ auth and bundle .claude/schema-config.yaml as built-in schema
context. Deploy to Cloud Run on savvy-gtm-analytics.

Security requirements:

- Read-only: Only SELECT queries allowed. Block any DELETE, UPDATE, DROP,
  INSERT, CREATE, ALTER, TRUNCATE. Validate every query before executing.
- User allowlist: Maintain a list of authorized users (email + API key).
  Only @savvywealth.com emails. I can add and remove users.
- Auth: Every request must include an Authorization header with a per-user
  API key. Reject unauthorized requests.
- Audit logging: Log every query with timestamp, user email, query text,
  and success/failure. Store logs in a BigQuery audit table.
- Dataset scoping: Only expose SavvyGTMData, Tableau_Views, and
  savvy_analytics datasets.
- Include an admin CLI script for managing users. Commands: add-user
  --email, remove-user --email, list-users, rotate-key --email. Store
  the allowlist in a Cloud Storage JSON file or a small BigQuery table.
  Generate unique API keys per user.
- Add an API key auth check via an Authorization header. Log all incoming
  queries.

Teammates connect by adding the Cloud Run URL and their personal API key
to their Claude MCP config.
```
