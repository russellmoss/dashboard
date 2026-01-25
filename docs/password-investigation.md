# Password & Authentication Investigation

This document describes how authentication currently works in the Savvy Funnel Analytics Dashboard, where user/password data lives, and how we could add **self-service passwords**, **forgot password**, and an **admin skeleton key**.

---

## 1. Current Authentication Overview

- **Provider**: NextAuth.js with **Credentials** (email + password). No OAuth.
- **Session**: JWT, 24-hour max age.
- **Storage**: User records (including `passwordHash`) live in **PostgreSQL (Neon)**. Connection via `DATABASE_URL`; Prisma is the ORM.
- **Login**: `/login` → `signIn('credentials', { email, password })` → NextAuth `authorize` → `validateUser` → bcrypt compare → session created.
- **Protection**: Middleware redirects unauthenticated users from `/dashboard/*` and `/api/dashboard/*` to `/login`. Other API routes (e.g. `/api/users`, `/api/admin`) use `getServerSession` internally.

---

## 2. Database: User Table (Neon / Prisma)

**Neon project**: `lingering-grass-54841964` (branch `br-dark-cell-ahwdvvob`).  
**Table**: `User` (from `prisma/schema.prisma`).

### Schema

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("viewer")   // admin | manager | sgm | sga | viewer
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String?

  savedReports SavedReport[]
  gameScores   GameScore[]
}
```

- **Login identifier**: `email` (unique). No separate username.
- **Password**: Stored as `passwordHash` (bcrypt, cost 10). Plain text is never stored.
- **Roles**: `admin`, `manager`, `sgm`, `sga`, `viewer`. `admin` / `manager` have `canManageUsers` (user CRUD, reset password).

To inspect live data: use [Neon Console](https://console.neon.tech/app/projects/lingering-grass-54841964/branches/br-dark-cell-ahwdvvob/tables) or `npx prisma studio`. (This investigation relied on the Prisma schema and codebase; no direct Neon/Postgres MCP was used.)

---

## 3. Current Auth Flow (Code)

### 3.1 NextAuth Config & Credentials

**File**: `src/lib/auth.ts`

```typescript
providers: [
  CredentialsProvider({
    name: 'Email',
    credentials: {
      email: { label: 'Email', type: 'email', placeholder: 'you@savvywealth.com' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      const user = await validateUser(credentials.email, credentials.password);
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name };
    },
  }),
],
```

- **Route**: `src/app/api/auth/[...nextauth]/route.ts` wires `authOptions` to NextAuth.

### 3.2 User Validation (Password Check)

**File**: `src/lib/users.ts`

```typescript
export async function validateUser(email: string, password: string): Promise<User | null> {
  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.isActive) return null;

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role, ... };
}
```

- Lookup by `email`, then bcrypt compare. No skeleton key or special cases yet.

### 3.3 Login Page

**File**: `src/app/login/page.tsx`

- Form: email + password, “Remember me” (UI only; JWT duration is fixed).
- Submit: `signIn('credentials', { email, password, redirect: false })` → on success, `router.push('/dashboard')`.
- **“Forgot password?”** link exists but is a no-op:

```tsx
<a href="#" onClick={(e) => { e.preventDefault(); /* TODO: Implement forgot password */ }}>
  Forgot password?
</a>
```

### 3.4 Session & Permissions

- **Session callback** (`auth.ts`): Adds `user.id` and `permissions` (from `getUserPermissions(session.user.email)`).
- **Permissions** (`src/lib/permissions.ts`): Derived from `User.role`. `admin` / `manager` → `canManageUsers: true`.

---

## 4. Password Management Today

### 4.1 User Creation (Admins)

- **Settings** → **User Management** → **Add User**.
- **API**: `POST /api/users` (admin/manager only). Body: `{ email, name, password?, role, isActive }`.
- **Logic** (`createUser` in `lib/users.ts`):  
  - If `password` omitted → default `'Savvy1234!'`.  
  - `bcrypt.hash(..., 10)` → `passwordHash` stored.

### 4.2 Admin-Only Password Reset

- **Settings** → User table → Key icon → **Reset Password** modal.
- **API**: `POST /api/users/[id]/reset-password` with `{ password }` (min 8 chars). Requires `canManageUsers`.
- **Logic** (`resetPassword` in `lib/users.ts`): `bcrypt.hash` → `prisma.user.update` on `passwordHash`.

### 4.3 Editing Users (Including Password)

- **API**: `PUT /api/users/[id]`. Admin can send `{ password }`; `updateUser` hashes and updates `passwordHash`.

### 4.4 Gaps

| Feature | Status |
|--------|--------|
| User sets own password (e.g. first login or profile) | ❌ Not implemented |
| Forgot password (email-based reset or link) | ❌ TODO on login page |
| Admin “skeleton key” to access any account | ❌ Not implemented |

---

## 5. Suggested Implementation

### 5.1 Self-Service “Create / Change My Password”

**Goal**: Users can set or change their own password (no admin required).

**Options**:

1. **“Change password” in app (logged-in users)**  
   - New page or modal, e.g. `/dashboard/settings` or a “Profile” section.  
   - Form: current password, new password, confirm.  
   - API: e.g. `POST /api/users/me/change-password` (or `PATCH /api/users/me` with password fields).  
   - Server: `getServerSession` → ensure user is changing *own* account → verify current password with `bcrypt.compare` → hash new password → update `User.passwordHash`.

2. **First-time / forced password change**  
   - Add `User.forcePasswordChange?: boolean` (or similar).  
   - After login, if `forcePasswordChange` → redirect to “Set your password” flow; disable access to dashboard until done.  
   - Useful when admins create users with a temporary password.

**Recommendation**: Implement (1) first; add (2) later if you want stricter onboarding.

---

### 5.2 Forgot Password

**Goal**: User forgets password → requests reset → receives email (login = email) with either a **reset link** or a **temporary password**.

#### Option A: Reset link (preferred)

1. **Request**: User enters email on `/login` (e.g. “Forgot password?” → form or dedicated page).  
2. **Backend**:  
   - Validate email exists in `User` and `isActive`.  
   - Generate a **one-time token** (e.g. crypto random 32 bytes, store in DB or Redis).  
   - Associate token with `user.id` and expiry (e.g. 1 hour).  
3. **Email**: Send email to `user.email` with link:  
   `https://<app>/reset-password?token=<token>`  
4. **Reset page**:  
   - `GET /reset-password?token=...`: validate token, show “New password” + “Confirm” form.  
   - `POST /api/auth/forgot-password/reset`: body `{ token, newPassword }` → verify token → update `passwordHash` → invalidate token.  
5. **Email delivery**: Use SendGrid, Resend, AWS SES, or similar. Add `EMAIL_*` env vars (API key, from address, etc.).

**Schema addition** (if stored in DB):

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}
```

#### Option B: Email temporary password

1. User requests reset (email only).  
2. Server generates random temporary password, hashes it, updates `User.passwordHash`.  
3. Email contains temporary password + “Change after first login” (optional).  
4. Simpler (no tokens, no reset page) but less secure (password in email, often weak temp passwords).

**Recommendation**: Prefer **Option A** (reset link). Option B only if you must avoid token storage and a reset page.

---

### 5.3 Admin “Skeleton Key” Password

**Goal**: A single shared admin password that, when used with *any* user’s email, logs in as that user. Admins can always get into accounts to assist users.

**Design**:

1. **Env var**: e.g. `ADMIN_SKELETON_KEY=<secret>` (long, random). Only admins should know this value.  
2. **`validateUser` change**:  
   - If `password === process.env.ADMIN_SKELETON_KEY`:  
     - Look up user by `email` (same as normal login).  
     - If user exists and `isActive`, return that user. **No role check**—skeleton key unlocks *any* account so admins can assist anyone.  
   - Else: keep existing bcrypt check.  
3. **Security**:  
   - Skeleton key must be strong, rotated periodically, and never logged or sent to client.  
   - Operationally: restrict knowledge of the key to admins/managers.  
   - Consider rate limiting or audit logging when skeleton key is used.

**Example `validateUser` change** (conceptual):

```typescript
const skeletonKey = process.env.ADMIN_SKELETON_KEY;
if (skeletonKey && password === skeletonKey) {
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.isActive) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, ... };
}
// existing bcrypt path
const isValid = await bcrypt.compare(password, user.passwordHash);
// ...
```

---

## 6. Implementation Checklist

| Item | Description |
|------|-------------|
| **Env / config** | `ADMIN_SKELETON_KEY`, `EMAIL_*` (provider, from, API key) |
| **DB** | Optional `PasswordResetToken` (or similar) for reset links |
| **Auth** | Skeleton-key branch in `validateUser`; keep bcrypt for normal logins |
| **API** | `POST /api/auth/forgot-password/request` (email), `POST /api/auth/forgot-password/reset` (token + new password) |
| **API** | `POST /api/users/me/change-password` (current + new password) for logged-in users |
| **Pages** | “Forgot password?” → request flow; `/reset-password?token=...` → set new password |
| **Settings** | “Change my password” form for authenticated users |
| **Login** | Wire “Forgot password?” to new flow |

---

## 7. Security Notes

- **Passwords**: Keep using bcrypt (cost 10); never store or log plain passwords.  
- **Reset tokens**: One-time use, short expiry, cryptographically random.  
- **Email**: Send only to the email on file; don’t reveal whether an account exists.  
- **Skeleton key**: Treat as highly privileged; restrict who knows it and which roles can use it.  
- **@savvywealth.com**: Login UI says “Only @savvywealth.com accounts”; `validateUser` does not enforce this. Add a check here if you want to restrict sign-in by domain.

---

## 8. References

- **Auth**: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`  
- **Users**: `src/lib/users.ts`, `src/lib/permissions.ts`  
- **Login**: `src/app/login/page.tsx`  
- **User CRUD**: `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/api/users/[id]/reset-password/route.ts`  
- **UI**: `src/components/settings/UserManagement.tsx`, `ResetPasswordModal.tsx`, `UserModal.tsx`  
- **DB**: `prisma/schema.prisma`, Neon project `lingering-grass-54841964`

---

## 9. Additional Investigation Findings

Answers below come from the phase-by-phase questionnaire in `password-questions.md`.

### 9.1 Email Infrastructure

**1.1 Existing email setup**

- **Email-related packages**: None in `package.json`. No `nodemailer`, `@sendgrid/mail`, `resend`, `@aws-sdk/client-ses`, or `postmark`. (`nodemailer` appears only as a transitive dependency in `package-lock.json`, not used by app code.)
- **Files named email/mail/smtp**: None.
- **Env vars**: No `EMAIL`, `SMTP`, `SENDGRID`, `RESEND`, `SES`, or `MAIL` in `.env.example` or in code. `.env.example` documents NextAuth, DB, BigQuery, Google Sheets, Anthropic, Neon Auth (optional), CRON, Sentry—but nothing for transactional email.

**1.2 If no email exists**

- No references in docs or code to Savvy Wealth’s company email infrastructure or a preferred provider for transactional email.

**1.3 Deployment environment**

- **Hosting**: **Vercel**. `vercel.json` defines cron jobs and `maxDuration` for some API routes. `@vercel/analytics`, `@vercel/postgres` in `package.json`; `.env.example` mentions Vercel URL vars and “Vercel dashboard” for production env.
- **Env management**: Local dev uses `.env` (from `.env.example`). Production: “set all values in Vercel dashboard under Settings > Environment Variables.”

**Conclusion**: No email sending exists. Forgot-password will require adding an email provider (e.g. Resend, SendGrid, SES) and `EMAIL_*`-style env vars.

---

### 9.2 Password Validation & Error Handling

**2.1 Password requirements**

- **`src/lib/users.ts`**: `createUser` and `resetPassword` do **not** validate password length or complexity. They hash whatever is passed (or use defaults).
- **`POST /api/users/[id]/reset-password`** (`src/app/api/users/[id]/reset-password/route.ts`):

```typescript
if (!password || password.length < 8) {
  return NextResponse.json(
    { error: 'Password must be at least 8 characters' },
    { status: 400 }
  );
}
```

- **`POST /api/users`** and **`PUT /api/users/[id]`**: No password validation; they forward to `createUser` / `updateUser`.
- **UI**: `UserModal` and `ResetPasswordModal` use `minLength={8}` and placeholders like “Min 8 characters”; `ResetPasswordModal` also checks `password.length < 8` before submit.

**Enforced rules**: **Minimum length 8** only (API for reset, client-side for create/edit/reset). **No** complexity rules (uppercase, numbers, special characters).

**2.2 Zod / validation libraries**

- **Zod**: Not in `package.json`. Not used.
- **User-related schemas**: None. Validation is ad hoc (length checks, `throw new Error(...)` in `lib/users`).
- **Other validation**: Semantic layer has `validateTemplateSelection` (explore feature), unrelated to auth/user flows.

**2.3 Error handling patterns**

- **Users API**: Consistent `NextResponse.json({ error: string }, { status })` for 400/401/403/404/500. Clients read `data.error` (e.g. `ResetPasswordModal`, `UserModal`).
- **Auth**: NextAuth `authorize` returns `null` on failure; login page shows a generic “Invalid email or password” and does not expose server error details.

---

### 9.3 Database & Prisma Configuration

**3.1 Prisma schema**

- **Models**: `User`, `WeeklyGoal`, `QuarterlyGoal`, `ExploreFeedback`, `GameScore`, `SavedReport`. No `Session`, `Account`, or `VerificationToken` (NextAuth uses JWT strategy).
- **Token/verification models**: None. A `PasswordResetToken` (or similar) would need to be added for reset-link flows.

**3.2 Migrations**

- **Location**: `prisma/migrations/` contains only `manual_game_score_migration.sql` (game scores).
- **Scripts**: `package.json` has `prisma generate` in `build` and `postinstall`; no `prisma migrate` scripts. Migrations are run manually (or via your deploy process).
- **Docs**: `.env.example` and `prisma/seed.js` reference `DATABASE_URL`; no documented migration workflow in the repo.

**3.3 Database connection**

- **Datasource**: Single `url = env("DATABASE_URL")` in `prisma/schema.prisma`. No `directUrl`.
- **Pooling**: `.env.example` recommends Neon **pooled** URL (e.g. `-pooler` hostname) for production. `src/lib/prisma.ts` sets `connectTimeout: 30000` in development and uses `PrismaClient` with that single URL. Connection pooling is effectively via Neon’s pooler in the URL.

---

### 9.4 UI Components & Patterns

**4.1 Settings / profile**

- **Structure**: `src/app/dashboard/settings/page.tsx` renders `UserManagement`; access restricted to `canManageUsers`. No separate “Profile” or “Account” page.
- **Settings content**: User table (name, email, role, status, created), Add User, Edit User, Reset Password (key icon), Delete User. No “Change my password” or profile editing.

**4.2 Component patterns**

- **UI library**: **Tremor** (`@tremor/react`: Card, Table, Button, Badge, etc.) and **Lucide** icons. No shadcn, Radix, Chakra, MUI.
- **Modals**: Custom overlay + form pattern. Examples: `ResetPasswordModal`, `UserModal`, `DeleteConfirmModal`, `TransferConfirmModal`—fixed overlay, form or actions, close/cancel.
- **Forms**: Standard HTML inputs with Tailwind; validation via `minLength`, `required`, and manual checks. No shared form/validation library.

**4.3 Toast / notifications**

- **Toast lib**: None. No `sonner`, `react-hot-toast`, or similar in `package.json`.
- **Feedback**: Inline error/success in components (e.g. `ResetPasswordModal`: error div, success div). Some `alert()` usage (e.g. Pipeline Catcher, export, cache clear). Dashboard fetch error handling has a comment: “You can add toast notification here.”
- **Conclusion**: No global toast system. Success/error for new auth flows can follow existing inline messages or introduce a small toast lib later.

---

### 9.5 Security Configuration

**5.1 Rate limiting**

- **Packages**: No `rate-limit`, `express-rate-limit`, or similar in `package.json`.
- **Middleware**: `src/middleware.ts` only checks JWT for `/dashboard` and `/api/dashboard`; no rate limiting.
- **Vercel**: `vercel.json` configures crons and `maxDuration` only. No rate-limit config found.
- **Conclusion**: **No rate limiting** on login, forgot-password, or reset. Recommended to add for those endpoints.

**5.2 CSRF**

- NextAuth Credentials provider is used with `signIn('credentials', ...)`. NextAuth handles CSRF for its own routes. No additional CSRF setup found for custom auth APIs.

**5.3 Logging & monitoring**

- **Auth**: `src/lib/auth.ts` uses `console.log` / `console.error` for authorize flow (missing credentials, validate user attempt, success, failure, errors). No structured logger in auth.
- **App logging**: `src/lib/logger` exists and is used elsewhere (e.g. Prisma, cache); auth does not use it.
- **Monitoring**: **Sentry** (`@sentry/nextjs`, `sentry.*.config.ts`, `SENTRY_DSN` in `.env.example`). No dedicated auth metrics or audit log.

---

### 9.6 TODOs, Feature Flags & Testing

**6.1 TODOs**

- **Forgot password**: `src/app/login/page.tsx` has “Forgot password?” with `// TODO: Implement forgot password functionality` and `onClick` no-op.
- **Other TODOs**: Semantic layer and Explore have unrelated TODOs (templates, funnel viz). No other password/auth TODOs.

**6.2 Feature flags**

- No feature-flag system. No `NEXT_PUBLIC_*` or env-based feature toggles for auth. Features are enabled by code alone.

**6.3 Testing**

- **Auth tests**: None. No `*.test.ts` / `*.spec.ts` under `src` for login, `validateUser`, or user APIs.
- **Frameworks**: `package.json` has `"test": "node test-connection.js"`; no Jest, Vitest, Playwright, or Mocha.
- **Conclusion**: **No automated tests** for auth. Manual testing only.

---

### 9.7 Investigation Summary

| Area | Finding |
|------|---------|
| **Email setup** | **Needs setup.** No email sending today. Recommend **Resend** or **SendGrid** (both work well on Vercel); add `EMAIL_*` env vars (API key, from address). |
| **Password validation** | **Min length 8** only (reset API + modals). No complexity rules. Consider adding a shared validator (e.g. Zod) and reusing it for create/reset/change-password. |
| **Token storage** | **Database recommended.** No Redis. Add `PasswordResetToken` (or similar) in Prisma for reset links; use one-time tokens with short expiry. |
| **UI** | **Tremor + Lucide**, custom modals. Reuse existing modal pattern for “Forgot password?” request, “Change my password,” and reset page. No toast lib; keep using inline success/error or add one later. |
| **Rate limiting** | **Not implemented.** Should add for login, forgot-password request, and reset (e.g. by IP or email) to reduce abuse. |
| **Testing** | **No auth tests.** Rely on manual checks today. Consider adding smoke tests for login and reset flow later. |

**Blockers or concerns**

- No email provider: forgot-password **requires** choosing and integrating one (Resend, SendGrid, SES, etc.) and configuring env.
- No rate limiting: forgot-password and reset are open to abuse until rate limits exist.
- Auth uses `console.*`; consider using `logger` and stabilizing log format for debugging and Sentry.

**Recommendations**

1. **Email**: Integrate **Resend** or **SendGrid**; add `EMAIL_API_KEY`, `EMAIL_FROM`, and optionally `EMAIL_FROM_NAME`. Use for password-reset emails only to start.
2. **Validation**: Introduce a small shared password rule (e.g. min 8, optionally complexity) and use it in create user, reset, change-password, and forgot-password reset API.
3. **Rate limiting**: Add a simple rate limiter (e.g. `@upstash/ratelimit` with Redis, or in-memory per instance) for `/api/auth/*` and login-related routes.
4. **Reset tokens**: Store in DB via new Prisma model; generate with `crypto.randomBytes(32)`; expire in 1 hour; delete on use.
5. **“Change my password”**: Add a form (Settings or dedicated section), reusing existing modal layout, and `POST /api/users/me/change-password` (current password + new + confirm).
6. **Skeleton key**: Implement as in §5.3; gate by `ADMIN_SKELETON_KEY` env var; avoid logging the key or its use in plain form.
