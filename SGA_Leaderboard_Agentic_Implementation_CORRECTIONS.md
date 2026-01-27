# SGA Leaderboard Agentic Implementation Plan - Key Corrections

## Summary of Corrections Made

This document summarizes the critical corrections made to align the agentic implementation plan with the actual codebase patterns, BigQuery schema, and data handling.

---

## 1. Query Function Corrections

### ❌ INCORRECT (Original Plan):
- Used CTEs (Common Table Expressions) with separate `sga_attribution` and `active_sgas` CTEs
- Used `CASE WHEN v.Opp_SGA_Name__c LIKE '005%'` pattern
- Used `INNER JOIN` between CTEs
- Date format: `CONCAT(@endDate, 'T23:59:59')`

### ✅ CORRECT (Updated Plan):
- Use simpler query with `EXISTS` subquery (matches existing pattern)
- Use `COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)` pattern
- Use `EXISTS` subquery for active SGA filtering (more efficient)
- Date format: `CONCAT(@endDate, ' 23:59:59')` (space, not 'T')

**Why**: The EXISTS pattern is simpler, more efficient, and matches existing query patterns in the codebase.

---

## 2. Type Location Corrections

### ❌ INCORRECT (Original Plan):
- Export types from query file: `export interface LeaderboardEntry { ... }` in `sga-leaderboard.ts`
- Import types from query file in API route

### ✅ CORRECT (Updated Plan):
- Types MUST be in `src/types/sga-hub.ts` (not query file)
- Import types from `@/types/sga-hub` in all files
- Query file imports types, doesn't export them

**Why**: Consistent with codebase pattern - all SGA Hub types are in `sga-hub.ts`.

---

## 3. SGA Attribution Pattern Corrections

### ❌ INCORRECT (Original Plan):
```sql
COALESCE(
  CASE 
    WHEN v.Opp_SGA_Name__c LIKE '005%' THEN sga_user.Name
    ELSE v.Opp_SGA_Name__c
  END,
  v.SGA_Owner_Name__c
)
```

### ✅ CORRECT (Updated Plan):
```sql
COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)
```

**Why**: 
- The User table join handles User ID resolution automatically
- No need for CASE statement - `COALESCE` with User join is sufficient
- Matches pattern used in `quarterly-progress.ts` and other queries

---

## 4. Component Structure Corrections

### ❌ INCORRECT (Original Plan):
- Create separate `SGALeaderboard.tsx` component with all filters and state
- Pass filter options as props

### ✅ CORRECT (Updated Plan):
- Integrate directly into `SGAHubContent.tsx` (matches Quarterly Progress tab pattern)
- Filters in parent component (`SGAHubContent.tsx`)
- Only create `LeaderboardTable.tsx` component (display only, no filters)

**Why**: Consistent with existing tab pattern - Quarterly Progress tab has filters in parent component.

---

## 5. Quarter Format Corrections

### ❌ INCORRECT (Original Plan):
- Separate quarter and year dropdowns
- Custom `getQuarterDateRange()` function
- Format: `Q1`, `Q2`, etc. with separate year

### ✅ CORRECT (Updated Plan):
- Single quarter dropdown with "YYYY-QN" format (e.g., "2026-Q1")
- Use `getQuarterInfo()` helper from `sga-hub-helpers.ts`
- Format matches existing pattern in Quarterly Progress tab

**Why**: Matches existing codebase pattern - all quarter handling uses "YYYY-QN" format.

---

## 6. Drill-Down API Corrections

### ❌ INCORRECT (Original Plan):
- Change drill-down API to POST method
- Pass channels/sources in request body
- Update function signature to use params object

### ✅ CORRECT (Updated Plan):
- Keep GET method (consistent with existing drill-down routes)
- Pass channels/sources as query parameters using `searchParams.getAll()`
- Update function signature to accept optional `options` parameter

**Why**: Maintains consistency with existing `/api/sga-hub/drill-down/sqos` route pattern (GET method).

---

## 7. Date Handling Corrections

### ❌ INCORRECT (Original Plan):
- End date: `CONCAT(@endDate, 'T23:59:59')` (ISO format with 'T')
- Comparison: `< TIMESTAMP('2026-04-01')` (exclusive)

### ✅ CORRECT (Updated Plan):
- End date: `CONCAT(@endDate, ' 23:59:59')` (space separator)
- Comparison: `<= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))` (inclusive)

**Why**: Matches existing pattern in codebase - all date comparisons use space separator and inclusive end dates.

---

## 8. Ranking Logic Corrections

### ❌ INCORRECT (Original Plan):
- Complex ranking function with sorting and separate rank assignment
- Assumes entries need to be sorted first

### ✅ CORRECT (Updated Plan):
- Simpler ranking function that assumes entries are already sorted by SQL
- Just assigns ranks based on count changes
- SQL already orders by `sqo_count DESC, sga_name ASC`

**Why**: More efficient - SQL does the sorting, TypeScript just assigns ranks.

---

## 9. Filter Options API Corrections

### ❌ INCORRECT (Original Plan):
- Create new `getFilterOptions()` method
- Custom filter options endpoint

### ✅ CORRECT (Updated Plan):
- Use existing `dashboardApi.getFilterOptions()` method
- Uses existing `/api/dashboard/filters` endpoint
- Returns `FilterOptions` type with `channels` and `sources` arrays

**Why**: Reuses existing infrastructure - no need for new endpoint.

---

## 10. Medal Display Corrections

### ❌ INCORRECT (Original Plan):
- Use `Trophy` and `Medal` icons from lucide-react
- Complex icon positioning

### ✅ CORRECT (Updated Plan):
- Use emoji medals (🥇 🥈 🥉) for consistency with game leaderboard
- Simpler implementation
- Better cross-browser compatibility

**Why**: Matches existing game leaderboard pattern, simpler, and more reliable.

---

## 11. Active SGA Filter Corrections

### ❌ INCORRECT (Original Plan):
- Separate CTE for active SGAs
- INNER JOIN between CTEs

### ✅ CORRECT (Updated Plan):
- Use `EXISTS` subquery in main WHERE clause
- More efficient and matches existing patterns

**Why**: EXISTS subquery is more efficient and matches patterns used in other queries.

---

## 12. Channel Handling in Drill-Down

### ❌ INCORRECT (Original Plan):
- Use MAPPING_TABLE join for channel resolution
- `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')`

### ✅ CORRECT (Updated Plan):
- Use `Channel_Grouping_Name` directly (no MAPPING_TABLE join)
- Matches leaderboard query behavior

**Why**: Leaderboard uses `Channel_Grouping_Name` directly, so drill-down should match for consistency.

---

## Files Already Created

**IMPORTANT**: These files already exist and should be verified against the plan:

1. ✅ `src/lib/queries/sga-leaderboard.ts` - Already exists, verify it matches corrected plan
2. ✅ `src/app/api/sga-hub/leaderboard/route.ts` - Already exists, verify it matches corrected plan
3. ✅ `src/types/sga-hub.ts` - Types already exist, verify they match

**Action**: Before implementing, verify these existing files match the corrected patterns above.

---

## Critical Implementation Notes

1. **Always use parameterized queries** - Never string interpolation
2. **Types in sga-hub.ts** - Never export types from query files
3. **Date format** - Always use space separator: `' 23:59:59'` not `'T23:59:59'`
4. **SGA Attribution** - Always use `COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)`
5. **Quarter Format** - Always use "YYYY-QN" format with `getQuarterInfo()` helper
6. **Component Integration** - Integrate into SGAHubContent.tsx, not separate component
7. **Drill-Down Method** - Keep GET method, use query parameters for arrays
8. **Medal Icons** - Use emoji medals for consistency

---

## Validation Queries Updated

All validation queries in the plan have been updated to:
- Use correct SGA attribution pattern
- Use correct date format
- Include channel filters where applicable
- Match actual implementation patterns
