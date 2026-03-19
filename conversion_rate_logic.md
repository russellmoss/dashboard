# Cohorted Conversion Rate Logic

> Reference document for Finance, Analytics, and LLM agents building views that replicate the Savvy Wealth funnel conversion rate methodology.

---

## 1. Overview

The Funnel Performance & Efficiency dashboard calculates **cohorted conversion rates** across four funnel stages:

| Stage Transition | Cohort Date (denominator anchor) | What it measures |
|---|---|---|
| Contacted → MQL | `stage_entered_contacting__c` | Of leads contacted in a period, what % became MQL? |
| MQL → SQL | `mql_stage_entered_ts` | Of leads that became MQL in a period, what % converted to SQL? |
| SQL → SQO | `converted_date_raw` | Of SQLs created in a period, what % became SQO? |
| SQO → Joined | `Date_Became_SQO__c` | Of SQOs created in a period, what % joined? |

The key idea: **every record is bucketed into a cohort by when it entered a stage, not by when it left that stage.** This tells you how efficient the funnel was at converting a given cohort, regardless of how long conversion took.

---

## 2. Cohort = Preceding Event Date

Each conversion rate cohorts records back to the **preceding event** — the date they entered the stage being measured, not the date they progressed or closed.

**Example:** A lead enters Contacting on January 15 and becomes MQL on March 2. For the Contacted → MQL rate, this lead belongs to the **January cohort** (when it was contacted), not March (when it converted). This means:

- January's conversion rate gets credit for the progression
- The rate reflects "how well did January's contacted leads convert?" — which is the efficiency question
- Conversion can happen at any point in the future; there is no time-bound cutoff on when the numerator event must occur

This logic applies to every stage transition. MQL → SQL cohorts by `mql_stage_entered_ts`, SQL → SQO cohorts by `converted_date_raw` (the lead conversion / opportunity creation date), and SQO → Joined cohorts by `Date_Became_SQO__c`.

---

## 3. Resolved Records Only (Denominators)

Cohorted rates **only include resolved records** in the denominator. A record is "resolved" when it has reached a terminal outcome: either it progressed to the next stage, or it was closed/lost.

This is critical. If you included open/in-flight records in the denominator, rates would appear artificially low for recent periods (because many leads are still being worked). By limiting to resolved records, the rate always represents true efficiency — "of leads that have reached an outcome, what % was the good outcome?"

### Eligibility Flags (Denominators)

These are pre-calculated in `vw_funnel_master`:

**Contacted → MQL** (`eligible_for_contacted_conversions_30d`):
```sql
is_contacted = 1 AND (
  is_mql = 1                           -- Progressed to MQL (good outcome)
  OR lead_closed_date IS NOT NULL       -- Closed as a lead (bad outcome)
  OR (                                  -- 30-day effective close (see Section 5)
    mql_stage_entered_ts IS NULL
    AND lead_closed_date IS NULL
    AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE()
  )
)
```

**MQL → SQL** (`eligible_for_mql_conversions`):
```sql
is_mql = 1 AND (
  is_sql = 1                            -- Converted to SQL (good outcome)
  OR lead_closed_date IS NOT NULL        -- Closed as a lead (bad outcome)
)
```

**SQL → SQO** (`eligible_for_sql_conversions`):
```sql
-- Once a lead converts, it becomes an Opportunity — outcomes are now at opp level
is_sql = 1 AND (
  LOWER(SQO_raw) = 'yes'                -- Became SQO (good outcome)
  OR StageName = 'Closed Lost'           -- Closed lost on the opportunity (bad outcome)
)
-- Also includes direct opportunities (no linked lead) that became SQO
```

**SQO → Joined** (`eligible_for_sqo_conversions`):
```sql
LOWER(SQO_raw) = 'yes' AND (
  advisor_join_date__c IS NOT NULL OR StageName = 'Joined'  -- Joined (good outcome)
  OR StageName = 'Closed Lost'                               -- Closed lost (bad outcome)
)
```

### Progression Flags (Numerators)

These count the "good outcome" — records that actually progressed:

| Flag | Logic |
|---|---|
| `contacted_to_mql_progression` | `is_contacted = 1 AND is_mql = 1 AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)` |
| `mql_to_sql_progression` | `is_mql = 1 AND is_sql = 1` |
| `sql_to_sqo_progression` | `is_sql = 1 AND LOWER(SQO_raw) = 'yes'` |
| `sqo_to_joined_progression` | `LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')` |

### The Formula

```
Conversion Rate = SUM(progression_flag) / SUM(eligibility_flag)
```

Because both flags are 0 or 1, this gives you: count of progressions / count of resolved records.

---

## 4. FilterDate and Lead Recycling

### The Problem

Leads can be **recycled** — a lead is contacted, eventually closed, then later re-engaged and put back into the funnel. Without special handling, a recycled lead's original creation date would bucket it into a stale historical cohort, distorting those old rates.

### The Solution: FilterDate

`FilterDate` is calculated as the most recent of three timestamps:

```sql
FilterDate = GREATEST(
  IFNULL(CreatedDate,                    '1900-01-01'),
  IFNULL(stage_entered_new__c,           '1900-01-01'),   -- Nurture stage entry
  IFNULL(stage_entered_contacting__c,    '1900-01-01')    -- Contacting stage entry
)
```

This captures when a lead was **most recently activated**. A lead created in January 2025 that was recycled and re-contacted in October 2025 gets a FilterDate of October 2025.

### How FilterDate Prevents Double-Counting

The `contacted_to_mql_progression` flag includes a guard:

```sql
AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)
```

This means: only count an MQL conversion as a "progression" if the MQL date is on or after the most recent activation. If a lead was MQL'd back in 2024, recycled in 2025, and is now being worked again — that old MQL doesn't count as a progression for the new cohort. The lead needs to re-qualify through the funnel.

---

## 5. The 30-Day Effective Close (Contacted → MQL Only)

### The Problem

Many contacted leads sit in limbo — never formally closed by the SGA, but also clearly not going to convert. Without intervention, these leads never enter the denominator, making it impossible to calculate a meaningful Contacted → MQL rate for recent periods.

### The Dashboard Solution

The dashboard applies a **30-day effective close**: any contacted lead that has been open for 30+ days with no progression to MQL and no formal close is treated as resolved (and implicitly as a non-conversion) for reporting purposes.

```sql
eligible_for_contacted_conversions_30d = 1 WHEN:
  is_contacted = 1 AND (
    is_mql = 1                                              -- Actually converted
    OR lead_closed_date IS NOT NULL                         -- Actually closed
    OR (
      mql_stage_entered_ts IS NULL                          -- Never became MQL
      AND lead_closed_date IS NULL                          -- Never closed
      AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE()  -- 30+ days old
    )
  )
```

**Why 30 days?** The Contacted → MQL transition is fast when it works — typically days, not months. Waiting for formal closure (which may never come) delays signal. 30 days gives enough buffer for legitimate slow conversions while surfacing rate signal within the same quarter.

**Why only Contacted → MQL?** Later stages (MQL → SQL, SQL → SQO, SQO → Joined) have longer natural cycles and are more reliably closed by the team. The 30-day rule is not applied to those stages; they wait for actual resolution events.

> **Note:** The view also contains `eligible_for_contacted_conversions` (without the `_30d` suffix) which is the strict version — only truly resolved records. The dashboard uses the `_30d` variant for faster signal.

---

## 6. Self-Sourced Leads and Provided Lead Lists — 90-Day Auto-Close

### Salesforce Behavior

Leads from self-sourced channels (LinkedIn Self-Sourced, FinTrx Self-Sourced) and provided lead lists are **auto-closed after 90 days** in Salesforce if they haven't progressed beyond Created or Contacted to MQL. This is an operational rule — these are lower-intent sources where prolonged outreach has diminishing returns.

When these leads are auto-closed, they receive a `lead_closed_date` and enter the denominator naturally through the standard eligibility logic (`lead_closed_date IS NOT NULL`).

### Dashboard Acceleration

The dashboard's 30-day effective close (Section 5) kicks in **before** the 90-day Salesforce auto-close. This means:

- **Days 0–30:** Lead is open, not in the denominator (in-flight)
- **Days 30–90:** Lead enters the dashboard denominator via the 30-day rule, counted as a non-conversion
- **Day 90:** Salesforce auto-closes the lead, which aligns with the dashboard's already-resolved treatment

This gives the dashboard approximately **60 days of earlier signal** compared to waiting for the Salesforce auto-close, which is critical for in-quarter decision-making.

### Channel Mapping

In reporting views, self-sourced leads are mapped to the "Outbound" channel:

```sql
WHEN Original_source = 'LinkedIn (Self Sourced)' THEN 'Outbound'
WHEN Original_source = 'Fintrx (Self-Sourced)' THEN 'Outbound'
```

They follow the same conversion rate logic as all other sources — no special treatment in the math itself, only in the operational auto-close policy that feeds the data.

---

## 7. Why Rates Can Exceed 100% Without Progression Flagging

### The Problem

If you calculate conversion rates naively — "SQOs created this month / SQLs created this month" — the numerator and denominator are **different populations**. The SQOs that became qualified in November may have been created as SQLs back in September. Meanwhile, November's SQLs might not become SQOs until January. You're dividing unrelated groups, and the rate can easily blow past 100%.

This is called **period mode** and it answers "what activity happened this month?" — useful for operational snapshots, but misleading for efficiency analysis.

### Real Example: Re-Engagement Channel, November 2025

Using actual data from `vw_funnel_master` (last 180 days), here's what happened with Re-Engagement source in November 2025:

| Metric | Count |
|---|---|
| SQLs created in Nov 2025 | 5 |
| SQOs created in Nov 2025 | 12 |
| **Naive SQL → SQO rate** | **240%** |

Where did those 12 SQOs come from?
- **8 were direct opportunities** — no lead record at all, entered as opportunities directly (re-engaged advisors who already had prior relationships with Savvy)
- **3 had SQL conversion in a prior month** — they converted to SQL in October but didn't become SQO until November
- **1 had SQL conversion in November** — the only one where both events happened in the same month

The 240% rate is mathematically correct but operationally meaningless. You can't convert 5 SQLs into 12 SQOs — the SQOs came from a completely different set of records.

### Which Channels Skip Funnel Steps (and Why)

Not all leads enter at the top of the funnel. Certain channels and sources routinely skip stages because of how the relationship originates. Here's what the last 180 days of data shows:

**Re-Engagement** (37 SQOs total):
- 46% were direct opportunities (no linked lead record) — these are advisors who previously went through the funnel, churned or went cold, and are now re-engaged. They skip straight to an opportunity.
- 89% skipped the Contacted stage, 65% skipped MQL entirely
- This is the most extreme step-skipper because re-engaged advisors have already been through the funnel once

**Recruitment Firm** (28 SQOs total, formerly 43 over 180 days):
- 71% skipped the Contacted stage — recruitment firms bring pre-vetted advisors who enter as MQLs, bypassing cold outreach
- Nearly all go through MQL and SQL stages (only 1 skipped MQL)
- The skip pattern is Contacted-only: recruiters do the contacting, so Savvy's Contacted stage is irrelevant

**Advisor Referral** (5 SQOs total):
- 60% skipped Contacted — warm introductions from existing advisors bypass cold outreach
- All went through MQL and SQL normally after that
- Small volume but consistently skips the top of the funnel

**Job Applications** (8 SQOs total):
- 50% skipped Contacted — these are inbound applicants who self-identify as interested
- Most follow the normal funnel from MQL onward

**Direct Traffic / Marketing** (14 SQOs total):
- 36% skipped Contacted — inbound website visitors who fill out forms may jump to MQL directly
- None skipped MQL or SQL — once in the funnel, they follow the standard path

**LinkedIn Self-Sourced / Outbound** (93 SQOs total):
- Only 9% skipped Contacted — this is the standard outbound motion, most leads go through every stage
- Lowest skip rate of any major channel, as expected for cold outreach

**Events** (22 SQOs total):
- 0% skipped any stage — event leads consistently go through the full funnel
- The cleanest channel for conversion rate analysis

### More Examples of >100% Naive Rates (Real Data)

| Channel | Source | Month | SQLs Created | SQOs Created | Naive Rate |
|---|---|---|---|---|---|
| Re-Engagement | Re-Engagement | Nov 2025 | 5 | 12 | **240%** |
| Outbound + Marketing | Events | Nov 2025 | 2 | 3 | **150%** |
| Recruitment Firm | Recruitment Firm | Mar 2026 | 3 | 4 | **133%** |
| Recruitment Firm | Recruitment Firm | Dec 2025 | 4 | 5 | **125%** |
| Marketing | Direct Traffic | Oct 2025 | 7 | 8 | **114%** |

### How Progression Flagging Prevents This

The cohorted approach (Section 2) eliminates >100% rates by construction:

1. **Same population in numerator and denominator:** The denominator is "SQLs created in October that have resolved." The numerator is "of those same SQLs, how many became SQO?" You can never have more progressions than eligible records.

2. **Progression flags enforce the relationship:** `sql_to_sqo_progression = 1` only when `is_sql = 1 AND LOWER(SQO_raw) = 'yes'` — the record must have been an SQL to count as a progression. Direct opportunities that were never SQLs don't inflate the numerator.

3. **Eligibility flags control the denominator:** `eligible_for_sql_conversions = 1` only when the SQL has either become SQO or been Closed Lost. Open SQLs don't drag the rate down, and non-SQL records don't appear at all.

4. **Cohort date anchoring:** Each record is bucketed by when it entered the stage being measured (`converted_date_raw` for SQL → SQO). A record can only appear in one month's cohort, never in multiple.

The result: cohorted rates are always between 0% and 100%, and they answer the meaningful question — "of the SQLs we created in this period, what fraction converted?"

---

## 8. Putting It All Together — Worked Example

Consider Q1 2026 Contacted → MQL rate for a specific SGA:

1. **Identify the cohort:** All leads where `stage_entered_contacting__c` falls within Q1 2026
2. **Apply filters:** Channel, source, SGA, SGM, etc.
3. **Count the denominator:** `SUM(eligible_for_contacted_conversions_30d)` — leads that either became MQL, were closed, or have been open 30+ days
4. **Count the numerator:** `SUM(contacted_to_mql_progression)` — leads that became MQL (with `mql_stage_entered_ts >= FilterDate` guard for recycling)
5. **Calculate:** numerator / denominator = conversion rate

If the SGA contacted 100 leads in Q1:
- 15 became MQL → numerator = 15, in denominator
- 40 were closed by SGA → in denominator
- 35 are 30+ days old with no action → in denominator (via 30-day rule)
- 10 are still being worked (< 30 days old) → **excluded** from denominator

Rate = 15 / (15 + 40 + 35) = 15 / 90 = **16.7%**

The 10 in-flight leads are excluded so they don't drag the rate down prematurely. As they resolve (convert, close, or age past 30 days), they'll enter the denominator and the rate will adjust.

---

## 9. Key Fields Reference

| Field | Source | Description |
|---|---|---|
| `FilterDate` | Calculated | `GREATEST(CreatedDate, stage_entered_new__c, stage_entered_contacting__c)` — most recent activation |
| `stage_entered_contacting__c` | Lead | Timestamp when lead entered Contacting stage |
| `mql_stage_entered_ts` | Lead | Timestamp when lead became MQL |
| `converted_date_raw` | Lead | Timestamp of lead-to-opportunity conversion (SQL) |
| `Date_Became_SQO__c` | Opportunity | Timestamp when opportunity was qualified as SQO |
| `advisor_join_date__c` | Opportunity | Timestamp when advisor joined |
| `lead_closed_date` | Lead | Timestamp when lead was closed (if closed as lead) |
| `StageName` | Opportunity | Current opportunity stage (e.g., 'Closed Lost', 'Joined') |
| `SQO_raw` | Opportunity | Whether opportunity is SQO qualified ('yes'/'no') |
| `is_contacted` / `is_mql` / `is_sql` / `is_sqo` / `is_joined` | Calculated | Binary stage-reached flags |

---

## 10. Building Your Own View — Checklist

If you are building a view or report that replicates this logic:

1. **Cohort by the preceding event date**, not the conversion date
2. **Only include resolved records** in the denominator — never count open/in-flight records
3. **For Contacted → MQL**, apply the 30-day effective close to get timely signal
4. **Guard against recycling** — ensure progression flags check that the conversion date is on or after FilterDate
5. **Use `SAFE_DIVIDE`** (BigQuery) to handle zero denominators gracefully
6. **Dedup at the opportunity level** if your view joins leads to opportunities — use `opp_row_num = 1` or equivalent to avoid double-counting
7. **Filter to Recruiting record type** (`recordtypeid = '012Dn000000mrO3IAI'`) for SQO and Joined metrics — exclude non-recruiting opportunities

---

## 11. Why This Approach?

Traditional funnel rates often use **period mode**: "how many MQLs happened this month / how many contacts happened this month." This is simple but misleading — the MQLs this month may have been contacted months ago, so you're dividing unrelated populations.

Cohorted rates answer the real question: **"Of the leads we invested in during period X, what return did we get?"** This is the efficiency question that matters for:

- **Forecasting:** If we contact 200 leads, how many MQLs should we expect?
- **SGA evaluation:** Which SGAs convert their assigned leads most effectively?
- **Channel ROI:** Which lead sources yield the best funnel efficiency?
- **Capacity planning:** How many leads do we need at each stage to hit targets?

The resolved-only denominator, 30-day effective close, and recycling guards are all in service of making these rates **accurate and timely** — not inflated by open records, not distorted by recycled leads, and not delayed by waiting for formal Salesforce disposition.
