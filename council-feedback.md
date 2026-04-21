# Council Feedback — Phase 3 Attribution Routing

Generated: 2026-04-21
Reviewers: Codex (GPT-5.4), Gemini (gemini-3.1-pro-preview). Separate prompts, separate responses.

---

## Critical Issues (merged + deduplicated + cross-checks)

### C1. `export-records.ts` ignores `advancedFilters.sgas` entirely
**Source:** Codex. Confirmed by direct read of file.
`getExportDetailRecords` only reads `filters.channel|source|sga|sgm` (the legacy single-select fields). The multi-select `advancedFilters.sgas` from the funnel bar is silently dropped. Today's export does NOT reflect the current dashboard's multi-SGA filter — this is a pre-existing behavior.
**Impact on Phase 3:** if a user ticks multi-SGA on the funnel and clicks Export to Sheets, exported rows won't match what they see. Under v2, the divergence worsens (dashboard uses primary_sga_name; export still uses SGA_Owner_Name__c).
**Fix:** Thread `advancedFilters` into `getExportDetailRecords` and apply `buildSgaFilterClause(advancedFilters.sgas, 'adv')` in addition to the legacy single-SGA path.

### C2. Legacy `filters.sga` branches must be explicitly rewritten, not just "routed through the helper"
**Source:** Codex.
Current code has standalone string fragments like `v.SGA_Owner_Name__c = @sga` in funnel-metrics.ts:44, detail-records.ts:43, source-performance.ts:33, conversion-rates.ts:74. Adding the helper alongside but leaving the old fragment in place → v2 either double-filters or keeps legacy ownership.
**Fix:** In each caller, REMOVE the raw fragment; rely solely on `buildSgaFilterClause({ selectAll: false, selected: [filters.sga] }, 'adv')`.

### C3. "No type changes" is false once Phase 5 adds the debug payload
**Source:** Codex.
When `funnel-metrics.ts` starts returning `{ ...FunnelMetrics, debug?: {...} }`, the typed contract at `src/lib/api-client.ts:343`, consumer at `src/app/dashboard/page.tsx:742`, and `src/lib/sheets/sheets-types.ts:103` all widen. Gate 5 breaks if the panel reads `debug` without widened types.
**Fix:** Explicitly add `debug?: AttributionDebugPayload` to `FunnelMetrics` (or wrap in a response envelope), update `api-client.ts` + `page.tsx` consumers, confirm `sheets-types.ts` stays compatible.

### C4. `NEXT_PUBLIC_ATTRIBUTION_DEBUG` violates the fixed env-var contract
**Source:** Codex (also implicit in Gemini's gating critique).
Brief explicitly fixes env var names at `ATTRIBUTION_MODEL` and `ATTRIBUTION_DEBUG` — server-side only. `ATTRIBUTION_DEBUG` cannot be read in a client component without a `NEXT_PUBLIC_` twin, which violates the contract.
**Fix:** Drop `NEXT_PUBLIC_ATTRIBUTION_DEBUG`. Server reads `ATTRIBUTION_DEBUG`, decides whether to include `debug` in response. Client gates on `!!debug && isRevOpsAdmin`. No client env var.

### C5. No uniqueness check on `vw_lead_primary_sga.lead_id` — JOIN could fan out
**Source:** Codex.
View DDL claims one-row-per-lead but no implementation-time assertion. If drift occurs, LEFT JOIN multiplies counts and corrupts numerator/denominator.
**Fix:** Add pre-flight SQL assertion:
```sql
SELECT COUNT(*) AS rows, COUNT(DISTINCT lead_id) AS unique_ids,
  COUNT(*) - COUNT(DISTINCT lead_id) AS dupes
FROM `savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga`;
-- Expected: dupes = 0.
```

### C6. Opp-only (006-prefix) rows may drop from v2 SGA-filtered opp-era metrics
**Source:** Gemini.
`LEFT JOIN ... WHERE p.primary_sga_name IN UNNEST(...)` fails `IN` for NULL → excludes rows. Lead-era metrics (Contacted→MQL) are fine (100% match in data-verifier cohort). Opp-era metrics (SQO, Joined, AUM) may lose attributions where `Opp_SGA_Name__c` is a real SGA but lead-era primary was orphan.
**Fix:** Design decision required — see Q5.

### C7. Backend `availableCount` parameter is an anti-pattern
**Source:** Gemini.
Backend has no knowledge of client's current UI state (Active/All toggle filters options). Passing `availableCount` is spoofable and breaks API boundary.
**Fix:** Drop `availableCount` from `buildSgaFilterClause`. Backend strictly filters by whatever array the client sent. UI (Phase 4) owns the collapse.

### C8. `getConversionTrends` multiple SQL builders — joinClause threading
**Source:** Codex.
`conversion-rates.ts` at lines 567, 635, 907 has three builder functions each composing its own `FROM ... WHERE filterWhereClause`. Adding joinClause only at top-level misses the CTEs.
**Fix:** Phase 3 sub-section for `conversion-rates.ts` must itemize each builder and insert `${sgaClause.joinClause}` in each.

### C9. Rule 3 UI fix + Active/All toggle interaction
**Source:** Codex.
`GlobalFilters.tsx` renders `filteredSgaOptions` (line 112) when Active-only toggle on. Comparing against `filterOptions.sgas.length` (full set) doesn't fire collapse when user ticks all visible with toggle on.
**Fix:** Design decision — see Q2. Likely compare against `filteredSgaOptions.length`.

### C10. Export/detail SELECT column mismatch under v2
**Source:** Gemini + Codex.
SELECT still reads `v.SGA_Owner_Name__c as sga` while filter uses `p.primary_sga_name`. UI/CSV displays stale or different SGA name.
**Fix:** Design decision — see Q1. Likely `COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c) as sga` in SELECT when v2.

### C11. Server-side role check missing for debug double-query
**Source:** Gemini.
If debug branch gates only on env var, every user's request runs two BQ queries. Doubles cost for non-admins.
**Fix:** In debug branch, check `session.permissions.role in {revops_admin, admin}` before running the double-query.

### C12. `forceMode` overload referenced in Phase 5 but not introduced in Phase 2
**Source:** Codex.
Phase ordering fix.
**Fix:** Declare `forceMode?: AttributionModel` as optional final parameter in Phase 2's signature.

---

## Should Fix (merged)

### S1. Fully qualified backticked view name in generated SQL
Already present in helper; flag as caller-discipline rule.

### S2. Fragile `filterOptions.sgas.length` check in UI
Phase 4's `next.length === filterOptions.sgas.length` fails if not loaded.
**Fix:** `const availableCount = key === 'sgas' ? (filterOptions?.sgas?.length ?? 0) : ...; const allSelected = availableCount > 0 && next.length >= availableCount;`

### S3. Schema assertion smoke test for the view
Pre-flight SQL that SELECTs every column the helper references and asserts non-error return. Keep inline in guide.

### S4. `is_orphan_mql` semantics undocumented in consumers
Column exists; no query reads it. Not a blocker; document for future use.

---

## Design Questions (merged, numbered — for human gate)

### Q1. Should v2 swap the display SGA to `primary_sga_name`?
Predicate is `p.primary_sga_name` but display is still `v.SGA_Owner_Name__c`. A lead can match filter (owned by Lauren during Contacting) but display "Savvy Operations" (current owner).
(a) Leave status quo — confusing.
(b) `COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c) AS sga` — matches filter math.
Council recommends (b).

### Q2. "All selected" = full set or currently visible set?
(a) Compare to `filterOptions.sgas.length` (all 23, active+inactive). Strict but user has to toggle Active-off + select 23.
(b) Compare to `filteredSgaOptions.length` (visible 17 when Active-only on). What-you-see matches.
Council recommends (b).

### Q3. How to gate ATTRIBUTION_DEBUG panel?
(a) Env-var-only (brief default) — any user sees panel when flag on.
(b) Admin-role + env-var (council recommendation) — server checks role before computing debug; panel renders only if role OK. Prevents BQ cost doubling.
(c) Email allowlist.
Council recommends (b).

### Q4. How to display orphan/`none` leads when a specific SGA is selected?
Already in brief. Default: silent exclusion. Alternative: "Unassigned" pseudo-option.
Council recommends default. Surface in follow-up if needed.

### Q5. Opp-era fallback for rows with NULL `primary_sga_name`?
Under v2, opp-only rows (006-prefix) with `Opp_SGA_Name__c` = a real SGA would drop from the SGA filter.
(a) Accept as v2 scope limitation; document.
(b) COALESCE fallback to `v.SGA_Owner_Name__c`.
(c) Gate v2 to lead-era metrics only (Contacted→MQL, MQL→SQL); opp-era stays v1.
Council leans (a) or (c). Russell's call.

### Q6. "22-SGA cliff" UX
Unchecking one SGA → UI collapse doesn't fire → `IN (22 names)` → Savvy Ops sweep excluded → 39.2% rate back under v1 (v2 is fine).
Tooltip warning in UI? Acceptable silence? Council: acceptable during rollout.

### Q7. Duplicate lead_id handling
If view ever has dupes: fail-closed (assert) or defensive QUALIFY ROW_NUMBER() dedupe?
Council recommends fail-closed.

---

## Suggested Improvements (ranked by impact vs effort)

### I1 (high impact, low effort). Payload-presence gating replaces `NEXT_PUBLIC_ATTRIBUTION_DEBUG`
Client: `!!debug && isAdmin`. Aligns with C4+C11.

### I2 (high impact, low effort). Expose `primary_sga_reason` in debug panel (admin-only, not on wide types)
Reduces support tickets during rollout. Self-contained.

### I3 (medium impact, medium effort). Single-query with conditional aggregation for debug
Reduces BQ cost. Deferred — double-query is clearer initially.

### I4 (medium impact, low effort). Integration coverage matrix in Phase 8
Four cases: unfiltered / single SGA / multi-select all / active-only-toggle + select-every-visible.

### I5 (low impact, low effort). Fully-qualify view name; caller-discipline rule.

### I6 (deferred — out of scope). Upstream COALESCE for `lead_is_self_sourced`.

---

## Cross-Checks (orchestrator, post-hoc)

1. **BigQuery field names exist in `data-verifier-findings.md`.** ✅ All verified.
2. **TypeScript interface changes have ALL construction sites covered.** ⚠ Broken per C3 — Phase 5 widens response shape. Needs explicit type update + consumer wiring.
3. **SQL uses `@paramName` — no user-data interpolation.** ✅ Helper uses param names; `${FULL_TABLE}` and `${sgaClause.*}` are helper-controlled.
4. **Sheets export handles same edge cases as existing tabs.** ❌ Export doesn't respect multi-SGA filter (C1). Must be fixed.
5. **Duration penalty math uses `computeAdjustedDeal()` — not duplicated.** ✅ N/A — feature doesn't touch deal economics.

---

## Raw Responses

### Codex (gpt-5.4)

```
## CRITICAL ISSUES (will break build or cause data loss)
- export-records.ts is not actually covered for the dashboard's real SGA filter path. The plan only routes legacy filters.sga there, but export is called with full dashboard filters. getExportDetailRecords currently ignores advancedFilters.sgas entirely and still hardcodes v.SGA_Owner_Name__c = @sga. Result: dashboard and export diverge under multi-select SGA filters.
- Phase 3 is underspecified at the actual filter sites. Adding buildSgaFilterClause is not enough; the existing filters.sga branches must also be removed or rewritten in every caller. Current legacy logic exists in funnel-metrics.ts:44, detail-records.ts:43, source-performance.ts:33, conversion-rates.ts:74. If left in place, v2 will double-filter or keep using legacy ownership.
- "No type changes" is false once Phase 5 adds debug to the funnel-metrics response. The typed client contract is api-client.ts:343, the consumer is page.tsx:742, the API route returns a merged object at route.ts:73, and export types still pin metrics: FunnelMetrics at sheets-types.ts:103. If the panel reads debug without widening these types, TS breaks.
- Phase 6 violates the fixed env-var contract. The plan introduces NEXT_PUBLIC_ATTRIBUTION_DEBUG, but the allowed env surface is explicitly only ATTRIBUTION_MODEL and ATTRIBUTION_DEBUG. With current structure, dashboard page is a client component, so you cannot read server-only ATTRIBUTION_DEBUG there without a server bridge. As written, the panel gating is not implementable.
- The plan never requires a uniqueness check on vw_lead_primary_sga.lead_id. A plain LEFT JOIN against a non-1:1 view will duplicate funnel rows and corrupt counts/AUM.

## SHOULD FIX (pattern drift, inconsistencies, potential bugs)
- getConversionTrends needs more than "apply helper." Its SQL builders only accept filterWhereClause today at conversion-rates.ts:567, 635, 907. You need to thread a joinClause through both builder functions and every CTE base FROM.
- The Rule 3 UI fix is incomplete with the current active-only toggle. GlobalFilters renders from filteredSgaOptions at 112 but the plan collapses based on filterOptions.sgas.length at 317. If inactive SGAs are hidden, "selected every visible SGA" will not collapse.
- Detail/export display fields are still legacy. Both detail-records.ts:292 and export-records.ts:70 project v.SGA_Owner_Name__c as sga. Under v2, a row can match primary_sga_name while showing a different/null displayed SGA.
- Phase 2 defines buildSgaFilterClause(..., paramPrefix='adv'), but Phase 5 depends on a forceMode overload that is never introduced earlier.
- Use fully qualified backticked view name in generated SQL.
- No implementation-time schema assertion/test to catch casing/name drift.

## DESIGN QUESTIONS
1. In v2, should detail rows/export continue to show legacy SGA_Owner_Name__c, or display primary_sga_name?
2. Select-all collapse — all SGAs in the full option set, or all currently visible SGAs after active-only toggle?
3. Given ATTRIBUTION_DEBUG is server-only, where should client gating come from: API response flag, server wrapper prop, or no client-side env gate?
4. If vw_lead_primary_sga ever has duplicate lead_ids, fail closed or defensively dedupe via QUALIFY ROW_NUMBER()?

## SUGGESTED IMPROVEMENTS
1. Shared attribution helper contract for all callers; remove every legacy filters.sga branch explicitly; treat export as first-class.
2. Hard validation query/test for vw_lead_primary_sga: exact columns, one row per lead_id, zero duplicate join fanout.
3. Integration coverage for four cases: unfiltered, single SGA, multi-select all, active-only "select every visible SGA".
4. Keep all SQL parameterized; only interpolate fixed helper-owned fragments.
```

### Gemini (gemini-3.1-pro-preview)

```
## CRITICAL ISSUES (will break build or cause data loss)

1. Opp-Only (006-prefix) Annihilation in v2 Filtered Queries
In SQL, if you LEFT JOIN and then apply a WHERE clause on the right-side table (p.primary_sga_name IN UNNEST(@adv_sgas)), the WHERE evaluates FALSE for NULL. The moment a user applies an SGA filter in v2, 100% of Opp-only (006-prefix) rows will be dropped from the funnel, destroying pipeline and won/closed metrics.
Fix: (p.primary_sga_name IN UNNEST(@adv_sgas) OR (v.Full_prospect_id__c LIKE '006%' AND v.SGA_Owner_Name__c IN UNNEST(@adv_sgas)))

2. Backend availableCount Parameter is an Anti-Pattern
To do this on the backend, every API route would either need to execute a SELECT COUNT first (massive latency) or rely on the client passing availableCount (easily spoofed). Phase 4 already implements the UI fix. Remove availableCount from the backend helper.

## SHOULD FIX

1. Export & Detail Record Column Mismatch
Phase 3 omits updating the SELECT clause. Results filtered by p.primary_sga_name but UI/CSV displays v1 v.SGA_Owner_Name__c. Users see leads belonging to SGAs they filtered out because display is out of sync with filter logic.
Fix: COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c) for display in v2 mode.

2. Missing Backend Role Authorization for Debug Queries
If backend only checks env var, every user's request triggers double BQ query. Doubles BQ compute costs.
Fix: Check session JWT/role before executing forceMode overload.

3. Fragile UI Array Length Check
next.length === filterOptions.sgas.length will throw if filterOptions.sgas hasn't resolved.
Fix: filterOptions?.sgas?.length > 0 && ...

## DESIGN QUESTIONS
1. Unattributed Leads in Specific SGA Filters? Default: silent exclusion. Add "Unassigned/Orphan" pseudo-option later.
2. ATTRIBUTION_DEBUG Authorization? Admin-role check + env-var (not env-var alone).
3. 22-SGA Cliff? Unchecking one SGA reverts to ~39%. Product team aware?

## SUGGESTED IMPROVEMENTS
1. Expose Attribution Reason in UI (reduces support tickets).
2. Optimize Phase 5 with single query + conditional aggregations.
3. Guardrail lead_is_self_sourced NULLs upstream.
```
