# Google Sheet Export — Complete Reference

**Last updated:** 2026-03-25
**File:** `src/app/api/forecast/export/route.ts`
**Endpoint:** `POST /api/forecast/export` (create), `DELETE /api/forecast/export` (remove)

---

## Overview

The forecast export creates a Google Sheets workbook with **7 tabs** containing the full pipeline forecast, conversion rates, realization model, scenario analysis, and raw audit data. Every number is either a raw value from BigQuery or a Sheets formula referencing other cells — nothing is hardcoded without provenance. The export is designed for leadership to audit, edit scenarios, and share.

---

## Tab Order (as displayed in the sheet)

| Position | Tab Name | Purpose | Primary Audience |
|---|---|---|---|
| 1 | BQ Scenario Runner | What-if analysis with editable inputs | Leadership, RevOps |
| 2 | BQ Rates and Days | Historical conversion rates + velocity | RevOps, Analysts |
| 3 | BQ Realization Forecast | Two-component quarterly forecast + deal-level audit | Leadership, RevOps |
| 4 | BQ Forecast P2 | Full pipeline with per-deal probability | Analysts, SGMs |
| 5 | BQ Monte Carlo | Simulation results (P10/P50/P90) | Leadership |
| 6 | BQ SQO Targets | Gap analysis per quarter | Leadership, RevOps |
| 7 | BQ Audit Trail | Raw resolved SQO data | Analysts |

---

## Tab Write Order (dependency chain)

Tabs are written in dependency order to prevent `#REF!` errors (a tab's formulas can only reference tabs that already exist), then reordered for display via the Sheets API.

```
1. BQ Audit Trail         (no dependencies — everything references it)
2. BQ Rates and Days       (formulas reference Audit Trail)
3. Named Ranges created    (19 ranges pointing to Rates tab cells)
4. BQ Realization Forecast (self-contained formulas)
5. BQ Scenario Runner      (references named ranges + VLOOKUPs Realization tab)
6. BQ Forecast P2          (references named ranges for tier rates)
7. BQ Monte Carlo          (self-contained)
8. BQ SQO Targets          (references Rates tab cells)
→ Tabs reordered via batchUpdate for display
→ Sheet1 (auto-created by Drive API) deleted
```

---

## Tab 1: BQ Scenario Runner

### Purpose
Leadership what-if tool. Edit conversion rates, deal velocity, and mean AUM to see how SQO requirements change. Shows both "SQOs to fill forecast gap" and "SQOs without forecast" for each quarter.

### Sections

**Section 1 — Current Trailing Rates (rows 1-12, read-only)**

| Row | Col A | Col B | Col C |
|---|---|---|---|
| 1 | Title | | |
| 2 | Generated date + instructions | | |
| 4 | `CURRENT TRAILING RATES` | | |
| 5 | `Transition` | `Current Rate` | `Current Avg Days` |
| 6 | SQO → SP | `=SQO_to_SP_rate` | `=avg_days_sqo_to_sp` |
| 7 | SP → Neg | `=SP_to_Neg_rate` | `=avg_days_in_sp` |
| 8 | Neg → Signed | `=Neg_to_Signed_rate` | `=avg_days_in_neg` |
| 9 | Signed → Joined | `=Signed_to_Joined_rate` | `=avg_days_in_signed` |
| 10 | SQO → Joined (product) | `=B6*B7*B8*B9` | `=SUM(C6:C9)` |
| 11 | Mean Joined AUM ($) | `=mean_joined_aum` | |
| 12 | Cohort Size | `=cohort_count` | |

All values are named range references — read-only, auto-updating from the Rates tab.

**Section 2 — Scenario Inputs (rows 14-22, editable)**

| Row | Col A | Col B | Col C |
|---|---|---|---|
| 14 | `SCENARIO INPUTS (← edit these cells)` | | |
| 15 | `Transition` | `Scenario Rate` | `Scenario Days` |
| 16 | SQO → SP | *editable* (default: current rate) | *editable* (default: current days) |
| 17 | SP → Neg | *editable* | *editable* |
| 18 | Neg → Signed | *editable* | *editable* |
| 19 | Signed → Joined | *editable* | *editable* |
| 20 | SQO → Joined (product) | `=B16*B17*B18*B19` | `=SUM(C16:C19)` |
| 21 | Mean Joined AUM ($) | *editable* (default: current) | |
| 22 | Expected AUM per SQO ($) | `=B21*B20` | |

Users edit B16:C19 (rates and days) and B21 (AUM). Rows 20 and 22 auto-compute.

**Section 3 — Target Analysis (rows 24+, 13 columns)**

| Col | Header | Source |
|---|---|---|
| A | Quarter | Raw value |
| B | Target AUM ($) | Raw value from DB |
| C | Realization Forecast ($) | `=IFERROR(VLOOKUP(A, 'BQ Realization Forecast'!A6:H{n}, 8, FALSE), 0)` |
| D | Forecast Gap ($) | `=MAX(0, B-C)` |
| E | Expected AUM/SQO (Scenario) | `=$B$22` |
| F | SQOs to Fill Gap | `=CEILING(D/E)` (0 if no gap) |
| G | SQOs Without Forecast | `=CEILING(B/E)` |
| H | Expected AUM/SQO (Current) | `=$B$10*$B$11` |
| I | SQOs (Current Rates) | `=CEILING(B/H)` |
| J | SQO Delta | `=G-I` |
| K | Scenario Velocity (days) | `=$C$20` |
| L | Pipeline Entry Quarter | `="Q"&CEILING(MONTH(DATE(...)-$C$20)/3,1)&" "&YEAR(...)` |
| M | Entry Qtr Status | `=IF(date < TODAY(), "PAST", "")` |

Only future quarters are included (current quarter excluded).

**Section 4 — Sensitivity Matrix**

Header: `SQO→Joined Rate \ Avg Joined AUM`
- 5 AUM columns: $50M, $65M, $80M, $100M, $125M
- 6 rate rows: 10%, 12%, 14%, 16%, 18%, 20%
- Each cell = `CEILING(target / (aum × rate))` (hardcoded integers)

### Current Styling

| Element | Background | Font | Notes |
|---|---|---|---|
| Title row | Dark navy `(0.2, 0.2, 0.3)` | White, bold | |
| Section headers | Dark navy | White, bold | |
| Section 1 data (rows 5-12) | Light gray `(0.93, 0.93, 0.93)` | Normal | Read-only |
| Column header rows | Light gray | Bold | |
| Editable inputs (B16:C19, B21) | Light blue `(0.85, 0.92, 1.0)` | Normal | User edits here |
| Computed rows (20, 22) | Light gray | Normal | Formula-driven |
| Section 3 data | Light gray | Normal | Formula-driven |
| Protected ranges | Warning-only | | Shows warning but allows override |

### Current Number Formatting

| Cells | Format | Example |
|---|---|---|
| Section 1 rates (B6:B10) | `0.0%` | 61.1% |
| Section 1 days (C6:C10) | `#,##0` | 4 |
| Section 1 Mean AUM (B11) | `$#,##0` | $49,823,253 |
| Section 2 rates (B16:B20) | `0.0%` | 61.1% |
| Section 2 days (C16:C20) | `#,##0` | 18 |
| Section 2 AUM (B21, B22) | `$#,##0` | $4,497,933 |
| Section 3 AUM columns (B, C, D, E, H) | `$#,##0` | $1,300,000,000 |

---

## Tab 2: BQ Rates and Days

### Purpose
Historical conversion rates and stage velocity, fully computed from the Audit Trail via Sheets formulas. Every cell is auditable — click to see the SUMPRODUCT/AVERAGEIFS formula referencing the raw data.

### Sections

**Section 1 — Flat Conversion Rates (rows 4-10)**
5 columns: `Transition`, `Rate`, `Numerator`, `Denominator`, `Formula Description`
4 stage transitions + SQO→Joined product. Rate = `IFERROR(SUMPRODUCT(numer)/SUMPRODUCT(denom), "N/A")`.

**Section 2 — Lower Tier Rates (rows 12-18)**
Same structure, filtered by AUM < $75M.

**Section 3 — Upper Tier Rates (rows 20-26)**
Same structure, filtered by AUM >= $75M.

**Section 4 — Average Days in Stage (rows 28-34)**
5 columns: `Transition`, `Avg Days`, `Deals with Data`, ` `, `Formula Description`
4 stage durations + total. Days = `AVERAGEIFS` on Audit Trail days columns where numerator flag = 1.

**Section 5 — Additional Named-Range Values (rows 36-39)**
- Mean Joined AUM ($): `=AVERAGEIFS(AUM, JoinedNumer, 1, AUM, ">0") * 1000000`
- Cohort Count: `=SUMPRODUCT(SP_Denom)`
Both are formulas referencing the Audit Trail — not hardcoded.

**Section 6 — Named Ranges Reference (rows 41+)**
Documentation table listing all 19 named ranges with their cell references and usage.

**Section 7 — Methodology notes**

### Current Number Formatting

| Cells | Format |
|---|---|
| Flat/Lower/Upper rates (B col) | `0.0%` |
| Numerator/Denominator (C-D cols) | `#,##0` |
| Days (B col, rows 29-34) | `#,##0` |
| Mean Joined AUM (B38) | `$#,##0` |
| Days deal counts (C col) | `#,##0` |

### Current Styling
None applied beyond number formatting.

---

## Tab 3: BQ Realization Forecast

### Purpose
The two-component quarterly forecast with full deal-level audit trail. Component A (Neg+Signed pipeline × realization band rate) + Component B (trailing 4Q surprise baseline). Every number traces to individual deals via SUMIFS formulas.

### Sections

**Section 1 — Forecast Summary (rows 1-~8)**
8 columns: `Quarter`, `Neg+Signed Dated Deals`, `Component A AUM ($)`, `Realization Band`, `Realization Rate`, `Pipeline Contribution ($)`, `Surprise Baseline ($)`, `Total Forecast ($)`

- Deals count: `=COUNTIF(Section2_TargetQuarter, quarter)`
- AUM: `=SUMIFS(Section2_AUM, Section2_TargetQuarter, quarter)`
- Band label: `=IF(B<10, "<10 deals → 60%", IF(B<=14, "10-14 deals → 45%", "15+ deals → 35%"))`
- Rate: `=IF(B<10, 0.6, IF(B<=14, 0.45, 0.35))`
- Pipeline Contribution: `=C×E`
- Surprise Baseline: $398,000,000 (hardcoded constant)
- Total: `=F+G`

Only future quarters (current quarter excluded).

**Section 2 — Component A Deal Detail**
9 columns: `Opp ID`, `Advisor`, `Stage`, `AUM ($)`, `Anticipated Date`, `Target Quarter`, `Date Confidence`, `Date Revisions`, `Duration Bucket`
Raw values for each Neg+Signed deal with a future anticipated date. Section 1 formulas reference this range.

**Section 3a — Component B Quarterly Summary**
7 columns: `Quarter`, `Total Joined AUM ($)`, `Component A AUM ($)`, `Realization Rate`, `Component A Pipeline ($)`, `Surprise AUM ($)`, `Notes`
All SUMIFS/AVERAGE formulas referencing Sections 3b and 3c.

**Section 3b — Component A Deal Detail (PIT-reconstructed)**
9 columns: `Opp ID`, `Advisor`, `AUM ($)`, `Stage at Snapshot`, `PIT Anticipated Date`, `Quarter`, `Date Source`, `Joined in Quarter?`, `Join Date`
Data from BigQuery using OpportunityFieldHistory to reconstruct anticipated dates as they were at each quarter's start.

**Section 3c — Joined Deal Detail (Q1-Q4 2025)**
5 columns: `Opp ID`, `Advisor`, `AUM ($)`, `Join Date`, `Joined Quarter`
All deals that joined in Q1-Q4 2025 from vw_funnel_master. AUM > $1,000 filter (excludes placeholder records).

**Section 4 — Model Methodology**
Plain text explaining the two-component model, PIT correction, and backtest MAPE.

### Current Number Formatting

| Cells | Format |
|---|---|
| Section 1: Component A AUM (C), Pipeline Contribution (F), Surprise (G), Total (H) | `$#,##0` |
| Section 1: Realization Rate (E) | `0.0%` |
| Section 3a: Total Joined, Component A, Pipeline, Surprise (B-F) | `$#,##0` |
| Section 3a: Realization Rate (D) | `0.0%` |
| Section 3b: AUM (C) | `$#,##0` |
| Section 3c: AUM (C) | `$#,##0` |

### Current Styling
None applied beyond number formatting.

---

## Tab 4: BQ Forecast P2

### Purpose
Full pipeline detail with per-deal probability, duration penalties, AUM tier segmentation, and projected join dates. The primary analytical dataset.

### Columns (34 total, A-AH)

| Col | Header | Type | Format |
|---|---|---|---|
| A | Opp ID | Raw | |
| B | Advisor | Raw | |
| C | SGM | Raw | |
| D | SGA | Raw | |
| E | Stage | Raw | |
| F | Days in Stage | Raw | |
| G | Raw AUM | Raw | `$#,##0` |
| H | AUM ($M) | Formula: `=G/1000000` | `$#,##0.0` |
| I | AUM Tier | Raw | |
| J | Zero AUM | Raw (YES/NO) | |
| K | Rate SQO→SP | Formula: IF on stage + tier named ranges | `0.0%` |
| L | Rate SP→Neg | Formula | `0.0%` |
| M | Rate Neg→Signed | Formula | `0.0%` |
| N | Rate Signed→Joined | Formula: tier named range | `0.0%` |
| O | Stages Remaining | Raw | |
| P | P(Join) Workings | Formula: TEXT concatenation | |
| Q | P(Join) | Formula: product of K-N | `0.0%` |
| R | Days Remaining | Raw | |
| S | Model Join Date | Raw | |
| T | Anticipated Date | Raw | |
| U | Final Join Date | Raw | |
| V | Date Source | Raw | |
| W | Projected Quarter | Raw | |
| X | Expected AUM | Formula: `=IF(AND(W<>"",J="NO"),G*Q,0)` | `$#,##0` |
| Y | AUM Tier (2-tier) | Raw | |
| Z | Duration Bucket | Raw | |
| AA | Duration Multiplier | Raw | `0.00` |
| AB | Baseline P(Join) | Raw | `0.0%` |
| AC | Adjusted P(Join) | Raw | `0.0%` |
| AD | Baseline Expected AUM | Formula | `$#,##0` |
| AE | Adjusted Expected AUM | Formula | `$#,##0` |
| AF | Date Revisions | Raw | |
| AG | Date Confidence | Raw | |
| AH | First Date Set | Raw | |

### Current Styling
None applied beyond number formatting.

---

## Tab 5: BQ Monte Carlo

### Purpose
Monte Carlo simulation results showing probability distributions (P10/P50/P90/Mean) per quarter and per-deal win rates.

### Sections

**Section 1 — Quarter Summary (rows 4+)**
5 columns: `Quarter`, `P10 (Bear)`, `P50 (Base)`, `P90 (Bull)`, `Mean`
All AUM values formatted as `$#,##0`.

**Section 2 — Rates Used (rows 10-13)**
2 columns: `Transition`, `Rate`
4 stage rates. Formatted as `0.0%`.

**Section 3 — Per-Deal Simulation Detail (rows 16+)**
8 columns: `Opp ID`, `Quarter`, `Win % (of trials)`, `Avg AUM if Won`, `Expected AUM`, `AUM Tier`, `Duration Bucket`, `Duration Multiplier`

| Col | Format |
|---|---|
| Win % (C) | `0.0%` |
| Avg AUM if Won (D) | `$#,##0` |
| Expected AUM (E) | `$#,##0` (formula: `=C*D`) |
| Duration Multiplier (H) | `0.00` |

### Current Styling
None applied beyond number formatting.

---

## Tab 6: BQ SQO Targets

### Purpose
Gap analysis showing how many SQOs are needed per quarter to hit target AUM, accounting for joined deals, projected pipeline, and deal velocity.

### Sections

**Section 1 — Model Inputs (rows 4-13)**
4 columns: `Input`, `Value`, `Source`, `Description`

| Row | Input | Value | Format |
|---|---|---|---|
| 6 | SQO → SP Rate | `='BQ Rates and Days'!$B$6` | `0.0%` |
| 7 | SP → Neg Rate | `='BQ Rates and Days'!$B$7` | `0.0%` |
| 8 | Neg → Signed Rate | `='BQ Rates and Days'!$B$8` | `0.0%` |
| 9 | Signed → Joined Rate | `='BQ Rates and Days'!$B$9` | `0.0%` |
| 10 | SQO → Joined Rate (product) | `=B6*B7*B8*B9` | `0.0%` |
| 11 | Mean Joined AUM ($) | Raw from BQ | `$#,##0` |
| 12 | Expected AUM per SQO ($) | `=B10*B11` | `$#,##0` |
| 13 | Avg Days SQO → Joined | Raw + `='BQ Rates and Days'!$B$34` | `#,##0` |

**Section 2 — Quarterly Gap Analysis (rows 15+)**
12 columns: `Quarter`, `Target AUM ($)`, `Joined AUM ($)`, `Joined Count`, `Projected AUM ($)`, `Total Expected ($)`, `Gap ($)`, `Coverage %`, `Status`, `Incremental SQOs`, `Total SQOs for Target`, `SQO Entry Quarter`

| Col | Source | Format |
|---|---|---|
| B: Target AUM | Raw from DB | `$#,##0` |
| C: Joined AUM | Raw from BQ | `$#,##0` |
| E: Projected AUM | Raw from BQ | `$#,##0` |
| F: Total Expected | `=C+E` | `$#,##0` |
| G: Gap | `=IF(B=0,"",B-F)` | `$#,##0` |
| H: Coverage % | `=IF(B=0,"",F/B)` | `0%` |
| I: Status | IF formula (text) | |
| J: Incremental SQOs | `=CEILING(G/$B$12, 1)` | |
| K: Total SQOs | `=CEILING(B/$B$12, 1)` | |
| L: SQO Entry Quarter | LET-based date math formula | |

### Current Styling
None applied beyond number formatting. A dedicated post-batch format call ensures B6:C10 renders as `0.0%` (not `$`).

---

## Tab 7: BQ Audit Trail

### Purpose
Raw resolved SQO data — the source for all Rates tab formulas. Every conversion rate, velocity metric, and cohort count traces back to this tab.

### Columns (45 total, A-AS)

| Col | Header | Format |
|---|---|---|
| A | Opp ID | |
| B | Salesforce URL | |
| C | Advisor | |
| D | Cohort Month | |
| E | Created Date | |
| F | SGM | |
| G | SGA | |
| H | Source | |
| I | Channel | |
| J | Lead Type | |
| K | SQO | |
| L | Date Became SQO | |
| M-P | Stage Entered (raw): SP, Neg, Signed, Joined | |
| Q | On Hold Entered | |
| R | Closed Entered | |
| S | Join Date | |
| T | Anticipated Start Date | |
| U-X | Stage (backfilled): SP, Neg, Signed, Joined | |
| Y | Days SQO→SP | Formula: `IFERROR(DAYS(...))` | `#,##0` |
| Z | Days in SP | Formula | `#,##0` |
| AA | Days in Neg | Formula | `#,##0` |
| AB | Days in Signed | Formula | `#,##0` |
| AC | Days in Current Stage | Raw | `#,##0` |
| AD | Days SQO→Joined | Formula | `#,##0` |
| AE | Stage | Raw | |
| AF | Status | Raw | |
| AG | AUM ($M) | Raw | `$#,##0.0` |
| AH | On Hold | Raw (YES/NO) | |
| AI | Has Anticipated Date | Raw (YES/NO) | |
| AJ | Stages Skipped | Raw | |
| AK | Joined? | Raw (0/1) | |
| AL | SP Denom | Raw (0/1) | |
| AM | SP Numer | Raw (0/1) | |
| AN | Neg Denom | Raw (0/1) | |
| AO | Neg Numer | Raw (0/1) | |
| AP | Signed Denom | Raw (0/1) | |
| AQ | Signed Numer | Raw (0/1) | |
| AR | Joined Denom | Raw (0/1) | |
| AS | Joined Numer | Raw (0/1) | |

### Current Styling
None applied beyond number formatting.

---

## Named Ranges (19 total)

All point to cells in the `BQ Rates and Days` tab.

| Named Range | Cell | Used By |
|---|---|---|
| `SQO_to_SP_rate` | B6 | Scenario Runner, Forecast P2 |
| `SP_to_Neg_rate` | B7 | Scenario Runner, Forecast P2 |
| `Neg_to_Signed_rate` | B8 | Scenario Runner, Forecast P2 |
| `Signed_to_Joined_rate` | B9 | Scenario Runner, Forecast P2 |
| `SQO_to_Joined_rate` | B10 | Scenario Runner |
| `Lower_SQO_to_SP_rate` | B14 | Forecast P2 (lower tier deals) |
| `Lower_SP_to_Neg_rate` | B15 | Forecast P2 |
| `Lower_Neg_to_Signed_rate` | B16 | Forecast P2 |
| `Lower_Signed_to_Joined_rate` | B17 | Forecast P2 |
| `Upper_SQO_to_SP_rate` | B22 | Forecast P2 (upper tier deals) |
| `Upper_SP_to_Neg_rate` | B23 | Forecast P2 |
| `Upper_Neg_to_Signed_rate` | B24 | Forecast P2 |
| `Upper_Signed_to_Joined_rate` | B25 | Forecast P2 |
| `mean_joined_aum` | B38 | Scenario Runner |
| `cohort_count` | B39 | Scenario Runner |
| `avg_days_sqo_to_sp` | B30 | Scenario Runner |
| `avg_days_in_sp` | B31 | Scenario Runner |
| `avg_days_in_neg` | B32 | Scenario Runner |
| `avg_days_in_signed` | B33 | Scenario Runner |

---

## Cross-Tab References

| From Tab | To Tab | Mechanism |
|---|---|---|
| Rates and Days | Audit Trail | SUMPRODUCT/AVERAGEIFS formulas |
| Scenario Runner | Rates and Days | Named range formulas (`=SQO_to_SP_rate`, etc.) |
| Scenario Runner | Realization Forecast | VLOOKUP into Section 1 summary (col H = Total Forecast) |
| Forecast P2 | Rates and Days | Named range formulas (tier rates in cols K-N) |
| SQO Targets | Rates and Days | Direct cell refs (`='BQ Rates and Days'!$B$6`) |
| Realization Forecast | *(self-contained)* | COUNTIF/SUMIFS within same tab |

---

## BigQuery Data Sources

| Query | Source Table | Purpose | Filter |
|---|---|---|---|
| Pipeline (P2) | `vw_forecast_p2` | Active pipeline deals | All open SQOs |
| Audit Trail | `vw_funnel_audit` | Resolved SQOs for rate computation | Window-filtered |
| Tiered Rates | `vw_funnel_master` | Conversion rates by window | Window-filtered |
| Date Revisions | `OpportunityFieldHistory` | Anticipated date change tracking | All opps |
| Joined by Quarter | `vw_funnel_master` | Joined AUM per quarter | Last 730 days |
| Historical Joined Deals | `vw_funnel_master` | Component B audit trail | Q1-Q4 2025, AUM > $1,000 |
| Component A PIT | `vw_funnel_master` + `OpportunityFieldHistory` | PIT-reconstructed anticipated dates | Q1-Q4 2025, Neg+Signed, AUM > $1,000 |

---

## Infrastructure

### Per-User Folders
Each user gets a named subfolder inside the shared "Forecast exports" Drive folder. First export creates the folder; subsequent exports reuse it.

### Export Deletion
`DELETE /api/forecast/export` accepts `{ id }`, deletes the Google Drive file (non-fatal if already gone), then deletes the DB record. Requires `canRunScenarios` permission.

### Sheet1 Cleanup
The default "Sheet1" tab (auto-created by Drive API) is deleted after all 7 tabs are written.

### Spreadsheet Naming
Format: `Pipeline Forecast — {YYYY-MM-DD} — {userName} ({windowLabel})`
Window labels: `180d`, `365d`, `730d`, `all-time`

---

## Current Styling Summary

### What IS styled
- **BQ Scenario Runner**: Full color treatment — dark navy headers, light blue editable cells, light gray read-only cells, warning-only cell protection, comprehensive number formatting

### What is NOT styled (opportunities for enhancement)
- **BQ Rates and Days**: Number formatting only, no color/header styling
- **BQ Realization Forecast**: Number formatting only, no color/header styling
- **BQ Forecast P2**: Number formatting only, no color/header styling
- **BQ Monte Carlo**: Number formatting only, no color/header styling
- **BQ SQO Targets**: Number formatting only, no color/header styling
- **BQ Audit Trail**: Number formatting only, no color/header styling

### Styling Patterns Available
The Scenario Runner establishes a visual language that could be extended to other tabs:

| Pattern | Color | Use |
|---|---|---|
| Section headers | Dark navy `(0.2, 0.2, 0.3)` + white bold text | Major section dividers |
| Column headers | Light gray `(0.93, 0.93, 0.93)` + bold | Table headers |
| Read-only data | Light gray background | Computed/formula cells |
| Editable inputs | Light blue `(0.85, 0.92, 1.0)` | User-editable cells |
| Protection | Warning-only | Prevents accidental edits |

### Number Format Patterns Used

| Pattern | Meaning | Example |
|---|---|---|
| `0.0%` | Percentage to 1 decimal | 61.1% |
| `$#,##0` | US dollar, no decimals | $49,823,253 |
| `$#,##0.0` | US dollar, 1 decimal (for $M) | $49.8 |
| `#,##0` | Integer with thousands separator | 1,234 |
| `0.00` | Decimal to 2 places | 0.18 |
| `0%` | Percentage, no decimals | 44% |
