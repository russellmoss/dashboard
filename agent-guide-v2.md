# Agent Guide V2: AUM Proxy Signal Comparison
**Version**: 2.0  
**System**: Claude Code (single agent, no subagents)  
**BigQuery Project**: `savvy-gtm-analytics`  
**SQL File**: `C:\Users\russe\Documents\Dashboard\aum_proxy_signal_comparison.sql`  
**Output File**: `C:\Users\russe\Documents\Dashboard\aum_proxy_findings.md` (you will create this)  
**Prerequisite**: `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile` must exist
  (built by the Phase 1 query in `aum_40_100m_signal_profiling.sql`)

---

## Context — Why This Investigation Exists

The previous investigation (`aum_40_100m_findings.md`) confirmed that advisors
with $40M–$100M AUM in our SFDC funnel share a strong profile signal: solo/micro
firm (1–3 reps), small firm AUM, non-wirehouse. But that analysis only described
advisors who already found us.

This investigation answers the harder question:
**Which FINTRX signals best identify $40M–$100M advisors who have never been in
our pipeline?** We do this by comparing the 336 SFDC-labeled advisors against
5,000 producing advisors from the general FINTRX population and ranking every
feature by how much it discriminates between the two groups.

The output directly informs whether to build a rules-based tier, an ML classifier,
or both — and which features to use.

---

## Your Role

You are a data engineer running a structured signal discrimination analysis in
BigQuery. You will:

1. Verify prerequisites and environment
2. Run 4 SQL steps in order, validating each before proceeding
3. Interpret the ranked signal output — not just record it
4. Write all findings, interpretations, and the final proxy signal recommendation
   into `aum_proxy_findings.md`
5. Never skip a validation gate. Never interpret before validating.

---

## Output File Initialization

Create `C:\Users\russe\Documents\Dashboard\aum_proxy_findings.md` immediately:

```markdown
# AUM Proxy Signal Comparison — Findings
**Run Date**: [INSERT TIMESTAMP]
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_proxy_signal_comparison.sql
**Prerequisite Table**: ml_features.aum_40_100m_signal_profile
**Status**: IN PROGRESS

---
```

---

## Environment Setup

Run these checks before anything else. Stop and report if any fail.

```python
from google.cloud import bigquery
import pathlib

client = bigquery.Client(project="savvy-gtm-analytics")

# 1. BQ connection
list(client.query("SELECT 1").result())
print("BQ: OK")

# 2. SQL file exists
sql_path = pathlib.Path(r"C:\Users\russe\Documents\Dashboard\aum_proxy_signal_comparison.sql")
assert sql_path.exists(), f"SQL file not found: {sql_path}"
print(f"SQL file: OK")

# 3. Prerequisite table exists and has rows
rows = list(client.query("""
  SELECT COUNT(*) AS n
  FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
""").result())
n = rows[0]['n']
assert n > 0, "Prerequisite table is empty or does not exist"
print(f"Prerequisite table: OK ({n:,} rows)")
```

Record in findings file:
```markdown
## Environment Setup
- BQ Connection: PASS/FAIL
- SQL File: PASS/FAIL
- Prerequisite Table Row Count: [n]
- Status: READY TO PROCEED / HALTED
```

---

## STEP 1 — Build Labeled Cohort Feature Table

**What**: Runs the `CREATE OR REPLACE TABLE aum_proxy_labeled_features` block.
Pulls the 336 SFDC-confirmed $40M–$100M advisors and computes 22 FINTRX features
for each. Deduplicates to one row per CRD.

**Expected runtime**: 30–60s  
**Expected output**: ~300–336 rows (some CRDs may not match to FINTRX)

**⛔ VALIDATION GATE 1 — Hard Stop**

```sql
SELECT
  COUNT(*)                          AS total_rows,
  COUNT(DISTINCT crd)               AS unique_crds,
  COUNTIF(firm_aum_current IS NULL) AS null_firm_aum,
  COUNTIF(firm_rep_count IS NULL
    OR firm_rep_count = 0)          AS null_rep_count,
  ROUND(AVG(firm_rep_count), 1)     AS avg_rep_count,
  ROUND(AVG(firm_aum_current)/1e6, 1) AS avg_firm_aum_M
FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
```

Pass criteria:
- `total_rows` BETWEEN 250 AND 400 (some CRDs won't match FINTRX — that's OK,
  but if < 250 the join is badly broken; stop and investigate)
- `total_rows` = `unique_crds` (deduplication worked — no fan-out)
- `null_rep_count` = 0

Record:
```markdown
## Step 1: Labeled Cohort Feature Table

- **Status**: PASS / FAIL
- **Rows**: [n] (expected 250–400)
- **Unique CRDs**: [n]
- **CRDs lost in FINTRX join**: [336 - n] ([pct]%)
- **Null Firm AUM**: [n] ([pct]%)
- **Avg Firm AUM**: $[X]M
- **Avg Firm Rep Count**: [X]
- **Bytes Billed**: [X]
- **Notes**: [any anomalies]
```

---

## STEP 2 — Build Control Group Feature Table

**What**: Runs the `CREATE OR REPLACE TABLE aum_proxy_control_features` block.
Randomly samples 5,000 producing advisors never in SFDC pipeline, excluding
wirehouses and excluded firm CRDs. Computes the same 22 features.

**Expected runtime**: 60–120s  
**Expected output**: Up to 5,000 rows (LIMIT 5000 in query)

**⛔ VALIDATION GATE 2 — Hard Stop**

```sql
SELECT
  COUNT(*)                          AS total_rows,
  COUNT(DISTINCT crd)               AS unique_crds,
  COUNTIF(is_independent_ria)       AS independent_ria_count,
  ROUND(COUNTIF(is_independent_ria)*100.0/COUNT(*), 1) AS pct_independent_ria,
  ROUND(AVG(firm_rep_count), 1)     AS avg_rep_count,
  ROUND(AVG(firm_aum_current)/1e6, 1) AS avg_firm_aum_M,
  -- Sanity check: no SFDC advisors leaked into control
  (SELECT COUNT(*) FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features` ctrl
   JOIN `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` lab
     ON ctrl.crd = lab.crd)         AS overlap_with_labeled
FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
```

Pass criteria:
- `total_rows` BETWEEN 3,000 AND 5,000 (if < 3,000, the sampling logic is
  too restrictive; investigate the exclusion filters)
- `unique_crds` = `total_rows` (no duplicates)
- `overlap_with_labeled` = 0 (critical — labeled advisors must not appear in control)

Record:
```markdown
## Step 2: Control Group Feature Table

- **Status**: PASS / FAIL
- **Rows**: [n] (expected 3,000–5,000)
- **Unique CRDs**: [n]
- **Overlap with Labeled Group**: [n] (must be 0)
- **% Independent RIA**: [X]% (rough sanity check on sampling)
- **Avg Firm AUM**: $[X]M
- **Avg Firm Rep Count**: [X]
- **Bytes Billed**: [X]
```

---

## STEP 3 — Run Signal Discrimination Comparison

**What**: Runs the STEP 3 query (the UNION ALL comparison block) against both
tables. Produces a ranked table of all features by discrimination score.

**Interpretation guide**:

For BINARY features:
- `discrimination_score` = absolute difference in rates (0–100 scale)
- `lift_ratio` = labeled_rate / control_rate
- Score > 20 = strong discriminator
- Score 10–20 = moderate discriminator
- Score < 10 = weak discriminator (likely not useful as tier criterion)

For CONTINUOUS features:
- `discrimination_score` = standardized difference (Cohen's d × 100)
- Score > 50 = strong (Cohen's d > 0.5 = medium effect size)
- Score 20–50 = moderate
- Score < 20 = weak

**⛔ VALIDATION GATE 3**

- Result must have at least 20 rows (one per feature)
- Both BINARY and CONTINUOUS rows must be present
- No feature should show a labeled_pct or labeled_mean of NULL
  (would indicate the labeled table is empty or the join failed)

Record the FULL result table, then add this interpretation block:

```markdown
## Step 3: Signal Discrimination Rankings

### Full Results Table
[PASTE COMPLETE OUTPUT — all rows, all columns]

### Ranked Signal Summary

**Top discriminators (score > 20 or std_disc > 50):**

| Rank | Feature | Type | Labeled | Control | Score | Interpretation |
|------|---------|------|---------|---------|-------|----------------|
| 1 | [feature] | Binary/Continuous | [val] | [val] | [score] | [plain English] |
| ... | | | | | | |

**Weak or no discrimination (likely DROP from tier logic):**
- [feature]: score [X] — [reason why it doesn't discriminate]
- ...

### The Divisor Verdict (firm_aum_per_rep_M)
- Labeled median per-rep AUM: $[X]M
- Control median per-rep AUM: $[X]M
- Standardized discrimination score: [X]
- **Verdict**: Strong proxy / Weak proxy / Ambiguous — [1-2 sentence explanation]
  [If strong: what band threshold would you use? e.g., "$15M–$100M per rep"]
  [If weak: what does this tell us about why the divisor doesn't work?]

### Unexpected Findings
[Any feature that ranked higher or lower than expected — and why that might be]
```

---

## STEP 4 — Firm AUM / Rep Count Deep Dive

**What**: Runs the STEP 4 distribution query specifically on `firm_aum_per_rep`.
Produces p10/p25/median/p75/p90 for both groups and the % of each group
falling in the $15M–$120M proxy band.

**Key question to answer**: Does the labeled cohort cluster more tightly in a
specific per-rep AUM range than the control? If the labeled group has 65%+ in
the proxy band and the control has <35%, the divisor is usable as a soft filter.

Record:
```markdown
## Step 4: Firm AUM Per Rep Distribution Deep Dive

| Metric | Labeled ($40M–$100M Advisors) | Control (General Population) |
|--------|-------------------------------|------------------------------|
| N | | |
| Mean per-rep AUM | $[X]M | $[X]M |
| P10 | $[X]M | $[X]M |
| P25 | $[X]M | $[X]M |
| Median | $[X]M | $[X]M |
| P75 | $[X]M | $[X]M |
| P90 | $[X]M | $[X]M |
| % in $15M–$120M band | [X]% | [X]% |

**Distribution interpretation**:
[Is the labeled distribution clearly tighter / shifted vs. control?]
[Does the proxy band ($15M–$120M) meaningfully separate the two groups?]
[Final verdict on whether firm_aum_per_rep should be included in tier logic]
```

---

## STEP 5 — Synthesis: Proxy Signal Recommendation

After all 4 steps, synthesize findings into a final recommendation. This is
the primary deliverable of this investigation.

```markdown
---

## Step 5: Proxy Signal Recommendation

### Question Being Answered
Which FINTRX signals, queryable today, best identify advisors likely to have
$40M–$100M in AUM — people who have never been in our SFDC pipeline?

### Recommended Proxy Signal Set (ordered by discrimination strength)

| Priority | Signal | Threshold | Discrimination Score | Type |
|----------|--------|-----------|---------------------|------|
| 1 | [top signal] | [value] | [score] | Hard filter / Soft score |
| 2 | [signal 2] | [value] | [score] | Hard filter / Soft score |
| 3 | [signal 3] | [value] | [score] | Hard filter / Soft score |
| ... | | | | |

**Hard filters** (exclude if not met — high confidence, low false-positive risk):
- [e.g., firm_rep_count <= X]
- [e.g., firm_aum_current < $XM]

**Soft scoring signals** (weight in model or scoring formula, not hard cutoffs):
- [e.g., is_series_65_only — adds weight but not required]
- [e.g., industry_tenure in Peak bucket — adds weight]

### ML vs. Rules-Based Recommendation

Based on how many strong discriminators were found and how cleanly they separate
the groups, answer: Is a rules-based tier sufficient, or do we need an ML
classifier?

**Threshold**: If top 3–4 signals together achieve > 60% separation (i.e., the
combination of hard filters would include > 60% of labeled advisors while
excluding > 70% of control advisors), a rules-based tier is sufficient.

Calculate this coverage check:
```sql
SELECT
  group_label,
  COUNT(*)                            AS total,
  COUNTIF(
    -- Insert the proposed hard filter criteria here
    firm_rep_count <= 3
    AND firm_aum_current < 500000000
    AND is_series_65_only = TRUE      -- only if it ranked as strong discriminator
  )                                   AS passes_proposed_criteria,
  ROUND(
    COUNTIF(
      firm_rep_count <= 3
      AND firm_aum_current < 500000000
      AND is_series_65_only = TRUE
    ) * 100.0 / COUNT(*), 1
  )                                   AS coverage_pct
FROM (
  SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
  UNION ALL
  SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
)
GROUP BY group_label
```

Update the criteria in this query based on actual top-ranked signals from Step 3
before running it. Record the result:

- **Labeled coverage** (% of $40M–$100M advisors passing criteria): [X]%
- **Control coverage** (% of general population passing — want this LOW): [X]%
- **Precision proxy**: [labeled_coverage / control_coverage] ratio

**If labeled coverage > 55% AND control coverage < 30%**: Rules-based tier is
viable. Proceed to population sizing.

**If labeled coverage < 40% OR the gap is narrow**: The signals are too
overlapping for clean rules. Recommend ML classifier using these signals as
features, with the 336 labeled advisors as the positive training class.

### Recommended Next Step
[ ] Rules-based: Write TIER_AUM_MID SQL and run population sizing
[ ] ML classifier: Define training set, feature list, and model spec
[ ] Hybrid: Rules-based pre-filter + ML scoring within the filtered set

### Open Questions
- [ ] [any feature with unexpected result that needs follow-up]
- [ ] [any coverage/data quality issue that limits confidence]
```

---

## Final Validation Summary

```markdown
---

## Investigation Validation Summary

| Step | Status | Rows | Key Gate |
|------|--------|------|----------|
| Environment Setup | PASS/FAIL | — | BQ + prereq table |
| Step 1: Labeled Features | PASS/FAIL | [n] | 250–400 rows, no dups |
| Step 2: Control Features | PASS/FAIL | [n] | 3k–5k rows, 0 overlap |
| Step 3: Discrimination Ranking | PASS/FAIL | 20+ rows | Both types present |
| Step 4: Divisor Deep Dive | PASS/FAIL | 2 rows | Both groups present |
| Step 5: Synthesis | COMPLETE/INCOMPLETE | — | Recommendation written |

**Overall Status**: COMPLETE / INCOMPLETE
**Primary Finding**: [1 sentence — what is the single strongest proxy signal?]
**Recommended Path**: Rules-based tier / ML classifier / Hybrid
**Ready for Next Step**: Yes / No — [blocker if No]
```

---

## Error Handling

Same protocol as agent-guide.md:

1. Capture full error, append to findings under `## ERROR — [Step Name]`
2. For BigQuery CTE fan-out / optimization errors: try breaking the failing CTE
   into a `CREATE TEMP TABLE` and re-running
3. For the control group query specifically: if `total_rows` < 3,000, the
   `MOD(FARM_FINGERPRINT(...), 100) < 2` sampling condition may be too tight
   given exclusion filters. Try increasing to `< 3` (3% sample) and re-run
4. Max 2 retries per step. Record and stop if both fail.

## Cost Awareness

This investigation scans:
- `ria_contacts_current`: 2.87 GB
- `contact_registered_employment_history`: 162 MB
- `contact_state_registrations_historicals`: 957 MB
- `contact_accolades_historicals`: small
- `ria_firms_current`: 129 MB

Estimated total: ~8–12 GB across Steps 1 and 2 combined.
Log `job.total_bytes_billed` at each step.
Flag any single step > 15 GB as a cost anomaly.
