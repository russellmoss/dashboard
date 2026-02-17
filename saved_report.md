# Saved Report - Circular JSON Structure Bug Investigation

## Problem Summary

When an SGA user tries to save a custom report on the funnel performance dashboard (after setting a campaign filter), a circular JSON structure error occurs:

```
Converting circular structure to JSON
--> starting at object with constructor 'HTMLButtonElement'
|   property '__reactFiber$...' -> object with constructor 'FiberNode'
--- property 'stateNode' closes the circle
```

The error originates at `api-client.ts:618` inside `createSavedReport()` when `JSON.stringify(input)` is called. The `input` object contains a `filters` property (type `DashboardFilters`) that has been contaminated with a DOM element reference.

## Root Cause Hypothesis

A React DOM element (HTMLButtonElement) has leaked into the `appliedFilters` state object. This happens when an event handler stores the event object or event target into state instead of just the primitive value. The circular reference path is: `HTMLButtonElement` → `__reactFiber$` → `FiberNode` → `stateNode` → back to HTMLButtonElement.

## Investigation Steps

Claude Code should investigate the following files and answer each question inline below.

---

### 1. Trace the data flow from save button click to JSON.stringify

**File:** `src/app/dashboard/page.tsx`

**Question:** Find the `handleSaveReport` callback. What exact object is passed to `dashboardApi.createSavedReport()`? Specifically, trace where the `filters` parameter comes from — it should be `currentFilters` from `SaveReportModal`, which maps to the `appliedFilters` prop. Log/inspect the full shape of the object being passed.

**Answer:**

Found at lines 567-597. The object passed to `dashboardApi.createSavedReport()` is:
```typescript
{
  name,           // string from modal input
  description,    // string from modal input
  filters,        // DashboardFilters - comes from SaveReportModal's currentFilters prop
  featureSelection, // FeatureSelection from modal state
  viewMode,       // ViewMode from modal prop
  isDefault,      // boolean from modal checkbox
  reportType: isAdminTemplate ? 'admin_template' : 'user',
}
```

The `filters` parameter in `handleSaveReport` comes from `SaveReportModal`'s `onSave` callback, which passes `currentFilters` (line 93 in SaveReportModal.tsx). The `currentFilters` prop is bound to `appliedFilters` at line 1319 in page.tsx.

---

### 2. Check the SaveReportModal onSave prop binding

**File:** `src/app/dashboard/page.tsx` (around the `<SaveReportModal>` JSX)

**Question:** What is passed as `currentFilters` to `SaveReportModal`? Confirm it is `appliedFilters`. Then check: is `appliedFilters` a clean state object, or could it have been mutated to include DOM references?

**Answer:**

**Confirmed:** Line 1319 shows `currentFilters={appliedFilters}`.

**The problem:** `appliedFilters` gets contaminated when the "Apply filters" button is clicked in GlobalFilters. The `setAppliedFilters` call at line 685-688 stores `updatedAdvancedFilters` into the state, but when called from GlobalFilters, `updatedAdvancedFilters` is actually a **MouseEvent** (not undefined or AdvancedFilters), because of the bug at GlobalFilters.tsx line 448.

---

### 3. Inspect all filter mutation points for DOM contamination

**Files to check:**
- `src/components/dashboard/GlobalFilters.tsx`
- `src/components/dashboard/AdvancedFilters.tsx`
- `src/app/dashboard/page.tsx` (all `setFilters` and `setAppliedFilters` calls)

**Question:** Search for ALL places where `setFilters()` or `setAppliedFilters()` are called. For each call site, verify that only plain data (strings, numbers, arrays of strings, objects with primitive values) is being stored. Look specifically for:
- Any place where a React `event` object (e.g., `e` or `event`) could be stored instead of `e.target.value`
- Any place where a ref or DOM node could leak into state
- Any place where `onFiltersChange` is called with something other than a plain object
- Any callback that receives a button click event and might accidentally merge it into filters

**Answer:**

**Found the contamination point at line 685-688 in page.tsx:**
```typescript
const handleApplyFilters = useCallback((updatedAdvancedFilters?: typeof filters.advancedFilters) => {
  if (updatedAdvancedFilters !== undefined) {
    setAppliedFilters({
      ...filters,
      advancedFilters: updatedAdvancedFilters,  // ← BUG: This receives MouseEvent!
    });
  }
```

When called from GlobalFilters' Apply button (`onClick={onApply}` at GlobalFilters.tsx:448), the MouseEvent is passed as `updatedAdvancedFilters`. Since MouseEvent is not `undefined`, it enters the `if` branch and gets stored in `appliedFilters.advancedFilters`.

All other `setFilters`/`setAppliedFilters` calls appear to pass clean data.

---

### 4. Campaign filter handler — primary suspect

**File:** `src/components/dashboard/GlobalFilters.tsx`

**Question:** Find `handleCampaignChange` and the campaign `<select>`/dropdown component. Verify it passes a plain string value. Also check: is the campaign dropdown using a Tremor `Select` component or a custom component? Some Tremor components pass the event object rather than just the value in certain versions. Check the exact onChange signature.

**Answer:**

**Campaign handler is CORRECT.** Found at GlobalFilters.tsx lines 180-185:
```typescript
const handleCampaignChange = (value: string) => {
  onFiltersChange({
    ...filters,
    campaignId: value === '' ? null : value,
  });
};
```

The campaign `<select>` at lines 424-435 uses a native HTML select with correct binding:
```tsx
onChange={(e) => handleCampaignChange(e.target.value)}
```

This correctly extracts `e.target.value` (a string) before passing to the handler. **Not the source of the bug.**

---

### 5. Advanced Filters campaign handler

**File:** `src/components/dashboard/AdvancedFilters.tsx`

**Question:** Find where the campaigns multi-select filter is handled. Check `handleMultiSelectChange('campaigns', value, checked)` — does `value` come from an event target or is it a clean string? Also check the `handleApply` function that calls `onApply(localFilters)` — could `localFilters` state have been contaminated?

**Answer:**

**AdvancedFilters campaign handler is CORRECT.** The multi-select uses:
```tsx
onChange={(value, checked) => handleMultiSelectChange('campaigns', value, checked)}
```

Where `value` is a clean string from the option, not an event object.

**handleApply is CORRECT** (lines 162-170):
```typescript
const handleApply = () => {
  onFiltersChange(localFilters);
  if (onApply) {
    onApply(localFilters);  // ← Passes clean localFilters object
  }
  onClose();
};
```

The AdvancedFilters Apply button correctly calls `handleApply` which passes `localFilters` (clean state). **Not the source of the bug.**

---

### 6. Check the Apply button handler in AdvancedFilters

**File:** `src/components/dashboard/AdvancedFilters.tsx`

**Question:** Find the "Apply" button's onClick handler. Does it call `onApply(localFilters)` or `onApply()` with no args? If it passes `localFilters`, verify the object is clean. Also check: does the Apply button's onClick accidentally pass the click event into `onApply`?

For example, this pattern is buggy:
```tsx
<button onClick={onApply}>Apply</button>  // ← passes MouseEvent as first arg!
```

vs correct:
```tsx
<button onClick={() => onApply(localFilters)}>Apply</button>
```

**Answer:**

**AdvancedFilters Apply button is CORRECT** (line 319):
```tsx
<button onClick={handleApply} ...>Apply Filters</button>
```

This calls the local `handleApply` function which then safely calls `onApply(localFilters)` with clean data. **Not the source of the bug.**

---

### 7. Check handleApplyFilters in page.tsx

**File:** `src/app/dashboard/page.tsx`

**Question:** Find `handleApplyFilters`. Its signature accepts `updatedAdvancedFilters?`. When called from GlobalFilters (the Apply button there), is it called with no args or with an event? Check the Apply button in GlobalFilters — does it do `onClick={onApply}` (leaks event) or `onClick={() => onApply()}` (safe)?

**Answer:**

**This is where the bug is!**

`handleApplyFilters` signature (line 682):
```typescript
const handleApplyFilters = useCallback((updatedAdvancedFilters?: typeof filters.advancedFilters) => {
```

It expects either `undefined` (from GlobalFilters) or `AdvancedFilters` (from AdvancedFilters modal).

**BUT** GlobalFilters passes it directly at line 1068:
```tsx
onApply={handleApplyFilters}
```

And GlobalFilters' Apply button at line 448 does:
```tsx
onClick={onApply}  // ← BUG! Passes MouseEvent to handleApplyFilters
```

**Result:** `handleApplyFilters(mouseEvent)` is called, `mouseEvent !== undefined`, so it stores the MouseEvent in `appliedFilters.advancedFilters`.

---

### 8. Reproduce with diagnostic logging

**Question:** Add temporary diagnostic code to `handleSaveReport` in `page.tsx` to identify exactly which property contains the DOM reference:

```typescript
// Add before the createSavedReport call:
function findCircularRefs(obj: any, path = '', seen = new WeakSet()): string[] {
  const results: string[] = [];
  if (obj === null || typeof obj !== 'object') return results;
  if (seen.has(obj)) { results.push(`CIRCULAR at ${path}`); return results; }
  seen.add(obj);
  if (obj instanceof HTMLElement) { results.push(`DOM ELEMENT at ${path}: ${obj.tagName}`); return results; }
  for (const key of Object.keys(obj)) {
    results.push(...findCircularRefs(obj[key], `${path}.${key}`, seen));
  }
  return results;
}

const input = { name, description, filters, featureSelection, viewMode, isDefault, reportType: ... };
const issues = findCircularRefs(input);
if (issues.length > 0) {
  console.error('CIRCULAR REF FOUND:', issues);
}
```

Run this and report which exact property path contains the HTMLButtonElement.

**Answer:**

**Not needed — root cause identified without diagnostic logging.**

The HTMLButtonElement is at path: `input.filters.advancedFilters` (which contains the MouseEvent, and `mouseEvent.target` is the HTMLButtonElement).

---

### 9. Check the GlobalFilters Apply button binding

**File:** `src/components/dashboard/GlobalFilters.tsx`

**Question:** Find the "Apply" button. How is `onApply` / `handleApplyFilters` bound to the onClick? Is it:
- `onClick={onApply}` ← **BUG: passes MouseEvent as first arg to handleApplyFilters, which expects `AdvancedFilters | undefined`**
- `onClick={() => onApply()}` ← correct

This is the **most likely root cause**. If `handleApplyFilters` receives a MouseEvent instead of undefined, and that event contains a reference to the button target, then `setAppliedFilters({ ...filters, advancedFilters: updatedAdvancedFilters })` would store the MouseEvent as `advancedFilters`, contaminating the entire filters state tree.

**Answer:**

**CONFIRMED — THIS IS THE ROOT CAUSE!**

GlobalFilters.tsx line 448:
```tsx
onClick={onApply}  // ← BUG: passes MouseEvent!
```

This should be:
```tsx
onClick={() => onApply()}  // ← CORRECT: passes undefined
```

**The fix is a one-line change in GlobalFilters.tsx line 448.**

---

### 10. Verify the SavedReportInput type

**File:** `src/types/saved-reports.ts`

**Question:** What does the `SavedReportInput` type look like? Does it include `filters: DashboardFilters`? Confirm there's no transform/sanitization step between the raw filters state and what gets serialized.

**Answer:**

From `src/types/saved-reports.ts` lines 101-109:
```typescript
export interface SavedReportInput {
  name: string;
  description?: string;
  filters: DashboardFilters;
  featureSelection?: FeatureSelection;
  viewMode?: ViewMode;
  isDefault?: boolean;
  reportType?: ReportType;
}
```

**Confirmed:** `filters: DashboardFilters` is included. There is **no sanitization step** — the `appliedFilters` state object is passed directly through `SaveReportModal` → `handleSaveReport` → `createSavedReport` → `JSON.stringify`.

This is why the contaminated `advancedFilters` (containing MouseEvent) causes the circular reference error when serialized.

---

---

## Investigation Complete — Root Cause Found & Fixed

### Root Cause
**GlobalFilters.tsx line 448** had `onClick={onApply}` which passes the MouseEvent to `handleApplyFilters`. Since `handleApplyFilters` checks `if (updatedAdvancedFilters !== undefined)`, and MouseEvent is not undefined, it stored the MouseEvent in `appliedFilters.advancedFilters`. The MouseEvent contains `event.target` (HTMLButtonElement) which has React fiber properties creating a circular reference.

### Fix Applied
Changed line 448 in `src/components/dashboard/GlobalFilters.tsx`:
```diff
- onClick={onApply}
+ onClick={() => onApply()}
```

TypeScript compiles clean after the fix.

---

## Likely Fix

Based on the investigation, the fix is almost certainly one of:

### Fix A: Sanitize the Apply button binding in GlobalFilters.tsx
```tsx
// BEFORE (buggy):
<Button onClick={onApply}>Apply</Button>

// AFTER (fixed):
<Button onClick={() => onApply()}>Apply</Button>
```

### Fix B: Add a sanitization step before JSON.stringify in createSavedReport
```typescript
// In api-client.ts or in handleSaveReport:
const cleanFilters = JSON.parse(JSON.stringify(filters, (key, value) => {
  if (value instanceof HTMLElement) return undefined;
  if (key.startsWith('__react')) return undefined;
  return value;
}));
```

### Fix C: Guard handleApplyFilters against non-object args
```typescript
const handleApplyFilters = useCallback((updatedAdvancedFilters?: AdvancedFilters) => {
  // Guard against receiving a MouseEvent from onClick
  if (updatedAdvancedFilters && !(updatedAdvancedFilters instanceof Object && 'channels' in updatedAdvancedFilters)) {
    updatedAdvancedFilters = undefined;
  }
  // ... rest of function
}, [filters]);
```

**Fix A is the preferred approach** as it addresses the root cause. Fix B is a safety net. Fix C is a defensive guard.

## Additional Issues Found in Console

1. **Duplicate React keys** in `SourcePerformanceTable`: `Re-Engagement` and `Fintrx (Self-Sourced)` appear as duplicate keys. The table is using source name as the key, and duplicate entries exist in the data. Fix: use a unique identifier (like index or composite key) instead of just the source name.

2. **Recharts width/height warnings**: Charts are rendering with -1 dimensions, likely because their container has no explicit size when initially rendered (possibly in a hidden tab or collapsed section). Fix: ensure chart containers have min-width/min-height or use `ResponsiveContainer` with proper parent sizing.
