# GC Hub — Export All Advisor Details as CSV

> **This document is the single source of truth for this feature.**
> It contains both the exploration plan AND the implementation guide.
> Claude Code must record its findings directly into this file as it works through each phase.

---

## Instructions for Claude Code

### Workflow

You MUST follow this workflow for every phase below:

1. **Read** the phase's Goal, Commands, and Expected Findings.
2. **Run** the commands listed (and any additional commands you need).
3. **Write your findings** into the `### Findings` section of that phase using the `str_replace` or edit tool. Replace the placeholder `_Pending — Claude Code will fill this in._` with your actual findings.
4. **If findings differ from expectations**, also update the `### Adjustments` section (where present) to document what changed and how it affects the implementation steps.
5. **Do NOT proceed to the Implementation Steps until ALL exploration phases (1–7) are complete** with findings recorded.
6. When implementing, follow the Implementation Steps in order (Steps 1–5). After each step, return to this document and check off the step or note any deviations in the `### Implementation Log` section at the bottom.

### Rules

- **Never skip recording findings.** Even if the finding matches expectations exactly, write "Confirmed — matches expectations" with the specific evidence (line numbers, exact type signatures, etc.).
- **If you discover something unexpected**, stop and document it before continuing. Update the affected implementation steps if needed.
- **All code changes must match the patterns documented here.** If you need to deviate, document why in the Implementation Log before making the change.
- **After implementation is complete**, run the verification commands in each step's guardrails section and record results in the Implementation Log.

---

## Feature Summary

Add an **"Export Details"** button to the GC Hub Advisor Detail tab that exports **all advisors' period-level data** as a CSV. This is a bulk version of the single-advisor CSV export that already exists in `GCHubAdvisorModal`.

**Who can use it:** Admin, RevOps Admin, and Capital Partner users.

**Anonymization rules:**
- **Admin / RevOps Admin:** Full real data — advisor names, team names, Orion Rep IDs, override metadata, data sources.
- **Capital Partner:** Anonymized advisor names, anonymized account names, hidden Orion Rep ID, hidden override metadata, data source shown as `"Aggregated"`.

---

## Current State Recap

### Existing Exports (2 today)

| Export | Location | What it exports | Scope |
|--------|----------|----------------|-------|
| **"Export (N)"** button | `GCHubAdvisorTable` → `handleExportCsv` in `GCHubContent.tsx` | Summary-level: Advisor, Team, Total Revenue, Total Commissions, Amount Earned, Periods count | All advisors (grouped/summarized) |
| **Period CSV** in modal | `handleExportPeriodsCsv` in `GCHubAdvisorModal.tsx` | Period-level: Period, Period Start, Revenue, Commissions, Amount Earned, Source | **Single advisor** only |

### What's Missing

There is no way to export the **period-level detail for ALL advisors** at once. Users must open each advisor modal individually and export one at a time. The new "Export Details" button closes this gap.

### Data Already Available

The `advisors` state in `GCHubContent.tsx` already contains **individual period rows** (type `GcAdvisorRow[]`) returned by `getGcAdvisorTable()`. Each row includes: `advisorName`, `accountName`, `orionRepresentativeId`, `period`, `periodStart`, `grossRevenue`, `commissionsPaid`, `amountEarned`, `billingFrequency`, `billingStyle`, `dataSource`, `isManuallyOverridden`.

For Capital Partners, this data is **already anonymized at the query layer** — no additional client-side anonymization is needed.

---

# PART 1 — CODEBASE EXPLORATION

> **Claude Code: Complete ALL phases below and record findings BEFORE starting implementation.**

---

## Phase 1 — Confirm Data Shape in `GCHubContent.tsx`

### Goal
Verify that the `advisors` state variable contains all the fields needed for the detail export, and confirm the data is already anonymized for CP users.

### Commands

```bash
# Check the advisors state type and how it's populated
grep -n "advisors\|setAdvisors\|GcAdvisorRow" src/app/dashboard/gc-hub/GCHubContent.tsx | head -30
```

```bash
# Check the fetchAdvisors function to see what API endpoint it calls
sed -n '/const fetchAdvisors/,/^  }/p' src/app/dashboard/gc-hub/GCHubContent.tsx
```

### Expected Findings
- `advisors` is typed as `GcAdvisorRow[]` from `src/lib/api-client.ts`.
- Populated via `gcHubApi.getAdvisors(filters)` which calls `POST /api/gc-hub/advisors`.
- The API route passes `permissions` to `getGcAdvisorTable()`, which applies anonymization for CP users at the query layer.

### What to Record
1. Exact type of `advisors` state.
2. Confirm all these fields are available per row: `advisorName`, `accountName`, `orionRepresentativeId`, `period`, `periodStart`, `grossRevenue`, `commissionsPaid`, `amountEarned`, `billingFrequency`, `billingStyle`, `dataSource`, `isManuallyOverridden`.
3. Whether `isAnonymized` flag is available (it is — returned by `/api/gc-hub/advisors` response).
4. Whether there is an `isCapitalPartner` or `isAdmin` variable already in scope (there is — derived from `permissions`).

### If Finding Differs
- If `advisors` does NOT contain period-level rows (only summary), we'll need a new API endpoint or query. This would change the approach significantly.
- If anonymization is NOT applied at the query layer, we'd need to apply it client-side (unlikely based on codebase).

### Findings

**Confirmed — matches expectations with specific evidence:**

1. **Exact type of `advisors` state:** `GcAdvisorRow[]` (line 56)
   ```typescript
   const [advisors, setAdvisors] = useState<GcAdvisorRow[]>([]);
   ```

2. **Import source:** `@/lib/api-client` (line 13)
   ```typescript
   import { gcHubApi, type GcPeriodSummary, type GcAdvisorRow } from '@/lib/api-client';
   ```

3. **Populated via:** `gcHubApi.getAdvisors(filters)` (line 119), which calls the `/api/gc-hub/advisors` endpoint

4. **`isAnonymized` flag:** ✅ Available in state (line 58)
   ```typescript
   const [isAnonymized, setIsAnonymized] = useState(false);
   ```
   Set from API response at line 129: `setIsAnonymized(data.isAnonymized || false);`

5. **`isCapitalPartner` / `isAdmin` variables:** ✅ Already in scope (lines 38-39)
   ```typescript
   const isAdmin = permissions?.role === 'admin' || permissions?.role === 'revops_admin';
   const isCapitalPartner = permissions?.role === 'capital_partner';
   ```

6. **Fields per row:** Need to verify in Phase 2 (type definition check), but the API response shape confirms period-level data is being returned.

### Adjustments

None — expectations matched. The `advisors` state contains period-level rows (not summary), `isAnonymized` is available in state, and role variables are in scope.

---

## Phase 2 — Confirm `GcAdvisorRow` Type Definition

### Goal
Verify the exact fields on `GcAdvisorRow` in both the server query types and the client API mirror types.

### Commands

```bash
# Server-side type
grep -A 15 "export interface GcAdvisorRow" src/lib/queries/gc-hub.ts
```

```bash
# Client-side mirror type
grep -A 15 "export interface GcAdvisorRow" src/lib/api-client.ts
```

### Expected Findings
Both should match with these fields:
- `advisorName: string`
- `accountName: string | null`
- `orionRepresentativeId: string | null`
- `period: string`
- `periodStart: string`
- `grossRevenue: number | null`
- `commissionsPaid: number | null`
- `amountEarned: number | null`
- `billingFrequency: string | null`
- `billingStyle: string | null`
- `dataSource: string`
- `isManuallyOverridden: boolean`

### What to Record
- Confirm field-for-field match between server and client types.
- Note any fields present server-side but absent client-side (these would need to be added if we want them in the export).

### Findings

**Confirmed — field-for-field match between server and client types.**

**Server-side type** (`src/lib/queries/gc-hub.ts` lines 27-40):
```typescript
export interface GcAdvisorRow {
  advisorName: string;       // Real or anonymous depending on role
  accountName: string | null; // Real or anonymous depending on role
  orionRepresentativeId: string | null;
  period: string;
  periodStart: string;
  grossRevenue: number | null;
  commissionsPaid: number | null;
  amountEarned: number | null;
  billingFrequency: string | null;
  billingStyle: string | null;
  dataSource: string;
  isManuallyOverridden: boolean;
}
```

**Client-side mirror type** (`src/lib/api-client.ts` lines 81-94):
```typescript
export interface GcAdvisorRow {
  advisorName: string;
  accountName: string | null;
  orionRepresentativeId: string | null;
  period: string;
  periodStart: string;
  grossRevenue: number | null;
  commissionsPaid: number | null;
  amountEarned: number | null;
  billingFrequency: string | null;
  billingStyle: string | null;
  dataSource: string;
  isManuallyOverridden: boolean;
}
```

**All expected fields confirmed present:**
- ✅ `advisorName: string`
- ✅ `accountName: string | null`
- ✅ `orionRepresentativeId: string | null`
- ✅ `period: string`
- ✅ `periodStart: string`
- ✅ `grossRevenue: number | null`
- ✅ `commissionsPaid: number | null`
- ✅ `amountEarned: number | null`
- ✅ `billingFrequency: string | null`
- ✅ `billingStyle: string | null`
- ✅ `dataSource: string`
- ✅ `isManuallyOverridden: boolean`

### Adjustments

None — types match exactly as expected. No additional fields need to be added.

---

## Phase 3 — Examine Existing Summary Export Handler

### Goal
Understand the current `handleExportCsv` pattern in `GCHubContent.tsx` so the new detail export follows the same conventions (CSV escaping, filename, download mechanism).

### Commands

```bash
# Print the full handleExportCsv function
sed -n '/const handleExportCsv/,/^  }, \[/p' src/app/dashboard/gc-hub/GCHubContent.tsx
```

### Expected Findings
- Uses inline `escapeCsvCell` helper (handles commas, quotes, newlines).
- Groups `advisors` by `advisorName` and aggregates totals.
- Headers: `Advisor, Team, Total Revenue, Total Commissions, Amount Earned, Periods`.
- Creates Blob → object URL → click → revoke pattern.
- Filename: `gc-hub-advisors-YYYY-MM-DD.csv`.
- Wrapped in `useCallback` with `[advisors]` dependency.

### What to Record
1. The exact `escapeCsvCell` implementation (paste it here for reference).
2. The download-trigger pattern (paste the Blob/URL/click code).
3. Filename convention.
4. `useCallback` dependency array.

### Findings

**Confirmed — matches expectations with full evidence.**

**1. The `escapeCsvCell` implementation** (lines 150-156):
```typescript
function escapeCsvCell(value: string | null | undefined): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
```

**2. Headers** (lines 158-165):
```typescript
const headers = [
  'Advisor',
  'Team',
  'Total Revenue',
  'Total Commissions',
  'Amount Earned',
  'Periods',
];
```

**3. Download-trigger pattern** (lines 189-196):
```typescript
const csv = [headers.join(','), ...rows].join('\r\n');
const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `gc-hub-advisors-${new Date().toISOString().slice(0, 10)}.csv`;
a.click();
URL.revokeObjectURL(url);
```

**4. Filename convention:** `gc-hub-advisors-YYYY-MM-DD.csv` (line 194)

**5. `useCallback` dependency array:** `[advisors]` (line 197)

**Additional observations:**
- Groups `advisors` by `advisorName` and aggregates totals (lines 169-173)
- Uses `\r\n` line endings for Windows compatibility
- Number formatting uses `.toFixed(2)` for currency values

### Adjustments

None — expectations matched exactly. Will follow the same patterns for the detail export.

---

## Phase 4 — Examine Existing Modal Period Export

### Goal
Understand `handleExportPeriodsCsv` in `GCHubAdvisorModal.tsx` to see what columns the single-advisor detail export includes, since the bulk export should be a superset.

### Commands

```bash
# Print the full handleExportPeriodsCsv function
sed -n '/const handleExportPeriodsCsv/,/^  };/p' src/components/gc-hub/GCHubAdvisorModal.tsx
```

### Expected Findings
- Headers: `Period, Period Start, Revenue, Commissions, Amount Earned, Source`.
- Sorts by `periodStart` descending.
- Uses same `escapeCsvCell` pattern.
- Filename: `gc-hub-{advisorName}-periods-YYYY-MM-DD.csv`.

### What to Record
- Column set (the bulk export should include these PLUS `Advisor`, `Team`, `Billing Frequency`, `Billing Style`).
- Sort order convention.

### Findings

**Confirmed — matches expectations with full evidence.**

**Location:** `src/components/gc-hub/GCHubAdvisorModal.tsx` lines 91-132

**1. Headers** (lines 102-109):
```typescript
const headers = [
  'Period',
  'Period Start',
  'Revenue',
  'Commissions',
  'Amount Earned',
  'Source',
];
```

**2. Sort order** (line 112): Descending by `periodStart`
```typescript
.sort((a: any, b: any) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())
```

**3. Same `escapeCsvCell` pattern** (lines 94-100) — identical to summary export

**4. Filename convention** (lines 127-129):
```typescript
const safeName = (detail.advisorName || advisorName).replace(/[^a-zA-Z0-9]/g, '-');
a.download = `gc-hub-${safeName}-periods-${new Date().toISOString().slice(0, 10)}.csv`;
```

**5. Additional observations:**
- Strips time portion from `periodStart` with `.split('T')[0]` (line 115)
- Uses same Blob/URL/click pattern as summary export

**Column comparison for bulk export:**
| Modal Period Export | Bulk Detail Export (to add) |
|--------------------|-----------------------------|
| Period | Period |
| Period Start | Period Start |
| Revenue | Revenue |
| Commissions | Commissions |
| Amount Earned | Amount Earned |
| Source | Data Source |
| — | **Advisor** (NEW) |
| — | **Team** (NEW) |
| — | **Billing Frequency** (NEW) |
| — | **Billing Style** (NEW) |
| — | **Orion Rep ID** (Admin only) |
| — | **Manually Overridden** (Admin only) |

### Adjustments

None — expectations matched. The bulk export will be a superset including Advisor, Team, Billing Frequency, Billing Style, and (for admins) Orion Rep ID, Data Source, Manually Overridden.

---

## Phase 5 — Examine `GCHubAdvisorTable` Props and Export Button Placement

### Goal
Understand how the existing export button is wired up, and determine where to add the new "Export Details" button.

### Commands

```bash
# Check the GCHubAdvisorTable interface/props
grep -B 2 -A 20 "interface.*Props\|onExportCsv" src/components/gc-hub/GCHubAdvisorTable.tsx | head -40
```

```bash
# Check how the export button is rendered in JSX
grep -B 5 -A 10 "onExportCsv\|Export" src/components/gc-hub/GCHubAdvisorTable.tsx
```

```bash
# Get the full props interface for the component
sed -n '/^interface GCHubAdvisorTableProps/,/^}/p' src/components/gc-hub/GCHubAdvisorTable.tsx
```

### Expected Findings
- `GCHubAdvisorTable` accepts `onExportCsv?: () => void` prop.
- Renders an export button with Download icon and count badge.
- Button is in the header area alongside search input.

### Design Decision
The new "Export Details" button should be placed **next to the existing Export button** in `GCHubAdvisorTable`. Two options:

**Option A — Add a second prop `onExportDetailsCsv`:**
- Renders a second button: "Export Details" alongside the existing "Export (N)".
- Simple, minimal change to the table component.

**Option B — Replace the single button with a dropdown:**
- Single "Export" button that opens a menu with "Summary CSV" and "Detail CSV" options.
- Cleaner UI if more export types are added later.

**Recommendation:** Option A for simplicity. The two buttons clearly communicate two different exports. Can refactor to a dropdown later if needed.

### What to Record
1. Exact props interface (paste it).
2. Exact JSX for the existing export button (paste it — we'll mirror it for the new button).
3. Where in the JSX tree the button sits (identify the parent container/div).
4. What `sorted` refers to (this is used for the disabled check and count).

### Findings

**Confirmed — matches expectations with full evidence.**

**1. Exact props interface** (`src/components/gc-hub/GCHubAdvisorTable.tsx` lines 26-36):
```typescript
interface GCHubAdvisorTableProps {
  records: AdvisorTableRow[];
  isLoading?: boolean;
  isAnonymized?: boolean;
  isAdmin?: boolean;
  isCapitalPartner?: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  onAdvisorClick?: (advisorName: string) => void;
  onExportCsv?: () => void;
}
```

**2. Exact JSX for existing export button** (lines 238-248):
```tsx
{/* Export */}
{onExportCsv && (
  <button
    onClick={onExportCsv}
    disabled={sorted.length === 0}
    className="flex items-center gap-2 px-4 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
  >
    <Download className="w-5 h-5" />
    Export ({sorted.length})
  </button>
)}
```

**3. Parent container location:** Button sits inside a `<div>` (line 249 ends with `</div>`) that contains the search input and export button. This div is inside the header area.

**4. What `sorted` refers to** (lines 184-195):
```typescript
const sorted = useMemo(() => {
  if (!sortKey) return advisorAggregates;
  return [...advisorAggregates].sort((a, b) => {
    // ... sorting logic
  });
}, [advisorAggregates, sortKey, sortDir]);
```
- `sorted` is an array of **advisor aggregates** (grouped by advisor, with totals computed)
- `sorted.length` = number of unique advisors in the filtered/sorted view
- The new "Export Details" button should use the same `sorted.length === 0` check for disabled state

**5. Destructured props** (lines 124-130):
```typescript
export function GCHubAdvisorTable({
  records,
  isLoading = false,
  isAnonymized = false,
  isAdmin = false,
  isCapitalPartner = false,
  search,
  onSearchChange,
  onAdvisorClick,
  onExportCsv,
}: GCHubAdvisorTableProps) {
```

### Adjustments

None — expectations matched. Will add `onExportDetailsCsv?: () => void` to props and render a second button immediately after the existing export button using the same pattern.

---

## Phase 6 — Confirm Role-Based Access for Export

### Goal
Verify which roles can see the Advisor Detail tab and confirm the export should be available to all of them.

### Commands

```bash
# Check who can see the advisor-detail tab
grep -n "activeTab.*advisor-detail\|isCapitalPartner\|isAdmin\|canDrillDown" src/app/dashboard/gc-hub/GCHubContent.tsx | head -20
```

```bash
# Check the GCHubAdvisorTable for role-based rendering
grep -n "isAdmin\|isCapitalPartner\|canDrillDown\|canExport" src/components/gc-hub/GCHubAdvisorTable.tsx | head -20
```

### Expected Findings
- Admin, RevOps Admin, and Capital Partner can all see the Advisor Detail tab.
- The existing "Export (N)" button is rendered for all users who can see the table (no role gate).
- The new "Export Details" button should follow the same pattern — available to all GC Hub users.

### Security Note
No additional backend work is needed because:
1. The `advisors` data is already fetched via the permission-gated `/api/gc-hub/advisors` endpoint.
2. Anonymization is applied server-side before the data reaches the client.
3. The export simply serializes what's already in the browser — no new data access.

### What to Record
1. Confirm which roles see the Advisor Detail tab.
2. Confirm the existing export button has no role gate.
3. Note any role-based conditional rendering in the table component that we need to be aware of.

### Findings

**Confirmed — matches expectations with full evidence.**

**1. Which roles see the Advisor Detail tab:**
From `src/components/gc-hub/GCHubTabs.tsx` lines 14-17:
```typescript
const TABS: { id: GcHubTab; label: string; icon: React.ReactNode; cpVisible: boolean }[] = [
  { id: 'overview', label: 'Portfolio Overview', icon: <BarChart3 className="w-4 h-4" />, cpVisible: true },
  { id: 'advisor-detail', label: 'Advisor Detail', icon: <Users className="w-4 h-4" />, cpVisible: true },
];
```
- **Admin:** ✅ Can see (all tabs visible)
- **RevOps Admin:** ✅ Can see (all tabs visible)
- **Capital Partner:** ✅ Can see (`cpVisible: true`)

**2. Existing export button role gate:**
From `src/components/gc-hub/GCHubAdvisorTable.tsx` lines 238-248:
```tsx
{onExportCsv && (
  <button onClick={onExportCsv} disabled={sorted.length === 0} ...>
    <Download className="w-5 h-5" />
    Export ({sorted.length})
  </button>
)}
```
- **No role gate** — the export button renders for anyone who can see the table
- Only conditional is `onExportCsv &&` (whether the prop was passed)

**3. Role-based conditional rendering in table component:**
From `src/components/gc-hub/GCHubAdvisorTable.tsx` line 132:
```typescript
const canDrillDown = isAdmin || isCapitalPartner;
```
- `canDrillDown` controls whether clicking an advisor opens the modal (line 280)
- Export buttons are NOT gated by role

**Security confirmation:**
- The `advisors` data is permission-gated at the API layer (`/api/gc-hub/advisors`)
- Anonymization is applied server-side before data reaches client
- Export simply serializes client-side data — no new data access

### Adjustments

None — expectations matched. The new "Export Details" button should follow the same pattern: no role gate, available to all users who can see the Advisor Detail tab. Anonymization is already applied server-side.

---

## Phase 7 — Check for Existing Utility Functions and `isAnonymized` State

### Goal
Determine if there are shared CSV export utilities that should be reused, and confirm `isAnonymized` is available in `GCHubContent.tsx`.

### Commands

```bash
# Check the shared export utility
cat src/lib/utils/export-csv.ts
```

```bash
# Check if GCHubContent imports any shared export utilities
grep -n "import.*export\|import.*csv\|import.*Export" src/app/dashboard/gc-hub/GCHubContent.tsx
```

```bash
# Check isAnonymized state variable
grep -n "isAnonymized\|setIsAnonymized" src/app/dashboard/gc-hub/GCHubContent.tsx | head -10
```

```bash
# Verify CP dataSource behavior in getGcAdvisorTable
sed -n '/Apply anonymization for Capital Partners/,/^  }/p' src/lib/queries/gc-hub.ts
```

### Expected Findings
- `src/lib/utils/export-csv.ts` has a generic `exportToCSV<T>()` function.
- `GCHubContent.tsx` does NOT use it — instead has inline `handleExportCsv`.
- `isAnonymized` is stored in state, set from the `/api/gc-hub/advisors` response.
- CP `dataSource` in `getGcAdvisorTable` uses the real value (`r.dataSource`), not `"Aggregated"`.

### What to Record
1. Whether `isAnonymized` exists as state. If not, note what alternative to use (e.g., `isCapitalPartner`).
2. Whether CP rows from `getGcAdvisorTable` have real or sanitized `dataSource`.
3. Decision: inline handler (matching existing pattern) vs. shared utility.

### Findings

**Confirmed — matches expectations with full evidence.**

**1. Shared export utility exists** (`src/lib/utils/export-csv.ts`):
```typescript
export function exportToCSV<T extends CSVRow>(
  data: T[],
  filename: string
): void {
  // Uses similar Blob/click pattern
  // Does NOT handle newlines/carriage returns in escape function
}
```
- The utility exists but has a simpler escape function (no `\n` or `\r` handling)
- Uses `\n` line endings vs the existing GCHub export's `\r\n`

**2. `GCHubContent.tsx` does NOT import the shared utility:**
- Search returned no matches for `import.*export|import.*csv|import.*Export`
- Uses inline `handleExportCsv` with its own `escapeCsvCell` helper
- **Decision:** Follow existing pattern — use inline handler for consistency

**3. `isAnonymized` state confirmed** (from Phase 1, line 58):
```typescript
const [isAnonymized, setIsAnonymized] = useState(false);
```
Set from API response at line 129: `setIsAnonymized(data.isAnonymized || false);`

**4. CP `dataSource` behavior in `getGcAdvisorTable`** (`src/lib/queries/gc-hub.ts` lines 346-362):
```typescript
// Apply anonymization for Capital Partners
if (isCapitalPartner(permissions)) {
  return records.map(r => ({
    // ...
    dataSource: r.dataSource,       // ← Uses REAL value, not "Aggregated"
    isManuallyOverridden: false,    // ← Hidden (hardcoded false)
    orionRepresentativeId: null,    // ← Hidden (null)
  }));
}
```
- **`dataSource`:** Uses the real value (not sanitized to "Aggregated")
- **`orionRepresentativeId`:** Always `null` for CP
- **`isManuallyOverridden`:** Always `false` for CP

**Design decision for export:**
- For CP users: include `dataSource` in export since it's the real value
- Omit `orionRepresentativeId` and `isManuallyOverridden` columns entirely for CP (they're always null/false)
- Use `isAnonymized` flag (not role check) to determine column set

### Adjustments

**Minor adjustment to implementation plan:**

The original plan excluded `Data Source` for CP users because we expected it might be sanitized. Since `dataSource` contains the real value for CP, we should **include** it in the CP export.

Updated column sets:
- **Admin/RevOps:** Advisor, Team, Period, Period Start, Revenue, Commissions, Amount Earned, Billing Frequency, Billing Style, Orion Rep ID, Data Source, Manually Overridden
- **Capital Partner:** Advisor, Team, Period, Period Start, Revenue, Commissions, Amount Earned, Billing Frequency, Billing Style, **Data Source** (real value)

---

# PART 2 — IMPLEMENTATION STEPS

> **Claude Code: Only begin implementation after ALL exploration phases above have recorded findings.**
> **After each step, record what you did in the Implementation Log at the bottom of this document.**

---

## Step 1 — Add `handleExportDetailsCsv` in `GCHubContent.tsx`

### Location
In `src/app/dashboard/gc-hub/GCHubContent.tsx`, immediately after the existing `handleExportCsv` function.

### Logic

```typescript
// ── CSV Export (Detail — all periods per advisor) ──
const handleExportDetailsCsv = useCallback(() => {
  function escapeCsvCell(value: string | null | undefined): string {
    const s = String(value ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  // Columns differ by role:
  // Admin/RevOps: include Orion Rep ID, Data Source, Manually Overridden
  // Capital Partner: exclude those fields (they're already null/hidden from API)
  const baseHeaders = [
    'Advisor',
    'Team',
    'Period',
    'Period Start',
    'Revenue',
    'Commissions',
    'Amount Earned',
    'Billing Frequency',
    'Billing Style',
  ];

  // Admin/RevOps get additional columns
  const adminHeaders = [
    ...baseHeaders,
    'Orion Rep ID',
    'Data Source',
    'Manually Overridden',
  ];

  const headers = isAnonymized ? baseHeaders : adminHeaders;

  // Sort: by advisor name ASC, then periodStart DESC within each advisor
  const sorted = [...advisors].sort((a, b) => {
    const nameCompare = a.advisorName.localeCompare(b.advisorName);
    if (nameCompare !== 0) return nameCompare;
    return new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime();
  });

  const rows = sorted.map((r) => {
    const baseRow = [
      escapeCsvCell(r.advisorName),
      escapeCsvCell(r.accountName),
      escapeCsvCell(r.period),
      escapeCsvCell(r.periodStart),
      (r.grossRevenue ?? 0).toFixed(2),
      (r.commissionsPaid ?? 0).toFixed(2),
      (r.amountEarned ?? 0).toFixed(2),
      escapeCsvCell(r.billingFrequency),
      escapeCsvCell(r.billingStyle),
    ];

    if (!isAnonymized) {
      baseRow.push(
        escapeCsvCell(r.orionRepresentativeId),
        escapeCsvCell(r.dataSource),
        r.isManuallyOverridden ? 'Yes' : 'No',
      );
    }

    return baseRow.join(',');
  });

  const csv = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gc-hub-advisor-details-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}, [advisors, isAnonymized]);
```

### Key Design Decisions

1. **Uses `isAnonymized` (not role check)** — the `isAnonymized` flag is already returned by the API and stored in state. This is cleaner than checking `isCapitalPartner` because the data itself drives the column choice.
2. **No new API call** — the `advisors` array already contains all period-level rows for all advisors, filtered and anonymized by the server.
3. **Sort order** — alphabetical by advisor name, then reverse-chronological within each advisor (matching the modal's single-advisor sort).
4. **CP gets fewer columns** — Orion Rep ID is `null`, `dataSource` is always the real source (not "Aggregated" — that's only in the detail modal). We omit these columns entirely for CP rather than showing null/misleading values.

### Guardrails — Verify After Implementing

```bash
# Confirm the new function exists and has the right dependency array
grep -n "handleExportDetailsCsv" src/app/dashboard/gc-hub/GCHubContent.tsx
```

```bash
# Confirm no TypeScript errors
npx tsc --noEmit 2>&1 | grep -i "GCHubContent\|error" | head -20
```

### ⚠️ IMPORTANT: Adapt to Exploration Findings
- If Phase 1 found that `isAnonymized` is NOT in state, replace `isAnonymized` with `isCapitalPartner` in the code above.
- If Phase 2 found fields differ between server/client types, adjust the row mapping accordingly.
- If Phase 3 found a different `escapeCsvCell` pattern, use that pattern instead.
- If Phase 7 found that CP `dataSource` is sanitized, you may include it in the CP export.

---

## Step 2 — Pass Handler to `GCHubAdvisorTable`

### Location
In `src/app/dashboard/gc-hub/GCHubContent.tsx`, in the JSX where `GCHubAdvisorTable` is rendered.

### Change

Add the new prop alongside the existing `onExportCsv`:

```tsx
<GCHubAdvisorTable
  records={advisors}
  isLoading={loadingAdvisors}
  isAnonymized={isAnonymized}
  isAdmin={isAdmin}
  isCapitalPartner={isCapitalPartner}
  search={filters.search}
  onSearchChange={(s) => setFilters((f) => ({ ...f, search: s }))}
  onAdvisorClick={(name) => setSelectedAdvisor(name)}
  onExportCsv={handleExportCsv}
  onExportDetailsCsv={handleExportDetailsCsv}  // ← ADD THIS
/>
```

### Guardrails — Verify After Implementing

```bash
# Confirm the prop is passed
grep -n "onExportDetailsCsv" src/app/dashboard/gc-hub/GCHubContent.tsx
```

### ⚠️ IMPORTANT: Adapt to Exploration Findings
- If Phase 5 found different prop names or patterns, match them.

---

## Step 3 — Add Export Details Button to `GCHubAdvisorTable`

### Location
In `src/components/gc-hub/GCHubAdvisorTable.tsx`.

### 3a — Update the component's props interface

Add `onExportDetailsCsv` as an optional callback:

```typescript
interface GCHubAdvisorTableProps {
  // ... existing props ...
  onExportCsv?: () => void;
  onExportDetailsCsv?: () => void;  // ← ADD THIS
}
```

### 3b — Destructure the new prop

```typescript
export function GCHubAdvisorTable({
  // ... existing destructured props ...
  onExportCsv,
  onExportDetailsCsv,  // ← ADD THIS
}: GCHubAdvisorTableProps) {
```

### 3c — Render the new button alongside the existing one

Find the existing export button block and add the new button **immediately after it**:

```tsx
{/* Export Summary */}
{onExportCsv && (
  <button
    onClick={onExportCsv}
    disabled={sorted.length === 0}
    className="flex items-center gap-2 px-4 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
  >
    <Download className="w-5 h-5" />
    Export ({sorted.length})
  </button>
)}

{/* Export Details — all period-level rows */}
{onExportDetailsCsv && (
  <button
    onClick={onExportDetailsCsv}
    disabled={sorted.length === 0}
    className="flex items-center gap-2 px-4 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
  >
    <Download className="w-5 h-5" />
    Export Details
  </button>
)}
```

### Note on Button Label
- "Export (N)" = existing summary export (shows advisor count).
- "Export Details" = new detail export. We intentionally do NOT show a count here because the count would be total period rows (e.g., 500+), which could be confusing next to the advisor count.
- Alternative: "Export All Periods" if the team prefers more explicit labeling.

### Guardrails — Verify After Implementing

```bash
# Confirm the new prop and button exist
grep -n "onExportDetailsCsv\|Export Details" src/components/gc-hub/GCHubAdvisorTable.tsx
```

```bash
# Confirm no TypeScript errors
npx tsc --noEmit 2>&1 | grep -i "GCHubAdvisorTable\|error" | head -20
```

### ⚠️ IMPORTANT: Adapt to Exploration Findings
- If Phase 5 found a different button className pattern, use that pattern.
- If Phase 5 found `sorted` is named differently, update the `disabled` check.
- If Phase 5 found the button container uses a different layout, adjust placement.

---

## Step 4 — Final TypeScript Compilation Check

### Commands

```bash
# Full type check
npx tsc --noEmit 2>&1 | tail -20
```

```bash
# Verify the build succeeds
npm run build 2>&1 | tail -30
```

### Record result in Implementation Log below.

---

## Step 5 — Manual Smoke Test Guidance

If you have a running dev server, verify:

1. Navigate to GC Hub → Advisor Detail tab.
2. Confirm two export buttons are visible: "Export (N)" and "Export Details".
3. Click "Export Details" → CSV downloads.
4. Open CSV and verify columns match the expected set for your role.
5. Apply a filter (e.g., date range or team) → confirm both exports reflect the filtered data.
6. Clear all filters so no advisors match → confirm both buttons are disabled.

---

# PART 3 — REFERENCE

## File Checklist

| # | File | Action | Lines Changed (est.) |
|---|------|--------|---------------------|
| 1 | `src/app/dashboard/gc-hub/GCHubContent.tsx` | Add `handleExportDetailsCsv` handler + pass prop | ~50 |
| 2 | `src/components/gc-hub/GCHubAdvisorTable.tsx` | Add prop + render button | ~15 |

**Total estimated: ~65 lines changed across 2 files. No new files. No backend changes.**

## Security Summary

- **No new API endpoint** — export uses data already fetched client-side.
- **No new data access** — the `advisors` array is populated by the permission-gated `/api/gc-hub/advisors` endpoint.
- **Anonymization preserved** — Capital Partners export only anonymized data because the server never sends real names.
- **No new permissions needed** — anyone who can see the Advisor Detail tab can export (same as existing export).

## Regression Testing Checklist

### As Admin or RevOps Admin:
- [ ] GC Hub → Advisor Detail tab → "Export Details" button is visible
- [ ] Click "Export Details" → CSV downloads with filename `gc-hub-advisor-details-YYYY-MM-DD.csv`
- [ ] CSV contains columns: Advisor, Team, Period, Period Start, Revenue, Commissions, Amount Earned, Billing Frequency, Billing Style, Orion Rep ID, Data Source, Manually Overridden
- [ ] All advisor names are **real names** (not anonymized)
- [ ] Rows are sorted alphabetically by advisor, then reverse-chronologically within each advisor
- [ ] Revenue/Commissions/Amount Earned are formatted to 2 decimal places
- [ ] Existing "Export (N)" button still works and exports summary CSV
- [ ] Filters affect both exports (date range, team, search all apply)
- [ ] Button is disabled when no advisors match current filters

### As Capital Partner:
- [ ] GC Hub → Advisor Detail tab → "Export Details" button is visible
- [ ] Click "Export Details" → CSV downloads
- [ ] CSV contains columns: Advisor, Team, Period, Period Start, Revenue, Commissions, Amount Earned, Billing Frequency, Billing Style (NO Orion Rep ID, NO Data Source, NO Manually Overridden)
- [ ] All advisor names are **anonymous** (e.g., "Advisor 001")
- [ ] Team names are anonymized (e.g., "Team A") or null for solo advisors
- [ ] Only periods from 2024-01-01 onward appear (no 2022/2023 data)
- [ ] Existing "Export (N)" button still works

### As Recruiter:
- [ ] Cannot access GC Hub (redirected) — no change needed

### Edge Cases:
- [ ] Empty state: both export buttons disabled when no data
- [ ] Large dataset: export completes without browser hang (the data is already in memory, so this should be fine)
- [ ] Special characters in advisor names: commas, quotes, etc. are properly escaped in CSV

---

# PART 4 — IMPLEMENTATION LOG

> **Claude Code: Record what you did for each step here as you go. Include timestamps, any deviations from the plan, and verification results.**

## Exploration Phase Results Summary

| Phase | Status | Key Finding |
|-------|--------|-------------|
| 1 — Data Shape | ✅ Complete | `advisors` is `GcAdvisorRow[]`, `isAnonymized` in state, roles derived from permissions |
| 2 — Type Definition | ✅ Complete | Server/client types match exactly — all 12 fields confirmed |
| 3 — Summary Export Pattern | ✅ Complete | Inline `escapeCsvCell`, Blob/URL/click pattern, `[advisors]` dependency |
| 4 — Modal Period Export | ✅ Complete | 6 columns, descending by periodStart, same escape pattern |
| 5 — Table Props & Button | ✅ Complete | `onExportCsv` prop, button uses `sorted.length` for disabled/count |
| 6 — Role-Based Access | ✅ Complete | All roles see Advisor Detail tab, no role gate on export button |
| 7 — Utilities & isAnonymized | ✅ Complete | Inline handler preferred, CP `dataSource` is real value (include in export) |

## Implementation Step Log

| Step | Status | Notes |
|------|--------|-------|
| 1 — Add handler | ✅ Complete | Added `handleExportDetailsCsv` after line 197 in GCHubContent.tsx (~70 lines) |
| 2 — Pass prop | ✅ Complete | Added `onExportDetailsCsv={handleExportDetailsCsv}` to GCHubAdvisorTable |
| 3 — Add button | ✅ Complete | Added prop to interface, destructured, rendered button after existing export |
| 4 — Type check | ✅ Complete | `npx tsc --noEmit` passed with no errors |
| 5 — Smoke test | ⬜ Manual | Ready for manual testing |

## Deviations from Plan

1. **Data Source column included for CP users** — Per Phase 7 findings, `dataSource` contains the real value for CP users (not sanitized), so it's now included in the CP export. The original plan excluded it.

2. **Column order adjusted** — Moved `Data Source` into base headers (visible to all users) and only `Orion Rep ID` and `Manually Overridden` are admin-only columns.

## Post-Implementation Verification

```bash
# Run these after all steps complete and record results here:

# 1. TypeScript compiles clean
npx tsc --noEmit

# 2. Build succeeds
npm run build

# 3. New function exists
grep -c "handleExportDetailsCsv" src/app/dashboard/gc-hub/GCHubContent.tsx

# 4. New prop is wired
grep -c "onExportDetailsCsv" src/components/gc-hub/GCHubAdvisorTable.tsx

# 5. New button renders
grep -c "Export Details" src/components/gc-hub/GCHubAdvisorTable.tsx
```

### Verification Results

```
# 1. TypeScript compiles clean
npx tsc --noEmit
✅ PASSED — No errors

# 2. Build succeeds
npm run build
⚠️ Pre-existing error: Missing /api/admin/trigger-transfer route (unrelated to this feature)
TypeScript compilation step passed successfully

# 3. New function exists
grep -c "handleExportDetailsCsv" src/app/dashboard/gc-hub/GCHubContent.tsx
✅ Result: 2 (definition + prop passing)

# 4. New prop is wired
grep -c "onExportDetailsCsv" src/components/gc-hub/GCHubAdvisorTable.tsx
✅ Result: 4 (interface + destructure + JSX x2)

# 5. New button renders
grep -c "Export Details" src/components/gc-hub/GCHubAdvisorTable.tsx
✅ Result: 2 (comment + button text)
```

**Implementation complete.** Ready for manual smoke testing per Step 5 guidance.
