# Login Fix Implementation — Prisma EPERM & Auth Hardening

> **Date**: 2026-02-19
> **Exploration Doc**: `login_exploration.md` (completed — all findings validated)
> **Root Cause**: `engineType = "binary"` in `prisma/schema.prisma` causes `chmod()` failures on Vercel's read-only `/var/task/` filesystem during cold starts, breaking auth intermittently.
> **Environment**: Windows (PowerShell). All terminal commands must be PowerShell-compatible.

---

## FIX OVERVIEW

| # | Fix | File | Risk | Priority |
|---|-----|------|------|----------|
| 1 | `engineType = "binary"` → `"library"` | `prisma/schema.prisma` | Low | **Critical** |
| 2 | Wrap `getUserByEmail()` calls in jwt() callback with try/catch | `src/lib/auth.ts` | Low | High |
| 3 | Exclude EPERM from retry logic | `src/lib/users.ts` | Low | High |
| 4 | Pin Node.js to 22.x LTS | `.nvmrc` + `package.json` | Low | Medium |
| 5 | Add `maxDuration` to auth route | `vercel.json` | Low | Medium |

**Total files modified**: 5
**No database migration required** — all changes are application-level.

---

## PHASE 1: Primary Fix — Prisma Engine Type

### 1.1 — Change engineType in schema.prisma

- **File**: `prisma/schema.prisma`
- **Action**: Change line 3 from `"binary"` to `"library"`
- **IMPORTANT**: Do NOT change `binaryTargets` — keep it exactly as-is. The `binaryTargets` array is reused by the library engine to determine which platform `.node` files to bundle. Removing `"rhel-openssl-3.0.x"` would break Vercel.

**EXACT change — replace this:**
```prisma
generator client {
  provider      = "prisma-client-js"
  engineType    = "binary"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}
```

**With this:**
```prisma
generator client {
  provider      = "prisma-client-js"
  engineType    = "library"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}
```

### 1.2 — Regenerate Prisma Client

- **Action**: Run in terminal:
  ```powershell
  npx prisma generate
  ```

### 1.3 — Verify Generation

- **Action**: Run in terminal:
  ```powershell
  # Confirm .node file exists (library engine artifact)
  Get-ChildItem "node_modules/.prisma/client" -Filter "*.node" | Select-Object Name, Length
  
  # Confirm standalone binary executable is NOT present
  Get-ChildItem "node_modules/.prisma/client" -Filter "query-engine-*" -ErrorAction SilentlyContinue | Select-Object Name, Length
  ```
- **Expected**:
  - `.node` file(s) present (e.g., `libquery_engine-windows.dll.node` and/or `libquery_engine-rhel-openssl-3.0.x.so.node`)
  - No `query-engine-rhel-openssl-3.0.x` standalone binary (the binary engine executable should be gone)
  - Note: On Windows, you may still see a Windows-specific `.node` file — that's the `"native"` target and is correct.
- **If verification fails**: STOP. Do not proceed. The `binaryTargets` line may have been accidentally modified. Re-read `prisma/schema.prisma` and confirm `binaryTargets = ["native", "rhel-openssl-3.0.x"]` is present.

**Record verification results here:**
```
Initial generate output showed stale binary artifacts from the previous
"binary" engineType. Cleaned up stale files, then verified clean state:

=== .node files (library engine artifacts) ===
  libquery_engine-rhel-openssl-3.0.x.so.node (16.7 MB)  ← Vercel/Linux target ✓
  query_engine-windows.dll.node (20.2 MB)               ← Windows/native target ✓

=== query-engine-* standalone binaries ===
  (none — correct)  ← No binary executables present ✓

PASS: Library engine artifacts confirmed. Both platforms present:
  - rhel-openssl-3.0.x.so.node → deployed to Vercel (no chmod needed)
  - windows.dll.node → used in local dev (native target)
No standalone binary executables remain.
```

### 1.4 — Quick Local Smoke Test

- **Action**: Run in terminal:
  ```powershell
  npx prisma validate
  ```
- **Expected**: `The schema at prisma/schema.prisma is valid.` (or similar success message)
- **Record**:
```
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid 🚀

(Note: also showed an advisory that Prisma 7.4.1 is available — not actioned,
out of scope for this fix.)

PASS
```

---

## PHASE 2: JWT Callback Hardening

### 2.1 — Add try/catch to getUserByEmail calls in jwt() callback

- **File**: `src/lib/auth.ts`
- **Action**: Read the full file FIRST. Then locate the `jwt({ token, user })` callback. There are two places where `getUserByEmail()` is called without a try/catch:
  1. **Credentials sign-in path** (~line 168): `const dbUser = await getUserByEmail(user.email.toLowerCase());`
  2. **Backfill path** (~line 188): `const dbUser = await getUserByEmail(email);`

Both calls must be wrapped in try/catch so that any future Prisma error (connection timeout, cold-start issue, etc.) does not propagate to NextAuth internals and trigger the "invalid header value" TypeError.

**IMPORTANT**: Read the file before editing. The line numbers below are approximate from the exploration — verify exact locations.

**For the credentials sign-in path inside `if (user)` block**, find this code:

```typescript
          // For credentials, we need to get externalAgency from DB
          // This only happens once at sign-in, not on every request
          const dbUser = await getUserByEmail(user.email.toLowerCase());
          if (dbUser) {
            token.externalAgency = dbUser.externalAgency ?? null;
            // Ensure we have the latest data
            token.id = dbUser.id;
            token.name = dbUser.name;
            token.role = dbUser.role;
          }
```

**Replace with:**

```typescript
          // For credentials, we need to get externalAgency from DB
          // This only happens once at sign-in, not on every request
          try {
            const dbUser = await getUserByEmail(user.email.toLowerCase());
            if (dbUser) {
              token.externalAgency = dbUser.externalAgency ?? null;
              // Ensure we have the latest data
              token.id = dbUser.id;
              token.name = dbUser.name;
              token.role = dbUser.role;
            }
          } catch (error) {
            console.error('[Auth] jwt callback: failed to fetch user for credentials sign-in, continuing with token data:', error);
          }
```

**For the backfill path**, find this code:

```typescript
      if (needsBackfill) {
        const dbUser = await getUserByEmail(email);
        if (dbUser) {
          token.id = token.id ?? dbUser.id;
          token.name = token.name ?? dbUser.name;
          token.role = token.role ?? dbUser.role;
          token.externalAgency = token.externalAgency ?? dbUser.externalAgency ?? null;
        }
      }
```

**Replace with:**

```typescript
      if (needsBackfill) {
        try {
          const dbUser = await getUserByEmail(email);
          if (dbUser) {
            token.id = token.id ?? dbUser.id;
            token.name = token.name ?? dbUser.name;
            token.role = token.role ?? dbUser.role;
            token.externalAgency = token.externalAgency ?? dbUser.externalAgency ?? null;
          }
        } catch (error) {
          console.error('[Auth] jwt callback: failed to backfill user data, continuing with existing token:', error);
        }
      }
```

**Logic**: On error, the jwt callback returns the token unchanged. The user keeps their existing session data (which may be stale), but the request does not fail. This is graceful degradation — a stale session is far better than a crashed auth flow.

### 2.2 — Verify auth.ts Changes

- **Action**: Run in terminal:
  ```powershell
  npx tsc --noEmit --pretty 2>&1 | Select-String -Pattern "auth.ts" -ErrorAction SilentlyContinue
  ```
- **Expected**: No TypeScript errors in `auth.ts`.
- **If errors appear**: Fix them before proceeding. The try/catch blocks should not introduce type issues since the return type (`token`) is unchanged.
- **Record**:
```
npx tsc --noEmit output filtered for auth.ts: (no output — zero errors)

PASS: No TypeScript errors in auth.ts.
```

---

## PHASE 3: Tighten Retry Logic

### 3.1 — Exclude EPERM from retryDatabaseOperation

- **File**: `src/lib/users.ts`
- **Action**: Read the full `retryDatabaseOperation` function FIRST. Then locate the `isConnectionError` check inside the catch block. The exploration found that `PrismaClientInitializationError` (which wraps EPERM) incorrectly matches the retry condition.

**Find this code:**

```typescript
      const isConnectionError = 
        error?.message?.includes('Can\'t reach database server') ||
        error?.message?.includes('connection') ||
        error?.code === 'P1001' || // Prisma connection error code
        error?.name === 'PrismaClientInitializationError';
```

**Replace with:**

```typescript
      // EPERM (filesystem permission error) should never be retried — the
      // filesystem won't become writable between attempts. This prevents
      // 4-6 second delays on Vercel cold starts if the Prisma engine
      // fails to initialize for non-transient reasons.
      const isEperm = error?.code === 'EPERM' || 
        error?.message?.includes('EPERM') ||
        error?.message?.includes('operation not permitted');
      
      const isConnectionError = !isEperm && (
        error?.message?.includes('Can\'t reach database server') ||
        error?.message?.includes('connection') ||
        error?.code === 'P1001' || // Prisma connection error code
        error?.name === 'PrismaClientInitializationError'
      );
```

**Logic**: EPERM is checked first and short-circuits the entire `isConnectionError` evaluation. If EPERM is detected, `isConnectionError = false`, so the error is thrown immediately with no retry. All other `PrismaClientInitializationError` cases (e.g., legitimate connection failures to Neon during cold start) still retry as before.

### 3.2 — Verify users.ts Changes

- **Action**: Run in terminal:
  ```powershell
  npx tsc --noEmit --pretty 2>&1 | Select-String -Pattern "users.ts" -ErrorAction SilentlyContinue
  ```
- **Expected**: No TypeScript errors in `users.ts`.
- **Record**:
```
npx tsc --noEmit output filtered for users.ts: (no output — zero errors)

PASS: No TypeScript errors in users.ts.
```

---

## PHASE 4: Pin Node.js Version

### 4.1 — Create .nvmrc

- **Action**: Create file `.nvmrc` in the project root with the content:
  ```
  22
  ```
  That's it — just the number `22` on a single line, no newline characters after it.

- **Why**: Vercel reads `.nvmrc` to determine the Node.js version for builds and functions. Node 22 is the current LTS release. Node 24 (currently running on Vercel) is not LTS and is very new — pinning to 22 reduces edge-case risk.

### 4.2 — Add engines field to package.json

- **File**: `package.json`
- **Action**: Read the file FIRST. Add an `"engines"` field at the top level (sibling to `"name"`, `"version"`, `"dependencies"`, etc.). If `"engines"` already exists, update it.

**Add this field** (place it after `"version"` or `"description"` if they exist, or after `"name"`):

```json
"engines": {
  "node": ">=22.0.0 <23.0.0"
},
```

- **IMPORTANT**: Do NOT modify any other fields in package.json. Read the file first to confirm the exact insertion point.

### 4.3 — Verify

- **Action**: Run in terminal:
  ```powershell
  Get-Content .nvmrc
  node -e "const p=require('./package.json'); console.log('engines:', JSON.stringify(p.engines))"
  ```
- **Expected**: `.nvmrc` contains `22`, engines shows `{"node":">=22.0.0 <23.0.0"}`.
- **Record**:
```
cat .nvmrc: 22
engines: {"node":">=22.0.0 <23.0.0"}

PASS: .nvmrc contains "22", engines field correctly set.
```

---

## PHASE 5: Add maxDuration to Auth Route

### 5.1 — Update vercel.json

- **File**: `vercel.json`
- **Action**: Read the file FIRST. Add an entry for the auth route inside the existing `"functions"` object.

**Add this entry to the `"functions"` object** (alongside the existing entries):

```json
"src/app/api/auth/[...nextauth]/route.ts": { "maxDuration": 30 }
```

- **IMPORTANT**: The existing entries in `"functions"` must NOT be modified. Add this as a new key-value pair inside the existing object. Ensure valid JSON (commas between entries).

### 5.2 — Verify

- **Action**: Run in terminal:
  ```powershell
  node -e "const v=require('./vercel.json'); console.log('auth route config:', JSON.stringify(v.functions?.['src/app/api/auth/[...nextauth]/route.ts']))"
  ```
- **Expected**: `auth route config: {"maxDuration":30}`
- **Record**:
```
auth route config: {"maxDuration":30}

PASS: Auth route correctly configured with maxDuration: 30.
```

---

## PHASE 6: Full Verification

### 6.1 — TypeScript Compilation

- **Action**: Run in terminal:
  ```powershell
  npx tsc --noEmit --pretty 2>&1 | Select-Object -Last 5
  ```
- **Expected**: No errors. If there are pre-existing errors unrelated to our changes, confirm none are in `auth.ts`, `users.ts`, or `schema.prisma`.
- **Record**:
```
npx tsc --noEmit: (no output — zero errors across the full codebase)

PASS: No TypeScript errors. All changes type-check cleanly.
```

### 6.2 — Prisma Validate

- **Action**: Run in terminal:
  ```powershell
  npx prisma validate
  ```
- **Expected**: Schema is valid.
- **Record**:
```
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid 🚀

PASS
```

### 6.3 — Lint Check

- **Action**: Run in terminal:
  ```powershell
  npx next lint --file src/lib/auth.ts --file src/lib/users.ts 2>&1 | Select-Object -Last 10
  ```
- **Expected**: No new lint errors from our changes.
- **Record**:
```
✔ No ESLint warnings or errors

PASS: No lint errors in auth.ts or users.ts.
```

### 6.4 — Dev Server Smoke Test

- **Action**: Run in terminal:
  ```powershell
  # Start dev server in background, wait for ready, then kill
  $env:NODE_OPTIONS="--max-old-space-size=4096"
  Write-Host "Starting dev server for smoke test..."
  $proc = Start-Process -FilePath "npx" -ArgumentList "next","dev","--port","3099" -PassThru -NoNewWindow -RedirectStandardOutput "dev-test-out.txt" -RedirectStandardError "dev-test-err.txt"
  Start-Sleep -Seconds 20
  
  # Check if it started
  $content = Get-Content "dev-test-out.txt" -Raw -ErrorAction SilentlyContinue
  $errContent = Get-Content "dev-test-err.txt" -Raw -ErrorAction SilentlyContinue
  Write-Host "=== STDOUT (last 500 chars) ==="
  if ($content) { Write-Host $content.Substring([Math]::Max(0, $content.Length - 500)) }
  Write-Host "=== STDERR (last 500 chars) ==="
  if ($errContent) { Write-Host $errContent.Substring([Math]::Max(0, $errContent.Length - 500)) }
  
  # Cleanup
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Remove-Item "dev-test-out.txt","dev-test-err.txt" -ErrorAction SilentlyContinue
  ```
- **Expected**: Dev server starts without Prisma initialization errors. No EPERM, no engine errors.
- **Note**: If the dev server takes longer than 20 seconds to compile, increase the sleep. The key thing is no Prisma errors in the output.
- **Record**:
```
  ▲ Next.js 14.2.35
  - Local:        http://localhost:3099
  - Environments: .env.local, .env
  - Experiments: instrumentationHook
 ✓ Starting...
 ✓ Compiled /instrumentation in 3s (1128 modules)
 ✓ Ready in 6.2s

=== INDICATORS ===
Server started: YES
EPERM detected: NO - PASS
chmod error: NO - PASS
PrismaClientInitializationError: NO - PASS

PASS: Dev server started cleanly with no Prisma engine errors.
```

### 6.5 — JSON Validation for vercel.json

- **Action**: Run in terminal:
  ```powershell
  node -e "try { require('./vercel.json'); console.log('vercel.json is valid JSON') } catch(e) { console.error('INVALID:', e.message) }"
  ```
- **Expected**: `vercel.json is valid JSON`
- **Record**:
```
vercel.json is valid JSON

PASS
```

---

## PHASE 7: Summary of All Changes

> **Claude Code**: After completing all phases, fill in this summary.

### Files Modified
```
1. prisma/schema.prisma (line 3)
   engineType = "binary" → "library"
   Eliminates the chmod() call on cold starts; library engine uses a .node
   native module loaded directly by Node.js — no filesystem permissions required.

2. src/lib/auth.ts (jwt() callback — two locations)
   Wrapped both getUserByEmail() calls in try/catch with console.error logging.
   Prevents any future Prisma error in the JWT callback from propagating to
   NextAuth internals and causing the secondary "invalid header value" TypeError.

3. src/lib/users.ts (retryDatabaseOperation — isConnectionError block)
   Added isEperm guard that short-circuits retry logic for EPERM errors.
   Prevents 4–6 second retry delays on cold starts for non-transient errors.

4. package.json
   Added "engines": {"node": ">=22.0.0 <23.0.0"} after the "description" field.
   Documents required Node.js version and signals Vercel to use Node 22 LTS.

5. vercel.json (functions object)
   Added "src/app/api/auth/[...nextauth]/route.ts": { "maxDuration": 30 }
   Gives the auth route a 30-second timeout ceiling (was using Vercel default).
```

### Files Created
```
1. .nvmrc — contains "22" (no trailing newline)
   Pins Node.js to 22.x LTS for both local nvm usage and Vercel builds.
```

### Verification Results
```
1.3 — .node file presence / no standalone binary:  PASS
      libquery_engine-rhel-openssl-3.0.x.so.node (16.7 MB) ✓
      query_engine-windows.dll.node (20.2 MB) ✓
      No query-engine-* binary executables ✓

1.4 — npx prisma validate:                          PASS
      "The schema at prisma\schema.prisma is valid 🚀"

2.2 — tsc --noEmit filtered for auth.ts:            PASS
      Zero TypeScript errors

3.2 — tsc --noEmit filtered for users.ts:           PASS
      Zero TypeScript errors

4.3 — .nvmrc + engines field:                       PASS
      .nvmrc: "22"
      engines: {"node":">=22.0.0 <23.0.0"}

5.2 — vercel.json auth route config:                PASS
      {"maxDuration":30}

6.1 — Full tsc --noEmit:                            PASS
      Zero TypeScript errors across entire codebase

6.2 — npx prisma validate:                          PASS
      Schema is valid

6.3 — next lint on auth.ts + users.ts:              PASS
      "✔ No ESLint warnings or errors"

6.4 — Dev server smoke test (22s):                  PASS
      Server ready in 6.2s, zero EPERM/chmod/PrismaClientInitializationError

6.5 — vercel.json JSON validity:                    PASS
      "vercel.json is valid JSON"
```

### Ready for Deployment?
```
YES. All 11 verification steps passed. No TypeScript errors, no lint errors,
schema valid, dev server starts cleanly with no Prisma engine errors.

The primary fix (engineType = "library") eliminates the root cause entirely.
The secondary hardening changes (try/catch in jwt callback, EPERM retry guard,
Node.js version pin, auth route maxDuration) are all in place and verified.
```

### Recommended Deployment Steps
```
1. Commit all changes with message: "fix: switch Prisma to library engine + auth error hardening"
2. Push to a preview branch (NOT main/production)
3. Verify on Vercel preview deployment:
   a. Force cold start by waiting for function idle
   b. Test credentials login — should succeed on first attempt
   c. Check Vercel function logs — no EPERM, no chmod errors
   d. Check Sentry — no new auth-related errors
4. After preview validation, merge to production
5. Monitor Sentry for 24 hours post-deploy
```
