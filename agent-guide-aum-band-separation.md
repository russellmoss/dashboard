# Agent Guide: AUM Band Separation Analysis
**Version**: 1.0
**System**: Claude Code (single agent, no subagents)
**BigQuery Project**: `savvy-gtm-analytics`
**SQL File**: `C:\Users\russe\Documents\Dashboard\aum_band_separation.sql`
**Output File**: `C:\Users\russe\Documents\Dashboard\aum_band_separation_findings.md` (create this)

---

## What This Investigation Is Trying to Answer

Two questions, in priority order:

1. **Can we distinguish $40–100M advisors from $100–200M advisors in FINTRX?**
   The prior analysis (Block 5 of aum_100_200m_findings.md) found zero separation
   across 8 features — but it was missing two of the strongest V5 signals (tenure
   at current firm, prior firm count) because the control table hadn't been patched
   yet. This investigation completes that comparison properly.

2. **If we can't separate the bands, can we at least increase confidence that
   TIER_AUM_MID advisors are genuinely substantial-AUM advisors (not $5M practices)?**
   The fallback (Block 5 SQL) builds an AUM confidence score and validates it
   against both labeled groups.

### The honest constraint going in

These two AUM bands may simply be indistinguishable in FINTRX. That is a legitimate
finding. If Blocks 2, 3, and 4 all come back flat, the conclusion is that FINTRX
does not encode enough individual-level information to separate $40M from $150M,
and the tier should be re-labeled and re-scoped accordingly. Do not force a
finding that isn't there.

---

## Output File Initialization

Create `C:\Users\russe\Documents\Dashboard\aum_band_separation_findings.md`
immediately with:

```markdown
# AUM Band Separation Analysis — Findings
**Run Date**: [INSERT TIMESTAMP]
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_band_separation.sql
**Status**: IN PROGRESS

**Core question**: Can FINTRX signals distinguish $40–100M advisors from
$100–200M advisors?

---
```

---

## Environment Setup

```python
from google.cloud import bigquery
import pathlib

client = bigquery.Client(project="savvy-gtm-analytics")
list(client.query("SELECT 1").result())

sql_path = pathlib.Path(
    r"C:\Users\russe\Documents\Dashboard\aum_band_separation.sql")
assert sql_path.exists()

prereqs = {
    "aum_proxy_labeled_features":       "savvy-gtm-analytics.ml_features.aum_proxy_labeled_features",
    "aum_proxy_control_features":       "savvy-gtm-analytics.ml_features.aum_proxy_control_features",
    "aum_100_200m_labeled_features":    "savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features",
    "aum_mid_tier_candidates":          "savvy-gtm-analytics.ml_features.aum_mid_tier_candidates",
}
for name, full in prereqs.items():
    n = list(client.query(f"SELECT COUNT(*) AS n FROM `{full}`").result())[0]["n"]
    assert n > 0, f"Missing or empty: {full}"
    print(f"  {name}: {n:,} rows OK")

# Confirm V5 fields exist on ria_contacts_current
check = """
  SELECT
    COUNTIF(PRIMARY_FIRM_START_DATE IS NOT NULL) AS has_start_date,
    COUNTIF(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NOT NULL
      AND TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) != '') AS has_prior_crds,
    COUNT(*) AS total
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
  WHERE PRODUCING_ADVISOR = 'true'
"""
row = list(client.query(check).result())[0]
print(f"PRIMARY_FIRM_START_DATE: {row['has_start_date']:,} / {row['total']:,}")
print(f"PREVIOUS_REGISTRATION_COMPANY_CRD_IDS: {row['has_prior_crds']:,} / {row['total']:,}")
```

Record:
```markdown
## Environment Setup
- BQ: PASS/FAIL
- SQL file: PASS/FAIL
- Prereq tables: [each with row count]
- PRIMARY_FIRM_START_DATE coverage: [n] / [total]
- PREVIOUS_REGISTRATION_COMPANY_CRD_IDS coverage: [n] / [total]
- Status: READY / HALTED
```

---

## BLOCK 1: Rebuild Feature Tables with V5 Methods

Run Block 1A, 1B, and 1C in sequence. These CREATE OR REPLACE existing tables
so they now include `tenure_at_firm_years` and `num_prior_firms` for all three
groups.

**1A** patches the $40–100M labeled table.
**1B** patches the control table. This is the critical fix — the prior Block 5
comparison failed because the control had NULL for both V5 fields.
**1C** validates all three tables have the new fields populated.

**⛔ Hard stop if 1C shows:**
- `pct_has_tenure` < 85% in any table
- `avg_prior_firms` = 0 in any table (indicates the CRD_IDS field wasn't parsed)

Record:
```markdown
## Block 1: Feature Table Rebuild

| Table | Rows | Has Tenure (%) | Avg Tenure | Avg Prior Firms |
|-------|------|---------------|------------|-----------------|
| aum_labeled_40_100m_v5 | | | | |
| aum_control_v5 | | | | |
| aum_100_200m_labeled_features | | | | |

**V5 patch status**: PASS / FAIL
**Note**: [Any anomalies in coverage or values]
```

---

## BLOCK 2: Full Three-Way Comparison

Run queries 2A and 2B. This is the definitive test of band separation.

### Computing Cohen's d for inter-band comparison

For each continuous feature, compute pairwise d between the two labeled bands:
```
d = |mean_40_100 - mean_100_200| / ((sd_40_100 + sd_100_200) / 2)
```

Pay special attention to:
- **`tenure_at_firm_years`** — was completely missing from the prior comparison.
  If $100–200M advisors have longer tenure (more settled, larger established book)
  vs $40–100M advisors (shorter tenure, still building), this is the signal we've
  been looking for.
- **`num_prior_firms`** — also missing from the prior comparison. If $100–200M
  advisors have fewer prior firms (built one big book in one place vs multiple
  smaller books across moves), this discriminates.
- **`has_any_accolade`** — expected to be higher at $100–200M (5x finding from V3).
  Check if this holds with the corrected labeled group.

### Decision thresholds

Given the smaller $100–200M labeled cohort (n=148), use:
- d < 0.20: non-discriminating
- d 0.20–0.35: weak — useful for scoring weight, not hard filter
- d > 0.35: actionable — candidate for tier differentiation criterion

For binary features:
- Delta < 8pp: non-discriminating
- Delta 8–15pp: weak
- Delta > 15pp: actionable

### How to interpret the full table

Look at whether each feature places $100–200M:
- **Between** $40–100M and Control → AUM-monotonic signal (higher AUM = more
  like control). Useful for scoring but not for band separation.
- **Further from Control** than $40–100M → $100–200M is more extreme on this
  feature. Strong band separator.
- **Same as** $40–100M → Feature does not separate bands.

Record:
```markdown
## Block 2: Full Three-Way Comparison

### 2A: Continuous Features

| Feature | $40M-$100M | $100M-$200M | Control | d (bands) | Direction | Signal? |
|---------|-----------|------------|---------|-----------|-----------|---------|
| industry_tenure_years | | | | | | |
| **tenure_at_firm_years** | | | | | | |
| **num_prior_firms** | | | | | | |
| firm_disc_ratio | | | | | | |
| firm_hnw_ratio | | | | | | |
| license_count | | | | | | |
| firm_aum_m (avg) | | | | | | |
| firm_aum_m (median) | | | | | | |
| firm_rep_count (median) | | | | | | |

### 2B: Binary Features

| Feature | $40M-$100M | $100M-$200M | Control | Delta (pp) | Signal? |
|---------|-----------|------------|---------|-----------|---------|
| pct_indep_ria | | | | | |
| pct_portable | | | | | |
| pct_series_7 | | | | | |
| pct_65_only | | | | | |
| pct_accolade | | | | | |
| pct_solo_micro | | | | | |
| pct_3plus_firms | | | | | |
| pct_tenure_u5 | | | | | |
| pct_tenure_u10 | | | | | |
| pct_tenure_o10 | | | | | |
| pct_mid_career | | | | | |
| pct_firm_under_1b | | | | | |
| pct_firm_1b_3b | | | | | |

### Band Separation Verdict

**Features with d > 0.20 (inter-band)**: [list]
**Features with delta > 8pp (inter-band binary)**: [list]
**Total discriminating features found**: [n]

**Verdict**:
- [ ] **Separation found** (≥2 actionable features) → Proceed to Block 3 sub-band
  analysis to sharpen. Document which features and their direction.

- [ ] **Weak/partial separation** (1–2 weak features only) → Run Block 3 to check
  if $150–200M sub-band shows cleaner separation. Run Block 4 for firm-level
  features. Do not build separate tier yet.

- [ ] **No separation** (0 features above threshold) → Run Block 4 for firm-level
  features as last resort. If Block 4 also flat, proceed to Block 5 (scoring).
  The two bands cannot be separated in FINTRX with available data.
```

---

## BLOCK 3: Sub-Band Analysis

Run queries 3A and 3B.

This splits the $100–200M cohort into $100–150M (n≈80) and $150–200M (n≈50)
and tests each against $40–100M separately.

**Rationale**: Blending $100M and $190M advisors into one group suppresses any
signal that strengthens with AUM. A $150–200M advisor may look meaningfully
different from a $40–100M advisor even if the blended $100–200M group doesn't.

**3B produces a pairwise Cohen's d matrix** for all three group combinations.
Focus on the `$40M-$100M vs $150M-$200M` row — this is the maximum possible
separation in the dataset. If even this comparison is flat, the data simply
cannot separate the bands.

Record:
```markdown
## Block 3: Sub-Band Analysis

### 3A: Feature Distributions by Sub-Band

| Feature | $40M-$100M | $100M-$150M | $150M-$200M |
|---------|-----------|------------|------------|
| N | | | |
| avg_industry_tenure | | | |
| avg_firm_tenure | | | |
| avg_prior_firms | | | |
| avg_disc_ratio | | | |
| avg_hnw_ratio | | | |
| avg_license_count | | | |
| median_firm_aum_m | | | |
| median_firm_rep_count | | | |
| pct_accolade | | | |
| pct_tenure_over_10yr | | | |
| pct_3plus_firms | | | |

### 3B: Pairwise Cohen's d Matrix

| Comparison | d_ind_tenure | d_firm_tenure | d_prior_firms | d_disc | d_hnw | d_license |
|-----------|-------------|--------------|--------------|--------|-------|-----------|
| $40-100M vs $100-150M | | | | | | |
| $40-100M vs $150-200M | | | | | | |
| $100-150M vs $150-200M | | | | | | |

**Maximum separation found** ($40-100M vs $150-200M):
- Strongest feature: [feature name], d=[value]
- Second: [feature name], d=[value]

**Sub-band verdict**:
[Are the bands distinguishable at the extremes? Does $150-200M separate from
$40-100M on any feature even if the blended group doesn't?]

**Implication for tier design**:
[If $150-200M is separable: TIER_AUM_MID targets $40-150M, new criteria needed
 above $150M / If still flat: sub-banding does not help, proceed to Block 4]
```

---

## BLOCK 4: Expanded Firm-Level Features

Run query 4B first (schema inspection) to confirm field names exist.
Then run 4A.

**Fields being tested for the first time:**
- `firm_age_years` — how long the RIA has been registered. Hypothesis: $100–200M
  advisors may be at older, more established RIAs vs newer solo RIAs in $40–100M.
- `num_states_registered` — broader registration suggests larger institutional
  practice. Hypothesis: $100–200M advisors at firms registered in more states.
- `firm_disclosures` — regulatory cleanliness. Hypothesis: may vary by band.
- `num_owners` — multi-partner firm vs solo practice.
- `has_website` — proxy for practice formalization.

**If 4B shows these field names don't exist exactly as written:**
Use the schema inspection results to find the correct field names and update
the 4A query before running. Document the substitution.

Record:
```markdown
## Block 4: Expanded Firm-Level Features

### Fields confirmed from schema inspection (4B)
[List actual field names found for each intended feature]

### 4A: Results

| Feature | $40M-$100M | $100M-$200M | Control | d (bands) | Signal? |
|---------|-----------|------------|---------|-----------|---------|
| avg_firm_age_yrs | | | | | |
| median_firm_age | | | | | |
| avg_states_registered | | | | | |
| median_states | | | | | |
| avg_firm_disclosures | | | | | |
| pct_clean_record | | | | | |
| avg_num_owners | | | | | |
| pct_has_website | | | | | |

**New discriminating signals found**: [list any with d > 0.20 inter-band]

**Block 4 verdict**:
[Did firm-level features reveal any separation the contact-level features missed?]
```

---

## BLOCK 5: AUM Confidence Scoring (Fallback)

**Run this block only if Blocks 2, 3, and 4 all show no meaningful inter-band
separation.** This is the fallback strategy — it accepts that the bands cannot
be separated and instead maximizes confidence that advisors identified by
TIER_AUM_MID are genuine substantial-AUM advisors, regardless of whether they
are $50M or $150M.

Run query 5B first. This validates the scoring model against the known labeled
groups. A good score should:
- Show labeled groups ($40–100M and $100–200M) averaging meaningfully higher
  than Control
- Show the two labeled groups scoring similarly to each other (confirming
  they are the same profile)
- Show Control scoring substantially lower

If the score separates labeled from control well (avg score gap > 15 points),
the score is a valid AUM confidence signal even if it can't separate sub-bands.

Then run 5A to see what the top-100 scoring advisors in the full FINTRX universe
look like.

Record:
```markdown
## Block 5: AUM Confidence Scoring (Fallback)

**Run reason**: Blocks 2, 3, and 4 found no inter-band separation.

### 5B: Score Validation Against Labeled Groups

| Group | N | Avg Score | Median Score | SD | P25 | P75 | % High Confidence (≥50) |
|-------|---|-----------|-------------|-----|-----|-----|------------------------|
| $40M-$100M | | | | | | | |
| $100M-$200M | | | | | | | |
| Control | | | | | | | |

**Score separation (labeled avg - control avg)**: [value] points
**Score validity**: [Good (>15pp gap) / Marginal (8-15pp) / Poor (<8pp)]

**Labeled group similarity**: [Do $40-100M and $100-200M score similarly?
Confirms they are the same profile / Or do they separate on score, which would
be interesting]

### Recommendation

[If score is valid and labeled groups are similar:]
Rename TIER_AUM_MID to TIER_AUM_SUBSTANTIAL. Use AUM confidence score as the
primary ranking signal in the shadow table rather than V4 percentile. The tier
captures advisors likely above $40M without claiming to bound them at $100M.

[If score is poor:]
The signals are too weak to build a confidence-scored tier. Maintain existing
TIER_AUM_MID as-is. The 3.96x precision lift from V2 is real even without
AUM sub-band separation.
```

---

## FINAL SYNTHESIS

```markdown
---

## Final Synthesis

### Answer to the Primary Question

**Can FINTRX distinguish $40–100M advisors from $100–200M advisors?**

[YES — [feature(s)] showed inter-band d > 0.35. Recommended new criteria:]
[PARTIALLY — weak signals found in [feature(s)] (d=0.20–0.35). Recommend
  scoring weight but not hard filter. Tier distinction is marginal.]
[NO — zero features showed meaningful inter-band separation even with V5 fields,
  sub-band analysis, and expanded firm features. The two populations are
  identical in FINTRX.]

### What We Now Know About TIER_AUM_MID Confidence

**The V5 three-way comparison is now complete.** All features are populated for
all three groups. The definitive picture:

[Summary of what the data shows across all 4 blocks]

### Revised Tier Recommendation

**If separation found:**
- TIER_AUM_MID: maintain existing criteria, targets $40–100M
- TIER_AUM_HIGH: new tier, targets $100–200M using [criterion] as differentiator
- Expected shadow table size for TIER_AUM_HIGH: [estimate]

**If no separation:**
- Rename tier TIER_AUM_SUBSTANTIAL (honest labeling)
- Extend firm AUM ceiling from $1B to $2.5B to capture larger-firm $100–200M advisors
- Re-run shadow table under new ceiling — estimate pool growth
- AUM confidence score [use as ranking / insufficient to use] in priority_rank

**If fallback scoring used:**
- Shadow table should be re-ranked by aum_confidence_score DESC rather than
  V4 percentile DESC
- Expected improvement in precision: [from score validation results]

### Documents to Update
- [ ] TIER_AUM_MID proposal (ceiling adjustment or rename)
- [ ] Technical methodology (add this investigation as final block)
- [ ] Project update for David Weiner

### Recommended Next Steps
[Numbered list, max 4 items]
```

---

## Validation Summary

```markdown
---

## Validation Summary

| Block | Status | Key Finding |
|-------|--------|------------|
| 1: Table rebuild with V5 fields | | Both labeled + control patched |
| 2: Full three-way comparison | | [n] features discriminating / none |
| 3: Sub-band analysis | | [separation at $150-200M / flat] |
| 4: Firm-level features | | [new signals / none] |
| 5: Confidence scoring | | [RAN / SKIPPED] [score gap: X pts] |

**Overall status**: COMPLETE
**Answer**: [FINTRX CAN / CANNOT distinguish the two AUM bands]
**Action**: [Build TIER_AUM_HIGH / Extend TIER_AUM_MID ceiling /
  Rename to TIER_AUM_SUBSTANTIAL + rescore]
```

---

## Error Handling

1. **If Block 1A or 1B CREATE TABLE fails**: Check that `aum_proxy_labeled_features`
   and `aum_proxy_control_features` have a `firm_crd` column. If the join key
   differs, inspect schema:
   ```sql
   SELECT column_name FROM FinTrx_data_CA.INFORMATION_SCHEMA.COLUMNS
   WHERE table_name = 'aum_proxy_labeled_features'
   ```

2. **If Block 4A errors on field names**: Run 4B first, identify correct field
   names, update 4A accordingly. Common variations: `DATE_REGISTERED` may be
   `REGISTRATION_DATE`, `NUM_OF_STATES_REGISTERED` may be `STATES_REGISTERED`.

3. **If sub-band n < 30 for $150–200M**: Note the small sample, flag all d values
   as directional only, and do not use as basis for hard criteria. Run Block 4
   regardless.

## Cost Awareness

- Block 1 (CREATE TABLE x2): ~8 GB
- Block 2: ~5 GB
- Block 3: ~3 GB
- Block 4: ~8 GB (full firms join)
- Block 5 (if run): ~15 GB
- Total if all blocks run: ~40 GB
