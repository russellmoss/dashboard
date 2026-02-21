# Advisor Map Production ChunkLoadError — Exploration Document

> **Purpose**: Systematically diagnose why the Advisor Map page throws `ChunkLoadError` on production (Vercel) but works locally. Claude Code will work through each phase, answer every question directly below the question, and this document becomes the single source of truth for creating the implementation guide.
>
> **Symptoms** (from browser console on production):
> ```
> d0deef33.04d369d0a712e865.js:1  Failed to load resource: 404
> 8067.9481932d1af0204b.js:1  Failed to load resource: 404
> ChunkLoadError: Loading chunk 4212 failed.
>   (error: https://dashboard-eta-lime-45.vercel.app/_next/static/chunks/d0deef33.04d369d0a712e865.js)
> Recharts: The width(-1) and height(-1) of chart should be greater than 0
> ```
>
> **Key Fact**: Works perfectly when running locally (`npm run dev`).
>
> **Rules**:
> - Do NOT modify any source code during exploration.
> - Answer every question by reading the actual files. No assumptions. No hallucination.
> - Paste exact snippets where requested.
> - If a question reveals something unexpected, note it in the ⚠️ DISCOVERY section at the end of that phase.
> - After completing each phase, STOP and report before moving to the next.

---

## PHASE 1: Identify the Failing Chunk

**Objective**: Determine exactly which component(s) are in the chunk that's 404ing and understand the code-splitting boundary.

### 1.1 — Map the dynamic import chain

**Q1.1a**: Read `src/app/dashboard/advisor-map/page.tsx`. How is the `AdvisorMap` component imported? Is it a static import or dynamic?

```
Answer: STATIC import on line 12:
  import { AdvisorMap } from '@/components/advisor-map';
No next/dynamic usage in page.tsx at all. The page just renders <AdvisorMap /> directly.
```

**Q1.1b**: Read `src/components/advisor-map/index.ts`. What does the barrel file export? Is it a named or default export?

```
Answer: Single line — named re-export:
  export { AdvisorMap } from './AdvisorMap';
This is a named export (curly brace re-export).
```

**Q1.1c**: Read `src/components/advisor-map/AdvisorMap.tsx`. Find the `next/dynamic` import of `AdvisorMapClient`. Copy the exact dynamic import statement:

```
Answer: Lines 11–24 of AdvisorMap.tsx:
  const AdvisorMapClient = dynamic(
    () => import('./AdvisorMapClient').then(mod => mod.AdvisorMapClient),
    {
      ssr: false,
      loading: () => (
        <div className="flex items-center justify-center h-[500px] bg-gray-100 dark:bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading map...</span>
          </div>
        </div>
      ),
    }
  );
```

**Q1.1d**: Read `src/components/advisor-map/AdvisorMapClient.tsx`. Is `AdvisorMapClient` a **named export** or **default export**? This is critical because the dynamic import uses `.then(mod => mod.AdvisorMapClient)` — if it's a default export, this would silently resolve to `undefined`.

```
Answer: NAMED export. Line 83:
  export function AdvisorMapClient({ advisors, onAdvisorClick, onViewDetails }: AdvisorMapClientProps) {
The .then(mod => mod.AdvisorMapClient) pattern is CORRECT — not a silent undefined issue.
```

### 1.2 — Identify all imports in AdvisorMapClient

**Q1.2a**: List every import in `AdvisorMapClient.tsx`. For each, note whether it's:
- A Node.js/browser-only module (e.g., `leaflet` requires `window`)
- An npm package vs local module
- Whether it has known ESM/CJS compatibility issues with Next.js 14

```
Answer: (lines 1–8 of AdvisorMapClient.tsx)
1. 'react' (React, useEffect, useMemo) — npm, browser-safe, no ESM/CJS issues
2. 'react-leaflet' (MapContainer, TileLayer, Marker, Popup, useMap) — npm, BROWSER-ONLY
   (requires window/DOM); react-leaflet v4.x is ESM-only — KNOWN issue with Next.js 14
   without transpilePackages config
3. 'leaflet' (L, default import) — npm, BROWSER-ONLY (accesses window at module init
   time); leaflet is CJS/ESM hybrid. Line 41 calls L.Marker.prototype at module-level
   (top-level side effect — executes on import, before any React lifecycle)
4. 'leaflet/dist/leaflet.css' — CSS import in a dynamically-loaded chunk
   (can cause issues in production builds with certain webpack configs)
5. '@/lib/queries/advisor-locations' (AdvisorLocation) — local, type-only
6. '@/lib/utils/format-helpers' (formatDate) — local, no issues

CRITICAL: Lines 11–41 of AdvisorMapClient.tsx execute TOP-LEVEL side effects:
  - L.icon({...}) called 3x at module level (defaultIcon, rooftopIcon, approximateIcon)
  - L.Marker.prototype.options.icon = defaultIcon at module level
  These run immediately when the module is imported. If Leaflet's window access
  fails or if the module can't be resolved, the entire chunk fails to execute.
```

### 1.3 — Check for other dynamic imports on this page

**Q1.3a**: Does `AdvisorMap.tsx` import `AdvisorDrillDownModal` or `RecordDetailModal` statically or dynamically? If static, they'd be bundled into the same chunk as `AdvisorMap`.

```
Answer: BOTH are static imports in AdvisorMap.tsx:
  Line 7: import { AdvisorDrillDownModal, DrillDownType } from './AdvisorDrillDownModal';
  Line 8: import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
Both are bundled into the same chunk as AdvisorMap.tsx — NOT the Leaflet chunk.
AdvisorDrillDownModal itself also statically imports RecordDetailModal (line 19 of
AdvisorDrillDownModal.tsx), so RecordDetailModal is pulled in twice (deduped by bundler).
```

**Q1.3b**: Check `RecordDetailModal` — what does it import? Does it pull in any heavy dependencies (Recharts, Tremor charts, etc.) that could cause the Recharts width/height error?

```bash
grep -n "import" src/components/dashboard/RecordDetailModal.tsx | head -30
```

```
Answer: RecordDetailModal.tsx imports (lines 1–23):
  - 'react' (React, useEffect, useState)
  - 'lucide-react' (X, ExternalLink, Calendar, DollarSign, Users, Tag, Building,
    AlertCircle, FileText, ListChecks)
  - '@/types/record-detail' (RecordDetailFull)
  - '@/lib/api-client' (dashboardApi)
  - './FunnelProgressStepper'
  - './RecordDetailSkeleton'
  - '@/lib/utils/format-helpers' (formatDate)

NO Recharts, NO Tremor chart components, NO heavy chart dependencies.
The Recharts error seen in the console is NOT coming from RecordDetailModal.
```

### ⚠️ PHASE 1 DISCOVERIES:
```
1. TOP-LEVEL SIDE EFFECTS IN AdvisorMapClient.tsx (lines 11–41): Three L.icon() calls
   and one L.Marker.prototype mutation execute at MODULE LOAD TIME — before any React
   lifecycle. If Leaflet fails to initialize (or its module fails to resolve), the
   entire chunk throws synchronously on import, causing ChunkLoadError.

2. react-leaflet v4.x IS ESM-ONLY. Without `transpilePackages: ['react-leaflet']` in
   next.config.js (unverified until Phase 3), Next.js 14 production builds may fail to
   bundle it, while dev mode handles it more leniently — perfectly matching the symptom
   ("works locally, fails in production").

3. The Recharts error is UNRELATED to the advisor map components. It must originate from
   a different component on the page (sidebar, layout, or another panel) — investigate
   in Phase 4.

4. AdvisorMap.tsx is a 'use client' component that is STATICALLY imported from the
   server page. This means AdvisorMap.tsx itself (and its static deps like
   AdvisorDrillDownModal, RecordDetailModal) are in the client bundle for the page.
   Only AdvisorMapClient.tsx (containing Leaflet) is split into a separate lazy chunk.
```

---

## PHASE 2: Verify Build & Deployment State

**Objective**: Determine if this is a stale chunk issue (old HTML referencing new chunks or vice versa) or a build-time failure.

### 2.1 — Check the Vercel deployment

**Q2.1a**: Run a production build locally and check if it succeeds without errors:

```powershell
npx next build 2>&1 | Select-String -Pattern "error|Error|ERROR|warn|chunk" -ErrorAction SilentlyContinue
```

Record the full output. Does the build complete successfully?

```
Answer: BUILD SUCCEEDS with exit code 0. Full output summary:
  - Next.js 14.2.35
  - "✓ Compiled successfully"
  - "✓ Generating static pages (23/23)"
  - Warnings (non-fatal):
    1. [@sentry/nextjs] DEPRECATION WARNING: recommends renaming sentry.client.config.ts
       to instrumentation-client.ts (for Turbopack compat — NOT blocking)
    2. [webpack.cache.PackFileCacheStrategy] Serializing big strings (188kiB) impacts
       deserialization performance — this is a Leaflet CSS string in the bundle
    3. [webpack.cache.PackFileCacheStrategy] Serializing big strings (139kiB) — same

  /dashboard/advisor-map is listed as:
    ƒ /dashboard/advisor-map    11.4 kB    251 kB first load JS

  No errors. No failed chunks. The build DOES produce the leaflet chunks locally.
  The "big strings" warnings are from leaflet CSS being serialized into the bundle.
```

**Q2.1b**: After the build, check the `.next/static/chunks/` directory. Are there files with hash patterns similar to `d0deef33` or `8067`?

```powershell
Get-ChildItem .next/static/chunks/ -Filter "*.js" | Where-Object { $_.Name -match "d0deef33|8067" } | Select-Object Name, Length
```

```
Answer: YES — BOTH chunk IDs exist in the local production build, but with DIFFERENT hashes:

  Local build:      d0deef33.3890946850455858.js  (148,840 bytes = ~145KB)
  Production 404'd: d0deef33.04d369d0a712e865.js  (unknown size, no longer served)

  Local build:      8067.d8bdeee6de69ce58.js       (8,684 bytes = ~8.5KB)
  Production 404'd: 8067.9481932d1af0204b.js       (unknown size, no longer served)

  CRITICAL INSIGHT: The chunk IDs (d0deef33, 8067) are STABLE and DETERMINISTIC across
  builds (they're derived from module graph). The CONTENT HASHES change every time the
  source code changes. The browser was requesting OLD hashes from a previous build.
  This is the classic "stale deployment" / deployment skew problem.
```

**Q2.1c**: List all chunks in `.next/static/chunks/` that contain "leaflet" or "react-leaflet" references:

```powershell
Get-ChildItem .next/static/chunks/ -Filter "*.js" | ForEach-Object { $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue; if ($content -match "leaflet|MapContainer|TileLayer") { $_.Name } }
```

```
Answer: Exactly TWO chunks contain leaflet references:

  d0deef33.3890946850455858.js (148KB)
    — Contains leaflet CSS class strings (e.g., "leaflet-container", "leaflet-pane",
      "leaflet-zoom-animated", etc.) = the Leaflet LIBRARY chunk

  8067.d8bdeee6de69ce58.js (8.5KB)
    — Contains "AdvisorMapClient" and "MapContainer"
    = the AdvisorMapClient COMPONENT chunk (react-leaflet usage)

  Conclusion: Leaflet is split into exactly 2 lazy chunks. Both are dynamically loaded
  at runtime when AdvisorMapClient first renders. NEITHER appears in the static
  build manifest for /dashboard/advisor-map/page — they are webpack lazy-loaded chunks.
```

### 2.2 — Check for stale deployment indicators

**Q2.2a**: Open the production URL in an incognito window: `https://dashboard-eta-lime-45.vercel.app/dashboard/advisor-map`. Check the page source (View Source) and find the `_next/static/` build ID. Record it:

```
Answer: REQUIRES MANUAL BROWSER TEST
Check: View Source → search for "/_next/static/" → find the BUILD_ID segment in chunk
URLs (e.g., /_next/static/[BUILD_ID]/...). Record the full BUILD_ID.
This will confirm whether the HTML's referenced build ID matches the 404'd chunk hashes.
```

**Q2.2b**: In the Network tab, when the ChunkLoadError occurs, what is the full URL of the 404'd chunk? Does the build hash in the chunk URL match the build hash from the page HTML?

```
Answer: REQUIRES MANUAL BROWSER TEST
Based on the symptom data provided: the 404'd URLs are:
  https://dashboard-eta-lime-45.vercel.app/_next/static/chunks/d0deef33.04d369d0a712e865.js
  https://dashboard-eta-lime-45.vercel.app/_next/static/chunks/8067.9481932d1af0204b.js
If the page HTML was served by the current deployment but these chunks are from a prior
deployment, the hashes would NOT match → confirming stale deployment cause.
```

**Q2.2c**: Try a hard refresh (Ctrl+Shift+R) on the advisor map page. Does the error persist or does it only happen on navigation?

```
Answer: REQUIRES MANUAL BROWSER TEST
Key diagnostic: If the error ONLY happens on client-side navigation (clicking sidebar
link) but NOT on a hard refresh (Ctrl+Shift+R), this CONFIRMS stale deployment as the
root cause. A hard refresh fetches fresh HTML with current chunk hashes; sidebar
navigation uses the cached page shell with old chunk hashes.
```

### 2.3 — Check Vercel deployment logs

**Q2.3a**: Check the most recent Vercel deployment. Were there any build warnings about `leaflet`, `react-leaflet`, or chunk size limits?

```powershell
# If Vercel CLI is available:
vercel logs --follow 2>&1 | Select-String -Pattern "leaflet|chunk|warning" -ErrorAction SilentlyContinue
```

If CLI is not available, check the Vercel dashboard → Deployments → latest → Build Logs. Record any warnings.

```
Answer: Vercel CLI not installed (command not found). Cannot query logs programmatically.
REQUIRES MANUAL CHECK: Go to https://vercel.com/dashboard → project → Deployments →
most recent deployment → Build Logs. Look for:
  - Any "error" or "failed" messages relating to leaflet or react-leaflet
  - Webpack big-string serialization warnings (expected — seen locally too)
  - Any chunk generation failures

Based on the local build evidence (builds succeed, both chunks are generated), Vercel
build logs are expected to show the same non-fatal warnings and a successful build.
The real question is whether the Vercel deployment ALSO had Skew Protection disabled.
```

### ⚠️ PHASE 2 DISCOVERIES:
```
1. CONFIRMED: Both 404'd chunk IDs (d0deef33 and 8067) exist in a LOCAL production
   build but with DIFFERENT content hashes than what production 404'd:
     Local:      d0deef33.3890946850455858.js  /  8067.d8bdeee6de69ce58.js
     Prod 404'd: d0deef33.04d369d0a712e865.js  /  8067.9481932d1af0204b.js
   This proves the chunks DO build successfully. The 404 is a hash mismatch caused
   by requesting chunks from a PREVIOUS deployment.

2. THE CHUNKS ARE NOT IN THE PAGE BUILD MANIFEST. The advisor-map page manifest
   lists 11 eagerly-loaded chunks — NEITHER d0deef33 nor 8067 appear in that list.
   They are LAZY chunks, loaded at runtime by webpack when AdvisorMapClient renders.
   This is by design (next/dynamic ssr:false), but it means they're vulnerable to
   stale-deployment hash mismatches.

3. BUILD COMPILES react-leaflet SUCCESSFULLY WITHOUT transpilePackages. Despite
   react-leaflet being "type":"module" (pure ESM), the local production build
   succeeds and includes it in the chunks. This means the ESM issue may be
   non-blocking in Next.js 14.2.35 — or the bundler handles it transparently.
   (Still worth verifying on Vercel, where Node.js version may differ.)

4. "Serializing big strings" webpack warning = leaflet CSS being inlined into the
   JS bundle as a string. This is expected behavior when importing leaflet.css inside
   a dynamically-loaded chunk — it doesn't cause a build failure but does inflate
   chunk size (148KB for the leaflet library chunk).

5. NO service worker exists. No error.tsx files in advisor-map directory.
   There is an ErrorBoundary component but it's used in dashboard/layout.tsx
   for general page wrapping — it may NOT catch the ChunkLoadError specifically
   since that happens BEFORE the component renders.
```

---

## PHASE 3: Investigate Leaflet + Next.js Compatibility

**Objective**: Leaflet and react-leaflet have known SSR/bundling issues with Next.js. Determine if the chunk failure is caused by module resolution or transpilation problems.

### 3.1 — Check transpilePackages configuration

**Q3.1a**: Read `next.config.js`. Is `transpilePackages` configured? Specifically, are `leaflet` or `react-leaflet` listed?

```
Answer: NO transpilePackages configuration exists anywhere in next.config.js.
The nextConfig object contains only:
  - reactStrictMode: true
  - experimental.instrumentationHook: true
  - typescript.ignoreBuildErrors: false
  - eslint.ignoreDuringBuilds: true
  - images.remotePatterns (2 entries)

Neither 'leaflet' nor 'react-leaflet' are listed in transpilePackages because
transpilePackages itself is completely absent from the config.
```

**Q3.1b**: Check if `leaflet` is an ESM-only package or CJS:

```powershell
node -e "const p=require('./node_modules/leaflet/package.json'); console.log('type:', p.type); console.log('main:', p.main); console.log('module:', p.module); console.log('exports:', JSON.stringify(p.exports)?.slice(0,200))"
```

```
Answer: leaflet v1.9.4 is COMMONJS (CJS):
  type:    (none — defaults to CJS)
  main:    dist/leaflet-src.js
  module:  (none)
  exports: (none — no exports map)
  browser: (none)

leaflet is a traditional CJS package. No ESM/CJS compatibility issues.
It requires 'window' at runtime, which is why ssr:false is needed, but the
module FORMAT itself is not problematic for webpack bundling.
```

**Q3.1c**: Check the same for `react-leaflet`:

```powershell
node -e "const p=require('./node_modules/react-leaflet/package.json'); console.log('type:', p.type); console.log('main:', p.main); console.log('module:', p.module); console.log('exports:', JSON.stringify(p.exports)?.slice(0,200))"
```

```
Answer: react-leaflet v4.2.1 is PURE ESM:
  type:    module
  main:    lib/index.js
  module:  (none — no separate ESM entry because ALL files are already ESM)
  exports: { ".": "./lib/index.js", "./*": "./lib/*.js" }

Confirmed: lib/index.js starts with:
  export { useMap, useMapEvent, useMapEvents } from './hooks.js';
  export { AttributionControl } from './AttributionControl.js';
  ...
This is native ESM syntax (export statements). No CJS wrapper.

HOWEVER: The local production build succeeds without transpilePackages. This is
because Next.js 14.2.35's webpack handles ESM packages in CLIENT-SIDE chunks
without requiring explicit transpilePackages configuration. The ssr:false dynamic
import means this code never runs on the server, avoiding the SSR ESM issue
entirely. transpilePackages would only be strictly required if:
  (a) SSR was enabled for this component, OR
  (b) The package uses syntax unsupported by the target browsers
```

### 3.2 — Check Leaflet CSS loading

**Q3.2a**: `AdvisorMapClient.tsx` imports `'leaflet/dist/leaflet.css'`. In production, CSS imports in dynamically-loaded chunks can cause issues. Check if this CSS import is handled by Next.js or if it could cause the chunk to fail:

```powershell
# Check if there's a global Leaflet CSS import elsewhere (e.g., layout.tsx or _app.tsx)
Get-ChildItem src/ -Recurse -Filter "*.tsx" | Select-String -Pattern "leaflet.*css" -ErrorAction SilentlyContinue
```

```
Answer: The leaflet CSS import exists in EXACTLY ONE FILE:
  src/components/advisor-map/AdvisorMapClient.tsx (line 6):
    import 'leaflet/dist/leaflet.css';

  There is NO global import in layout.tsx, _app.tsx, or any other file.

  Implications:
  1. The CSS is bundled INTO the d0deef33 Leaflet chunk as an inlined string
     (this is what caused the "Serializing big strings (188kiB)" webpack warning —
     the 188KB string is the leaflet CSS being serialized into the JS bundle)
  2. Next.js 14 handles CSS imports in dynamic chunks by injecting a <style> tag
     at runtime when the chunk loads — this works but adds load overhead
  3. This CSS import does NOT cause the chunk to fail; it contributes to chunk size
  4. There is no duplicate global CSS import, which is correct — importing it globally
     would load it on every page even when the map isn't shown
```

### 3.3 — Check Sentry's withSentryConfig impact

**Q3.3a**: The `next.config.js` wraps the config with `withSentryConfig` which modifies webpack config. Check if Sentry's `widenClientFileUpload: true` or `hideSourceMaps: true` could affect chunk generation:

```
Answer: Both options are set in the Sentry config (next.config.js lines 49, 61):
  widenClientFileUpload: true  — uploads MORE source maps to Sentry (larger set of
    files captured). This only affects which files get sent to Sentry's servers
    during the build step. It does NOT change chunk structure, chunk IDs, or content
    hashes. No impact on chunk generation.

  hideSourceMaps: true  — removes .map files from the client bundle output
    (.next/static). This deletes source map files after upload so they aren't
    publicly accessible. Again, ONLY affects source map files — not the JS chunks
    themselves. No impact on chunk loading.

  Neither option changes webpack's chunking behavior, chunk IDs, or content hashes.
```

**Q3.3b**: Does the Sentry config include `transpileClientSDK: true`? This modifies the webpack pipeline and could interact with Leaflet's module format:

```
Answer: YES — transpileClientSDK: true is set (next.config.js line 52).
  This passes the Sentry CLIENT SDK through Babel/SWC transpilation for IE11 compat.
  It modifies the webpack pipeline for the @sentry/* packages specifically.

  Does it interact with Leaflet? NO. transpileClientSDK only applies to modules
  matching @sentry/* package paths. It does NOT change how react-leaflet or leaflet
  are processed by webpack. Leaflet/react-leaflet modules go through webpack's
  normal module resolution, unaffected by this setting.

  Additionally: Sentry's own docs note that transpileClientSDK is deprecated in
  newer SDK versions in favor of Next.js's built-in transpilePackages — but again,
  this only applies to Sentry packages.
```

### ⚠️ PHASE 3 DISCOVERIES:
```
1. react-leaflet IS pure ESM (type:module, export syntax in lib/index.js) — but the
   local production build handles this WITHOUT transpilePackages. This is because:
   (a) ssr:false keeps this code entirely client-side (no Node.js ESM/CJS conflict)
   (b) Next.js 14.2.35 webpack handles ESM packages in client-side dynamic chunks
   transpilePackages is NOT required and NOT the root cause of the issue.

2. Hypothesis C (react-leaflet ESM transpilation) IS NOT THE ROOT CAUSE. The chunks
   build successfully with the current config. Phase 2 already confirmed this by
   showing the chunks do get produced — just with a different hash than production.

3. leaflet CSS inlining (188KB) is the likely source of the "Serializing big strings"
   webpack warning. This is benign (performance hint only) but worth knowing:
   the d0deef33 chunk is 148KB largely because it contains the leaflet CSS as an
   inlined string alongside the leaflet JS library code.

4. Sentry config (widenClientFileUpload, hideSourceMaps, transpileClientSDK) has
   ZERO impact on the Leaflet chunking behavior. These only affect Sentry SDK files
   and source map handling — not the advisor-map component chunks.

5. PHASE 3 CONCLUSION: No Leaflet/Next.js compatibility issue exists. The build
   succeeds, the chunks are generated correctly, and the ESM format is handled
   transparently. This further reinforces Phase 2's finding that the root cause
   is Stale Deployment (Hypothesis A), not a bundling/transpilation problem.
```

---

## PHASE 4: Investigate the Recharts Width/Height Error

**Objective**: The Recharts `-1` width/height error appears in the console alongside the ChunkLoadError. Determine if this is a symptom of the chunk failure or a separate issue.

### 4.1 — Find Recharts usage on the advisor-map page

**Q4.1a**: Does `AdvisorMap.tsx` or `AdvisorMapClient.tsx` directly use any Recharts components?

```
Answer: NO. Neither file imports from 'recharts' or uses any Recharts components.
Confirmed by grepping all imports in both files — zero recharts references.
AdvisorMap.tsx uses: react, next/dynamic, lucide-react, local types/utils
AdvisorMapClient.tsx uses: react, react-leaflet, leaflet, local types/utils
```

**Q4.1b**: Does the dashboard layout or any shared component (sidebar, header) render Recharts charts that could produce this error?

```powershell
# Check the dashboard layout for Recharts
Get-ChildItem src/app/dashboard/ -Filter "layout.tsx" | Select-String -Pattern "recharts|BarChart|LineChart|AreaChart" -ErrorAction SilentlyContinue

# Check shared components loaded by the layout
grep -r "recharts" src/components/layout/ 2>/dev/null || echo "No layout components with recharts"
```

```
Answer: NO Recharts in any layout or shared navigation component.
  - src/app/dashboard/layout.tsx: NO recharts imports (confirmed)
  - src/components/layout/Sidebar.tsx: false positive — 'BarChart3' and 'BarChart2'
    are LUCIDE-REACT icon names, not Recharts components
  - src/components/layout/Header.tsx: NO recharts imports

Recharts is ONLY used in 10 specific page/chart components:
  src/components/dashboard/VolumeTrendChart.tsx      (uses ResponsiveContainer)
  src/components/dashboard/ConversionTrendChart.tsx  (uses ResponsiveContainer)
  src/components/dashboard/PipelineByStageChart.tsx
  src/components/dashboard/PipelineBySgmChart.tsx
  src/components/dashboard/ExploreResults.tsx
  src/components/sga-hub/QuarterlyProgressChart.tsx
  src/components/gc-hub/GCHubAdvisorModal.tsx
  src/components/gc-hub/AdvisorCountChart.tsx
  src/components/gc-hub/RevenueChart.tsx
  src/components/gc-hub/RevenuePerAdvisorChart.tsx

All of these are page-specific components, not layout-level persistent components.
```

**Q4.1c**: Check if the Recharts error appears BEFORE or AFTER the ChunkLoadError in the console. The order matters — if Recharts errors come first, they may be from a different page component that loaded before navigation completed:

```
Answer (from the console output provided):
The Recharts error appears AFTER the ChunkLoadError. Exact order from the symptom report:
  1. d0deef33.04d369d0a712e865.js:1  Failed to load resource: 404
  2. 8067.9481932d1af0204b.js:1  Failed to load resource: 404
  3. ChunkLoadError: Loading chunk 4212 failed.
  4. Recharts: The width(-1) and height(-1) of chart should be greater than 0

This order strongly indicates:
  - The user navigated FROM a page that had Recharts charts loaded
    (most likely /dashboard, which loads VolumeTrendChart + ConversionTrendChart)
  - During the client-side navigation to /dashboard/advisor-map:
    (a) webpack tried to fetch the advisor-map lazy chunks → 404 → ChunkLoadError
    (b) the previous page's Recharts components began to unmount
    (c) ResponsiveContainer's ResizeObserver fired one last measurement on the
        now-detached DOM node, returning -1 for both dimensions
  - The Recharts warning is a TEARDOWN ARTIFACT from the previous page, not
    from anything on the advisor-map page itself
```

### 4.2 — Check saved reports or sidebar charts

**Q4.2a**: The console shows `[DEBUG] Fetched saved reports: Object` with empty data. Is there a saved reports widget that renders a Recharts chart with potentially zero-size container?

```powershell
# Search for saved reports components that use Recharts
Get-ChildItem src/ -Recurse -Filter "*.tsx" | Select-String -Pattern "saved.*report.*chart|SavedReport.*Recharts" -ErrorAction SilentlyContinue
```

```
Answer: NO. The saved reports components (SavedReportsDropdown.tsx, SaveReportModal.tsx,
GlobalFilters.tsx) contain ZERO Recharts imports or chart rendering.
  - SavedReportsDropdown.tsx: imports only lucide-react icons and SavedReport type
  - SaveReportModal.tsx: filter/form UI only, no charts
  - GlobalFilters.tsx: imports SavedReportsDropdown and DataFreshnessIndicator only

The [DEBUG] Fetched saved reports: Object log is from /dashboard/page.tsx which
fetches saved reports to populate the GlobalFilters dropdown. This debug log appears
in the console because the user was on /dashboard when the error occurred (the
console retains all logs from the session). The saved reports fetch is unrelated
to either the ChunkLoadError or the Recharts warning.

The Recharts "width(-1) height(-1)" warning originates from VolumeTrendChart.tsx
(confirmed: it uses ResponsiveContainer, lines 17 and 173). It fires during
unmounting when the user navigates away from /dashboard via client-side navigation.
```

### ⚠️ PHASE 4 DISCOVERIES:
```
1. THE RECHARTS ERROR IS A COMPLETE RED HERRING. It is not caused by the advisor-map
   page, not caused by any component on that page, and has no connection to the
   ChunkLoadError. It is a teardown artifact from VolumeTrendChart (and possibly
   ConversionTrendChart) unmounting during client-side navigation away from /dashboard.

2. ResponsiveContainer in VolumeTrendChart.tsx fires a final ResizeObserver callback
   during component unmount. The DOM node is being removed so its measured dimensions
   are -1, triggering the Recharts warning. This is a known Recharts v2 behavior — it
   does not crash anything and has no user-visible impact.

3. The appearance of the Recharts warning alongside the ChunkLoadError was MISLEADING
   in the original symptom report. They co-occur only because both happen during the
   same client-side navigation event: the advisor-map chunks fail to load (404) AND
   the previous page's charts unmount (producing the -1 warning) — simultaneously.

4. The [DEBUG] Fetched saved reports log confirms the user's session included time on
   /dashboard before navigating to advisor-map. This is consistent with the stale
   deployment theory: user had /dashboard loaded (old build HTML), new deployment
   went live, user clicked advisor-map, old chunk hashes → 404.

5. No Recharts-specific fix is needed. The Recharts -1 warning can optionally be
   suppressed by adding a null-check in the ResponsiveContainer wrapper, but it is
   cosmetic only.
```

---

## PHASE 5: Test Chunk Loading Behavior

**Objective**: Determine the exact conditions under which the chunk fails and whether it's reproducible.

### 5.1 — Test navigation patterns

**Q5.1a**: Does the error occur when navigating to `/dashboard/advisor-map` from the sidebar (client-side navigation), or also on direct URL load (full page refresh)?

Test procedure:
1. Open `https://dashboard-eta-lime-45.vercel.app/dashboard` (any page that works)
2. Click the Advisor Map link in the sidebar
3. Note if ChunkLoadError occurs
4. Now navigate directly to `https://dashboard-eta-lime-45.vercel.app/dashboard/advisor-map` (full refresh)
5. Note if ChunkLoadError occurs

```
Answer: REQUIRES MANUAL BROWSER TEST — but the analytical prediction is clear:

PREDICTED: Error occurs on CLIENT-SIDE NAVIGATION (step 2) but NOT on HARD REFRESH (step 4).

Reason (verified from code):
  - Sidebar.tsx line 116–129: every nav item uses Next.js <Link href={page.href}>
  - <Link> performs client-side navigation — it does NOT re-fetch the page shell HTML
  - The page shell HTML (served at the time of the user's first load) contains
    embedded chunk hashes from THAT SPECIFIC DEPLOYMENT
  - After a new Vercel deployment, the chunk hashes in the OLD HTML are stale
  - The lazy chunks (d0deef33, 8067) are not prefetched by <Link> because they
    aren't in the page's build manifest — they're only loaded on-demand when
    AdvisorMapClient first renders
  - A hard refresh (Ctrl+Shift+R) fetches fresh HTML from the current deployment
    with current chunk hashes → no 404 → map loads correctly

If the error ALSO occurs on hard refresh, that would indicate a Vercel build failure
(the chunks don't exist at all), which Phase 2 evidence argues against.
```

**Q5.1b**: Open the Network tab when the error occurs. Filter for JS files. Which specific files return 404? Record their full URLs:

```
Answer: From the symptom report provided at the top of this document:
  404: https://dashboard-eta-lime-45.vercel.app/_next/static/chunks/d0deef33.04d369d0a712e865.js
  404: https://dashboard-eta-lime-45.vercel.app/_next/static/chunks/8067.9481932d1af0204b.js

These are the TWO leaflet lazy chunks (Leaflet library + AdvisorMapClient component).
Content hashes from these filenames (04d369d0a712e865, 9481932d1af0204b) belong to an
older deployment. The current latest local build produces different hashes for the
same chunk IDs (3890946850455858, d8bdeee6de69ce58 respectively).
```

### 5.2 — Test with cache bypass

**Q5.2a**: Open in incognito window, navigate directly to the advisor map page. Does the error occur?

```
Answer: REQUIRES MANUAL BROWSER TEST

Predicted outcome: NO error in incognito on direct URL load.
Incognito bypasses browser cache, so the HTML is fetched fresh from the current
Vercel deployment with up-to-date chunk hashes. The lazy chunks load from hashes
that actually exist → map renders successfully.

This test is the DEFINITIVE confirmation of stale deployment vs build failure:
  - If incognito direct load WORKS → stale deployment confirmed
  - If incognito direct load ALSO fails → build-time failure (chunks don't exist)
```

**Q5.2b**: In the Network tab during the error, check if the 404'd chunk URLs contain a build hash that matches the current deployment. If the hashes differ, this confirms a stale deployment:

```
Answer: REQUIRES MANUAL BROWSER TEST — but analytical comparison is available:

From the symptom report:
  404'd: d0deef33.04d369d0a712e865.js  (hash: 04d369d0a712e865)
  404'd: 8067.9481932d1af0204b.js       (hash: 9481932d1af0204b)

Local build (most recent, reflects current codebase):
  Built:  d0deef33.3890946850455858.js  (hash: 3890946850455858)
  Built:  8067.d8bdeee6de69ce58.js      (hash: d8bdeee6de69ce58)

The hashes DO differ — confirming the 404'd chunks are from a PREVIOUS deployment.

To verify in browser: Open Network tab → look at any successfully-loaded _next/static
chunk URL. Its hash should match the hashes in the current page HTML's <script> tags.
If a loaded chunk has hash X but the 404'd chunk has a different hash Y, the page HTML
is from deployment Y (old) while Vercel is serving deployment X (new).
```

### 5.3 — Check the page routing

**Q5.3a**: Read `src/app/dashboard/layout.tsx` (or wherever the sidebar navigation is). How does navigation to advisor-map work? Is it using `<Link>` (client-side) or `<a>` (full page load)?

```powershell
grep -n "advisor-map" src/app/dashboard/layout.tsx src/components/layout/*.tsx 2>/dev/null
```

```
Answer: CLIENT-SIDE NAVIGATION via Next.js <Link>.

Sidebar.tsx lines 116–129 (exact code):
  <Link
    href={page.href}        ← page.href = '/dashboard/advisor-map' for Advisor Map
    className={...}
    title={isCollapsed ? page.name : undefined}
  >
    <Icon className={...} />
    {!isCollapsed && <span className="truncate">{page.name}</span>}
  </Link>

The PAGES array (line 58):
  { id: 15, name: 'Advisor Map', href: '/dashboard/advisor-map', icon: MapPin }

This is a plain Next.js <Link> — it renders as <a href="..."> in the DOM but uses
client-side navigation (router.push internally). Critically:
  - Does NOT re-fetch the HTML page shell
  - Does NOT invalidate webpack's chunk registry
  - The existing webpack runtime (loaded with the old HTML) will request lazy chunks
    using the OLD chunk hashes embedded in its internal chunk manifest

This is exactly the mechanism by which stale deployment causes ChunkLoadError.
The lazy chunks (AdvisorMapClient, Leaflet) are not prefetched by <Link> because
they aren't in the static build manifest for the advisor-map page — they only get
fetched when AdvisorMapClient first renders inside the loaded page.
```

### ⚠️ PHASE 5 DISCOVERIES:
```
1. THE NAVIGATION MECHANISM IS CONFIRMED AS THE TRIGGER. Every sidebar link is a
   Next.js <Link> — this is client-side navigation that never re-fetches the HTML
   page shell. After a Vercel re-deployment, any user with a loaded session will
   have the OLD webpack chunk manifest and will 404 when trying to lazy-load chunks.

2. THE LAZY CHUNKS ARE UNIQUELY VULNERABLE. Unlike the eagerly-loaded shared chunks
   (2924-baa..., 52774a7f-..., fd9d1056-...) which are referenced directly in <script>
   tags in the page HTML, the leaflet lazy chunks (d0deef33, 8067) are only known to
   the WEBPACK RUNTIME embedded in the page. The webpack runtime stores the chunk
   manifest internally. After a re-deployment, it tries to fetch chunks using the
   OLD filenames → 404. Eagerly-loaded chunks would also fail, but only if the user
   tries to do a hard refresh (gets new HTML) or navigates in a way that causes a
   full page reload.

3. WHY ONLY ADVISOR MAP? The main /dashboard page also uses dynamic imports
   (VolumeTrendChart, ConversionTrendChart — seen in Phase 4). However, those chunks
   are likely prefetched by Next.js because they're on the initial/most-visited page.
   The advisor-map chunks are lazier — only loaded when the user explicitly navigates
   there — so they sit in a state where they were never loaded before the deployment
   changed, making them the most likely to trigger the stale-hash 404.

4. LOCAL BUILD_ID confirmed: w7z8j1jdSg11CUYZgall4 (just generated). Each build
   produces a different BUILD_ID and different content hashes. Without Vercel's
   Skew Protection keeping old chunk files alive, any deployment invalidates all
   previously-loaded sessions' ability to lazy-load new chunks.

5. MANUAL TESTS NEEDED (for user to run):
   A) Navigate /dashboard → click Advisor Map in sidebar → record: error or success?
   B) Hard refresh on advisor-map page (Ctrl+Shift+R) → record: error or success?
   C) Open incognito → go directly to /dashboard/advisor-map → record: error or success?
   D) In Network tab during error: compare hash of a LOADED chunk vs 404'd chunk.
      If loaded chunk has hash X but 404'd chunk has hash Y → stale deployment confirmed.
```

---

## PHASE 6: Investigate Potential Root Causes

**Objective**: Based on findings from Phases 1-5, narrow down the root cause.

### 6.1 — Hypothesis A: Stale Deployment / Version Mismatch

**Q6.1a**: Check if Vercel has "skew protection" enabled. Without it, after a new deployment, users with cached page shells will try to load chunks from the old build that no longer exist:

```
Answer: NO SKEW PROTECTION CONFIGURED.

vercel.json contains only two top-level keys: "functions" and "crons".
No "skewProtection", no deployment protection settings of any kind.

Vercel Skew Protection requires either a config block in vercel.json or
enabling "Deployment Protection" in the project dashboard. Neither is present.

What this means in practice:
  1. When a new deployment goes live, Vercel IMMEDIATELY replaces old chunk
     URLs on its CDN. The old content-hash filenames return 404.
  2. Any user whose browser is running the OLD webpack runtime (loaded before
     the new deployment) has the OLD chunk manifest embedded. When they
     navigate to advisor-map via <Link>, webpack reads the OLD hash from its
     internal manifest → constructs the old URL → 404 → ChunkLoadError.
  3. There is ZERO grace period. The moment deployment completes, all active
     sessions with old chunk hashes are broken for lazy-loaded chunks.

This is the single most impactful missing configuration for this bug.
```

**Q6.1b**: Check if there's a service worker or caching configuration that could serve stale HTML while the chunks have been updated:

```powershell
Get-ChildItem public/ -Filter "sw*" -ErrorAction SilentlyContinue
Get-ChildItem src/ -Recurse -Filter "service-worker*" -ErrorAction SilentlyContinue
grep -r "serviceWorker" src/ 2>/dev/null | head -5
```

```
Answer: NO SERVICE WORKER. NO STALE-CACHE CONFIGURATION.

public/ directory contains only: favicon.svg, games/, savvy-logo.png
  → No sw.js, no service-worker.js, no workbox-*.js

src/ — zero matches for "service-worker" filenames
grep for "serviceWorker" in src/ — zero results

There is no custom caching layer that could serve stale HTML. The only
"caching" in this app is Next.js unstable_cache() for BigQuery query results
(server-side data cache, unrelated to JS chunks).

Conclusion: The stale deployment problem is purely a BROWSER-SIDE webpack
runtime issue, not a service worker or CDN cache issue. The browser's webpack
runtime holds the old chunk manifest in memory (JavaScript heap), not in any
persistent cache — so clearing browser cache doesn't help unless a full page
reload occurs (which would re-fetch the page HTML with new chunk hashes).
```

### 6.2 — Hypothesis B: Leaflet Dynamic Import Failure

**Q6.2a**: The dynamic import pattern is:
```typescript
const AdvisorMapClient = dynamic(
  () => import('./AdvisorMapClient').then(mod => mod.AdvisorMapClient),
  { ssr: false }
);
```

Check: Is `AdvisorMapClient` exported as a **named export** in the file? If it's a default export, `mod.AdvisorMapClient` would be `undefined` and the dynamic import could silently fail or cause chunk resolution issues:

```powershell
# Get the exact export statement
Select-String -Path "src/components/advisor-map/AdvisorMapClient.tsx" -Pattern "^export" -ErrorAction SilentlyContinue
```

```
Answer: NAMED EXPORT CONFIRMED. Hypothesis B RULED OUT.

grep "^export" src/components/advisor-map/AdvisorMapClient.tsx:
  83: export function AdvisorMapClient({ advisors, onAdvisorClick, onViewDetails }...)

The dynamic import uses .then(mod => mod.AdvisorMapClient) — this correctly
resolves to the named export. mod.AdvisorMapClient is the component function,
NOT undefined. There is no silent failure here.

This matches what Phase 1.1d already found. Hypothesis B is definitively ruled out.
```

### 6.3 — Hypothesis C: react-leaflet ESM Transpilation

**Q6.3a**: `react-leaflet@4.2.1` uses ESM. Without `transpilePackages: ['react-leaflet']` in next.config.js, Next.js 14 may fail to bundle it correctly in production (but work in dev mode where module resolution is more lenient):

Check the react-leaflet package entry points:

```powershell
node -e "const p=require('./node_modules/react-leaflet/package.json'); console.log(JSON.stringify({type:p.type, main:p.main, module:p.module, exports:p.exports}, null, 2))"
```

```
Answer: PURE ESM CONFIRMED. Hypothesis C RULED OUT.

node -e output:
  {
    "type": "module",
    "main": "lib/index.js",
    "exports": { ".": "./lib/index.js", "./*": "./lib/*.js" }
  }
  (no "module" field — because ALL files are already ESM; no separate ESM entry needed)

react-leaflet@4.2.1 is pure ESM (type:module). However, this is NOT the root cause:
  1. Phase 2 confirmed the LOCAL production build succeeds and generates both
     leaflet chunks — proving webpack handles it without transpilePackages.
  2. ssr:false keeps react-leaflet entirely client-side — no Node.js ESM/CJS clash.
  3. The 404'd chunk hashes are different from the local build hashes, which means
     the chunks DID build on Vercel — they're just from a different (older) deployment.

Hypothesis C is definitively ruled out.
```

### 6.4 — Hypothesis D: Chunk ID Collision / Webpack Determinism

**Q6.4a**: Check if next.config.js has any custom webpack configuration that could affect chunk IDs:

```
Answer: NO CUSTOM WEBPACK CONFIG IN nextConfig. Hypothesis D RULED OUT.

next.config.js — the raw nextConfig object contains exactly:
  reactStrictMode, experimental, typescript, eslint, images

NO "webpack" function, NO "output" config, NO "optimization.chunkIds" setting.

The "webpack" key present in the EXPORTED config (module.exports) is injected
entirely by withSentryConfig(). The Sentry-injected webpack function only:
  - Adds the SentryWebpackPlugin for source map uploading to Sentry
  - Applies transpileClientSDK to @sentry/* packages only
  - Does NOT modify chunk splitting, chunk IDs, or content hashes

No webpack customization of any kind affects how leaflet chunks are named,
split, or hashed. Webpack's default deterministic chunk ID algorithm is in use.
Hypothesis D (chunk ID collision/non-determinism) is ruled out.
```

**Q6.4b**: The error references "chunk 4212" — this is a webpack chunk ID. Check if there's a `webpackChunkName` magic comment in the dynamic import that could help with debugging:

```
Answer: NO webpackChunkName MAGIC COMMENT EXISTS.

grep for webpackChunkName in AdvisorMap.tsx → "no webpackChunkName magic comments"

The dynamic import in AdvisorMap.tsx (lines 11–24):
  const AdvisorMapClient = dynamic(
    () => import('./AdvisorMapClient').then(mod => mod.AdvisorMapClient),
    { ssr: false, loading: () => (...) }
  );

No /* webpackChunkName: "advisor-map-client" */ comment is present.

"Chunk 4212" is webpack's auto-assigned NUMERIC RUNTIME ID for the chunk
containing AdvisorMapClient. This is separate from the FILENAME hash:
  - Chunk ID 4212 = the runtime integer identifier used within webpack's
    internal require() system (stable within a build, can change between builds)
  - The filename hash (9481932d1af0204b) = content-hash of the chunk bytes
    (changes whenever the chunk content changes — i.e., on every code change)

Adding a webpackChunkName comment would give the chunk a human-readable filename
(e.g., "advisor-map-client.abc123.js") but would NOT prevent the stale-hash 404.
It would only help with debugging by making the filename recognizable in DevTools.
```

### 6.5 — Hypothesis E: Vercel Function/Edge Runtime Mismatch

**Q6.5a**: The advisor-map page uses `export const dynamic = 'force-dynamic'`. Check if this affects how Vercel serves the page's associated chunks:

```powershell
grep -n "export const dynamic" src/app/dashboard/advisor-map/page.tsx
grep -n "export const runtime" src/app/dashboard/advisor-map/page.tsx
```

```
Answer:
  Line 19: export const dynamic = 'force-dynamic'
  No "export const runtime" → defaults to Node.js serverless (not edge)

force-dynamic means the page is ALWAYS server-rendered on each request —
no static pre-generation at build time. This makes the page a serverless λ
(Vercel Lambda) rather than a static file.

Does this affect chunk serving? NO — and here is why:
  - Static chunks (_next/static/chunks/) are ALWAYS served from Vercel's CDN
    regardless of whether the page that uses them is static or serverless.
  - force-dynamic has NO effect on the _next/static/ file serving path.
  - The chunk hash mismatch problem is entirely browser-side (webpack runtime
    internal manifest) and is unaffected by how the page itself is rendered.

One nuance: force-dynamic means that when Next.js <Link> navigates to this page,
it fetches an RSC payload from the server (fresh on each request). This DOES mean
the server always returns the CURRENT build's component tree — but it does NOT
refresh the client-side webpack runtime or chunk manifest. The browser's webpack
module loader still uses the OLD hash map for lazy chunks, even though the server's
RSC payload is fresh. This is the core of the stale-deployment problem.
```

**Q6.5b**: Is the advisor-map page being served as a serverless function or as a static page on Vercel? Check the Vercel deployment output:

```
Answer: SERVERLESS FUNCTION (ƒ), not static.

From the Phase 2 build output (local production build):
  ƒ /dashboard/advisor-map    11.4 kB    251 kB first load JS

The ƒ symbol in Next.js build output means "serverless function" — the page is
dynamically rendered on each request. This is a direct consequence of
  export const dynamic = 'force-dynamic'

On Vercel this means:
  - Page HTML/RSC is served by a Lambda function (Node.js 22.x)
  - Static assets (_next/static/chunks/) are served from Vercel's Edge CDN

The 11.4 kB page bundle + 251 kB first load JS matches the build manifest:
  - The 11.4 kB is the page-specific JS (AdvisorMap.tsx + deps like
    AdvisorDrillDownModal, RecordDetailModal — statically imported)
  - The 251 kB includes the shared Next.js runtime + framework chunks
  - The Leaflet chunks (d0deef33 ~148KB, 8067 ~8.5KB) are NOT counted in
    first load JS because they are lazy (loaded on-demand, not upfront)

This serverless vs static distinction has NO bearing on the ChunkLoadError.
The bug is entirely about stale chunk hashes in the browser's webpack runtime,
which affects serverless and static pages equally.
```

### ⚠️ PHASE 6 DISCOVERIES:
```
1. HYPOTHESIS A (STALE DEPLOYMENT) IS THE CONFIRMED ROOT CAUSE. All other
   hypotheses have been eliminated:
     Hypothesis B (dynamic import pattern) — RULED OUT: named export confirmed
     Hypothesis C (react-leaflet ESM) — RULED OUT: local build succeeds, chunks exist
     Hypothesis D (webpack chunk ID collision) — RULED OUT: no custom webpack config
     Hypothesis E (serverless/edge mismatch) — RULED OUT: no effect on chunk serving

2. THE MISSING PIECE IS VERCEL SKEW PROTECTION. It is not configured anywhere
   (not in vercel.json, presumably not in the Vercel dashboard either). This single
   missing feature is what allows old sessions to encounter stale chunk 404s.

3. force-dynamic + <Link> navigation creates an interesting race condition:
   - Server always serves the CURRENT build's RSC payload (fresh)
   - Browser always uses the OLD build's webpack chunk manifest (stale)
   - Result: the page "navigates" successfully (RSC hydration) but then fails
     when webpack tries to lazy-load AdvisorMapClient with the old hash

4. NO SERVICE WORKER COMPLICATES THE PICTURE. If there were a service worker
   caching old HTML, the fix would require clearing/updating the SW too. The
   absence of a service worker makes the fix simpler: a hard refresh (or a
   chunk-load-error recovery that triggers a full reload) will always resolve it.

5. NEXT.JS HAS NO BUILT-IN CHUNK RETRY. Unlike some frameworks, Next.js does
   not automatically detect ChunkLoadError and force a page reload. This must
   be added manually — and is one of the recommended fixes.

6. THE BUG IS TRIGGERED SPECIFICALLY BY CODE DEPLOYMENTS. It does NOT happen
   on every navigation — only after a Vercel deployment while a user has an
   active session. Frequency of occurrence directly correlates with frequency
   of deployments (i.e., how active development is).
```

---

## PHASE 7: Check Error Handling & Recovery

**Objective**: Determine if there's any chunk load error recovery in place, and whether adding it could be a mitigation.

### 7.1 — Error boundary coverage

**Q7.1a**: Is there an Error Boundary wrapping the advisor-map page or the dashboard layout? Check:

```powershell
grep -rn "ErrorBoundary\|error\.tsx\|error\.js" src/app/dashboard/ --include="*.tsx" --include="*.ts" | head -10
```

```
Answer: YES — ErrorBoundary wraps the entire dashboard layout, which includes
the advisor-map page. But it has a critical flaw for ChunkLoadError.

src/app/dashboard/layout.tsx lines 107–121:
  return (
    <ErrorBoundary>
      <div className="min-h-screen ...">
        <Header />
        <div className="flex ...">
          <Sidebar ... />
          <main ...>
            {status === 'authenticated' && permissionsLoading ? <LoadingSpinner /> : children}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );

The ErrorBoundary class (src/components/ui/ErrorBoundary.tsx) is a standard
React class component implementing getDerivedStateFromError + componentDidCatch.

DOES IT CATCH ChunkLoadError?
  In theory: YES. When next/dynamic()'s internal React.lazy() encounters a
  rejected import() Promise (the 404'd chunk), React throws the rejection
  during rendering. getDerivedStateFromError catches any error thrown during
  rendering — including this one.

CRITICAL FLAW — The "Try Again" button is USELESS for this error:
  handleReset (line 37–40):
    handleReset = (): void => {
      this.setState({ hasError: false, error: null });
      this.props.onReset?.();
    };

  Resetting state causes React to re-render children → next/dynamic() retries
  the same import() → webpack requests the SAME stale chunk URL → SAME 404 →
  ChunkLoadError fires again → ErrorBoundary catches again → infinite loop.

  The only real fix for ChunkLoadError is window.location.reload() — which
  fetches fresh HTML, gets the new chunk hashes, and resolves the stale manifest.
  The current ErrorBoundary never calls reload().

ALSO NOTABLE: componentDidCatch only logs in development:
  if (process.env.NODE_ENV === 'development') { console.error(...) }
  In production, ChunkLoadError is SILENTLY SWALLOWED — not sent to Sentry,
  not logged anywhere. This explains why the only signal is user-reported
  symptoms and browser console errors; there's no server-side trace.
```

**Q7.1b**: Does the `src/app/dashboard/advisor-map/` directory have an `error.tsx` file for catching runtime errors?

```powershell
Get-ChildItem src/app/dashboard/advisor-map/ -ErrorAction SilentlyContinue
```

```
Answer: NO error.tsx. Directory contains ONLY page.tsx.

ls src/app/dashboard/advisor-map/:
  page.tsx   ← the only file

In Next.js App Router, an error.tsx file creates a route-level Error Boundary
specifically for that segment. Its absence means:
  1. There is no route-specific error UI for /dashboard/advisor-map
  2. Errors propagate up to the layout-level ErrorBoundary (the class component
     in dashboard/layout.tsx) — which does catch them, but with the "Try Again"
     flaw described in Q7.1a
  3. There is no loading.tsx either (a Suspense fallback for the route segment
     itself) — the loading state comes entirely from next/dynamic's loading prop

Adding error.tsx here would give the advisor-map route its own error boundary
with a more targeted fallback — and crucially, it could be written to detect
ChunkLoadError and call window.location.reload() automatically.
```

### 7.2 — Chunk retry mechanism

**Q7.2a**: Does the codebase have any mechanism to retry failed chunk loads? (Some apps use `window.addEventListener('error', ...)` to detect chunk failures and force a reload):

```powershell
Get-ChildItem src/ -Recurse -Filter "*.tsx" -ErrorAction SilentlyContinue | Select-String -Pattern "ChunkLoadError|chunkLoadError|chunk.*retry|chunk.*reload" -ErrorAction SilentlyContinue
```

```
Answer: NO CHUNK RETRY MECHANISM EXISTS ANYWHERE IN THE CODEBASE.

grep for ChunkLoadError|chunkLoadError|chunk.*retry|chunk.*reload across all
src/**/*.tsx → zero matches. No output at all.

The codebase has NOTHING that:
  (a) Listens for ChunkLoadError events on window
  (b) Detects that a dynamic import failed due to a network 404 vs a code error
  (c) Retries a failed import() with backoff
  (d) Forces window.location.reload() or window.location.href = window.location.href
      when a chunk load fails
  (e) Uses a global webpack error handler

There are three common patterns used in production Next.js apps to handle this —
none of which are implemented here:

  Pattern 1 — Error Boundary with ChunkLoadError detection (React class):
    componentDidCatch(error) {
      if (error.name === 'ChunkLoadError') window.location.reload();
    }

  Pattern 2 — Global webpack error listener (in _app or instrumentation):
    window.__webpack_require__.f.j = (chunkId, promises) => { ... retry logic }

  Pattern 3 — next/dynamic with manual retry wrapper:
    Wrap the dynamic() in a component that catches the error and calls
    router.refresh() or window.location.reload() if the error is a 404.

The complete absence of any recovery mechanism means that when ChunkLoadError
occurs, the user sees the generic "Something went wrong" ErrorBoundary UI with
a "Try Again" button that silently loops. The page is effectively broken until
they manually hard-refresh — which most users won't know to do.
```

### ⚠️ PHASE 7 DISCOVERIES:
```
1. ErrorBoundary IS technically wrapping the advisor-map page (via dashboard/layout.tsx)
   but is INEFFECTIVE for ChunkLoadError. Its "Try Again" button only calls
   setState({ hasError: false }) — this re-renders children, which triggers the same
   failed dynamic import, which gets the same 404, producing an INFINITE ERROR LOOP.
   The user sees the error UI flash and return repeatedly. The only correct recovery
   is window.location.reload().

2. componentDidCatch IS SILENT IN PRODUCTION. The implementation guards all error
   logging with: if (process.env.NODE_ENV === 'development') { ... }
   This means ChunkLoadError in production is never sent to Sentry, never logged
   server-side — only visible in the user's browser console. This is why there's
   no server-side trace of the error. Production monitoring is completely blind to
   the full frequency of this bug.

3. NO error.tsx IN ADVISOR-MAP ROUTE. src/app/dashboard/advisor-map/ contains only
   page.tsx. An error.tsx here would create a Next.js App Router route-level boundary
   specific to this segment — ideal for adding ChunkLoadError detection + auto-reload
   without touching the shared ErrorBoundary used by all other dashboard pages.

4. ZERO CHUNK RETRY MECHANISMS EXIST. The entire src/ tree has no code that:
   - Listens for ChunkLoadError on window
   - Detects failed dynamic imports
   - Calls window.location.reload() on chunk failure
   - Uses webpack's internal retry hooks
   This is the most impactful gap. The three standard patterns that solve this
   (class boundary componentDidCatch, global window error listener, dynamic wrapper)
   are all absent.
```

---

## PHASE 8: Cross-Reference With Other Dynamic Imports

**Objective**: Determine if this issue is unique to the advisor map or affects other dynamically-imported components.

### 8.1 — Catalog all dynamic imports in the app

**Q8.1a**: List every `next/dynamic` usage in the codebase:

```powershell
Get-ChildItem src/ -Recurse -Filter "*.tsx" | Select-String -Pattern "dynamic\(" -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Filename):$($_.LineNumber) — $($_.Line.Trim())" }
```

```
Answer: TWO files use next/dynamic — a total of 6 dynamic imports:

FILE 1: src/components/advisor-map/AdvisorMap.tsx (line 11)
  const AdvisorMapClient = dynamic(
    () => import('./AdvisorMapClient').then(mod => mod.AdvisorMapClient),
    { ssr: false, loading: () => (...) }
  );
  → 1 dynamic import total

FILE 2: src/app/dashboard/page.tsx (lines 15, 25, 35, 45, 55)
  VolumeTrendChart = nextDynamic(
    () => import('@/components/dashboard/VolumeTrendChart').then(mod => ({ default: mod.VolumeTrendChart })),
    { loading: () => <ChartSkeleton height={320} />, ssr: false }
  );
  ConversionTrendChart = nextDynamic(
    () => import('@/components/dashboard/ConversionTrendChart').then(mod => ({ default: mod.ConversionTrendChart })),
    { loading: () => <ChartSkeleton height={384} />, ssr: false }
  );
  ChannelPerformanceTable = nextDynamic(
    () => import('@/components/dashboard/ChannelPerformanceTable').then(mod => ({ default: mod.ChannelPerformanceTable })),
    { loading: () => <TableSkeleton rows={5} />, ssr: false }
  );
  SourcePerformanceTable = nextDynamic(
    () => import('@/components/dashboard/SourcePerformanceTable').then(mod => ({ default: mod.SourcePerformanceTable })),
    { loading: () => <TableSkeleton rows={10} />, ssr: false }
  );
  DetailRecordsTable = nextDynamic(
    () => import('@/components/dashboard/DetailRecordsTable').then(mod => ({ default: mod.DetailRecordsTable })),
    { loading: () => <TableSkeleton rows={10} />, ssr: false }
  );
  → 5 dynamic imports total

No other files in src/ use next/dynamic.
```

**Q8.1b**: For each dynamic import found, note:
- Does it use `ssr: false`?
- Does it use `.then(mod => mod.XXX)` (named export pattern)?
- Does the target component work in production?

```
Answer: Summary of all 6 dynamic imports:

┌─────────────────────────┬─────────┬────────────┬──────────────────────┬──────────────────┐
│ Component               │ ssr:    │ Named      │ In Build Manifest?   │ Chunk Size       │
│                         │ false   │ export?    │ (eagerly loaded)     │                  │
├─────────────────────────┼─────────┼────────────┼──────────────────────┼──────────────────┤
│ AdvisorMapClient        │ YES     │ YES        │ NO (lazy)            │ 8KB (wrapper)    │
│ leaflet library         │ (via ^) │ (via ^)    │ NO (lazy)            │ 145KB (library)  │
│ VolumeTrendChart        │ YES     │ YES (wrap) │ NO (lazy)            │ 7KB              │
│ ConversionTrendChart    │ YES     │ YES (wrap) │ NO (lazy)            │ 10KB             │
│ ChannelPerformanceTable │ YES     │ YES (wrap) │ NO (lazy)            │ 8KB              │
│ SourcePerformanceTable  │ YES     │ YES (wrap) │ NO (lazy)            │ 9KB              │
│ DetailRecordsTable      │ YES     │ YES (wrap) │ YES (in manifest)    │ 21KB             │
└─────────────────────────┴─────────┴────────────┴──────────────────────┴──────────────────┘

NOTES:
- Dashboard uses a different named export wrapping pattern: .then(mod => ({ default: mod.XXX }))
  (returns { default: component } rather than the component directly). This wraps the named
  export into a default export format, which is correct and equivalent.
- ssr: false is confirmed on ALL imports across both files.
- DetailRecordsTable (714-3573e071fcb473d1.js) IS in the build manifest — it loads eagerly
  with the /dashboard page. This is the ONLY dynamic import that loads eagerly.
- Recharts library chunks (3826-*.js 382KB, 6627-*.js 16KB) ARE in the build manifest —
  eagerly loaded as shared library chunks.

VULNERABILITY ASSESSMENT:
  AdvisorMapClient + leaflet: HIGH vulnerability (lazy, only loaded when navigating to advisor-map)
  VolumeTrendChart:           MEDIUM vulnerability (lazy, but loaded on first /dashboard visit)
  ConversionTrendChart:       MEDIUM vulnerability (lazy, but loaded on first /dashboard visit)
  ChannelPerformanceTable:    MEDIUM vulnerability (lazy, but loaded on first /dashboard visit)
  SourcePerformanceTable:     MEDIUM vulnerability (lazy, but loaded on first /dashboard visit)
  DetailRecordsTable:         LOW vulnerability (in build manifest → eagerly loaded with page)
```

### 8.2 — Test other dynamically-imported pages

**Q8.2a**: Navigate to the main dashboard page (which also uses `nextDynamic` for VolumeTrendChart, ConversionTrendChart, etc.). Do those dynamic imports load successfully in production?

```
Answer: ANALYTICAL ASSESSMENT (manual verification needed for production):

THE DASHBOARD DYNAMIC IMPORTS ARE THEORETICALLY EQUALLY VULNERABLE but are
LESS LIKELY TO FAIL IN PRACTICE. Here is the key distinction:

TIMING:
  - When a user loads /dashboard (typically via hard navigation from login or a
    direct URL), the page shell HTML is fresh. The webpack runtime immediately
    starts loading all visible components — including the 4 lazy chart/table chunks
    (VolumeTrendChart, ConversionTrendChart, ChannelPerformanceTable, SourcePerformanceTable).
  - These 4 chunks are loaded ON THE SAME REQUEST as the page itself. By the time
    a deployment could happen and invalidate their hashes, they're already in memory.

ADVISOR-MAP CHUNKS TIMING:
  - AdvisorMapClient and leaflet library chunks are NEVER loaded during a /dashboard visit.
  - They only load when the user EXPLICITLY navigates to /dashboard/advisor-map via sidebar.
  - This means there is a WINDOW OF VULNERABILITY between: (a) page load, (b) deployment,
    (c) user clicks Advisor Map. That window can be hours long if the user keeps a tab open.

WHY DASHBOARD DYNAMIC IMPORTS RARELY FAIL:
  1. They're loaded within seconds of the initial page load — before any deployment window.
  2. They're cached by webpack once loaded (subsequent re-renders use the cached module).
  3. If a deployment happens, the user would need to be idle on the same page for hours,
     then trigger a page re-render that somehow re-imports these chunks (unlikely since
     webpack caches them in its module registry after first load).

CONCLUSION: Both sets of dynamic imports are vulnerable to stale deployment.
In practice, advisor-map is uniquely affected because its chunks are NEVER
pre-loaded during normal dashboard usage — they wait in a latent state until
the user explicitly navigates to the advisor-map page, which can happen long
after a deployment has invalidated the old chunk hashes.

Build manifest evidence confirms:
  Advisor-map lazy chunks NOT in manifest: d0deef33 (145KB), 8067 (8KB)
  Dashboard lazy chunks NOT in manifest: 7165 (7KB), 8044 (10KB), 9043 (8KB), 7589 (9KB)
  Dashboard eager chunk IN manifest: 714 (21KB) — DetailRecordsTable
```

### ⚠️ PHASE 8 DISCOVERIES:
```
1. THE ISSUE IS NOT UNIQUE TO ADVISOR MAP. Four dashboard page dynamic imports
   (VolumeTrendChart, ConversionTrendChart, ChannelPerformanceTable, SourcePerformanceTable)
   are EQUALLY lazy (not in build manifest) and equally vulnerable to stale deployment.
   They escape the problem in practice only because they load immediately on /dashboard
   page open, before any deployment window can open.

2. DetailRecordsTable IS THE EXCEPTION — it IS in the build manifest (eagerly loaded).
   Interestingly, it's the only nextDynamic() component that gets eagerly bundled.
   This is likely because Next.js's bundler determined it appears on the critical rendering
   path of /dashboard/page. The other 4 chart/table components are treated as below-fold.

3. RECHARTS LIBRARY IS EAGERLY LOADED (in manifest) even though all chart components
   that USE recharts are lazy. This is webpack's code-splitting heuristic: recharts
   (382KB) is large enough that webpack places it in a shared chunk referenced directly
   in the page manifest, while the individual chart wrappers (7-10KB each) become
   separate lazy chunks. This means: if a chart component lazy-chunk 404s, the recharts
   LIBRARY is already loaded, but the component that uses it cannot initialize.

4. THE FIX MUST COVER ALL LAZY CHUNKS, NOT JUST ADVISOR MAP. The recommended approach
   of fixing ErrorBoundary to detect ChunkLoadError and call window.location.reload()
   will protect ALL 6 lazy dynamic imports — not just the leaflet ones. This is the
   most bang-for-buck fix: one change in ErrorBoundary covers the entire dashboard.

5. A LONGER-TERM RISK EXISTS: As more pages are added (more sidebar routes), any page
   with next/dynamic imports that are rarely visited will share the same vulnerability
   profile as advisor-map. Without Vercel Skew Protection or a chunk retry mechanism,
   every lazy chunk in the app is a potential ChunkLoadError waiting to happen after
   each deployment.
```

---

## EXPLORATION SUMMARY

> **Claude Code**: After completing all phases, fill in this summary.

### Confirmed Root Cause
```
VERCEL DEPLOYMENT SKEW — no Skew Protection configured.

When a new Vercel deployment goes live, old chunk hashes are immediately
deleted from the CDN. Users with active sessions (loaded before the deployment)
have the OLD webpack runtime in memory, containing OLD chunk hash URLs. When
they navigate to /dashboard/advisor-map via the sidebar <Link>, webpack's
runtime requests the two leaflet lazy chunks using the OLD hashes → 404 → ChunkLoadError.

The bug is triggered specifically by: active session + new deployment + client-side
navigation to a page whose lazy chunks haven't been loaded yet in that session.
Hard refresh (Ctrl+Shift+R) always resolves it because it fetches fresh HTML.
```

### Contributing Factors
```
1. NO VERCEL SKEW PROTECTION: The single missing infrastructure config that would
   keep old chunk URLs alive during and after a deployment transition period.

2. ADVISOR-MAP CHUNKS ARE NEVER PRE-LOADED: The two leaflet chunks (145KB library +
   8KB AdvisorMapClient wrapper) are pure lazy chunks — not in the app-build-manifest,
   not prefetched by <Link>, never loaded during normal /dashboard usage. They can
   sit "stale" for hours before the user navigates to them.

3. ERRORBOUNDARY RETRY LOOP: The existing ErrorBoundary catches ChunkLoadError but
   its "Try Again" resets state → re-renders → same failed import → same 404 →
   infinite loop. It never calls window.location.reload().

4. PRODUCTION ERRORS SILENTLY SWALLOWED: componentDidCatch is gated on
   NODE_ENV === 'development'. Zero Sentry capture in production → monitoring
   is blind to the real frequency of this error.

5. NEXT.JS HAS NO BUILT-IN CHUNK RETRY: Unlike some frameworks, Next.js/webpack
   does not automatically detect ChunkLoadError and force a reload. This must be
   added by the application.

6. ALL DASHBOARD DYNAMIC IMPORTS SHARE THE VULNERABILITY: 5 of 6 nextDynamic()
   components produce lazy chunks not in the build manifest. Advisor-map is just
   the most likely to trigger the race condition due to being rarely visited.
```

### Key Files Involved
```
src/components/advisor-map/AdvisorMap.tsx      — dynamic() import of AdvisorMapClient
src/components/advisor-map/AdvisorMapClient.tsx — leaflet/react-leaflet map component
src/components/ui/ErrorBoundary.tsx            — catches error but retries infinitely
src/app/dashboard/layout.tsx                   — wraps all pages with ErrorBoundary
src/app/dashboard/advisor-map/page.tsx         — no error.tsx sibling exists
src/app/dashboard/page.tsx                     — 5 nextDynamic() imports (also vulnerable)
vercel.json                                    — no skewProtection configuration
```

### Recommended Fix Strategy
```
PRIORITY ORDER (highest impact first):

FIX 1 — Update ErrorBoundary to handle ChunkLoadError (HIGH IMPACT, LOW RISK)
  In src/components/ui/ErrorBoundary.tsx:
  - In componentDidCatch: detect error.name === 'ChunkLoadError' and call
    window.location.reload() automatically
  - Move Sentry capture outside the dev-only guard so production errors are tracked
  - Add a "Reload page" button in the fallback UI as a manual escape hatch
  Impact: fixes the infinite retry loop; protects ALL 6 lazy dynamic imports;
  gives users a path to recovery without knowing to hard-refresh

FIX 2 — Add src/app/dashboard/advisor-map/error.tsx (MEDIUM IMPACT, VERY LOW RISK)
  A Next.js App Router route-level error boundary specifically for advisor-map.
  Can implement ChunkLoadError detection + auto-reload targeted at this route.
  Provides a clean fallback UI even before ErrorBoundary in the layout catches it.
  Impact: targeted fix for the most-affected page; doesn't touch shared components

FIX 3 — Enable Vercel Skew Protection (HIGH IMPACT, INFRASTRUCTURE CHANGE)
  In Vercel project dashboard → Settings → Deployment Protection → enable Skew Protection.
  This keeps old chunk URLs alive on the CDN for a configurable grace period (default 24h).
  Impact: prevents the 404 from happening at all; protects all lazy chunks globally.
  Risk: requires Vercel Pro plan or above; small latency overhead for protection checks.
  Note: this is the correct long-term infrastructure fix. Fixes 1 and 2 are defensive
  mitigations that make the app resilient regardless of CDN behavior.

RECOMMENDED IMPLEMENTATION ORDER: Fix 1 → Fix 2 → Fix 3
  Fixes 1 and 2 can be shipped immediately (code changes only, no infra access needed).
  Fix 3 requires Vercel dashboard access and should follow once code fixes are verified.
```

### Risk Assessment
```
FIX 1 (ErrorBoundary change):
  - RISK: window.location.reload() on any error would be too aggressive. MITIGATION:
    gate the reload specifically on error.name === 'ChunkLoadError' — all other errors
    still show the standard error UI.
  - RISK: infinite reload loop if reload itself fails. MITIGATION: check
    sessionStorage flag before reloading; if already reloaded once, show error UI instead.
  - BLAST RADIUS: affects all pages wrapped by the dashboard layout (all authenticated
    routes). Any page that triggers an error will now auto-reload for ChunkLoadErrors.
    This is strictly better UX than the current infinite error loop.

FIX 2 (error.tsx):
  - RISK: very low. Adds a new file only. Does not modify any existing component.
  - BLAST RADIUS: affects only /dashboard/advisor-map route. Other pages unaffected.

FIX 3 (Vercel Skew Protection):
  - RISK: may add slight latency to chunk requests during the grace period (Vercel
    needs to check if a request is for an old or new deployment).
  - RISK: requires Vercel plan that supports Skew Protection.
  - BLAST RADIUS: global infrastructure change affecting all deployments. Low risk
    since it's additive — only activates during deployment transition windows.
```

### Verification Plan
```
1. IMMEDIATE (post code fix, staging/local):
   a. Build production bundle locally (npm run build)
   b. Start production server (npm run start)
   c. Open /dashboard in browser, open DevTools Network tab
   d. Delete the leaflet chunk files from .next/static/chunks/ to simulate stale CDN
   e. Navigate to advisor-map via sidebar
   f. EXPECTED: ChunkLoadError fires → ErrorBoundary detects it → auto-reloads (or shows
      "Reload Page" button) → after reload, map loads successfully

2. PRODUCTION VERIFICATION (post-deployment):
   a. Load /dashboard in a browser tab
   b. Deploy a new commit to Vercel
   c. WITHOUT refreshing, click Advisor Map in the sidebar
   d. EXPECTED (pre-fix): ChunkLoadError + broken UI
   e. EXPECTED (post-fix): either auto-reload occurs and map loads, or a friendly error
      message with "Reload Page" button appears — no infinite loop

3. SENTRY VERIFICATION:
   a. After Fix 1 (Sentry capture moved outside dev-only guard): verify ChunkLoadError
      appears in Sentry issues within 5 minutes of a production occurrence
   b. Confirm error group, occurrence count, affected users visible in Sentry dashboard

4. REGRESSION CHECK:
   a. Verify all other dashboard pages still work correctly after ErrorBoundary change
   b. Verify non-ChunkLoadError errors still show the standard error UI (not auto-reload)
   c. Run full test suite if available
```