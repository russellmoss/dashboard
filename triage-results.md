# Triage Results — Phase 3 Attribution Routing Council Feedback

Generated: 2026-04-21

---

## Bucket 1 — Apply Autonomously (15 items)

| # | Source | Issue | Action |
|---|---|---|---|
| C1 | Codex | Export ignores `advancedFilters.sgas` | Thread `advancedFilters` into `getExportDetailRecords`; apply helper. |
| C2 | Codex | Legacy `filters.sga` branches must be explicitly removed | Rewrite Phase 3 sub-sections to spell out removal per file. |
| C3 | Codex | Type widening for debug payload | Update Phase 5 to enumerate `FunnelMetrics` type + consumer updates. |
| C4 | Codex | `NEXT_PUBLIC_ATTRIBUTION_DEBUG` violates fixed env-var contract | Replace with server-side payload + client `!!debug && isAdmin`. |
| C5 | Codex | Uniqueness check for `vw_lead_primary_sga.lead_id` | Add pre-flight assertion SQL. |
| C7 | Gemini | Backend `availableCount` anti-pattern | Drop from helper; UI owns collapse. |
| C8 | Codex | `getConversionTrends` multi-builder threading | Itemize each builder in Phase 3. |
| C11 | Gemini | Backend role check for debug double-query | Add session role check in Phase 5. |
| C12 | Codex | `forceMode` introduced in Phase 2 not 5 | Phase ordering fix. |
| S1 | Codex | Fully qualified backticked view name | Add caller-discipline note. |
| S2 | Gemini | Optional chaining in UI length check | Update Phase 4 code snippet. |
| S3 | Codex | Pre-flight schema assertion | Add to Pre-Flight section. |
| Q4 | brief + council | Orphan silent exclusion | Council agrees with brief default; apply. |
| Q7 | Codex | Fail-closed on duplicate lead_id | Council recommends fail-closed; apply via pre-flight assertion. |
| I4 | orchestrator | Integration coverage matrix in Phase 8 | Expand Phase 8 with 4 scenarios. |

---

## Bucket 2 — Needs Human Input (5 items)

| # | Source | Question |
|---|---|---|
| Q1 | Codex + Gemini | In v2, display SGA should be legacy `SGA_Owner_Name__c` (status quo) or `COALESCE(primary_sga_name, legacy)` (matches filter math)? |
| Q2 | Codex | "All selected" collapse — compare against full option set (23) or visible-after-Active-toggle set (17)? |
| Q3 | brief + council | ATTRIBUTION_DEBUG panel gating: env-var-only (brief default), admin-role + env-var (council rec), or email allowlist? |
| Q5 | Gemini | Opp-era fallback for NULL primary_sga_name — accept scope limitation, COALESCE fallback, or gate v2 to lead-era only? |
| Q6 | Gemini | "22-SGA cliff" — UI warning when unchecking one SGA (under v1) reverts to 39% behavior, or acceptable silent UX? |

---

## Bucket 3 — Note But Don't Apply (3 items)

| # | Source | Issue | Reason for defer |
|---|---|---|---|
| I2 | Gemini | Expose `primary_sga_reason` in UI table | Scope creep; defer to follow-up. |
| I3 | Gemini | Single-query conditional aggregation for debug | Premature optimization; double-query is clearer initially. |
| I6 | Gemini | Upstream COALESCE for `lead_is_self_sourced` | Out of scope — brief forbids modifying `vw_funnel_master`. |
