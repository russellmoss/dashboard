# Dependency Mapper Findings: DetailRecordsTable.tsx

**Target**: src/components/dashboard/DetailRecordsTable.tsx (708 lines)
**Date**: 2026-03-27
**Purpose**: Pre-refactor blast-radius assessment for Lane 2a eligibility

---

## 1. Scope

- **Target file**: src/components/dashboard/DetailRecordsTable.tsx
- **Proposed refactor kind**: Dead code removal (sortRecords at line 99) and potential extraction of pure helper functions (fuzzyMatch, getFirstName). No API surface change. No path change.

---

## 2. Direct Imports

All imports are at the top of the file (lines 3-10).

| Import | Source | Why it matters |
|---|---|---|
| useState, useMemo, useEffect, useCallback | react | Standard React hooks - no risk |
| Card, Table, TableHead, etc. | @tremor/react | UI primitives - presentation only |
| DetailRecord, ViewMode | @/types/dashboard | Pure TypeScript types - safe from either context |
| AdvancedFilters | @/types/filters | Pure TypeScript type - safe from either context |
| ExternalLink, Search, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown | lucide-react | Icon components - no risk |
| ExportButton | @/components/ui/ExportButton | Imported by direct path, NOT via barrel |
| InfoTooltip | @/components/ui/InfoTooltip | Imported by direct path, NOT via barrel |
| formatDate | @/lib/utils/format-helpers | Pure formatting utility - server-safe, no Node-only dependencies |

No Node-only dependencies (BigQuery SDK, Prisma, fs, crypto) are imported. All imports are client-safe.

---

## 3. Direct Exports

| Export | Kind | Notes |
|---|---|---|
| DetailRecordsTable | Named function export | The only export from this file. Line 154. |
| DetailRecordsTableProps | NOT exported | Interface is file-local only (line 16). |
| fuzzyMatch | NOT exported | Module-private function (line 38). |
| getFirstName | NOT exported | Module-private function (line 86). |
| sortRecords | NOT exported | Module-private function (line 99). **Dead code - never called.** |
| SortColumn, SortDirection, SearchField | NOT exported | File-local type aliases (lines 12-14). |

The file has exactly one public export: DetailRecordsTable.

---

## 4. Consumer Map

**Export: DetailRecordsTable** - 3 consumers confirmed, 0 API route consumers.

| Consumer | Import path used | Import mechanism |
|---|---|---|
| src/components/dashboard/VolumeDrillDownModal.tsx line 6 | ./DetailRecordsTable (relative) | Static import |
| src/components/dashboard/ExploreResults.tsx line 10 | ./DetailRecordsTable (relative) | Static import |
| src/app/dashboard/page.tsx lines 55-63 | @/components/dashboard/DetailRecordsTable (alias) | next/dynamic lazy import - named export unwrap via .then(mod => ({ default: mod.DetailRecordsTable })) |

No consumers outside src/components/dashboard/ except page.tsx. No test-only consumers found.

---

## 5. Barrel / Re-export Surface

The four known barrel files do NOT re-export this target:

- src/components/ui/index.ts - only exports ErrorBoundary, withErrorBoundary, ChartErrorBoundary, TableErrorBoundary, CardErrorBoundary, FilterErrorBoundary. No reference to DetailRecordsTable.
- src/components/advisor-map/index.ts - no reference.
- src/components/games/pipeline-catcher/index.ts - no reference.
- src/lib/semantic-layer/index.ts - no reference.

There is no barrel file in src/components/dashboard/ - each component is imported directly.

ExportButton and InfoTooltip (imported by the target) are also not part of the barrel at src/components/ui/index.ts. They are imported by direct file path everywhere.

---

## 6. Path Stability Constraints

| Path | Stability requirement | Reason |
|---|---|---|
| @/components/dashboard/DetailRecordsTable | Must remain stable | The next/dynamic in page.tsx (line 56) imports this exact alias path and unwraps the named export. If the file moves, this string must be updated. |
| ./DetailRecordsTable (relative from dashboard/) | Must remain stable (or consumers updated together) | Both VolumeDrillDownModal.tsx and ExploreResults.tsx use this relative path. |

**Compatibility re-export recommendation**: If the file is ever moved (not proposed here), a re-export stub at the original path would cover all three consumers simultaneously. Not needed for the proposed refactor, which involves only internal changes.

---

## 7. Server/Client Boundary

- **Target file** (DetailRecordsTable.tsx): use client directive at line 1. This is a client component.
- **Consumer VolumeDrillDownModal.tsx**: use client at line 1.
- **Consumer ExploreResults.tsx**: use client at line 2.
- **Consumer page.tsx**: No use client - this is a Server Component. Loads DetailRecordsTable exclusively via next/dynamic with ssr: false, which is the correct pattern for importing a client component from a server page.

**Proposed extraction - fuzzyMatch and getFirstName**: Both are pure string utilities with zero imports. If extracted to src/lib/utils/string-helpers.ts, they contain no Node-only code and are safe to import from either server or client context.

**sortRecords (dead code removal)**: Deleting it carries zero boundary risk - it is unreachable.

**No cross-boundary hazard exists** for any proposed change.

**next/dynamic fragility**: The page.tsx dynamic import at lines 55-63 references the path @/components/dashboard/DetailRecordsTable. This path is NOT being changed by the proposed refactor. No fragility.

---

## 8. Circular Dependency Risks

No circular dependency risk for the proposed refactor:

- fuzzyMatch and getFirstName have zero imports of their own. If extracted to a utility file, neither imports back into src/components/dashboard/.
- sortRecords deletion removes code - no new dependency edges created.
- The target import graph (react, @tremor/react, lucide-react, two type files, one utility, two ui/ components) has no paths that could cycle back through DetailRecordsTable.

If fuzzyMatch/getFirstName were extracted to src/lib/utils/string-helpers.ts, the import chain would be: DetailRecordsTable.tsx -> string-helpers.ts with no reverse edge possible (lib utilities never import components).

---

## 9. Safe Extraction Guidance

**What can move safely:**

1. **sortRecords (lines 99-152)** - Delete entirely. Defined but never called within the file. The active sorting logic lives in the useMemo at line 312. Not exported, so no consumer is affected. Zero blast radius.

2. **fuzzyMatch (lines 38-78)** - Can be extracted to a utility file (e.g., src/lib/utils/string-helpers.ts). Pure function, no imports, not exported. Internal call site at line 307 would need one import added. Alternatively, leave in place - self-contained and file-private.

3. **getFirstName (lines 86-89)** - Same as fuzzyMatch. Pure, no imports, private. Can extract or leave. If extracted alongside fuzzyMatch, call sites inside the now-deleted sortRecords are moot. Remaining call sites inside the useMemo (lines 320-321, 347, 352) would need the import.

**What should stay put:**

- DetailRecordsTable function component (lines 154-708) - No movement needed. Cohesive, already client-only, and the next/dynamic path in page.tsx constrains its location.
- DetailRecordsTableProps interface - file-local, not exported, stays with the component.
- SortColumn, SortDirection, SearchField type aliases - file-local, not exported, stays with the component.

**Recommended execution order (if extracting helpers):**

1. Delete sortRecords function (lines 99-152). Verify build passes.
2. Optionally extract fuzzyMatch and getFirstName to src/lib/utils/string-helpers.ts.
3. Add import of those helpers in DetailRecordsTable.tsx.
4. Verify no new lint errors or build failures.

Step 1 is fully independent and carries zero risk. Steps 2-3 are optional and low-risk but require one new import line.

---

## 10. Confidence / Unknowns

- **High confidence**: Consumer count (3) confirmed by exhaustive grep across all .ts/.tsx files. No API route consumers found.
- **High confidence**: Barrel file non-involvement confirmed by inspecting all four known barrel files.
- **High confidence**: sortRecords dead code confirmed - grep of the entire file finds only the definition at line 99, no call site.
- **High confidence**: next/dynamic path is stable - the proposed refactor does not move or rename the file.
- **Mild uncertainty**: If a test file outside src/ (e.g., __tests__/ or Cypress specs) imports DetailRecordsTable, it was not in scope of this grep. No test infrastructure was flagged during grep.

---

## 11. Lightweight Mode Eligibility

```
lightweight-eligible: yes
- consumers: 3 (VolumeDrillDownModal.tsx via relative, ExploreResults.tsx via relative, page.tsx via next/dynamic alias)
- barrel files: none - target is not re-exported by any of the four known barrel files
- dynamic imports: next/dynamic in page.tsx references @/components/dashboard/DetailRecordsTable - path is NOT changing, so no fragility
- server/client: safe - target is use client, proposed extractions (fuzzyMatch, getFirstName) are pure string utilities with no Node-only dependencies
- blocked areas: none - no drill-down record construction, no export shape changes, no semantic layer involvement, no forecast penalty logic, no permissions
- boundaries: clean - sortRecords is dead code with no callers; fuzzyMatch and getFirstName are private pure helpers with no imports of their own
- public API: stable - single export (DetailRecordsTable) remains at same path with same signature
```