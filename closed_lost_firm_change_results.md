# Closed-Lost SQO Firm Change Analysis — Results

**Analysis Date:** 2026-03-05
**Data Sources:** Salesforce Opportunity (BigQuery sync) + FinTrx ria_contacts_current

---

## Executive Summary

Of 672 closed-lost SQOs, 513 had a CRD number allowing FinTrx matching. 464 of those matched to a FinTrx record. **106 advisors (22.8% of matched) changed firms after being closed-lost by Savvy.** The median time to move was **2 months** and the average was **3.6 months** — meaning most advisors who are going to move do so quickly.

The top two destination firms — **Farther (8 advisors)** and **LPL Financial (7 advisors)** — are clearly winning these advisors, and they're doing it fast (avg 1.6 and 1.7 months respectively). Two advisors actually came back to **Savvy** after being closed-lost, at an average of 6.5 months later.

---

## Population Funnel

| Stage | Count | % of Previous |
|-------|-------|---------------|
| Total closed-lost SQOs | 672 | — |
| With CRD number | 513 | 76.3% |
| Matched in FinTrx | 464 | 90.4% |
| Changed firms after close | 106 | 22.8% of matched |
| Did NOT change firms | 358 | 77.2% of matched |

---

## Key Metrics

| Metric | Value |
|--------|-------|
| Average months to firm change | 3.6 |
| Median months to firm change | 2 |
| Fastest movers | 12 advisors moved within same month (0 months) |
| Slowest mover | 18 months (Josh Wood -> Robinhood Financial) |

---

## Top 20 Destination Firms

| Rank | Firm | Advisors | Avg Months to Move |
|------|------|----------|--------------------|
| 1 | Farther | 8 | 1.6 |
| 2 | LPL Financial LLC | 7 | 1.7 |
| 3 | Cetera Wealth Services, LLC | 4 | 3.3 |
| 4 | Mercer Global Advisors Inc. | 3 | 3.7 |
| 5 | Wells Fargo Advisors | 3 | 5.7 |
| 6 | Kestra Investment Services, LLC | 3 | 3.0 |
| 7 | Mariner Wealth | 3 | 3.0 |
| 8 | Equitable Advisors, LLC | 2 | 3.0 |
| 9 | Savvy (came back!) | 2 | 6.5 |
| 10 | Mariner Independent | 2 | 1.5 |
| 11 | Arkadios Capital | 1 | 8.0 |
| 12 | Twenty-Five Capital Partners | 1 | 3.0 |
| 13 | Compound Planning, Inc. | 1 | 2.0 |
| 14 | Aprio Wealth Management, LLC | 1 | 1.0 |
| 15 | J.P. Morgan Securities LLC | 1 | 2.0 |
| 16 | The Fiduciary Alliance | 1 | 1.0 |
| 17 | Citigroup Global Markets Inc. | 1 | 4.0 |
| 18 | Charles Schwab & Co, Inc. | 1 | 1.0 |
| 19 | Brave New Wealth | 1 | 1.0 |
| 20 | Fiduciary Wealth Group, LLC | 1 | 0.0 |

---

## Closed-Lost Reason Breakdown (among those who changed firms)

| Reason | Count | Avg Months | Median Months |
|--------|-------|------------|---------------|
| Candidate Declined - Lost to Competitor | 20 | 2.7 | 1 |
| No Longer Responsive | 17 | 2.7 | 2 |
| Candidate Declined - Economics | 16 | 3.9 | 3 |
| Candidate Declined - Fear of Change | 14 | 3.7 | 2 |
| Savvy Declined - Book Not Transferable | 12 | 3.8 | 3 |
| Candidate Declined - Timing | 12 | 3.6 | 2 |
| Savvy Declined - Insufficient Revenue | 6 | 6.2 | 3 |
| Savvy Declined - No Book of Business | 3 | 7.3 | 5 |
| Savvy Declined - Poor Culture Fit | 2 | 1.5 | 1 |
| Savvy Declined - Compliance | 2 | 2.5 | 2 |
| Other | 2 | 7.0 | 1 |

---

## "Lost to Competitor" — Where Did They Go?

These 20 advisors explicitly told us they chose a competitor. Here's where they ended up:

| Destination Firm | Count | Avg Months |
|------------------|-------|------------|
| Farther | 2 | 0.5 |
| Mercer Global Advisors Inc. | 2 | 1.0 |
| The Strategic Financial Alliance | 1 | 2.0 |
| Mariner Independent | 1 | 0.0 |
| Tandem Financial, LLC | 1 | 6.0 |
| Sanctuary Advisors, LLC | 1 | 1.0 |
| Mutual Advisors, LLC | 1 | 3.0 |
| Wealth Enhancement Advisory Services | 1 | 1.0 |
| Vistamark Investments | 1 | 1.0 |
| Parkwoods Wealth Partners, LLC | 1 | 1.0 |
| Silver Grove Advisory Services | 1 | 10.0 |
| Coldstream Wealth Management | 1 | 0.0 |
| Edward Jones | 1 | 3.0 |
| Compound Planning, Inc. | 1 | 2.0 |
| Arkadios Capital | 1 | 8.0 |

---

## Key Patterns & Insights

1. **Farther is the #1 competitor threat.** 8 advisors total went to Farther, including 2 who explicitly said "lost to competitor." They move fast — avg 1.6 months. Farther's digital-first RIA model is clearly resonating with the same advisor profile Savvy targets.

2. **LPL Financial is #2 but a different profile.** 7 advisors went to LPL, also quickly (1.7 months avg). LPL is a traditional IBD/RIA hybrid — these advisors may be choosing scale and infrastructure over a pure tech play.

3. **"Lost to Competitor" advisors move fastest** (median 1 month). They already had a competing offer and executed quickly. This suggests Savvy is losing competitive deals at the finish line, not at the top of funnel.

4. **"Fear of Change" advisors still move** — 14 of them changed firms anyway (median 2 months). They told Savvy they were afraid to move, then moved anyway. This suggests the objection was really about Savvy specifically, not about change in general.

5. **"Economics" declines move slower** (median 3 months). These advisors may have needed more time to find a better economic deal, or the economics objection was genuine and they waited for a better offer.

6. **Savvy-declined advisors still move at high rates.** 12 "Book Not Transferable" and 6 "Insufficient Revenue" advisors moved firms — they were motivated to change, just not a fit for Savvy. Consider referral partnerships with destination firms.

7. **2 advisors came back to Savvy.** Dave Sharpe (initially "Book Not Transferable") and Chris Ornee (initially "Lost to Competitor") both ended up at Savvy ~6.5 months later. Win-back is real.

8. **77% of matched advisors did NOT change firms.** The majority of closed-lost SQOs stayed put. The 23% who moved represent the "ready to move" segment that Savvy failed to convert.

---

## Methodology Notes

- **SQO filter:** `SQL__c = 'Yes'` (971 total SQOs in system)
- **Closed-lost filter:** `StageName = 'Closed Lost'` (captures all 1,961 closed-lost, vs Closed_Lost_Checkbox__c which misses 342)
- **Firm change detection:** Joined Opportunity.FA_CRD__c to FinTrx ria_contacts_current.RIA_CONTACT_CRD_ID, filtered for PRIMARY_FIRM_START_DATE > CloseDate
- **Limitation:** ria_contacts_current only shows the advisor's CURRENT firm. If an advisor changed firms twice after close, we only see the most recent one. For full history, query contact_registered_employment_history.
- **Limitation:** 49 CRDs (513 - 464) did not match in FinTrx — these advisors may have left the industry, have data mismatches, or have CRDs recorded incorrectly in Salesforce.
- **Date handling:** PRIMARY_FIRM_START_DATE is stored as STRING in FinTrx; parsed with SAFE.PARSE_DATE. CloseDate is native DATE in Salesforce/BQ.

---

## Final SQL Query (re-runnable)

```sql
-- Core report: All closed-lost SQOs who changed firms after close
SELECT
  o.Name AS opportunity_name,
  o.FA_CRD__c AS crd,
  o.Firm_Name__c AS firm_at_recruitment,
  o.Closed_Lost_Reason__c AS closed_lost_reason,
  o.Opportunity_Owner_Name__c AS opportunity_owner,
  o.CloseDate AS closed_lost_date,
  f.PRIMARY_FIRM_NAME AS current_firm,
  SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE) AS new_firm_start,
  ROUND(DATE_DIFF(SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE), o.CloseDate, DAY) / 30.44) AS months_after_closed_lost
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` f
  ON o.FA_CRD__c = CAST(f.RIA_CONTACT_CRD_ID AS STRING)
WHERE o.SQL__c = 'Yes'
  AND o.StageName = 'Closed Lost'
  AND o.FA_CRD__c IS NOT NULL
  AND SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE) > o.CloseDate
ORDER BY months_after_closed_lost ASC;
```

```sql
-- Summary stats
WITH matched AS (
  SELECT
    o.FA_CRD__c AS crd,
    o.CloseDate AS closed_lost_date,
    f.PRIMARY_FIRM_NAME AS current_firm,
    SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE) AS new_firm_start
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` f
    ON o.FA_CRD__c = CAST(f.RIA_CONTACT_CRD_ID AS STRING)
  WHERE o.SQL__c = 'Yes'
    AND o.StageName = 'Closed Lost'
    AND o.FA_CRD__c IS NOT NULL
),
changed AS (
  SELECT *,
    ROUND(DATE_DIFF(new_firm_start, closed_lost_date, DAY) / 30.44) AS months_after
  FROM matched
  WHERE new_firm_start > closed_lost_date
)
SELECT
  COUNT(*) AS total_changed,
  ROUND(AVG(months_after), 1) AS avg_months,
  APPROX_QUANTILES(months_after, 2)[OFFSET(1)] AS median_months
FROM changed;
```

```sql
-- Firm destination ranking
WITH changed AS (
  SELECT
    f.PRIMARY_FIRM_NAME AS new_firm,
    ROUND(DATE_DIFF(SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE), o.CloseDate, DAY) / 30.44) AS months_after_closed_lost
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` f
    ON o.FA_CRD__c = CAST(f.RIA_CONTACT_CRD_ID AS STRING)
  WHERE o.SQL__c = 'Yes'
    AND o.StageName = 'Closed Lost'
    AND o.FA_CRD__c IS NOT NULL
    AND SAFE.PARSE_DATE('%Y-%m-%d', f.PRIMARY_FIRM_START_DATE) > o.CloseDate
)
SELECT
  new_firm,
  COUNT(*) AS advisor_count,
  ROUND(AVG(months_after_closed_lost), 1) AS avg_months_to_move
FROM changed
GROUP BY new_firm
ORDER BY advisor_count DESC
LIMIT 20;
```
