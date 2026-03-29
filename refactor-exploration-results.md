# Refactor Exploration Results — DetailRecordsTable.tsx

## 1. Pre-Flight Summary
DetailRecordsTable.tsx is a 708-line 'use client' component with 3 consumers (VolumeDrillDownModal, ExploreResults, page.tsx via next/dynamic). It contains a 54-line dead function (`sortRecords`) that is never called, and two pure helper functions (`fuzzyMatch`, `getFirstName`) that can be extracted. The component's export signature and import path are unchanged. All extractions are internal cleanup.

## 2. Triage Outcome
- **Lane**: 2a (lightweight)
- **Scope**: Remove dead code, extract pure helpers to sibling utils file
- **May proceed**: YES

## 3. Blast Radius Assessment
- **Consumer count**: 3 (VolumeDrillDownModal, ExploreResults, page.tsx)
- **Barrel involvement**: None
- **Dynamic import exposure**: page.tsx uses `next/dynamic` with `@/components/dashboard/DetailRecordsTable` — path NOT changing
- **Server/client boundary**: Safe — all imports client-safe
- **Low-blast-radius criteria**: ALL MET

## 4. Target Responsibilities Today
Single component that:
- Renders a sortable, searchable, paginated data table for detail records
- Supports fuzzy search across multiple fields (advisor, SGA, SGM, source, channel)
- Dynamic date column display based on stage filter and advanced filters
- Stage filter dropdown, export button, pagination controls
- Row click navigation to record detail

## 5. Safe Extraction Boundaries

### Extract 1: Remove dead `sortRecords` function
- Lines 99-152: 54-line function never called (confirmed by grep)
- The component uses its own inline `useMemo` sort at lines 312-361 instead
- Zero blast radius — not exported, not referenced

### Extract 2: Pure helpers → `detail-records-table-utils.ts` (sibling)
- `fuzzyMatch(query: string, text: string): boolean` (lines 38-78) — 40 lines, pure, no imports
- `getFirstName(fullName: string): string` (lines 86-89) — 4 lines, pure, no imports
- Call sites: `fuzzyMatch` at line 307, `getFirstName` at lines 320-321, 347, 352

## 6. Dependency Surface
- **Imports**: react, @tremor/react, @/types/dashboard, @/types/filters, lucide-react, ExportButton, InfoTooltip, formatDate
- **Exports**: `DetailRecordsTable` (single named export)
- **Consumers**: 3 — all import only `DetailRecordsTable`
- **Barrel files**: None
- **Path stability**: `@/components/dashboard/DetailRecordsTable` must remain (next/dynamic)

## 7. Files to Modify
1. **NEW** `src/components/dashboard/detail-records-table-utils.ts` — fuzzyMatch, getFirstName
2. **MODIFY** `src/components/dashboard/DetailRecordsTable.tsx` — remove dead code, import helpers from new file

## 8. Behavior Preservation Risks
- None. Dead code removal has zero behavior impact. Helper extraction preserves identical function signatures and logic.

## 9. Recommended Refactor Order
1. Remove dead `sortRecords` function (lines 99-152)
2. Create `detail-records-table-utils.ts` with `fuzzyMatch` and `getFirstName`
3. Update `DetailRecordsTable.tsx` to import from new file
4. Validate: `npx tsc --noEmit`

## 10. Blocked / Out-of-Scope Areas
- Component props interface — do not change
- ExportButton usage — do not touch
- Date display logic — do not touch
- Sorting behavior — do not change (only remove the unused standalone sort function)
- SortableHeader local component — leave as-is (closure coupling, low leverage)
