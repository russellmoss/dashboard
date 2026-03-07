# Agent Guide V5: Tenure Discrimination + Conditional Shadow Table Refresh
**Version**: 5.0
**System**: Claude Code (single agent, no subagents)
**BigQuery Project**: `savvy-gtm-analytics`
**SQL File**: `C:\Users\russe\Documents\Dashboard\aum_v5_tenure_and_refresh.sql`
**Output File**: `C:\Users\russe\Documents\Dashboard\aum_v5_findings.md` (you will create this)

---

## Why This Investigation Exists

In V4, we were unable to compute current firm tenure because we looked in the
wrong table. `contact_registered_employment_history` stores only *terminated*
registrations — all rows have a populated end date. We concluded firm tenure
was unavailable.

This was wrong. `ria_contacts_current` has the current employment record and
exposes three fields we never used:

- **`PRIMARY_FIRM_START_DATE`** — when the advisor joined their current firm.
  Current firm tenure = `DATE_DIFF(CURRENT_DATE(), PRIMARY_FIRM_START_DATE, MONTH)`.
  No history table join needed.

- **`PREVIOUS_REGISTRATION_COMPANY_CRD_IDS`** — a pre-aggregated string of all
  prior firm CRDs. Prior firm count = `ARRAY_LENGTH(SPLIT(..., ','))`.
  Cleaner and simpler than the history table join used in V4.

- **`LATEST_REGISTERED_EMPLOYMENT_START_DATE` / `END_DATE`** — the dates for
  the most recent prior employer, enabling job gap analysis.

This investigation tests whether current firm tenure discriminates between the
$40M–$100M labeled cohort and the general population. If it does (Cohen's d > 0.30),
we add it to TIER_AUM_MID's criteria and regenerate the shadow table. If it
doesn't, the existing shadow table stands — we just correct the methodology doc.

---

## What Changes vs. What Stays the Same

**V4 findings that remain valid regardless of V5 results:**
- Signal rankings from V2 (license_count d=0.70, hnw_ratio d=0.61, etc.)
- Ceiling analysis from V3 (firm_aum < $1B, no accolade)
- Overlap analysis from V4 (97.4% net new — this doesn't depend on tenure)
- Prior firm count discrimination from V4 (d=0.19, soft weight) — V5 Block 2
  will cross-validate this using the cleaner field, but the conclusion may hold

**What V5 might change:**
- Whether `tenure_at_firm_years` is added to TIER_AUM_MID criteria
- The shadow table row count (if tenure criterion added, pool shrinks)
- The methodology doc (employment history section needs correction regardless)
- The prior firm count in the shadow table (will use cleaner V5 method)

---

## Output File Initialization

Create `C:\Users\russe\Documents\Dashboard\aum_v5_findings.md` immediately:

```markdown
# V5: Tenure Discrimination + Shadow Table Refresh — Findings
**Run Date**: [INSERT TIMESTAMP]
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_v5_tenure_and_refresh.sql
**Status**: IN PROGRESS

---
```

---

## Environment Setup

```python
from google.cloud import bigquery
import pathlib

client = bigquery.Client(project="savvy-gtm-analytics")
list(client.query("SELECT 1").result())
print("BQ: OK")

sql_path = pathlib.Path(r"C:\Users\russe\Documents\Dashboard\aum_v5_tenure_and_refresh.sql")
assert sql_path.exists()

prereqs = [
    "savvy-gtm-analytics.ml_features.aum_proxy_labeled_features",
    "savvy-gtm-analytics.ml_features.aum_proxy_control_features",
    "savvy-gtm-analytics.ml_features.aum_mid_tier_candidates",  # V4 shadow table
    "savvy-gtm-analytics.ml_features.v4_prospect_scores",
]
for t in prereqs:
    n = list(client.query(f"SELECT COUNT(*) AS n FROM `{t}`").result())[0]['n']
    assert n > 0, f"Missing or empty: {t}"
    print(f"  {t.split('.')[-1]}: {n:,} rows OK")

# Confirm PRIMARY_FIRM_START_DATE exists and has data
check = """
  SELECT
    COUNTIF(PRIMARY_FIRM_START_DATE IS NOT NULL) AS has_start_date,
    COUNT(*) AS total
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
  WHERE PRODUCING_ADVISOR = 'true'
  LIMIT 1
"""
row = list(client.query(check).result())[0]
print(f"PRIMARY_FIRM_START_DATE coverage: {row['has_start_date']:,} / {row['total']:,}")
assert row['has_start_date'] > 0, "PRIMARY_FIRM_START_DATE is empty — cannot proceed"

# Confirm PREVIOUS_REGISTRATION_COMPANY_CRD_IDS exists and has data
check2 = """
  SELECT COUNTIF(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NOT NULL
    AND TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) != '') AS has_prior_crds
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
  WHERE PRODUCING_ADVISOR = 'true'
  LIMIT 1
"""
row2 = list(client.query(check2).result())[0]
print(f"PREVIOUS_REGISTRATION_COMPANY_CRD_IDS populated: {row2['has_prior_crds']:,}")
```

Record:
```markdown
## Environment Setup
- BQ: PASS/FAIL
- SQL file: PASS/FAIL
- Prereq tables: [each with row count]
- PRIMARY_FIRM_START_DATE coverage: [n] / [total] ([pct]%)
- PREVIOUS_REGISTRATION_COMPANY_CRD_IDS populated: [n]
- Status: READY / HALTED
```

---

## BLOCK 1A: CURRENT FIRM TENURE DISCRIMINATION

**What**: Computes `tenure_at_firm_years` from `PRIMARY_FIRM_START_DATE` for both
the labeled $40M–$100M cohort and the control group. Reports distributions,
bucket breakdowns, and all inputs needed to compute Cohen's d.

**What to look for**:
The key question is: are $40M–$100M advisors MORE settled at their current firm
than the general population? If yes, tenure is a floor signal (longer = more likely
to be in target band). If they're MORE mobile (shorter tenure), it's still useful
but as an exclusion criterion rather than an inclusion criterion.

Specifically watch:
- `pct_1_4yr`: PRIME_MOVER window — if labeled is LOW here, these advisors are
  NOT recent movers. That's what we expect.
- `pct_over_10yr` or `pct_settled_5plus`: if labeled is HIGH here, long tenure
  is a positive signal for TIER_AUM_MID.

**⛔ VALIDATION GATE 1A — Hard Stop**

```python
# After running Block 1A query, compute Cohen's d
results = {row['group_label']: row for row in block1a_results}
labeled = results['$40M-$100M']
control = results['Control']

cohens_d = abs(labeled['avg_tenure_at_firm'] - control['avg_tenure_at_firm']) / \
           ((labeled['stddev_tenure_at_firm'] + control['stddev_tenure_at_firm']) / 2)
print(f"Cohen's d (tenure at firm): {cohens_d:.3f}")
```

Gate criteria:
- `has_tenure` for labeled group must be > 200 (> 65% coverage)
  — if lower, `PRIMARY_FIRM_START_DATE` is too sparse for this cohort to use
- Cohen's d must be computable (stddev > 0 in both groups)

Record:
```markdown
## Block 1A: Current Firm Tenure Discrimination

### Coverage
- Labeled has_tenure: [n] ([pct]%) — Pass/Fail (>200 required)
- Control has_tenure: [n] ([pct]%)

### Distributions

| Metric | Labeled ($40M–$100M) | Control |
|--------|---------------------|---------|
| N | | |
| Avg tenure at firm (years) | | |
| Stddev | | |
| Median | | |
| P25 | | |
| P75 | | |
| % < 1 year | | |
| % 1–4 years (PRIME_MOVER window) | | |
| % 4–10 years | | |
| % > 10 years | | |
| Avg % of career at current firm | | |

### Cohen's d Calculation
```
d = |[labeled_avg] - [control_avg]| / (([labeled_stddev] + [control_stddev]) / 2)
  = |[X] - [Y]| / ([A] + [B]) / 2
  = [result]
```

### Signal Assessment

**d < 0.20**: Tenure does not discriminate. Do NOT add to criteria. Correct
  methodology doc only. Shadow table stands unchanged. STOP after Block 1.

**d 0.20–0.30**: Weak signal. Use as soft scoring weight in priority_rank ORDER BY.
  Do NOT add as hard filter. Update shadow table priority logic only.

**d 0.31–0.50**: Moderate signal. Determine tenure criterion from bucket distributions:
  - If labeled `pct_1_4yr` substantially LOWER than control → add `tenure_at_firm_years > 4`
  - If labeled `pct_over_10yr` substantially HIGHER than control → add `tenure_at_firm_years > 5`
  Proceed to Block 1B, Block 1C, Block 2, then Block 3 (conditional).

**d > 0.50**: Strong signal. Definitely add tenure criterion. Determine threshold
  from bucket distributions. Proceed to all remaining blocks.

**Decision**: [d value] → [Do not add / Soft weight / Add criterion: "tenure > X"]
```

---

## BLOCK 1B: PREVIOUS_REGISTRATION_COMPANY_CRD_IDS DISCRIMINATION

**What**: Counts prior firms from the pre-aggregated field on `ria_contacts_current`.
Computes Cohen's d for comparison to V4's result (d=0.19 from history table).

**Expected**: Either confirms d≈0.19 (V4 conclusion stands: soft weight only)
or reveals a different discrimination level if the V4 history table join was
systematically missing firms.

Record:
```markdown
## Block 1B: Prior Firm Count from CRD_IDS Field

| Metric | Labeled | Control |
|--------|---------|---------|
| N | | |
| Null or empty | | |
| Avg prior firms (V5) | | |
| Stddev | | |
| Median | | |
| % with 3+ prior firms | | |

**Cohen's d (V5)**:
= |[labeled] - [control]| / (([stddev_l] + [stddev_c]) / 2)
= [value]

**Comparison to V4 result** (d=0.19 from history table join):
- V5 d: [value]
- V4 d: 0.19
- Agreement: [Yes — confirms soft weight / No — V5 shows stronger/weaker signal]

**Revised prior firm count conclusion**:
[Confirm d=0.19 soft weight / Revise to: strong enough to add as criterion /
 Revise to: even weaker than V4 showed]
```

---

## BLOCK 1C: JOB GAP ANALYSIS

**What**: How long ago did the $40M–$100M advisor leave their last prior employer?
This is a characterization query — not necessarily a filter criterion, but useful
for understanding the population and for flagging advisors in the PRIME_MOVER window.

**Key insight to test**: If $40M–$100M advisors made their last move significantly
longer ago than the control group (larger `avg_gap_years`), it confirms they are
a settled population who built their book in place rather than recently arrived.

Record:
```markdown
## Block 1C: Job Gap Analysis

| Metric | Labeled | Control |
|--------|---------|---------|
| N (has both dates) | | |
| Avg current firm tenure | | |
| Avg gap between jobs (years) | | |
| Median gap | | |
| % in PRIME_MOVER window (1–4yr tenure) | | |
| % settled 5+ years | | |
| % settled 10+ years | | |

**Interpretation**:
[Plain English: when did these advisors last move, and how does that compare to the
 general population? Does this reinforce the "stable book-builder" hypothesis?]

**PRIME_MOVER contamination check**:
If pct_prime_mover_window (1–4yr tenure) in TIER_AUM_MID candidates is > 25%,
a meaningful fraction of this tier's population is already in the PRIME_MOVER window.
These advisors should arguably be in TIER_1_PRIME_MOVER instead.
Recommendation: [add tenure > 4yr criterion to exclude them / accept the overlap]
```

---

## BLOCK 2: CROSS-VALIDATION — V5 vs V4 PRIOR FIRM COUNTS

**What**: Direct comparison of prior firm counts from both methods for the
same advisors. Determines which is more accurate and whether V4's d=0.19
conclusion needs revision.

**How to interpret**:
- If V5 and V4 agree within 1 firm for >80% of advisors → methods are consistent,
  V4 conclusion stands, use V5 method going forward (cleaner, no join needed)
- If V5 consistently higher → V4's history table was undercounting firms
  (supporting the -1 overadjustment hypothesis from V4). Recompute Cohen's d
  using V5 counts.
- If V5 consistently lower → the CRD_IDS field may be incomplete. Use V4 method.

Record:
```markdown
## Block 2: Prior Firm Count Cross-Validation

| Metric | Labeled | Control |
|--------|---------|---------|
| Avg V5 count | | |
| Avg V4 count | | |
| Avg delta (V5 - V4) | | |
| % agree within 1 | | |
| V5 higher count | | |
| Same count | | |
| V5 lower count | | |

**Consistency verdict**:
[Consistent (>80% agree within 1) / V5 systematically higher / V5 systematically lower]

**Preferred method going forward**: [V5 (CRD_IDS field) / V4 (history table)]

**Does this change the d=0.19 soft weight conclusion?**
[No — V4 and V5 agree, conclusion stands /
 Yes — recompute Cohen's d: d = [new value], revised conclusion: [soft/hard criterion]]
```

---

## BLOCK 3: CONDITIONAL SHADOW TABLE REFRESH

**Run this block ONLY if Block 1A Cohen's d > 0.30.**

If d ≤ 0.30: SKIP Block 3 entirely. Write "Shadow table unchanged — V4 table
remains current" in findings and stop.

### Before running Block 3

**Update the SQL placeholder**. The Block 3 CREATE TABLE query has a commented
placeholder for the tenure criterion:

```sql
-- PLACEHOLDER: uncomment and replace with actual criterion from Block 1A
-- AND [TENURE_CRITERION]
```

Based on Block 1A results, determine the correct threshold and uncomment:

- If labeled has significantly LOWER `pct_1_4yr` than control:
  ```sql
  AND DATE_DIFF(CURRENT_DATE(), SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE), MONTH) / 12.0 > 4
  ```

- If labeled has significantly HIGHER `pct_over_10yr` than control:
  ```sql
  AND DATE_DIFF(CURRENT_DATE(), SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE), MONTH) / 12.0 > 5
  ```

Edit the SQL file directly before executing Block 3.

**⛔ VALIDATION GATE 3 — Hard Stop**

After running Block 3B validation queries:

Pass criteria:
- `has_tenure` > 0 (PRIMARY_FIRM_START_DATE is now populating `tenure_at_firm_years`)
- `pct_has_tenure` > 60% (if lower, field coverage is too sparse for production use)
- `unique_crds` = `total_candidates` (no duplicates)
- `delta_vs_v4_shadow` is negative (tenure criterion reduced pool — expected)
  If delta is POSITIVE, something is wrong — the refresh added rows rather than
  subtracting them. Investigate before proceeding.
- `max_per_firm` ≤ 50 (firm diversity cap)

Record:
```markdown
## Block 3: Shadow Table Refresh

### Decision to run: [YES (d=[value] > 0.30) / NO (d=[value] ≤ 0.30, skipped)]

### Tenure criterion added:
```sql
[paste the actual criterion added, or "None — table unchanged"]
```

### Validation Results
| Metric | Value | Pass/Fail |
|--------|-------|-----------|
| Total candidates | | vs V4: 3,998 |
| Delta vs V4 | | (negative = expected) |
| Has tenure populated | | (pct%) |
| Unique CRDs | | = total? |
| Max per firm | | ≤ 50? |
| Avg V4 percentile | | vs V4: 56.0 |
| Avg tenure at firm | | |

### Tenure distribution in refreshed table

[PASTE bucket distribution from Block 3B query 2]

### Status: PASS / FAIL
```

---

## FINAL SYNTHESIS

```markdown
---

## Final Synthesis

### Key Question Answered: Does tenure at current firm discriminate?

**Cohen's d**: [value]
**Answer**: [Yes — strong/moderate signal (d>[threshold]) / No — weak signal (d≤0.30)]

### What Changed vs. V4

| Component | V4 State | V5 State |
|-----------|----------|----------|
| Current firm tenure | NULL everywhere (wrong table) | [populated / still sparse] |
| Prior firm count method | History table join (-1 adjustment) | CRD_IDS field on ria_contacts_current |
| Prior firm count d | 0.19 (soft weight) | [confirmed / revised to: X] |
| Tenure criterion in criteria | Not present | [Not added (d≤0.30) / Added: tenure > X yr] |
| Shadow table row count | 3,998 | [same / new count: X] |

### Corrected Understanding of Employment Tables

The employment data architecture in FinTrx_data_CA is:

- **`ria_contacts_current`**: IS the current employment record. Contains
  `PRIMARY_FIRM_START_DATE` (current firm tenure), `PRIMARY_FIRM` (current firm CRD),
  `PREVIOUS_REGISTRATION_COMPANY_CRD_IDS` (pre-aggregated list of all prior firm CRDs),
  `LATEST_REGISTERED_EMPLOYMENT_START_DATE / END_DATE` (most recent prior job dates).

- **`contact_registered_employment_history`**: Contains only TERMINATED registrations.
  All rows have a populated end date. Current employer is never in this table.
  Use for: individual prior employer details (firm name, dates, specific CRD lookup).
  Do NOT use for: current tenure, current firm identification.

The V4 investigation's conclusion that "current firm tenure cannot be derived"
was incorrect — it can be derived from `PRIMARY_FIRM_START_DATE` on `ria_contacts_current`.
The prior firm count computed in V4 using the history table is valid but the
`-1` adjustment should be removed since the current firm is never in that table.
The V5 method (CRD_IDS field) is preferred going forward — no join required.

### Documents to Update

- [ ] `$40M–$100M_Advisor_Profile_Technical_Methodology.md`
  → Section 8 (Known Data Quality Issues): correct employment history description
  → Section 6 (V4): update Block 1A root cause explanation
  → Section 7 (Final Criteria): add tenure criterion if d > 0.30

- [ ] `TIER_AUM_MID_Proposal.md`
  → Update criteria table if tenure criterion added
  → Update shadow table row count if refreshed

- [ ] `$40M–$100M_Advisor_Profile_Executive_Summary.md`
  → Minor update to "stable advisor" characterization if tenure data confirms it

### Shadow Table Status
[`ml_features.aum_mid_tier_candidates` is current as of V5 run /
 V4 table unchanged — V5 confirmed no update needed]

**Ready for April 2026 shadow run**: YES / NO (reason)
```

---

## Validation Summary

```markdown
---

## Validation Summary

| Step | Status | Key Result |
|------|--------|-----------|
| Environment Setup | PASS/FAIL | Fields confirmed present |
| Block 1A: Tenure Discrimination | PASS/FAIL | d=[value] |
| Block 1B: Prior Firm Count V5 | PASS/FAIL | d=[value], method=[v5/v4] |
| Block 1C: Job Gap Analysis | PASS/FAIL | Settled profile confirmed: Y/N |
| Block 2: Cross-Validation | PASS/FAIL | Methods agree: Y/N |
| Block 3: Shadow Refresh | RAN/SKIPPED | [new count / unchanged] |

**Overall Status**: COMPLETE
**Primary Finding**: [One sentence — does tenure discriminate or not?]
**Action taken on shadow table**: [Refreshed with tenure > Xyr / Unchanged]
```

---

## Error Handling

1. If `SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE)` returns all NULL:
   Try alternative format `'%m/%d/%Y'`. Run:
   ```sql
   SELECT DISTINCT LEFT(PRIMARY_FIRM_START_DATE, 10) AS sample
   FROM FinTrx_data_CA.ria_contacts_current
   WHERE PRIMARY_FIRM_START_DATE IS NOT NULL LIMIT 5
   ```
   Determine the actual date format and update all PARSE_DATE calls in the SQL.

2. If `PREVIOUS_REGISTRATION_COMPANY_CRD_IDS` delimiter is not a comma:
   Run:
   ```sql
   SELECT PREVIOUS_REGISTRATION_COMPANY_CRD_IDS
   FROM FinTrx_data_CA.ria_contacts_current
   WHERE PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NOT NULL
     AND TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) != ''
   LIMIT 5
   ```
   Inspect the actual delimiter and update SPLIT() calls accordingly.

3. If Block 3 tenure criterion reduces candidates below 1,000:
   The threshold is too aggressive. Try a looser threshold:
   - If adding `> 4yr`, try `> 2yr` instead
   - Record both versions' row counts and let the human decide the threshold

## Cost Awareness

Blocks 1A–1C and 2: ~8–12 GB (joining labeled/control to ria_contacts_current)
Block 3: ~15–20 GB (full FINTRX universe scan)
Estimated total if all blocks run: ~30 GB
If only Blocks 1–2 run (tenure d ≤ 0.30): ~12 GB
