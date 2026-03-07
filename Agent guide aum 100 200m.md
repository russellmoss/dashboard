# Agent Guide: $100M–$200M Advisor Signal Analysis
**Version**: 1.0
**System**: Claude Code (single agent, no subagents)
**BigQuery Project**: `savvy-gtm-analytics`
**SQL File**: `C:\Users\russe\Documents\Dashboard\aum_100_200m_analysis.sql`
**Output File**: `C:\Users\russe\Documents\Dashboard\aum_100_200m_findings.md` (create this)

---

## Context and Objectives

This investigation extends the $40M–$100M advisor signal analysis (V1–V5) to the
$100M–$200M AUM band. Two parallel objectives:

**Option A — Signal Discrimination**: Can we identify $100M–$200M advisors
proactively from FINTRX practice signals? We use 115 closed-lost SFDC SQLs as the
labeled cohort (no wins exist in this band) and compare against the existing
3,442-advisor control group from V2. Goal: derive criteria for a new scoring tier
(TIER_AUM_HIGH) if the signal justifies it.

**Option C — Loss Reason Analysis**: Why are we losing 100% of $100M–$200M
opportunities? Are these advisors moving after we lose them? Where do they go?
This is a standalone finding regardless of Option A's outcome.

### Key Differences from $40M–$100M Work

- **No wins exist** in this band — labeled cohort is closed-lost + open SQLs only.
  Discrimination analysis identifies the *profile* of the band, not the profile of
  a convertible advisor within it. Lower statistical confidence than V1–V5.
- **Smaller labeled cohort** (n≈157 total, ~115 closed-lost). Cohen's d will be
  noisier. Treat d < 0.25 as non-discriminating (stricter than V2's 0.20 threshold).
- **The three-way comparison in Block 5 is the critical gate.** If $100M–$200M
  looks nearly identical to $40M–$100M on most features, a separate tier is not
  justified and we stop at Block 5.
- **Control group is reused** from V2 (`aum_proxy_control_features`). No new
  sampling needed.

---

## Output File Initialization

Create `C:\Users\russe\Documents\Dashboard\aum_100_200m_findings.md` immediately:

```markdown
# $100M–$200M Advisor Signal Analysis — Findings
**Run Date**: [INSERT TIMESTAMP]
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_100_200m_analysis.sql
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
print("BQ: PASS")

sql_path = pathlib.Path(
  r"C:\Users\russe\Documents\Dashboard\aum_100_200m_analysis.sql")
assert sql_path.exists(), "SQL file not found"

prereqs = {
    "aum_proxy_control_features":  "savvy-gtm-analytics.ml_features.aum_proxy_control_features",
    "aum_proxy_labeled_features":  "savvy-gtm-analytics.ml_features.aum_proxy_labeled_features",
    "aum_mid_tier_candidates":     "savvy-gtm-analytics.ml_features.aum_mid_tier_candidates",
    "v4_prospect_scores":          "savvy-gtm-analytics.ml_features.v4_prospect_scores",
    "march_2026_lead_list":        "savvy-gtm-analytics.ml_features.march_2026_lead_list",
}
for name, full in prereqs.items():
    n = list(client.query(f"SELECT COUNT(*) AS n FROM `{full}`").result())[0]["n"]
    assert n > 0, f"Missing or empty: {full}"
    print(f"  {name}: {n:,} rows OK")
```

Record:
```markdown
## Environment Setup
- BQ: PASS/FAIL
- SQL file: PASS/FAIL
- Prereq tables: [each with row count]
- Status: READY / HALTED
```

---

## BLOCK 1: Cohort Validation

Run queries 1A and 1B. These are fast read-only checks.

**1A** confirms the cohort you already know: 168 opps, 157 unique CRDs, 0 wins,
115 closed-lost, 53 open. If numbers differ materially, note it and continue.
The sub-band split (100–150M vs 150–200M) sets up a potential later analysis.

**1B** confirms all V2 tables are present and populated.

Record:
```markdown
## Block 1: Cohort Validation

| Metric | Value |
|--------|-------|
| Total opps | |
| Unique CRDs | |
| Closed won | |
| Closed lost | |
| Open | |
| SQL closed-lost | |
| Band $100–$150M | |
| Band $150–$200M | |

| Prereq Table | Rows |
|-------------|------|
| aum_proxy_control_features | |
| aum_proxy_labeled_features | |
| aum_mid_tier_candidates | |
| v4_prospect_scores | |

**Status**: PASS / FAIL
**Note on labeled cohort size**: n≈[X] closed-lost. [Acceptable for directional
analysis / Marginal — interpret Cohen's d with caution / Too small to proceed]
```

**⛔ Hard stop**: If labeled cohort (closed-lost + open) < 50 advisors matched
to FINTRX after Block 2, halt and report findings to date. Do not run Blocks 4–7.

---

## BLOCK 2: Build Labeled Cohort

Run the `CREATE OR REPLACE TABLE` query for
`ml_features.aum_100_200m_labeled_features`.

This table is the spine for all downstream analysis. Verify it created correctly:

```python
result = list(client.query("""
  SELECT
    COUNT(*) AS total,
    COUNTIF(is_closed_lost = 1) AS closed_lost,
    COUNTIF(is_open = 1) AS open_opps,
    COUNTIF(is_sql_lost = 1) AS sql_lost,
    COUNTIF(tenure_at_firm_years IS NOT NULL) AS has_tenure,
    COUNTIF(firm_disc_ratio IS NOT NULL) AS has_disc_ratio,
    COUNTIF(firm_aum IS NOT NULL) AS has_firm_aum
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
""").result())[0]
```

Record:
```markdown
## Block 2: Labeled Cohort Build

| Metric | Value |
|--------|-------|
| Total rows | |
| Closed-lost | |
| Open | |
| SQL closed-lost | |
| Has tenure | (pct%) |
| Has disc_ratio | (pct%) |
| Has firm_aum | (pct%) |

**FINTRX match rate**: [matched] / [total SFDC opps] = [pct]%
(expected ~84% based on V2 — lower suggests data drift)

**Status**: PASS / FAIL
```

---

## BLOCK 3: OPTION C — Loss Reason Analysis

Run queries 3A, 3B, and 3C in order. This block always runs regardless of
what happens in Blocks 4–5. It is a standalone deliverable.

### 3A: Loss reason distribution

Record the full distribution. Look for:
- Are there 1–2 dominant reasons that account for >50% of losses?
- Is compensation/platform a top reason? (signals a business problem,
  not a prospecting problem)
- Is "not interested" or "no response" dominant? (signals contact quality issue)
- Are loss reasons spread thin across many categories? (signals no systematic issue)

### 3B + 3C: Post-loss movement

This is the most strategically interesting part of Option C.

Look for:
- What % moved to a new firm after we lost them? If high (>30%), these advisors
  were actually in transition mode — we lost to timing, not to a competitor.
- What's the median months_to_move? If < 6 months, they were already planning
  to leave when we were talking to them.
- Where did they move to? Independent RIAs, wirehouses, competing RIAs?
- Is there a pattern between loss reason and subsequent movement?

Record:
```markdown
## Block 3: Option C — Loss Reason Analysis

### 3A: Loss Reason Distribution (SQL closed-lost only)

| Loss Reason | Count | % | Avg AUM ($M) |
|-------------|-------|---|-------------|
| | | | |

**Top finding**: [1–2 sentences on dominant pattern]
**Business implication**: [Does this suggest a product/comp issue or a
  prospecting/timing issue?]

### 3B: Individual Movement Detail
[Paste notable rows — advisors who moved quickly or to interesting destinations]

### 3C: Movement Summary

| Status | Count | % | Avg Months to Move |
|--------|-------|---|-------------------|
| | | | |

**Movement finding**: [What % moved post-loss, how fast, where to]
**Strategic implication**: [Were we losing to timing? To a specific competitor?
  Are these advisors still potentially recruitable now that they've moved?]
```

---

## BLOCK 4: OPTION A — Signal Discrimination

Run queries 4A and 4B. These are the labeled vs. control comparisons.

### Computing Cohen's d

For each continuous feature, compute Cohen's d from the 4A results:
```
d = |labeled_mean - control_mean| / ((labeled_stddev + control_stddev) / 2)
```

Thresholds for this analysis (stricter than V2 due to smaller n):
- d < 0.25: non-discriminating — do not use
- d 0.25–0.49: weak — soft weight only
- d 0.50–0.79: moderate — candidate for hard criterion
- d ≥ 0.80: strong — include in criteria

For binary features, compute:
- Rate delta: labeled_pct − control_pct
- Lift: labeled_pct / control_pct
- Threshold: delta > 10pp AND lift > 1.5x to qualify as discriminating

### What to look for

These are the V2 signals that worked for $40–100M:
- `license_count` (d=0.70)
- `firm_hnw_ratio` (d=0.61)
- `firm_disc_ratio` (d=0.53)
- `tenure_at_firm_years` (d=0.549, reversed direction)
- `is_independent_ria` (2.82x lift)
- `has_portable_custodian` (2.31x lift)
- `has_series_7` (negative signal)

For the $100M–$200M band, specifically watch whether:
1. `has_any_accolade` flips from negative signal to positive — in V3 it was 5x
   higher in the >$100M cohort vs $40–100M. If this holds here, it may become
   a floor criterion rather than a ceiling criterion.
2. `firm_aum` threshold shifts — larger AUM advisors may be at larger firms.
   The $1B firm ceiling used in TIER_AUM_MID may need adjustment.
3. `tenure_at_firm_years` direction — if this band is also shorter-tenured, the
   `< 10yr` ceiling carries forward. If long-tenured advisors dominate here,
   the criterion may be different or absent.

Record:
```markdown
## Block 4: Signal Discrimination

### 4A: Continuous Features

| Feature | Labeled Mean | Control Mean | Labeled SD | Control SD | Cohen's d | Signal? |
|---------|-------------|-------------|-----------|-----------|-----------|---------|
| industry_tenure_years | | | | | | |
| tenure_at_firm_years | | | | | | |
| firm_aum_m | | | | | | |
| firm_rep_count | | | | | | |
| firm_disc_ratio | | | | | | |
| firm_hnw_ratio | | | | | | |
| license_count | | | | | | |
| num_prior_firms | | | | | | |
| firm_aum_per_rep_m | | | | | | |

### 4B: Binary Features

| Feature | Labeled % | Control % | Delta (pp) | Lift | Signal? |
|---------|-----------|-----------|-----------|------|---------|
| is_independent_ria | | | | | |
| has_portable_custodian | | | | | |
| is_wirehouse | | | | | |
| has_series_7 | | | | | |
| has_series_65_only | | | | | |
| has_any_accolade | | | | | |
| is_solo_micro_firm | | | | | |
| has_3plus_prior_firms | | | | | |
| tenure_under_10yr | | | | | |
| tenure_under_5yr | | | | | |
| mid_career (7–25yr) | | | | | |

### Discriminating Signals (ranked by strength)
[List signals that met the d>0.25 or >10pp / >1.5x thresholds]

### Non-Discriminating Signals
[List signals that did not meet thresholds]
```

---

## BLOCK 5: THREE-WAY COMPARISON — CRITICAL DECISION GATE

**This is the most important block.** Run the Block 5 query.

This compares three groups side by side:
- $40M–$100M (V2 labeled, n=307)
- $100M–$200M (new labeled, n≈157)
- Control (V2 control, n=3,442)

### How to interpret

For each feature, ask: does $100M–$200M look more like $40M–$100M, or more like
Control, or does it occupy a distinct middle position?

Compute the inter-band Cohen's d — how similar are the two labeled bands to each other?
```
d_bands = |mean_100_200 - mean_40_100| / ((sd_100_200 + sd_40_100) / 2)
```

If `d_bands < 0.20` for most features: **the bands are nearly identical.
A separate tier is NOT justified.** Stop at Block 5. Report findings and
recommend folding these advisors into TIER_AUM_MID with an extended firm_aum
ceiling rather than creating a new tier.

If `d_bands > 0.20` for 3+ key features: **the bands are distinguishable.**
Proceed to Blocks 6 and 7.

### Specific things to check

1. `has_any_accolade`: Expected to be higher in $100M–$200M than $40M–$100M.
   This was the main ceiling signal from V3. If it is, accolades flip from
   ceiling exclusion to floor inclusion for the new tier.

2. `firm_aum_m`: Does the $100M–$200M band show higher firm AUM? If so, the
   $1B ceiling from TIER_AUM_MID needs adjustment upward.

3. `license_count` and `firm_disc_ratio`: If these remain similar between bands,
   they are AUM-band-agnostic signals and carry forward to the new tier unchanged.

4. `tenure_at_firm_years`: Does the shorter-tenure pattern from TIER_AUM_MID
   hold at the $100–200M level, or do larger AUM advisors skew longer-tenured?

Record:
```markdown
## Block 5: Three-Way Comparison

### Summary Table

| Feature | $40M–$100M | $100M–$200M | Control | d (bands) | Distinct? |
|---------|-----------|------------|---------|-----------|----------|
| industry_tenure_years | | | | | |
| tenure_at_firm_years | | | | | |
| firm_aum_m (median) | | | | | |
| firm_rep_count (median) | | | | | |
| firm_disc_ratio | | | | | |
| firm_hnw_ratio | | | | | |
| license_count | | | | | |
| num_prior_firms | | | | | |
| pct_indep_ria | | | | | |
| pct_portable_custodian | | | | | |
| pct_series_7 | | | | | |
| pct_accolade | | | | | |
| median_firm_aum_m | | | | | |

### Decision

**Number of features where d_bands > 0.20**: [X] of 13

**Verdict**:
- [ ] Bands are nearly identical (d_bands < 0.20 on most features) →
  STOP. Do not build TIER_AUM_HIGH. Recommend folding into TIER_AUM_MID
  with adjusted ceiling criteria. Proceed to Final Synthesis only.

- [ ] Bands are distinguishable (d_bands > 0.20 on 3+ key features) →
  PROCEED to Blocks 6 and 7. List the distinguishing features:
  [feature 1, feature 2, ...]

**Key differentiating signals between bands** (if proceeding):
[Plain English: what makes a $100–200M advisor look different from a $40–100M advisor]
```

---

## BLOCK 6: POPULATION SIZING + OVERLAP (CONDITIONAL)

**Only run if Block 5 verdict is PROCEED.**

Before running, fill in the criteria placeholders in the Block 6 SQL based on
what Blocks 4 and 5 identified as discriminating signals. Use the same logic
pattern as TIER_AUM_MID criteria. Document what you substituted and why.

The criteria should:
- Include floor signals that separate labeled from control (Block 4)
- Include any ceiling adjustments that separate $100–200M from $40–100M (Block 5)
- Exclude accolades as a ceiling filter if Block 5 shows they flip to positive
  signal for this band

Also update the Block 6B overlap query criteria to match.

Record:
```markdown
## Block 6: Population Sizing + Overlap

### Criteria Applied
```sql
[Paste the actual criteria filled in]
```

### Universe Size

| Metric | Count |
|--------|-------|
| Total universe | |
| At $1B+ firms | |
| Under $1B firms | |
| $1B–$5B firms | |
| Over $5B firms | |

**Monthly new estimate**: [total / 12] per month
**Viable for shadow run?**: [Yes (>500 net-new) / Marginal (200–500) / No (<200)]

### Overlap With Existing Tiers

| Tier | Count | % |
|------|-------|---|
| (not in any tier) | | |
| TIER_AUM_MID | | |
| TIER_2_PROVEN_MOVER | | |
| Other tiers | | |

**Overlap verdict**: [X]% net-new to pipeline
```

**⛔ Hard stop**: If net-new universe < 200 advisors after criteria applied,
do not build shadow table. Report findings and recommend revisiting criteria
or folding into TIER_AUM_MID.

---

## BLOCK 7: SHADOW TABLE BUILD (CONDITIONAL)

**Only run if Block 6 net-new universe ≥ 200.**

Before running:
1. Fill in the `[CRITERION_1..N]` placeholders in the Block 7 CREATE TABLE SQL
   with the same criteria used in Block 6A.
2. Confirm table name `aum_high_tier_candidates` is appropriate or rename.
3. Run Block 7 CREATE TABLE, then immediately run Block 7B validation.

Validation gates (all must pass):
- Unique CRDs = total rows (no duplicates)
- `has_tenure` > 80% (PRIMARY_FIRM_START_DATE should be 100% populated)
- Max per firm ≤ 50
- Avg V4 percentile is computed (not all NULL)

Record:
```markdown
## Block 7: Shadow Table Build

### Criteria Applied (same as Block 6)
```sql
[Paste criteria]
```

### Validation

| Metric | Value | Pass/Fail |
|--------|-------|-----------|
| Total candidates | | |
| Unique CRDs = total | | |
| Unique firms | | |
| Has tenure (%) | | ≥80%? |
| Avg V4 percentile | | |
| Avg disc_ratio | | |
| Avg HNW_ratio | | |
| Max per firm | | ≤50? |

### Status: PASS / FAIL
```

---

## FINAL SYNTHESIS

Always write this section, even if Blocks 6–7 were skipped.

```markdown
---

## Final Synthesis

### Option C — Loss Reason Finding
[2–3 sentences. The business conclusion: why are we losing these advisors?
Is this a timing problem, a compensation problem, a contact problem?
Are they recruitable now after having moved?]

### Option A — Can We Find This Band?

**Three-way comparison verdict**: [Nearly identical to $40–100M / Distinguishable]

**If identical**: Recommendation is to extend TIER_AUM_MID rather than build
a new tier. The $1B firm AUM ceiling used in TIER_AUM_MID likely excluded many
$100–200M advisors. Consider raising to $2B–$3B and rerunning the shadow table
to see how many additional candidates appear.

**If distinguishable**: Key signals that separate $100–200M from $40–100M:
[List them]
New tier TIER_AUM_HIGH:
- Shadow table: [row count] advisors
- Monthly quota recommendation: [total / 12, rounded]
- Unique vs existing tiers: [pct]% net-new
- Key criteria differences from TIER_AUM_MID: [list]

### Recommended Next Steps
[Numbered list, 3–5 items max]

### Documents to Create/Update
- [ ] Findings summary (this document — mark COMPLETE)
- [ ] Tier proposal for TIER_AUM_HIGH (if shadow table built)
- [ ] Update TIER_AUM_MID proposal if ceiling criteria need adjustment
- [ ] Project update for David Weiner
```

---

## Validation Summary (fill in at end)

```markdown
---

## Validation Summary

| Block | Status | Key Output |
|-------|--------|-----------|
| 1: Cohort validation | | |
| 2: Labeled table build | | |
| 3A: Loss reason distribution | | |
| 3B/C: Movement analysis | | |
| 4A: Continuous discrimination | | |
| 4B: Binary discrimination | | |
| 5: Three-way comparison | | PROCEED / STOP |
| 6: Population sizing | | (if run) |
| 7: Shadow table | | (if run) |

**Overall status**: COMPLETE
**Primary finding**: [One sentence]
**Action**: [TIER_AUM_HIGH shadow table built / Recommend TIER_AUM_MID extension /
  Business issue identified — not a prospecting problem]
```

---

## Error Handling

1. If `aum_100_200m_labeled_features` build fails with NULL join:
   Run `SELECT COUNT(*) FROM ria_contacts_current WHERE RIA_CONTACT_CRD_ID IN
   (SELECT crd FROM labeled spine)` — if low, CRD format mismatch. Check the
   SAFE_CAST casting pattern on FA_CRD__c.

2. If Block 6 criteria return 0 rows:
   The criteria are too restrictive. Try removing one criterion at a time
   starting with the weakest signal from Block 4 until population > 200.
   Document what was relaxed and why.

3. If `prior_firms` CTE returns 0 for most advisors:
   Inspect `PREVIOUS_REGISTRATION_COMPANY_CRD_IDS` delimiter:
   ```sql
   SELECT PREVIOUS_REGISTRATION_COMPANY_CRD_IDS
   FROM FinTrx_data_CA.ria_contacts_current
   WHERE PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NOT NULL LIMIT 5
   ```

## Cost Awareness
- Blocks 1–3: ~5 GB (SFDC + FINTRX labeled only)
- Block 4–5: ~12 GB (joins labeled + control)
- Block 6: ~15 GB (full universe scan)
- Block 7: ~20 GB (full universe CREATE TABLE)
- Total if all blocks run: ~50 GB