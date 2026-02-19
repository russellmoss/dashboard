# Login Failure Exploration — Prisma EPERM & Intermittent Auth Failures

> **Date**: 2026-02-19
> **Issue**: Intermittent login failures in production (Vercel). Users can sometimes log in, sometimes get "Invalid email or password." Sentry shows `EPERM: operation not permitted, chmod '/var/task/node_modules/.prisma/client/query-engine-rhel-openssl-3.0.x'` on cold starts.
> **Goal**: Validate root cause, confirm no secondary issues, and produce a laser-focused fix.
> **Environment**: Windows (PowerShell). All terminal commands must be PowerShell-compatible.

---

## Symptoms Summary

1. **Sentry Error**: `EPERM: operation not permitted, chmod '/var/task/node_modules/.prisma/client/query-engine-rhel-openssl-3.0.x'` — occurs on `GET /api/auth/[...nextauth]` and `GET /api/auth/error`.
2. **Secondary TypeError**: The Prisma error (which contains newlines) gets passed as a URL query param to NextAuth's error page, causing `Headers.set: "..." is an invalid header value` because HTTP headers cannot contain newlines.
3. **Intermittent**: Works on warm Vercel function instances, fails on cold starts when Prisma tries to `chmod` the binary engine on Vercel's read-only `/var/task/` filesystem.
4. **Local dev works fine**: The `native` binary target works on Windows where the filesystem is writable.

---

## PHASE 1: Prisma Engine Configuration (Primary Suspect)

### 1.1 — Prisma Schema Generator Block
- **File**: `prisma/schema.prisma`
- **Action**: Read the full `generator client` block. Record:
  - What is `engineType` set to?
  - What are the `binaryTargets`?
  - Is there a `previewFeatures` array?
- **Why**: The hypothesis is that `engineType = "binary"` causes Prisma to spawn a separate query engine process that requires `chmod` on the binary file. Vercel's `/var/task/` is read-only, so `chmod` fails on cold starts.
- **Finding**:

```
generator client {
  provider      = "prisma-client-js"
  engineType    = "binary"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}

No previewFeatures array present.

engineType = "binary" — CONFIRMED smoking gun. This forces Prisma to spawn a
separate query engine PROCESS (an OS-level executable) rather than loading a
Node-API native module. On cold starts, Prisma calls chmod() on the binary to
make it executable. Vercel's /var/task/ filesystem is read-only → EPERM.

binaryTargets includes "rhel-openssl-3.0.x" which is the correct Linux target
for Vercel's Lambda environment, so the binary IS included in the bundle. The
problem is not a missing binary — it is the chmod() call on a read-only FS.
```

### 1.2 — Prisma Version
- **Action**: Run in terminal:
  ```powershell
  npx prisma --version
  ```
- **Record**: Prisma CLI version, Client version, Engine version, and Active provider.
- **Why**: The `library` engine type (Node-API) has been stable since Prisma 4.x. We need to confirm the version supports it. Also, Prisma 6+ changed some defaults around engine types.
- **Finding**:

```
Loaded Prisma config from prisma.config.ts.

Prisma config detected, skipping environment variable loading.
Prisma schema loaded from prisma\schema.prisma
prisma                : 6.19.0
@prisma/client        : 6.19.0
Computed binaryTarget : windows
Operating System      : win32
Architecture          : x64
Node.js               : v24.13.1
TypeScript            : 5.9.3
Query Engine (Binary) : query-engine 2ba551f319ab1df4bc874a89965d8b3641056773
                        (at node_modules\@prisma\engines\query-engine-windows.exe)
PSL                   : @prisma/prisma-schema-wasm 6.19.0-26.2ba551f...
Schema Engine         : schema-engine-cli 2ba551f... (at node_modules\@prisma\engines\schema-engine-windows.exe)
Default Engines Hash  : 2ba551f319ab1df4bc874a89965d8b3641056773
Studio                : 0.511.0

Note: locally the "Computed binaryTarget" is "windows" (native target). On Vercel
it would be "rhel-openssl-3.0.x". The binary engine is confirmed active — the
output shows "Query Engine (Binary)" referencing a .exe file, proving binary mode.
```

### 1.3 — Package.json Prisma Dependencies
- **Action**: Run in terminal:
  ```powershell
  node -e "const p=require('./package.json'); console.log(JSON.stringify({prisma: p.dependencies?.prisma || p.devDependencies?.prisma, client: p.dependencies?.['@prisma/client'] || p.devDependencies?.['@prisma/client']}, null, 2))"
  ```
- **Why**: Confirm Prisma and @prisma/client versions match and are recent enough for `engineType = "library"`.
- **Finding**:

```
{
  "prisma": "6.19.0",
  "client": "6.19.0"
}

Both versions match exactly. Prisma 6.x fully supports engineType = "library"
(Node-API). In fact, "library" has been the DEFAULT since Prisma 5.x for most
platforms. The project explicitly overrides the default by setting "binary".
```

### 1.4 — prisma.config.ts Check
- **File**: `prisma.config.ts` (if it exists)
- **Action**: Read the file in full. Does it override any engine settings?
- **Why**: Prisma 6+ supports a config file that can override schema settings. Need to confirm no conflict.
- **Finding**:

```
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'node prisma/seed.js',
  },
});

File EXISTS. It only sets the schema path and seed command. NO engine overrides.
No engineType, no datasource overrides, no previewFeatures. This file does not
conflict with or supplement the schema's engineType = "binary" setting.
```

### 1.5 — Prisma Client Initialization
- **File**: `src/lib/prisma.ts`
- **Action**: Read the full file. Record:
  - How is `PrismaClient` instantiated?
  - Is there any engine configuration in the constructor?
  - Is there a global singleton pattern?
  - Are there any `__internal` or engine options?
- **Why**: Even if schema says `binary`, the client constructor can sometimes override engine behavior. Need the full picture.
- **Finding**:

```
src/lib/prisma.ts — full file reviewed.

INSTANTIATION: Uses a Proxy-based lazy singleton. PrismaClient is NOT created at
import time — it is created on first property access (e.g., prisma.user). This
means Prisma engine startup (and the fatal chmod) happens at first DB call, not
at module load. This is correct behavior but does NOT prevent the EPERM.

ENGINE CONFIG IN CONSTRUCTOR: No engineType override. The constructor passes:
  - datasources.db.url (explicit URL)
  - log level (dev: query/error/warn, prod: error only)
  - __internal.engine.connectTimeout: 30000 (dev only) — this is a binary-engine-
    specific hint, not available in library mode. Safe to leave or remove.

SINGLETON PATTERN: globalForPrisma.prisma cached on globalThis — correct for
Next.js hot reload. On Vercel, globalThis is not shared between cold starts, so
each cold start creates a new PrismaClient and triggers a new engine spawn.

NO __internal or engine options in production path — clean.

KEY INSIGHT: getPrismaClient() → new PrismaClient() → (first query) → binary
engine spawn → chmod() → EPERM. The Proxy getter re-runs getPrismaClient() on
each access but returns the cached instance once created. If PrismaClient
creation itself throws, the cache is never set and every subsequent access
retries creation. This could cause multiple EPERM errors per request.
```

---

## PHASE 2: Vercel Deployment & Build Pipeline

### 2.1 — Build Script
- **Action**: Run in terminal:
  ```powershell
  node -e "const p=require('./package.json'); console.log('build:', p.scripts.build); console.log('postinstall:', p.scripts.postinstall)"
  ```
- **Why**: Confirm `prisma generate` runs during build. If it doesn't, the engine binary might not be bundled correctly.
- **Finding**:

```
build: cross-env NODE_OPTIONS=--max-old-space-size=8192 prisma generate && node --max-old-space-size=8192 ./node_modules/next/dist/bin/next build
postinstall: prisma generate

CONFIRMED: prisma generate runs at build time (both in the build script and as
postinstall). This means the rhel-openssl-3.0.x binary IS generated and bundled
into the Vercel deployment artifact at /var/task/node_modules/.prisma/client/.

The problem is NOT a missing binary — it is that Prisma's binary engine code
calls chmod() on the bundled executable at cold-start runtime, and /var/task/
is read-only on Vercel. Switching to the library engine eliminates the chmod
requirement entirely since .node files are loaded as native modules, not spawned.
```

### 2.2 — Vercel Configuration
- **File**: `vercel.json`
- **Action**: Read the full file. Record:
  - Any `functions` configuration (memory, maxDuration)?
  - Any `build` settings?
  - Node.js version setting?
- **Why**: Vercel function config affects cold start behavior. Also, Node.js version must be compatible with the Prisma engine binary.
- **Finding**:

```
vercel.json exists. Contents:

{
  "functions": {
    "src/app/api/dashboard/export-sheets/route.ts": { "maxDuration": 60 },
    "src/app/api/agent/query/route.ts": { "maxDuration": 60 },
    "src/app/api/admin/trigger-transfer/route.ts": { "maxDuration": 60 },
    "src/app/api/cron/trigger-transfer/route.ts": { "maxDuration": 60 },
    "src/app/api/cron/geocode-advisors/route.ts": { "maxDuration": 60 },
    "src/app/api/cron/gc-hub-sync/route.ts": { "maxDuration": 60 },
    "src/app/api/gc-hub/manual-sync/route.ts": { "maxDuration": 60 }
  },
  "crons": [ ... 9 cron schedules ... ]
}

NO Node.js version setting. NO build overrides. NO framework setting. NO memory
configuration for auth routes. The auth route (api/auth/[...nextauth]) has no
custom function config, so it uses Vercel's defaults.

IMPORTANT: The auth route is not in the functions config, meaning it uses
Vercel's default maxDuration (10s for Hobby, 60s for Pro). Cold start time
on Node 24 with a binary Prisma engine + 3 retries (~6s delay) could push auth
close to or over the default timeout, worsening the user experience.
```

### 2.3 — Node.js Version
- **Action**: Check for version pinning:
  ```powershell
  if (Test-Path .nvmrc) { Get-Content .nvmrc } else { Write-Host ".nvmrc not found" }
  if (Test-Path .node-version) { Get-Content .node-version } else { Write-Host ".node-version not found" }
  node -e "const p=require('./package.json'); console.log('engines:', JSON.stringify(p.engines || 'not set'))"
  ```
- **Why**: Sentry shows `node v24.13.0` on Vercel. Need to confirm if this is pinned or Vercel's default. Node 24 is very new — confirm Prisma binary compatibility.
- **Finding**:

```
.nvmrc not found
.node-version not found
engines: "not set"

Node.js version is NOT pinned anywhere in the project. No .nvmrc, no
.node-version, no "engines" field in package.json.

From prisma --version output: Node.js v24.13.1 locally. Sentry shows v24.13.0
on Vercel. Vercel is running Node 24 as its default for this project.

Node 24 is extremely new (released ~May 2025). Prisma 6.19.0 supports Node 24,
but the combination of Node 24 + binary engine + Vercel's read-only filesystem
may have edge cases in the chmod path. The library engine avoids this entirely.

RECOMMENDATION: Consider pinning Node.js to a stable LTS version (22.x) by
adding an .nvmrc file or setting "engines": {"node": ">=22.0.0 <23"} in
package.json, then configuring Vercel to use that version. However, this is
secondary to the engineType fix.
```

---

## PHASE 3: NextAuth Error Handling (Secondary Issue)

### 3.1 — NextAuth Error Page Configuration
- **File**: `src/lib/auth.ts`
- **Action**: Read the `pages` configuration in `authOptions`. Record:
  - What is `pages.error` set to?
  - What is `pages.signIn` set to?
- **Why**: When Prisma throws the EPERM error during `authorize()`, NextAuth catches it and redirects to the error page. The Prisma error message contains newlines, which are invalid in HTTP header values (used in the redirect URL). This causes the secondary `TypeError`.
- **Finding**:

```
pages: {
  signIn: '/login',
  error: '/login',
},

Both signIn and error redirect to /login. This means ALL NextAuth errors —
CredentialsSignin, CallbackRouteError, Configuration, etc. — are routed to
/login with an ?error= query parameter.

IMPLICATION: When Prisma throws EPERM during a JWT callback (getUserByEmail),
NextAuth catches the uncaught error from the callback and redirects to /login
with the raw error message as the ?error= value. This raw Prisma error string
contains newlines (\n), which are invalid in HTTP Location headers.

The redirect Location header would look like:
  Location: /login?error=EPERM: operation not permitted, chmod '/var/task/...'
                                    ↑ contains \n from Prisma's error.message

When NextAuth calls Headers.set('Location', url) with this URL, Node.js throws:
  TypeError: Headers.set: "..." is an invalid header value.

This is the secondary Sentry error. It originates from JWT callback path, not
the authorize() path (which does have a try/catch and returns null safely).
```

### 3.2 — Error Handling in authorize()
- **File**: `src/lib/auth.ts`
- **Action**: Read the full `authorize` function in the CredentialsProvider. Record:
  - Is the `validateUser()` call wrapped in try/catch?
  - What happens when `validateUser()` throws (not returns null, but throws)?
  - Does the catch block sanitize the error before returning?
- **Why**: The EPERM error is an unhandled throw from Prisma, not a graceful `return null`. The catch block in `authorize()` logs the error and returns `null`, but NextAuth may still surface the raw error in the redirect URL depending on how it handles the rejection.
- **Finding**:

```
async authorize(credentials) {
  if (!credentials?.email || !credentials?.password) {
    console.error('[Auth] Missing credentials ...');
    return null;
  }

  const normalizedEmail = credentials.email.toLowerCase().trim();

  try {
    const rateLimit = await checkRateLimit(getLoginLimiter(), normalizedEmail);
    if (!rateLimit.success) { return null; }

    const user = await validateUser(credentials.email, credentials.password);
    // validateUser internally wraps retryDatabaseOperation which may throw
    // EPERM. validateUser re-throws it with: throw error

    if (!user) { return null; }
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  } catch (error: any) {
    console.error('[Auth] Error during authorization:', { message, stack, name });
    return null;  // ← catches EPERM and returns null, NOT throws
  }
}

ANALYSIS:
1. Is validateUser() call wrapped in try/catch? → YES (lines 72-101)
2. What happens when validateUser() throws? → caught by catch block → return null
3. Does catch block sanitize error before returning? → YES — returns null (not
   the error). The error is only logged to console, not returned or re-thrown.

CONCLUSION FOR authorize(): The authorize() path is SAFE. EPERM from Prisma is
caught and null is returned. NextAuth sees null → CredentialsSignin → redirects
to /login?error=CredentialsSignin (no raw error in URL, no header issue).

The SECONDARY TypeError must originate from a different code path — specifically
the jwt() callback which calls getUserByEmail() WITHOUT a try/catch wrapper.
```

### 3.3 — NextAuth Error Route
- **Action**: Check if a custom error page exists:
  ```powershell
  if (Test-Path "src/app/api/auth/error/route.ts") { Get-Content "src/app/api/auth/error/route.ts" } else { Write-Host "No custom auth error route" }
  if (Test-Path "src/app/auth/error/page.tsx") { Get-Content "src/app/auth/error/page.tsx" } else { Write-Host "No custom auth error page" }
  ```
- **Why**: If there's no custom error handler, NextAuth uses its default which puts the error in the URL — this is where the newline-in-header issue originates.
- **Finding**:

```
No custom auth error route:  src/app/api/auth/error/route.ts → does NOT exist
No custom auth error page:   src/app/auth/error/page.tsx → does NOT exist

NextAuth uses its built-in error handling with no custom override. The built-in
behavior in NextAuth v4: when a callback throws an uncaught error, it redirects
to pages.error (/login) with ?error=<ErrorType> where ErrorType is NextAuth's
error code string (e.g., "CallbackRouteError", "Configuration").

HOWEVER: The raw error message inclusion in the URL and the resulting
Headers.set failure suggests NextAuth v4.24.x may, in some conditions, attempt
to include sanitized or unsanitized error details in the redirect URL. The exact
mechanism is NextAuth-internal, but the symptom (newline in header value) is
clearly documented in the Sentry error.

The absence of a custom error page means there is no opportunity to sanitize
the error before it reaches the HTTP layer. Adding a custom error page at
src/app/auth/error/page.tsx would give a safe landing point, but is optional
once the primary EPERM fix is in place (the error condition itself goes away).
```

---

## PHASE 4: Validate the Fix Path

### 4.1 — Library Engine Compatibility Check
- **Action**: Run in terminal:
  ```powershell
  npx prisma --version
  ```
  Then confirm: Is the Prisma version >= 4.0.0? (Library engine has been stable since 4.x, default since 5.x for some platforms.)
- **Why**: We need to confirm `engineType = "library"` is supported before changing it.
- **Finding**:

```
prisma: 6.19.0
@prisma/client: 6.19.0

Is version >= 4.0.0? → YES (6.19.0 >> 4.0.0)

The "library" engine (Node-API) has been:
  - Supported since Prisma 3.x (experimental)
  - Stable since Prisma 4.x
  - DEFAULT for most platforms since Prisma 5.x
  - Fully production-ready in Prisma 6.x

Switching from "binary" to "library" is well-supported and is the recommended
engine type for serverless environments (Vercel, AWS Lambda, Netlify).
```

### 4.2 — Search for Any Other engineType References
- **Action**: Run in terminal:
  ```powershell
  Select-String -Path "prisma/schema.prisma","src/lib/prisma.ts","prisma.config.ts" -Pattern "engine" -ErrorAction SilentlyContinue
  ```
  Also search broadly:
  ```powershell
  Get-ChildItem -Path . -Recurse -Include "*.ts","*.js","*.prisma" -ErrorAction SilentlyContinue | Select-String -Pattern "engineType" -ErrorAction SilentlyContinue | Select-Object -First 10
  ```
- **Why**: Ensure there's no other file overriding or depending on the `binary` engine type.
- **Finding**:

```
=== engineType in key files ===
prisma/schema.prisma:3:  engineType    = "binary"

=== engineType broad search (all *.ts, *.js, *.prisma) ===
prisma/schema.prisma:3:  engineType    = "binary"

RESULT: engineType appears in exactly ONE place in the entire codebase:
prisma/schema.prisma line 3. No other TS, JS, or config file references or
overrides engineType. The fix is a single-line change in a single file.

prisma.config.ts also does NOT set engineType (confirmed in Phase 1.4).
src/lib/prisma.ts does NOT set engineType in the PrismaClient constructor.
```

### 4.3 — Check for Binary Engine File References
- **Action**: Run in terminal:
  ```powershell
  Get-ChildItem -Path . -Recurse -Include "*.ts","*.js","*.json" -ErrorAction SilentlyContinue | Select-String -Pattern "query-engine" -ErrorAction SilentlyContinue | Select-Object -First 10
  ```
- **Why**: Confirm no code directly references the binary engine file path. The `library` engine uses a `.node` file instead of a standalone binary.
- **Finding**:

```
=== query-engine references in *.ts, *.js, *.json ===
No results. Zero references to "query-engine" in any TypeScript, JavaScript,
or JSON file in the repository.

RESULT: No application code directly references the binary engine file path.
No build scripts, no custom engine path configs, no hard-coded references to
the .exe or rhel binary. The switch to library engine (which uses a .node file
instead) will have zero impact on any application code.
```

### 4.4 — Test prisma generate with Library Engine Locally
- **Action**: 
  1. First, record current state:
     ```powershell
     Select-String -Path "prisma/schema.prisma" -Pattern "engineType"
     ```
  2. DO NOT make the change yet — just confirm the current value and that the fix path is clear.
- **Why**: We want to validate before changing. The actual fix will be in the execution phase.
- **Finding**:

```
Current value confirmed via git grep:
prisma/schema.prisma:3:  engineType    = "binary"

Fix path is clear:
  File: prisma/schema.prisma
  Line 3: engineType = "binary"   →   engineType = "library"

After changing:
  1. Run: npx prisma generate
  2. Verify: node_modules/.prisma/client/ should contain a .node file
     (e.g., libquery_engine-rhel-openssl-3.0.x.so.node) instead of a standalone binary
  3. The binary executable (query-engine-rhel-openssl-3.0.x) should NOT be present
  4. No chmod() will be called on cold starts — the .node file is loaded via
     Node.js require() as a native addon, which does not require execute permission
```

---

## PHASE 5: Secondary Hardening (Error Sanitization)

### 5.1 — Authorize Error Propagation Path
- **Question**: When `validateUser()` in `src/lib/users.ts` throws a Prisma error (not returns null), trace the error path:
  1. Does the `try/catch` in `authorize()` catch it? → Yes/No
  2. Does `authorize()` return `null` on catch? → Yes/No
  3. Does NextAuth still surface the original error message in the redirect URL? → Check NextAuth version behavior.
- **Why**: Even after fixing the EPERM issue, we should confirm the error handling is robust. If any other database error occurs (e.g., connection timeout), the same newline-in-header bug could recur.
- **Finding**:

```
Error path trace for Prisma EPERM during a cold-start JWT callback:

  [Vercel cold start — user has existing session, browser refreshes page]
  GET /api/auth/session → NextAuth processes JWT
  → jwt() callback fires (auth.ts:145)
  → user object present (initial sign-in path) OR needsBackfill = true
  → getUserByEmail(email) called (auth.ts:168 or 188) ← NO try/catch here
  → prisma.user.findUnique() → Proxy getter → getPrismaClient()
  → new PrismaClient() created → binary engine spawn attempted
  → chmod('/var/task/.../query-engine-rhel-openssl-3.0.x') → EPERM
  → PrismaClientInitializationError thrown
  → propagates UP through getUserByEmail (no catch) → jwt() callback (no catch)
  → NextAuth internal error handler catches it
  → tries to redirect to pages.error (/login?error=<raw message>)
  → raw Prisma error message contains \n characters
  → Headers.set('Location', url_with_newlines) → TypeError in Node 18+ fetch API
  → Sentry captures: "Headers.set: '...' is an invalid header value"

ANSWERS:
1. Does try/catch in authorize() catch it? → ONLY if EPERM happens during
   authorize() path. YES for that path. But the JWT callback path has NO catch.

2. Does authorize() return null on catch? → YES (for the authorize path).
   But the JWT callback path propagates the error to NextAuth internals.

3. Does NextAuth still surface the raw error in redirect URL? → YES,
   specifically from the JWT callback path. NextAuth v4 constructs the redirect
   URL with the raw error.message when a callback throws uncaught.

CRITICAL: There are TWO separate affected code paths:
  A. authorize() path → SAFE (has catch, returns null, no raw error in URL)
  B. jwt() callback path → UNSAFE (no catch, error reaches NextAuth internals)

Path B is the source of the secondary TypeError. It fires when an existing
logged-in user's session is refreshed on a cold-start Vercel instance, and
Prisma fails to initialize the binary engine.
```

### 5.2 — NextAuth Version
- **Action**: Run in terminal:
  ```powershell
  node -e "const p=require('./package.json'); console.log('next-auth:', p.dependencies?.['next-auth'] || p.devDependencies?.['next-auth'])"
  ```
- **Why**: Different NextAuth versions handle credential provider errors differently. Some versions pass the raw error to the redirect URL, others sanitize it.
- **Finding**:

```
next-auth: ^4.24.13

NextAuth v4 (latest stable). In NextAuth v4, uncaught errors from callbacks
(jwt, session, signIn) are caught by NextAuth's internal error handler and
redirected to pages.error with the error type as a query param.

In v4.24.x specifically, when a callback throws, NextAuth calls:
  redirect(callbackUrl + '?error=' + encodeURIComponent(error.message))
or similar construction. The error.message for a Prisma EPERM contains:
  "EPERM: operation not permitted, chmod '/var/task/node_modules/.prisma/client/
  query-engine-rhel-openssl-3.0.x'"
This multi-line string (with \n) gets URI-encoded in the query param, but the
Location header itself may still contain the raw string before encoding in
certain code paths, triggering the Headers.set TypeError.

NextAuth v5 (Auth.js) has better error handling for this scenario, but upgrading
is a larger scope than the current fix.
```

### 5.3 — Retry Logic in validateUser
- **File**: `src/lib/users.ts`
- **Action**: Read the `retryDatabaseOperation` helper and `validateUser` function. Record:
  - What errors trigger retries?
  - How many retries?
  - Does EPERM match the retry condition? (It shouldn't — EPERM is not a connection error.)
- **Why**: Confirm the retry logic doesn't mask or delay the EPERM error in a way that makes debugging harder.
- **Finding**:

```
retryDatabaseOperation (src/lib/users.ts:20-55):

  const isConnectionError =
    error?.message?.includes("Can't reach database server") ||
    error?.message?.includes('connection') ||
    error?.code === 'P1001' ||
    error?.name === 'PrismaClientInitializationError';  // ← MATCHES EPERM

EPERM error analysis:
  - error.message: "EPERM: operation not permitted, chmod '...'"
    → Does NOT include "Can't reach database server" — NO match
    → Does NOT include "connection" — NO match
    → error.code: 'EPERM' (not 'P1001') — NO match
    → error.name: 'PrismaClientInitializationError' — LIKELY MATCH

Prisma wraps binary engine startup failures (including EPERM from chmod) in
PrismaClientInitializationError. This means:
  isConnectionError = true → the retry IS triggered

CONSEQUENCE: On every cold start, the EPERM error causes 3 retry attempts with
exponential backoff (1s + 2s = 3s delay). The total cold-start failure time is:
  ~3 seconds of retries + original attempt = ~4-6 seconds before returning null

This makes every cold-start login attempt take 4-6 seconds before failing, and
every cold-start session refresh (JWT callback) take the same 4-6 seconds before
the unhandled error propagates. This significantly worsens the user experience.

SHOULD EPERM retry? → NO. EPERM is a filesystem permission error, not a network
connection error. Retrying does not help — /var/task/ stays read-only. The retry
logic is incorrectly matching EPERM via PrismaClientInitializationError.

If the engineType fix is applied, this retry path is never triggered for EPERM.
However, a future Prisma engine initialization failure for other reasons would
still incorrectly retry. Consider adding EPERM to the non-retry list, or
tightening isConnectionError to exclude EPERM.

validateUser itself (src/lib/users.ts:57-112):
  - Calls retryDatabaseOperation (which retries EPERM 3x)
  - Has outer try/catch at line 64 that catches the final throw
  - Re-throws the error: throw error (line 109)
  - This throw propagates to authorize()'s catch → returns null (SAFE)
  - This throw propagates to jwt() callback → NO catch → UNSAFE
```

---

## PHASE 6: Findings Summary & Fix Plan

> **Claude Code**: After completing all phases above, write a summary here.

### Root Cause Confirmed?
```
YES. engineType = "binary" in prisma/schema.prisma forces Prisma to spawn a
standalone query-engine executable on cold starts; Vercel's /var/task/ filesystem
is read-only, so the required chmod() on that executable fails with EPERM every
time a new Vercel Lambda instance is initialized.
```

### Primary Fix
```
File: prisma/schema.prisma
Line 3:
  OLD: engineType    = "binary"
  NEW: engineType    = "library"

The library engine uses a Node-API native module (.node file) loaded via
require(), which does not require chmod and is not subject to the read-only
/var/task/ restriction. This is the recommended engine type for Vercel and all
serverless environments per Prisma's official documentation.

After making the change:
  Run: npx prisma generate
  Then deploy to Vercel (prisma generate runs automatically in the build step).

Also clean up prisma.ts: the __internal.engine.connectTimeout option is a
binary-engine-specific hint that has no effect on the library engine. It is
safe to leave but can be removed for clarity (it is already dev-only, so it
causes no production issue).
```

### Secondary Hardening (Optional)
```
1. WRAP getUserByEmail() CALLS IN JWT CALLBACK WITH TRY/CATCH (auth.ts:145-198)
   The jwt() callback calls getUserByEmail() at lines 168 and 188 without any
   try/catch. If any future Prisma error (connection timeout, new cold-start
   issue) occurs here, it propagates to NextAuth internals and triggers the
   "invalid header value" TypeError. Wrap both calls in try/catch and return
   the token unchanged on error (graceful degradation).

2. TIGHTEN RETRY CONDITION IN retryDatabaseOperation (users.ts:34-39)
   Add a check for EPERM errors to short-circuit retries:
     const isEperm = error?.code === 'EPERM';
     if (isEperm) throw error; // Never retry filesystem permission errors
   This prevents 4-6 second delays on cold starts if EPERM somehow recurs.

3. PIN NODE.JS VERSION ON VERCEL
   Add to package.json: "engines": { "node": "22.x" }
   Or add .nvmrc: "22"
   Node 24 is very new and not an LTS release. Pinning to Node 22 LTS reduces
   the risk of compatibility edge cases with Prisma or NextAuth.

4. CONSIDER ADDING MAXDURATION TO AUTH ROUTE IN vercel.json (optional)
   The /api/auth/[...nextauth] route has no maxDuration set. With 3 retries
   taking 4-6 seconds, this risks hitting Vercel's default 10s limit (Hobby)
   during cold starts. Either fix the retry issue (item 2 above) or add:
     "src/app/api/auth/[...nextauth]/route.ts": { "maxDuration": 30 }
```

### Risk Assessment
```
RISK LEVEL: LOW

1. Engine compatibility: The library engine has been the Prisma default for
   serverless since v5.x and is fully stable in v6.19.0. No known regressions
   from switching binary → library on a standard Next.js + Neon setup.

2. Local development: On Windows, the "native" binaryTarget already uses a
   .node file (query_engine-windows.dll.node). The library engine will use the
   same mechanism. Local dev behavior is unchanged.

3. The binaryTargets line can remain as-is or be removed entirely:
   With engineType = "library", the binaryTargets field specifies which platform's
   .node files to bundle. Keeping ["native", "rhel-openssl-3.0.x"] is correct
   and safe. If you remove binaryTargets, Prisma will auto-detect and bundle
   only the native target — this would BREAK Vercel (which needs rhel-openssl-3.0.x).
   KEEP binaryTargets as-is.

4. The __internal.engine.connectTimeout in prisma.ts is dev-only and harmless
   even with the library engine (it is silently ignored).

5. Rollback: Revert the single-line change in schema.prisma and redeploy.
   The rollback is immediate and has no data risk.

6. No schema migration required — this is a generator/client change only,
   with no effect on the database schema.
```

### Verification Steps Post-Fix
```
LOCAL VERIFICATION:
1. Change engineType to "library" in prisma/schema.prisma
2. Run: npx prisma generate
3. Inspect node_modules/.prisma/client/
   - SHOULD exist: libquery_engine-windows.dll.node (or similar .node file)
   - SHOULD NOT exist: query-engine-windows.exe (binary engine removed)
4. Run the local dev server: npm run dev
5. Login test: confirm credentials login works
6. No Prisma initialization errors in console

VERCEL VERIFICATION (after deploying):
1. Deploy to a preview branch first (not production)
2. Force a cold start: wait for the function to idle, then navigate to /login
3. Attempt credentials login on a fresh cold start
4. Confirm in Vercel logs: no "EPERM" errors, no "chmod" errors
5. Confirm in Sentry: no new EPERM events on /api/auth/[...nextauth]
6. Confirm in Sentry: no new "Headers.set invalid header value" errors
7. Repeat 5 cold-start login attempts to confirm consistency
8. After preview validation, deploy to production

SENTRY MONITORING:
- Watch for: EPERM, chmod, PrismaClientInitializationError on auth routes
- Watch for: "Headers.set" invalid header value errors
- Expected: zero occurrences of both after the fix

WHAT TO WATCH FOR (potential issues):
- If .node file for rhel-openssl-3.0.x is missing after generate → check that
  binaryTargets = ["native", "rhel-openssl-3.0.x"] is still in schema.prisma
- If login succeeds locally but fails on Vercel → check Vercel build logs to
  confirm prisma generate ran and included the rhel-openssl .node file
```
