# OpportunityFieldHistory — Schema & Data Exploration

> **Source:** `savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory`
> **Explored:** 2026-03-24
> **Rows:** 27,097 | **Distinct Opportunities:** 2,923 of 3,106 total (94.1% have at least one field history record)
> **Date Range:** 2024-09-23 → 2026-03-24
> **Clustered by:** `Id`

---

## Schema

| Column | Type | Description | % Populated |
|--------|------|-------------|-------------|
| `Id` | STRING | Unique Salesforce ID for this history record | 100% |
| `IsDeleted` | BOOLEAN | Soft-delete flag (always `false` — 0 deleted records in dataset) | 100% |
| `OpportunityId` | STRING | Foreign key to the Opportunity record (`SavvyGTMData.Opportunity.Id`) | 100% |
| `CreatedById` | STRING | Salesforce User ID of the person (or automation) that made the change | 100% |
| `CreatedDate` | TIMESTAMP | When the field change was recorded | 100% |
| `Field` | STRING | API name of the field that changed (e.g., `StageName`, `Amount`, `Earliest_Anticipated_Start_Date__c`) | 100% |
| `DataType` | STRING | Salesforce data type category of the field (see breakdown below) | 100% |
| `OldValue` | STRING | Previous value before the change (NULL for initial sets and `created` events) | 62.7% |
| `NewValue` | STRING | New value after the change (NULL for field clears) | 91.5% |

### DataType Distribution

| DataType | Records | % of Total | Example Fields |
|----------|---------|-----------|---------------|
| Text | 10,561 | 39.0% | `NextStep`, `Name`, `Manager_Deal_Notes__c` |
| DynamicEnum | 9,048 | 33.4% | `StageName`, `ForecastCategoryName`, `LeadSource` |
| Percent | 2,798 | 10.3% | `Probability` |
| EntityId | 1,836 | 6.8% | `Owner`, `SGA__c` |
| DateOnly | 1,552 | 5.7% | `Earliest_Anticipated_Start_Date__c`, `CloseDate` |
| Currency | 1,298 | 4.8% | `Amount`, `Underwritten_AUM__c` |
| RecordType | 4 | <0.1% | `RecordType` |

---

## Tracked Fields (All 22)

| Field | Changes | Distinct Opps | Avg Changes/Opp |
|-------|---------|---------------|-----------------|
| `NextStep` | 5,501 | 1,382 | 4.0 |
| `StageName` | 2,968 | 1,542 | 1.9 |
| `Probability` | 2,790 | 1,438 | 1.9 |
| `SGA__c` | 2,302 | 1,103 | 2.1 |
| `ForecastCategoryName` | 1,401 | 1,003 | 1.4 |
| `Owner` | 1,362 | 601 | 2.3 |
| `Closed_Lost_Reason__c` | 1,142 | 1,052 | 1.1 |
| `SQL__c` | 1,121 | 1,092 | 1.0 |
| `created` | 1,052 | 1,052 | 1.0 |
| `Amount` | 1,033 | 914 | 1.1 |
| `opportunityCreatedFromLead` | 1,021 | 1,021 | 1.0 |
| `Name` | 1,000 | 887 | 1.1 |
| `Finance_View__c` | 825 | 717 | 1.2 |
| `CloseDate` | 809 | 436 | 1.9 |
| `Final_Source__c` | 781 | 682 | 1.1 |
| **`Earliest_Anticipated_Start_Date__c`** | **743** | **292** | **2.5** |
| `LeadSource` | 733 | 723 | 1.0 |
| `Underwritten_AUM__c` | 265 | 234 | 1.1 |
| `Manager_Deal_Notes__c` | 155 | 74 | 2.1 |
| `Restrictive_Covenants__c` | 77 | 72 | 1.1 |
| `Final_Compensation_Margin__c` | 8 | 8 | 1.0 |
| `RecordType` | 8 | 3 | 2.7 |

---

## Deep Dive: `Earliest_Anticipated_Start_Date__c` History

### Overview

| Metric | Value |
|--------|-------|
| Total change records | 743 |
| Distinct opportunities with date history | 292 |
| Opportunities that have an anticipated date set today | 339 |
| % of those with at least one change in history | **77.9%** |
| Average changes per opp (among those with history) | 2.5 |
| Max changes on a single opp | 16 |
| Date range of changes | 2025-04-03 → 2026-03-24 |

### How Often Do People Have Multiple Anticipated Dates?

Of the **292 opportunities** with any `Earliest_Anticipated_Start_Date__c` field history:

| Changes | Opps | % | Cumulative % with ≥ N |
|---------|------|---|----------------------|
| 1 (set once, never changed) | 126 | 43.2% | — |
| 2 | 59 | 20.2% | **56.8% have 2+** |
| 3 | 36 | 12.3% | 36.6% have 3+ |
| 4 | 28 | 9.6% | 24.3% have 4+ |
| 5 | 22 | 7.5% | 14.7% have 5+ |
| 6 | 8 | 2.7% | |
| 7 | 3 | 1.0% | |
| 8 | 3 | 1.0% | |
| 9 | 4 | 1.4% | |
| 10 | 1 | 0.3% | |
| 14 | 1 | 0.3% | |
| 16 | 1 | 0.3% | |

**Key finding: 57% of opportunities that have an anticipated date have changed it at least once.** This is not a "set it and forget it" field — it's actively managed and frequently revised.

### Direction of Changes

| Direction | Count | % |
|-----------|-------|---|
| **Pushed later** | 408 | 54.9% |
| Initial set (NULL → date) | 265 | 35.7% |
| Pulled earlier | 37 | 5.0% |
| Cleared (date → NULL) | 33 | 4.4% |

**Dates are pushed later 11× more often than pulled earlier.** When the date changes (excluding initial sets and clears), 91.7% of the time it moves to a later date.

### How Far Do Dates Shift Per Change?

When a date is moved (old and new both parseable):

| Percentile | Shift (days) |
|------------|-------------|
| P25 | 14 days |
| **Median** | **25 days** |
| P75 | 41 days |
| P90 | 61 days |
| Average | 31 days |

The typical revision pushes the date out by about a month.

### Total Drift: First Date Set vs. Final Date

For opportunities with any date history, comparing the earliest date ever set to the most recent:

| Percentile | Total Drift (days) |
|------------|-------------------|
| P25 | 0 days |
| **Median** | **7 days** |
| P75 | 63 days |
| P90 | 143 days |
| Max | **361 days** |
| Average | 45 days |

The median drift is only 7 days (many opps change once then stick), but the P90 is **143 days** — the tail of serial pushers drifts by nearly 5 months.

### Behavioral Patterns Among Multi-Change Opps

Among the **166 opportunities** that changed the date 2+ times:

| Pattern | Opps | % |
|---------|------|---|
| Pushed once (2 changes, all later) | 51 | 30.7% |
| Repeat pusher (3–4 changes, all later) | 48 | 28.9% |
| **Serial pusher (5+ changes, all later)** | **32** | **19.3%** |
| Mostly pushed later (75%+ later) | 10 | 6.0% |
| Mixed direction | 25 | 15.1% |

**79% of multi-change opps exclusively push later.** Only 15% have a mixed pattern (some earlier, some later). Serial pushers (5+ consecutive pushes later) account for 19% of the multi-change population.

### Example: A Serial Pusher (16 Changes)

One opportunity (`006VS00000DXfheYAD`) had its anticipated date pushed 16 times over 11 months:

```
2025-04-08  NULL → 2025-06-30   (initial set)
2025-05-28  → 2025-07-25        (+25 days)
2025-06-26  → 2025-08-20        (+26 days)
2025-07-15  → 2025-08-18        (-2 days, rare pull-in)
2025-08-04  → 2025-09-08        (+21 days)
2025-08-26  → 2025-09-22        (+14 days)
2025-09-09  → 2025-09-29        (+7 days)
2025-09-24  → 2025-10-20        (+21 days)
2025-09-29  → 2025-10-30        (+10 days)
2025-11-03  → 2025-12-05        (+35 days)
2025-11-12  → 2025-12-19        (+14 days)
2025-12-10  → 2026-01-30        (+42 days)
2026-01-09  → 2026-02-13        (+14 days)
2026-02-09  → 2026-03-20        (+35 days)
2026-02-25  → 2026-03-31        (+11 days)
2026-02-26  → 2026-04-10        (+10 days)
```

Total drift: originally anticipated for 2025-06-30, now set to 2026-04-10 — **284 days of slippage**.

### Does Date Churn Correlate With Outcome?

Among opps that have an anticipated date set:

| Bucket | Opps | Joined | Closed Lost | Still Open | Join Rate (of resolved) |
|--------|------|--------|-------------|------------|------------------------|
| No date history | 75 | 27 | 48 | 0 | 36.0% |
| 1 change (set once) | 125 | 11 | 49 | 65 | 18.3% |
| 2–3 changes | 85 | 27 | 43 | 15 | 38.6% |
| 4+ changes | 54 | 10 | 30 | 14 | 25.0% |

**Interpretation:** Opps set once and never revised have the lowest resolved join rate (18.3%) — these may be placeholder dates that go stale. Opps with 2–3 changes show the highest join rate (38.6%), suggesting active date management correlates with deal engagement. At 4+ changes the rate drops to 25%, suggesting over-revision may signal a stuck deal that keeps slipping.

---

## Implications for Forecasting

1. **The anticipated date is unreliable as a fixed input.** 57% of opps that have one have changed it, and 92% of changes push it later. Using the current anticipated date at face value for projected join timing likely under-counts slippage.

2. **Serial pushers are a distinct population.** 32 opps (11% of those with date history) have pushed the date 5+ times, always later. These could be flagged in the forecast as "anticipated date unreliable — use model date instead."

3. **Date revision count could be a signal.** The 2–3 change bucket has the best join rate (38.6%), while 1-change and 4+ change buckets are worse. A future enhancement could weight the anticipated date's reliability by how many times it's been revised.

4. **The median per-change shift is 25 days.** If building a "date confidence" indicator, each prior revision could discount the anticipated date's reliability by roughly a month of uncertainty.
