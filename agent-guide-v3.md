# Agent Guide V3: Ceiling Comparison + Population Sizing
**Version**: 3.0
**System**: Claude Code (single agent, no subagents)
**BigQuery Project**: `savvy-gtm-analytics`
**SQL File**: `C:\Users\russe\Documents\Dashboard\aum_ceiling_and_population_sizing.sql`
**Output File**: `C:\Users\russe\Documents\Dashboard\aum_ceiling_findings.md` (you will create this)

**Prerequisites** — verify all three exist before starting:
- `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile` (Phase 1 output)
- `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` (V2 Step 1 output)
- `savvy-gtm-analytics.ml_features.aum_proxy_control_features` (V2 Step 2 output)

---

## Context — Why This Investigation Exists

Investigations V1 and V2 answered: *"What do $40M–$100M advisors look like?"*
and *"Which FINTRX signals discriminate them from the general population?"*

This investigation answers the two remaining questions needed to build a
production tier:

**Question 1 (Analysis A)**: Which signals distinguish advisors ABOVE $100M
from the target band? These become ceiling exclusion criteria — preventing us
from prospecting advisors who are already too large for our value prop.

**Question 2 (Analysis B)**: How many advisors in FINTRX currently pass the
V2 proxy criteria and are not already in our pipeline? If the answer is fewer
than ~300 monthly new prospects, the tier is too narrow to justify a slot.

The combination of floor signals (V2), ceiling signals (V3 Analysis A), and
population volume (V3 Analysis B) is everything needed to write production SQL.

---

## Output File Initialization

Create `C:\Users\russe\Documents\Dashboard\aum_ceiling_findings.md` immediately:

```markdown
# Ceiling Comparison + Population Sizing — Findings
**Run Date**: [INSERT TIMESTAMP]
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_ceiling_and_population_sizing.sql
**Status**: IN PROGRESS

---
```

---

## Environment Setup

```python
from google.cloud import bigquery
import pathlib

client = bigquery.Client(project="savvy-gtm-analytics")

# BQ connection
list(client.query("SELECT 1").result())
print("BQ: OK")

# SQL file
sql_path = pathlib.Path(r"C:\Users\russe\Documents\Dashboard\aum_ceiling_and_population_sizing.sql")
assert sql_path.exists()
print("SQL file: OK")

# Prerequisite tables
prereqs = [
    "savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile",
    "savvy-gtm-analytics.ml_features.aum_proxy_labeled_features",
    "savvy-gtm-analytics.ml_features.aum_proxy_control_features",
]
for t in prereqs:
    rows = list(client.query(f"SELECT COUNT(*) AS n FROM `{t}`").result())
    n = rows[0]['n']
    assert n > 0, f"Table empty or missing: {t}"
    print(f"{t.split('.')[-1]}: {n:,} rows — OK")
```

Record in findings:
```markdown
## Environment Setup
- BQ Connection: PASS/FAIL
- SQL File: PASS/FAIL
- aum_40_100m_signal_profile: [n] rows
- aum_proxy_labeled_features: [n] rows
- aum_proxy_control_features: [n] rows
- Status: READY / HALTED
```

---

## ANALYSIS A: CEILING SIGNAL DETECTION

### STEP A1 — Build >$100M Labeled Cohort Feature Table

**What**: Pulls all SFDC opportunities with AUM > $100M, joins to FINTRX,
and computes the same feature set used in V2. Excludes any CRD that also
appears in the $40M–$100M cohort (boundary cases).

**Key addition vs V2**: Accolade fields are split into `has_barrons_accolade`
and `has_forbes_not_barrons` — Barron's requires substantially more AUM than
Forbes Next Gen, making it a ceiling signal candidate.

**Expected runtime**: 30–60s
**Expected rows**: Likely 100–500 (>$100M opps are rarer in SFDC)

**⛔ VALIDATION GATE A1 — Hard Stop**

```sql
SELECT
  COUNT(*)                            AS total_rows,
  COUNT(DISTINCT crd)                 AS unique_crds,
  MIN(sfdc_aum) / 1e6                 AS min_sfdc_aum_M,
  MAX(sfdc_aum) / 1e6                 AS max_sfdc_aum_M,
  AVG(sfdc_aum) / 1e6                 AS avg_sfdc_aum_M,
  COUNTIF(sfdc_aum < 100000000)       AS below_100m_count, -- must be 0
  COUNTIF(firm_aum_current IS NULL)   AS null_firm_aum,
  -- Check for overlap with $40M–$100M cohort
  (SELECT COUNT(*) FROM `savvy-gtm-analytics.ml_features.aum_ceiling_labeled_features` h
   JOIN `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` m ON h.crd = m.crd)
                                      AS overlap_with_mid_cohort
FROM `savvy-gtm-analytics.ml_features.aum_ceiling_labeled_features`
```

Pass criteria:
- `total_rows` > 30 (if fewer, the >$100M cohort is too small to compare — flag and continue with caution, do not stop)
- `below_100m_count` = 0 (no boundary bleed)
- `overlap_with_mid_cohort` = 0 (clean separation between cohorts)
- `total_rows` = `unique_crds` (no duplicates)

Record:
```markdown
## Step A1: >$100M Labeled Cohort Feature Table

- **Status**: PASS / FAIL / PASS WITH CAUTION (low n)
- **Rows**: [n]
- **Unique CRDs**: [n]
- **AUM Range**: $[min]M – $[max]M (avg $[avg]M)
- **sfdc_aum_band distribution**: [record counts by $100M–$250M / $250M–$500M / $500M–$1B / $1B+]
- **Overlap with $40M–$100M cohort**: [n] (must be 0)
- **Null Firm AUM**: [n] ([pct]%)
- **Note if n < 50**: Small sample — ceiling signals will be directional only,
  not statistically conclusive. Flag all A2/A3 findings accordingly.
```

---

### STEP A2 — Three-Way Signal Comparison

**What**: Runs the three-way GROUP BY comparing $40M–$100M vs >$100M vs Control
across all features. This is the primary Analysis A output.

**How to read it**: You're looking at three columns and asking two questions:
1. Where does >$100M differ from $40M–$100M? → ceiling signals
2. Where does $40M–$100M differ from Control? → floor/target signals (already known from V2, but validates consistency)

**⛔ VALIDATION GATE A2**
- Result must have exactly 3 rows (one per group)
- The $40M–$100M row metrics should roughly match V2 findings
  (e.g., pct_independent_ria should be ~53%, pct_portable_custodian ~61%)
  If they differ substantially, the join logic may have changed — flag it.

Record:
```markdown
## Step A2: Three-Way Signal Comparison

[PASTE FULL 3-ROW RESULT TABLE]

### Consistency check vs V2:
- V2 pct_independent_ria (labeled): 53.1% | This run: [X]% | Match: YES/NO
- V2 pct_portable_custodian (labeled): 60.9% | This run: [X]% | Match: YES/NO
- V2 avg_license_count (labeled): 2.61 | This run: [X] | Match: YES/NO

### Ceiling Signals (where >$100M differs most from $40M–$100M):

| Feature | $40M–$100M | >$100M | Delta | Direction | Ceiling Implication |
|---------|-----------|--------|-------|-----------|---------------------|
| [feature] | | | | | |

### Key Observation:
[Plain English: what kind of advisor profile does >$100M represent vs. $40M–$100M?
Are they at larger firms? More credentialed? Different tenure?]
```

---

### STEP A3 — Ceiling Signal Delta Table

**What**: Ranks all features by how much they differ between the $40M–$100M
and >$100M cohorts. Outputs `ceiling_signal_strength` labels.

**⛔ VALIDATION GATE A3**
- Result must have 13 rows (one per feature)
- At least 1 feature should show 'Strong ceiling signal' — if zero features
  show strong differentiation, the two cohorts are too similar to build ceiling
  exclusion logic from this data alone (flag, record, and note in synthesis)

Record:
```markdown
## Step A3: Ceiling Signal Delta Rankings

[PASTE FULL RESULT TABLE]

### Strong Ceiling Signals (delta >= 0.15):
[List each. For each one:]
- **[feature]**: [mid_value] in $40M–$100M vs [high_value] in >$100M
  Direction: [Higher/Lower in >$100M]
  Ceiling exclusion logic: [e.g., "advisors where firm_rep_count > X are likely >$100M"]

### Moderate Ceiling Signals (delta 0.05–0.15):
[List each with same format]

### Features with NO ceiling differentiation:
[List — these signals cannot be used to exclude ceiling advisors]

### Proposed Ceiling Exclusion Criteria:
Based on strong + moderate signals, propose 1–3 ceiling exclusion filters
that can be added to the population sizing query (Analysis B) to refine it.

Example format:
- EXCLUDE IF: [feature condition] — removes est. [X]% of >$100M advisors
  while retaining est. [Y]% of $40M–$100M advisors
```

---

## ANALYSIS B: POPULATION SIZING

### STEP B1 — Three-Variant Volume Sizing

**IMPORTANT**: Before running B1, update the population sizing query to add
any Strong ceiling signals discovered in A3. The query has a `PLACEHOLDER`
comment in the `sized` CTE marking where to add ceiling exclusion logic.

For example, if A3 shows `firm_rep_count > 50` is a strong ceiling signal,
add to the `sized` CTE WHERE clause:
```sql
AND COALESCE(firm_rep_count, 0) <= 50  -- ceiling exclusion
```

Run the query TWICE if you add ceiling criteria:
- First without ceiling filters (baseline volume)
- Then with ceiling filters (refined volume)
Record both.

**Expected runtime**: 90–180s (scans full FINTRX universe ~788K contacts)

**⛔ VALIDATION GATE B1 — Hard Stop**
- `total_universe` (the denominator) must be > 50,000 for all variants
  (if lower, the exclusion filters are too aggressive on the full population)
- `passes_relaxed` >= `passes_enhanced` >= `passes_tight` (logical ordering)
- `est_monthly_new_prospects` for Enhanced must be > 0

Record:
```markdown
## Step B1: Population Sizing — Three Variants

### WITHOUT Ceiling Exclusion (baseline)

| Variant | Total Universe | Passes Criteria | % of Universe | Est. Monthly New |
|---------|---------------|-----------------|---------------|------------------|
| Relaxed | | | | |
| Enhanced | | | | |
| Tight | | | | |

### WITH Ceiling Exclusion (after adding A3 signals)
[If ceiling criteria were added — record the delta]

| Variant | Passes Criteria | Change vs Baseline | Est. Monthly New |
|---------|-----------------|-------------------|------------------|
| Relaxed | | [+/-X] | |
| Enhanced | | [+/-X] | |
| Tight | | [+/-X] | |

### Volume Assessment:
- **Relaxed monthly new**: [n] prospects
  Verdict: [Too few (<200) / Viable (200–2000) / Too many — need tighter filter (>2000)]
- **Enhanced monthly new**: [n] prospects
  Verdict: [same scale]
- **Tight monthly new**: [n] prospects
  Verdict: [same scale]

### Recommended variant for production:
[Which variant gives viable volume — 300–1500 monthly — while maintaining the
precision ratios from V2? Record your reasoning.]
```

---

### STEP B2 — Firm AUM Breakdown of Enhanced-Criteria Advisors

**What**: Of the advisors passing Enhanced criteria, what is the firm AUM
distribution? This validates that the criteria are not accidentally over-indexing
on large-firm advisors (who would be unlikely to have $40M–$100M individual AUM).

**Expected**: The majority should be at firms with $50M–$500M total AUM.
If >40% are at $1B+ firms, the Enhanced criteria are too permissive on firm size.

**⛔ VALIDATION GATE B2**
- Result must have at least 4 distinct `firm_aum_bucket` values
- 'Unknown' bucket should be < 20% of total

Record:
```markdown
## Step B2: Firm AUM Distribution of Enhanced-Criteria Advisors

[PASTE FULL RESULT TABLE]

### Assessment:
- % at firms under $500M (sweet spot): [sum of Under $50M + $50M–$100M + $100M–$250M + $250M–$500M]%
- % at firms $1B+: [sum of $1B–$5B + $5B+]%
- **Is the distribution consistent with a $40M–$100M individual AUM target?**
  YES — majority at sub-$500M firms / NO — over-indexing on large firms
- **If over-indexing**: Recommend adding `firm_aum < $500M` as an Enhanced criteria filter
  and re-running B1 to see volume impact.
```

---

## STEP C — Final Synthesis

After all steps, write the complete tier specification:

```markdown
---

## Final Synthesis: TIER_AUM_MID Production Specification

### Full Band Definition
This tier targets advisors likely to have $40M–$100M in individual AUM
who have never been in our SFDC pipeline.

### Floor Signals (from V2 — confirmed)
Criteria that identify the TARGET band vs. the general population:
| Signal | Threshold | Discrimination Score | Basis |
|--------|-----------|---------------------|-------|
| is_independent_ria OR (is_portable_custodian AND NOT has_series_7) | TRUE | 34.3 / 34.6 | V2 Step 3 |
| firm_disc_ratio | > 0.70 | 52.5 (Cohen's d) | V2 Step 3 |
| firm_hnw_ratio | > 0.30 | 61.2 (Cohen's d) | V2 Step 3 |
| license_count | < 3 | 70.1 (Cohen's d) | V2 Step 3 |
| industry_tenure_years | 7–25 | 41.6 (Cohen's d) | V2 Step 3 |

### Ceiling Signals (from V3 Analysis A — new)
Criteria that EXCLUDE advisors likely above $100M:
| Signal | Threshold | Ceiling Delta | Basis |
|--------|-----------|--------------|-------|
| [A3 strong signal 1] | [exclude if X] | [delta] | V3 Step A3 |
| [A3 strong signal 2] | [exclude if X] | [delta] | V3 Step A3 |

### Standard Exclusions (unchanged from existing pipeline)
- Wirehouse firms
- Excluded firm CRDs (ml_features.excluded_firm_crds)
- Advisors likely over 70 (INDUSTRY_TENURE_MONTHS > 480)
- Already in SFDC pipeline (Lead or Opportunity)

### Recommended Criteria Variant
[Relaxed / Enhanced / Tight] — [reasoning: volume vs. precision tradeoff]

### Estimated Monthly Volume
- Total passing criteria (not in pipeline): [n from B1]
- Estimated monthly new prospects: [n / 12]
- Comparable existing tiers: [e.g., TIER_2_PROVEN_MOVER gets 1,500 leads/month]

### Expected Conversion Rate Estimate
From V1 findings: non-excluded win rate was 3.4% (3.4x baseline).
This is directional — based on n=9 wins, so treat as hypothesis not fact.
Recommend: shadow run first, validate against 30-day conversion data before
committing to production quota.

### Next Steps
- [ ] Write production SQL inserting TIER_AUM_MID into lead list pipeline
- [ ] Run shadow pass against current month's lead list to check tier overlap
      with existing V3 tiers (TIER_2_PROVEN_MOVER likely captures some of these)
- [ ] Add to monthly quota at conservative volume (e.g., 200 leads/month) for
      first 60-day validation window
- [ ] Re-evaluate after 30-day conversion data matures

### Open Questions Resolved / Unresolved
[Carry forward any open questions from V1/V2 findings, mark each as resolved or still open]
```

---

## Investigation Validation Summary

```markdown
---

## Validation Summary

| Step | Status | Rows | Key Gate |
|------|--------|------|----------|
| Environment Setup | PASS/FAIL | — | 3 prereq tables |
| A1: >$100M Feature Table | PASS/FAIL | [n] | No boundary bleed, no overlap |
| A2: Three-Way Comparison | PASS/FAIL | 3 rows | Consistent with V2 |
| A3: Ceiling Delta Table | PASS/FAIL | 13 rows | ≥1 strong signal |
| B1: Population Sizing | PASS/FAIL | 3 rows | Logical ordering |
| B2: Firm AUM Breakdown | PASS/FAIL | 4+ rows | <20% Unknown |

**Overall Status**: COMPLETE / INCOMPLETE
**Primary Finding**: [1 sentence — what is the strongest ceiling signal?]
**Viable Tier?**: YES (volume + precision sufficient) / NO (explain)
**Ready for Production SQL**: YES / NO — [blocker if No]
```

---

## Error Handling

Same protocol as V1 and V2:
1. Capture full error, append under `## ERROR — [Step Name]`
2. CTE optimization errors: break failing CTE into `CREATE TEMP TABLE`
3. For Analysis B specifically: if `total_universe` < 50,000, the universe
   filter is too aggressive — check the excluded_firms and sfdc_crds CTEs
4. Max 2 retries. Record and stop.

## Cost Awareness
Analysis A scans similar tables to V2: ~8–12 GB expected.
Analysis B scans the full ria_contacts_current (2.87 GB) plus firm joins.
Estimated total: ~15–20 GB across all steps.
Flag any single step > 20 GB as a cost anomaly.
Log `job.total_bytes_billed` at every step.
