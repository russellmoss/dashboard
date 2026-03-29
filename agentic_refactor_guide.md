# Refactor Guide — DetailRecordsTable.tsx (Lightweight Lane 2a)

## 1. Refactor Summary
- **Target**: `src/components/dashboard/DetailRecordsTable.tsx` (708 lines)
- **Lane**: 2a (lightweight)
- **Summary**: Remove 54 lines of dead code (`sortRecords` function) and extract two pure helper functions (`fuzzyMatch`, `getFirstName`) to a sibling utils file, reducing the component to ~610 lines with no API surface change.

## 2. Scope and Non-Goals
- **Scope**: Delete dead `sortRecords` function; extract `fuzzyMatch` and `getFirstName` to `detail-records-table-utils.ts`
- **Non-goals**: No props changes, no sort behavior changes, no date logic changes, no SortableHeader extraction
- **Blocked areas confirmed untouched**: No semantic layer, no drill-down construction, no export shape, no query changes

## 3. Pre-Flight
```bash
npx tsc --noEmit          # baseline typecheck
npm run build             # baseline build (if Prisma DLL not locked)
grep -rn "sortRecords" src/components/dashboard/DetailRecordsTable.tsx  # confirm only definition, no call sites
```

## 4. Execution Phases

### Phase 1: Remove dead `sortRecords` function

**Leverage**: low — dead code removal is cleanup, not structural improvement.
**Risk**: low — function is not exported and has zero call sites.
**Recommendation**: apply.

**Files touched**:
- **MODIFY** `src/components/dashboard/DetailRecordsTable.tsx`

**What changes**: Delete lines 99-152 (the `sortRecords` function definition and its JSDoc comment). The component's inline `useMemo` sort at line 312 is the actual active sort logic and is untouched.

**Validation**: `npx tsc --noEmit`

---

### Phase 2: Extract pure helpers → `detail-records-table-utils.ts`

**Leverage**: medium — isolates reusable pure string utilities; `fuzzyMatch` is a non-trivial algorithm (40 lines) that could serve other search features.
**Risk**: low — pure functions with zero imports, zero state, zero side effects.
**Recommendation**: apply.

**Files touched**:
- **NEW** `src/components/dashboard/detail-records-table-utils.ts`
- **MODIFY** `src/components/dashboard/DetailRecordsTable.tsx`

**What moves**:
- `fuzzyMatch(query: string, text: string): boolean` (40 lines)
- `getFirstName(fullName: string): string` (4 lines)

**New file structure**:
```ts
/**
 * Fuzzy matching function for advisor names
 * ...existing JSDoc...
 */
export function fuzzyMatch(query: string, text: string): boolean {
  // ...existing implementation...
}

/**
 * Extract first name from full name for sorting purposes
 * ...existing JSDoc...
 */
export function getFirstName(fullName: string): string {
  // ...existing implementation...
}
```

**Import/export updates**:
- `DetailRecordsTable.tsx` adds: `import { fuzzyMatch, getFirstName } from './detail-records-table-utils';`
- Remove the two function definitions from `DetailRecordsTable.tsx`

**Call sites to verify** (all within `DetailRecordsTable.tsx`):
- `fuzzyMatch`: line ~307 (`return fuzzyMatch(searchQuery, searchValue)`)
- `getFirstName`: lines ~320-321, ~347, ~352 (within the `useMemo` sort)

**Validation**: `npx tsc --noEmit`

---

### Phase 3: Final validation

```bash
npx tsc --noEmit     # full typecheck
npm run build        # full Next.js build
npm run lint         # lint check
```

## 5. Post-Refactor Verification
```bash
npx tsc --noEmit
npm run build
npm run lint
grep -rn "fuzzyMatch\|getFirstName\|sortRecords" src/components/dashboard/DetailRecordsTable.tsx
grep -rn "fuzzyMatch\|getFirstName" src/components/dashboard/detail-records-table-utils.ts
npx agent-guard sync
npm run gen:all
```

## 6. Rollback
All changes are in `src/components/dashboard/` only (one new file, one modified file). Revert with `git checkout -- src/components/dashboard/DetailRecordsTable.tsx` and delete `detail-records-table-utils.ts`. No other files affected.
