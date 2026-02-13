# GC Hub Manual Override — Implementation Plan

This document describes how to implement **manual override of Revenue and Commissions** in the GC Hub Advisor Detail drilldown, so that Admin and RevOps Admin users can edit period-level values with full audit trail and revert capability. It is written for robust, non-breaking development and for agentic execution.

---

## 1. Current State

### 1.1 Neon / Prisma Schema (`GcAdvisorPeriodData`)

**Location:** `prisma/schema.prisma` (model `GcAdvisorPeriodData`).

Relevant fields:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | String (cuid) | Primary key — **required for override API** |
| `grossRevenue` | Float? | Displayed revenue; becomes override value when edited |
| `commissionsPaid` | Float? | Displayed commissions; becomes override value when edited |
| `amountEarned` | Float? | Derived: grossRevenue - commissionsPaid (recalculated on override) |
| `isManuallyOverridden` | Boolean @default(false) | True after any manual override |
| `originalGrossRevenue` | Float? | Snapshot **before first override**; used for revert/audit |
| `originalCommissionsPaid` | Float? | Snapshot **before first override**; used for revert/audit |
| `overrideReason` | String? | **Required** on override; user-provided reason |
| `overriddenBy` | String? | User email who performed the override |
| `overriddenAt` | DateTime? | Timestamp of override |

Behavior already implemented in the override API:

- On **first** override: originals are stored; `isManuallyOverridden` set to `true`.
- On **subsequent** overrides of the same record: originals are **not** overwritten (preserves first snapshot for audit).
- `amountEarned` is recalculated as `grossRevenue - commissionsPaid` after each update.

No schema changes are required for the override feature; the model already supports it.

---

### 1.2 Override API (Existing)

**Location:** `src/app/api/gc-hub/override/route.ts`.

- **Method:** `PUT`
- **Auth:** Session required (`401` if missing). **Role check:** only `admin` and `revops_admin` may call; others get `403`.
- **Request body:** `{ recordId: string, grossRevenue?: number, commissionsPaid?: number, reason: string }`
  - `recordId`: `GcAdvisorPeriodData.id` (cuid).
  - At least one of `grossRevenue` or `commissionsPaid` must be provided.
  - `reason` is required (non-empty string).
- **Behavior:** Fetches existing record by `id`; on first override stores `originalGrossRevenue` and `originalCommissionsPaid`; sets `isManuallyOverridden`, `overrideReason`, `overriddenBy` (session user email), `overriddenAt` (now); updates `grossRevenue`/`commissionsPaid`/`amountEarned`; returns updated record snippet.

**Gap:** The Advisor Detail API does **not** return `id` (or override metadata) for each period, so the frontend cannot currently call the override API for a specific period. The implementation must add period `id` (and optionally override metadata) to the advisor-detail response for non–capital-partner users.

---

### 1.3 GC Hub Advisor Detail Flow (Current)

- **Page:** `src/app/dashboard/gc-hub/page.tsx` — server-side checks session and `allowedPages.includes(16)`; recruiters are redirected (they do not have page 16).
- **Content:** `src/app/dashboard/gc-hub/GCHubContent.tsx`
  - Uses `useSession` and fetches `/api/auth/permissions` to get `UserPermissions`.
  - `isAdmin = permissions?.role === 'admin' || permissions?.role === 'revops_admin'`.
  - `isCapitalPartner = permissions?.role === 'capital_partner'`.
  - Advisor Detail tab shows `GCHubAdvisorTable`; `onAdvisorClick` sets `selectedAdvisor` and opens the drilldown modal.
- **Drilldown modal:** `src/components/gc-hub/GCHubAdvisorModal.tsx`
  - Props: `advisorName`, `onClose`.
  - Fetches advisor detail via `gcHubApi.getAdvisorDetail(advisorName)` (POST `/api/gc-hub/advisor-detail`).
  - Renders: header (advisor name, account, Orion ID, billing), KPI cards (total revenue/commissions/earned), Financial History chart, **Period Detail table** (columns: Period, Revenue, Commissions, Amount Earned, Source).
  - Period table rows are keyed by `p.period`; **no `id`**, no edit action, no override metadata.

**Gaps:**

1. Advisor detail response does not include `id` (or override fields) per period for admin/revops.
2. Modal does not receive `canEdit` (or role); only admin/revops should see edit/override UI.
3. No second (override) modal or field-by-field edit UI.

---

### 1.4 API Client Types

**Location:** `src/lib/api-client.ts`.

- `GcAdvisorDetail.periods[]` currently: `{ period, periodStart, grossRevenue, commissionsPaid, amountEarned, dataSource }`. No `id`, no `isManuallyOverridden`, no `originalGrossRevenue`/`originalCommissionsPaid`, no `overrideReason`/`overriddenBy`/`overriddenAt`.
- **API client override method:** `gcHubApi.overrideValue` (not `overridePeriodValues`). Signature: `overrideValue(data: { recordId: string; grossRevenue?: number; commissionsPaid?: number; reason: string })` → returns `Promise<{ success: boolean; record: any }>`.

**Location:** `src/types/gc-hub.ts`.

- `GcOverridePayload` already matches the override API: `recordId`, `grossRevenue?`, `commissionsPaid?`, `reason`.

---

### 1.5 Security Summary

- **Page:** Only users with `allowedPages.includes(16)` can reach GC Hub; recruiters do not have 16 → redirect.
- **Override API:** Explicitly restricts to `role === 'admin' || role === 'revops_admin'`; capital partners and others get `403`.
- **Recruiter rule:** No change needed; recruiters never see GC Hub or the override UI, and override API denies them by role.

---

## 2. Target Behavior (Override Feature)

- **Who:** Only **Admin** and **RevOps Admin** can see and use the override flow. Capital partners and other roles must not see edit/override UI or call the override API successfully.
- **Where:** GC Hub → Advisor Detail tab → click an advisor → **drilldown modal** (GCHubAdvisorModal). From the Period Detail table, admin/revops see an **Edit** (or similar) control per row that opens a **second modal** (override modal) on top.
- **Override modal:**
  - **One period per modal instance:** user selects one period row and edits that period’s Revenue and/or Commissions (field-by-field).
  - **Required:** Override reason (text); at least one of Revenue or Commissions must be changed (or explicitly re-submitted with new reason if re-overriding).
  - **Actions:** Submit (call override API with `recordId`, optional `grossRevenue`, optional `commissionsPaid`, required `reason`), Cancel (close override modal only).
  - **After success:** Override modal closes; drilldown modal refreshes advisor detail (or updates local state from API response) so the table and chart show new values and, if desired, an “Overridden” indicator (e.g. badge/tooltip with reason, by, at).
- **Backend (already done):** Override API updates Neon, sets `isManuallyOverridden`, stores `originalGrossRevenue`/`originalCommissionsPaid` on first override, sets `overrideReason`, `overriddenBy`, `overriddenAt`, recalculates `amountEarned`. No schema change.

---

## 3. Implementation Plan (Step-by-Step)

### Phase A — Data Layer: Expose Period `id` and Optional Override Metadata

1. **Advisor detail query (admin/revops only — not capital partner)**  
   **File:** `src/lib/queries/gc-hub.ts`  
   - In `getGcAdvisorDetail`, for the **non–capital-partner** branch, extend the `periods` mapping to include:
     - `id: r.id` (required for override).
     - Optionally: `isManuallyOverridden`, `originalGrossRevenue`, `originalCommissionsPaid`, `overrideReason`, `overriddenBy`, `overriddenAt` so the UI can show “Overridden” and audit info (e.g. tooltip).  
   - **Do not** add `id` or override metadata for the capital-partner branch (anonymized view; no edit).

2. **API response type**  
   **File:** `src/lib/api-client.ts`  
   - Extend `GcAdvisorDetail.periods[].` to include:
     - `id: string` (required for override).
     - Optionally: `isManuallyOverridden?: boolean`, `originalGrossRevenue?: number | null`, `originalCommissionsPaid?: number | null`, `overrideReason?: string | null`, `overriddenBy?: string | null`, `overriddenAt?: string | null` (ISO date string).  
   - Keep backward compatibility: if the API sometimes omits these (e.g. for capital partner), types can be optional.

3. **Advisor-detail API route**  
   **File:** `src/app/api/gc-hub/advisor-detail/route.ts`  
   - No change to auth or allowlist; the query change in step 1 is permission-aware (only non–capital-partner response includes `id` and override fields).  
   - Ensure the route continues to return the shape that includes the new period fields when the query returns them.

---

### Phase B — UI: Drilldown Modal Can Edit (Admin/RevOps Only)

4. **Pass `canEdit` into drilldown modal**  
   **File:** `src/app/dashboard/gc-hub/GCHubContent.tsx`  
   - Already has `isAdmin` (admin or revops_admin).  
   - Pass `canEdit={isAdmin}` to `GCHubAdvisorModal`.  
   - Example: `<GCHubAdvisorModal advisorName={selectedAdvisor} onClose={...} canEdit={isAdmin} />`.

5. **GCHubAdvisorModal: show Edit only when `canEdit`**  
   **File:** `src/components/gc-hub/GCHubAdvisorModal.tsx`  
   - Add prop `canEdit?: boolean` (default `false`).  
   - In the Period Detail table, add a column (e.g. “Actions”) only when `canEdit` is true, with an “Edit” button (or icon) per row.  
   - Use `p.id` for the edit action (after Phase A, periods will have `id`).  
   - Clicking Edit opens the override modal (Phase C) with that period’s `id`, `period` (label), `grossRevenue`, `commissionsPaid`.  
   - Ensure row keys use a stable identifier: prefer `p.id` if present, else fallback to `p.period` for backward compatibility.

6. **Optional: show “Overridden” in table**  
   - If override metadata is returned (step 1), show a small badge or icon in the row when `p.isManuallyOverridden` is true, with tooltip: e.g. “Overridden by {overriddenBy} at {overriddenAt} — {overrideReason}”.  
   - This is optional but improves audit visibility.

---

### Phase C — Override Modal (Second Modal)

7. **New component: GCHubOverrideModal**  
   **File:** `src/components/gc-hub/GCHubOverrideModal.tsx` (new)  
   - **Props:**  
     - `periodId: string` (GcAdvisorPeriodData.id),  
     - `periodLabel: string` (e.g. “Jan 2026”),  
     - `currentRevenue: number | null`,  
     - `currentCommissions: number | null`,  
     - `onClose: () => void`,  
     - `onSuccess: () => void` (e.g. refetch advisor detail and/or close override modal).  
   - **State:**  
     - Form: revenue input, commissions input, reason text area.  
     - Loading (submit in progress), error message (API error or validation).  
   - **Validation:**  
     - At least one of revenue or commissions must be present (or allow both; API already requires at least one).  
     - Reason required, non-empty, trimmed.  
     - Numeric fields: allow empty or valid numbers; send only defined values to API.  
   - **Submit:**  
     - Call **`gcHubApi.overrideValue`** (the actual method name in `api-client.ts`) with `{ recordId: periodId, grossRevenue?, commissionsPaid?, reason }`.  
     - On success: call `onSuccess()`, then `onClose()`.  
     - On 4xx/5xx: set error state, do not close.  
   - **Accessibility:** Focus trap, aria labels, optionally Enter to submit. **Do not** add a `window.addEventListener('keydown')` for Escape in this component — the parent (drilldown modal) owns Escape handling so only one modal closes at a time (see Step 8).  
   - **Layout:** Modal overlay (e.g. higher z-index than drilldown modal), title like “Override period values”, form fields, Cancel and Submit buttons.

8. **Wire override modal in GCHubAdvisorModal**  
   **File:** `src/components/gc-hub/GCHubAdvisorModal.tsx`  
   - State: `overridePeriod: { id, period, grossRevenue, commissionsPaid } | null`.  
   - When user clicks Edit on a row: set `overridePeriod` to that period’s data.  
   - **Stacked-modal Escape key:** The drilldown modal already has a `window.addEventListener('keydown')` for Escape that calls `onClose()`. If the override modal also added its own Escape listener, pressing Escape would fire both — closing override and drilldown at once. **Fix:** Update the drilldown modal's existing Escape handler to be override-aware: if `overridePeriod` is set, close the override modal first (`setOverridePeriod(null)`); only call `onClose()` when the override modal is not open. Example:
     ```ts
     const handleKey = (e: KeyboardEvent) => {
       if (e.key === 'Escape') {
         if (overridePeriod) {
           setOverridePeriod(null); // Close override modal first
         } else {
           onClose(); // Close drilldown only when override isn't open
         }
       }
     };
     ```
     Ensure the `useEffect` that registers this handler includes `overridePeriod` in its dependency array. The override modal itself must **not** add its own Escape listener — single-owner pattern.  
   - When `overridePeriod` is non-null, render `GCHubOverrideModal` with:  
     - `periodId={overridePeriod.id}`,  
     - `periodLabel={overridePeriod.period}`,  
     - `currentRevenue={overridePeriod.grossRevenue}`,  
     - `currentCommissions={overridePeriod.commissionsPaid}`,  
     - `onClose={() => setOverridePeriod(null)}`,  
     - `onSuccess={() => { setOverridePeriod(null); refetch advisor detail and update `detail` state }}`.  
   - Refetch: after override success, call `gcHubApi.getAdvisorDetail(advisorName)` again and `setDetail(data.advisor)` so the table and chart update without leaving the drilldown modal.

---

### Phase D — Edge Cases and Non-Breaking Guarantees

9. **Backward compatibility**  
   - If advisor-detail is ever called by a client that doesn’t expect `id`, optional chaining and optional types keep old clients working.  
   - Capital partner response must remain unchanged (no `id`, no override metadata).

10. **Error handling**  
    - Override API already returns 400/403/404/500 with messages. Surface them in `GCHubOverrideModal` (e.g. under the form).  
    - If refetch after override fails, consider leaving the modal closed but showing a toast or inline message in the drilldown modal that “Data may be stale; please refresh.”

11. **Recurring override (same period)**  
    - API already allows multiple overrides on the same record; originals are preserved from the first override.  
    - Override modal can be opened again for the same period; current values shown are the latest (including previous override). No extra backend change.

12. **Regression checks**  
    - As **admin** or **revops_admin:** open Advisor Detail → click advisor → see Edit on each period row → open override modal → submit reason + values → confirm record in Neon (isManuallyOverridden, original*, overriddenBy, overriddenAt) and that table/chart update.  
    - As **capital partner:** confirm no Edit column, no override UI, and advisor detail response has no `id` in periods.  
    - As **recruiter:** confirm they cannot access GC Hub (redirect).  
    - As **viewer** (or other role without GC Hub): confirm no access to GC Hub or override.

---

## 4. File Checklist

| Step | File | Action |
|------|------|--------|
| A1 | `src/lib/queries/gc-hub.ts` | Add `id` (and optionally override metadata) to periods in non–capital-partner branch of `getGcAdvisorDetail`. |
| A2 | `src/lib/api-client.ts` | Extend `GcAdvisorDetail.periods[]` with `id` and optional override fields. |
| A3 | `src/app/api/gc-hub/advisor-detail/route.ts` | No change (response follows query). |
| B4 | `src/app/dashboard/gc-hub/GCHubContent.tsx` | Pass `canEdit={isAdmin}` to `GCHubAdvisorModal`. |
| B5 | `src/components/gc-hub/GCHubAdvisorModal.tsx` | Add `canEdit` prop; add Edit column/button using `p.id`; optional Overridden badge/tooltip. |
| B6 | (same) | Optional: Overridden indicator from override metadata. |
| C7 | `src/components/gc-hub/GCHubOverrideModal.tsx` | **New:** Override modal component (form, validation, submit via **`gcHubApi.overrideValue`**, errors). |
| C8 | `src/components/gc-hub/GCHubAdvisorModal.tsx` | State for `overridePeriod`; render `GCHubOverrideModal`; refetch on success. |

---

## 5. API Contract Summary

- **GET/POST advisor detail**  
  - Response for non–capital-partner: `periods[]` includes `id` and optionally `isManuallyOverridden`, `originalGrossRevenue`, `originalCommissionsPaid`, `overrideReason`, `overriddenBy`, `overriddenAt`.  
  - Capital partner: unchanged (no `id`, no override fields).

- **PUT /api/gc-hub/override** (unchanged)  
  - Body: `{ recordId, grossRevenue?, commissionsPaid?, reason }`.  
  - Auth: session + role `admin` or `revops_admin`.  
  - Side effects: Neon update; `isManuallyOverridden` true; originals stored on first override; `overriddenBy`/`overriddenAt`/`overrideReason` set; `amountEarned` recalculated.

---

## 6. Security (Recap)

- **Override capability:** Only **Admin** and **RevOps Admin** (enforced in `/api/gc-hub/override` and via `canEdit` derived from `isAdmin` on the page).  
- **Recruiters:** Do not have GC Hub (page 16); no override UI or API access.  
- **Capital partners:** Can open advisor drilldown but see no edit/override UI and get no period `id` in the response.  
- No additional allowlist or middleware change required if the above is implemented as described.

---

## 7. Revert (Future Enhancement)

The schema and override API already support **audit** (original values, overriddenBy, overriddenAt, overrideReason). A **revert** flow is not required for this implementation but can be added later:

- **Revert** = set `grossRevenue` and `commissionsPaid` back to `originalGrossRevenue` and `originalCommissionsPaid`, set `isManuallyOverridden` to `false`, and optionally clear `overrideReason`/`overriddenBy`/`overriddenAt` (or leave them for history).  
- This could be a separate API (e.g. `POST /api/gc-hub/override/revert` with `recordId`) and a “Revert” action in the override modal or period row, restricted to admin/revops_admin.  
- The current plan does not include revert; it only ensures originals are stored so revert/audit is possible.

---

## 8. Exploration Findings (Post–Codebase Exploration)

The following was validated against the live codebase using `GC_Hub_Manual_Override_Codebase_Exploration.md`:

| Area | Assumption | Result |
|------|------------|--------|
| **Prisma schema** | All 6 override fields exist on `GcAdvisorPeriodData` | ✅ Confirmed — no Phase 0 schema migration needed. |
| **Override API** | PUT route exists; role check `admin`/`revops_admin`; first-override guard; `amountEarned` recalc; return shape | ✅ Confirmed — no changes to §1.2 or §5. |
| **getGcAdvisorDetail** | Periods omit `id`; CP branch returns anonymized data without `id`; admin branch returns periods without `id` | ✅ Confirmed — Phase A Step 1 is required. |
| **Advisor-detail API route** | Passthrough only; no field stripping | ✅ Confirmed — no Step A3 change. |
| **GcAdvisorDetail type** | `periods[]` has no `id` | ✅ Confirmed — Phase A Step 2 is required. |
| **API client override method** | Plan said `overridePeriodValues` | ❌ **Corrected** — actual method is **`overrideValue`**. §1.4 and Phase C Step 7 updated to use `gcHubApi.overrideValue`. |
| **GCHubAdvisorModal** | Props: `advisorName`, `onClose` only; no Actions column; rows keyed by `p.period` | ✅ Confirmed — Phase B/C as written. |
| **GCHubContent** | Passes only 2 props to modal; `isAdmin = permissions?.role === 'admin' \|\| permissions?.role === 'revops_admin'` | ✅ Confirmed — Phase B Step 4 as written. |
| **GCHubOverrideModal** | Does not exist | ✅ Confirmed — create new file per Phase C Step 7. |
| **Role strings** | `'admin'`, `'revops_admin'` | ✅ Confirmed — no shared `isAdmin` utility in api-authz; inline check in override route. |
| **TypeScript** | Clean compile | ✅ `npx tsc --noEmit` passes. |

**Summary:** One correction was applied (API client method name: use **`gcHubApi.overrideValue`** everywhere). All other assumptions in the implementation plan match the codebase. The plan is executable as-is with that correction.

---

This plan is self-contained and can be executed step-by-step (or agentically) for a robust, non-breaking implementation of manual overrides with full audit and revert support in Neon.
