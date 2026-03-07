# Closed-Lost SQO Firm Change Analysis — Data Exploration & Execution Plan

## Objective

Identify all Savvy Wealth opportunities that reached SQO status and were subsequently closed-lost, then determine whether those financial advisors changed firms after being closed-lost. Produce a report showing the advisor, their closed-lost date, the new firm they moved to, and how many months elapsed between closed-lost and the firm change.

---

## Phase 1: Data Discovery

Run these queries to understand the schema and resolve ambiguities before building the final report.

### 1.1 — Understand the Closed-Lost Field Differences

We have two fields that could indicate closed-lost status. We need to understand the difference.

```sql
-- Query 1A: Compare Closed_Lost_Checkbox__c vs IsClosed
-- Goal: Understand if these are redundant or capture different things
SELECT
  Closed_Lost_Checkbox__c,
  IsClosed,
  StageName,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
GROUP BY 1, 2, 3
ORDER BY cnt DESC;
```

```sql
-- Query 1B: Are there records where IsClosed = TRUE but Closed_Lost_Checkbox__c = FALSE?
-- These could be Closed-Won deals. We need to confirm.
SELECT
  Closed_Lost_Checkbox__c,
  IsClosed,
  IsWon,
  StageName,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsClosed = TRUE
GROUP BY 1, 2, 3, 4
ORDER BY cnt DESC;
```

**Expected finding:** `IsClosed = TRUE` likely covers both won and lost. `Closed_Lost_Checkbox__c = TRUE` should isolate only closed-lost. Confirm this before proceeding.

**Decision:** Use `Closed_Lost_Checkbox__c = TRUE` as the closed-lost filter (more specific). If it looks incomplete or unreliable, fall back to `IsClosed = TRUE AND IsWon = FALSE`.

### 1.2 — Understand the SQO Field

```sql
-- Query 2A: Confirm SQL__c is the SQO indicator
SELECT
  SQL__c,
  Date_Became_SQO__c,
  COUNT(*) AS cnt,
  COUNTIF(Date_Became_SQO__c IS NOT NULL) AS has_sqo_date
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
GROUP BY 1, 2
ORDER BY cnt DESC
LIMIT 50;
```

```sql
-- Query 2B: Simpler — just confirm SQL__c = TRUE aligns with Date_Became_SQO__c being populated
SELECT
  SQL__c,
  COUNTIF(Date_Became_SQO__c IS NOT NULL) AS has_sqo_date,
  COUNTIF(Date_Became_SQO__c IS NULL) AS no_sqo_date,
  COUNT(*) AS total
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
GROUP BY 1;
```

**Decision:** Use `SQL__c = TRUE` as the SQO filter. If `Date_Became_SQO__c` is more reliably populated, use `Date_Became_SQO__c IS NOT NULL` instead.

### 1.3 — Identify the Closed-Lost SQO Population

```sql
-- Query 3: Count of closed-lost SQOs with CRD numbers
SELECT
  COUNT(*) AS total_closed_lost_sqos,
  COUNTIF(FA_CRD__c IS NOT NULL AND CAST(FA_CRD__c AS STRING) != '') AS has_crd,
  COUNTIF(FA_CRD__c IS NULL OR CAST(FA_CRD__c AS STRING) = '') AS no_crd
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE SQL__c = TRUE
  AND Closed_Lost_Checkbox__c = TRUE;
```

**Key question:** How many of these have a CRD? Without a CRD, we can't match to FinTrx. Note the drop-off.

### 1.4 — Explore the CloseDate Field

```sql
-- Query 4: Distribution of CloseDate for closed-lost SQOs
SELECT
  FORMAT_DATE('%Y-%m', CloseDate) AS close_month,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE SQL__c = TRUE
  AND Closed_Lost_Checkbox__c = TRUE
  AND FA_CRD__c IS NOT NULL
ORDER BY close_month;
```

**Goal:** Confirm CloseDate is populated and reasonable for this cohort.

---

## Phase 2: FinTrx Data Discovery

### 2.1 — Explore ria_contacts_current for Firm Change Signals

```sql
-- Query 5A: Sample records to understand the structure
SELECT
  RIA_CONTACT_CRD_ID,
  PRIMARY_FIRM_NAME,
  PRIMARY_FIRM_START_DATE,
  LATEST_REGISTERED_EMPLOYMENT_END_DATE
FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
LIMIT 20;
```

```sql
-- Query 5B: For our closed-lost SQO CRDs, what does ria_contacts_current show?
SELECT
  f.RIA_CONTACT_CRD_ID,
  f.PRIMARY_FIRM_NAME,
  f.PRIMARY_FIRM_START_DATE,
  f.LATEST_REGISTERED_EMPLOYMENT_END_DATE,
  o.CloseDate
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` f
  ON CAST(o.FA_CRD__c AS STRING) = CAST(f.RIA_CONTACT_CRD_ID AS STRING)
WHERE o.SQL__c = TRUE
  AND o.Closed_Lost_Checkbox__c = TRUE
  AND o.FA_CRD__c IS NOT NULL
LIMIT 30;
```

**Key question:** Does `PRIMARY_FIRM_START_DATE > CloseDate` reliably indicate they moved firms AFTER we closed-lost them? Or is their current firm the same firm they were at when we were recruiting them?

### 2.2 — Explore contact_registered_employment_history

```sql
-- Query 6A: Structure of employment history table
SELECT *
FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
LIMIT 20;
```

```sql
-- Query 6B: For a sample CRD from our cohort, look at their full history
-- (Replace the CRD below with an actual one from Query 5B results)
SELECT *
FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
WHERE RIA_CONTACT_CRD_ID = '<SAMPLE_CRD_FROM_5B>'
ORDER BY PRIMARY_FIRM_START_DATE DESC;  -- or whatever the date column is called
```

**Goal:** Understand if this table has multiple rows per advisor (one per firm stint). Identify the columns for: firm name, start date, end date. This table is likely more useful than `ria_contacts_current` because it shows historical firm changes, not just current state.

### 2.3 — Determine the Best Firm-Change Signal

After running 5A/5B and 6A/6B, decide:

| Scenario | Use This Table | Logic |
|----------|---------------|-------|
| `ria_contacts_current` has a `PRIMARY_FIRM_START_DATE` that is AFTER `CloseDate`, and the firm is different from what Savvy was recruiting them from | `ria_contacts_current` | Simple join, `PRIMARY_FIRM_START_DATE > CloseDate` |
| Need to see the full employment timeline to find the FIRST firm change after CloseDate | `contact_registered_employment_history` | Join on CRD, filter for employment records starting after CloseDate, take the earliest one |

---

## Phase 3: Build the Final Report Query

Once Phases 1-2 are resolved, construct the final query. The template below assumes the most likely scenario — adjust based on discovery findings.

### Template A: Using ria_contacts_current (simpler, if sufficient)

```sql
SELECT
  o.Name AS opportunity_name,
  o.FA_CRD__c AS crd,
  o.CloseDate AS closed_lost_date,
  f.PRIMARY_FIRM_NAME AS new_firm,
  f.PRIMARY_FIRM_START_DATE AS new_firm_start,
  ROUND(DATE_DIFF(f.PRIMARY_FIRM_START_DATE, o.CloseDate, DAY) / 30.44) AS months_after_closed_lost
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` f
  ON CAST(o.FA_CRD__c AS STRING) = CAST(f.RIA_CONTACT_CRD_ID AS STRING)
WHERE o.SQL__c = TRUE
  AND o.Closed_Lost_Checkbox__c = TRUE
  AND o.FA_CRD__c IS NOT NULL
  AND f.PRIMARY_FIRM_START_DATE > o.CloseDate
ORDER BY months_after_closed_lost ASC;
```

### Template B: Using contact_registered_employment_history (richer, handles multiple moves)

```sql
WITH closed_lost_sqos AS (
  SELECT
    Name AS opportunity_name,
    FA_CRD__c AS crd,
    CloseDate AS closed_lost_date
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE SQL__c = TRUE
    AND Closed_Lost_Checkbox__c = TRUE
    AND FA_CRD__c IS NOT NULL
),

-- Adjust column names below based on Phase 2 discovery
first_move_after_close AS (
  SELECT
    cls.opportunity_name,
    cls.crd,
    cls.closed_lost_date,
    h.FIRM_NAME AS new_firm,                        -- confirm column name
    h.EMPLOYMENT_START_DATE AS new_firm_start,      -- confirm column name
    ROW_NUMBER() OVER (
      PARTITION BY cls.crd
      ORDER BY h.EMPLOYMENT_START_DATE ASC          -- confirm column name
    ) AS rn
  FROM closed_lost_sqos cls
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` h
    ON CAST(cls.crd AS STRING) = CAST(h.RIA_CONTACT_CRD_ID AS STRING)
  WHERE h.EMPLOYMENT_START_DATE > cls.closed_lost_date  -- confirm column name
)

SELECT
  opportunity_name,
  crd,
  closed_lost_date,
  new_firm,
  new_firm_start,
  ROUND(DATE_DIFF(new_firm_start, closed_lost_date, DAY) / 30.44) AS months_after_closed_lost
FROM first_move_after_close
WHERE rn = 1
ORDER BY months_after_closed_lost ASC;
```

---

## Phase 4: Report Enhancements

Once the core query works, add these columns/aggregations:

### 4.1 — Summary Stats

```sql
-- After the main report query runs, also generate:
-- Total closed-lost SQOs
-- Count that changed firms
-- Count that did NOT change firms (no match in FinTrx post-close)
-- Average months to firm change
-- Median months to firm change (use APPROX_QUANTILES)
```

### 4.2 — Firm Destination Ranking

```sql
-- Which firms are these advisors going to most?
SELECT
  new_firm,
  COUNT(*) AS advisor_count,
  ROUND(AVG(months_after_closed_lost), 1) AS avg_months_to_move
FROM <final_report_cte>
GROUP BY new_firm
ORDER BY advisor_count DESC
LIMIT 20;
```

### 4.3 — Additional Useful Columns (if available in Opportunity)

Consider pulling into the report:
- `Closed_Lost_Reason__c` or equivalent (why did we lose them?)
- `Owner.Name` (which AE had them?)
- `StageName` at time of close (how far did they get?)
- The firm they were AT when we were recruiting them (from FinTrx or from Opportunity/Account)

This lets you cross-reference: "We lost them because of X, and then they went to Y firm Z months later."

---

## Execution Notes for Claude Code

1. **Run Phase 1 queries first.** Log the results. Make decisions on which fields to use.
2. **Run Phase 2 queries.** Log sample data. Decide which FinTrx table and columns to use.
3. **Build the final query** from the appropriate template, substituting confirmed column names.
4. **Run the final query** and export results to CSV/sheets.
5. **Run the summary stats and firm destination queries** for the executive summary.
6. **Important:** The CRD join key may need CAST operations — `FA_CRD__c` might be numeric in Salesforce but stored as STRING in BQ, or vice versa. Check types in Phase 2 and handle accordingly.
7. **Months calculation:** Use `ROUND(DATE_DIFF(new_date, close_date, DAY) / 30.44)` for a months approximation. This rounds to nearest month.
