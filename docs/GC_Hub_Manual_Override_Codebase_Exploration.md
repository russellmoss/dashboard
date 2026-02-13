# GC Hub Manual Override — Codebase Exploration & Validation Guide

> **Purpose:** This document is a structured guide for Cursor.ai to explore the live codebase, answer critical open questions, validate assumptions made in `GC_Hub_Manual_Override_Implementation.md`, and update that plan as needed before execution.
>
> **How to use:** Work through each section in order. Each section has (a) a question, (b) the exact commands or file reads to answer it, (c) the assumption from the implementation plan, and (d) instructions for what to update in the implementation doc if the finding differs from the assumption.
>
> **Target file to update:** `C:\Users\russe\Documents\Dashboard\docs\GC_Hub_Manual_Override_Implementation.md`

---

## Table of Contents

1. [Phase 1: Prisma Schema Validation](#phase-1-prisma-schema-validation)
2. [Phase 2: Override API Route Validation](#phase-2-override-api-route-validation)
3. [Phase 3: Advisor Detail Query — The Critical Gap](#phase-3-advisor-detail-query--the-critical-gap)
4. [Phase 4: Advisor Detail API Route](#phase-4-advisor-detail-api-route)
5. [Phase 5: API Client Types](#phase-5-api-client-types)
6. [Phase 6: GCHubAdvisorModal Current State](#phase-6-gchuadvisormodal-current-state)
7. [Phase 7: GCHubContent → Modal Prop Wiring](#phase-7-gchubcontent--modal-prop-wiring)
8. [Phase 8: Existing Override Modal Check](#phase-8-existing-override-modal-check)
9. [Phase 9: Permission & Role Infrastructure](#phase-9-permission--role-infrastructure)
10. [Phase 10: TypeScript Compilation Baseline](#phase-10-typescript-compilation-baseline)
11. [Summary of Required Updates to Implementation Plan](#summary-of-required-updates-to-implementation-plan)

---

## Phase 1: Prisma Schema Validation

### Question
Does `GcAdvisorPeriodData` already have ALL the override-related fields the implementation plan assumes (`isManuallyOverridden`, `originalGrossRevenue`, `originalCommissionsPaid`, `overrideReason`, `overriddenBy`, `overriddenAt`)?

### Commands

```bash
# Print the full GcAdvisorPeriodData model from the Prisma schema
sed -n '/model GcAdvisorPeriodData/,/^}/p' prisma/schema.prisma
```

### Assumption (from implementation plan)
The plan states in §1.1 that ALL of these fields exist:
- `isManuallyOverridden` (Boolean, default false)
- `originalGrossRevenue` (Float?)
- `originalCommissionsPaid` (Float?)
- `overrideReason` (String?)
- `overriddenBy` (String?)
- `overriddenAt` (DateTime?)

And that **no schema changes are required**.

### If finding differs
If ANY of these fields are missing from the Prisma schema:

1. Add them to the implementation plan as a **Phase 0: Schema Migration** step
2. Provide the Prisma model additions needed
3. Generate and apply migration: `npx prisma migrate dev --name add-override-fields`
4. Update §1.1 in the implementation doc to reflect the actual current state

---

## Phase 2: Override API Route Validation

### Question
Does `src/app/api/gc-hub/override/route.ts` exist and function as described? Specifically:
- Does it accept PUT with `{ recordId, grossRevenue?, commissionsPaid?, reason }`?
- Does it check session and restrict to `admin` / `revops_admin`?
- Does it store originals on first override only?
- Does it recalculate `amountEarned`?

### Commands

```bash
# Print the full override route
cat src/app/api/gc-hub/override/route.ts
```

### Assumption (from implementation plan)
§1.2 describes the API as fully implemented and functional. The plan says "No schema change" and "API already exists."

### What to verify
1. **Role check logic**: Confirm it checks `role === 'admin' || role === 'revops_admin'` — not some other condition.
2. **First-override guard**: Confirm it checks `if (!existing.isManuallyOverridden)` before storing originals.
3. **amountEarned recalc**: Confirm `amountEarned = newRevenue - newCommissions` after update.
4. **Return shape**: Confirm the response includes `{ success, record: { id, advisorName, period, grossRevenue, commissionsPaid, amountEarned, isManuallyOverridden, overrideReason, overriddenBy, overriddenAt } }`.

### If finding differs
Update §1.2 and §5 (API Contract Summary) in the implementation doc with the actual request/response shape and behavior. If the role check uses a different mechanism (e.g., a shared utility function), note that in the plan.

---

## Phase 3: Advisor Detail Query — The Critical Gap

### Question
This is the **most important validation**. The `getGcAdvisorDetail` function in `src/lib/queries/gc-hub.ts` currently maps periods WITHOUT `id`. Does it also omit override metadata? What exact fields are returned per period for admin users vs. capital partners?

### Commands

```bash
# Print the full getGcAdvisorDetail function
# Find the function and print from its declaration to the next function or end of export
sed -n '/export async function getGcAdvisorDetail/,/^export async function\|^\/\/ ====/p' src/lib/queries/gc-hub.ts
```

```bash
# Also check if there's a separate version that DOES include id
grep -n "r\.id\|record\.id\|p\.id" src/lib/queries/gc-hub.ts
```

### Assumption (from implementation plan)
§1.3 states:
> "Period table rows are keyed by `p.period`; **no `id`**, no edit action, no override metadata."

The plan identifies this as **Gap #1**: "Advisor detail response does not include `id` (or override fields) per period for admin/revops."

### Critical detail to confirm
The implementation plan's Phase A (Step 1) says to modify the **non–capital-partner branch** of `getGcAdvisorDetail` to include:
```typescript
periods: records.map(r => ({
  id: r.id,                          // ADD THIS
  period: r.period,
  periodStart: r.periodStart.toISOString().split('T')[0],
  grossRevenue: r.grossRevenue,
  commissionsPaid: r.commissionsPaid,
  amountEarned: r.amountEarned,
  dataSource: r.dataSource,
  // Optional override metadata:
  isManuallyOverridden: r.isManuallyOverridden,
  originalGrossRevenue: r.originalGrossRevenue,
  originalCommissionsPaid: r.originalCommissionsPaid,
  overrideReason: r.overrideReason,
  overriddenBy: r.overriddenBy,
  overriddenAt: r.overriddenAt?.toISOString(),
})),
```

**Verify:**
1. Is there a capital-partner branch that returns anonymized data? (The plan assumes yes.)
2. Does the admin branch already return `id`? (The plan assumes no.)
3. What is the exact return type signature? (Needed for Phase A, Step 2.)

### If finding differs
- If `id` is ALREADY returned → remove Phase A Step 1 from the plan (or mark it as already done)
- If the function structure is different from what the plan assumes (e.g., no CP branch, different field set), update Phase A Step 1 with the correct code to modify
- If override metadata fields are already partially returned, note which ones and only add the missing ones

---

## Phase 4: Advisor Detail API Route

### Question
Does `src/app/api/gc-hub/advisor-detail/route.ts` simply pass through to `getGcAdvisorDetail`, or does it do additional transformation/filtering on the response?

### Commands

```bash
cat src/app/api/gc-hub/advisor-detail/route.ts
```

### Assumption (from implementation plan)
§4 File Checklist says: "Step A3 | `src/app/api/gc-hub/advisor-detail/route.ts` | No change (response follows query)."

### What to verify
1. The route calls `getGcAdvisorDetail(permissions, advisorName)` and returns `{ advisor: detail }` without stripping fields.
2. There's no additional serialization or field filtering that would strip `id` even if the query returns it.
3. Permissions check: confirms `allowedPages.includes(16)` and passes permissions to the query.

### If finding differs
If the API route strips fields or transforms the response, Phase A may need a Step A3 to update this route as well. Update the file checklist accordingly.

---

## Phase 5: API Client Types

### Question
What is the exact current `GcAdvisorDetail` interface in `src/lib/api-client.ts`? Does `periods[]` include `id`?

### Commands

```bash
# Find and print the GcAdvisorDetail interface
sed -n '/export interface GcAdvisorDetail/,/^}/p' src/lib/api-client.ts
```

```bash
# Also check the overrideValue function signature
grep -A 10 "overrideValue\|overridePeriodValues" src/lib/api-client.ts
```

### Assumption (from implementation plan)
§1.4 states:
> "`GcAdvisorDetail.periods[]` currently: `{ period, periodStart, grossRevenue, commissionsPaid, amountEarned, dataSource }`. No `id`, no `isManuallyOverridden`, etc."

And that `gcHubApi.overridePeriodValues` (or `overrideValue`) already exists.

### What to verify
1. Exact field list in `periods[]` — confirm no `id`.
2. Whether the override client method is named `overridePeriodValues` (per §1.4) or `overrideValue` (per actual api-client code seen in knowledge base). **This naming matters for Phase C, Step 7.**
3. What the override client method's return type is.

### If finding differs
- Update §1.4 with actual type definition
- If the override method name differs, update Phase C Step 7 (`GCHubOverrideModal` submit handler) to use the correct method name
- Update Phase A Step 2 with the exact fields to add to the `periods[]` type

---

## Phase 6: GCHubAdvisorModal Current State

### Question
What is the full current implementation of `GCHubAdvisorModal`? Specifically:
- What props does it accept?
- Does it have any `canEdit` or `isAdmin` prop?
- How does the period detail table render? What columns?
- Is there any existing edit/override UI?

### Commands

```bash
# Print the full component (it's ~200 lines based on knowledge base)
cat src/components/gc-hub/GCHubAdvisorModal.tsx
```

### Assumption (from implementation plan)
§1.3 states:
- Props: `advisorName`, `onClose` only
- No `canEdit` prop
- Period table columns: Period, Revenue, Commissions, Amount Earned, Source
- No `id` in period rows, no edit action, no override metadata

### What to verify
1. **Props interface**: Confirm only `{ advisorName: string; onClose: () => void }`. If it already has `canEdit` or similar, the plan needs updating.
2. **Period table rendering**: Find the `<table>` or map rendering periods. Confirm column order and that there is NO Actions column.
3. **Row key**: Confirm rows are keyed by `p.period` (or index), not `p.id`.
4. **Existing state**: Confirm there is NO `overridePeriod` state or similar.
5. **Refetch pattern**: How does the modal fetch data? `useEffect` with `gcHubApi.getAdvisorDetail`? This matters for Phase C Step 8 (refetch after override).

### If finding differs
- If `canEdit` prop already exists → simplify Phase B
- If table structure is different → adjust Phase B Step 5 column insertion point
- If there's already override state or UI → adjust Phase C scope
- Note the exact refetch mechanism for Phase C Step 8

---

## Phase 7: GCHubContent → Modal Prop Wiring

### Question
How does `GCHubContent.tsx` currently render `GCHubAdvisorModal`? What props are passed?

### Commands

```bash
# Find the modal rendering in GCHubContent
grep -A 5 "GCHubAdvisorModal" src/app/dashboard/gc-hub/GCHubContent.tsx
```

```bash
# Also confirm isAdmin derivation
grep -n "isAdmin" src/app/dashboard/gc-hub/GCHubContent.tsx
```

### Assumption (from implementation plan)
§1.3 implies and §4 Step B4 explicitly states that `GCHubContent.tsx` currently passes only `advisorName` and `onClose` to the modal. Phase B Step 4 says to add `canEdit={isAdmin}`.

### What to verify
1. Current props: `advisorName={selectedAdvisor}` and `onClose={() => setSelectedAdvisor(null)}` — confirm nothing else.
2. `isAdmin` derivation: `permissions?.role === 'admin' || permissions?.role === 'revops_admin'` — confirm this exact logic.
3. Rendering condition: `{selectedAdvisor && (isAdmin || isCapitalPartner) && (<GCHubAdvisorModal .../>)}` — confirm CP can open the modal (but won't get edit UI).

### If finding differs
- If additional props are already passed, update Phase B Step 4
- If `isAdmin` logic is different, update Phase B Step 4 and the security description
- If Capital Partners can NOT open the modal, the plan's §1.5 security model may need revision

---

## Phase 8: Existing Override Modal Check

### Question
Does a `GCHubOverrideModal` component already exist? Are there any other override-related components?

### Commands

```bash
# Check for existing override modal
ls src/components/gc-hub/GCHubOverrideModal.tsx 2>/dev/null && echo "EXISTS" || echo "DOES NOT EXIST"
```

```bash
# Check for any override-related components
find src/components/gc-hub -name "*override*" -o -name "*Override*" 2>/dev/null
```

```bash
# Also check for any override-related files anywhere in src/
find src -name "*override*" -o -name "*Override*" 2>/dev/null | grep -v node_modules | grep -v ".next"
```

### Assumption (from implementation plan)
Phase C Step 7 says to create `GCHubOverrideModal.tsx` as a **new** file.

### If finding differs
- If the file already exists, read it and determine if it's complete/partial/stub
- Update Phase C to either (a) modify existing component or (b) confirm it's a stub to be replaced
- If it exists and is functional, Phase C may be partially or fully done already

---

## Phase 9: Permission & Role Infrastructure

### Question
Confirm the role strings and permission checking used throughout the app, specifically:
- What role strings exist in `UserRole`?
- How does `getSessionPermissions` work?
- Does the override API use `getSessionPermissions` or a different auth pattern?

### Commands

```bash
# Check UserRole type
grep -A 20 "UserRole" src/types/user.ts | head -25
```

```bash
# Check how override API gets permissions
grep -n "getSession\|permissions\|role" src/app/api/gc-hub/override/route.ts
```

```bash
# Check if there's a shared role-check utility
grep -rn "isAdmin\|checkRole\|requireRole" src/lib/api-authz.ts 2>/dev/null | head -10
```

### Assumption (from implementation plan)
§1.5 states:
- Override API checks `role === 'admin' || role === 'revops_admin'` directly
- No middleware or shared utility change needed

### What to verify
1. Role strings: `'admin'`, `'revops_admin'` are exact strings used in the role check
2. The override route uses `getServerSession` + `getSessionPermissions` (same pattern as other routes)
3. There's no shared `isAdmin()` utility that should be reused instead of inline checks

### If finding differs
- If role strings are different (e.g., `'revops'` instead of `'revops_admin'`), update all references in the plan
- If there's a shared utility like `isAdminRole(permissions)`, use it in Phase B Step 4 and Phase C

---

## Phase 10: TypeScript Compilation Baseline

### Question
Does the project currently compile cleanly? Are there any existing type errors?

### Commands

```bash
npx tsc --noEmit 2>&1 | tail -20
```

```bash
npm run lint 2>&1 | tail -20
```

### Assumption
The implementation plan assumes a clean starting point.

### If finding differs
- Document any existing errors (they're pre-existing and not caused by this feature)
- Ensure the override implementation doesn't ADD errors
- If there are errors in GC Hub files specifically, they may need fixing first

---

## Summary of Required Updates to Implementation Plan

After completing all phases above, use this checklist to update `GC_Hub_Manual_Override_Implementation.md`:

### Checklist

| Phase | Question | Assumption | Confirmed? | Action if Different |
|-------|----------|------------|------------|---------------------|
| 1 | Override fields in Prisma schema | All 6 fields exist | ☐ Yes / ☐ No | Add Phase 0: Schema Migration |
| 2 | Override API route exists & works | Fully implemented | ☐ Yes / ☐ No | Update §1.2 and §5 |
| 3 | `getGcAdvisorDetail` periods omit `id` | No `id` in periods | ☐ Yes / ☐ No | If `id` present, simplify Phase A |
| 3b | CP branch exists in query | Anonymized branch exists | ☐ Yes / ☐ No | Update Phase A Step 1 |
| 4 | API route passes through without stripping | No transformation | ☐ Yes / ☐ No | Add Step A3 if needed |
| 5 | `GcAdvisorDetail` type omits `id` | No `id` in type | ☐ Yes / ☐ No | If present, simplify Phase A Step 2 |
| 5b | Override method name | `overridePeriodValues` | ☐ `overridePeriodValues` / ☐ `overrideValue` | Update Phase C Step 7 |
| 6 | Modal has only 2 props | `advisorName`, `onClose` | ☐ Yes / ☐ No | Update Phase B if more props |
| 6b | No existing edit UI in modal | No Actions column | ☐ Yes / ☐ No | Adjust Phase B Step 5 |
| 7 | Content passes only 2 props to modal | Only `advisorName`, `onClose` | ☐ Yes / ☐ No | Update Phase B Step 4 |
| 7b | `isAdmin` logic | `role === 'admin' \|\| role === 'revops_admin'` | ☐ Yes / ☐ No | Update security model |
| 8 | No existing GCHubOverrideModal | File does not exist | ☐ Yes / ☐ No | Update Phase C scope |
| 9 | Role strings correct | `'admin'`, `'revops_admin'` | ☐ Yes / ☐ No | Update all role references |
| 10 | Clean compilation | No TS errors | ☐ Yes / ☐ No | Document pre-existing errors |

---

## Consolidated File Read List

For convenience, here is every file that Cursor.ai should read (or key sections thereof) during this exploration:

| Priority | File | What to Look For |
|----------|------|------------------|
| **P0** | `prisma/schema.prisma` | `GcAdvisorPeriodData` model — all fields, especially override fields |
| **P0** | `src/app/api/gc-hub/override/route.ts` | Full route — role check, first-override logic, return shape |
| **P0** | `src/lib/queries/gc-hub.ts` | `getGcAdvisorDetail` function — period mapping, CP branch, `id` inclusion |
| **P0** | `src/components/gc-hub/GCHubAdvisorModal.tsx` | Full component — props, period table, state, fetch pattern |
| **P1** | `src/app/api/gc-hub/advisor-detail/route.ts` | Passthrough or transform? |
| **P1** | `src/lib/api-client.ts` | `GcAdvisorDetail` type + `gcHubApi.overrideValue` method name & signature |
| **P1** | `src/app/dashboard/gc-hub/GCHubContent.tsx` | Modal rendering + `isAdmin` derivation |
| **P2** | `src/types/user.ts` | `UserRole` union type |
| **P2** | `src/types/gc-hub.ts` | `GcOverridePayload` type |
| **P2** | `src/lib/api-authz.ts` | Any shared admin-check utilities |

---

## After Exploration: Update Procedure

Once all phases are complete and findings recorded:

1. **Open** `C:\Users\russe\Documents\Dashboard\docs\GC_Hub_Manual_Override_Implementation.md`
2. **Update §1 (Current State)** with any corrections from Phases 1-9
3. **Update §3 (Implementation Plan)** — adjust, remove, or add steps based on findings
4. **Update §4 (File Checklist)** — add/remove files as needed
5. **Update §5 (API Contract Summary)** — correct any field names or types
6. **Add a §8 (Exploration Findings)** section at the bottom summarizing what was confirmed vs. what changed, so future developers have context

### Key Principle
The implementation plan should be **executable as-is** after updates — Cursor.ai (or any developer) should be able to follow it step-by-step without needing to re-explore the codebase. Every file path, field name, method name, and code snippet in the plan must match the actual codebase.

---

## Appendix A: Known State from Knowledge Base (Pre-Exploration)

Based on project knowledge search (not live codebase — these are snapshots that may be outdated):

**Override API (`src/app/api/gc-hub/override/route.ts`):**
- Confirmed to exist with PUT method
- Uses `getServerSession` + `getSessionPermissions`
- Checks `permissions.role !== 'admin' && permissions.role !== 'revops_admin'` → 403
- Stores originals on first override (`!existing.isManuallyOverridden`)
- Recalculates `amountEarned`
- Returns `{ success: true, record: { id, advisorName, period, grossRevenue, commissionsPaid, amountEarned, isManuallyOverridden, overrideReason, overriddenBy, overriddenAt } }`

**Query Layer (`src/lib/queries/gc-hub.ts` — `getGcAdvisorDetail`):**
- Two potential versions seen in knowledge base (may reflect different points in time)
- Version 1 (from Implementation Guide 2): blocks CP entirely (`return null`), returns periods WITHOUT `id`
- Version 2 (from actual gc-hub.ts file): handles CP with anonymized data, returns periods WITHOUT `id`
- **CRITICAL**: Neither version includes `r.id` in the periods mapping — this is the gap

**API Client (`src/lib/api-client.ts`):**
- `GcAdvisorDetail.periods[]` has: `period, periodStart, grossRevenue, commissionsPaid, amountEarned, dataSource` — NO `id`
- Override method is named `overrideValue` (not `overridePeriodValues` as the implementation plan says in §1.4)
- Method signature: `overrideValue(data: { recordId: string; grossRevenue?: number; commissionsPaid?: number; reason: string })`

**GCHubAdvisorModal (`src/components/gc-hub/GCHubAdvisorModal.tsx`):**
- Props: `{ advisorName: string; onClose: () => void }` — no `canEdit`
- Uses `gcHubApi.getAdvisorDetail(advisorName)` in useEffect
- Period table columns: Period, Revenue, Commissions, Amount Earned, Source
- No Actions column, no edit buttons, no override state
- Rows keyed implicitly (likely by index in `.map()`)

**GCHubContent.tsx:**
- Renders modal as: `<GCHubAdvisorModal advisorName={selectedAdvisor} onClose={() => setSelectedAdvisor(null)} />`
- Only 2 props passed — no `canEdit`
- `isAdmin = permissions?.role === 'admin' || permissions?.role === 'revops_admin'`
- Modal shows for `(isAdmin || isCapitalPartner)`

### Pre-Exploration Issue Flagged

⚠️ **Method name inconsistency**: The implementation plan §1.4 says `gcHubApi.overridePeriodValues` but the actual api-client uses `gcHubApi.overrideValue`. Phase C Step 7 references `gcHubApi.overridePeriodValues`. **This MUST be corrected** to use `overrideValue` (or whatever the live codebase uses).

---

## Appendix B: Quick-Reference Diff — What Needs to Change

Based on pre-exploration knowledge (confirm during exploration):

```
FILES TO MODIFY:
├── src/lib/queries/gc-hub.ts
│   └── getGcAdvisorDetail(): Add r.id + override metadata to admin periods mapping
├── src/lib/api-client.ts
│   └── GcAdvisorDetail.periods[]: Add id, isManuallyOverridden, original*, override* fields
├── src/app/dashboard/gc-hub/GCHubContent.tsx
│   └── Pass canEdit={isAdmin} to GCHubAdvisorModal
├── src/components/gc-hub/GCHubAdvisorModal.tsx
│   └── Accept canEdit prop, add Actions column, add overridePeriod state, render GCHubOverrideModal

FILES TO CREATE:
├── src/components/gc-hub/GCHubOverrideModal.tsx (NEW)
│   └── Override form modal: revenue, commissions, reason, submit, cancel

FILES NOT CHANGED:
├── prisma/schema.prisma (override fields already exist)
├── src/app/api/gc-hub/override/route.ts (already works)
├── src/app/api/gc-hub/advisor-detail/route.ts (passthrough)
```
