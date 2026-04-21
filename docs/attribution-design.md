# Ownership-Period Attribution — Design Doc

**Status:** Draft for Russell review. No implementation.
**Scope:** SGA-owned transitions (Contacted→MQL, MQL→SQL) only. SGM transitions deferred.
**Author:** Claude, 2026-04-21.

---

## 0. Problem recap

`vw_funnel_master.SGA_Owner_Name__c` reflects *current* lead ownership. Roughly 90 days after a lead enters Contacting without converting, a scheduled Salesforce job reassigns it to the system user **Savvy Operations** (`005VS000005ahzdYAA`, `IsSGA__c=FALSE`). Because the SGA multi-select dropdown is populated from `IsSGA__c=TRUE AND IsActive=TRUE`, Savvy Operations is not a selectable option. Any metric filtered by `SGA_Owner_Name__c IN (real SGAs)` silently drops those reassigned leads, inflating per-SGA conversion rates (observed: Q3 2025 self-sourced Contacted→MQL reads 6.5% unfiltered, 39.2% with all real SGAs selected).

The fix is to attribute funnel outcomes to whichever SGA owned the lead *during* the period in which the stage event occurred, not to the current owner.

---

## 1. Data source inventory

### 1.1 Is `SGA_Owner_Name__c` itself history-tracked?

**No.** `LeadHistory.Field` values that exist: `Owner`, `Status`, `Disposition__c`, `Next_Steps__c`, `MobilePhone`, `Email`, plus ~20 others. `SGA_Owner_Name__c` and `SGA_Owner__c` are **not** present as tracked fields.

However, a separate check confirms:

> For 71,083 leads created since 2025-01-01, `Lead.SGA_Owner_Name__c` equals `User.Name` looked up from `Lead.OwnerId` for **100%** of rows (0 mismatches, 0 nulls).

So `SGA_Owner_Name__c` is effectively the resolved name of `OwnerId`. Owner changes in `LeadHistory.Field='Owner'` are equivalent to SGA ownership changes for lead-era periods. We do **not** need a separate field to reconstruct history.

### 1.2 Lead-era source: `SavvyGTMData.LeadHistory`

- Rows: 1,310,450
- Earliest `CreatedDate`: **2024-10-15**
- Latest: 2026-04-19
- Retention window: ~18 months
- `Field='Owner'` records: 234,822
- Two rows per owner change — one with User Id in `OldValue`/`NewValue`, one with the resolved Name. Filter by Id form (regex `^005`) to dedup; join to `User` for the name.

### 1.3 Opp-era source: `SavvyGTMData.OpportunityFieldHistory`

**Important correction to the brief:** there is no `OpportunityHistory` table in this dataset (404). Opp-side field changes live in `OpportunityFieldHistory`.

- Rows: 29,244
- Earliest `CreatedDate`: **2024-09-23**
- Latest: 2026-04-18
- Relevant field coverage:
  - `Field='Owner'`: 1,616 changes on 709 opps
  - `Field='SGA__c'`: 2,474 changes on 1,184 opps — this is the Opp-level SGA attribution field, independently mutable from Owner
  - `Field='StageName'`: 3,252 changes on 1,674 opps (for eligibility windows)

The existence of **two signals** on the Opp side (Owner *and* SGA__c) matches the existing `vw_funnel_master` behavior where Opp SGA attribution OR-matches `SGA_Owner_Name__c` and `Opp_SGA_Name__c`. For MQL→SQL attribution, the lead-era period is authoritative (SQL happens at conversion, still owned by a user, not yet independently SGA-tagged). For later transitions outside this phase's scope, both signals need to be reconciled.

### 1.4 Retention gaps

| Period entering Contacting | LeadHistory covers | OppFieldHistory covers |
|---|---|---|
| Before 2024-09-23 | **No** (gap) | No |
| 2024-09-23 → 2024-10-15 | No | Yes |
| 2024-10-15 → present | Yes | Yes |

Anything with `stage_entered_contacting__c < 2024-10-15` cannot be reconstructed — we only see the *current* owner. Q1 2025 forward is fully covered, which includes every data point in the bug report. Q4 2024 partial. Q3 2024 and earlier: no history.

### 1.5 Savvy Operations and other non-SGA owners

Confirmed system/non-SGA user IDs that appear as Owner change targets:

| Name | User Id | IsSGA__c | IsActive | Historical leads owned |
|---|---|---|---|---|
| Savvy Operations | `005VS000005ahzdYAA` | FALSE | TRUE | **76,864** |
| Savvy Marketing | (lookup at build time) | **TRUE** | TRUE | 468 |
| Jed Entin | (lookup at build time) | FALSE | TRUE | 218 |
| Tim Mackey | (lookup at build time) | FALSE | TRUE | 150 |

Notes:
- Savvy Operations dominates — this is the sweep destination.
- **Savvy Marketing is flagged `IsSGA__c=TRUE`** but behaves like a system account. See Section 9 Q1.
- Jed Entin and Tim Mackey are `IsSGA__c=FALSE` but touch leads — likely admin/SGM handoffs. Treat as non-SGA periods for this phase.

### 1.6 Queues

`Lead.OwnerId` prefix distribution: 118,178 / 118,178 rows have prefix `005` (User). **No `00G` (Queue) owners observed.** No queue handling needed in this phase. (If queue ownership is introduced later, the model extends naturally — a queue period is just a non-real-SGA period.)

---

## 2. Ownership-period definition

### 2.1 Row shape

One row per (lead, contiguous owner span) on the lead side. When the lead converts to an Opportunity, the lead-era period closes and an opp-era period opens (see §2.3).

| Column | Source / Logic |
|---|---|
| `lead_id` | `LeadHistory.LeadId` |
| `opp_id` | NULL for lead-era rows; `Lead.ConvertedOpportunityId` for the opp-era row |
| `period_start` | `CreatedDate` of the Owner change that opened this period; for the first period, `Lead.CreatedDate` |
| `period_end` | `CreatedDate` of the *next* Owner change − ε; for the currently active period, `CURRENT_TIMESTAMP()` |
| `owner_user_id` | Id-form `NewValue` from the Owner change (regex `^005`) or `Lead.CreatedById` logic for the first period |
| `owner_name` | `User.Name` join on `owner_user_id` |
| `is_real_sga` | `User.IsSGA__c = TRUE AND User.IsActive = TRUE AND owner_user_id != Savvy Operations Id AND owner_name != 'Savvy Marketing'` — see §9 Q1 |
| `period_reason_end` | `reassigned_sga` / `reassigned_ops` / `reassigned_queue` (future) / `converted` / `closed_lost` / `still_open` |

### 2.2 Seeding the first period

`LeadHistory` does not contain the Lead's initial ownership — only changes. For the first period of each lead:
- `period_start` = `Lead.CreatedDate`
- `owner_user_id` = Owner at lead creation. **Problem:** if the lead has had an Owner change, the earliest `LeadHistory.Owner` row's `OldValue` is the creation owner. If the lead has never had an Owner change, its current `Lead.OwnerId` is the creation owner.

Concrete rule: left-join `Lead` to its earliest `LeadHistory.Field='Owner'` row. If present, seed the first period with `OldValue` (original owner). If absent, seed with `Lead.OwnerId`. This is robust as long as all Owner changes post-2024-10-15 are in LeadHistory (true for our retention window).

### 2.3 Lead→Opp seam

**Recommendation: close the lead-era period at `Lead.ConvertedDate` and open a new opp-era period.**

Rationale:
- Opp-era ownership can diverge (`Opp.OwnerId` may be assigned to a different user than the lead), and Opp has an independent `SGA__c` attribution that can further diverge.
- Keeping the seam explicit lets downstream metrics decide which side to attribute. Contacted→MQL and MQL→SQL fire during lead era, so this phase only ever reads lead-era rows. SQO→Joined (future phases) reads opp-era rows. Clean separation.
- If we didn't close the lead-era period at conversion, an opp reassignment after conversion would contaminate the SGA's Contacted→MQL attribution, which is wrong — that SGA's at-bat concluded at conversion.

For leads that never converted, `period_end` of the final period is `lead_closed_date` (if closed) or `CURRENT_TIMESTAMP()` (if still open).

### 2.4 Microsecond tiebreaker

If an Owner change and a stage event share the same `CreatedDate`:
- Stage events win the boundary. The owner at `stage_entered_contacting__c` is the owner **after** any Owner change that shares that exact timestamp. I.e., Owner-change `CreatedDate <= stage_event_ts` puts the new owner in charge for the event.
- Rationale: when Salesforce automation reassigns an owner *and* moves a stage in one transaction, the intent is "new owner, new stage" — attribute to the new owner.
- Implementation: `period_start <= event_ts AND event_ts < period_end` with strict `<` on the upper bound.

### 2.5 What counts as an Owner change

Only `LeadHistory.Field='Owner'` rows where `NewValue` is a User Id (regex `^005`). Skip the paired Name rows (they're redundant display-only duplicates of the same change).

---

## 3. At-bat eligibility (Contacted→MQL)

### 3.1 Predicate

A period is an **eligible at-bat for Contacted→MQL** if the lead was in the Contacting stage during [`period_start`, `period_end`]. In SQL terms:

```sql
-- Period `p`, vw_funnel_master row `v` for lead_id = p.lead_id
stage_entered_contacting__c IS NOT NULL
AND TIMESTAMP(stage_entered_contacting__c) < p.period_end
AND (v.mql_stage_entered_ts IS NULL
     OR TIMESTAMP(v.mql_stage_entered_ts) > p.period_start)
AND (v.lead_closed_date IS NULL
     OR TIMESTAMP(v.lead_closed_date) > p.period_start)
```

Plain English: the lead had entered Contacting by the time this period ended, and had neither MQL'd nor closed before this period began. Any period that straddles `stage_entered_contacting__c` up through either MQL, closure, or end of the period.

### 3.2 Minimum-age rule

Mirror the existing `eligible_for_contacted_conversions_30d` logic: a **still-open** period is only counted in the denominator if `period_start + 30 days <= CURRENT_DATE()` (i.e., the SGA has had at least 30 days of at-bat time). Closed periods (period_reason_end ≠ `still_open`) are always counted regardless of length.

Justification: identical to the existing view's logic; preserves comparability of the new rate to the current rate.

### 3.3 What about the Opp seam?

Contacted→MQL fires pre-conversion (MQL = Call Scheduled, still a Lead). Every at-bat for this metric is a lead-era period. Opp-era periods are not eligible for this metric.

---

## 4. Hit / miss definition

### 4.1 Hit

```sql
v.mql_stage_entered_ts IS NOT NULL
AND TIMESTAMP(v.mql_stage_entered_ts) >= p.period_start
AND TIMESTAMP(v.mql_stage_entered_ts) <  p.period_end
```

MQL moment falls inside the period.

### 4.2 Miss

Eligible period AND no hit during the window. The period concluded (`period_reason_end IN ('reassigned_sga','reassigned_ops','closed_lost')`) without the lead reaching MQL during the SGA's tenure. Still-open periods past the 30-day min-age also count as misses if no MQL has yet landed in-window.

### 4.3 "MQL'd before period started and stayed through it" — not an at-bat

Correct. If `mql_stage_entered_ts < period_start`, the lead entered this period already an MQL. The current SGA cannot contribute a Contacted→MQL conversion — that conversion already happened, attributed to the prior owner. Exclude entirely from both numerator and denominator. This falls out of the §3.1 predicate: `mql_stage_entered_ts > period_start` is required for eligibility.

### 4.4 Recycle / `stage_entered_new__c` resets (v1 limitation)

When a lead is manually pushed back to `New` and re-contacted (often via re-engagement), `stage_entered_contacting__c` in `vw_funnel_master` reflects *the most recent* entry, not the original. `mql_stage_entered_ts` likewise reflects the latest MQL. Implication:

- A single vw_funnel_master row represents the current recycle lap only.
- If Jimmy contacted Johnny in Jan 2025, failed to MQL, and Jane contacted him again in Apr 2026 and MQL'd, the row shows `stage_entered_contacting__c = 2026-04-xx` and `mql_stage_entered_ts = 2026-04-xx`. Jimmy's earlier at-bat is invisible in the view.
- **v1 recommendation:** scope attribution to the currently-represented lap. Accept that prior recycles are lost. Document this limitation.
- **v2 (out of scope here):** derive stage entries per recycle from `LeadHistory.Field='Status'` and `Field='stage_entered_new__c'` (if tracked) to reconstruct per-lap windows.

This matches how the dashboard already treats recycles today — not worse.

### 4.5 Which MQL counts for which period

Given v1 limitations, the view exposes only the latest `mql_stage_entered_ts`. That MQL is attributed to whichever period contains it by the §2.4 boundary rule. At most one period per lead can be a hit in v1. Prior hits (recycles) are not attributable under v1.

---

## 5. Queue and Ops handling

### 5.1 Keep or suppress?

Two sides:

**Suppress entirely:**
- Cleaner: the attribution table is only about real SGAs.
- Downside: the overall rate computed from the attribution table would no longer match the unfiltered view, because Savvy Ops periods that concluded with MQL events (rare but nonzero — 11 of 2,130 in the Q3 self-sourced sample) would disappear.

**Keep with `is_real_sga=FALSE`:**
- All stage events land somewhere, so `SUM(hits) / SUM(at_bats)` over the full table reconciles exactly to the unfiltered metric.
- SGA-filtered metrics add `WHERE is_real_sga = TRUE`.
- Marginal storage cost — Savvy Ops periods are common but short-lived.

**Recommendation: keep with `is_real_sga=FALSE`.**

This preserves the "sum over all periods = unfiltered total" identity (§8) and makes the "no filter" vs "all real SGAs" comparison meaningful and debuggable. SGA-filtered views simply add the flag filter.

### 5.2 Non-negotiable

Whatever the decision, periods where the owner is Savvy Operations, Savvy Marketing, a queue, or any other non-real-SGA account **must not appear in any SGA-filtered metric**. The `is_real_sga` flag is the single predicate the dashboard filter helpers should use to enforce this.

---

## 6. Proposed output artifact

### Recommendation: (a) new view `vw_ownership_periods` at period grain.

One row per (lead, owner span). Small: upper-bounded by `COUNT(*) FROM LeadHistory WHERE Field='Owner'` + `COUNT(*) FROM Lead` ≈ 250k–350k rows for the full dataset. Joined to `vw_funnel_master` at query time.

### Why not (b) denormalized `vw_funnel_master_attributed`

- Explodes row count of a view that's already the widest thing in the warehouse and consumed by 20+ query files.
- Every existing query would need to change semantics (distinct vs. repeat). Blast radius unacceptable for a phase-1 change.
- AUM aggregation logic (`is_primary_opp_record`) would have to grow a second layer of dedup against at-bat rows. Fragile.

### Why not (c) materialized fact table

- Correct for long-term operational stability, but overkill for phase 1.
- Can be added later as an optimization if query cost on the view form proves unacceptable. The view is the contract; materialization is an implementation detail.
- Recommend: ship as a view first, measure scan cost on the dashboard's hot queries, materialize only if needed. Acceptable cost ceiling: single-digit GB scanned per dashboard page load.

### Query cost

`vw_ownership_periods` is a recursive-ish construction over `LeadHistory` — expect one full scan of LeadHistory per refresh. Clustering `LeadHistory` on `LeadId` (already set) means joins back to `vw_funnel_master` on `Full_prospect_id__c` stay efficient. Downstream metrics become:

```sql
FROM vw_funnel_master v
JOIN vw_ownership_periods p ON p.lead_id = v.Full_prospect_id__c
WHERE p.is_real_sga = TRUE
  AND <at-bat eligibility from §3.1>
  AND <time window on period_start for quarterly cohorting>
```

Cost should be modest because LeadHistory is clustered on `LeadId` and `vw_funnel_master` is the primary fact.

### Dashboard filter helper changes

`src/lib/utils/filter-helpers.ts:106-109` — the `IN UNNEST` clause must move from `SGA_Owner_Name__c` on `vw_funnel_master` to `owner_name` on `vw_ownership_periods`:

```sql
-- Before (broken):
v.SGA_Owner_Name__c IN UNNEST(@adv_sgas)
-- After:
p.owner_name IN UNNEST(@adv_sgas) AND p.is_real_sga = TRUE
```

Every metric that currently applies `filters.sga` via CASE (see `src/lib/queries/funnel-metrics.ts:44-51`) needs to read period-grain instead of row-grain. That is a phase-2 implementation task — **no code changes in phase 1**.

Metrics untouched by SGA filtering (overall funnel totals, AUM aggregates) continue to read `vw_funnel_master` directly. The new view is **additive** — nothing in the existing stack breaks.

---

## 7. Backfill and history gaps

### 7.1 Fallback for pre-2024-10-15 periods

No Owner changes available. For leads with `CreatedDate < 2024-10-15` and no `LeadHistory.Owner` rows, we have one period spanning lead creation → first post-2024-10-15 Owner change (or current). The owner for that period is the `OldValue` of the earliest post-2024-10-15 change (if any) or `Lead.OwnerId` (if no changes exist). This is **structurally correct for leads untouched by automation**, but for leads that cycled through multiple SGAs pre-2024-10-15, we'll see one long period under the most-recent pre-gap owner. Those earlier at-bats are lost.

### 7.2 UI flag vs. hide

**Recommendation: flag, don't hide.** Metrics for cohorts with `period_start < 2024-10-15` carry a data-quality annotation ("partial history — ownership before 2024-10-15 not reconstructable"). Hiding invites silent differences between dashboard views and Salesforce reports. Russell to approve copy (§9 Q4).

Quarters that *enter Contacting* in Q1 2025 and later are unaffected (all in window). The bug report's numbers (Q1–Q4 2025) are fully reconstructable.

---

## 8. Validation plan

To be run after `vw_ownership_periods` is built (not now).

### 8.1 Aggregate identity #1 — no-filter match

Q3 2025 self-sourced Contacted→MQL, no SGA filter, computed from periods:

```
SUM(hits across all periods where eligible, period_start in Q3 2025, is self-sourced)
/
SUM(at-bats across all periods where eligible, period_start in Q3 2025, is self-sourced)
```

**Expected: ~6.5–6.7%**, matching the current unfiltered value.

### 8.2 Aggregate identity #2 — filtered-equals-unfiltered

Same cohort, with filter `is_real_sga = TRUE AND owner_name IN (every real SGA)`.

**Expected: ~6.5–6.7%**, matching §8.1 within rounding. This is the bug fix — individually checking every real SGA should return the same answer as no filter, because every lead lives in some SGA's period (even if that SGA later handed off to Savvy Ops, the Q3 at-bat is attributed to the SGA who owned it during Q3).

### 8.3 Per-SGA sum-weight identity

For the Q3 2025 self-sourced cohort under the new model:

```
overall_rate = SUM_over_sgas(hits_sga) / SUM_over_sgas(at_bats_sga)
```

Each SGA's rate weighted by their at-bat count reconstructs the overall rate. If any SGA's at-bats don't add up, we've double-counted or dropped periods. Identity is strict: equality within 1 lead (floating point rounding tolerance only).

### 8.4 Spot-check leads

Three leads already sampled from the Savvy-Ops-owned Q3 2025 self-sourced cohort, full owner timelines confirmed in LeadHistory:

| Lead Id | Entered Contacting | Current owner | Prior real-SGA owners |
|---|---|---|---|
| `00QDn000007DMuCMAW` | 2025-09-30 | Savvy Operations | Paige de La Chapelle → Craig Suchodolski → (recycled through Savvy Marketing) → Lauren George |
| `00QDn000007DOy9MAG` | 2025-08-21 | Savvy Operations | Paige de La Chapelle → Lauren George |
| `00QVS00000DIwcN2AT` | 2025-08-13 | Savvy Operations | Andrew Moody → Chris Morgan |

Russell can open each in Salesforce, pull the lead history tab, and verify: (1) the periods produced match the Salesforce audit trail; (2) the MQL (if any) lands in the expected owner's period; (3) `is_real_sga` flags match the owner type at each segment. If all three leads reconcile, the model is trustworthy for this cohort.

---

## 9. Open questions for Russell

Prioritized — decisions I can't make without you.

### Q1 (high) — Real-SGA definition

`IsSGA__c=TRUE AND IsActive=TRUE` includes **Savvy Marketing** (468 historically-owned leads). It's also excluded from the canonical list per schema-context guidance. Do we:

1. Hardcode an exclusion list (Savvy Marketing, Savvy Operations, any others)? This requires maintenance.
2. Add a `IsSystemAccount__c` (or equivalent) custom field to User and filter on it?
3. Treat `IsSGA__c=TRUE` as authoritative and let Savvy Marketing appear as a real SGA?

Also: **inactive** former SGAs (Channing Guyer, Chris Morgan, Dustin Parsons, Anett Diaz) owned real leads during their tenure. Their periods must count. Confirm the rule is `IsSGA__c=TRUE` at time of ownership regardless of current `IsActive`. (We can key off User record as-is because the `IsSGA__c` flag tends to be sticky per role, but this deserves your explicit sign-off.)

### Q2 (high) — Re-engagement and recycles

Phase 1 uses the single `stage_entered_contacting__c` in `vw_funnel_master`, which represents the latest recycle lap. If a lead was contacted by Jimmy in Jan 2025 (no MQL), recycled, and contacted by Jane in Apr 2026 (MQL), Jimmy's earlier at-bat is invisible. Acceptable for phase 1, or is reconstructing per-lap windows from `LeadHistory.Field='Status'` in scope?

### Q3 (medium) — Non-SGA user ownership (Jed Entin, Tim Mackey, etc.)

`IsSGA__c=FALSE` users who briefly owned leads (218, 150 respectively) are likely SGMs or admins handling escalations. Phase 1 treats their periods as `is_real_sga=FALSE`. That means leads during those periods count in "no filter" but not in any SGA-filtered view. Is that what you want? Alternative: treat such periods as transparent — ignore them and extend the surrounding real-SGA period across them. More complex but avoids arbitrary gaps in per-SGA at-bat counts.

### Q4 (medium) — UI treatment of pre-2024-10-15 cohorts

Flag with annotation, hide, or silently include with current-owner fallback? Flag is recommended. Copy proposal: "Ownership history before 2024-10-15 is reconstructed from current owner. Per-SGA rates for cohorts entering Contacting before this date may be understated for SGAs who later reassigned leads."

### Q5 (low) — Opp-era attribution (deferred)

This phase stops at MQL→SQL (lead era). SGM-owned transitions (SQL→SQO, SQO→Joined) need opp-era periods with two signals (Owner and SGA__c). Defer to a phase-2 doc? Or sketch the shape now to catch design conflicts early?

### Q6 (low) — View vs. materialized table

Default is a view. If dashboard query cost materially worsens, do we have budget/approval to materialize as a nightly table in `Tableau_Views`? No action needed now — just want pre-approval so phase 2 isn't blocked.

---

## Hard constraints observed

- No `CREATE VIEW` or `CREATE TABLE` statements in this document.
- No dashboard file edits this phase.
- Every `vw_funnel_master` field referenced was confirmed via `schema-context-mcp describe_view`.
- `LeadHistory` and `OpportunityFieldHistory` existence + schema confirmed via `get_table_info`.
- `OpportunityHistory` does not exist — correction noted in §1.3.
- Premise held: `SGA_Owner_Name__c` is **not** independently history-tracked, so LeadHistory-based reconstruction is the only path.
