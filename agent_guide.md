# Agent Guide: $40M–$100M AUM Advisor Signal Investigation
**System**: Claude Code (single agent, no subagents)  
**BigQuery Project**: `savvy-gtm-analytics`  
**Python Client**: `google-cloud-bigquery` (already installed in project env)  
**SQL File**: `pipeline/sql/aum_40_100m_signal_profiling.sql`  
**Output File**: `pipeline/investigation/aum_40_100m_findings.md` (you will create this)

---

## Your Role

You are a data engineer conducting a structured BigQuery investigation into the
signals that characterize financial advisors with $40M–$100M in AUM who have
entered our Salesforce funnel. Your findings will inform a new FINTRX prospecting tier.

You will:
1. Execute SQL queries against BigQuery in a specific sequence
2. Validate each result before proceeding
3. Record all findings, row counts, and anomalies into `aum_40_100m_findings.md`
4. Never skip a validation gate — if a gate fails, STOP and record the failure with detail

You are NOT allowed to:
- Interpret results without first validating data quality
- Skip steps because a prior result "looks right"
- Proceed past a hard stop validation gate
- Write speculative findings — only record what the data shows

---

## Environment Setup

Before running anything, verify your environment:

```python
from google.cloud import bigquery
client = bigquery.Client(project="savvy-gtm-analytics")

# Verify BQ connection
test = client.query("SELECT 1 AS alive").result()
print("BQ connection: OK")

# Verify the SQL file exists
import pathlib
sql_path = pathlib.Path("pipeline/sql/aum_40_100m_signal_profiling.sql")
assert sql_path.exists(), f"SQL file not found: {sql_path}"
print(f"SQL file found: {sql_path}")
```

If either check fails: stop, report the error in `aum_40_100m_findings.md`, do not proceed.

---

## Output File Initialization

Create `pipeline/investigation/aum_40_100m_findings.md` immediately with this header:

```markdown
# $40M–$100M AUM Advisor Signal Investigation — Findings
**Run Date**: [INSERT TIMESTAMP]  
**Executed By**: Claude Code (autonomous agent)  
**SQL Source**: pipeline/sql/aum_40_100m_signal_profiling.sql  
**Status**: IN PROGRESS

---
```

Append all findings to this file as you go. Never overwrite — always append.

---

## Execution Steps

### STEP 1 — Run Phase 1: Build the Wide Enrichment Table

**What this does**: Runs the `CREATE OR REPLACE TABLE` query that builds
`savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile` — the enriched
spine of all SFDC opportunities with $40M–$100M AUM joined to FINTRX signals.

**How to run**: Extract the Phase 1 block from the SQL file (everything from
`CREATE OR REPLACE TABLE` through the final `FROM ... ;`) and execute it.

```python
# Recommended execution pattern
job_config = bigquery.QueryJobConfig()
job = client.query(phase1_sql, job_config=job_config)
job.result()  # blocks until complete — expected runtime: 60–120s
print(f"Phase 1 complete. Job ID: {job.job_id}")
print(f"Bytes processed: {job.total_bytes_processed:,}")
```

**⛔ VALIDATION GATE 1 — Hard Stop**

After Phase 1 completes, run this exact validation query:

```sql
SELECT
  COUNT(*)                                    AS total_rows,
  COUNT(DISTINCT opportunity_id)              AS unique_opps,
  COUNT(DISTINCT crd)                         AS unique_crds,
  COUNTIF(crd IS NULL)                        AS null_crd_count,
  COUNTIF(firm_aum_best IS NULL)              AS null_firm_aum_count,
  COUNTIF(is_excluded IS NULL)                AS null_exclusion_flag_count,
  MIN(opp_created_date)                       AS earliest_opp,
  MAX(opp_created_date)                       AS latest_opp,
  COUNTIF(firm_aum_is_pit = TRUE)             AS aum_from_historical,
  COUNTIF(firm_aum_is_pit = FALSE
    OR firm_aum_is_pit IS NULL)               AS aum_from_current_fallback
FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
```

**Pass criteria** (all must be true to proceed):
- `total_rows` > 0 (table was populated)
- `unique_opps` = `total_rows` (no duplicate opportunity_ids — each opp is one row)
- `null_crd_count` = 0 (all rows joined to FINTRX — if > 0, investigate why)
- `null_exclusion_flag_count` = 0 (exclusion logic ran cleanly)
- `earliest_opp` is a real date (not NULL)

**If any criterion fails**: Record the specific failure, the full validation result,
and stop. Do not run Phase 2 queries.

**Record in findings file**:
```markdown
## Step 1: Phase 1 Table Build

- **Status**: PASSED / FAILED
- **Job ID**: [job_id]
- **Bytes Processed**: [bytes]
- **Total Rows**: [n]
- **Unique Opps**: [n]
- **Unique Advisors (CRDs)**: [n]
- **Date Range**: [earliest_opp] → [latest_opp]
- **AUM from Historical Snapshot**: [n] ([pct]%)
- **AUM from Current Fallback**: [n] ([pct]%)
- **Null CRD count**: [n]
- **Notes**: [any anomalies]
```

---

### STEP 2A — Cohort Overview

**Purpose**: Size the cohort, understand disqualification rate, and validate
outcome splits before reading any signal distributions.

Run the `2A: Cohort Overview` query block from the SQL file.

**⛔ VALIDATION GATE 2A — Hard Stop**

- `total_opps` must equal `unique_opps` from Step 1 validation (same table)
- `closed_won + closed_lost + open_pipeline` must equal `total_opps`
- `pct_excluded` should be between 5% and 60% — if outside this range, flag it
  as anomalous but do not stop (just note it)

**Record in findings file**:
```markdown
## Step 2A: Cohort Overview

| Metric | Value |
|--------|-------|
| Total Opportunities | |
| Unique Advisors | |
| Excluded (Disqualified) | [n] ([pct]%) |
| Exclusion Breakdown | Wirehouse: X, Over70: X, Excl.CRD: X |
| Has Any Disclosure | [n] ([pct]%) |
| Closed Won | |
| Closed Lost | |
| Open Pipeline | |
| Closed Win Rate | [pct]% |
| AUM from Historical Snapshot | [pct]% |

**Key Observation**: [1–2 sentence plain-English summary of what this tells us]
```

---

### STEP 2B — Signal Distributions by Outcome

**Purpose**: Core exploratory query. Compare signal profiles of won vs. lost vs. open
opportunities. This is where tier criteria will come from.

Run the `2B: Signal Distributions by Outcome` query block from the SQL file.
**Filter is already applied**: `WHERE is_excluded = FALSE`

**⛔ VALIDATION GATE 2B**

- Result must have exactly 3 rows (Won, Lost, Open) — if different, the outcome
  logic has a bug. Stop and report.
- `opp_count` for Won + Lost + Open must equal (`total_opps` from 2A minus `excluded_count`)

**Record in findings file**:

Paste the full 3-row result table. Then add:

```markdown
## Step 2B: Signal Distributions by Outcome

[PASTE FULL RESULT TABLE]

### Signals with Largest Won vs. Lost Delta (rank by absolute difference)

| Signal | Won % | Lost % | Delta | Direction |
|--------|-------|--------|-------|-----------|
| [top signal] | | | | Higher in Won/Lost |
| ... | | | | |

**Key Observations**:
- [Signal 1]: [plain-English interpretation]
- [Signal 2]: [plain-English interpretation]
- [Flag any signal where Won and Lost are nearly identical — low discriminating power]

**Potential Tier Inclusion Signals** (high Won rate, clear delta):
- [list]

**Potential Tier Exclusion Signals** (high Lost rate, or high disclosure rate):
- [list]
```

---

### STEP 2C — Tenure Bucket × Outcome

Run the `2C` query block. Results are grouped by tenure bucket with win rates.

**Record in findings file**:
```markdown
## Step 2C: Tenure at Firm × Outcome

[PASTE FULL RESULT TABLE]

**Key Observation**: [Which tenure bucket has the highest win rate? What does
this imply for tier targeting — e.g., should we target advisors at their
current firm for 1–5 years?]

**Recommended tenure guardrail for new tier**: [e.g., "3–10 years at current firm"]
```

---

### STEP 2D — Firm AUM Bucket × Firm Size × Outcome

Run the `2D` query block. Helps define firm-level guardrails.

**Key question to answer**: Are $40M–$100M advisors at small firms ($100M–$500M
firm AUM, 1–10 reps) winning at a higher rate than the same advisors embedded
in large platforms? If yes, that's a core tier criterion.

**Record in findings file**:
```markdown
## Step 2D: Firm AUM Bucket × Firm Size × Outcome

[PASTE FULL RESULT TABLE]

**Key Observation**: [Where does win rate peak? What firm AUM range and rep
count combination produces the best outcomes?]

**Recommended firm-level guardrails for new tier**:
- Firm AUM: [range]
- Firm Rep Count: [range]
```

---

### STEP 2E — AUM Band × License Type

Run the `2E` query block. Closes the loop on whether sub-tiers ($40–$60M vs.
$80–$100M) behave differently by license type.

**Record in findings file**:
```markdown
## Step 2E: AUM Band × License Profile

[PASTE FULL RESULT TABLE]

**Key Observation**: [Does the $80–$100M band show a meaningfully different
license profile? Should we split the tier or keep it unified?]

**Recommendation**: Single tier / Two sub-tiers — [reasoning]
```

---

### STEP 2F — Closed-Lost Reason Breakdown

Run the `2F` query block. Only closed-lost, non-excluded opps.

**Record in findings file**:
```markdown
## Step 2F: Closed-Lost Reason Distribution

[PASTE TOP 15 ROWS]

**Top 3 Lost Reasons**:
1. [reason] — [pct]% — [interpretation: true disqualifier vs. timing/objection]
2. [reason] — [pct]% — [interpretation]
3. [reason] — [pct]% — [interpretation]

**Implications for tier design**: [Are there lost reasons that suggest we should
add a filter? Or lost reasons that suggest these advisors are recruitable with
different timing/messaging?]
```

---

### STEP 2G — Exclusion Analysis

Run the `2G` query block. Understand disqualification breakdown and whether
any excluded segments (e.g., wirehouses) still win at notable rates.

**Key question**: If wirehouse advisors in the $40M–$100M band are winning at
meaningful rates, they may warrant an M&A-style carve-out tier (precedent: V3.5.0).

**Record in findings file**:
```markdown
## Step 2G: Exclusion Analysis

[PASTE FULL RESULT TABLE]

**Key Observation**: [What is the largest excluded segment? Do any excluded
segments show win rates that suggest a carve-out is worth considering?]

**M&A Carve-Out Candidate?**: Yes / No — [reasoning]
```

---

### STEP 3 — Synthesis & Tier Draft

After all 7 queries are recorded and validated, synthesize the findings into
a draft tier definition. Append this section to the findings file:

```markdown
---

## Step 3: Tier Draft — TIER_AUM_MID ($40M–$100M Advisor Tier)

### Tier Hypothesis
[1 paragraph: what type of advisor does this tier target and why?]

### Proposed Inclusion Criteria
Based on signals from 2B, 2C, 2D, 2E:

| Criterion | Value | Signal Source | Confidence |
|-----------|-------|---------------|------------|
| Advisor AUM (SFDC) | $40M–$100M | Opp AUM field | High |
| [Signal 2] | [value] | 2B — [metric name] | High/Medium/Low |
| [Signal 3] | [value] | 2C — Tenure | High/Medium/Low |
| [Signal 4] | [value] | 2D — Firm size | High/Medium/Low |
| ... | | | |

### Proposed Exclusion Criteria
(in addition to standard: wirehouse, >70 yrs, excluded CRDs)

| Criterion | Value | Rationale |
|-----------|-------|-----------|
| [any new exclusions surfaced by 2B/2F] | | |

### Expected Population Size
[Estimate: how many FINTRX advisors would pass these criteria per month?
Calculate this with a follow-up COUNT query against ria_contacts_current
using the proposed criteria.]

### Estimated Conversion Rate
Based on win rate from 2B (non-excluded, qualifying advisors): [X]%  
Relative to known baselines:
- TIER_2_PROVEN_MOVER: 2.2% (1.7x baseline)
- Overall baseline (Dec): 1.0%

### Open Questions / Unknowns
- [ ] [Any signal where data was sparse or coverage was low]
- [ ] [Any criterion that needs further validation with a follow-up query]
- [ ] [Age proxy — validate INDUSTRY_TENURE_MONTHS > 480 threshold vs. actual age field]

### Recommended Next Steps
1. [e.g., Run a population-sizing query in FINTRX to estimate monthly lead volume]
2. [e.g., Validate the tier in a shadow run before adding to lead list SQL]
3. [e.g., Check for overlap with existing V3 tiers]
```

---

### STEP 4 — Final Validation Summary

Append this final section to the findings file:

```markdown
---

## Investigation Validation Summary

| Step | Status | Row Count | Key Validation |
|------|--------|-----------|----------------|
| Phase 1 Table Build | PASS/FAIL | | Gate 1 criteria |
| 2A Cohort Overview | PASS/FAIL | 1 row | Totals reconcile |
| 2B Signal Distributions | PASS/FAIL | 3 rows | Won+Lost+Open = total |
| 2C Tenure × Outcome | PASS/FAIL | 6 rows | All tenure buckets present |
| 2D Firm AUM × Size | PASS/FAIL | N rows | |
| 2E AUM Band × License | PASS/FAIL | 3 rows | All AUM bands present |
| 2F Lost Reasons | PASS/FAIL | ≤30 rows | Only closed-lost rows |
| 2G Exclusion Analysis | PASS/FAIL | N rows | NULL exclusion_reason row = non-excluded |

**Overall Investigation Status**: COMPLETE / INCOMPLETE  
**Findings Confidence**: High / Medium / Low  
**Ready for Tier Implementation**: Yes / No — [reason if No]
```

---

## Error Handling

If BigQuery returns an error at any step:
1. Capture the full error message
2. Append to findings file under a `## ERROR — [Step Name]` section
3. Check: is it a schema mismatch? A missing table? A syntax error from CTE resolution?
4. For CTE resolution errors specifically — this project has prior experience with
   BigQuery CTE optimization failures (see two-query architecture in README).
   If you encounter one, try splitting the failed CTE into a separate CREATE TEMP TABLE
   step and re-running.
5. Do not retry more than 2 times on the same query. Record and stop.

## Cost Awareness

This investigation processes large tables (ria_contacts_current = 2.87 GB,
Firm_historicals = 251 MB, contact_registered_employment_history = 162 MB).
Phase 1 will scan several GB. Log `job.total_bytes_billed` at each step.
If any single query bills > 20 GB, flag it in the findings file as a cost anomaly.

---

## Files Reference

| File | Location | Purpose |
|------|----------|---------|
| This guide | `pipeline/investigation/agent_guide.md` | Your operating instructions |
| SQL queries | `pipeline/sql/aum_40_100m_signal_profiling.sql` | All Phase 1 and Phase 2 SQL |
| Findings output | `pipeline/investigation/aum_40_100m_findings.md` | You create and write this |
| Existing pipeline README | `README.md` (project root) | Architecture context |
| FINTRX data dictionary | `FINTRX_Data_Dictionary.md` | Schema reference |
