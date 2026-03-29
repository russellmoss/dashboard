# Refactor Ready Summary — DetailRecordsTable.tsx

## 1. Refactor Target
`src/components/dashboard/DetailRecordsTable.tsx` (708 lines)

## 2. Triage Lane
Lane 2a (lightweight track)

## 3. Exact Scope
Remove dead `sortRecords` function (54 lines); extract `fuzzyMatch` and `getFirstName` pure helpers to sibling utils file.

## 4. Explicit Non-Goals
- SortableHeader extraction (closure coupling, low leverage)
- getDisplayDate / getDateColumnDescription extraction (fuzzy boundary)
- Type alias extraction (no reuse value)
- Component props interface changes
- Any sort/filter/date behavior changes

## 5. Files to Modify
1. **NEW** `src/components/dashboard/detail-records-table-utils.ts`
2. **MODIFY** `src/components/dashboard/DetailRecordsTable.tsx`

## 6. Ordered Execution Phases
1. Remove dead `sortRecords` function
2. Extract pure helpers to `detail-records-table-utils.ts`
3. Final validation

## 7. Validation Gates
- `npx tsc --noEmit` after each phase
- `npm run build` + `npm run lint` after final phase

## 8. Key Risks Being Guarded Against
1. `next/dynamic` path in page.tsx must remain stable (confirmed: not changing)
2. `getFirstName` call sites in useMemo sort must resolve after extraction (4 call sites verified)

## 9. Human Input Required
No

## 10. Final Recommendation
**Proceed.** All Lane 2a criteria confirmed. 3 consumers, no barrel involvement, `next/dynamic` path unchanged, clean extraction boundaries, zero behavior change. Council skipped — dead code removal + pure helper extraction with no API surface change.
