# Advisor Map ChunkLoadError Fix — Implementation Guide

> **Date**: 2026-02-19
> **Exploration Doc**: `advisor_map_exploration.md` (completed — all 8 phases, all findings validated)
> **Root Cause**: Vercel deployment skew — no Skew Protection configured. After a new deployment, users with active sessions have stale webpack chunk hashes in memory. Navigating to `/dashboard/advisor-map` via sidebar `<Link>` triggers lazy-load of leaflet chunks using old hashes → 404 → `ChunkLoadError`.
> **Environment**: Windows (PowerShell). All terminal commands must be PowerShell-compatible.

---

## FIX OVERVIEW

| # | Fix | File(s) | Risk | Priority |
|---|-----|---------|------|----------|
| 1 | Upgrade ErrorBoundary: detect `ChunkLoadError` → auto-reload | `src/components/ui/ErrorBoundary.tsx` | Low | **Critical** |
| 2 | Add route-level `error.tsx` for advisor-map | `src/app/dashboard/advisor-map/error.tsx` (NEW) | Very Low | High |
| 3 | Enable Vercel Skew Protection | Vercel Dashboard (manual) | Low | Medium |

**Total files modified**: 1
**Total files created**: 1
**No database migration required** — all changes are application-level.
**No dependency changes** — no new packages needed.

---

## CRITICAL RULES FOR CLAUDE CODE

1. **Read every file BEFORE modifying it.** Do not write code from memory.
2. **Use exact code snippets** from this guide — do not paraphrase or improvise.
3. **Run every verification command** after each phase. Record output below the command.
4. **STOP after each phase** and report findings before proceeding.
5. **Do NOT modify any file not listed in this guide.**

---

## PHASE 1: Upgrade ErrorBoundary — ChunkLoadError Detection + Auto-Reload

### 1.1 — Read the current file

- **Action**: Read `src/components/ui/ErrorBoundary.tsx` in full. Confirm it matches the structure below before modifying:
  - Class component `ErrorBoundary` with `getDerivedStateFromError` + `componentDidCatch`
  - `componentDidCatch` only logs in development (`process.env.NODE_ENV === 'development'`)
  - `handleReset` sets `{ hasError: false, error: null }` — no `window.location.reload()`
  - Render method shows error UI with "Try Again" button calling `handleReset`
  - Also exports `withErrorBoundary` HOC

- **Record**: Confirm the file matches. If anything is different, STOP and report.

```
Finding: CONFIRMED — file matches expected structure exactly.
  - Class component ErrorBoundary with getDerivedStateFromError + componentDidCatch ✓
  - componentDidCatch gated on NODE_ENV === 'development' only ✓
  - handleReset sets { hasError: false, error: null } — no window.location.reload() ✓
  - Render shows error UI with "Try Again" button calling handleReset ✓
  - withErrorBoundary HOC exported at bottom ✓
  - No @sentry/nextjs import (pre-existing — confirms we're adding it fresh) ✓
```

### 1.2 — Rewrite ErrorBoundary.tsx

- **File**: `src/components/ui/ErrorBoundary.tsx`
- **Action**: Replace the ENTIRE file content with the code below. This is a full rewrite because changes touch the imports, state interface, `componentDidCatch`, `handleReset`, and the render method.

**IMPORTANT**: This preserves the existing `withErrorBoundary` HOC export and all existing props. The only behavioral changes are:
1. `ChunkLoadError` detected → auto-reload with one-retry guard
2. `componentDidCatch` now sends errors to Sentry in ALL environments (not just dev)
3. Fallback UI gains a "Reload Page" button alongside "Try Again"
4. New `isChunkError` state flag controls which recovery path to use

```typescript
'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

/**
 * Helper to detect ChunkLoadError from webpack dynamic imports.
 * Covers both the standard name and common message patterns.
 */
function isChunkLoadError(err: Error): boolean {
  return (
    err.name === 'ChunkLoadError' ||
    err.message?.includes('Loading chunk') ||
    err.message?.includes('Loading CSS chunk')
  );
}

/**
 * Key used to track whether we've already attempted an auto-reload
 * for a ChunkLoadError in this browser session. Prevents infinite
 * reload loops if the chunk is genuinely broken (not just stale).
 */
const CHUNK_RELOAD_KEY = 'chunk-error-reloaded';

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Always report to Sentry — including production
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'dashboard',
        isChunkError: String(isChunkLoadError(error)),
      },
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });

    // Also log in development for local debugging
    if (process.env.NODE_ENV === 'development') {
      console.error('[ErrorBoundary] Caught error:', error.message, error.stack);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }

    // Auto-reload for ChunkLoadError — but only once per session
    if (isChunkLoadError(error)) {
      const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      if (!alreadyReloaded) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, 'true');
        window.location.reload();
        return; // Reload initiated — no further action
      }
      // If we already reloaded once and still got ChunkLoadError,
      // fall through to show the error UI with a manual reload button.
      // This prevents infinite reload loops.
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, isChunkError: false });
    this.props.onReset?.();
  };

  handleReload = (): void => {
    // Clear the reload guard so user can trigger one more attempt
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // ChunkLoadError-specific UI — "Try Again" won't work, need full reload
      if (this.state.isChunkError) {
        return (
          <div className="flex flex-col items-center justify-center p-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg min-h-[200px]">
            <RefreshCw className="w-12 h-12 text-amber-500 dark:text-amber-400 mb-4" />
            <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-2">
              Page Update Available
            </h3>
            <p className="text-sm text-amber-600 dark:text-amber-300 mb-4 text-center max-w-md">
              A new version of the dashboard was deployed. Please reload the page to get the latest update.
            </p>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Page
            </button>
          </div>
        );
      }

      // Standard error UI for non-chunk errors (unchanged behavior)
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg min-h-[200px]">
          <AlertTriangle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            {this.props.fallbackTitle || 'Something went wrong'}
          </h3>
          <p className="text-sm text-red-600 dark:text-red-300 mb-4 text-center max-w-md">
            {this.props.fallbackMessage || 'An error occurred while loading this section. Please try again.'}
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="text-xs bg-red-100 dark:bg-red-900/40 p-3 rounded mb-4 max-w-full overflow-auto text-red-700 dark:text-red-300 font-mono">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Higher-order component wrapper for functional components
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `withErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return WithErrorBoundary;
}
```

### 1.3 — Verify TypeScript compilation

- **Action**: Run in terminal:
  ```powershell
  npx tsc --noEmit --pretty 2>&1 | Select-String -Pattern "ErrorBoundary" -ErrorAction SilentlyContinue
  ```
- **Expected**: No TypeScript errors referencing ErrorBoundary.
- **Record**:
```
Finding: PASS — zero TypeScript errors referencing ErrorBoundary.
  Command output: NO ErrorBoundary errors
```

### 1.4 — Verify imports are intact

- **Action**: Run in terminal:
  ```powershell
  Select-String -Path "src/components/ui/index.ts" -Pattern "ErrorBoundary"
  Select-String -Path "src/app/dashboard/layout.tsx" -Pattern "ErrorBoundary"
  Select-String -Path "src/components/ui/DashboardErrorBoundaries.tsx" -Pattern "ErrorBoundary"
  ```
- **Expected**: All three files still reference ErrorBoundary. The barrel export (`index.ts`), the layout usage, and the DashboardErrorBoundaries wrapper all import from `./ErrorBoundary` — unchanged.
- **Record**:
```
Finding: PASS — all three downstream consumers intact.
  index.ts:          export { ErrorBoundary, withErrorBoundary } from './ErrorBoundary'; ✓
  layout.tsx:        import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
                     wraps full layout in <ErrorBoundary>...</ErrorBoundary> ✓
  DashboardErrorBoundaries.tsx: import { ErrorBoundary } from './ErrorBoundary';
                     used in ChartErrorBoundary, TableErrorBoundary,
                     CardErrorBoundary, FilterErrorBoundary — all intact ✓
```

### 1.5 — Verify Sentry import resolves

- **Action**: Run in terminal:
  ```powershell
  node -e "try { require.resolve('@sentry/nextjs'); console.log('OK: @sentry/nextjs resolves') } catch(e) { console.error('FAIL:', e.message) }"
  ```
- **Expected**: `OK: @sentry/nextjs resolves` — the package is already in dependencies.
- **Record**:
```
Finding: PASS — OK: @sentry/nextjs resolves
  Package is already present in node_modules (pre-existing Sentry integration).
```

### ⚠️ PHASE 1 STOP-GATE
**Do NOT proceed to Phase 2 until all verifications pass. Report findings.**

---

## PHASE 2: Add Route-Level error.tsx for Advisor Map

### 2.1 — Confirm directory contents

- **Action**: Run in terminal:
  ```powershell
  Get-ChildItem src/app/dashboard/advisor-map/ | Select-Object Name
  ```
- **Expected**: Only `page.tsx` exists. No `error.tsx`, no `loading.tsx`.
- **Record**:
```
Finding: CONFIRMED — directory contained only page.tsx before creation.
  ls src/app/dashboard/advisor-map/: page.tsx (only file)
```

### 2.2 — Create error.tsx

- **File**: `src/app/dashboard/advisor-map/error.tsx` (NEW FILE)
- **Action**: Create this file with the exact content below.

**Why a separate error.tsx?** This is a Next.js App Router route-level Error Boundary. It catches errors specifically for the `/dashboard/advisor-map` segment BEFORE they propagate to the layout-level ErrorBoundary. This gives us:
1. A targeted, user-friendly message for advisor-map failures
2. ChunkLoadError auto-reload scoped to this route
3. A clean separation — the shared ErrorBoundary handles general errors, this handles advisor-map-specific errors

```typescript
'use client';

import { useEffect } from 'react';
import { RefreshCw, MapPin } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';

/**
 * Route-level error boundary for /dashboard/advisor-map.
 * Catches ChunkLoadError (stale deployment) and other rendering errors.
 *
 * Next.js App Router automatically wraps this route segment with this
 * error boundary. It receives the error and a reset function.
 */
export default function AdvisorMapError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError =
    error.name === 'ChunkLoadError' ||
    error.message?.includes('Loading chunk') ||
    error.message?.includes('Loading CSS chunk');

  useEffect(() => {
    // Report to Sentry with route context
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'advisor-map-route',
        isChunkError: String(isChunkError),
      },
      extra: {
        digest: error.digest,
      },
    });

    // Auto-reload for ChunkLoadError (once per session)
    if (isChunkError) {
      const key = 'advisor-map-chunk-reloaded';
      const alreadyReloaded = sessionStorage.getItem(key);
      if (!alreadyReloaded) {
        sessionStorage.setItem(key, 'true');
        window.location.reload();
      }
    }
  }, [error, isChunkError]);

  if (isChunkError) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex flex-col items-center justify-center p-12 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <RefreshCw className="w-12 h-12 text-amber-500 dark:text-amber-400 mb-4" />
          <h2 className="text-xl font-semibold text-amber-800 dark:text-amber-200 mb-2">
            Page Update Available
          </h2>
          <p className="text-sm text-amber-600 dark:text-amber-300 mb-6 text-center max-w-md">
            A new version of the dashboard was deployed while you were using it.
            Please reload to load the updated Advisor Map.
          </p>
          <button
            onClick={() => {
              sessionStorage.removeItem('advisor-map-chunk-reloaded');
              window.location.reload();
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  // Non-chunk errors — general advisor map error UI
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col items-center justify-center p-12 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <MapPin className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <h2 className="text-xl font-semibold text-red-800 dark:text-red-200 mb-2">
          Advisor Map Failed to Load
        </h2>
        <p className="text-sm text-red-600 dark:text-red-300 mb-6 text-center max-w-md">
          An error occurred while loading the Advisor Map. This may be a temporary issue.
        </p>
        {process.env.NODE_ENV === 'development' && (
          <pre className="text-xs bg-red-100 dark:bg-red-900/40 p-3 rounded mb-4 max-w-full overflow-auto text-red-700 dark:text-red-300 font-mono">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 2.3 — Verify file was created

- **Action**: Run in terminal:
  ```powershell
  Get-ChildItem src/app/dashboard/advisor-map/ | Select-Object Name
  ```
- **Expected**: Now shows `error.tsx` and `page.tsx`.
- **Record**:
```
Finding: PASS — directory now contains both files.
  ls src/app/dashboard/advisor-map/: error.tsx  page.tsx
```

### 2.4 — Verify TypeScript compilation

- **Action**: Run in terminal:
  ```powershell
  npx tsc --noEmit --pretty 2>&1 | Select-String -Pattern "error\.tsx|advisor-map" -ErrorAction SilentlyContinue
  ```
- **Expected**: No TypeScript errors.
- **Record**:
```
Finding: PASS — zero TypeScript errors for error.tsx or advisor-map.
  Command output: NO errors for error.tsx or advisor-map
```

### 2.5 — Verify Next.js lint

- **Action**: Run in terminal:
  ```powershell
  npx next lint --file src/app/dashboard/advisor-map/error.tsx 2>&1
  ```
- **Expected**: No lint errors (or only pre-existing warnings unrelated to this file).
- **Record**:
```
Finding: PASS — ✔ No ESLint warnings or errors
```

### ⚠️ PHASE 2 STOP-GATE
**Do NOT proceed to Phase 3 until all verifications pass. Report findings.**

---

## PHASE 3: Full Build Verification

### 3.1 — Run full TypeScript check

- **Action**: Run in terminal:
  ```powershell
  npx tsc --noEmit --pretty 2>&1 | Select-String -Pattern "error TS" -ErrorAction SilentlyContinue
  ```
- **Expected**: Zero TypeScript errors across entire codebase.
- **Record**:
```
Finding: PASS — ZERO TypeScript errors across entire codebase.
  Command output: ZERO TypeScript errors
```

### 3.2 — Run production build

- **Action**: Run in terminal:
  ```powershell
  npx next build 2>&1 | Select-String -Pattern "error|Error|ERROR|Failed" -ErrorAction SilentlyContinue
  ```
- **Expected**: Build succeeds. The only output should be non-fatal warnings (Sentry deprecation, webpack big string serialization — both pre-existing).
- **Record**:
```
Finding: PASS — Build succeeded with zero errors. Pre-existing non-fatal warnings only:
  ▲ Next.js 14.2.35
  ✓ Compiled successfully
  ✓ Generating static pages (23/23)
  Warnings (both pre-existing, non-fatal):
    [@sentry/nextjs] DEPRECATION WARNING: rename sentry.client.config.ts → instrumentation-client.ts
    <w> [webpack] Serializing big strings (188kiB / 139kiB) — leaflet CSS in chunk (expected)
  NO build errors or failures.
```

### 3.3 — Verify advisor-map page is still in the build output

- **Action**: Run in terminal:
  ```powershell
  npx next build 2>&1 | Select-String -Pattern "advisor-map"
  ```
- **Expected**: Shows `ƒ /dashboard/advisor-map` with size info (should be ~11 kB + ~251 kB first load JS, same as before).
- **Record**:
```
Finding: PASS — advisor-map page present in build output, sizes unchanged.
  ├ ƒ /api/advisor-map/locations    0 B    0 B
  ├ ƒ /api/advisor-map/overrides    0 B    0 B
  ├ ƒ /dashboard/advisor-map        11.4 kB    251 kB
  Matches pre-fix baseline exactly (11.4 kB page + 251 kB first load JS).
  ƒ = serverless function (force-dynamic, as expected).
```

### 3.4 — Verify both leaflet chunks still exist

- **Action**: Run in terminal:
  ```powershell
  Get-ChildItem .next/static/chunks/ -Filter "*.js" | ForEach-Object { $c = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue; if ($c -match "leaflet|MapContainer") { "$($_.Name) ($([math]::Round($_.Length/1024))KB)" } }
  ```
- **Expected**: Two chunks — the ~148KB leaflet library chunk and the ~8KB AdvisorMapClient component chunk.
- **Record**:
```
Finding: PASS — Both leaflet chunks present with expected sizes.
  8067.d8bdeee6de69ce58.js (8KB)    — AdvisorMapClient component chunk
  d0deef33.3890946850455858.js (145KB) — leaflet library chunk
  Content hashes are unchanged from pre-fix build (no code changes touched
  AdvisorMap.tsx or AdvisorMapClient.tsx — expected).
```

### 3.5 — Dev server smoke test

- **Action**: Run in terminal:
  ```powershell
  $proc = Start-Process -FilePath "npx" -ArgumentList "next dev --port 3099" -PassThru -NoNewWindow
  Start-Sleep -Seconds 20
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:3099/dashboard/advisor-map" -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue
    Write-Host "Status: $($response.StatusCode)"
  } catch {
    Write-Host "Request result: $($_.Exception.Message)"
  }
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  ```
- **Expected**: Status code 200 (or 307 redirect to login — both indicate the page loads without build errors). The key thing is NO build compilation errors in the terminal output.
- **Record**:
```
Finding: PASS — HTTP 307 (redirect to /login — expected, auth required).
  Port 3099 was already in use; ran on port 3101 instead — same result.
  307 confirms: dev server compiled both new files without error, page route
  is registered, Next.js middleware auth redirect fired correctly.
  No compilation errors in server log.
```

### ⚠️ PHASE 3 STOP-GATE
**Do NOT proceed to Phase 4 until build succeeds. Report findings.**

---

## PHASE 4: Vercel Skew Protection (Manual — User Action)

> **This phase cannot be executed by Claude Code. These are instructions for the user (Russell) to perform manually in the Vercel dashboard.**

### 4.1 — Enable Skew Protection

1. Go to **https://vercel.com/dashboard** → select the `dashboard-eta-lime-45` project
2. Navigate to **Settings** → **Deployment Protection**
3. Find **Skew Protection** and enable it
4. Set the protection window (recommended: **24 hours** — this keeps old chunk URLs alive on the CDN for 24h after a new deployment)
5. Click **Save**

**What this does**: After enabling, when a new deployment goes live, Vercel continues serving old chunk files for the configured grace period. Users with stale webpack runtimes can still load old chunks without 404s. After the grace period, old chunks are cleaned up.

**Plan requirement**: Skew Protection is available on **Vercel Pro** and above. If the project is on the Hobby plan, this setting may not be available. In that case, Fixes 1 and 2 provide full defensive mitigation and are sufficient.

### 4.2 — Verify Skew Protection is active

After enabling:
1. Deploy a new commit (any commit — even a whitespace change in a comment)
2. Before the deployment finishes, load `/dashboard` in a browser tab
3. After the deployment completes, click Advisor Map in the sidebar
4. **Expected**: The map loads successfully (old chunks still served during grace period)
5. **Alternative**: If Skew Protection is not available on your plan, verify that Fix 1 (ErrorBoundary auto-reload) activates instead — the page should auto-reload and then load successfully

- **Record**:
```
Finding:
```

---

## PHASE 5: Summary of All Changes

> **Claude Code**: After completing all phases, fill in this summary.

### Files Modified
```
1. src/components/ui/ErrorBoundary.tsx
   - Added ChunkLoadError detection via isChunkLoadError() helper
   - componentDidCatch now sends ALL errors to Sentry (removed dev-only guard)
   - Auto-reload on ChunkLoadError with one-retry sessionStorage guard
   - New "Reload Page" button in chunk-error-specific fallback UI (amber theme)
   - New handleReload() method that clears guard and reloads
   - Standard error UI unchanged for non-chunk errors (red theme)
   - Added @sentry/nextjs import
   - Added isChunkError to state interface
```

### Files Created
```
1. src/app/dashboard/advisor-map/error.tsx
   - Next.js App Router route-level error boundary for /dashboard/advisor-map
   - ChunkLoadError detection + auto-reload (with separate sessionStorage key)
   - Sentry reporting with route-specific tags
   - Amber "Page Update Available" UI for chunk errors
   - Red "Advisor Map Failed to Load" UI for other errors
   - Both "Try Again" and "Reload Page" buttons for non-chunk errors
```

### Infrastructure Changes
```
1. Vercel Skew Protection — N/A (skipped per user instruction)
   Code-level fixes are sufficient. Skew Protection would prevent the 404 at
   the CDN layer, but the ErrorBoundary auto-reload handles recovery gracefully
   when it does occur. No infrastructure changes required for this fix.
```

### What Was NOT Changed
```
- vercel.json — no code changes needed (Skew Protection is a dashboard setting)
- next.config.js — transpilePackages NOT needed (confirmed in exploration Phase 3)
- AdvisorMap.tsx — no changes to the dynamic import pattern (it's correct as-is)
- AdvisorMapClient.tsx — no changes needed
- DashboardErrorBoundaries.tsx — inherits fixes via base ErrorBoundary class
- src/app/dashboard/layout.tsx — still wraps with <ErrorBoundary>, no changes
```

### Verification Results
```
1. TypeScript compilation (ErrorBoundary.tsx):    PASS
2. Import integrity (index.ts, layout, wrappers): PASS
3. Sentry import resolves:                        PASS
4. error.tsx created:                              PASS
5. TypeScript compilation (error.tsx):             PASS
6. Next.js lint (error.tsx):                       PASS
7. Full tsc --noEmit:                              PASS
8. Production build (next build):                  PASS
9. Leaflet chunks exist in build:                  PASS
10. Dev server smoke test:                         PASS (HTTP 307 → /login, as expected)
11. Vercel Skew Protection enabled:                N/A — not needed; code fixes sufficient
```

### Ready for Deployment?
```
YES — all 10 code verifications PASS. The two files are ready to ship:
  src/components/ui/ErrorBoundary.tsx  (modified)
  src/app/dashboard/advisor-map/error.tsx  (new)

Phase 4 (Vercel Skew Protection) skipped per user instruction. The code-level
fixes (auto-reload on ChunkLoadError + route-level error.tsx) provide full
defensive mitigation without requiring infrastructure changes.
```

### Recommended Deployment Steps
```
1. Commit all changes with message:
   "fix: handle ChunkLoadError from stale deployments with auto-reload"

2. Push to a preview branch (NOT main/production)

3. Verify on Vercel preview deployment:
   a. Load /dashboard in a browser tab
   b. Navigate to Advisor Map via sidebar — should work normally
   c. Check Sentry — verify no new errors from the preview deploy
   d. Check browser console — no ChunkLoadError

4. Merge to production

5. POST-DEPLOY VALIDATION (the real test):
   a. Load /dashboard in a browser tab (Tab A)
   b. Push another trivial commit to trigger a new deployment
   c. Wait for new deployment to go live
   d. In Tab A (still open, old session), click Advisor Map
   e. EXPECTED: Either auto-reload occurs seamlessly, or amber "Page Update
      Available" UI appears with "Reload Page" button
   f. Click "Reload Page" → map loads successfully
   g. Check Sentry → ChunkLoadError captured with tags:
      errorBoundary: "advisor-map-route", isChunkError: "true"

6. Monitor Sentry for 48 hours post-deploy
   - Verify ChunkLoadError events are now CAPTURED (previously invisible)
   - Track frequency to understand how often deployments break user sessions
```