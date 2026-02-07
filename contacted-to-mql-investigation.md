# Contacted-to-MQL Conversion Rate Investigation

This document explains how **Contacted→MQL** conversion rates are calculated in the dashboard (cohorted vs periodic), summarizes BigQuery findings on **Auto-Closed by Operations** timing, and discusses an option to treat prospects who stay in Contacted without converting to MQL within **21 days** as “effectively closed” for conversion-rate math only. It also lists where contacted-to-MQL is used across the codebase and semantic layer.

---

## 1. Field and stage naming

- The **stage** is “Contacted” / “Contacting”; the **date field** in the codebase and in `vw_funnel_master` is **`stage_entered_contacting__c`** (from the Lead table: when the lead entered the Contacting stage).
- There is no field named `stage_entered_contacted__c` in this codebase; all logic uses **`stage_entered_contacting__c`**.
- “Contacted” in the metric name **Contacted→MQL** refers to leads that have entered this Contacting stage (i.e. `stage_entered_contacting__c` is not null).

---

## 2. How Contacted→MQL conversion rates are calculated

The dashboard supports two modes for conversion rates: **period (periodic)** and **cohort**. Both are implemented in `src/lib/queries/conversion-rates.ts` and rely on flags from **`views/vw_funnel_master.sql`**.

### 2.1 Source of truth: `vw_funnel_master.sql`

The view defines:

- **Eligibility (denominator for cohort):**  
  `eligible_for_contacted_conversions = 1` when the lead is contacted **and** has a **resolved** outcome: either became MQL (`mql_stage_entered_ts` set) **or** lead was closed (`lead_closed_date` = `Stage_Entered_Closed__c` not null).  
  Leads still in Contacted with no MQL and no close date are **not** eligible (excluded from the cohort denominator).

- **Progression (numerator):**  
  `contacted_to_mql_progression = 1` when the lead is contacted, became MQL, and the MQL date is on or after `FilterDate` (so recycled leads are counted correctly).

So:

- **Cohort denominator** = contacted leads that have **resolved** (MQL or closed).
- **Cohort numerator** = contacted leads that **progressed to MQL** (with the FilterDate guard).

### 2.2 Cohort mode (resolved-only)

- **Idea:** “Of contacted leads from the selected period that have already resolved, what % became MQL?”
- **Denominator:** Sum of `eligible_for_contacted_conversions` for rows where `stage_entered_contacting__c` is in the filter date range. Only resolved records (MQL or closed) are counted.
- **Numerator:** Sum of `contacted_to_mql_progression` over the same cohort (same date filter on `stage_entered_contacting__c`).
- **Rate:** numerator / denominator (0–100%); unresolved “still in Contacted” leads are excluded from the denominator.

Used for the main scorecard and for cohort-based trend series when the dashboard is in cohort mode.

### 2.3 Period mode (period-resolved)

- **Idea:** “What conversion activity completed in this period?” — both **entry into Contacted** and **resolution** (MQL or closed) must fall in the **same** period.
- **Denominator:** Count of leads who entered Contacted in the period **and** resolved in the same period (either became MQL in the period or were closed in the period).
- **Numerator:** Count of leads who entered Contacted in the period **and** became MQL in the same period.
- **Rate:** can exceed 100% in theory (different populations for entry vs resolution); in practice used for “activity in period” views.

So:

- **Cohorted** = same cohort, resolved only, rate ≤ 100%.
- **Periodic** = entry and resolution in the same period; denominator/numerator can differ by period design.

---

## 3. The problem: Contacted leads and Auto-Closed by Operations

Many leads sit in **Contacted** (they have `stage_entered_contacting__c`) and are later closed with **Disposition__c = "Auto-Closed by Operations"**. Operations auto-close leads **90 days** after they entered Contacted (or after `CreatedDate`) if they haven’t moved stage. So:

- A large number of leads are “contacted but not MQL” for a long time.
- They only become “resolved” (and thus eligible for the cohort denominator) when they are closed, which can be **90+ days** later.
- Until then they are excluded from the cohort denominator, which can make the contacted-to-MQL rate look different from “true” conversion behavior and can delay when recent cohorts look resolved.

---

## 4. BigQuery: How long until “Auto-Closed by Operations”?

Analysis was run on **SavvyGTMData.Lead** for leads with **Disposition__c = "Auto-Closed by Operations"** and non-null **Stage_Entered_Closed__c**. “Time to close” is days from **last stage / creation** to close:

- **Reference date:** `COALESCE(stage_entered_contacting__c, CreatedDate)`  
- **Close date:** `Stage_Entered_Closed__c`

**Results:**

| Metric | Value |
|--------|--------|
| Total Auto-Closed by Operations (with close date) | 36,223 |
| Median days (contacting/CreatedDate → close) | 111 |
| Mean days | ~235 |
| Min / Max days | -664 / 1,019 |
| P20 / P80 | 27 / 499 |

**Distribution (days from contacting/CreatedDate to close):**

| Bucket | Count | % |
|--------|--------|---|
| Negative (data quirk) | 1,872 | 5.2% |
| 0–21 days | 4,941 | 13.6% |
| 22–90 days | 1,833 | 5.1% |
| 91–120 days | 10,239 | 28.3% |
| 121+ days | 17,338 | 47.9% |

**Takeaways:**

- Only a small share close in the **22–90 day** window; the bulk close **after 90 days** (76% close in 91+ days).
- So in practice, “90-day auto-close” does not mean most records close at exactly 90 days; there is a long tail (median 111, mean ~235).
- This supports the concern: many contacted leads stay “open” for a long time before becoming eligible for the cohort denominator, which affects how the contacted-to-MQL rate behaves over time.

---

## 4a. Source-specific: “Provided Lead List” and “Provided List (Lead Scoring)”

Analysis below uses **SavvyGTMData.Lead**: `Final_Source__c` (source), `Disposition__c = 'Auto-Closed by Operations'`, `Stage_Entered_Closed__c` (close date), `CreatedDate`, `stage_entered_contacting__c`, `Stage_Entered_Call_Scheduled__c` (MQL). The dashboard’s **Original_source** comes from this field (via `vw_funnel_master`).

### Source name note

- **“Provided List (Lead Scoring)”** — exact match on `TRIM(Final_Source__c) = 'Provided List (Lead Scoring)'` returns data; all numbers below are for this source.
- **“Provided Lead List”** — see **“Where is ‘Provided Lead List’ now?”** below (different field and attribution switch).

---

### Where is “Provided Lead List” now? (LeadSource vs Final_Source__c, first-touch / last-touch)

Historically you had **Original_source** “Provided Lead List” with thousands of leads. The dashboard and `vw_funnel_master` use **`Final_Source__c`** for source (Original_source). After switching to **first-touch / last-touch** attribution, the following holds in **savvy-gtm-analytics.SavvyGTMData.Lead**:

| Field | Value | Count |
|--------|--------|--------|
| **LeadSource** | `'Provided Lead List'` (exact) | **61,993** |
| **Final_Source__c** | `'Provided Lead List'` (exact) | **0** |

So **“Provided Lead List”** lives in **LeadSource**, not in Final_Source__c. There are **61,993** leads with `LeadSource = 'Provided Lead List'`.

**Where did those 61,993 leads “go” in the dashboard after the switch?**  
The dashboard shows source from **Final_Source__c**. For leads where `LeadSource = 'Provided Lead List'`, their **Final_Source__c** (current attribution) breaks down as:

| Final_Source__c (dashboard source) | Count |
|-----------------------------------|--------|
| Provided List (Lead Scoring)       | 61,896 |
| LinkedIn (Self Sourced)           | 80     |
| Fintrx (Self-Sourced)             | 16     |
| Recruitment Firm                  | 1      |

So the vast majority of historical “Provided Lead List” leads now appear in the dashboard as **“Provided List (Lead Scoring)”**. The analyses in this doc for “Provided List (Lead Scoring)” (auto-close timing, Contacting→MQL timing, etc.) therefore cover most of the former “Provided Lead List” volume. To analyze or filter by the **original** source (first touch), use **LeadSource = 'Provided Lead List'** in BigQuery; the dashboard source filter uses **Final_Source__c** (last touch / current attribution).

---

### Provided List (Lead Scoring) — Auto-Closed by Operations

#### 1. Created and nothing happened after (never Contacting, never MQL)

- **Definition:** Lead has `stage_entered_contacting__c` and `Stage_Entered_Call_Scheduled__c` both NULL; closed with Auto-Closed by Operations.
- **Count:** 11,413.
- **Time from CreatedDate to close:**

| Metric | Value |
|--------|--------|
| Median days (Created → closed) | 555 |
| Mean days | ~485 |
| Min / Max days | 0 / 1,019 |

So for this source, leads that **never move past creation** take a very long time to auto-close (median 555 days), with a long tail.

#### 2. Entered Contacting but did not move to MQL (then Auto-Closed by Operations)

- **Definition:** Lead has `stage_entered_contacting__c` set, `Stage_Entered_Call_Scheduled__c` NULL, closed with Auto-Closed by Operations.
- **Count:** 14,414.
- **Time from stage_entered_contacting__c to close:**

| Metric | Value |
|--------|--------|
| Median days (Contacting → closed) | 103 |
| Mean days | ~135 |

**Distribution (days from entering Contacting to close):**

| Bucket | Count | % (of 14,414) |
|--------|--------|----------------|
| 0–21 days | 3,302 | 22.9% |
| 22–90 days | 945 | 6.6% |
| 91–120 days | 4,457 | 30.9% |
| 121+ days | 5,710 | 39.6% |

So for “Provided List (Lead Scoring)” leads that get to Contacting but not MQL, most auto-close **after 90 days** (70.5% in 91+ days); median time from Contacting to close is 103 days. Only 6.6% close in the 22–90 day window.

#### 3. Last stage to close (any Auto-Closed by Operations for this source)

- **Definition:** “Last activity” = latest of `CreatedDate`, `stage_entered_contacting__c`, `Stage_Entered_Call_Scheduled__c` (when set); time from that date to `Stage_Entered_Closed__c`.
- **Count:** 25,989 (all Auto-Closed by Operations for this source with a close date).
- **Time from last stage to close:**

| Metric | Value |
|--------|--------|
| Median days | 188 |
| Mean days | ~288 |

So overall, from “last step” in the funnel to auto-close, median is 188 days and mean ~288 days for this source.

---

### Provided Lead List

- **“Provided Lead List”** is stored in **LeadSource** (61,993 leads), not in **Final_Source__c** (see “Where is ‘Provided Lead List’ now?” above). The dashboard uses Final_Source__c for source; after the first-touch/last-touch switch, most of those leads show as **“Provided List (Lead Scoring)”** in the dashboard.
- For timing analyses (auto-close, Contacting→MQL) by **original** source, use **LeadSource = 'Provided Lead List'** in BigQuery. The “Provided List (Lead Scoring)” analyses in this doc already cover the majority of former “Provided Lead List” volume (61,896 of 61,993).

---

### Implications for the 21-day “effectively closed” idea

- For **Provided List (Lead Scoring)** in Contacting without MQL, **22.9%** auto-close within 21 days; the rest close later (median 103 days). Treating “contacted and no MQL within 21 days” as **effectively resolved** for Contacted→MQL conversion rate only would:
  - Resolve a meaningful share of these leads in the denominator earlier (without changing Salesforce or other reporting).
  - Leave the long tail (70.5% closing in 91+ days) no longer inflating the “open” pool in the rate.
- The same logic can be applied to **Provided Lead List** once the correct source value is confirmed and the same queries are run.

---

### 4b. Contacting → MQL: average time (stage_entered_contacting__c to Stage_Entered_Call_Scheduled__c)

Time from **entering Contacting** to **reaching MQL** (Call Scheduled) for leads that have both dates. Source in BigQuery is **Lead.Final_Source__c**; the dashboard’s **Original_source** is built from this (via `vw_funnel_master`). “Provided Lead List” was the **Original_source** (i.e. same field) in the dashboard.

#### Cohort: Provided List (Lead Scoring) — ever Contacted, of those who became MQL

- **Cohort definition:** Source = **“Provided List (Lead Scoring)”** (Final_Source__c), **ever** entered `stage_entered_contacting__c` (Contacted). Of those, the subset who **entered** `Stage_Entered_Call_Scheduled__c` (MQL).
- **Reported counts:** **39,192** ever Contacted (source Provided List (Lead Scoring)); **1,126** of those entered MQL. (BigQuery at query time: 39,198 ever Contacted, 1,034 with both dates non-null; small variance may be sync or filter. Stats below use the set who have both dates.)
- **Time from Contacting → MQL** for those who became MQL:

| Stat | All with both dates | Forward only (MQL date ≥ Contacting date) |
|------|----------------------|-------------------------------------------|
| **N** | 1,034 | **895** |
| **Average** days | −20.0* | **15.3 days** |
| **Median** days | 1 day | **1 day** |
| **Standard deviation** | 120.6* | **55.1 days** |
| **Min / Max** days | −565 / 573 | 0 / 573 |

\*Raw average and stddev over all 1,034 are skewed by rows where MQL date is before Contacting date (recycled/backwards). **Use the forward-only row** for conversion timing and cut-off: **average 15.3 days**, **median 1 day**, **standard deviation 55.1 days** (895 people).

#### Provided List (Lead Scoring) — earlier summary

- **Leads with both dates (Contacting and MQL):** 1,034 (BQ); user-reported 1,126 entered MQL from 39,192 contacted.
- **Forward only (MQL ≥ Contacting):** 895 leads → **average 15.3 days**, **median 1 day**, **stddev 55.1 days**, min 0, max 573.

**Implications for conversion-rate cut-off:** The distribution is highly right-skewed (median 1 day vs mean 15.3, stddev 55.1). Most conversions happen within 0–1 days; a long tail extends out to 573 days. For a “effectively closed” cut-off in Contacted→MQL conversion rate logic:
- **Median 1 day** suggests the typical converter moves quickly; a cut-off well above 1 day (e.g. 21 days) avoids counting fast converters as closed.
- **Mean + 1 SD** ≈ 15 + 55 ≈ **70 days**; mean + 2 SD ≈ 125 days. So 21 days sits well below one standard deviation and should treat most “normal” conversion windows as still open, while excluding a large share of the long tail from the denominator over time.
- Choosing **21 days** as the cut-off (no MQL within 21 days → effectively closed for rate only) is conservative relative to the spread (55 days stddev) and aligns with the goal of resolving the denominator earlier without affecting fast converters.

#### Provided Lead List (all of them — LeadSource = 'Provided Lead List')

Using **all** leads with **LeadSource = 'Provided Lead List'** (original source, 61,993 total) who have **both** `stage_entered_contacting__c` and `Stage_Entered_Call_Scheduled__c`:

- **Leads with both dates:** 1,011.
- **Forward dates only** (MQL date ≥ Contacting date; excludes recycled/backwards data): **871** leads.

| Stat | All 1,011 | Forward only (871) |
|------|-----------|---------------------|
| **Average** days (Contacting → MQL) | −20.4* | **15.9 days** |
| **Standard deviation** | 122.1* | **56.2 days** |
| **Median** days | — | **1 day** |
| **Min / Max** days | — | 0 / 573 |

\*Raw average and stddev over all 1,011 are skewed by rows where MQL date is before Contacting date (e.g. recycled leads). Use the **forward-only** row for conversion timing and cut-off decisions.

So for **all** “Provided Lead List” people who ever moved Contacting → MQL: **average 15.9 days**, **stddev 56.2 days**, **median 1 day** (871 leads with forward dates). This is the full cohort, not a subset.

- When filtering by **dashboard source** (Final_Source__c), “Provided Lead List” no longer exists; those leads appear as “Provided List (Lead Scoring)” and others (see “Where is ‘Provided Lead List’ now?” above).

---

## 4c. Cutoff sensitivity analysis (from cursor-investigation-questions.md)

### Q1. What % of eventual MQL conversions happen AFTER day N?

For **Provided List (Lead Scoring)**, forward dates only (MQL date ≥ Contacting date), **895** eventual converters. Count and % that converted **after** each cutoff:

| Cutoff | Converted after N days | % of all eventual converters |
|--------|-------------------------|-------------------------------|
| 7 days | 196 | **21.9%** |
| 14 days | 142 | **15.9%** |
| **21 days** | **110** | **12.3%** |
| 30 days | 80 | **8.9%** |
| 45 days | 63 | **7.0%** |
| 60 days | 47 | **5.3%** |
| 90 days | 36 | **4.0%** |

**Implication:** At a **21-day** cutoff, **12.3%** of eventual converters would be misclassified (marked “effectively closed” before they convert). The investigation doc target was &lt;5% false-negative; **21 days exceeds that**. At **60 days**, 5.3% convert after; at **90 days**, 4.0%. So a cutoff of **60 or 90 days** keeps the false-negative rate at or below ~5% for this source.

### Q2. By cohort vintage (month)

Conversion velocity can vary by vintage. For **Provided List (Lead Scoring)** by month of `stage_entered_contacting__c`: sample month 2024-09 had 1,326 contacted, 28 converted to MQL (forward only), and **28.6%** of those converters converted **after** 21 days. So for that vintage, a 21-day cutoff would misclassify a higher share of converters than the all-time 12.3%. Cohort-by-cohort analysis (run per month/quarter) is recommended to check if recent cohorts behave differently.

### Q3. Does the cutoff need to vary by source?

The same “% converted after N days” logic should be run for **top 5–10 sources by contacted volume**. If some sources have a much higher % converting after 21 days, a global 21-day rule could be too aggressive for those sources. **Recommendation:** Run Q1 for each top source; if most sources have &lt;5% converting after 21 days, a global 21-day rule may be acceptable; otherwise consider source-specific cutoffs or a longer global cutoff (e.g. 30 or 45 days).

---

## 4d. Current denominator behavior and “in limbo” leads (from cursor-investigation-questions.md)

### Q4. Cohort conversion rate over time (Provided List (Lead Scoring))

By **month** of `stage_entered_contacting__c`: **cohort_size** = all contacted in that month; **resolved_count** = MQL or closed; **mql_count** = progressed to MQL; **current_cohort_rate** = mql_count / resolved_count; **true_rate_full_denom** = mql_count / cohort_size; **pct_resolved** = resolved_count / cohort_size.

**Sample (2024-09):** cohort_size 1,326, resolved_count 1,318, mql_count 30, current_rate **2.3%**, true_rate **2.3%**, pct_resolved **99.4%**. For that mature month, almost everyone is resolved, so the resolved-only rate and the true rate are the same. **Recent months** (e.g. last 3–6 months) will have lower pct_resolved; the current (resolved-only) rate will then be **higher** than the true (full-cohort) rate until the cohort matures. Running this by month for the last 18 months shows the “inflation” in recent cohorts and how quickly the rate stabilizes.

### Q5. “In limbo” leads (contacted, not MQL, not closed) — how old are they?

For **Provided List (Lead Scoring)** only: leads where `stage_entered_contacting__c` IS NOT NULL, `Stage_Entered_Call_Scheduled__c` IS NULL, `Stage_Entered_Closed__c` IS NULL.

- **Count:** **5,711** leads.
- **Median** days since entering Contacting: **52 days**. **Mean:** **64 days**.
- **Distribution (days since contacting):**

| Bucket | Count |
|--------|--------|
| 0–7 days | 136 |
| 8–14 days | 324 |
| 15–21 days | 724 |
| 22–30 days | 1,026 |
| 31–60 days | 1,438 |
| 61–90 days | 1,090 |
| 91+ days | 973 |

**Implication:** Under a **21-day** “effectively closed” rule, **5,711** leads would be brought into the denominator (they are currently excluded as unresolved). Of these, **1,184** (136+324+724) are ≤21 days; **4,527** are &gt;21 days and would “flip” into the denominator. That is a large one-time denominator increase for this source and would reduce the displayed Contacted→MQL rate until the new logic is the norm.

---

## 4e. Cohort simulation: N-day effective rate vs true rate vs resolved-only rate

Analysis run against **SavvyGTMData.Lead** for **Final_Source__c = 'Provided List (Lead Scoring)'**, cohorts by **month** of `stage_entered_contacting__c` from **2024-08 through 2025-12** (as of 2026-02-06). MQL count uses forward dates only (Stage_Entered_Call_Scheduled__c ≥ stage_entered_contacting__c).

**Cohort simulation table**

| Cohort Month | cohort_size | mql_count | resolved_count | pct_resolved | resolved_only_rate | true_rate | eff_rate_21d | dev_21d | eff_rate_30d | dev_30d | eff_rate_45d | dev_45d | eff_rate_60d | dev_60d |
|--------------|-------------|-----------|----------------|--------------|--------------------|-----------|--------------|---------|--------------|---------|--------------|---------|--------------|---------|
| 2024-08 | 2,244 | 42 | 2,214 | 98.7 | 1.9 | 1.9 | 1.9 | 0 | 1.9 | 0 | 1.9 | 0 | 1.9 | 0 |
| 2024-09 | 1,326 | 28 | 1,318 | 99.4 | 2.1 | 2.1 | 2.1 | 0 | 2.1 | 0 | 2.1 | 0 | 2.1 | 0 |
| 2024-10 | 2,322 | 45 | 2,314 | 99.7 | 1.9 | 1.9 | 1.9 | 0 | 1.9 | 0 | 1.9 | 0 | 1.9 | 0 |
| 2024-11 | 2,595 | 46 | 2,582 | 99.5 | 1.8 | 1.8 | 1.8 | 0 | 1.8 | 0 | 1.8 | 0 | 1.8 | 0 |
| 2024-12 | 1,870 | 53 | 1,849 | 98.9 | 2.9 | 2.8 | 2.8 | 0 | 2.8 | 0 | 2.8 | 0 | 2.8 | 0 |
| 2025-01 | 1,692 | 61 | 1,678 | 99.2 | 3.6 | 3.6 | 3.6 | 0 | 3.6 | 0 | 3.6 | 0 | 3.6 | 0 |
| 2025-02 | 1,241 | 47 | 1,225 | 98.7 | 3.8 | 3.8 | 3.8 | 0 | 3.8 | 0 | 3.8 | 0 | 3.8 | 0 |
| 2025-03 | 1,126 | 26 | 1,116 | 99.1 | 2.3 | 2.3 | 2.3 | 0 | 2.3 | 0 | 2.3 | 0 | 2.3 | 0 |
| 2025-04 | 1,724 | 59 | 1,696 | 98.4 | 3.5 | 3.4 | 3.4 | 0 | 3.4 | 0 | 3.4 | 0 | 3.4 | 0 |
| 2025-05 | 1,633 | 35 | 1,608 | 98.5 | 2.2 | 2.1 | 2.1 | 0 | 2.1 | 0 | 2.1 | 0 | 2.1 | 0 |
| 2025-06 | 685 | 32 | 669 | 97.7 | 4.8 | 4.7 | 4.7 | 0 | 4.7 | 0 | 4.7 | 0 | 4.7 | 0 |
| 2025-07 | 1,593 | 52 | 1,583 | 99.4 | 3.3 | 3.3 | 3.3 | 0 | 3.3 | 0 | 3.3 | 0 | 3.3 | 0 |
| 2025-08 | 2,641 | 61 | 2,612 | 98.9 | 2.3 | 2.3 | 2.3 | 0 | 2.3 | 0 | 2.3 | 0 | 2.3 | 0 |
| 2025-09 | 1,532 | 57 | 1,333 | 87.0 | 4.3 | 3.7 | 3.7 | 0 | 3.7 | 0 | 3.7 | 0 | 3.7 | 0 |
| 2025-10 | 1,726 | 49 | 1,555 | 90.1 | 3.2 | 2.8 | 2.8 | 0 | 2.8 | 0 | 2.8 | 0 | 2.8 | 0 |
| 2025-11 | 2,152 | 38 | 1,117 | 51.9 | 3.4 | 1.8 | 1.8 | 0 | 1.8 | 0 | 1.8 | 0 | 1.8 | 0 |
| 2025-12 | 2,582 | 47 | 1,181 | 45.7 | 4.0 | 1.8 | 1.8 | 0 | 1.8 | 0 | 1.8 | 0 | **3.0** | **1.1** |

*dev_Nd = effective_rate_Nd − true_rate (percentage points).*

**Analysis**

1. **Mature cohorts (6+ months old, pct_resolved &gt; 95%):** All months from 2024-08 through 2025-08 have pct_resolved 97.7%–99.7%. For these, **21d, 30d, and 45d** effective rates match the true rate (dev = 0). **60d** also matches except for the very recent 2025-12 cohort. So for mature cohorts, **21d, 30d, and 45d** are all accurate; the N-day effective rate is a good stand-in for the true rate.

2. **Recent cohorts (2–5 months old, pct_resolved 50–90%):** 2025-09 (87% resolved), 2025-10 (90.1%), 2025-11 (51.9%). For all of these, **eff_rate_21d = eff_rate_30d = eff_rate_45d = true_rate** (dev = 0). So the N-day effective denominator gives a **usable, non-inflated** rate as soon as the cohort is at least 21 (or 30/45) days old — and that rate already equals the eventual true rate. The “early read” is reliable.

3. **Very recent cohorts (0–2 months old, pct_resolved &lt; 50%):** 2025-12 (45.7% resolved). For 21d, 30d, 45d the effective rate still equals the true rate (1.8%); for **60d**, the effective denominator is smaller (many leads haven’t been in Contacting 60 days yet), so eff_rate_60d = 3.0 and dev_60d = 1.1 pp. So **21d, 30d, 45d** are applicable and accurate even for very recent cohorts; **60d** can overstate the rate for the newest cohort until the 60-day window is in the past.

4. **Bottom line (Section 4e):** For Provided List (Lead Scoring), **21d, 30d, and 45d** effective rates **match the true rate** (0 pp deviation) for all 17 months, including young cohorts. The effective rate for young cohorts (1–4 months old) is a **reliable early predictor** of where the true rate will land. **60d** is slightly off for the single very recent month (1.1 pp high). **Recommendation from this simulation:** **21d, 30d, or 45d** all work well for this source; choose among them based on false-negative tolerance (Section 4c: 21d misclassifies 12.3% of converters, 30d/45d fewer).

---

## 4f. Cross-source cutoff validation

Analysis run against **SavvyGTMData.Lead** for the **top 10 sources by contacted volume** (as of 2026-02-06). For each source, only leads with both `stage_entered_contacting__c` and `Stage_Entered_Call_Scheduled__c` where MQL date ≥ Contacting date (forward dates only). **% after Nd** = % of eventual converters who converted **after** N days in Contacting (false-negative rate if we use N-day “effectively closed”).

**Top 10 sources by contacted volume:** Provided List (Lead Scoring), LinkedIn (Self Sourced), Provided List (Marketing), Other, Direct Traffic, Fintrx (Self-Sourced), Events, Recruitment Firm, Job Applications, Re-Engagement.

**Cross-source cutoff summary**

| Source | N contacted | N converted (fwd) | % after 7d | % after 14d | % after 21d | % after 30d | % after 45d | % after 60d | % after 90d |
|--------|-------------|-------------------|------------|------------|------------|------------|------------|------------|------------|
| LinkedIn (Self Sourced) | 22,710 | 1,094 | 24.4 | 16.6 | 13.4 | 11.2 | 8.5 | 6.9 | 4.1 |
| Provided List (Lead Scoring) | 39,205 | 895 | 21.9 | 15.9 | 12.3 | 8.9 | 7.0 | 5.3 | 4.0 |
| Direct Traffic | 287 | 87 | 11.5 | 5.7 | 3.4 | 2.3 | 2.3 | 2.3 | 2.3 |
| Recruitment Firm | 94 | 69 | 65.2 | 58.0 | 56.5 | 55.1 | 52.2 | 47.8 | 42.0 |
| Other | 492 | 37 | 35.1 | 27.0 | 27.0 | 21.6 | 18.9 | 16.2 | 10.8 |
| Events | 185 | 34 | 32.4 | 23.5 | 14.7 | 11.8 | 2.9 | 2.9 | 2.9 |
| Job Applications | 78 | 26 | 50.0 | 46.2 | 46.2 | 42.3 | 42.3 | 42.3 | 42.3 |
| Re-Engagement | 67 | 20 | 15.0 | 15.0 | 15.0 | 15.0 | 15.0 | 15.0 | 15.0 |
| Provided List (Marketing) | 730 | 13 | 38.5 | 30.8 | 15.4 | 0 | 0 | 0 | 0 |
| Fintrx (Self-Sourced) | 256 | 9 | 11.1 | 0 | 0 | 0 | 0 | 0 | 0 |

**Analysis**

1. **21-day cutoff — false-negatives under 5%:** Only **Fintrx (Self-Sourced)** (0% after 21d). **Under 10%:** Fintrx, **Direct Traffic** (3.4% after 21d). Provided List (Lead Scoring) is 12.3% after 21d; LinkedIn 13.4%. So a **single global 21-day** cutoff does **not** keep false-negatives under 5% for the two largest sources (Provided List Lead Scoring, LinkedIn).

2. **30-day cutoff — false-negatives under 5%:** **Fintrx** (0%), **Direct Traffic** (2.3%). **Under 10%:** Fintrx, Direct Traffic, **Provided List (Lead Scoring)** (8.9%), **LinkedIn** (11.2%, just over). So **30 days** gets the two largest sources under 10% but not under 5%.

3. **Sources with very different velocity (&gt;20% converting after 30 days):** **Recruitment Firm** (55.1% after 30d), **Job Applications** (42.3%), **Other** (21.6%), **Re-Engagement** (15%). **Recruitment Firm** and **Job Applications** are extreme — a global 21d or 30d rule would misclassify a majority of their eventual converters. These may need **source-specific cutoffs** or exclusion from the N-day rule.

4. **Bottom line (Section 4f):** A **single global cutoff** does **not** keep false-negatives under 5% for the highest-volume sources (Provided List Lead Scoring 12.3%, LinkedIn 13.4% at 21d). **30 days** brings both under 10%. **Recruitment Firm** and **Job Applications** have &gt;40% converting after 30 days — use a **longer cutoff for those sources** or exclude them from the N-day denominator. **Recommendation:** Use a **global 30-day** cutoff for most sources; optionally apply a **longer cutoff (e.g. 60 or 90 days)** or no N-day rule for **Recruitment Firm** and **Job Applications** so their rates are not understated.

---

## 5. Option: “Effectively closed” at N days for conversion rates only

(Sections 4c, 4e, and 4f: **30 days** is a data-backed default; 21d misclassifies &gt;10% for top sources; Recruitment Firm and Job Applications need longer or source-specific treatment.)

**Proposal:** For **Contacted→MQL conversion rate calculations only**, treat a prospect as **“effectively closed”** (i.e. resolved) if:

- They entered Contacted (`stage_entered_contacting__c` set), and  
- They have **not** become MQL within **21 days** of entering Contacted.

**Intent:**

- **Only** change how the **denominator** (and thus the rate) is computed for Contacted→MQL.
- **Do not** change:
  - Any Salesforce state (no actual close, no disposition change).
  - Other reporting (volumes, pipeline, detail tables, etc.) — they keep using real close dates and real dispositions.
- So: in conversion-rate logic only, “contacted and no MQL by day 21” is treated as a resolved outcome (like closed) for the purpose of computing the rate.

**Possible implementation directions:**

1. **In the view (`vw_funnel_master.sql`):**  
   Add a derived flag, e.g. `effectively_resolved_contacted_21d`, that is true when:
   - `is_contacted = 1`, and  
   - either `is_mql = 1`, or `lead_closed_date IS NOT NULL`, or  
   - `DATE(stage_entered_contacting__c) + 21 < CURRENT_DATE()` and still not MQL (and not actually closed, if you want to avoid double-counting with real closes).  
   Then in **Contacted→MQL only**, use this flag to define an alternative “eligible” denominator (e.g. `eligible_for_contacted_conversions_21d`) and keep the same numerator (`contacted_to_mql_progression`).  
   All other metrics and reports continue to use the existing `eligible_for_contacted_conversions` and real close dates.

2. **In the app layer (`conversion-rates.ts`):**  
   Keep the view as-is and, only for Contacted→MQL, add a separate query (or extra CASE logic) that counts as “resolved” anyone who is contacted and either became MQL, has `lead_closed_date`, or has been in Contacted for more than 21 days without MQL. Again, numerator stays “became MQL”; denominator becomes “resolved by MQL, real close, or 21-day rule.”

**Considerations:**

- **Cutoff choice:** Section 4c shows that at **21 days**, **12.3%** of eventual converters (Provided List Lead Scoring) convert **after** the cutoff — above a 5% false-negative target. At **60 days**, 5.3%; at **90 days**, 4.0%. So **21 days** is aggressive; **30**, **45**, or **60** days better meet a &lt;5% misclassification goal for this source. Recommendation: use **30 or 45 days** as the default cutoff unless business accepts ~12% of converters being “effectively closed” before they convert; re-run Q1 by source (Q3) to validate globally.
- Document clearly in code and in this doc that the N-day rule is **only for Contacted→MQL conversion rate** and does not affect other KPIs or Salesforce.

**Recommended cutoff (from Sections 4e and 4f):**  
- **Section 4e (cohort simulation):** For Provided List (Lead Scoring), **21d, 30d, and 45d** effective rates match the true rate (0 pp deviation) for all 17 months; the N-day rate is a reliable early predictor for young cohorts. **60d** slightly overstates for the very recent month (1.1 pp).  
- **Section 4f (cross-source):** A **single global 21-day** cutoff does **not** keep false-negatives under 5% for the top sources (Provided List Lead Scoring 12.3%, LinkedIn 13.4%). **30 days** brings both under 10%. **Recruitment Firm** and **Job Applications** have &gt;40% converting after 30 days — use a longer cutoff or exclude from the N-day rule.  
- **Final recommendation:** Use a **global 30-day** cutoff for Contacted→MQL “effectively closed” denominator. Optionally apply a **longer cutoff (60 or 90 days)** or no N-day rule for **Recruitment Firm** and **Job Applications** so their rates are not understated. **21 days** is acceptable only if the business accepts ~12% of eventual converters being treated as closed before they convert for the main sources.

**Implementation (where to apply the N-day rule):**

- **Option A — In the view (`vw_funnel_master.sql`):** Add a derived eligibility flag (e.g. `eligible_for_contacted_conversions_21d` or `_30d`) that is 1 when the lead is contacted and either became MQL, has `lead_closed_date`, or has been in Contacted for more than N days without MQL. Use this flag **only** for Contacted→MQL denominator in cohort/period logic; keep existing `eligible_for_contacted_conversions` for all other uses.
- **Option B — In the app layer (`conversion-rates.ts`):** In Contacted→MQL denominator logic only, treat as “resolved” anyone who is contacted and either: became MQL, has `lead_closed_date`, or `DATE(stage_entered_contacting__c) + N <= reference date` with no MQL. Numerator remains `contacted_to_mql_progression`. **Source-performance.ts** and **semantic layer** must use the same denominator logic (see Section 6 implementation notes).

---

## 5a. Edge cases and data quality (from cursor-investigation-questions.md)

### Q10. Late converter (enters Contacting, “effectively closed” at N days, then converts to MQL later)

**Logic:** Once the lead converts to MQL, `contacted_to_mql_progression` = 1 and `eligible_for_contacted_conversions` = 1 (resolved by MQL). So the lead is in **both** numerator and denominator. There is **no undercount**: the rate self-corrects. Under a 21d-effective denominator, the lead would have been excluded from the denominator until they converted; once they convert, they are in denominator (resolved) and in numerator (progression). **Confirmed:** No code path double-counts or drops late converters.

### Q11. “Effectively closed” at N days, then actually closed later (e.g. auto-close at 90+ days)

When the real close happens, `eligible_for_contacted_conversions` becomes 1; if we add `eligible_for_contacted_conversions_21d`, it was already 1 (they were treated as resolved at N days). The lead is counted **once** in the denominator (either via the 21d flag or via the real close). There is **no double-counting**: they appear once in any aggregation. Same row, same cohort — no risk of counting the same lead twice.

### Q12. Unusual statuses (contacted set but not Contacting/MQL/Closed; record type; data inconsistency)

For **Provided List (Lead Scoring)** in Lead table: **1** lead has `stage_entered_contacting__c` set and **ConvertedOpportunityId** set but **Stage_Entered_Call_Scheduled__c** NULL (contacted, converted to opportunity, but no MQL date — e.g. direct conversion path). **5,711** are in “limbo” (contacted, no MQL, not closed). These are the expected categories. The view’s `is_contacted = 1` is `stage_entered_contacting__c IS NOT NULL`; there is no separate status field that would set `is_contacted = 0` while contacting is set. **Conclusion:** Unusual cases are minimal (1 converted-to-opp without MQL); the 21d (or N-day) denominator would include limbo leads after N days and would not pollute other metrics if the new flag is used **only** for Contacted→MQL denominator.

---

## 6. Where Contacted→MQL is used in the codebase (and implementation notes for N-day cutoff)

**Implementation notes (from cursor-investigation-questions Q6–Q9):**

- **Q6. Does `eligible_for_contacted_conversions` feed any other metric?** **No.** It is used only for the **Contacted→MQL** denominator. All references: `vw_funnel_master.sql` (defines it), `conversion-rates.ts` (contacted_denom), `source-performance.ts` (contacted_to_mql_rate), `definitions.ts` (denominatorField), `query-compiler.ts`, `record-detail.ts`, `export-records.ts`, and docs. Adding `eligible_for_contacted_conversions_21d` (or N-day) and using it **only** for Contacted→MQL has **zero side effects** on MQL→SQL, SQL→SQO, SQO→Joined, or other metrics.

- **Q7. Is the Contacted→MQL denominator shared with other rates?** **No.** In `conversion-rates.ts`, each conversion has its own `SUM(CASE ... eligible_for_* ...)`. Contacted→MQL uses `eligible_for_contacted_conversions`; MQL→SQL uses `eligible_for_mql_conversions`, etc. The Contacted→MQL denominator can be overridden (e.g. use `eligible_for_contacted_conversions_21d` or inline CASE for “resolved or &gt;N days”) **without touching** other rates.

- **Q8. How does source-performance compute Contacted→MQL?** It uses the **same** `eligible_for_contacted_conversions` in a `SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions))`. So **scorecard** (conversion-rates.ts) and **source performance** (source-performance.ts) must **both** use the same denominator logic. If the scorecard uses a 21d (or N-day) rule, source-performance must use it too, or the numbers will disagree.

- **Q9. Semantic layer update?** **Yes.** `definitions.ts` has `CONVERSION_METRICS.contacted_to_mql_rate` with `denominatorField: 'eligible_for_contacted_conversions'` and SQL that references `v.eligible_for_contacted_conversions`. To apply the N-day rule in NL/semantic queries, either: (1) add a new field in the view (e.g. `eligible_for_contacted_conversions_21d`) and set `denominatorField` to that in definitions (and update the SQL fragment), or (2) change the metric’s SQL in definitions to an expression that implements “resolved or &gt;N days” without a new view column. **query-compiler.ts** uses this definition to build BQ; any change to the denominator field or SQL must be reflected there so Explore/saved reports stay consistent with the dashboard.

### 6.1 Core view and types

| Location | Usage |
|----------|--------|
| **views/vw_funnel_master.sql** | Defines `eligible_for_contacted_conversions`, `contacted_to_mql_progression`, cohort fields, and stage/date fields used for Contacted→MQL. |
| **src/types/dashboard.ts** | `ConversionRates`, `ConversionRateResult`, `ConversionRatesResponse`: `contactedToMql` and `contactedToMqlRate`. |
| **src/types/bigquery-raw.ts** | `contacted_to_mql_numer`, `contacted_to_mql_denom`, `contacted_to_mql_rate` (raw BQ result types). |
| **src/types/record-detail.ts**, **src/types/saved-reports.ts** | `contactedToMql` / progression and feature flags for conversion rate cards. |

### 6.2 Queries and API

| Location | Usage |
|----------|--------|
| **src/lib/queries/conversion-rates.ts** | Main logic: cohort and period Contacted→MQL numerator/denominator, scorecard and trend; uses `eligible_for_contacted_conversions` and `contacted_to_mql_progression` (and period-resolved variants). |
| **src/lib/queries/source-performance.ts** | Contacted→MQL rate by source (uses same progression/eligibility or equivalent logic). |
| **src/lib/queries/record-detail.ts** | Selects `contacted_to_mql_progression` for detail view. |
| **src/lib/queries/export-records.ts** | Exports progression and eligibility for Contacted→MQL analysis. |
| **src/app/api/dashboard/export-sheets/route.ts** | Sends Contacted→MQL rate to export. |

### 6.3 Semantic layer (`src/lib/semantic-layer/`)

| Location | Usage |
|----------|--------|
| **definitions.ts** | `CONVERSION_METRICS.contacted_to_mql_rate`: name, description, `cohortDateField: 'stage_entered_contacting__c'`, `numeratorField: 'contacted_to_mql_progression'`, `denominatorField: 'eligible_for_contacted_conversions'`, SQL fragment for cohort rate. |
| **query-compiler.ts** | Builds BQ for `contacted_to_mql_rate` (e.g. `buildConversionSql(contactedToMqlRate)`), uses progression/eligibility. |
| **query-templates.ts** | Templates that include `contacted_to_mql_rate` in selected metrics. |
| **__tests__/validation-examples.ts** | `contacted_to_mql_rate` marked as covered, cohort field `stage_entered_contacting__c`. |

### 6.4 UI and export

| Location | Usage |
|----------|--------|
| **src/app/dashboard/page.tsx** | Fetches conversion rates; toggles Contacted→MQL card; passes `contactedToMql` in feature selection. |
| **src/components/dashboard/ConversionRateCards.tsx** | Renders Contacted→MQL rate card. |
| **src/components/dashboard/ConversionTrendChart.tsx** | Trend series “Contacted→MQL” and color. |
| **src/components/dashboard/ChannelPerformanceTable.tsx**, **SourcePerformanceTable.tsx** | Contacted→MQL rate column and sort. |
| **src/components/dashboard/SaveReportModal.tsx** | Checkbox for including Contacted→MQL in saved reports. |
| **src/lib/sheets/google-sheets-exporter.ts** | Contacted→MQL rate and formulas in sheet export. |
| **src/config/theme.ts** | Chart color for Contacted→MQL. |

### 6.5 Docs (`docs/` and `docs/semantic_layer/`)

| Location | Usage |
|----------|--------|
| **docs/CALCULATIONS.md** | Contacted→MQL rate formulas (period and cohort), eligibility and progression logic, SQL examples. |
| **docs/ARCHITECTURE.md** | Progression flags, Contacted→MQL numerator/denominator, lead-level metrics. |
| **docs/semantic_layer/PHASE_1_VALIDATION_RESULTS.md** | `contacted_to_mql_progression` and `eligible_for_contacted_conversions` as backing fields for `contacted_to_mql_rate`. |
| **docs/semantic_layer/semantic_layer_corrections.md** | `contacted_to_mql_rate` listed as supported; Contacted→MQL velocity and full-metric examples. |
| **docs/semantic_layer/semantic_layer_admin_questions.md** | Stage-to-stage combinations including Contacted→MQL. |
| **docs/SEMANTIC_LAYER_REVIEW_GUIDE.md** | “Test Contacted to MQL Rate” and example SQL. |
| **docs/GROUND-TRUTH.md** | Expected Contacted→MQL rates and validation queries. |
| **docs/FILTER-MATRIX.md**, **docs/GLOSSARY.md** | Lead-level metrics (Contacted, MQL) and conversion rates. |

### 6.6 Other

| Location | Usage |
|----------|--------|
| **.cursorrules** | Contacted→MQL numerator/denominator and feature flag. |
| **Coach_AI_*.md**, **README.md**, **campaign_*.md**, **re-engagement-record-type.md** | References to conversion rates, Contacted→MQL, and cohort logic. |

---

## 7. Summary

- **Contacted→MQL** uses **`stage_entered_contacting__c`**; cohort denominator is **resolved** contacted leads (MQL or closed); numerator is **contacted_to_mql_progression**.
- **Auto-Closed by Operations** typically happens long after 90 days (all-source median 111 days; ~76% close in 91+ days), so many contacted leads stay out of the cohort denominator for a long time.
- **Source-specific (Provided List (Lead Scoring)):** Created-only leads auto-close very late (median 555 days). Contacting-no-MQL leads: median 103 days to close; 22.9% close in 0–21 days, 70.5% in 91+ days. Last-stage-to-close median 188 days. **Provided Lead List** exact match on Lead had 0 rows; confirm source value in Salesforce/dashboard and re-run the same analyses if needed.
- **Contacting → MQL (time in stage):** For **Provided List (Lead Scoring)**, average **15.3 days**, **median 1 day**, **stddev 55.1 days** (895 leads with forward dates; min 0, max 573). Distribution is right-skewed; a **21-day** cut-off for “effectively closed” in conversion rate logic is conservative relative to the spread and keeps fast converters in the numerator. **All "Provided Lead List"** (LeadSource): **871** leads with both dates (forward only), avg **15.9 days**, stddev **56.2 days**, median 1 day (min 0, max 573). Use for cut-off; 21-day "effectively closed" is conservative.
- **Cutoff sensitivity (4c, 4e, 4f):** **21d** misclassifies 12.3% (Provided List Lead Scoring) and 13.4% (LinkedIn). **Section 4e:** 21d/30d/45d effective rate = true rate (0 pp dev) for all cohort months; N-day rate is a reliable early predictor. **Section 4f:** Use a **global 30-day** cutoff; **Recruitment Firm** and **Job Applications** (&gt;40% after 30d) need longer cutoff or exclusion from N-day rule.
- **In limbo (4d):** **5,711** leads (Provided List Lead Scoring) are contacted, not MQL, not closed; median 52 days since contacting. Under an N-day rule, 4,527 of these (&gt;21d) would join the denominator in one shot.
- **Edge cases (5a):** Late converters self-correct (in both num and denom); effectively-closed-then-actually-closed has no double-count; unusual statuses are minimal (1 converted-to-opp without MQL).
- **Implementation:** `eligible_for_contacted_conversions` feeds **only** Contacted→MQL. Override only the Contacted→MQL denominator in **conversion-rates.ts** and **source-performance.ts** (same logic in both), and in **definitions.ts** / **query-compiler.ts** if semantic layer should use the N-day rule.
- Contacted→MQL is used in **conversion-rates.ts**, **source-performance.ts**, semantic layer (**definitions.ts**, **query-compiler.ts**, **query-templates.ts**), dashboard UI, exports, and in **docs/** and **docs/semantic_layer/** as above; any change to the rate definition should be updated in those places and in this doc.

---

## 8. Campaign Visibility Fix

### 8.1 Problem

When leads are added to a scored list campaign (e.g. "Scored List January 2026"), they become **CampaignMembers** in Salesforce. The funnel view derives campaign from `COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)` only. For that campaign:

- `Lead.Campaign__c` = empty for all 2,621 leads  
- `Opportunity.CampaignId` = set for only the 12 that converted  

So the dashboard saw only 12 of 2,621 campaign members. Leads can be members of **multiple** campaigns; the design must allow filtering by **any** campaign a lead belongs to, without deduplicating to a single campaign per lead.

**Experimentation tags are deprecated** — Step 4 (experimentation tag investigation) in the plan was skipped. Going forward, everything is campaigns.

### 8.2 Findings (Phase 1)

- **CampaignMember in BigQuery:** **CampaignMember is now synced** to `SavvyGTMData.CampaignMember` (as of 2026-02-07). ~10,945 rows, 10,847 distinct leads, 24 campaigns. The placeholder CTE in the view was replaced with the real aggregation.
- **View grain:** One row per `primary_key` (99,918 in Tableau_Views.vw_funnel_master). Campaign in the view is single `Campaign_Id__c` (COALESCE Opp/Lead) and `Campaign_Name__c` from a join to Campaign; **all_campaigns** (ARRAY&lt;STRUCT&lt;id STRING, name STRING&gt;&gt;) is now populated from CampaignMember for every lead with memberships. Dashboard filters use `v.Campaign_Id__c IN UNNEST(@campaigns) OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id IN UNNEST(@campaigns)) > 0`. Filter options include campaigns that appear in CampaignMember.

### 8.3 Design: Option D (array, no deduplication)

- **Option D:** Add **all** campaign memberships as an array. No deduplication to a single campaign per lead — every campaign a lead belongs to is preserved and queryable.
- **View:** New CTE **Campaign_Member_Agg** reads `SavvyGTMData.CampaignMember`, aggregates by LeadId, and produces `all_campaigns` = `ARRAY_AGG(DISTINCT STRUCT(CampaignId AS id, Campaign.Name AS name) …)`. This is LEFT JOINed to the lead side in Combined (on `LeadId = Full_prospect_id__c`). The column `all_campaigns` is carried through With_Channel_Mapping → With_SGA_Lookup → With_Campaign_Name → Final. Existing `Campaign_Id__c` and `Campaign_Name__c` are unchanged.
- **Filter logic:** Campaign filter matches a row if **either** `v.Campaign_Id__c` is in the selected list **or** any element of `v.all_campaigns` has `id` in the selected list:  
  `(v.Campaign_Id__c IN UNNEST(@campaigns) OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id IN (SELECT * FROM UNNEST(@campaigns))) > 0)`  
  Same idea for single-campaign filters: `(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)`.
- **Filter options:** Campaigns list extended so campaigns that appear in CampaignMember are included:  
  `OR EXISTS (SELECT 1 FROM SavvyGTMData.CampaignMember cm WHERE cm.CampaignId = c.Id)`.

### 8.4 Implementation (done)

| Location | Change |
|----------|--------|
| **views/vw_funnel_master.sql** | Added CTE `Campaign_Member_Agg` (aggregate CampaignMember by LeadId → `all_campaigns`); LEFT JOIN in Combined; pass `all_campaigns` through to Final. |
| **src/lib/utils/filter-helpers.ts** | Campaign multi-select: match `Campaign_Id__c` OR any `all_campaigns[].id` in selected list. |
| **src/lib/queries/conversion-rates.ts** | Single-campaign condition: match `Campaign_Id__c` OR any `all_campaigns[].id` = @campaignId. |
| **src/lib/queries/source-performance.ts** | Same single-campaign condition. |
| **src/lib/queries/funnel-metrics.ts** | Same single-campaign condition. |
| **src/lib/queries/detail-records.ts** | Same single-campaign condition. |
| **src/lib/queries/filter-options.ts** | Include campaigns that exist in CampaignMember in the dropdown. |
| **src/types/record-detail.ts** | Added `all_campaigns` (raw) and `allCampaigns` (API) for record detail. |
| **src/lib/queries/record-detail.ts** | Select and map `all_campaigns` → `allCampaigns`. |

### 8.5 Validation (after CampaignMember is in BQ)

- Deploy `vw_funnel_master` to BigQuery (dashboard uses `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`); confirm no errors.
- For a campaign that has members only via CampaignMember (e.g. Scored List January 2026): filter by that campaign and confirm row count ≥ Campaign.NumberOfLeads (or CampaignMember count for that CampaignId).
- For a lead in multiple campaigns: filter by each campaign and confirm the same lead appears in each filtered set.
- Filter options: confirm the campaign appears in the dropdown and that selecting it returns the expected members.

### 8.6 Implementation complete (2026-02-07)

- **CampaignMember** synced to `SavvyGTMData.CampaignMember`. Placeholder CTE in `views/vw_funnel_master.sql` replaced with real aggregation: read CampaignMember + Campaign (name), filter `IsDeleted = FALSE` and `LeadId`/`CampaignId` NOT NULL, subquery DISTINCT (LeadId, CampaignId, Name), GROUP BY LeadId with `ARRAY_AGG(STRUCT(CampaignId AS id, CampaignName AS name) ORDER BY CampaignId)` → **all_campaigns**. Join: **Campaign_Member_Agg.LeadId = l.Full_prospect_id__c**. Output: **LeadId**, **all_campaigns** (ARRAY&lt;STRUCT&lt;id STRING, name STRING&gt;&gt;). No app code changes; filter-helpers and all query files already handle `all_campaigns`.
- **Validation:** Run against **Tableau_Views.vw_funnel_master** (FULL_TABLE). After **redeploying** the updated view, run all 7 validation queries and paste results below.

**Validation results (run after redeploy):**

| Check | Query / expectation | Result (pre-redeploy) | Result (post-redeploy) |
|-------|----------------------|------------------------|-----------------------------------|
| V1 Row count | total_rows unchanged | 99,918 | **99,918** ✓ |
| V2 Scored List Jan 2026 | jan_members ~2,621 | 0 (placeholder) | **2,621** ✓ |
| V3 Scored List Feb 2026 | feb_members ~2,492 | 0 (placeholder) | **2,492** ✓ |
| V4 Campaign_Id__c | cnt = 12 for Jan campaign | 12 | **12** ✓ |
| V5 Oct 2025 cohort rate | numer/denom/rate unchanged | numer=215, denom=5362, rate≈4.01% | **numer=215, denom=5362, rate≈4.01%** ✓ |
| V6 Multi-campaign lead | all_campaigns has 2+ entries | all_campaigns=[] (placeholder) | **all_campaigns has 2 entries** (Widgets Webinar, Customer Conference - Email Invite) ✓ |
| V7 Coverage | has_campaigns ~10,847 | has_campaigns=0, no_campaigns=99,918 | **has_campaigns=10,847, no_campaigns=89,071, total=99,918** ✓ |

*All 7 validations passed after redeploy (2026-02-07). Pre-redeploy results above were from the deployed view (still with placeholder). After deploy of the updated `vw_funnel_master` to Tableau_Views, re-run V1–V7 and fill the “post-redeploy” column.*
