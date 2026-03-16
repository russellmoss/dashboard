# Current Sheet Structure — Q2 Forecast Source-Detail Section

> Generated 2026-03-12 from Google Sheet `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`, tab `Q2 forecast`

## Overview

Source-detail rows span **rows 106–446**. No data after row 446.
The section is organized into **7 Finance_View groups** containing **25 source blocks total**.

Each source block has exactly **11 funnel stages** in this order:
1. Created
2. Created → Contacted rate
3. Contacted
4. Contacted → MQL rate
5. Call Scheduled (MQL)
6. Call Scheduled → SQL rate
7. Opportunity Created (SQL)
8. SQL → SQO rate
9. SQO
10. SQO → Joined rate
11. Joined

Blocks are separated by 1–2 blank rows.

---

## Source Block Types

### PRIMARY (12+ columns, has monthly forecast)
- Columns A–G (historical + forecast summary) + H, J, L (monthly breakdown)
- Column G volumes: `=SUM(H{row},J{row},L{row})` — sums 3 monthly values
- Column G rates: `=AVERAGE(C{row}:E{row})` — averages first 3 historical quarters
- Monthly Created (H/J/L): hardcoded manual inputs (the forecast assumption)
- Monthly rates (H/J/L): hardcoded decimals (manual rate assumptions)
- Monthly derived volumes: `=H{prev_volume}*H{prev_rate}` (cascading multiplication)
- SQO→Joined rate and Joined: only C–F (historical), no forecast

### SUB-SOURCE (7 columns, historical + forecast only)
- Columns A–G only; no monthly breakdown (H–L absent)
- Column G volumes: `=SUM(H{row},J{row},L{row})` → evaluates to 0 since H/J/L empty
- Column G rates: `=AVERAGE(C{row}:E{row})`
- SQO→Joined rate and Joined: only C–F (6 columns)

**Key distinction**: PRIMARY sources drive the forecast via manual monthly inputs. SUB-sources only show historical SUMPRODUCT lookups; their column G is effectively 0.

---

## Column G (Forecast) Pattern

Column G is **NOT a manual input column for most rows**. Instead:
- **Volume rows**: `=SUM(H{row},J{row},L{row})` — derived from monthly columns
- **Rate rows**: `=AVERAGE(C{row}:E{row})` — average of historical
- **The actual manual forecast inputs are in columns H, J, L** (monthly breakdown)
- For SUB-sources without monthly data, G evaluates to 0

Therefore: **the real forecast values live in columns H, J, L of PRIMARY source blocks**. Column G is just a formula rolling them up.

---

## Historical Columns (C–F) Formula Patterns

### Volume stages — reference `Volumes!` tab
```
=SUMPRODUCT(
  (Volumes!$D$2:$D$5000={quarter_col}$8) *
  (Volumes!$F$2:$F$5000={quarter_col}$7) *
  ((Volumes!$A$2:$A$5000="QTD")+(Volumes!$A$2:$A$5000="QUARTERLY")) *
  (Volumes!$I$2:$I$5000={source_ref}) *
  (Volumes!${metric_col}$2:${metric_col}$5000)
)
```

### Rate stages — reference `monthly_conversion_rates!` tab
```
=SUMPRODUCT(
  (monthly_conversion_rates!$D$2:$D$5000={quarter_col}$8) *
  (monthly_conversion_rates!$F$2:$F$5000={quarter_col}$7) *
  ((monthly_conversion_rates!$A$2:$A$5000="QTD")+(monthly_conversion_rates!$A$2:$A$5000="QUARTERLY")) *
  (monthly_conversion_rates!$H$2:$H$5000={source_ref}) *
  (monthly_conversion_rates!${metric_col}$2:${metric_col}$5000)
)
```

### Source reference styles
- Most sources: `=B{source_name_row}` or `=$B${source_name_row}` (cell reference)
- Exception: Provided Lead List uses hardcoded `="Provided Lead List"` string

### Metric Column Mapping

| Stage | Volumes! col | monthly_conversion_rates! col |
|---|---|---|
| Created | $M | — |
| Created→Contacted rate | — | $AH |
| Contacted | $N | — |
| Contacted→MQL rate | — | $N |
| Call Scheduled (MQL) | $O | — |
| CS→SQL rate | — | $R |
| Opportunity Created (SQL) | $P | — |
| SQL→SQO rate | — | $V |
| SQO | $Q | — |
| SQO→Joined rate | — | $Z |
| Joined | $R | — |

---

## Complete Source Block Inventory

### Group 1: Outbound (rows 106–133)

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 1 | Provided Lead List (Lead Scoring) | PRIMARY | 107 | 108–118 | 33 | Yes |
| 2 | LinkedIn (Self Sourced) | PRIMARY | 120 | 121–131 | 89 | Yes |

Notes:
- Source 1 formula uses hardcoded `="Provided Lead List"` (not cell ref)
- Monthly Created uses external coefficients (`=$P${sourceRow}*O108`)
- Rates >100% visible in historical C–F (e.g., Created→Contacted 150%, 180%) — confirms inflation bug

### Group 2: Marketing Organic (rows 134–252)

Header row 134: "Marketing Forecast - Organic (Cohorted View)"

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 3 | Blog | SUB | 136 | 137–147 | 0 | No |
| 4 | Search | SUB | 149 | 150–160 | 0 | No (hardcoded 0s) |
| 5 | LinkedIn Savvy | SUB | 162 | 163–173 | 0 | No |
| 6 | LinkedIn Social | SUB | 175 | 176–186 | 0 | No |
| 7 | LinkedIn (Content) | SUB | 188 | 189–199 | 0 | No |
| 8 | LinkedIn (Automation) | SUB | 201 | 202–212 | 0 | No |
| 9 | Direct Traffic | SUB | 214 | 215–225 | 0 | No |
| 10 | Website | SUB | 227 | 228–238 | 0 | No |
| 11 | Advisor Waitlist | PRIMARY | 240 | 241–251 | 3 | Yes (hardcoded 1s) |

Notes:
- ALL Marketing Organic sources except Advisor Waitlist are SUB-sources with no monthly forecast
- Most show all-zero historical data (no BQ records for these source names)
- Advisor Waitlist has monthly values but small (1/1/1 for Created)
- Search has placeholder notes: "Hard coding 6 coming from the SEO work being done"

### Group 3: Marketing Paid (rows 253–320)

Header row 254: "Marketing Forecast - Paid (Cohorted View)"

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 12 | Google Ads + LinkedIn Ads | PRIMARY | 256 | 257–267 | 5 | Yes |
| 13 | Ashby | PRIMARY | 269 | 270–280 | 2 | Yes |
| 14 | Google Ads | SUB | 282 | 283–293 | 0 | No |
| 15 | Meta | SUB | 295 | 296–306 | 0 | No |
| 16 | LinkedIn Ads | SUB | 308 | 309–319 | 0 | No |

Notes:
- Google Ads + LinkedIn Ads is a **composite source** (sums two BQ sources)
- Ashby monthly: Created=5/5/5, rates=0.75/0.5/0.5/0.8
- Google Ads, Meta, LinkedIn Ads are SUB-sources (historical only)
- Ashby notes: "Hardcoding 75% because we manually put people in"

### Group 4: Outbound + Marketing (rows 321–374)

Header row 321: "Outbuound + Marketing Forecast (Cohorted View)" [sic]

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 17 | Events | PRIMARY | 323 | 324–334 | 12 | Yes |
| 18 | Direct Mail | SUB | 336 | 337–347 | 0 | No |
| 19 | Webinar | SUB | 349 | 350–360 | 0 | No |
| 20 | Provided List (Marketing) | SUB | 362 | 363–373 | 0 | No |

Notes:
- Events monthly: Created=90/90/90, rates=0.5/0.25/0.48/0.77
- Direct Mail, Webinar have zero BQ records
- Provided List (Marketing) exists in BQ but is SUB-source here

### Group 5: Re-Engagement (rows 375–389)

Header row 375: "Re-Engagement (Cohorted View)"

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 21 | Re-Engagement | PRIMARY | 377 | 378–388 | 14 | Yes |

Notes:
- Monthly: Created=5/5/5, all rates=1 except SQL→SQO=0.92
- Note: "Forecasting at the SQO level"

### Group 6: Partnerships (rows 390–404)

Header row 390: "Partnerships (Cohorted View)"

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 22 | Recruitment Firm | PRIMARY | 392 | 393–403 | 21 | Yes |

Notes:
- Monthly: Created=8/8/8, rates=1/1/1/(6/7≈0.857)
- Notes: "Anchoring on this number of SQLs", "Anchoring on 7 out of 8 SQOs per month"

### Group 7: Advisor Referrals (rows 405–419)

Header row 405: "Advisor Referrals (Cohorted View)"

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 23 | Advisor Referral | PRIMARY | 407 | 408–418 | 3 | Yes |

Notes:
- Monthly: Created=1/1/2, Created→Contacted uses `=$G409` (historical avg)

### Group 8: Other (rows 420–446)

Header row 420: "Other (Cohorted View)"

| # | Source Name | Type | Source Row | Data Rows | G SQO (Q2'26) | Has Monthly? |
|---|---|---|---|---|---|---|
| 24 | Other | PRIMARY | 422 | 423–433 | 0 | Yes |
| 25 | Unknown | SUB | 435 | 436–446 | 0 | No |

Notes:
- Other monthly: Created=15/15/15, CS→SQL=0, SQL→SQO=0 (no pipeline from SQL onward)
- Unknown is SUB-source (historical only)

---

## Downstream Tab References (Phase 1.3)

Checked tabs: `re-forecast summary`, `BQ_Export_Format`, `Funnel summary`, `Sheet4`

**Result: NO tabs reference rows 106+ of Q2 forecast.**

Only cross-tab reference found: `re-forecast summary!O3` → `'Q2 forecast'!R63` (row 63, below threshold).

The source-detail section is self-contained. Restructuring it will NOT break downstream references.

---

## Summary Statistics

| Metric | Value |
|---|---|
| Total source blocks | 25 |
| PRIMARY sources (with monthly forecast) | 11 |
| SUB-sources (historical only, G=0) | 14 |
| Sources with all-zero historical data | 10 (no BQ records) |
| Sources with >100% rates (inflation bug) | ~8 (Outbound, O+M, Re-Engagement, Partnerships visible) |
| Total Q2'26 forecast SQOs across all sources | ~182 |
| Forecast SQOs from PRIMARY sources only | 182 (SUB-sources all = 0) |

### Q2'26 Forecast SQO Breakdown
| Group | Source | Forecast SQOs |
|---|---|---|
| Outbound | Provided Lead List (Lead Scoring) | 33 |
| Outbound | LinkedIn (Self Sourced) | 89 |
| Marketing Organic | Advisor Waitlist | 3 |
| Marketing Paid | Google Ads + LinkedIn Ads | 5 |
| Marketing Paid | Ashby | 2 |
| O+M | Events | 12 |
| Re-Engagement | Re-Engagement | 14 |
| Partnerships | Recruitment Firm | 21 |
| Advisor Referrals | Advisor Referral | 3 |
| Other | Other | 0 |
| **Total** | | **~182** |
