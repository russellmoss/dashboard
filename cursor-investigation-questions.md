# Cursor Investigation Questions: 21-Day Cutoff Validation & Implementation

These questions are for Cursor AI to answer using the codebase (MCP connection to the repo) and BigQuery (MCP connection to `savvy-gtm-analytics.SavvyGTMData`). Update `contacted-to-mql-investigation.md` with findings.

---

## Priority 1: Validate the 21-Day Cutoff Number

The current analysis shows converters have a median of 1 day and mean of 15.3 days (Provided List Lead Scoring). But we need to know **what we'd miss** at various cutoffs, not just what the average converter looks like.

### Q1. What % of eventual MQL conversions happen AFTER day N?

Run against BigQuery — for leads with `Final_Source__c = 'Provided List (Lead Scoring)'` that have both `stage_entered_contacting__c` and `Stage_Entered_Call_Scheduled__c` (forward dates only, i.e. MQL date >= Contacting date):

```
For each cutoff in (7, 14, 21, 30, 45, 60, 90 days):
  - How many leads converted to MQL AFTER that many days in Contacting?
  - What % of all eventual converters does that represent?
  - What would the "effective conversion rate" be at each cutoff vs the fully-resolved rate?
```

**Why this matters:** If 5% of converters take longer than 21 days, we permanently undercount them in the denominator (they get marked "effectively closed" before they convert). We need to know the false-negative rate at each threshold. A cutoff that misclassifies >5% of eventual converters is probably too aggressive.

### Q2. Same analysis but broken out by cohort vintage (quarter or month)

```sql
-- Group by QUARTER or MONTH of stage_entered_contacting__c
-- For each vintage, show:
--   total_contacted, total_converted_to_mql, 
--   converted_within_7d, converted_within_14d, converted_within_21d, 
--   converted_within_30d, converted_within_45d, converted_within_60d
-- Only for Final_Source__c = 'Provided List (Lead Scoring)', forward dates only
```

**Why this matters:** Conversion velocity may have changed over time. If recent cohorts convert slower (or faster), a static 21-day cutoff based on all-time data could be wrong for current lists.

### Q3. Does the cutoff need to vary by source?

Run the same Q1 analysis for the top 5-10 sources by contacted volume (not just Provided List Lead Scoring). Show:
- Source name
- N contacted
- N converted to MQL
- % of converters that converted after 7, 14, 21, 30, 45, 60 days

**Why this matters:** If we apply the 21-day rule globally to the Contacted→MQL rate (not just for one source), we need to know it works across sources. Some sources may have fundamentally different conversion timelines.

---

## Priority 2: Understand the Current Denominator Behavior

### Q4. What does the current cohort conversion rate look like over time for Provided List (Lead Scoring)?

```sql
-- By month of stage_entered_contacting__c (last 18 months):
--   cohort_size (all contacted)
--   resolved_count (eligible_for_contacted_conversions = 1 equivalent)
--   mql_count (contacted_to_mql_progression = 1 equivalent)
--   current_cohort_rate (mql_count / resolved_count)
--   "true" rate if we used full cohort denominator (mql_count / cohort_size)
--   pct_resolved (resolved_count / cohort_size)
-- For Final_Source__c = 'Provided List (Lead Scoring)'
```

**Why this matters:** This shows the actual magnitude of the inflation problem. If recent months show 30% conversion rate (resolved-only) but the true rate is 3% (full cohort), we know the distortion is 10x. This also shows how quickly the resolved rate converges to the true rate over time — that's the "stabilization curve" we're trying to accelerate.

### Q5. For leads currently "in limbo" (contacted, not MQL, not closed), how old are they?

```sql
-- For Final_Source__c = 'Provided List (Lead Scoring)':
-- Leads where stage_entered_contacting__c IS NOT NULL
--   AND Stage_Entered_Call_Scheduled__c IS NULL (no MQL)
--   AND Stage_Entered_Closed__c IS NULL (not closed)
-- Show:
--   count
--   days_since_contacting distribution (buckets: 0-7, 8-14, 15-21, 22-30, 31-60, 61-90, 91+)
--   median and mean days_since_contacting
```

**Why this matters:** This tells us how many leads RIGHT NOW would flip into the denominator under a 21-day rule. If it's 5,000 leads that have been sitting >21 days, that's a massive one-time denominator adjustment. We should understand the size of the shock.

---

## Priority 3: Implementation & Side Effects

### Q6. In `vw_funnel_master.sql`, does `eligible_for_contacted_conversions` feed into ANY other metric besides Contacted→MQL rate?

Search the entire codebase for all references to `eligible_for_contacted_conversions`. List every query, view, or function that reads this field and what metric it powers. We need to confirm that adding a new `eligible_for_contacted_conversions_21d` flag (and only using it for Contacted→MQL) truly has zero side effects on other metrics.

### Q7. In `conversion-rates.ts` and `source-performance.ts`, is the Contacted→MQL denominator query isolated or shared with other stage-to-stage rates?

Specifically:
- Is the denominator query for Contacted→MQL built independently, or does it share a CTE/subquery with other conversion rates (e.g., MQL→SQL, SQL→Close)?
- If shared: can we inject the 21-day override for just the Contacted→MQL denominator without touching other rates?
- Show the relevant code blocks.

### Q8. How does `source-performance.ts` compute Contacted→MQL by source?

Does it use the same `eligible_for_contacted_conversions` flag, or does it have its own logic? If the scorecard uses the 21-day rule but source performance doesn't (or vice versa), the numbers will disagree. We need both to use the same denominator logic.

### Q9. Does the semantic layer (`definitions.ts`, `query-compiler.ts`) need a separate update?

Check if `CONVERSION_METRICS.contacted_to_mql_rate` in `definitions.ts` hardcodes `denominatorField: 'eligible_for_contacted_conversions'`. If so, the semantic layer queries (used by any NL query tool or saved reports) would still use the old denominator unless we also update the semantic layer. List exactly what needs to change.

---

## Priority 4: Edge Cases & Data Quality

### Q10. What happens to the "effectively closed" leads if they later DO convert to MQL after day 21?

Walk through the logic: if a lead enters Contacting on Jan 1, doesn't convert by Jan 22, gets treated as "effectively closed" in the denominator — then converts to MQL on Feb 15. Under the proposed logic:
- Does it show up in the numerator? (It should — `contacted_to_mql_progression` should still = 1)
- Does it show up in the denominator? (It should — it's now resolved for real via MQL)
- Net effect: the rate should "self-correct" for late converters. **Confirm this by tracing the SQL/code logic.**

### Q11. What about leads that are "effectively closed" at 21 days but then get ACTUALLY closed later by auto-close at 90+ days?

When the real close happens:
- `eligible_for_contacted_conversions` flips to 1 (they're now resolved for real)
- `eligible_for_contacted_conversions_21d` was already 1
- Is there any double-counting risk? Does the lead appear twice in any aggregation?

### Q12. Are there leads with `stage_entered_contacting__c` set but with unusual statuses that would break the 21-day rule?

Check for leads where:
- `stage_entered_contacting__c` is set but they're in a status/stage that isn't Contacting, MQL, or Closed (e.g., recycled, re-engaged, converted to Contact/Opportunity)
- Leads with record types that shouldn't be in funnel metrics (e.g., re-engagement record type — the doc references `re-engagement-record-type.md`)
- Leads where `stage_entered_contacting__c` is set but `is_contacted` = 0 in vw_funnel_master (data inconsistency)

How many of these exist and would they pollute the 21-day denominator?

---

## Priority 5: What "Good" Looks Like

### Q13. Simulate the 21-day rule against historical data

For the last 12 months of Provided List (Lead Scoring) cohorts (by month of `stage_entered_contacting__c`):

```
Show side-by-side:
  - Current resolved-only rate (as dashboard shows today)
  - 21-day effective rate
  - 14-day effective rate  
  - 30-day effective rate
  - "True" fully-resolved rate (for cohorts old enough to be fully resolved, 6+ months old)
```

**Why this matters:** This is the money question. We want to see which cutoff produces a rate that most closely approximates the "true" fully-resolved rate for mature cohorts, while being available much sooner for recent cohorts. If 21 days produces a rate within ±2pp of the true rate for mature cohorts, it's a good cutoff. If it's off by 5pp+, we need a different number.

### Q14. What's the recommended cutoff based on the simulation?

After running Q13, recommend the cutoff (7/14/21/30/45/60) that:
1. Minimizes deviation from the fully-resolved "true" rate for mature cohorts
2. Misclassifies the fewest eventual converters as "effectively closed"
3. Gives a stable read within a reasonable timeframe for new lists

---

## Appendix: Update contacted-to-mql-investigation.md

After answering the above, update the investigation doc with:
- A new **Section 4c** with the cutoff sensitivity analysis (Q1-Q3 results)
- A new **Section 4d** with the current denominator behavior / inflation magnitude (Q4-Q5)
- Updated **Section 5** with the recommended cutoff (based on Q13-Q14) — either confirming 21 days or recommending an alternative
- Updated **Section 6** with specific implementation notes from Q6-Q9 (what files need changes, any gotchas)
- A new **Section 5a** covering edge cases (Q10-Q12 findings)
