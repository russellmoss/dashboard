# Agent Guide V4: Tier Overlap Analysis + Production SQL Stub
**Version**: 4.0
**System**: Claude Code (single agent, no subagents)
**BigQuery Project**: `savvy-gtm-analytics`
**SQL File**: `C:\Users\russe\Documents\Dashboard\aum_v4_overlap_and_production.sql`
**Output File**: `C:\Users\russe\Documents\Dashboard\aum_v4_findings.md` (you will create this)

---

## Context — What We Know So Far

Three prior investigations have established the following:

**V1** confirmed the $40M–$100M SFDC cohort (364 opps, 307 unique CRDs matched to FINTRX).
Non-excluded win rate: 3.4% (directional only — n=9 wins).
Strongest signal: solo/micro firm (1–3 reps), 88.9% of wins.

**V2** compared the labeled cohort to 3,442 control advisors.
Top discriminating signals (ranked):
1. `license_count < 3` — Cohen's d = 0.70 (strongest)
2. `firm_hnw_ratio > 0.30` — Cohen's d = 0.61
3. `firm_rep_count` (continuous) — Cohen's d = 0.58
4. `firm_disc_ratio > 0.70` — Cohen's d = 0.53
5. `is_portable_custodian` — 2.3x lift
6. `is_independent_ria` — 2.8x lift
7. `has_series_7 = FALSE` — negative signal (0.61x)

The divisor proxy (firm_aum / rep_count) was definitively non-discriminating (Cohen's d = 0.005).

Employment history (prior_firm_count, tenure_at_firm_years) returned NULL in V2/V3 due
to a CTE bug — the WHERE clause filtered to END_DATE IS NULL which only returns the
current employer row, making prior firm count always 0 or NULL. This is NOW FIXED in
the V4 SQL with two separate CTEs (see Block 1 below).

**V3** confirmed ceiling signals are weak — $40M–$100M and >$100M advisors are nearly
identical on 10 of 13 features. Two usable ceiling criteria:
- `firm_aum < $1B` (from B2 firm distribution — 54.7% of Enhanced candidates were at $1B+ firms)
- `has_any_accolade = FALSE` (accolade presence = 5x more common in >$100M cohort)

**Enhanced criteria** (all must be true) = the TIER_AUM_MID filter:
```
(is_independent_ria = TRUE
 OR (is_portable_custodian = TRUE AND has_series_7 = FALSE))
AND firm_disc_ratio > 0.70
AND firm_hnw_ratio > 0.30
AND license_count < 3
AND industry_tenure_years BETWEEN 7 AND 25
AND firm_aum < $1B
AND has_any_accolade = FALSE
```
V2 benchmark: 51.1% labeled recall / 12.9% control pass / 3.96x precision lift.
V3 volume estimate: ~659 monthly new prospects with $1B ceiling applied.

**One confirmed data issue**: CFP/CFA fields return 0% in FinTrx_data_CA — these
credentials are not populated in this dataset. Do not attempt to use them.

---

## Known Table Join Keys
All FINTRX joins use:
```sql
contact_registered_employment_history.RIA_CONTACT_CRD_ID
  = ria_contacts_current.RIA_CONTACT_CRD_ID
```
Both tables are in `savvy-gtm-analytics.FinTrx_data_CA`.
The employment history table has one row per employer per advisor.
END_DATE IS NULL = currently employed there.
END_DATE IS NOT NULL = prior employer.

---

## What This Investigation Does

**Block 1** — Fixes and validates the employment history join.
  Confirms `prior_firm_count` and `tenure_at_firm_years` now return real values
  for the labeled cohort. Also checks if `prior_firm_count` discriminates between
  the $40M–$100M cohort and control — if it does, it gets added to the criteria.

**Block 2** — Tier overlap analysis.
  Of all advisors passing Enhanced criteria, how many are already in the current
  month's lead list under existing V3 tiers? Breakdown by tier tells you whether
  TIER_AUM_MID adds net new coverage or just duplicates existing tiers.
  TIER_2_PROVEN_MOVER is the most likely overlap candidate — it targets
  `num_prior_firms >= 3 AND industry_tenure_years >= 5`, which shares the
  independent RIA / portable custodian population.

**Block 3** — Production shadow table.
  Builds `ml_features.aum_mid_tier_candidates` in the exact schema of the
  current lead list pipeline output. This is NOT live yet — it's a shadow
  table for validation before inserting into the monthly pipeline.

---

## Output File Initialization

Create `C:\Users\russe\Documents\Dashboard\aum_v4_findings.md` immediately:

```markdown
# TIER_AUM_MID: Overlap Analysis + Production Shadow Table — Findings
**Run Date**: [INSERT TIMESTAMP]
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_v4_overlap_and_production.sql
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

sql_path = pathlib.Path(r"C:\Users\russe\Documents\Dashboard\aum_v4_overlap_and_production.sql")
assert sql_path.exists()
print("SQL: OK")

prereqs = [
    "savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile",
    "savvy-gtm-analytics.ml_features.aum_proxy_labeled_features",
    "savvy-gtm-analytics.ml_features.aum_proxy_control_features",
    "savvy-gtm-analytics.ml_features.excluded_firm_crds",
    "savvy-gtm-analytics.ml_features.v4_prospect_scores",
]
for t in prereqs:
    n = list(client.query(f"SELECT COUNT(*) AS n FROM `{t}`").result())[0]['n']
    assert n > 0, f"Missing or empty: {t}"
    print(f"  {t.split('.')[-1]}: {n:,} rows OK")
```

Record:
```markdown
## Environment Setup
- BQ: PASS/FAIL
- SQL file: PASS/FAIL
- Prereq tables: [list each with row count]
- Status: READY / HALTED
```

---

## BLOCK 1 — Employment History Fix Validation

### STEP 1A — Run the fix validation query (Block 1A in SQL file)

**What it does**: Joins the 307 labeled $40M–$100M advisors to employment history
using the corrected two-CTE approach. Returns coverage and distribution stats.

**⛔ VALIDATION GATE 1A — Hard Stop**

Pass criteria:
- `has_tenure` > 200 (at least 65% of labeled cohort has tenure data now)
- `has_prior_firm_count` > 200 (same threshold)
- `avg_tenure_years` BETWEEN 1 AND 20 (sanity — not zero, not absurd)
- `avg_prior_firms` > 0 (confirms the fix works — V2/V3 returned 0)

If any fail: the employment history join is broken in a different way than expected.
Record the full result and stop Block 1. Proceed to Block 2 without employment signals.

Record:
```markdown
## Block 1A: Employment History Fix Validation

- **Status**: PASS / FAIL
- **Total labeled advisors**: [n]
- **Has tenure data**: [n] ([pct]%) — was 0% in V2/V3
- **Has prior firm count**: [n] ([pct]%)
- **Avg tenure at firm**: [X] years
- **Median tenure at firm**: [X] years
- **Avg prior firms**: [X]
- **Median prior firms**: [X]
- **% qualifying TIER_2_PROVEN_MOVER** (prior_firms >= 3): [X]%
- **Fix confirmed**: YES / NO
```

### STEP 1B — Run prior firm count discrimination check (Block 1B in SQL file)

**What it does**: Compares prior_firm_count distribution between labeled
($40M–$100M) and control groups.

**Key question**: Does prior_firm_count discriminate? If labeled advisors have
meaningfully MORE prior firms than control, mobility history is a floor signal
we can add to Enhanced criteria. If they have FEWER, it's a ceiling signal.
If no difference, it's not useful.

**Interpretation thresholds**:
- `avg_prior_firms` delta > 0.5 between groups = meaningful signal
- `pct_3plus_prior` labeled > 25% AND delta vs control > 10pp = add to criteria
- Cohen's d (compute as: ABS(labeled_mean - control_mean) / pooled_stddev) > 0.3 = moderate signal

Record:
```markdown
## Block 1B: Prior Firm Count Discrimination

| Metric | Labeled ($40M–$100M) | Control |
|--------|---------------------|---------|
| N | | |
| Avg prior firms | | |
| Median prior firms | | |
| % with 3+ prior firms | | |
| Stddev | | |

**Cohen's d** (calculate manually): ABS([labeled_avg] - [control_avg]) / ([labeled_stddev + control_stddev] / 2)
= [value]

**Signal verdict**:
- d > 0.3: ADD prior_firm_count >= [threshold] to Enhanced criteria
- d 0.1–0.3: Use as soft scoring weight only
- d < 0.1: Not useful — skip

**Decision**: [Add to criteria / Soft weight / Drop]
[If adding: what threshold? e.g., prior_firm_count >= 2]
[Update the Enhanced criteria definition at the top of this findings doc accordingly]
```

---

## BLOCK 2 — Tier Overlap Analysis

### STEP 2A — Identify current lead list table (Block 2A in SQL file)

Run Block 2A to determine which table is the current month's lead list.
The query checks both `march_2026_lead_list` and `january_2026_lead_list`.

**Update the SQL**: Before running Blocks 2B and 2C, replace every instance of
`march_2026_lead_list` in the SQL file with whichever table has more rows
from the Block 2A result. Do this with a find-replace before executing.

Record:
```markdown
## Block 2A: Current Lead List Table

| Table | Row Count |
|-------|-----------|
| march_2026_lead_list | [n] |
| january_2026_lead_list | [n] |

**Active table**: [table name] — used for all Block 2 queries
```

### STEP 2B — Core overlap summary (Block 2B in SQL file)

**⛔ VALIDATION GATE 2B**
- `total_mid_candidates` must be > 1,000 (consistent with V3's ~7,911 estimate
  for Enhanced + $1B ceiling — if dramatically lower, a filter is too aggressive)
- `total_mid_candidates` must be < 50,000 (if higher, a filter is too permissive)
- `pct_overlap` should be between 5% and 80% — outside this range is suspicious

Record:
```markdown
## Block 2B: Overlap Summary

- **Total TIER_AUM_MID candidates**: [n]
- **Already in current lead list**: [n] ([pct]%)
- **Net new to pipeline**: [n] ([pct]%)

**Overlap assessment**:
- If pct_overlap < 20%: Strong case for new tier — minimal duplication
- If pct_overlap 20–50%: Moderate case — tier adds meaningful new coverage
- If pct_overlap > 50%: Weak case — most of this population is already being reached.
  Consider refining criteria or merging into an existing tier instead.

**Verdict**: [Strong / Moderate / Weak case for new tier]
```

### STEP 2C — Overlap breakdown by existing tier (Block 2C in SQL file)

This is the most important output in the entire investigation.
It tells you WHICH existing tiers are covering this population.

**How to read it**:
- High overlap with `TIER_2_PROVEN_MOVER`: expected — these are mobile independent
  RIA advisors. The question is whether TIER_AUM_MID adds a meaningfully different
  profile (lower prior_firm_count, different firm size) or is just a subset.
- High overlap with `TIER_1B_PRIME_MOVER_SERIES65`: also expected — Series 65 only
  + portable custodian is shared criteria. Check if the AUM proxy criteria adds any
  discrimination beyond what TIER_1B already captures.
- Overlap with `(not in lead list)`: these are the net-new advisors. This is your tier's
  unique contribution.

Record:
```markdown
## Block 2C: Overlap by Existing Tier

[PASTE FULL RESULT TABLE]

### Key findings:
- **Largest overlap tier**: [tier name] — [n] advisors ([pct]%)
- **Net new (not in any tier)**: [n] advisors ([pct]%)

### TIER_2_PROVEN_MOVER overlap specifically:
- [n] TIER_AUM_MID candidates are already TIER_2_PROVEN_MOVER leads
- This represents [pct]% of all TIER_AUM_MID candidates
- Interpretation: [do these share criteria, or is there a profile difference?]

### Strategic conclusion:
[Choose one based on the numbers]

**Option A — Launch as independent tier** (if net_new > 40% of candidates):
TIER_AUM_MID targets a meaningfully distinct population. Proceed to Block 3.

**Option B — Augment existing tier** (if overlap with one tier > 60%):
The AUM proxy signals are better added as a sub-tier or scoring upgrade
within [overlapping tier name] rather than a new top-level tier.

**Option C — Refine and retest** (if overlap is high but spread across many tiers):
The criteria are too broad. Add the Block 1B employment signal (if useful)
or tighten the firm_hnw_ratio threshold to 0.40 and rerun Block 2.

**Decision**: [A / B / C] — proceed to Block 3 [yes / only if A]
```

---

## BLOCK 3 — Production Shadow Table

**Only run Block 3 if Block 2C decision is Option A or B.**
If Option C, stop, record the refinement recommendation, and do not build the shadow table.

### STEP 3A — Build the shadow table (Block 3 CREATE OR REPLACE in SQL file)

**What it builds**: `ml_features.aum_mid_tier_candidates`

Schema matches the existing lead list output exactly:
`advisor_crd, salesforce_lead_id, first_name, last_name, job_title, email,
phone, linkedin_url, has_linkedin, producing_advisor, firm_name, firm_crd,
firm_rep_count, firm_aum, tenure_months, tenure_years, industry_tenure_years,
num_prior_firms, firm_disc_ratio, firm_hnw_ratio, has_series_65_only,
has_series_7, license_count, is_independent_ria, has_portable_custodian,
custodian, score_tier, expected_rate_pct, score_narrative, v4_score,
v4_percentile, prospect_type, tier_category, run_mode, priority_rank`

**Expected runtime**: 90–150s (scans full FINTRX universe)

**⛔ VALIDATION GATE 3A — Hard Stop**

```sql
SELECT
  COUNT(*)                            AS total_rows,
  COUNT(DISTINCT advisor_crd)         AS unique_crds,
  COUNT(DISTINCT firm_crd)            AS unique_firms,
  COUNTIF(score_tier != 'TIER_AUM_MID') AS wrong_tier,  -- must be 0
  COUNTIF(email IS NULL)              AS missing_email,
  COUNTIF(firm_name IS NULL)          AS missing_firm,
  COUNTIF(v4_percentile IS NULL)      AS missing_v4,
  COUNTIF(num_prior_firms IS NULL)    AS null_prior_firms,  -- should be 0 with fix
  COUNTIF(tenure_months IS NULL)      AS null_tenure,
  MAX(firm_count)                     AS max_per_firm
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
CROSS JOIN (
  SELECT firm_crd, COUNT(*) AS firm_count
  FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
  GROUP BY firm_crd
)
```

Pass criteria:
- `total_rows` = `unique_crds` (no duplicates)
- `wrong_tier` = 0
- `null_prior_firms` = 0 (confirms Block 1 fix is applied in production)
- `max_per_firm` <= 50 (existing pipeline caps at 50 per firm — flag if exceeded,
  production SQL will need a firm diversity cap added)

Record:
```markdown
## Block 3A: Shadow Table Build

- **Status**: PASS / FAIL
- **Total candidates**: [n]
- **Unique CRDs**: [n]
- **Unique firms**: [n]
- **Wrong tier flag**: [n] (must be 0)
- **Missing email**: [n] ([pct]%)
- **Null prior_firms**: [n] (must be 0 — confirms employment fix)
- **Max advisors per firm**: [n] (flag if > 50)
- **Bytes billed**: [X]
```

### STEP 3B — Run shadow validation queries (Block 3B in SQL file)

Three queries:
1. Quick summary stats (avg V4 percentile, disc_ratio, hnw_ratio, prior_firms, tenure)
2. Prior firm count distribution (validates employment fix produced realistic values)
3. Top 20 firms by advisor count (firm diversity check)

Record:
```markdown
## Block 3B: Shadow Table Validation

### Summary Stats
[PASTE summary query result]

### Prior Firm Count Distribution
[PASTE distribution result]
Key check: distribution should be roughly right-skewed (most advisors have 0–2 prior firms,
tail extends to 5+). If all values are 0, the employment history fix did not apply — stop and flag.

### Top 20 Firms
[PASTE top firms result]
Key check: Are any single firms dominating? If a firm has > 50 advisors in the table,
a firm diversity cap needs to be added to Block 3 before production.
Flag any firm you recognize as a large aggregator — they may need exclusion.

### avg_v4_percentile vs existing tiers:
For context, TIER_2_PROVEN_MOVER runs at ~[check current lead list] avg V4 percentile.
TIER_AUM_MID's avg V4 percentile: [X]
Higher = better ML signal alignment. Lower = the AUM proxy catches advisors V4 doesn't prioritize
(this is actually the point of the tier — it's additive to V4).
```

---

## BLOCK 4 — Final Synthesis

After all blocks, write the complete go/no-go recommendation:

```markdown
---

## Final Synthesis: TIER_AUM_MID Go/No-Go

### Summary of All Investigations

| Investigation | Key Finding |
|--------------|-------------|
| V1 (SFDC profiling) | 3.4% non-excluded win rate (n=9), solo/micro firm dominant signal |
| V2 (Signal comparison) | Top signals: license_count, firm_hnw_ratio, disc_ratio, indep_ria, portable_custodian |
| V3 (Ceiling + sizing) | Ceiling weak — use firm_aum<$1B + no_accolade. Volume: ~659/month |
| V4 Block 1 (Emp history) | prior_firm_count fix: [worked / still broken]. Adds signal: [yes/no] |
| V4 Block 2 (Overlap) | [X]% overlap with existing tiers. Net new: [n] advisors/month |
| V4 Block 3 (Shadow) | [n] candidates built. Ready for quota assignment: [yes/no] |

### Final Criteria (including any Block 1B additions)

**Floor criteria** (must ALL be true):
```sql
(is_independent_ria = TRUE
 OR (has_portable_custodian = TRUE AND has_series_7 = FALSE))
AND firm_disc_ratio > 0.70
AND firm_hnw_ratio > 0.30
AND license_count < 3
AND industry_tenure_years BETWEEN 7 AND 25
[AND num_prior_firms [threshold] — add only if Block 1B shows d > 0.3]
```

**Ceiling criteria** (must ALL be true):
```sql
AND firm_aum < 1000000000    -- $1B ceiling
AND has_any_accolade = FALSE  -- no Forbes/Barron's
```

### Recommended Monthly Quota
Based on Block 2C net-new volume and V3 sizing:
- Shadow table total: [n]
- Estimated monthly new: [n / 12]
- Recommended quota for first 60-day validation window: [conservative — suggest 200–400/month]
- Rationale: 3.4% expected conversion × quota = [X] expected MQLs/month

### Integration Path

**If Option A (independent tier)**:
1. Add firm diversity cap (max 50 per firm) to Block 3 SQL
2. Integrate TIER_AUM_MID into `March_2026_Lead_List_V3_7_0.sql` or next month's list
3. Assign tier priority between TIER_2_PROVEN_MOVER and TIER_3_MODERATE_BLEEDER
   (expected conversion 3.4% puts it just above baseline, below Proven Mover's ~5.9%)
4. Apply V3/V4 disagreement filter: exclude if v4_percentile < 40
   (lower threshold than Tier 1's 60th percentile — AUM proxy is independent signal)
5. Run 60-day shadow before adding to SGA quota

**If Option B (augment existing tier)**:
1. Identify which existing tier has highest overlap
2. Add AUM proxy criteria as a sub-tier condition within that tier's SQL block
3. Assign a sub-tier label (e.g., TIER_2_PROVEN_MOVER_AUM_MID)

### Open Questions After V4
- [ ] Should the V3/V4 disagreement filter threshold be 40th or 50th percentile?
- [ ] Firm diversity cap: 50 (current pipeline standard) or lower for this tier?
- [ ] Does `prior_firm_count` belong in criteria? [resolved by Block 1B]
- [ ] Timeline: target April 2026 lead list for first shadow run?
```

---

## Validation Summary

```markdown
---

## Validation Summary

| Step | Status | Rows | Key Gate |
|------|--------|------|----------|
| Environment Setup | PASS/FAIL | — | 5 prereq tables |
| Block 1A: Emp History Fix | PASS/FAIL | 1 row | has_tenure > 200 |
| Block 1B: Prior Firm Disc | PASS/FAIL | 2 rows | Cohen's d computed |
| Block 2A: Lead List ID | PASS/FAIL | 2 rows | Active table identified |
| Block 2B: Overlap Summary | PASS/FAIL | 1 row | 1k–50k candidates |
| Block 2C: Overlap by Tier | PASS/FAIL | N rows | Decision A/B/C made |
| Block 3A: Shadow Table | PASS/FAIL | [n] | No dups, no wrong tier |
| Block 3B: Shadow Validation | PASS/FAIL | 3 queries | Emp fix confirmed |

**Overall Status**: COMPLETE / INCOMPLETE
**Go/No-Go**: GO — proceed to production integration / NO-GO — [reason]
**Next Action**: [specific next step]
```

---

## Error Handling

1. If Block 2A shows neither lead list table exists: query
   `SELECT table_name FROM savvy-gtm-analytics.ml_features.INFORMATION_SCHEMA.TABLES`
   to find the correct current table name. Update all Block 2/3 references accordingly.

2. If Block 1A still shows NULL tenure after the fix: the employment history table
   may use a different field name for end_date in the CA region. Run:
   `SELECT column_name FROM savvy-gtm-analytics.FinTrx_data_CA.INFORMATION_SCHEMA.COLUMNS
    WHERE table_name = 'contact_registered_employment_history'`
   and record all column names in findings. Adjust the CTE accordingly.

3. If Block 3A shows `max_per_firm` > 50: add this to the base_candidates WHERE clause
   before re-running:
   ```sql
   QUALIFY ROW_NUMBER() OVER (PARTITION BY c.PRIMARY_FIRM ORDER BY
     COALESCE(v4.v4_percentile, 50) DESC) <= 50
   ```
   This requires joining v4_scores earlier in the CTE chain — restructure if needed.

4. Max 2 retries per block. Record and stop.

## Cost Awareness
Block 1: ~5 GB (employment history + labeled cohort)
Block 2: ~15–20 GB (full FINTRX universe scan)
Block 3: ~15–20 GB (same, with CREATE TABLE overhead)
Estimated total: ~35–45 GB across all steps.
Flag any single step > 25 GB.
