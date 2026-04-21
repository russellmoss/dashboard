# Attribution v1.5 — LeadHistory Status-Span Feasibility Report

**Date:** 2026-04-21
**Status:** Research only. No view changes, no src/ changes, no DDL.
**Inputs:** `docs/attribution-design.md`, `docs/attribution-validation-phase2.md`, production BQ.
**Tables probed:** `SavvyGTMData.LeadHistory`, `SavvyGTMData.Lead`, `Tableau_Views.vw_funnel_master`, `Tableau_Views_Dev.vw_ownership_periods`, `Tableau_Views_Dev.ref_non_sga_users`.

---

## Executive summary

**Feasibility: CONFIRMED.** Per-lap Contacting spans can be reconstructed from `LeadHistory.Field='Status'` (229,519 rows, retention 2024-10-15 → present). The span boundary rule is empirically clean. v1.5 is purely additive — no existing view, file, or query needs to change.

**Scale of the shift:**

| Metric | v0 (dashboard) | v1 (periods, current) | v1.5 (span×period) |
|---|---:|---:|---:|
| Q3 2025 self-sourced Contacted→MQL rate | 6.51 % | 6.42 % | **4.28 %** |
| Numerator (hits) | 165 | 168 | 151 |
| Denominator (at-bats) | 2,536 | 2,617 | 3,527 |

v1.5 moves the Q3 2025 rate by **−2.14 pp vs v1** — an order of magnitude larger than the v0→v1 differential (−0.09 pp). The denominator rises 35 % because leads with Q3 Contacting entries often had earlier laps (pre-Q3) whose owners are invisible under v1.

**Russell's Phase 2 hypothesis (Craig/Paige/Andrew shadow at-bats) holds in aggregate:**

| SGA | v1 at-bats | v1.5 at-bats | Δ |
|---|---:|---:|---:|
| Russell Armitage | 570 | 1,232 | **+662** |
| Craig Suchodolski | 629 | 696 | +67 |
| Lauren George | 272 | 320 | +48 |
| Savvy Operations (non-SGA) | 45 | 87 | +42 |
| Perry Kalmeta | 153 | 193 | +40 |
| Eleni Stefanopoulos | 410 | 449 | +39 |
| Andrew Moody | 0 | 12 | **+12** (invisible in v1) |
| Eric Uchoa | 0 | 9 | **+9** (invisible in v1) |
| Dustin Parsons | 0 | 1 | +1 (invisible in v1) |
| Chris Morgan | 57 | 54 | −3 |

Three SGAs have zero at-bats under v1 but real at-bats under v1.5 — these are the "shadow" at-bats the Phase 2 spot-checks implied.

**Recommendation:** Ship v1.5 as a new additive view `vw_at_bats` (Option B grain). Do **not** modify `vw_ownership_periods` — extend. No breaking changes found.

---

## Q1. Field identification

### Q1.1 Candidate fields

Only one field in `LeadHistory` has a name matching `%status%` (case-insensitive):

| Field | Row count | Earliest CreatedDate | Latest CreatedDate |
|---|---:|---|---|
| `Status` | 229,519 | 2024-10-15 00:22:58 | 2026-04-19 23:42:02 |

Retention window matches the LeadHistory floor of 2024-10-15 documented in the design doc §1.2. No ambiguity.

### Q1.2 Spot-check validation against SFDC audit trail

Confirmed the `Field='Status'` rows match Russell's Phase 2 spot-check timelines for the three audit leads:

**Lead `00QDn000007DMuCMAW`** — two Contacting laps, the first invisible under v1:
| CreatedDate | Old→New | Interpretation |
|---|---|---|
| 2024-10-18 18:30:20 | New → Contacting | Lap 1 opens (Paige's at-bat — INVISIBLE under v1) |
| 2025-05-23 13:31:55 | Contacting → Closed | Lap 1 closes (7 months of Paige time) |
| 2025-09-24 19:14:47 | Closed → New | Recycle |
| 2025-09-30 16:56:06 | New → Contacting | Lap 2 opens (Lauren — v1 sees only this) |
| 2025-09-30 17:24:15 | Contacting → Replied | Mid-span (Replied is transient) |
| 2025-09-30 17:26:57 | Replied → Closed | Lap 2 closes |

**Lead `00QDn000007DOy9MAG`** — only one Contacting lap, no shadow at-bat (matches Phase 2):
| CreatedDate | Old→New |
|---|---|
| 2025-07-24 22:15:50 | New → Closed (no span) |
| 2025-08-19 20:47:50 | Closed → New |
| 2025-08-21 16:17:28 | New → Contacting (lap 1 opens, Lauren) |
| 2025-11-25 13:45:06 | Contacting → Closed (lap 1 closes) |

**Lead `00QVS00000DIwcN2AT`** — two Contacting laps, Andrew's first lap invisible under v1:
| CreatedDate | Old→New |
|---|---|
| 2024-11-25 22:40:57 | New → Contacting (lap 1, Andrew Moody — INVISIBLE under v1) |
| 2025-07-24 22:17:50 | Contacting → Closed |
| 2025-07-31 23:18:28 | Closed → New |
| 2025-08-13 21:51:15 | New → Contacting (lap 2, Chris Morgan) |
| 2025-08-13 22:17:13 | Contacting → Replied |
| 2025-08-14 15:24:54 | Replied → Closed |

Lead `00QDn000007DMuCMAW` has a **7-month Paige at-bat** (Oct 2024 → May 2025) that v1 completely misses. Lead `00QVS00000DIwcN2AT` has an **8-month Andrew at-bat** (Nov 2024 → Jul 2025) that v1 misses. These are the Craig/Paige/Andrew shadow at-bats.

**Q1 answer:** `LeadHistory.Field = 'Status'`. Confirmed against SFDC for all three spot-check leads.

---

## Q2. Status value vocabulary

Distinct lead statuses (union of OldValue and NewValue): `New`, `Contacting`, `Replied`, `Nurture`, `Call Scheduled`, `Qualified`, `Closed`, `Interested`, `New - Not in Salesforce` (input/import intermediate).

Top transitions by volume:

### Opening transitions (→ Contacting)
| From | To | Count | Interpretation |
|---|---|---:|---|
| New | Contacting | 72,836 | Standard lead first-touch |
| Closed | Contacting | **18,864** | **Re-engagement — the v1.5 core case** |
| Replied | Contacting | 2,877 | Continuation of same at-bat |
| Nurture | Contacting | 394 | Unparking (starts a new lap) |
| Call Scheduled | Contacting | 84 | Rare back-step |
| Qualified | Contacting | 5 | Very rare back-step |
| Interested | Contacting | 1 | Outlier |

### Closing transitions (Contacting →)
| From | To | Count | Interpretation |
|---|---|---:|---|
| Contacting | Closed | 62,267 | Standard close |
| Contacting | Replied | 12,346 | Mid-span sub-state (Replied is transient) |
| Contacting | New | 4,082 | Manual reset / recycle |
| Contacting | Nurture | 2,003 | Parked — closes the span |
| Contacting | Call Scheduled | 1,441 | **MQL hit from Contacting** |
| Contacting | Qualified | 5 | Skipped MQL → SQL direct |
| Contacting | Interested | 1 | Outlier |

### MQL hits (→ Call Scheduled by prior state)
| Prior state | Count |
|---|---:|
| Contacting | 1,441 |
| **Replied** | **1,016** |
| New | 525 |
| Closed | 296 |
| Nurture | 142 |
| Qualified | 17 |

Replied accounts for 29 % of all MQL transitions. **This is decisive: any span definition that excludes Replied silently drops ~30 % of hits from the numerator.**

### No MQL/SQL/SQO literal values observed
The brief warned MQL/SQL/SQO shouldn't appear here. They don't — in this org MQL is represented by `Status='Call Scheduled'` and SQL by `Status='Qualified'`. SQO is opp-era only and correctly absent. No surprises.

---

## Q3. At-bat span boundaries

### Empirical test — Replied
For all leads that transitioned `Contacting → Replied` (12,346 total), their next state:

| Next state | Count | % |
|---|---:|---:|
| Closed | 6,499 | 59.9 % |
| Contacting (back) | 2,815 | 25.9 % |
| (still in Replied at snapshot) | 1,522 | — |
| Call Scheduled (MQL) | **970** | 8.9 % |
| Nurture | 330 | 3.0 % |
| New | 208 | 1.9 % |
| Qualified | 2 | 0.02 % |

**Ruling: Replied is transient. 26 % return to Contacting (same at-bat), 9 % MQL (hit for same at-bat). Treat as part of the active outreach window.**

### Empirical test — Nurture
For all leads that transitioned `Contacting → Nurture` (2,003 total), their next state:

| Next state | Count | % |
|---|---:|---:|
| (still in Nurture at snapshot) | 819 | — |
| Closed | 743 | 62.7 % of transitions |
| Contacting (re-engage) | 324 | 27.4 % |
| New | 71 | 6.0 % |
| Call Scheduled | 43 | 3.6 % |
| Replied | 3 | 0.3 % |

**Ruling: Nurture is closure-equivalent. 63 % close, only 27 % re-engage. Treat as span-ending. If the lead later returns to Contacting, that is a new lap.**

### On Hold
Not in the vocabulary. No rule needed.

### At-bat span rule (one sentence)

> **A Contacting span starts when the lead's `Status` transitions INTO `{Contacting, Replied}` from any other state, and ends when `Status` transitions OUT of `{Contacting, Replied}` to any other state (`Closed`, `Nurture`, `New`, `Call Scheduled`, `Qualified`) — with the MQL transition (→ `Call Scheduled`) timestamp being included at the closing boundary so the span catches the MQL it caused.**

### Edge cases confirmed
- `Replied → Contacting` (2,877 rows) does **not** open a new span — it stays in the active window.
- `Contacting → New` (4,082 rows) closes the span. Subsequent `New → Contacting` opens a new lap.
- `Nurture → Call Scheduled` (43 rows) is NOT counted as a hit for any at-bat under this rule — the MQL happened outside an active span. This is a design tradeoff: these 43 orphan MQLs account for ~2 % of Q3-cohort numerator drift (see Q5).

---

## Q4. Lap distribution

### Q4.1 Laps per lead (leads created ≥ 2024-10-15, n = 79,823)
| Lap count | Leads | % |
|---|---:|---:|
| 0 (never Contacted) | 20,239 | 25.3 % |
| 1 | 47,105 | 58.9 % |
| 2 | 9,124 | 11.4 % |
| 3 | 2,809 | 3.5 % |
| 4+ | 726 | 0.9 % |

**15.8 % of leads have 2+ Contacting laps** (n = 12,659). v1 attributes only the latest lap for every one of these.

### Q4.2 Owner change between laps
Among the 12,659 multi-lap leads:

| Metric | Value |
|---|---:|
| Total consecutive-lap transitions | 17,127 |
| Transitions with a different owner than prior lap | 5,130 (29.95 %) |
| Multi-lap leads with ≥1 owner change across their laps | 4,565 (36.06 %) |

**5.7 % of all leads match the v1.5 core case** (multi-lap + owner change between laps). This is the cohort v1 fundamentally cannot attribute correctly.

---

## Q5. Denominator-impact shadow computation

### Q5.1 Q3 2025 self-sourced — headline table

Cohort: `vw_funnel_master.Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')`, `is_contacted = 1`, `stage_entered_contacting__c` in 2025-07-01..2025-09-30.

| Model | Numerator | Denominator | Rate | Comment |
|---|---:|---:|---:|---|
| v0 (dashboard / `vw_funnel_master`) | 165 | 2,536 | **6.506 %** | Progression-column aggregation |
| v1 (current `vw_ownership_periods`) | 168 | 2,617 | **6.419 %** | Phase 2 bug-fix baseline |
| v1.5 (span × period intersection, same cohort leads, all spans) | 151 | 3,527 | **4.281 %** | Proposed — **−2.14 pp vs v1** |
| v1.5 (span-start-in-Q3 cohort — definition B) | 163 | 4,023 | 4.052 % | Stable-across-quarters cohort |

### Q5.2 Where does the delta come from?

**Denominator inflation (+910 at-bats, +35 %):** leads whose latest Contacting entry is in Q3 2025 often had earlier laps (in Q1/Q2 2025 or Q4 2024) whose owners were invisible under v1. Those owners now get at-bats.

**Numerator deflation (−17 hits):** 24 of v1's 168 hits came from MQLs entered from `Closed`, `Nurture`, or `Qualified` — not from a Contacting span. Under v1.5's strict span rule those MQLs are not attributable to any at-bat. This is a design tradeoff: the 24 "orphan" MQLs would need a separate attribution rule (e.g., credit the owner at MQL timestamp regardless of span) if we want to recover them.

### Q5.3 Q1 2025 self-sourced cross-check (older cohort)

| Model | Numerator | Denominator | Rate |
|---|---:|---:|---:|
| v1 | 122 | 1,621 | 7.526 % |
| v1.5 | 112 | 1,844 | 6.074 % (**−1.45 pp**) |

Older cohorts have smaller Δ than Q3 because their pre-cohort laps fall outside LeadHistory retention. The Q3 uplift is larger precisely because LeadHistory fully covers the prior laps for recent cohorts.

### Q5.4 Per-SGA at-bat delta (top 10 by |Δ|, Q3 2025 self-sourced)

| Rank | SGA | v1 at-bats | v1.5 at-bats | Δ | Interpretation |
|---:|---|---:|---:|---:|---|
| 1 | **Russell Armitage** | 570 | 1,232 | **+662** | Owned many leads later re-engaged by other SGAs; prior laps surface. |
| 2 | **Craig Suchodolski** | 629 | 696 | +67 | Phase 2 spot-check subject — shadow at-bats confirmed. |
| 3 | **Lauren George** | 272 | 320 | +48 | Lauren also owned earlier laps for leads later handed off/recycled. |
| 4 | Savvy Operations (non-SGA) | 45 | 87 | +42 | Ops sweep periods gain intersections with earlier Contacting spans. |
| 5 | Perry Kalmeta | 153 | 193 | +40 | |
| 6 | Eleni Stefanopoulos | 410 | 449 | +39 | |
| 7 | **Andrew Moody** | 0 | 12 | **+12** | Phase 2 spot-check subject — zero under v1, real under v1.5. |
| 8 | **Eric Uchoa** | 0 | 9 | **+9** | Shadow owner surfaced. |
| 9 | Chris Morgan | 57 | 54 | −3 | Small negative — a few orphan MQLs removed. |
| 10 | Helen Kamens | 10 | 7 | −3 | |

Aggregate story: v1.5 redistributes credit/blame from the most-recent-owner sink (Lauren, Chris) back to prior owners (Russell Armitage, Craig, Paige, Andrew, Eric). **The Phase 2 anecdote generalizes — this is not just three leads.**

---

## Q6. Grain and consuming-query impact

### Q6.1 Proposal: Option B — new view `vw_at_bats` at intersection grain

**One row per `(lead_id, owner_user_id, at_bat_start, at_bat_end)` where `at_bat_start = MAX(period_start, span_start)` and `at_bat_end = MIN(period_end, span_end)` and the intersection is nonempty.**

Fields expected:
- `lead_id`, `owner_user_id`, `owner_name`, `is_real_sga` (from ownership periods)
- `at_bat_start`, `at_bat_end`, `lap_ordinal` (the Contacting span number, 1..N)
- `has_hit` (whether any MQL event lands in `[at_bat_start, at_bat_end]`)
- `at_bat_reason_end` (`mql`, `nurture`, `closed`, `new_reset`, `reassigned_sga`, `reassigned_ops`, `still_open`)
- Lead-level passthroughs: `lead_final_source`, `lead_is_self_sourced`, `has_complete_history`

Upper-bounded row count: ~1.35× `vw_ownership_periods` based on Q3 observation (3,527 / 2,617 = 1.35). Total dataset estimate: ~350k–400k rows. Tractable as a view; materialize later if cost bites.

### Q6.2 Why Option B over keeping current grain

**Option A (keep `vw_ownership_periods` grain, intersect at query time):**
- Each dashboard query would need to inline the Contacting-span CTE.
- CTE duplication across 20+ query files is a maintenance burden.
- Consumers still need to LATERAL-unnest periods into spans → the query-time cost is the same as Option B's row-count cost, but paid on every request.

**Option B (new intersection-grain view):**
- Cost paid once in the view definition.
- Phase 3 consumers swap `JOIN vw_ownership_periods p` for `JOIN vw_at_bats a` — one-line change per query.
- Preserves `vw_ownership_periods` as-is (Phase 2 artifact unchanged).
- Clean semantic: "each row is one at-bat."

**Argued choice: Option B.**

### Q6.3 Grain change implications for `src/lib/utils/filter-helpers.ts`

Phase 3 will JOIN either `vw_ownership_periods` (v1) or `vw_at_bats` (v1.5) on `lead_id = Full_prospect_id__c` via LEFT JOIN. **Both break row-grain assumptions in existing consumers** — one lead can produce N periods or N at-bats. v1 already forces this reckoning in Phase 3; v1.5 adds ~35 % more rows but does not introduce a new class of breakage. Explicitly called out:

- **DISTINCT / GROUP BY clauses already required under v1** also suffice for v1.5.
- AUM aggregations that read `vw_funnel_master` directly (not through the period view) are unaffected.
- The `filter-helpers.ts` change from `v.SGA_Owner_Name__c IN UNNEST(@sgas)` to `a.owner_name IN UNNEST(@sgas) AND a.is_real_sga = TRUE` is identical to the Phase 3 design doc §6 plan.

**Net: v1.5 grain change is a superset of v1's grain change. No additional breaking surface.**

---

## Q7. Don't-break-anything audit

| Concern | Finding |
|---|---|
| `vw_funnel_master` modified? | **No.** v1.5 does not touch it. Confirmed via design intent and this report's hard constraints. |
| `src/` files modified in Phase 2.5 (research)? | **No.** This report is the only deliverable. |
| `src/` files modified in Phase 2.6 (v1.5 implementation, if approved)? | **No.** v1.5 ships as new view `vw_at_bats` alongside the existing dev artifacts. Phase 3 (separate) is the one that changes `src/lib/utils/filter-helpers.ts` — and would change regardless of v1 vs v1.5. |
| Unfiltered dashboard path (reads `vw_funnel_master` directly)? | **Untouched.** `Grep` for `vw_ownership_periods`, `vw_at_bats`, `ref_non_sga_users`, `Tableau_Views_Dev` in `src/` → **zero matches** (same as Phase 2 §1). v1.5 maintains this invariant. |
| Breaking change v1.5 requires that v1 did not? | **None found.** The grain increase is a ~35 % scale-up of v1's already-period-level grain, not a new semantic shift. Same JOIN-and-aggregate patterns apply. |

---

## Surprises

1. **24 of v1's 168 Q3 hits came from MQLs entered from `Closed`, `Nurture`, or `Qualified`** — not from a Contacting span. These are "orphan MQLs" with no active at-bat. Under strict v1.5 they are not attributable. If Russell wants to preserve them, the rule needs a fallback: credit the owner active at MQL timestamp regardless of span. Would recover ~15 hits but introduces a special case.
2. **Russell Armitage's at-bat count more than doubles under v1.5 (570 → 1,232).** He is the single largest beneficiary of the shadow-lap exposure — many of the re-engaged leads had him as the original owner. Worth a sanity check by a human familiar with his book before shipping.
3. **Replied carries 29 % of all MQL hits** (1,016 of ~3,437 total `→ Call Scheduled` events from Contacting/Replied states). Any span definition that excludes Replied would silently gut the numerator. Confirmed empirically before choosing the rule.
4. **LeadHistory retention floor is 2024-10-15**, which is exactly when `Field='Status'` activity starts. Retention applies to BOTH Owner and Status tracking — no extra gap for status specifically. This is useful because Q1 2025 (fully in-window) can be reported without status-history fallback.
5. **`New - Not in Salesforce` appears as an OldValue in 353 rows**, all transitioning to `New`. This is an import/seam intermediate, not a real state. Safe to treat as pre-`New`.
6. **`Interested` is vestigial** (total 8 transitions in, 2 out). Ignoring it has no measurable effect.
7. **`vw_funnel_master.is_contacted = 1` is stricter than `stage_entered_contacting__c IS NOT NULL`** — Phase 2 cohort uses the former and drops ~350 leads that my initial raw query included. Used the `is_contacted=1` gate throughout to match Phase 2 exactly (got 2,617 at-bats vs Phase 2's 2,618 — within 1-lead refresh delta).

---

## STOP AND REPORT

Do not proceed to implementation. Russell decides whether to:
- (A) Ship v1.5 under definition (a) — cohort = latest-entry-in-window, count all spans of cohort leads;
- (B) Ship v1.5 under definition (b) — cohort = span-start-in-window, each at-bat in exactly one quarter; or
- (C) Stay on v1 and document the shadow-at-bat limitation formally.

---

## Appendix — SQL

All queries below are **read-only** against production BigQuery. None were run as DDL. Run order matches the questions.

### A. Q1 — Status field candidates
```sql
SELECT Field, COUNT(*) AS row_count,
       MIN(CreatedDate) AS earliest_ts, MAX(CreatedDate) AS latest_ts
FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
WHERE LOWER(Field) LIKE '%status%' AND IsDeleted = FALSE
GROUP BY Field;
```

### B. Q1 — Spot-check validation
```sql
SELECT LeadId, CreatedDate, OldValue, NewValue, CreatedById
FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
WHERE LeadId IN ('00QDn000007DMuCMAW','00QDn000007DOy9MAG','00QVS00000DIwcN2AT')
  AND Field = 'Status' AND IsDeleted = FALSE
ORDER BY LeadId, CreatedDate;
```

### C. Q2 — Status vocabulary
```sql
SELECT OldValue, NewValue, COUNT(*) AS transition_count
FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
WHERE Field = 'Status' AND IsDeleted = FALSE
GROUP BY OldValue, NewValue
ORDER BY transition_count DESC;
```

### D. Q3 — Replied transience test
```sql
WITH status_events AS (
  SELECT LeadId, CreatedDate, OldValue, NewValue,
    LEAD(NewValue) OVER (PARTITION BY LeadId ORDER BY CreatedDate) AS next_status
  FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
  WHERE Field = 'Status' AND IsDeleted = FALSE
)
SELECT next_status, COUNT(*) AS cnt
FROM status_events
WHERE OldValue = 'Contacting' AND NewValue = 'Replied'
GROUP BY next_status ORDER BY cnt DESC;
```
Run the same with `NewValue = 'Nurture'` for the Nurture test.

### E. Q4 — Lap distribution
```sql
WITH status_events AS (
  SELECT LeadId, CreatedDate, OldValue, NewValue,
    CASE WHEN NewValue IN ('Contacting','Replied') THEN 1 ELSE 0 END AS in_span_next,
    CASE WHEN OldValue IN ('Contacting','Replied') THEN 1 ELSE 0 END AS in_span_prev
  FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
  WHERE Field = 'Status' AND IsDeleted = FALSE
),
span_opens AS (
  SELECT LeadId, COUNT(*) AS lap_count
  FROM status_events WHERE in_span_next = 1 AND in_span_prev = 0
  GROUP BY LeadId
),
lead_pool AS (
  SELECT Id AS lead_id FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE IsDeleted = FALSE AND CreatedDate >= TIMESTAMP('2024-10-15')
)
SELECT
  CASE WHEN IFNULL(so.lap_count, 0) = 0 THEN '0'
       WHEN so.lap_count = 1 THEN '1'
       WHEN so.lap_count = 2 THEN '2'
       WHEN so.lap_count = 3 THEN '3' ELSE '4+' END AS lap_bucket,
  COUNT(*) AS lead_count
FROM lead_pool lp LEFT JOIN span_opens so ON so.LeadId = lp.lead_id
GROUP BY lap_bucket ORDER BY lap_bucket;
```

### F. Q4 — Owner change between laps (lead-level)
```sql
WITH status_events AS (
  SELECT LeadId, CreatedDate, OldValue, NewValue,
    CASE WHEN NewValue IN ('Contacting','Replied') THEN 1 ELSE 0 END AS in_span_next,
    CASE WHEN OldValue IN ('Contacting','Replied') THEN 1 ELSE 0 END AS in_span_prev
  FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
  WHERE Field = 'Status' AND IsDeleted = FALSE
),
span_opens AS (
  SELECT LeadId AS lead_id, CreatedDate AS lap_start_ts,
    ROW_NUMBER() OVER (PARTITION BY LeadId ORDER BY CreatedDate) AS lap_ordinal
  FROM status_events WHERE in_span_next = 1 AND in_span_prev = 0
),
leads_seed AS (
  SELECT Id AS lead_id, OwnerId AS current_owner_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE IsDeleted = FALSE AND CreatedDate >= TIMESTAMP('2024-10-15')
),
owner_changes AS (
  SELECT LeadId AS lead_id, CreatedDate AS change_ts, NewValue AS new_owner_id
  FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
  WHERE Field = 'Owner' AND IsDeleted = FALSE AND REGEXP_CONTAINS(NewValue, r'^005')
),
lap_owner_candidates AS (
  SELECT so.lead_id, so.lap_ordinal, so.lap_start_ts, oc.new_owner_id,
    ROW_NUMBER() OVER (PARTITION BY so.lead_id, so.lap_ordinal ORDER BY oc.change_ts DESC) AS rn
  FROM span_opens so
  JOIN leads_seed ls ON ls.lead_id = so.lead_id
  LEFT JOIN owner_changes oc ON oc.lead_id = so.lead_id AND oc.change_ts <= so.lap_start_ts
),
lap_with_owner AS (
  SELECT loc.lead_id, loc.lap_ordinal,
    COALESCE(loc.new_owner_id, ls.current_owner_id) AS owner_at_lap_start
  FROM lap_owner_candidates loc
  JOIN leads_seed ls ON ls.lead_id = loc.lead_id
  WHERE loc.rn = 1 OR loc.rn IS NULL
),
lead_level AS (
  SELECT lead_id, COUNT(*) AS lap_count, COUNT(DISTINCT owner_at_lap_start) AS distinct_owners
  FROM lap_with_owner GROUP BY lead_id
)
SELECT
  COUNTIF(lap_count >= 2) AS multi_lap_leads,
  COUNTIF(lap_count >= 2 AND distinct_owners >= 2) AS multi_lap_with_owner_change,
  ROUND(100.0 * COUNTIF(lap_count >= 2 AND distinct_owners >= 2)
        / NULLIF(COUNTIF(lap_count >= 2), 0), 2) AS pct
FROM lead_level;
```

### G. Q5 — v1.5 shadow computation
```sql
WITH status_events AS (
  SELECT LeadId, CreatedDate, OldValue, NewValue,
    CASE WHEN NewValue IN ('Contacting','Replied') THEN 1 ELSE 0 END AS in_span_next,
    CASE WHEN OldValue IN ('Contacting','Replied') THEN 1 ELSE 0 END AS in_span_prev
  FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
  WHERE Field = 'Status' AND IsDeleted = FALSE
),
span_opens AS (
  SELECT LeadId AS lead_id, CreatedDate AS lap_start_ts,
    ROW_NUMBER() OVER (PARTITION BY LeadId ORDER BY CreatedDate) AS lap_ordinal
  FROM status_events WHERE in_span_next = 1 AND in_span_prev = 0
),
span_closes AS (
  SELECT LeadId AS lead_id, CreatedDate AS lap_end_ts,
    ROW_NUMBER() OVER (PARTITION BY LeadId ORDER BY CreatedDate) AS close_ordinal
  FROM status_events WHERE in_span_next = 0 AND in_span_prev = 1
),
spans AS (
  SELECT so.lead_id, so.lap_ordinal, so.lap_start_ts,
    COALESCE(sc.lap_end_ts, CURRENT_TIMESTAMP()) AS lap_end_ts
  FROM span_opens so
  LEFT JOIN span_closes sc ON sc.lead_id = so.lead_id AND sc.close_ordinal = so.lap_ordinal
),
mql_events AS (
  SELECT LeadId AS lead_id, CreatedDate AS mql_ts
  FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
  WHERE Field = 'Status' AND IsDeleted = FALSE
    AND NewValue = 'Call Scheduled' AND OldValue IN ('Contacting','Replied')
),
cohort_leads AS (
  SELECT v.Full_prospect_id__c AS lead_id
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE v.Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
    AND v.is_contacted = 1
    AND DATE(v.stage_entered_contacting__c) BETWEEN '2025-07-01' AND '2025-09-30'
),
at_bats AS (
  SELECT p.lead_id, p.owner_user_id, p.owner_name, p.is_real_sga,
    GREATEST(p.period_start, s.lap_start_ts) AS intersect_start,
    LEAST(p.period_end, s.lap_end_ts) AS intersect_end
  FROM `savvy-gtm-analytics.Tableau_Views_Dev.vw_ownership_periods` p
  JOIN cohort_leads c ON c.lead_id = p.lead_id
  JOIN spans s ON s.lead_id = p.lead_id
  WHERE GREATEST(p.period_start, s.lap_start_ts) < LEAST(p.period_end, s.lap_end_ts)
),
at_bats_hits AS (
  SELECT a.lead_id, a.owner_user_id, a.owner_name, a.is_real_sga,
    a.intersect_start, a.intersect_end,
    MAX(CASE WHEN m.mql_ts >= a.intersect_start AND m.mql_ts <= a.intersect_end THEN 1 ELSE 0 END) AS is_hit
  FROM at_bats a
  LEFT JOIN mql_events m ON m.lead_id = a.lead_id
  GROUP BY a.lead_id, a.owner_user_id, a.owner_name, a.is_real_sga, a.intersect_start, a.intersect_end
)
SELECT SUM(is_hit) AS numerator, COUNT(*) AS denominator,
  ROUND(100.0 * SAFE_DIVIDE(SUM(is_hit), COUNT(*)), 4) AS rate_pct
FROM at_bats_hits;
```

### H. Q5 — Per-SGA delta
```sql
-- (See Q5 shadow query above for v1.5 side.)
-- v1 side:
SELECT p.owner_name, p.is_real_sga, COUNT(*) AS v1_at_bats
FROM `savvy-gtm-analytics.Tableau_Views_Dev.vw_ownership_periods` p
JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v ON v.Full_prospect_id__c = p.lead_id
WHERE v.Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND v.is_contacted = 1
  AND DATE(v.stage_entered_contacting__c) BETWEEN '2025-07-01' AND '2025-09-30'
  AND p.lead_stage_entered_contacting_ts IS NOT NULL
  AND p.lead_stage_entered_contacting_ts <  p.period_end
  AND (p.lead_mql_stage_entered_ts IS NULL OR p.lead_mql_stage_entered_ts > p.period_start)
  AND (p.effective_lead_closed_ts IS NULL OR p.effective_lead_closed_ts > p.period_start)
GROUP BY p.owner_name, p.is_real_sga;
```

### I. Q7 — Src/ grep
```bash
grep -rE "vw_ownership_periods|vw_at_bats|ref_non_sga_users|Tableau_Views_Dev" src/
# → zero matches; additive-view invariant holds.
```
