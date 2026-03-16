# Claude Code Prompt: Update Implementation Guide from Exploration Findings

Copy everything below the line into Claude Code.

---

You are updating `C:\Users\russe\Documents\Dashboard\agentic_implementation_guide.md` based on findings from `C:\Users\russe\Documents\Dashboard\forecast_sheet_exploration.md`.

## Instructions

1. Read BOTH files completely before making any changes.
2. Apply each revision below to the implementation guide. These are targeted updates — do NOT rewrite sections that aren't mentioned. Preserve the existing phase structure, validation gates, and STOP AND REPORT patterns.
3. After all revisions are applied, read the updated file back to verify consistency — make sure no step references a model field that was renamed, no query references a removed constant, etc.

## Revisions to Apply

### REVISION 1: Add exploration reference to header

In the "Reference Document" section at the top, add `forecast_sheet_exploration.md` to the list:
```
- `forecast_sheet_exploration.md` (updated sheet structure, formula patterns, data alignment validation)
```

Also add this line after the existing "Human-verified decisions" note:
```
The exploration confirmed the following sheet structure: 26 sub-sources across 7 Finance_View channels, 
3-tier rollup (detail sections → channel summary → total), monthly-first waterfall calculations, 
and SGA-based Created volumes for Outbound. See Phase 8 of the exploration for the canonical reference tables.
```

---

### REVISION 2: Update Feature Summary — monthly-first waterfall

The exploration (Phase 3.4, 7.1, 8.2) proved that the sheet computes monthly waterfalls first, then sums to quarterly. The current guide's `ForecastLineItem` and `ForecastRateItem` models already store at the monthly grain, which is correct. But the Feature Summary table row for "Waterfall volume calculations" should be updated. Change:

```
| Waterfall volume calculations | Computed in app | Created × rate1 × rate2 × ... down the funnel |
```
to:
```
| Waterfall volume calculations | Computed in app — monthly-first | Monthly: Created × rate chain. Quarterly = SUM(3 months). Rates are per-month, not per-quarter. |
```

---

### REVISION 3: Update the ForecastSource model — add bqSourceMapping

The exploration (Phase 8.1, issue #6) found "Google Ads + LinkedIn Ads" as a combined sub-source with no single BQ equivalent. The ForecastSource model needs a field to map one forecast line to multiple BQ Original_source values for actuals comparison.

In Step 2.3, add this field to the `ForecastSource` model after `isManual`:
```prisma
  bqSourceMapping String[] @default([]) // BQ Original_source values this maps to (e.g., ["Google Ads", "LinkedIn Ads"] for combined sources). Empty = subSource is the BQ key.
```

And add a comment above the model:
```prisma
// bqSourceMapping handles combined sub-sources (e.g., "Google Ads + LinkedIn Ads" maps to 
// ["Google Ads", "LinkedIn Ads"] in BQ). When empty, subSource is used directly as the BQ key.
```

---

### REVISION 4: Update ForecastAssumption model — structured SGA assumptions

The exploration (Phase 3.3) revealed the Outbound SGA assumption structure: shared SGA counts per month across all Outbound sub-sources, but different per-SGA sourcing rates per sub-source (200 for Provided List, 200 for LinkedIn, 80 for Fintrx), plus a "Lauren Overlay" person-level adjustment.

The current `ForecastAssumption` model with its key-value `assumptionKey`/`assumptionValue` pattern can handle this, but we should document the expected keys. In Step 2.7, add this comment block above the model:

```prisma
// Standard assumption keys for Outbound:
//   "sga_count" — channel=Outbound, month="2026-04", value="14.5"
//   "sourcing_rate_per_sga" — channel=Outbound, subSource="Fintrx (Self-Sourced)", value="80"
//   "sourcing_rate_per_sga" — channel=Outbound, subSource="Provided List (Lead Scoring)", value="200"
//   "person_overlay" — channel=Outbound, subSource=NULL, month="2026-04", value="0.5" (e.g., Lauren partial allocation)
// SGA counts are shared across all Outbound sub-sources for a given month.
// Created volume = sourcing_rate_per_sga × (sga_count + person_overlay) for that month.
// Standard assumption keys for global:
//   "sqo_to_joined_override" — channel=NULL, value="0.15"
```

---

### REVISION 5: Add rate seeding fallback for new sources

The exploration (Phase 7.1, 7.2) showed that Fintrx's quarterly AVERAGE(C:E) formula produces 0% for most rates because it has no pre-Q1-2026 history. The sheet handles this by having the user manually hardcode monthly rates borrowed from LinkedIn Self Sourced. 

In Phase 4.2 (forecast-rates.ts), after the current description of the trailing 90-day rate query, add this section:

```markdown
## Step 4.2b: Rate seeding fallback for new/sparse sources

When a source has insufficient trailing-90-day data (fewer than 5 records in the denominator), 
the rate calculation should return `null` instead of a potentially meaningless rate.

The API route (Phase 5) must handle this by:
1. Running the trailing-90-day query for all sources
2. For any source where a transition returns `null`:
   a. Check if a `ForecastAssumption` exists with key `"rate_seed_from"` for that source
      (e.g., channel="Outbound", subSource="Fintrx (Self-Sourced)", value="LinkedIn (Self Sourced)")
   b. If found, copy that source's calculated rates as the default
   c. If not found, return null — the UI will show "Insufficient data — set manually or copy from another source"
3. The UI should offer a "Copy rates from..." dropdown that lists other sources in the same channel

This matches the sheet's pattern where Fintrx monthly rates were manually set to match LinkedIn Self Sourced:
- Created→Contacted: 87.69% (from LinkedIn SS)
- Contacted→MQL: 2.30% (from LinkedIn SS)  
- MQL→SQL: 40.00% (from LinkedIn SS)
- SQL→SQO: 71.00% (from LinkedIn SS)
```

---

### REVISION 6: Update waterfall service — monthly-first computation

The current guide likely describes the waterfall as quarterly. Based on the exploration (Phase 8.2), the waterfall must be computed monthly then summed.

Find any section that describes the waterfall computation (likely in Phase 4 or Phase 6 where the forecast computation endpoint is defined). Add or replace with this specification:

```markdown
## Waterfall Computation Rules (from exploration Phase 8.2)

The waterfall is computed **monthly-first**, matching the Google Sheet's proven methodology:

**Monthly calculation (for each sub-source × month):**
```
Created = [from SGA assumptions (Outbound) or manual input (other channels)]
Contacted = Created × Created→Contacted rate (monthly rate, not quarterly)
MQL = Contacted × Contacted→MQL rate
SQL = MQL × MQL→SQL rate  
SQO = SQL × SQL→SQO rate
Joined = SQO × SQO→Joined rate
```

**Quarterly rollup:**
```
Q_Created = SUM(Apr_Created, May_Created, Jun_Created)
Q_Contacted = SUM(Apr_Contacted, May_Contacted, Jun_Contacted)
Q_MQL = SUM(Apr_MQL, May_MQL, Jun_MQL)
... (same for all stages)
```

**IMPORTANT: Quarterly rate ≠ AVERAGE of monthly rates.**
The quarterly rate column is DISPLAY ONLY — computed as Q_StageOut / Q_StageIn.
For example: Q_MQL_to_SQL_rate = Q_SQL / Q_MQL (not AVERAGE of monthly MQL→SQL rates).
The exploration confirmed this: Fintrx G137 (quarterly Contacted→MQL) = 0% via AVERAGE(C:E), 
but the actual quarterly MQL volume (G138=75) is correct because it sums monthly volumes 
which use the hardcoded monthly rate (2.3%), not the quarterly rate.

**Created volume sources (by channel type):**
- Outbound: `sourcing_rate_per_sga × sga_count_for_month` (from ForecastAssumption)
- All other channels: manually entered volume per month (stored directly on ForecastLineItem)
```

---

### REVISION 7: Update actuals query — fix period_type filter

The exploration (Phase 6.1, issue #2) found that the sheet's SUMPRODUCT formulas match BOTH "QTD" and "QUARTERLY" period_type, causing small prospect count discrepancies (+48 for Provided List, +18 for LinkedIn SS) due to double-counting when both row types exist for the same quarter.

In Phase 4.3 (forecast-actuals.ts), add this warning comment at the top of the query:

```markdown
**CRITICAL: Period type filtering**
- For completed quarters: use `period_type = 'QUARTERLY'` ONLY
- For the current (in-progress) quarter: use `period_type = 'QTD'` ONLY  
- NEVER combine both — the Google Sheet does this and it causes double-counting of prospects_created
  (exploration found +48 discrepancy for Provided List, +18 for LinkedIn SS in Q4 2025)

The dashboard should determine quarter completeness: if the current date is past the quarter's end date,
use QUARTERLY; otherwise use QTD.
```

Also update any BQ query in the actuals function that currently uses `period_type IN ('QTD', 'QUARTERLY')` to use the correct single value.

---

### REVISION 8: Update source taxonomy — add canonical mapping table

The exploration (Phase 8.1) produced the definitive source inventory. Add this as a new section after the Feature Summary:

```markdown
## Canonical Source Taxonomy (from exploration Phase 8.1)

26 sub-sources across 7 Finance_View channels. Dashboard must support all ACTIVE and NEW sources; 
PLACEHOLDER sources should be available but hidden by default.

| # | Finance_View | Sub-Source | Status | BQ Original_source | Notes |
|---|-------------|-----------|--------|-------------------|-------|
| 1 | Outbound | Provided List (Lead Scoring) | ACTIVE | Provided List (Lead Scoring) | SGA-based: 200/SGA |
| 2 | Outbound | LinkedIn (Self Sourced) | ACTIVE | LinkedIn (Self Sourced) | SGA-based: 200/SGA |
| 3 | Outbound | Fintrx (Self-Sourced) | NEW | Fintrx (Self-Sourced) | SGA-based: 80/SGA. Rates seeded from LinkedIn SS. |
| 4 | Marketing | Direct Traffic | ACTIVE | Direct Traffic | Sheet has duplicate section — use 2nd (row 253) |
| 5 | Marketing | Google Ads + LinkedIn Ads | ACTIVE | ["Google Ads", "LinkedIn Ads"] | Combined — needs bqSourceMapping |
| 6 | Marketing | Job Applications | ACTIVE | Job Applications | |
| 7 | Outbound + Marketing | Events | ACTIVE | Events | |
| 8 | Outbound + Marketing | Provided List (Marketing) | ACTIVE | Provided List (Marketing) | |
| 9 | Re-Engagement | Re-Engagement | ACTIVE | Re-Engagement | Non-standard funnel: monthly rates ≠ quarterly |
| 10 | Partnerships | Recruitment Firm | ACTIVE | Recruitment Firm | High conversion rates (>90% at some stages) |
| 11 | Advisor Referrals | Advisor Referral | ACTIVE | Advisor Referral | Very small volumes |
| 12 | Other | Other | ACTIVE | Other | |
| 13-26 | Various | Blog, Search, LinkedIn Savvy, etc. | PLACEHOLDER | Various/N/A | Zero forecast, kept as future channel slots |

**BQ sources NOT in sheet:** Employee Referral (Partnerships), Partnerships (Partnerships) — tracked in BQ but no forecast section.
**Sheet has duplicate Direct Traffic:** Row 227 (superseded, no forecast) and row 253 (active). Dashboard enforces uniqueness.
```

---

### REVISION 9: Update historical data section — rate methodology note

The exploration (Phase 6.2) found that the BQ conversion rates view uses a DIFFERENT calculation methodology than simple volume ratios. For LinkedIn SS Q4 2025: `created_to_contacted_rate` from BQ = 94.49%, but `contacted_count / prospects_created` = 89.6%.

Add this to the Architecture Rules section:

```markdown
- Historical conversion rates MUST be pulled from `vw_channel_conversion_rates_pivoted` directly — 
  do NOT derive rates from volume ratios in `vw_channel_funnel_volume_by_month`. 
  The rate view uses cohorted attribution methodology that produces different values than simple division.
  (Exploration Phase 6.2: LinkedIn SS Q4 2025 rate=94.49% vs volume ratio=89.6%)
```

---

### REVISION 10: Update the Data Edge Cases table

Add these rows to the "Data Edge Cases" table in the Troubleshooting Appendix:

```markdown
| Fintrx quarterly rates = 0% | AVERAGE of 3 empty quarters | Monthly rates are the real forecast; quarterly G column is display-only (SUM of monthly volumes) |
| Duplicate Direct Traffic sections | Sheet has rows 227 AND 253 | Dashboard unique constraint prevents this; use row 253 data (has forecast) |
| Google Ads + LinkedIn Ads combined | No single BQ Original_source | Use bqSourceMapping ["Google Ads", "LinkedIn Ads"] to sum actuals |
| SUMPRODUCT double-counting | Sheet matches QTD+QUARTERLY | Dashboard uses QUARTERLY only for completed quarters, QTD only for current |
| Re-Engagement rate divergence | Quarterly avg=25% but monthly=92% for SQL→SQO | Monthly-first waterfall handles this correctly; quarterly rate is display-only |
```

---

### REVISION 11: Update Known Limitations

Add these rows to the "Known Limitations" table:

```markdown
| Q1 2026 excluded from sheet's rate average | Sheet uses AVERAGE(Q2-Q4 2025), skipping Q1 2026. Dashboard uses trailing 90-day instead. |
| Fintrx rate labels use ">" not "→" | Sheet inconsistency. Dashboard normalizes all labels. Not a data issue. |
| Lauren Overlay assumption | 0.5 SGA adjustment for a specific person. Supported via person_overlay assumption key. |
| 3 Outbound sub-sources share SGA counts | SGA counts (14.5/16/16) are per-month, shared across Provided List, LinkedIn SS, and Fintrx. Each has its own sourcing_rate_per_sga. |
```

---

### REVISION 12: Verify consistency after all changes

After applying all 11 revisions above:

1. Read the full updated file
2. Search for any reference to "quarterly rate × quarterly volume" waterfall logic and update it to monthly-first
3. Search for any query that filters on `period_type IN ('QTD', 'QUARTERLY')` and add a comment about the double-counting risk  
4. Verify the ForecastSource model includes bqSourceMapping
5. Verify the ForecastAssumption model comment documents the SGA assumption keys
6. Verify no section contradicts the monthly-first waterfall rule
7. Save the file

## What NOT to Change

- Do NOT change the phase numbering or phase structure
- Do NOT change the validation gate patterns or STOP AND REPORT checkpoints
- Do NOT rewrite the Prisma migration SQL (just the schema additions)
- Do NOT modify the Google Sheets export section (Phase 9) — it's already correct
- Do NOT modify the UI components section (Phase 8) beyond any waterfall display logic
- Do NOT remove any existing content unless explicitly told to replace it above
- Do NOT change the BQ sync section (Phase 12 equivalent) unless it references quarterly-only computation

## Start

Read both files now, then apply revisions 1 through 12 in order. Save after each revision. Final verification pass at the end.
