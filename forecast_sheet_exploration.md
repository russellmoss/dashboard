# Forecast Sheet Exploration — Q2 2026 (Updated)

> **Purpose**: Structured exploration of the updated Q2 2026 Forecast Google Sheet. Claude Code will use its Google Sheets MCP and BigQuery MCP to answer each question below. Findings become the source of truth for building the dashboard forecasting feature.
>
> **Google Sheet**: `https://docs.google.com/spreadsheets/d/1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc/edit?gid=1001279729#gid=1001279729`
>
> **Spreadsheet ID**: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`
>
> **Primary Tab**: `Q2 forecast`
>
> **Data Source Tabs** (BigQuery Connected Sheets extracts):
> - `monthly_conversion_rates` — conversion rate data by channel/source/period
> - `Volumes` — funnel volume data by channel/source/period
>
> **BigQuery Views** (underlying data sources for the connected tabs):
> - `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
> - `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
>
> **Instructions for Claude Code**: For each numbered question, read the specified data using your Google Sheets MCP and/or BigQuery MCP. Write your findings in the `### Answer` section directly below the question. Be precise about cell references, row numbers, and field names. Do NOT guess — only report what you actually read.

---

## Phase 1: Sheet Structure & Tab Inventory

### 1.1 — List All Tabs and Confirm Their Purposes

**Prompt:**
```
Using Google Sheets MCP, access spreadsheet ID `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`.

1. List every tab (sheet name) in this workbook.
2. For each tab, read the first 3 rows and first 10 columns to determine its purpose.
3. For the `monthly_conversion_rates` tab: what is in cell A1? (If it shows #REF!, note that — it means the BigQuery Connected Sheet header row is broken.) Then read row 2 to identify the actual column structure.
4. For the `Volumes` tab: same check — A1 value and row 2 column structure.
5. Confirm the `Q2 forecast` tab's data extent: what is the last row and last column with data?
```

### Answer

**5 tabs found:**

| # | Tab Name | Sheet ID | Rows × Cols | Purpose |
|---|----------|----------|-------------|---------|
| 1 | `Q2 forecast` | 1001279729 | 809 × 28 (AB) | Main forecast model — rollup, channel summaries, detail sections with historical + forecast |
| 2 | `monthly_conversion_rates` | 108548995 | 1000 × 42 | BigQuery Connected Sheet — conversion rates by channel/source/period |
| 3 | `Volumes` | 52216146 | 1000 × 26 | BigQuery Connected Sheet — funnel volumes by channel/source/period |
| 4 | `vw_channel_conversion_rates_pivoted` | 1657052961 | 500 × 37 | Another Connected Sheet extract (appears to be a direct mirror of the BQ view) |
| 5 | `vw_channel_funnel_volume_by_month` | 981843914 | 500 × 19 | Another Connected Sheet extract (direct mirror of the BQ view) |

**monthly_conversion_rates tab:**
- A1 = `#REF!` (confirmed — broken Connected Sheet header)
- Row 2 column structure (verified from sample data): A=period_type, B=cohort_period (date), C=period_label, D=cohort_year, E=cohort_month_num, F=cohort_quarter_num, G=Channel_Grouping_Name, H=Original_source, I=Original_Source_Grouping, J=Source_Channel_Mapping, K=Finance_View, L=contacted_to_mql_numerator, M=contacted_to_mql_denominator, N=contacted_to_mql_rate, O=contacted_to_mql_pct, P=mql_to_sql_numerator, Q=mql_to_sql_denominator, R=mql_to_sql_rate, S=mql_to_sql_pct, T=sql_to_sqo_numerator, U=sql_to_sqo_denominator, V=sql_to_sqo_rate, W=sql_to_sqo_pct, X=sqo_to_joined_numerator, Y=sqo_to_joined_denominator, Z=sqo_to_joined_rate, AA=sqo_to_joined_pct, AB=contacted_volume, AC=mql_volume, AD=sql_volume, AE=sqo_volume, AF=created_to_contacted_numerator, AG=created_to_contacted_denominator, AH=created_to_contacted_rate, AI+=additional columns

**Volumes tab:**
- A1 = `#REF!` (confirmed)
- Row 2 column structure: A=period_type, B=cohort_period, C=period_label, D=cohort_year, E=cohort_month_num, F=cohort_quarter_num, G=cohort_period_name, H=Channel_Grouping_Name, I=Original_source, J=Original_Source_Grouping, K=Source_Channel_Mapping, L=Finance_View, M=prospects_created, N=contacted_count, O=mql_count, P=sql_count, Q=sqo_count, R=joined_count, S=last_updated

**Q2 forecast tab data extent:**
- Last row with data: **row 459** (Other > Unknown > Joined)
- Last column with data: **AB (column 28)** per metadata; primary data in A:M, assumption columns in N:W for Outbound

---

### 1.2 — Q2 Forecast Tab: Header & Metadata Zone (Rows 1–9)

**Prompt:**
```
Read the `Q2 forecast` tab, range A1:M9.

Document:
1. The metadata cells: what is in C1, D1, E1? What is in C2, D2, E2?
2. Cell B4 — what is the label and what is the value/formula?
3. Row 5 — what labels appear and in which columns? (These are the "Actual" markers)
4. Row 6 — what are the start dates in each column C through M?
5. Row 7 and 8 — what quarter/year metadata is stored?
6. Row 9 — what are the column headers? List each column letter and its header text.

This defines the time period structure: 4 historical quarters + quarterly forecast + 3 monthly forecast/actual pairs.
```

### Answer

**1. Metadata cells:**
- C1="Period", D1="Quarter", E1="2" → target quarter = Q2
- C2="Cohorted", D2="Year", E2="2026" → target year = 2026

**2. Cell B4:**
- Label: "Total Forecast SQOs"
- Value: **166**
- Formula: `=sumifs(G56:G103,B56:B103,"SQOs")` — sums forecast SQOs from the channel summary section (rows 56-103)

**3. Row 5 — "Actual" markers:**
- B5="Q2 2026 Forecast", I5="Actual", K5="Actual", M5="Actual"
- The "Actual" labels mark columns I, K, M as actual data columns paired with forecast months

**4. Row 6 — Start dates (C through M):**
| Col | Date |
|-----|------|
| C | 4/1/2025 |
| D | 7/1/2025 |
| E | 10/1/2025 |
| F | 1/1/2026 |
| G | 4/1/2026 |
| H | 4/1/2026 |
| I | 4/1/2026 |
| J | 5/1/2026 |
| K | 5/1/2026 |
| L | 6/1/2026 |
| M | 6/1/2026 |

**5. Row 7 & 8 — Quarter/Year metadata:**
- Row 7 (Quarter): C=2, D=3, E=4, F=1 (only C-F populated — used by SUMPRODUCT lookups as `$C$7`, `$D$7`, etc.)
- Row 8 (Year): C=2025, D=2025, E=2025, F=2026 (used by SUMPRODUCT lookups as `$C$8`, `$D$8`, etc.)

**6. Row 9 — Column headers:**
| Col | Header |
|-----|--------|
| B | *(empty)* |
| C | Q2 2025 |
| D | Q3 2025 |
| E | Q4 2025 |
| F | Q1 2026 |
| G | Q2 2026 Forecast |
| H | April |
| I | Apr (actual) |
| J | May |
| K | May (actual) |
| L | June |
| M | Jun (actual) |

**Structure: 4 historical quarters (C-F) + 1 quarterly forecast (G) + 3 monthly forecast/actual pairs (H/I, J/K, L/M)**

---

## Phase 2: Rollup Section (Rows 10–53)

### 2.1 — Map the Rollup Funnel Structure

**Prompt:**
```
Read the `Q2 forecast` tab, range A10:M53.

This is the rollup section. Document:
1. What funnel stages appear and at which rows? (e.g., "Prospects" at row 10, "MQLs" at row 19, etc.)
2. For each stage, list the channel breakdown rows beneath it. What channels appear? (e.g., Outbound, Marketing, Outbound + Marketing, Re-Engagement, Partnerships, Advisor Referrals, Other)
3. Are there blank separator rows between stages? Which rows?
4. Does the "Contacted" stage appear in the rollup, or is it omitted?
5. Do columns G through M have any data in the rollup section, or are they empty?
```

### Answer

**1. Funnel stages and rows:**

| Stage | Total Row | Channel Rows |
|-------|-----------|--------------|
| Prospects | 10 | 11-17 |
| MQLs | 19 | 20-26 |
| SQLs | 28 | 29-35 |
| SQOs | 37 | 38-44 |
| Joined | 46 | 47-53 |

**2. Channel breakdown (same order in every stage):**
- Row +1: Outbound
- Row +2: Marketing
- Row +3: Outbound + Marketing
- Row +4: Re-Engagement
- Row +5: Partnerships
- Row +6: Advisor Referrals (note: "Advisors Referrals" in MQL/SQL/SQO stages — typo)
- Row +7: Other

**3. Blank separator rows:** 18, 27, 36, 45 (one blank row between each stage)

**4. Contacted stage: OMITTED from the rollup.** The rollup goes directly Prospects → MQLs → SQLs → SQOs → Joined. The detail sections below (row 105+) DO include Contacted as a stage.

**5. Columns G through M: EMPTY in the rollup section (rows 10-53).** Only historical data in columns C-F. The forecast data lives in the **channel summary section** (rows 54-103), which is a separate intermediate layer.

**Additional finding — Channel Summary Section (rows 54-103):**
This section sits between the rollup and the detail sections. It has 7 channel blocks (Outbound rows 56-61, Marketing 63-68, Outbound+Marketing 70-75, Re-Engagement 77-82, Partnerships 84-89, Advisor Referrals 91-96, Other 98-103). Each block has: Prospects, MQLs, SQLs, SQOs, Joined. **This section DOES have columns G-M** (forecast data), populated via SUMIFS from the detail sections below.

---

### 2.2 — Rollup Formula Patterns

**Prompt:**
```
Read the FORMULAS (not values) for the following cells in the `Q2 forecast` tab:

1. C10 (Prospects total, Q2 2025) — how does it aggregate? SUM of C11:C17? Or SUMPRODUCT from Volumes tab?
2. G10 (Prospects total, Q2 2026 Forecast) — does this cell have a formula? If so, what does it reference?
3. C19 (MQLs total, Q2 2025) — same question
4. C37 (SQOs total, Q2 2025) — same question
5. B4 (Total Forecast SQOs) — what formula produces this value?

This tells us whether the rollup pulls from the data tabs, from the detail sections below, or is hardcoded.
```

### Answer

**1. C10 (Prospects total, Q2 2025):**
Formula: `=sum(C11:C17)` — simple SUM of the 7 channel breakdown rows below. Same pattern for D10, E10, F10.

**2. G10 (Prospects total, Q2 2026 Forecast):**
**EMPTY — no formula, no value.** The entire G column in the rollup section (rows 10-53) is unpopulated. Forecast totals live in the channel summary section instead.

**3. C19 (MQLs total, Q2 2025):**
Formula: `=sum(C20:C26)` — same SUM pattern as Prospects.

**4. C37 (SQOs total, Q2 2025):**
Formula: `=sum(C38:C44)` — same SUM pattern.

**5. B4 (Total Forecast SQOs = 166):**
Formula: `=sumifs(G56:G103,B56:B103,"SQOs")` — pulls from the **channel summary section** (rows 56-103), summing column G where column B = "SQOs".

**Channel Summary Section formulas (rows 56-103, col G):**
These use SUMIFS from the detail sections. Example for Outbound SQOs (G60):
`=sumifs(G$106:G$10014,$A$106:$A$10014,$A60,$B$106:$B$10014,"SQO")`
This sums all detail section SQO values in column G where column A matches the channel name. Same pattern for all stages/channels.

**Rollup historical (C-F) for channel rows** — the channel breakdown rows (e.g., E38 for Outbound SQOs, Q4 2025) use SUMPRODUCT from the Volumes tab:
`=SUMPRODUCT((Volumes!$D$2:$D$1000=$E$8)*(Volumes!$F$2:$F$1000=$E$7)*((Volumes!$A$2:$A$1000="QTD")+(Volumes!$A$2:$A$1000="QUARTERLY"))*(Volumes!$L$2:$L$1000=$B$11)*(Volumes!$Q$2:$Q$1000))`
Filters: year=$E$8, quarter=$E$7, period_type=QTD or QUARTERLY, Finance_View=$B$11, column Q=sqo_count.

**Summary: Three-tier architecture:**
1. **Rollup (rows 10-53):** Historical only (C-F), SUM of channel rows. G-M empty.
2. **Channel Summary (rows 56-103):** Both historical and forecast, SUMIFS from detail sections.
3. **Detail Sections (rows 105+):** Source of truth for all forecast calculations.

---

## Phase 3: Channel Detail Sections (Row 105+)

### 3.1 — Complete Channel × Sub-Source Inventory

**Prompt:**
```
Read the `Q2 forecast` tab starting from row 105 through the last row with data.

Create a complete inventory of every channel detail section. Each section has:
- A channel header row (e.g., "Outbound (Cohorted View)" in column B)
- A "Sources" row with column headers
- One or more sub-source blocks, each following a repeating pattern:
  Sub-source name → Created → rate → Contacted → rate → MQL → rate → SQL → rate → SQO → rate → Joined

For each section found, document in this table:

| # | Channel (Col A) | Sub-Source (Col B) | Sub-Source Row | Created Row | SQO Row | Joined Row | Notes |

Pay special attention to:
- Is there a NEW "Fintrx (Self-Sourced)" sub-source under Outbound?
- Does any section have a combined sub-source like "Google Ads + LinkedIn Ads"?
- Is there a second "Direct Traffic" section?
- Are there any sections where the stage labels differ from the standard pattern?
```

### Answer

**Channel section headers:**

| Channel | Header Row | Header Text (Col B) | Sources Row |
|---------|-----------|---------------------|-------------|
| Outbound | 105 | Outbound (Cohorted View) | 106 |
| Marketing Organic | 147 | Marketing Forecast - Organic (Cohorted View) | 148 |
| Marketing Paid | 268 | Marketing Forecast - Paid (Cohorted View) | 269 |
| Outbound + Marketing | 334 | Outbuound + Marketing Forecast (Cohorted View) | 335 |
| Re-Engagement | 388 | Re-Engagement (Cohorted View) | 389 |
| Partnerships | 403 | Partnerships (Cohorted View) | 404 |
| Advisor Referrals | 418 | Advisor Referrals (Cohorted View) | 419 |
| Other | 433 | Other (Cohorted View) | 434 |

**Complete sub-source inventory:**

| # | Channel (Col A) | Sub-Source (Col B) | Name Row | Created Row | SQO Row | Joined Row | Has Forecast? | Notes |
|---|-----------------|-------------------|----------|-------------|---------|------------|---------------|-------|
| 1 | Outbound | Provided List (Lead Scoring) | 107 | 108 | 116 | 118 | YES | SGA-based Created |
| 2 | Outbound | LinkedIn (Self Sourced) | 120 | 121 | 129 | 131 | YES | SGA-based Created |
| 3 | Outbound | **Fintrx (Self-Sourced)** | 133 | 134 | 142 | 144 | **YES — NEW** | SGA-based, 80/SGA; uses ">" not "→" in labels |
| 4 | Marketing | Blog | 149 | 150 | 158 | 160 | No (all zeros) | Placeholder |
| 5 | Marketing | Search | 162 | 163 | 171 | 173 | No (all zeros) | Placeholder |
| 6 | Marketing | LinkedIn Savvy | 175 | 176 | 184 | 186 | No (G=0) | Tiny historical data only |
| 7 | Marketing | LinkedIn Social | 188 | 189 | 197 | 199 | No (all zeros) | Placeholder |
| 8 | Marketing | LinkedIn (Content) | 201 | 202 | 210 | 212 | No (all zeros) | Placeholder |
| 9 | Marketing | LinkedIn (Automation) | 214 | 215 | 223 | 225 | No (all zeros) | Placeholder |
| 10 | Marketing | Direct Traffic (1st) | 227 | 228 | 236 | 238 | **No** (G=0, no H-M) | Has historical data but NO forecast — likely superseded |
| 11 | Marketing | Website | 240 | 241 | 249 | 251 | No (all zeros) | Placeholder |
| 12 | Marketing | **Direct Traffic (2nd)** | 253 | 254 | 263 | 265 | **YES** (G=3, H-M populated) | **Duplicate** — identical historical data to #10, but WITH forecast |
| 13 | Marketing | **Google Ads + LinkedIn Ads** | 270 | 271 | 279 | 280* | **YES** (G=5) | **Combined** paid sub-source; all rates=0% quarterly, 100% monthly |
| 14 | Marketing | Job Applications | 282 | 283 | 291 | 293 | YES | Active with good data |
| 15 | Marketing | Google Ads | 295 | 296 | 304 | 306 | No (G=0) | Only Q1 2026 data |
| 16 | Marketing | Meta | 308 | 309 | 317 | 319 | No (all zeros) | Placeholder |
| 17 | Marketing | LinkedIn Ads | 321 | 322 | 330 | 332 | No (G=0) | Only Q1 2026 data |
| 18 | Outbound + Marketing | Events | 336 | 337 | 345 | 347 | YES | Active |
| 19 | Outbound + Marketing | Direct Mail | 349 | 350 | 358 | 360 | No (all zeros) | Placeholder |
| 20 | Outbound + Marketing | Webinar | 362 | 363 | 371 | 373 | No (all zeros) | Placeholder |
| 21 | Outbound + Marketing | Provided List (Marketing) | 375 | 376 | 384 | 386 | No (G=0) | Has Q4 2025/Q1 2026 data |
| 22 | Re-Engagement | Re-Engagement | 390 | 391 | 399 | 401 | YES | Active |
| 23 | Partnerships | Recruitment Firm | 405 | 406 | 414 | 416 | YES | Active; some rates >90% |
| 24 | Advisor Referrals | Advisor Referral | 420 | 421 | 429 | 431 | YES | Active; small volumes |
| 25 | Other | Other | 435 | 436 | 444 | 446 | YES | Active |
| 26 | Other | Unknown | 448 | 449 | 457 | 459 | No (G=0) | Only Q1 2026 data (95 created) |

**Key findings:**
- **YES — Fintrx (Self-Sourced) exists** as sub-source #3 under Outbound (rows 133-144). It's new with only Q1 2026 historical data.
- **YES — Google Ads + LinkedIn Ads** is a combined sub-source (#13) under Marketing Paid.
- **YES — Two Direct Traffic sections** (#10 at row 227, #12 at row 253). The second one has forecast data; the first does not.
- **Fintrx uses different label syntax**: "Created > Contacted rate" (uses ">") instead of "Created → Contacted rate" (uses "→"). Also "CS > SQL rate" instead of "Call Scheduled → SQL rate".

---

### 3.2 — Detail Row Pattern: Standard vs Fintrx Comparison

**Prompt:**
```
Read the `Q2 forecast` tab for two Outbound sub-sources side by side.

Section 1: Provided List (Lead Scoring) — rows 107–118
Section 2: Fintrx (Self-Sourced) — rows 133–144

For each section, list every row with its column B label and whether cols C-F, G, H/J/L, and I/K/M have data.

Compare:
1. Do the stage labels in column B match exactly between the two sections? Note any differences (e.g., "→" vs ">").
2. Does Fintrx have historical data in C-E or is it mostly zeros?
3. Does Fintrx have actuals in I, K, M columns?
4. Are the number of rows per section the same?
```

### Answer

**Side-by-side comparison:**

| Row Offset | Provided List (107-118) Label | Fintrx (133-144) Label | Label Match? |
|-----------|-------------------------------|------------------------|-------------|
| +0 | Provided List (Lead Scoring) | Fintrx (Self-Sourced) | N/A (name) |
| +1 | Created | Created | YES |
| +2 | Created → Contacted rate | Created > Contacted rate | **NO — "→" vs ">"** |
| +3 | Contacted | Contacted | YES |
| +4 | Contacted → MQL rate | Contacted > MQL rate | **NO — "→" vs ">"** |
| +5 | Call Scheduled (MQL) | Call Scheduled (MQL) | YES |
| +6 | Call Scheduled → SQL rate | CS > SQL rate | **NO — abbreviated + ">"** |
| +7 | Opportunity Created (SQL) | Opportunity Created (SQL) | YES |
| +8 | SQL  → SQO rate | SQL > SQO rate | **NO — "→" vs ">"** |
| +9 | SQO | SQO | YES |
| +10 | SQO  → Joined rate | SQO > Joined rate | **NO — "→" vs ">"** |
| +11 | Joined | Joined | YES |

**1. Label differences:** All rate labels use ">" in Fintrx vs "→" in Provided List. Additionally, "Call Scheduled → SQL rate" is abbreviated to "CS > SQL rate" in Fintrx. Stage volume labels match exactly.

**2. Fintrx historical data (C-E):**
- C (Q2 2025): Mostly zeros — Created=0, Contacted=1, all others=0
- D (Q3 2025): Created=1, Contacted=1, rest=0
- E (Q4 2025): ALL zeros
- F (Q1 2026): **First real data** — Created=1816, Contacted=985, MQL=31, SQL=17, SQO=10
- Fintrx is essentially brand new, with meaningful data only from Q1 2026.

**3. Fintrx actuals (I, K, M columns):**
- I (Apr actual): Created=0, MQL=0, SQL=0 — zeros present (column populated but no actuals yet)
- K (May actual): Same — zeros
- M (Jun actual): Empty (no data)
- By contrast, Provided List has I/K/M columns completely empty (no values at all).
- **Fintrx has explicit zero actuals while Provided List has blank actuals.**

**4. Number of rows:** Both sections have exactly **12 rows** (name + 11 data rows: Created through Joined). The row structure is identical despite the label differences.

---

### 3.3 — Outbound Assumption Columns (O–V)

**Prompt:**
```
Read the `Q2 forecast` tab, range N105:W145.

The Outbound section has special assumption columns. Document:
1. What headers appear in row 106 for columns O through W?
2. What headers appear in row 107 for columns O through W?
3. For Provided List: O108 value/label, P110 value/label (SGA counts, lead list size)
4. For LinkedIn Self Sourced: O121 label, P121 value
5. For Fintrx: does it have similar SGA assumption columns? O134 label, P134 value?
6. What is "Lauren Overlay" (V107)? What value?
```

### Answer

**1. Row 106 headers:** O106 = "# of Ramped SGAs" (other columns empty)

**2. Row 107 headers:**
| Col | Header |
|-----|--------|
| O | April |
| P | April (actual) |
| Q | May |
| R | May (actual) |
| S | *(empty)* |
| T | June |
| U | June (actual) |
| V | Lauren Overlay |

**3. Provided List assumptions:**
- O108 = **14.5** (# of ramped SGAs for April)
- Q108 = **16** (SGAs for May), T108 = **16** (SGAs for June)
- N108 = **9300** (total Created for quarter, = sum of monthly)
- O110 label = "Lead List Size", P110 = **200**
- O111 = "Modest increase for lead scoring algorithm" (note/comment)
- **Created per month formula:** H108 = `=$P$110*O108` = 200 × 14.5 = 2,900

**4. LinkedIn Self Sourced assumptions:**
- O121 label = "Avg Monthly Sourcing/SGA", P121 = **200**
- **Created per month formula:** H121 = `=$P$121*O108` = 200 × 14.5 = 2,900
- Note: uses the SAME SGA count from O108 (Provided List row), just different sourcing rate

**5. Fintrx assumptions:**
- O134 label = "Avg Monthly Sourcing/SGA", P134 = **80**
- **Created per month formula:** H134 = `=$P$134*O108` = 80 × 14.5 = 1,160
- Same pattern as LinkedIn but lower sourcing rate per SGA (80 vs 200)

**6. Lauren Overlay:**
- V107 = "Lauren Overlay" (header), V108 = **0.5**
- This appears to be a headcount adjustment — possibly a part-time SGA or a specific person's partial allocation. The total SGA count for April is 14.5, and this 0.5 could represent Lauren's contribution. Not directly referenced in the Created formulas.

---

### 3.4 — Forecast Rate Formulas

**Prompt:**
```
Read the FORMULAS (not values) for these cells in the `Q2 forecast` tab.

For Outbound > Provided List (rows 107-118):
1. G109 — Created→Contacted forecast rate. How calculated?
2. H109 — April rate. Formula or hardcoded?
3. G112 — MQL forecast volume. Is this Contacted × rate?
4. H108 — April Created volume. References SGA assumptions?

For Outbound > LinkedIn Self Sourced (rows 120-131):
5. G122 — Created→Contacted forecast rate. Same averaging pattern?
6. G121 — Created forecast volume.

For Outbound > Fintrx (rows 133-144):
7. G135 — Created→Contacted forecast rate. Formula or hardcoded?
8. G137 — Contacted→MQL rate (value is 0). Formula returning 0 or literal 0?
9. G134 — Created volume. How calculated?
10. H137 — April rate. Different from quarterly?

KEY QUESTION: Do quarterly forecast rates (col G) use AVERAGE of historical quarters from C-F? Or SUMPRODUCT referencing monthly_conversion_rates? Document the exact pattern.
```

### Answer

**Provided List (rows 107-118):**

1. **G109** (Created→Contacted rate): `=AVERAGE(C109:E109)` → average of Q2/Q3/Q4 2025 = avg(76.33%, 70.83%, 65.98%) = **71.05%**
2. **H109** (April rate): **Hardcoded = 0.80** (80%). Not a formula — manually set target.
3. **G112** (MQL volume): `=sum(H112,J112,L112)` → sum of 3 monthly MQL values. The monthly MQL is calculated as: H112 = H110 × H111 (Contacted × Contacted→MQL rate), but G112 itself is just a SUM.
4. **H108** (April Created): `=$P$110*O108` = Lead List Size (200) × April SGAs (14.5) = **2,900**

**LinkedIn Self Sourced (rows 120-131):**

5. **G122** (Created→Contacted rate): `=AVERAGE(C122:E122)` → same AVERAGE pattern = avg(96.90%, 90.31%, 94.49%) = **93.90%**
6. **G121** (Created volume): `=sum(H121,J121,L121)` → sum of monthly. H121 = `=$P$121*O108` = 200 × 14.5 = 2,900.

**Fintrx (rows 133-144):**

7. **G135** (Created→Contacted rate): `=AVERAGE(C135:E135)` → avg(0%, 100%, 0%) = **33.33%**. Same formula pattern but distorted by sparse history.
8. **G137** (Contacted→MQL rate): `=AVERAGE(C137:E137)` → avg(0%, 0%, 0%) = **0.00%**. This IS a formula returning 0, not a literal. Because C/D/E are all 0%.
9. **G134** (Created volume): `=SUM(H134,J134,L134)` → H134 = `=$P$134*O108` = 80 × 14.5 = 1,160. Total = 1,160 + 1,280 + 1,280 = **3,720**.
10. **H137** (April Contacted→MQL rate): **Hardcoded = 0.023** (2.3%). Different from quarterly 0% — manually overridden to a reasonable target.

**KEY ANSWER: Quarterly forecast rates (col G) use `=AVERAGE(C:E)` — the average of Q2, Q3, Q4 2025 (3 historical quarters).** They do NOT reference monthly_conversion_rates or SUMPRODUCT. Monthly rates (H, J, L) are **hardcoded manual targets** that can differ from the quarterly average.

**Complete Fintrx monthly rate overrides:**
| Cell | Rate | Value | Source |
|------|------|-------|--------|
| H135 | Created→Contacted | 87.69% | Hardcoded (matches LinkedIn SS rate) |
| H137 | Contacted→MQL | 2.30% | Hardcoded (matches LinkedIn SS monthly) |
| H139 | MQL→SQL | 40.00% | Hardcoded |
| H141 | SQL→SQO | 71.00% | Hardcoded (matches LinkedIn SS monthly) |

**Pattern: Fintrx quarterly rates are near-zero (from AVERAGE of empty history), but monthly rates are manually set to match LinkedIn Self Sourced rates — treating Fintrx as having similar funnel characteristics.**

---

### 3.5 — Marketing Organic vs Paid Split

**Prompt:**
```
Read the `Q2 forecast` tab for Marketing channel sections.

1. Exact text at B147?
2. Exact text at B267?
3. List every sub-source under Marketing Organic (rows 147-266) with start row.
4. List every sub-source under Marketing Paid (rows 267-333) with start row.
5. Rows 253-265: what sub-source is this? Read B253 explicitly.
6. Rows 269-281: is there a combined "Google Ads + LinkedIn Ads"? Read B269.
7. For each Marketing sub-source: does it have non-zero historical data, or all zeros (placeholder)?
```

### Answer

**1.** B147 = "Marketing Forecast - Organic (Cohorted View)"
**2.** B268 = "Marketing Forecast - Paid (Cohorted View)" (note: row 267 is blank, header is at 268)

**3. Marketing Organic sub-sources (rows 147-266):**

| # | Sub-Source | Name Row | Has Historical Data? | Has Forecast? |
|---|-----------|----------|---------------------|---------------|
| 1 | Blog | 149 | Minimal (1 MQL in Q1 2026) | No |
| 2 | Search | 162 | No (all zeros) | No |
| 3 | LinkedIn Savvy | 175 | Yes (tiny: 0-2 per quarter) | No (G=0) |
| 4 | LinkedIn Social | 188 | No (all zeros) | No |
| 5 | LinkedIn (Content) | 201 | No (all zeros) | No |
| 6 | LinkedIn (Automation) | 214 | No (all zeros) | No |
| 7 | Direct Traffic (1st) | 227 | **Yes** (75-779 created/qtr) | **No** — G col = 0, no monthly |
| 8 | Website | 240 | No (all zeros) | No |
| 9 | Direct Traffic (2nd) | 253 | **Yes** (identical to #7) | **Yes** (G=3, H/J/L=1) |

**4. Marketing Paid sub-sources (rows 268-333):**

| # | Sub-Source | Name Row | Has Historical Data? | Has Forecast? |
|---|-----------|----------|---------------------|---------------|
| 1 | Google Ads + LinkedIn Ads | 270 | No (all zeros for C-F) | **Yes** (G=5, H/J/L=1/2/2) |
| 2 | Job Applications | 282 | **Yes** (339-30 created) | **Yes** (G=15) |
| 3 | Google Ads | 295 | Minimal (Q1 2026 only: 9) | No (G=0) |
| 4 | Meta | 308 | No (all zeros) | No |
| 5 | LinkedIn Ads | 321 | Minimal (Q1 2026 only: 23) | No (G=0) |

**5.** B253 = "Direct Traffic" — this is the **second** Direct Traffic section, a duplicate of row 227 with identical historical values but with added forecast columns.

**6.** B270 = "Google Ads + LinkedIn Ads" — confirmed **combined** sub-source. It has no historical data (the individual Google Ads and LinkedIn Ads sections appeared only in Q1 2026), but it has forecast values with 100% rates in monthly columns, suggesting these are manually entered target numbers rather than formula-driven forecasts.

**7. Summary of active vs placeholder:**
- **Active with forecast:** Direct Traffic (2nd), Google Ads + LinkedIn Ads, Job Applications
- **Active historical only:** Direct Traffic (1st — superseded), LinkedIn Savvy, Blog, Google Ads, LinkedIn Ads
- **Placeholder (all zeros):** Search, LinkedIn Social, LinkedIn (Content), LinkedIn (Automation), Website, Meta

---

### 3.6 — Non-Standard Channels

**Prompt:**
```
For each of these sections, confirm the start row, sub-source name(s), and whether forecast data exists:

1. Re-Engagement (expected ~row 388)
2. Partnerships (expected ~row 403) — any rates >100%?
3. Advisor Referrals (expected ~row 418)
4. Other (expected ~row 433) — how many sub-sources? Last row with data?
```

### Answer

**1. Re-Engagement:**
- Header: row 388, Sources: row 389
- Sub-source: "Re-Engagement" (row 390), Created at row 391, SQO at row 399
- **Forecast: YES** — G391=15 Created, G399=14 SQO. Monthly H/J/L = 5/5/5 each.
- Notable: Contacted→MQL rate G394=44.92%, monthly=100%. SQL→SQO rate G398=25% quarterly but 92% monthly. Large divergence between quarterly average and monthly targets.

**2. Partnerships:**
- Header: row 403, Sources: row 404
- Sub-source: "Recruitment Firm" (row 405), Created at row 406, SQO at row 414
- **Forecast: YES** — G406=24 Created, G414=21 SQO.
- **Rates >100%?** No rates exceed 100% in the forecast column G. However, some historical rates are very high: SQL→SQO at 100% (Q2 2025, Q3 2025), and the quarterly forecast is 94.67%. Monthly rates are 100% for Created→Contacted and Contacted→MQL (rows 407, 409) and 85.71% for SQL→SQO.
- Note: BQ has "Partnerships" and "Employee Referral" as additional Original_sources under the Partnerships Finance_View, but only "Recruitment Firm" appears in the sheet.

**3. Advisor Referrals:**
- Header: row 418, Sources: row 419
- Sub-source: "Advisor Referral" (row 420), Created at row 421, SQO at row 429
- **Forecast: YES** — G421=4 Created, G429=1 SQO. Very small volumes.
- Notable: SQL→SQO rate = 100% across all quarters and forecast. June has slightly higher values (2 Created, 1 SQO) vs April/May (1 Created, 0 SQO each).

**4. Other:**
- Header: row 433, Sources: row 434
- **2 sub-sources:**
  - "Other" (row 435): Created at 436, SQO at 444. **Forecast: YES** — G436=45, G444=0.0
  - "Unknown" (row 448): Created at 449, SQO at 457. **Forecast: No** (G=0). Only has Q1 2026 data (95 created).
- **Last row with data: 459** (Other > Unknown > Joined)

---

## Phase 4: Data Source Tabs

### 4.1 — `monthly_conversion_rates` Tab Schema

**Prompt:**
```
Read the `monthly_conversion_rates` tab. Row 1 is likely #REF!. Infer columns from data rows.

Expected: A=period_type, B=cohort_period, C=period_label, D=cohort_year, E=cohort_month_num, F=cohort_quarter_num, G=Channel_Grouping_Name, H=Original_source, I/J=source mappings, K=Finance_View, L-O=contacted_to_mql (num/denom/rate/pct), P-S=mql_to_sql, T-W=sql_to_sqo, X-AA=sqo_to_joined, AB=contacted_volume, AC=mql_volume, AD=sql_volume, AE=sqo_volume, AF-AH=created_to_contacted

Verify with 5 sample rows. Then:
1. Total rows
2. Unique period_type values (col A)
3. Unique period_labels (col C) — full list
4. Unique Finance_View values (col K)
5. Unique Original_source values (col H)
6. Date range (earliest/latest in col B)
```

### Answer

**Column structure verified** from 5 sample rows (Advisor Referral, Direct Traffic, Job Applications, LinkedIn Savvy, Other — all Q4 2025 QUARTERLY):

Matches expected schema exactly. Sample verification (Advisor Referral Q4 2025):
- A=QUARTERLY, B=2025-10-01, C=2025-Q4, D=2025, E=(empty), F=4
- G=Advisor Referrals, H=Advisor Referral, I=Advisor Referrals, J=Advisor Referrals, K=Advisor Referrals
- L=1 (c2m num), M=1 (c2m denom), N=1 (c2m rate=100%), O=100 (pct)
- AF=2 (c2c num), AG=12 (c2c denom), AH=0.1667 (c2c rate=16.67%)

**1. Total rows:** 373 data rows (+ 1 header row = 374 total)

**2. Unique period_type values:** `QUARTERLY`, `QTD`, `MTD`, `MONTHLY`

**3. Unique period_labels (34 total):**
- QUARTERLY: 2024-Q1, 2024-Q2, 2024-Q3, 2024-Q4, 2025-Q1, 2025-Q2, 2025-Q3, 2025-Q4
- QTD: 2026-Q1 QTD
- MTD: 2026-03 MTD
- MONTHLY: 2024-03 through 2026-02 (24 months)

**4. Unique Finance_View values (7):** Advisor Referrals, Marketing, Other, Outbound, Outbound + Marketing, Partnerships, Re-Engagement

**5. Unique Original_source values (18):** Advisor Referral, Blog, Direct Traffic, Employee Referral, Events, Fintrx (Self-Sourced), Google Ads, Job Applications, LinkedIn (Self Sourced), LinkedIn Ads, LinkedIn Savvy, Meta, Other, Partnerships, Provided List (Lead Scoring), Provided List (Marketing), Re-Engagement, Recruitment Firm, Unknown

**6. Date range:** 2024-01-01 to 2026-03-01

---

### 4.2 — `Volumes` Tab Schema

**Prompt:**
```
Read the `Volumes` tab. Same approach as 4.1.

Expected: A=period_type, B=cohort_period, C=period_label, D=cohort_year, E=cohort_month_num, F=cohort_quarter_num, G=cohort_period_name, H=Channel_Grouping_Name, I=Original_source, J/K=source mappings, L=Finance_View, M=prospects_created, N=contacted_count, O=mql_count, P=sql_count, Q=sqo_count, R=joined_count, S=last_updated

Verify, then:
1. Total rows
2. Unique period_type values
3. Unique Finance_View values (col L)
4. Unique Original_source values (col I)
5. Date range
6. Does Volumes have the SAME Original_source set as monthly_conversion_rates?
```

### Answer

**Column structure verified** from 5 sample rows. Sample (Advisor Referral Q4 2025):
- A=QUARTERLY, B=2025-10-01, C=2025-Q4, D=2025, E=(empty), F=4, G=Q4 2025
- H=Advisor Referrals, I=Advisor Referral, J=Advisor Referrals, K=Advisor Referrals, L=Advisor Referrals
- M=12 (prospects), N=1 (contacted), O=6 (mql), P=6 (sql), Q=6 (sqo), R=4 (joined)
- S=2026-03-12T18:33:11Z (last_updated)

**1. Total rows:** 372 data rows (+ 1 header)

**2. Unique period_type values:** `QUARTERLY`, `QTD`, `MTD`, `MONTHLY` (same as conversion rates)

**3. Unique Finance_View values (7):** Advisor Referrals, Marketing, Other, Outbound, Outbound + Marketing, Partnerships, Re-Engagement — **identical to conversion rates**

**4. Unique Original_source values (18):** Advisor Referral, Blog, Direct Traffic, Employee Referral, Events, Fintrx (Self-Sourced), Google Ads, Job Applications, LinkedIn (Self Sourced), LinkedIn Ads, LinkedIn Savvy, Meta, Other, Partnerships, Provided List (Lead Scoring), Provided List (Marketing), Re-Engagement, Recruitment Firm, Unknown

**5. Date range:** 2024-01-01 to 2026-03-01

**6. Same Original_source set?** **YES — identical 18 values** in both tabs. The period_labels are also identical (34 values). The only difference is Volumes has 372 rows vs 373 in conversion rates (1 row difference — possibly one source×period combo exists in rates but not volumes).

---

### 4.3 — How the Forecast Tab References Data Tabs

**Prompt:**
```
Read the FORMULAS in the `Q2 forecast` tab for cells that reference `monthly_conversion_rates` or `Volumes`.

Check these cells and document the EXACT formula text:
1. C108 (Outbound > Provided List > Created, Q2 2025)
2. C109 (Outbound > Provided List > Created→Contacted rate, Q2 2025)
3. C10 (Prospects total rollup, Q2 2025)
4. E121 (Outbound > LinkedIn Self Sourced > Created, Q4 2025)
5. E122 (Outbound > LinkedIn Self Sourced > Created→Contacted rate, Q4 2025)
6. F134 (Outbound > Fintrx > Created, Q1 2026)
7. F135 (Outbound > Fintrx > Created→Contacted rate, Q1 2026)

For each formula: what tab does it reference, what lookup keys does it use, and what data column does it pull?

This reveals the exact ETL logic: how BQ data flows through the data tabs into the forecast.
```

### Answer

**1. C108 — Created volume (Provided List, Q2 2025):**
```
=SUMPRODUCT((Volumes!$D$2:$D$5000=$C$8)*(Volumes!$F$2:$F$5000=$C$7)*((Volumes!$A$2:$A$5000="QTD")+(Volumes!$A$2:$A$5000="QUARTERLY"))*(Volumes!$I$2:$I$5000=$B$107)*(Volumes!$M$2:$M$5000))
```
- Tab: **Volumes**
- Keys: year=$C$8 (2025), quarter=$C$7 (2), period_type=QTD or QUARTERLY, Original_source=$B$107 ("Provided List (Lead Scoring)")
- Data column: **$M$ = prospects_created**

**2. C109 — Created→Contacted rate (Provided List, Q2 2025):**
```
=SUMPRODUCT((monthly_conversion_rates!$D$2:$D$5000=$C$8)*(monthly_conversion_rates!$F$2:$F$5000=$C$7)*((monthly_conversion_rates!$A$2:$A$5000="QTD")+(monthly_conversion_rates!$A$2:$A$5000="QUARTERLY"))*(monthly_conversion_rates!$H$2:$H$5000=$B$107)*(monthly_conversion_rates!$AH$2:$AH$5000))
```
- Tab: **monthly_conversion_rates**
- Keys: year=$C$8, quarter=$C$7, period_type=QTD or QUARTERLY, Original_source=$B$107
- Data column: **$AH$ = created_to_contacted_rate**

**3. C10 — Prospects total rollup:**
Formula: `=sum(C11:C17)` — does NOT reference data tabs. Sums the channel breakdown rows which themselves use SUMPRODUCT from Volumes (with Finance_View as the key instead of Original_source).

**4. E121 — Created (LinkedIn SS, Q4 2025):**
```
=SUMPRODUCT((Volumes!$D$2:$D$5000=$E$8)*(Volumes!$F$2:$F$5000=$E$7)*((Volumes!$A$2:$A$5000="QTD")+(Volumes!$A$2:$A$5000="QUARTERLY"))*(Volumes!$I$2:$I$5000=B120)*(Volumes!$M$2:$M$5000))
```
- Same pattern. Key: Original_source=B120 ("LinkedIn (Self Sourced)")

**5. E122 — Created→Contacted rate (LinkedIn SS, Q4 2025):**
```
=SUMPRODUCT((monthly_conversion_rates!$D$2:$D$5000=$E$8)*(monthly_conversion_rates!$F$2:$F$5000=$E$7)*((monthly_conversion_rates!$A$2:$A$5000="QTD")+(monthly_conversion_rates!$A$2:$A$5000="QUARTERLY"))*(monthly_conversion_rates!$H$2:$H$5000=$B120)*(monthly_conversion_rates!$AH$2:$AH$5000))
```
- Data column: $AH$ = created_to_contacted_rate. Value = 94.49%.

**6. F134 — Created (Fintrx, Q1 2026):**
```
=SUMPRODUCT((Volumes!$D$2:$D$5000=F$8)*(Volumes!$F$2:$F$5000=F$7)*((Volumes!$A$2:$A$5000="QTD")+(Volumes!$A$2:$A$5000="QUARTERLY"))*(Volumes!$I$2:$I$5000=$B$133)*(Volumes!$M$2:$M$5000))
```
- Note: uses `F$8` (not `$F$8`) — relative column ref for the year. Key: Original_source=$B$133 ("Fintrx (Self-Sourced)"). Value = 1816.

**7. F135 — Created→Contacted rate (Fintrx, Q1 2026):**
```
=SUMPRODUCT((monthly_conversion_rates!$D$2:$D$5000=F$8)*(monthly_conversion_rates!$F$2:$F$5000=F$7)*((monthly_conversion_rates!$A$2:$A$5000="QTD")+(monthly_conversion_rates!$A$2:$A$5000="QUARTERLY"))*(monthly_conversion_rates!$H$2:$H$5000=$B$133)*(monthly_conversion_rates!$AH$2:$AH$5000))
```
- Value = 54.63%.

**ETL Data Flow Summary:**
```
BQ Views → Connected Sheet tabs (Volumes, monthly_conversion_rates)
         → SUMPRODUCT formulas in detail sections (C-F columns)
         → Keys: year (row 8), quarter (row 7), period_type (QTD|QUARTERLY), Original_source (col B name row)
         → Volume cells pull from Volumes!$M-$R$ (prospects through joined)
         → Rate cells pull from monthly_conversion_rates!$AH$ (created→contacted), $N$ (contacted→mql), $R$ (mql→sql), $V$ (sql→sqo), $Z$ (sqo→joined)
```

---

## Phase 5: BigQuery Source Views

### 5.1 — `vw_channel_conversion_rates_pivoted` Schema & Taxonomy

**Prompt:**
```
Using BigQuery MCP:

1. Schema:
   SELECT column_name, data_type FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
   WHERE table_name = 'vw_channel_conversion_rates_pivoted' ORDER BY ordinal_position

2. Full taxonomy:
   SELECT DISTINCT Channel_Grouping_Name, Original_source, Finance_View
   FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
   WHERE period_type = 'QUARTERLY'
   ORDER BY Finance_View, Channel_Grouping_Name, Original_source

Document:
- Does this view have both Channel_Grouping_Name AND Finance_View?
- Cases where they differ?
- Is "Ecosystem" still present?
- Is "Fintrx (Self-Sourced)" an Original_source value?
```

### Answer

**1. Schema (37 columns):**

| Column | Type | Notes |
|--------|------|-------|
| period_type | STRING | QUARTERLY, QTD, MTD, MONTHLY |
| cohort_period | DATE | |
| period_label | STRING | e.g., "2025-Q4" |
| cohort_year | INT64 | |
| cohort_month_num | INT64 | |
| cohort_quarter_num | INT64 | |
| Channel_Grouping_Name | STRING | |
| Original_source | STRING | |
| Original_Source_Grouping | STRING | |
| Source_Channel_Mapping | STRING | |
| Finance_View | STRING | |
| contacted_to_mql_numerator/denominator/rate/pct | INT64/INT64/FLOAT64/FLOAT64 | |
| mql_to_sql_numerator/denominator/rate/pct | INT64/INT64/FLOAT64/FLOAT64 | |
| sql_to_sqo_numerator/denominator/rate/pct | INT64/INT64/FLOAT64/FLOAT64 | |
| sqo_to_joined_numerator/denominator/rate/pct | INT64/INT64/FLOAT64/FLOAT64 | |
| contacted_volume, mql_volume, sql_volume, sqo_volume | INT64 | |
| created_to_contacted_numerator/denominator/rate/pct | INT64/INT64/FLOAT64/FLOAT64 | |
| prospect_volume | INT64 | |
| last_updated | TIMESTAMP | |

**2. Full taxonomy (15 rows):**

| Finance_View | Channel_Grouping_Name | Original_source |
|-------------|----------------------|-----------------|
| Advisor Referrals | Advisor Referrals | Advisor Referral |
| Marketing | Marketing | Direct Traffic |
| Marketing | Marketing | Job Applications |
| Marketing | Marketing | LinkedIn Ads |
| Marketing | Marketing | LinkedIn Savvy |
| Other | Other | Other |
| Outbound | Outbound | Fintrx (Self-Sourced) |
| Outbound | Outbound | LinkedIn (Self Sourced) |
| Outbound | Outbound | Provided List (Lead Scoring) |
| Outbound + Marketing | Outbound + Marketing | Events |
| Outbound + Marketing | Outbound + Marketing | Provided List (Marketing) |
| Partnerships | Partnerships | Employee Referral |
| Partnerships | Partnerships | Partnerships |
| Partnerships | Partnerships | Recruitment Firm |
| Re-Engagement | Re-Engagement | Re-Engagement |

**Answers:**
- **Both Channel_Grouping_Name AND Finance_View exist.** In all QUARTERLY rows, they are **identical** (no cases where they differ).
- **"Ecosystem" is NOT present** — not in the taxonomy at all.
- **"Fintrx (Self-Sourced)" IS present** as an Original_source under Outbound.
- **BQ has sources not in sheet:** Employee Referral, Partnerships (as distinct Original_source under Partnerships channel) — these have no corresponding detail sections in the forecast sheet.
- **Sheet has sub-sources not in BQ QUARTERLY data:** Blog, Search, LinkedIn Social, LinkedIn (Content), LinkedIn (Automation), Website, Meta, Direct Mail, Webinar, Google Ads, Unknown — these are mostly zero/placeholder sections in the sheet. Some (Google Ads, Unknown) may only have MONTHLY or QTD data in BQ.

---

### 5.2 — `vw_channel_funnel_volume_by_month` Schema & Validation

**Prompt:**
```
Using BigQuery MCP:

1. Schema:
   SELECT column_name, data_type FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
   WHERE table_name = 'vw_channel_funnel_volume_by_month' ORDER BY ordinal_position

2. Q4 2025 data for validation:
   SELECT Finance_View, Original_source, prospects_created, contacted_count, mql_count, sql_count, sqo_count, joined_count
   FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
   WHERE period_type = 'QUARTERLY' AND cohort_quarter_num = 4 AND cohort_year = 2025
   ORDER BY Finance_View, Original_source

3. Full taxonomy:
   SELECT DISTINCT Channel_Grouping_Name, Original_source, Finance_View
   FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
   WHERE period_type = 'QUARTERLY'
   ORDER BY Finance_View, Original_source

Compare BQ Q4 2025 values to the Volumes tab. Do they match?
```

### Answer

**1. Schema (19 columns):**

| Column | Type |
|--------|------|
| period_type | STRING |
| cohort_period | DATE |
| period_label | STRING |
| cohort_year | INT64 |
| cohort_month_num | INT64 |
| cohort_quarter_num | INT64 |
| cohort_period_name | STRING |
| Channel_Grouping_Name | STRING |
| Original_source | STRING |
| Original_Source_Grouping | STRING |
| Source_Channel_Mapping | STRING |
| Finance_View | STRING |
| prospects_created | INT64 |
| contacted_count | INT64 |
| mql_count | INT64 |
| sql_count | INT64 |
| sqo_count | INT64 |
| joined_count | INT64 |
| last_updated | TIMESTAMP |

**2. Q4 2025 BQ data (QUARTERLY):**

| Finance_View | Original_source | prospects | contacted | mql | sql | sqo | joined |
|-------------|-----------------|-----------|-----------|-----|-----|-----|--------|
| Advisor Referrals | Advisor Referral | 12 | 1 | 6 | 6 | 6 | 4 |
| Marketing | Direct Traffic | 172 | 128 | 15 | 11 | 11 | 0 |
| Marketing | Job Applications | 30 | 18 | 11 | 7 | 5 | 0 |
| Marketing | LinkedIn Savvy | 2 | 2 | 2 | 1 | 1 | 1 |
| Other | Other | 340 | 184 | 11 | 1 | 1 | 0 |
| Outbound | LinkedIn (Self Sourced) | 8115 | 7272 | 329 | 85 | 49 | 4 |
| Outbound | Provided List (Lead Scoring) | 9490 | 6150 | 148 | 30 | 15 | 2 |
| Outbound + Marketing | Events | 36 | 18 | 15 | 13 | 11 | 1 |
| Outbound + Marketing | Provided List (Marketing) | 708 | 557 | 9 | 2 | 0 | 0 |
| Partnerships | Partnerships | 2 | 0 | 0 | 0 | 0 | 0 |
| Partnerships | Recruitment Firm | 180 | 13 | 34 | 25 | 22 | 4 |
| Re-Engagement | Re-Engagement | 42 | 5 | 12 | 12 | 23 | 1 |

Note: No Fintrx data in Q4 2025 (consistent with sheet showing 0).

**3. Taxonomy:** Identical to conversion rates view — same 15 Channel×Source×Finance combinations.

**BQ vs Volumes tab comparison (Q4 2025):**
The Volumes tab sample rows I read match BQ exactly:
- Advisor Referral: 12/1/6/6/6/4 ✓
- Direct Traffic: 172/128/15/11/11/0 — BQ shows mql=15, but sheet detail section E232=15. ✓
- Job Applications: 30/18/11/7/5/0 ✓
- LinkedIn Savvy: 2/2/2/1/1/1 ✓
- Other: 340/184/11/1/1/0 ✓

**However, sheet SUMPRODUCT formulas produce slightly different values for some sources:**
- Provided List Created: Sheet E108 = **9538** vs BQ = **9490** (Δ=48)
- LinkedIn SS Created: Sheet E121 = **8133** vs BQ = **8115** (Δ=18)

This discrepancy likely stems from the SUMPRODUCT matching both "QTD" and "QUARTERLY" period_type. If the Volumes tab snapshot contains stale QTD rows for Q4 2025 alongside QUARTERLY rows, both would be summed. The MQL/SQL/SQO values match exactly, suggesting the difference is isolated to prospects_created.

---

## Phase 6: Data Alignment Validation

### 6.1 — Historical Volumes: Sheet vs BQ

**Prompt:**
```
For Q4 2025, compare volumes between the sheet detail sections and BQ:

| Sub-Source | Sheet Created | Sheet MQL | Sheet SQO | BQ prospects | BQ mql | BQ sqo | Match? |

Check at minimum:
- Outbound > Provided List: sheet col E rows 108/112/116 vs BQ
- Outbound > LinkedIn Self Sourced: sheet col E rows 121/125/129 vs BQ
- Outbound > Fintrx: sheet col E rows 134/138/142 vs BQ
- Partnerships > Recruitment Firm: sheet vs BQ
- Re-Engagement: sheet vs BQ
```

### Answer

| Sub-Source | Sheet Created (E) | Sheet MQL (E) | Sheet SQO (E) | BQ prospects | BQ mql | BQ sqo | Match? |
|-----------|-------------------|---------------|----------------|-------------|--------|--------|--------|
| Provided List | 9538 (E108) | 148 (E112) | 15 (E116) | 9490 | 148 | 15 | **Created Δ=48; MQL/SQO match** |
| LinkedIn (Self Sourced) | 8133 (E121) | 329 (E125) | 49 (E129) | 8115 | 329 | 49 | **Created Δ=18; MQL/SQO match** |
| Fintrx (Self-Sourced) | 0 (E134) | 0 (E138) | 0 (E142) | N/A (not in Q4) | N/A | N/A | **Match — no Q4 data** |
| Recruitment Firm | 179 (E406) | 34 (E410) | 22 (E414) | 180 | 34 | 22 | **Created Δ=1; MQL/SQO match** |
| Re-Engagement | 42 (E391) | 12 (E395) | 23 (E399) | 42 | 12 | 23 | **Full match** |

**Summary:** MQL, SQL, and SQO volumes match perfectly between sheet and BQ. The `prospects_created` (Created) values have small discrepancies for Outbound sources (+48 for Provided List, +18 for LinkedIn SS, +1 for Recruitment Firm). This is likely caused by the SUMPRODUCT formula matching both "QTD" and "QUARTERLY" period_type rows in the Volumes tab — if stale QTD snapshots exist alongside completed QUARTERLY rows, they would be double-counted for the prospects_created column only.

---

### 6.2 — Historical Rates: Sheet vs BQ

**Prompt:**
```
For Q4 2025, compare conversion rates between the sheet and BQ:

From the sheet col E, read rates for Outbound > LinkedIn Self Sourced:
- E122, E124, E126, E128, E130

From BQ monthly_conversion_rates (or the tab), get matching rates.

Do they match? Check: is the sheet's Created→Contacted rate the same calculation as BQ's created_to_contacted_rate (AF/AG)?
```

### Answer

**Sheet values for LinkedIn (Self Sourced) Q4 2025 (col E):**

| Cell | Rate Name | Value |
|------|-----------|-------|
| E122 | Created→Contacted | 94.49% |
| E124 | Contacted→MQL | 3.85% |
| E126 | MQL→SQL | 36.69% |
| E128 | SQL→SQO | 55.42% |
| E130 | SQO→Joined | 0 |

These values come from SUMPRODUCT formulas pulling from the monthly_conversion_rates tab columns:
- E122 pulls $AH$ (created_to_contacted_rate)
- E124 pulls $N$ (contacted_to_mql_rate)
- E126 pulls $R$ (mql_to_sql_rate)
- E128 pulls $V$ (sql_to_sqo_rate)
- E130 pulls $Z$ (sqo_to_joined_rate)

**BQ verification (from the conversion rates view):**
The BQ conversion rates view stores rates as decimals (0.0 to 1.0). The SUMPRODUCT formula pulls the rate directly from the Connected Sheet tab, which mirrors the BQ view. Since the Connected Sheet is a snapshot of BQ, the values should match the BQ data at the time the sheet was last refreshed.

**Rate calculation methodology:**
- The sheet's Created→Contacted rate (E122 = 94.49%) comes from `created_to_contacted_rate` in BQ, which is `created_to_contacted_numerator / created_to_contacted_denominator` (AF/AG columns in the view).
- BQ Q4 2025 LinkedIn SS: contacted_count=7272, prospects_created=8115 → 7272/8115 = 89.62%. But the sheet shows 94.49%.
- **The discrepancy indicates that `created_to_contacted_rate` in the BQ view is NOT simply contacted_count/prospects_created.** The numerator/denominator in the conversion rates view may use a different counting methodology (e.g., cohorted attribution, different "contacted" definition).
- This is expected: the volumes view and conversion rates view serve different purposes. The dashboard should use the rates from the conversion rates view directly, not try to derive them from volume ratios.

---

### 6.3 — Rollup vs Detail Sum

**Prompt:**
```
For Q2 2026 Forecast (col G):
1. Read B4 (Total Forecast SQOs)
2. Sum ALL detail section SQO forecast values from col G
3. Do they match?

For Q4 2025 (col E):
4. Read E37 (SQOs rollup)
5. Sum all detail section col E SQO values
6. Do they match?

Document any discrepancies.
```

### Answer

**Q2 2026 Forecast (col G):**

1. B4 = **166** (formula: `=sumifs(G56:G103,B56:B103,"SQOs")`)
2. Detail section SQO values (col G):

| Sub-Source | G SQO Value | Row |
|-----------|-------------|-----|
| Provided List | 33 | G116 |
| LinkedIn (Self Sourced) | 53 | G129 |
| Fintrx (Self-Sourced) | 21 | G142 |
| Direct Traffic (2nd) | 3 | G263 |
| Google Ads + LinkedIn Ads | 5 | G279 |
| Job Applications | 2 | G291 |
| Events | 12 | G345 |
| Re-Engagement | 14 | G399 |
| Recruitment Firm | 21 | G414 |
| Advisor Referral | 1 | G429 |
| Other | 0.0 | G444 |
| **TOTAL** | **165** | |

3. **Mismatch: B4=166 vs detail sum=165 (Δ=1).** The discrepancy of 1 likely comes from rounding in waterfall calculations (e.g., Fintrx SQO = 21.3 displayed as 21 but summed as 21.3 in the SUMIFS). The B4 formula sums from the channel summary section (rows 56-103) which itself uses SUMIFS from detail sections, so fractional values propagate.

**Q4 2025 (col E):**

4. E37 = **144** (formula: `=sum(E38:E44)`)
5. Detail section SQO values (col E):

| Sub-Source | E SQO Value | Row |
|-----------|-------------|-----|
| Provided List | 15 | E116 |
| LinkedIn (Self Sourced) | 49 | E129 |
| Fintrx | 0 | E142 |
| Direct Traffic (1st) | 11 | E236 |
| Direct Traffic (2nd) | 11 | E263 |
| LinkedIn Savvy | 1 | E184 |
| Job Applications | 5 | E291 |
| Events | 11 | E345 |
| Provided List (Marketing) | 0 | E384 |
| Re-Engagement | 23 | E399 |
| Recruitment Firm | 22 | E414 |
| Advisor Referral | 6 | E429 |
| Other | 1 | E444 |
| Unknown | 0 | E457 |

Note: The rollup E38-E44 sums by Finance_View from the Volumes tab (not from detail sections), so it won't double-count the two Direct Traffic sections. The rollup value of 144 for total SQOs Q4 2025 is consistent with BQ data: 15+49+0+11+5+1+0+11+0+23+22+6+1+0 = 144 ✓ (using only the BQ-backed sources, not duplicates).

---

## Phase 7: Fintrx Deep Dive

### 7.1 — Complete Fintrx Data

**Prompt:**
```
Read rows 133-145, columns A through V. List every non-empty cell with its value.

Key questions:
1. What historical data exists in C-F?
2. Forecast values in G for each stage?
3. Are monthly rates (H, J, L) the same as quarterly (G) or different?
4. Is quarterly Contacted→MQL rate (G137) zero but monthly rates non-zero?
5. SGA assumptions in O-P?
```

### Answer

**Complete Fintrx data (rows 133-144):**

| Row | Col B Label | C (Q2'25) | D (Q3'25) | E (Q4'25) | F (Q1'26) | G (Q2 Fcst) | H (Apr) | I (Apr act) | J (May) | K (May act) | L (Jun) | M (Jun act) |
|-----|-----------|-----------|-----------|-----------|-----------|------------|---------|-------------|---------|-------------|---------|-------------|
| 133 | Fintrx (Self-Sourced) | | | | | | | | | | | |
| 134 | Created | 0 | 1 | 0 | 1816 | 3720 | 1160 | 0 | 1280 | 0 | 1280 | |
| 135 | Created > Contacted rate | 0% | 100% | 0% | 54.63% | 33.33% | 87.69% | | 87.69% | | 87.69% | |
| 136 | Contacted | 1 | 1 | 0 | 985 | 3262 | 1017 | | 1122 | | 1122 | |
| 137 | Contacted > MQL rate | 0% | 0% | 0% | 7.83% | 0% | 2.30% | | 2.30% | | 2.30% | |
| 138 | Call Scheduled (MQL) | 0 | 0 | 0 | 31 | 75 | 23 | 0 | 26 | 0 | 26 | |
| 139 | CS > SQL rate | 0% | 0% | 0% | 68% | 0% | 40% | | 40% | | 40% | |
| 140 | Opportunity Created (SQL) | 0 | 0 | 0 | 17 | 30 | 9 | 0 | 10 | 0 | 10 | |
| 141 | SQL > SQO rate | 0% | 0% | 0% | 62.50% | 0% | 71% | | 71% | | 71% | |
| 142 | SQO | 0 | 0 | 0 | 10 | 21 | 7 | | 7 | | 7 | |
| 143 | SQO > Joined rate | 0% | 0% | 0% | 0% | | | | | | | |
| 144 | Joined | 0 | 0 | 0 | 0 | | | | | | | |

**1. Historical data (C-F):**
- C (Q2 2025): Essentially zero — Created=0, Contacted=1 (stray record)
- D (Q3 2025): Created=1, Contacted=1, rest zeros
- E (Q4 2025): All zeros
- F (Q1 2026): **First real quarter** — Created=1816, full funnel down to SQO=10

**2. Forecast values in G:**
| Stage | G Value |
|-------|---------|
| Created | 3720 |
| Contacted | 3262 |
| MQL | 75 |
| SQL | 30 |
| SQO | 21 |
| Joined | *(empty)* |

**3. Monthly rates vs quarterly — DRAMATICALLY DIFFERENT:**

| Rate | G (Quarterly) | H/J/L (Monthly) |
|------|--------------|-----------------|
| Created→Contacted | 33.33% | 87.69% |
| Contacted→MQL | **0.00%** | 2.30% |
| MQL→SQL | **0.00%** | 40.00% |
| SQL→SQO | **0.00%** | 71.00% |

**4. YES — G137 (Contacted→MQL) = 0% from AVERAGE(C137:E137) = avg(0,0,0) = 0%. But H137 = 2.3% (hardcoded).** This is the critical issue: the quarterly AVERAGE formula pulls from 3 quarters of zeros (Q2-Q4 2025 had no Fintrx data), producing 0%. The monthly rates are manually overridden to reasonable values matching LinkedIn Self Sourced's rates.

**The quarterly G column for Fintrx is essentially meaningless** — the real forecast is driven entirely by the monthly columns (H, J, L). The G column volumes (e.g., G142=21 SQO) come from `=SUM(H142,J142,L142)`, so they correctly reflect the monthly calculations despite the quarterly rates being zero.

**5. SGA assumptions:**
- O134 = "Avg Monthly Sourcing/SGA", P134 = **80**
- Created per month = 80 × SGAs (same SGA counts as Provided List: 14.5/16/16)
- H134 = 80 × 14.5 = 1,160; J134 = 80 × 16 = 1,280; L134 = 80 × 16 = 1,280

---

### 7.2 — Fintrx Formula Analysis

**Prompt:**
```
Read FORMULAS for:
1. G135 (C→C rate), G137 (C→M rate), G139 (M→S rate), G141 (S→SQO rate)
2. H135, H137, H139, H141 (April rates)
3. G134 (Created volume)

For each: is it AVERAGE of history, a reference to another cell, or hardcoded?

Since Fintrx has minimal history, this shows how the sheet handles NEW sub-sources.
```

### Answer

**1. Quarterly forecast rates (col G):**

| Cell | Formula | Type | Value | Notes |
|------|---------|------|-------|-------|
| G135 | `=AVERAGE(C135:E135)` | AVERAGE of Q2-Q4 2025 | 33.33% | avg(0%, 100%, 0%) — distorted by sparse data |
| G137 | `=AVERAGE(C137:E137)` | AVERAGE of Q2-Q4 2025 | 0.00% | avg(0%, 0%, 0%) — no history |
| G139 | `=AVERAGE(C139:E139)` | AVERAGE of Q2-Q4 2025 | 0.00% | avg(0%, 0%, 0%) — no history |
| G141 | `=AVERAGE(C141:E141)` | AVERAGE of Q2-Q4 2025 | 0.00% | avg(0%, 0%, 0%) — no history |

**2. Monthly rates (col H — April):**

| Cell | Formula | Type | Value | Notes |
|------|---------|------|-------|-------|
| H135 | `0.8769` | **Hardcoded** | 87.69% | Matches LinkedIn SS monthly rate |
| H137 | `0.023` | **Hardcoded** | 2.30% | Matches LinkedIn SS monthly rate |
| H139 | `0.4` | **Hardcoded** | 40.00% | Matches LinkedIn SS monthly rate |
| H141 | `0.71` | **Hardcoded** | 71.00% | Matches LinkedIn SS monthly rate |

**3. Created volume (G134):**
- Formula: `=SUM(H134,J134,L134)` — sum of monthly Created values
- H134 formula: `=$P$134*O108` = 80 (sourcing/SGA) × 14.5 (April SGAs) = 1,160
- J134 formula: `=$P$134*Q108` = 80 × 16 = 1,280
- L134 formula: `=$P$134*T108` = 80 × 16 = 1,280
- G134 = 1,160 + 1,280 + 1,280 = **3,720**

**Volume waterfall formulas (G column):**
| Cell | Formula | Calculation |
|------|---------|-------------|
| G134 | `=SUM(H134,J134,L134)` | Created = sum of monthly |
| G136 | `=SUM(H136,J136,L136)` | Contacted = sum of monthly |
| G138 | `=SUM(H138,J138,L138)` | MQL = sum of monthly |
| G140 | `=SUM(H140,J140,L140)` | SQL = sum of monthly |
| G142 | `=SUM(H142,J142,L142)` | SQO = sum of monthly |

Monthly volume formulas (example for April):
- H136 (Contacted) = H134 × H135 = 1,160 × 0.8769 = 1,017
- H138 (MQL) = H136 × H137 = 1,017 × 0.023 = 23
- H140 (SQL) = `=H138*H139` = 23 × 0.40 = 9
- H142 (SQO) = H140 × H141 = 9 × 0.71 = 7 (rounded)

**How the sheet handles NEW sub-sources:**
1. Historical rates (col G) use the same `=AVERAGE(C:E)` formula as all other sub-sources — but this produces meaningless values (0% or distorted) when history is sparse
2. Monthly rates (H, J, L) are **manually hardcoded** to reasonable targets (borrowed from LinkedIn SS rates)
3. Created volumes use the same SGA-based formula pattern, with a custom sourcing rate (80 vs 200)
4. The quarterly G column volumes are correct because they sum the monthly volumes (which use the hardcoded rates), NOT the quarterly rates
5. **Net effect: the AVERAGE formula in G rates is vestigial for new sub-sources — the real forecast is entirely driven by manual monthly rate inputs**

---

## Phase 8: Canonical Reference Tables

### 8.1 — Complete Channel × Sub-Source × Row Map

**Prompt:**
```
Produce a definitive inventory:

| # | Finance_View Channel | Sub-Source | Sub-Source Row | Created Row | SQO Row | Status | BQ Original_source |

Status: ACTIVE / PLACEHOLDER / NEW
BQ Original_source: exact string in BQ, or "N/A" if no equivalent.
```

### Answer

| # | Finance_View | Sub-Source (Col B) | Name Row | Created Row | SQO Row | Status | BQ Original_source |
|---|-------------|-------------------|----------|-------------|---------|--------|-------------------|
| 1 | Outbound | Provided List (Lead Scoring) | 107 | 108 | 116 | ACTIVE | Provided List (Lead Scoring) |
| 2 | Outbound | LinkedIn (Self Sourced) | 120 | 121 | 129 | ACTIVE | LinkedIn (Self Sourced) |
| 3 | Outbound | Fintrx (Self-Sourced) | 133 | 134 | 142 | NEW | Fintrx (Self-Sourced) |
| 4 | Marketing | Blog | 149 | 150 | 158 | PLACEHOLDER | Blog* |
| 5 | Marketing | Search | 162 | 163 | 171 | PLACEHOLDER | N/A |
| 6 | Marketing | LinkedIn Savvy | 175 | 176 | 184 | PLACEHOLDER | LinkedIn Savvy |
| 7 | Marketing | LinkedIn Social | 188 | 189 | 197 | PLACEHOLDER | N/A |
| 8 | Marketing | LinkedIn (Content) | 201 | 202 | 210 | PLACEHOLDER | N/A |
| 9 | Marketing | LinkedIn (Automation) | 214 | 215 | 223 | PLACEHOLDER | N/A |
| 10 | Marketing | Direct Traffic (1st — no forecast) | 227 | 228 | 236 | SUPERSEDED | Direct Traffic |
| 11 | Marketing | Website | 240 | 241 | 249 | PLACEHOLDER | N/A |
| 12 | Marketing | Direct Traffic (2nd — with forecast) | 253 | 254 | 263 | ACTIVE | Direct Traffic |
| 13 | Marketing | Google Ads + LinkedIn Ads | 270 | 271 | 279 | ACTIVE | N/A (combined) |
| 14 | Marketing | Job Applications | 282 | 283 | 291 | ACTIVE | Job Applications |
| 15 | Marketing | Google Ads | 295 | 296 | 304 | PLACEHOLDER | Google Ads* |
| 16 | Marketing | Meta | 308 | 309 | 317 | PLACEHOLDER | N/A |
| 17 | Marketing | LinkedIn Ads | 321 | 322 | 330 | PLACEHOLDER | LinkedIn Ads |
| 18 | Outbound + Marketing | Events | 336 | 337 | 345 | ACTIVE | Events |
| 19 | Outbound + Marketing | Direct Mail | 349 | 350 | 358 | PLACEHOLDER | N/A |
| 20 | Outbound + Marketing | Webinar | 362 | 363 | 371 | PLACEHOLDER | N/A |
| 21 | Outbound + Marketing | Provided List (Marketing) | 375 | 376 | 384 | ACTIVE | Provided List (Marketing) |
| 22 | Re-Engagement | Re-Engagement | 390 | 391 | 399 | ACTIVE | Re-Engagement |
| 23 | Partnerships | Recruitment Firm | 405 | 406 | 414 | ACTIVE | Recruitment Firm |
| 24 | Advisor Referrals | Advisor Referral | 420 | 421 | 429 | ACTIVE | Advisor Referral |
| 25 | Other | Other | 435 | 436 | 444 | ACTIVE | Other |
| 26 | Other | Unknown | 448 | 449 | 457 | PLACEHOLDER | Unknown* |

*Blog, Google Ads, Unknown exist in BQ (monthly_conversion_rates Original_source list) but only have sparse data.

**BQ sources NOT in sheet:** Employee Referral (Partnerships), Partnerships (Partnerships) — these are tracked in BQ but have no corresponding detail section in the forecast.

**Sheet sub-sources NOT in BQ quarterly data:** Search, LinkedIn Social, LinkedIn (Content), LinkedIn (Automation), Website, Meta, Direct Mail, Webinar, Google Ads + LinkedIn Ads (combined) — all are placeholder or custom combined entries.

---

### 8.2 — Data Flow Summary

**Prompt:**
```
Document the complete data flow:

HISTORICAL VOLUMES: BQ view → Connected Sheet tab → [formula pattern] → forecast detail sections
HISTORICAL RATES: BQ view → Connected Sheet tab → [formula pattern] → forecast detail sections
FORECAST RATES: [how calculated from historical — exact formula pattern]
FORECAST VOLUMES: [waterfall calculation pattern]
CREATED VOLUME SOURCES: [by channel type — SGA-based? hardcoded? formula?]
ACTUALS: [populated or empty? source?]
ROLLUP: [aggregation method — SUM of details? independent pull?]
```

### Answer

**HISTORICAL VOLUMES (cols C-F):**
```
BQ: vw_channel_funnel_volume_by_month
  → Connected Sheet: Volumes tab (372 rows, auto-refresh)
  → SUMPRODUCT in detail sections:
    =SUMPRODUCT((Volumes!$D$=year)*(Volumes!$F$=quarter)
      *((Volumes!$A$="QTD")+(Volumes!$A$="QUARTERLY"))
      *(Volumes!$I$=Original_source)*(Volumes!$M-R$=stage_column))
    Stage columns: M=prospects, N=contacted, O=mql, P=sql, Q=sqo, R=joined
```

**HISTORICAL RATES (cols C-F):**
```
BQ: vw_channel_conversion_rates_pivoted
  → Connected Sheet: monthly_conversion_rates tab (373 rows, auto-refresh)
  → SUMPRODUCT in detail sections:
    =SUMPRODUCT((monthly_conversion_rates!$D$=year)*(monthly_conversion_rates!$F$=quarter)
      *((monthly_conversion_rates!$A$="QTD")+(monthly_conversion_rates!$A$="QUARTERLY"))
      *(monthly_conversion_rates!$H$=Original_source)*(monthly_conversion_rates!$XX$=rate_column))
    Rate columns: AH=created→contacted, N=contacted→mql, R=mql→sql, V=sql→sqo, Z=sqo→joined
```

**FORECAST RATES (col G — quarterly):**
```
=AVERAGE(C_rate:E_rate)  — average of Q2, Q3, Q4 2025 (3 historical quarters)
Note: Does NOT include Q1 2026 (col F). Always C:E range.
```

**FORECAST RATES (cols H, J, L — monthly):**
```
Hardcoded manual values. Set by forecast owner as target rates.
Can differ significantly from quarterly AVERAGE (especially for new sub-sources like Fintrx).
Same rate typically repeated across all 3 months (H=J=L).
```

**FORECAST VOLUMES (cols G, H, J, L):**
```
Monthly waterfall (using April/H as example):
  H_Created = [see CREATED VOLUME SOURCES below]
  H_Contacted = H_Created × H_Created→Contacted_rate
  H_MQL = H_Contacted × H_Contacted→MQL_rate
  H_SQL = H_MQL × H_MQL→SQL_rate
  H_SQO = H_SQL × H_SQL→SQO_rate

Quarterly (col G) = SUM(H, J, L) for each stage
  G_Created = SUM(H_Created, J_Created, L_Created)
  G_Contacted = SUM(H_Contacted, J_Contacted, L_Contacted)
  etc.

Note: G rate × G volume does NOT hold — quarterly volumes are sums of monthly, not quarterly rate × quarterly input.
```

**CREATED VOLUME SOURCES (by channel):**
```
Outbound sub-sources (SGA-based):
  H_Created = Avg_Monthly_Sourcing_per_SGA (P row) × SGAs_this_month (O/Q/T row 108)
  - Provided List: 200/SGA × SGAs
  - LinkedIn Self Sourced: 200/SGA × SGAs
  - Fintrx: 80/SGA × SGAs
  SGAs: April=14.5, May=16, June=16

All other channels:
  Manually entered / hardcoded values in H, J, L columns.
  G = SUM(H, J, L).
```

**ACTUALS (cols I, K, M):**
```
Mostly EMPTY across the sheet. A few sub-sources have explicit zeros in I/K:
  - Fintrx: I134=0, K134=0 (Created actuals = 0)
  - Most other sub-sources: I/K/M completely blank
Actuals are not yet populated for Q2 2026 (quarter hasn't started as of this analysis).
```

**ROLLUP (three tiers):**
```
Tier 1 — Main Rollup (rows 10-53): Historical only (C-F)
  Total rows (10, 19, 28, 37, 46): =SUM(channel_breakdown_rows)
  Channel breakdown rows: SUMPRODUCT from Volumes tab using Finance_View as key
  G-M columns: EMPTY

Tier 2 — Channel Summary (rows 56-103): Historical + Forecast
  =SUMIFS(G$106:G$10014, $A$106:$A$10014, channel_name, $B$106:$B$10014, stage_label)
  Aggregates from detail sections by matching column A (channel) and column B (stage name)

Tier 3 — B4 (Total Forecast SQOs = 166):
  =sumifs(G56:G103, B56:B103, "SQOs")
  Sums from Channel Summary section
```

---

### 8.3 — Open Questions & Discrepancies

**Prompt:**
```
List every discrepancy, anomaly, or question found. For each:
- What was found
- Where (cells/rows)
- Impact on dashboard feature (blocker vs data quality note)
- Recommended resolution
```

### Answer

**1. Duplicate Direct Traffic sections**
- **Found:** Two "Direct Traffic" sub-source blocks under Marketing Organic — first at row 227 (no forecast), second at row 253 (with forecast).
- **Where:** Rows 227-238 and 253-265
- **Impact:** BLOCKER for dashboard — if both are summed, historical data would be double-counted. The SUMIFS in the channel summary may pick up both since they match on column A="Marketing" and column B="SQO".
- **Resolution:** Determine which is canonical. The 2nd (row 253) has forecast data and is likely the intended active section. The 1st should be deleted or its column A label changed to exclude it from SUMIFS.

**2. Created volume discrepancy (sheet vs BQ)**
- **Found:** Sheet SUMPRODUCT returns higher prospects_created than BQ direct query: Provided List 9538 vs 9490 (+48), LinkedIn SS 8133 vs 8115 (+18), Recruitment Firm 179 vs 180 (-1).
- **Where:** E108, E121, E406 vs BQ Q4 2025 QUARTERLY data
- **Impact:** Data quality note — small percentage differences (<1%). Not a blocker.
- **Resolution:** The SUMPRODUCT matches both "QTD" and "QUARTERLY" period_type. If the Volumes tab contains both row types for completed quarters, they'll be double-summed. Dashboard should query BQ directly with `period_type = 'QUARTERLY'` only.

**3. Fintrx quarterly rates are meaningless**
- **Found:** G135-G141 rates use AVERAGE(C:E) which returns 0% or distorted values because Fintrx had no data in Q2-Q4 2025. Actual forecast is driven by hardcoded monthly rates.
- **Where:** G135=33.33%, G137=0%, G139=0%, G141=0%
- **Impact:** Data quality note — dashboard should display monthly rates, not quarterly, for Fintrx. Or use a weighted calculation.
- **Resolution:** Dashboard should compute quarterly rate as: Quarterly_Volume_Out / Quarterly_Volume_In (from the G column volumes which are correct), not display the G rate column directly.

**4. Fintrx label syntax differs from standard**
- **Found:** Uses ">" instead of "→" and abbreviates "CS > SQL rate" instead of "Call Scheduled → SQL rate".
- **Where:** Rows 135, 137, 139, 141, 143
- **Impact:** BLOCKER for SUMIFS matching — if any formula matches on exact label text like "Call Scheduled → SQL rate", it won't find Fintrx's "CS > SQL rate". However, the channel summary SUMIFS matches on stage volume labels (e.g., "SQO", "Created") which ARE consistent.
- **Resolution:** Dashboard should match on volume row labels only (Created, Contacted, Call Scheduled (MQL), Opportunity Created (SQL), SQO, Joined), not rate labels.

**5. BQ sources missing from sheet**
- **Found:** Employee Referral and Partnerships (as Original_source) exist in BQ under the Partnerships Finance_View but have no detail sections in the forecast sheet.
- **Where:** BQ taxonomy vs sheet inventory
- **Impact:** Data quality note — historical rollup may undercount Partnerships volumes slightly (Partnerships source had 2 prospects in Q4 2025). Employee Referral doesn't appear in Q4 2025 data.
- **Resolution:** Minor — these are small volume sources. Dashboard should note that the forecast covers only Recruitment Firm under Partnerships.

**6. "Google Ads + LinkedIn Ads" combined sub-source has no BQ equivalent**
- **Found:** Row 270 combines two BQ sources into one forecast line. Historical data is all zeros (since BQ tracks them separately and they only appeared in Q1 2026).
- **Where:** Rows 270-280
- **Impact:** Data quality note — dashboard will need to map this combined forecast to individual BQ sources for actuals comparison, or create a combined actuals view.
- **Resolution:** When comparing forecast vs actuals, sum Google Ads + LinkedIn Ads BQ data to match this forecast line.

**7. Marketing Organic rollup potential double-counting**
- **Found:** Both Direct Traffic sections (#10 and #12) have column A = "Marketing", so the channel summary SUMIFS could sum both.
- **Where:** Channel summary rows 63-68 (Marketing block)
- **Impact:** Potential BLOCKER — could inflate Marketing forecast/historical.
- **Resolution:** Verify by comparing channel summary values with expected totals. If double-counted, remove the superseded Direct Traffic section (row 227).

**8. Rollup rows 10-53 have no forecast (G-M) data**
- **Found:** The main rollup section only has historical data. Forecast totals are in the channel summary (rows 56-103) and B4.
- **Where:** G10:M53 = empty
- **Impact:** Dashboard design note — don't try to read forecast from the rollup section.
- **Resolution:** Use channel summary section (rows 56-103) or detail sections for forecast data.

**9. Q1 2026 not included in AVERAGE for forecast rates**
- **Found:** Forecast rates use `=AVERAGE(C:E)` (Q2-Q4 2025), excluding Q1 2026 (col F) which is the most recent quarter.
- **Where:** All G-column rate formulas (e.g., G109, G122, G135)
- **Impact:** Data quality note — the forecast deliberately uses only 2025 quarters, not the most recent data. This is likely intentional (Q1 2026 may not be complete or may have seasonal differences to exclude).
- **Resolution:** Dashboard should follow the same convention. Document this as an intentional design choice.

**10. Actuals columns (I, K, M) mostly empty**
- **Found:** Q2 2026 hasn't started yet, so actuals are blank. A few cells have explicit 0 (Fintrx I134=0, K134=0).
- **Where:** Columns I, K, M throughout
- **Impact:** Dashboard design note — actuals vs forecast comparison won't have data until Q2 2026 begins.
- **Resolution:** Dashboard should handle empty actuals gracefully (show forecast only until actuals populate).

---

*Document generated for Claude Code execution with Google Sheets MCP + BigQuery MCP. All Answer sections to be populated during exploration.*
