# Refactor Triage — DetailRecordsTable.tsx

## Target
`src/components/dashboard/DetailRecordsTable.tsx` (708 lines)

## Classification: Lane 2a — Low-blast-radius UI/component extraction

## Why Lane 2a
- `'use client'` component under `src/components/dashboard/`
- **3 consumers**: `VolumeDrillDownModal.tsx` (relative), `ExploreResults.tsx` (relative), `page.tsx` (`next/dynamic`)
- No barrel file involvement
- `next/dynamic` import exists in `page.tsx` but targets the file path `@/components/dashboard/DetailRecordsTable` — NOT being changed
- No server/client boundary hazard (already `'use client'`)
- Proposed extractions are pure helpers and dead code removal — no API surface change
- No coupling to blocked areas (component uses `ExportButton` but we don't touch it; consumed by `VolumeDrillDownModal` but we don't change the component's props)

## Agentic Leverage: Medium
- **Isolates pure logic from UI**: `fuzzyMatch` (40 lines) and `getFirstName` (4 lines) are pure functions that could be reused by other search features
- **Removes dead code**: `sortRecords` (54 lines) is never called — the component uses its own inline `useMemo` sort instead. Removing it reduces confusion for agents scanning the file.
- **Faster comprehension**: Reducing from 708 to ~610 lines by removing dead code and extracting pure helpers

## Blast Radius: Tiny
- 3 consumers (all use only the `DetailRecordsTable` export which is unchanged)
- No barrel file
- `next/dynamic` path unchanged
- No export signature change

## May /auto-refactor proceed: YES

## Non-goals / Hard Constraints
- Do NOT change the component's props interface or export name
- Do NOT change the `@/components/dashboard/DetailRecordsTable` import path
- Do NOT change sorting, filtering, search, or date display behavior
- Do NOT touch ExportButton usage
- Do NOT change any data semantics or record construction

## Split Assessment
Single refactor — two independent extractions (helpers + dead code removal), both trivially safe.

## Bug/Observation Found
`sortRecords` function (lines 99-152) is dead code. It was likely the original sorting implementation, superseded by the inline `useMemo` sort at lines 312-361 which uses `getDisplayDate` instead of `relevantDate`. The function's own comment (lines 127-128) acknowledges this: "This standalone function uses relevantDate for backward compatibility / The actual sorting in the component uses getDisplayDate via inline logic." This is dead code, not a bug — safe to remove.
