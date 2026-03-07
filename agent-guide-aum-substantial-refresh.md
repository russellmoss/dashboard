# Agent Guide: TIER_AUM_SUBSTANTIAL Shadow Table Refresh
**Version**: 1.0
**System**: Claude Code (single agent, no subagents)
**BigQuery Project**: `savvy-gtm-analytics`
**SQL File**: `C:\Users\russe\Documents\Dashboard\aum_substantial_shadow_refresh.sql`
**Output File**: `C:\Users\russe\Documents\Dashboard\aum_substantial_refresh_findings.md` (create this)

---

## What This Does

This is a targeted refresh — not a new investigation. The analysis is done.
We are making two specific changes to the existing shadow table and validating them:

1. **Firm AUM ceiling raised from $1B to $2.5B** — captures $100–200M advisors
   at mid-size firms (median firm rep count 202 for that band vs 74 for $40–100M).
2. **Priority ranking changed from `v4_percentile DESC` to `aum_confidence_score DESC`**
   — the AUM confidence score achieved a 28.5-point gap between labeled and control
   groups in band separation analysis (Block 5). It is a stronger rank signal for
   this specific tier than V4's mobility-based model.

Everything else — all criteria, tenure ceiling, accolade exclusion, wirehouse
exclusion, pipeline exclusion — is unchanged from the V5 shadow table.

**Output table**: `ml_features.aum_substantial_tier_candidates` (new name, new table)
**Previous table**: `ml_features.aum_mid_tier_candidates` (retained intact until validated)

---

## Output File Initialization

Create `C:\Users\russe\Documents\Dashboard\aum_substantial_refresh_findings.md`:

```markdown
# TIER_AUM_SUBSTANTIAL Shadow Table Refresh — Findings
**Run Date**: [INSERT TIMESTAMP]
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_substantial_shadow_refresh.sql
**Status**: IN PROGRESS

## Changes from V5 (aum_mid_tier_candidates)
- Firm AUM ceiling: $1B → $2.5B
- Priority ranking: v4_percentile DESC → aum_confidence_score DESC
- Tier name: TIER_AUM_MID → TIER_AUM_SUBSTANTIAL

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
    r"C:\Users\russe\Documents\Dashboard\aum_substantial_shadow_refresh.sql")
assert sql_path.exists()

prereqs = {
    "aum_mid_tier_candidates (V5 — do not overwrite)":
        "savvy-gtm-analytics.ml_features.aum_mid_tier_candidates",
    "v4_prospect_scores":
        "savvy-gtm-analytics.ml_features.v4_prospect_scores",
    "excluded_firm_crds":
        "savvy-gtm-analytics.ml_features.excluded_firm_crds",
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
- V5 shadow table (aum_mid_tier_candidates): [n] rows — will be preserved
- v4_prospect_scores: [n] rows
- Status: READY / HALTED
```

---

## BLOCK 1: Pre-Refresh Snapshot

Run the Block 1 query. This captures the current V5 state so you have a
clean before/after comparison. Record the output.

```markdown
## Block 1: Pre-Refresh Snapshot (V5 State)

| Metric | Value |
|--------|-------|
| Total candidates | 2,021 (expected) |
| Unique firms | |
| Avg V4 percentile | 60.4 (expected) |
| Avg firm AUM ($B) | |
| Under $1B count | |
| $1B-$2.5B count | (should be 0 — this band was excluded) |
| Avg tenure | |
```

---

## BLOCK 2: Build Refreshed Shadow Table

Run the `CREATE OR REPLACE TABLE aum_substantial_tier_candidates` query.

This writes to a **new table** — `aum_substantial_tier_candidates`. The existing
`aum_mid_tier_candidates` table is not touched. Do not drop or modify the old
table at any point during this run.

Expected runtime: 3–5 minutes. Expected size: 2,500–5,000 rows (V5 was 2,021
at $1B ceiling; raising to $2.5B adds the $1B–$2.5B firm band).

If the query errors:
1. Check for `SAFE.PARSE_DATE` vs `SAFE_CAST` issues — run the date format
   check from V5 error handling if needed
2. Check that `ria_contacts_current` and `ria_firms_current` are in
   `FinTrx_data_CA` dataset specifically

Record:
```markdown
## Block 2: Shadow Table Build
- Status: PASS / FAIL
- Runtime: [minutes]
- Error (if any): [description]
```

---

## BLOCK 3: Post-Build Validation

Run all three Block 3 queries (3A, 3B, 3C) immediately after Block 2.

### 3A: Side-by-side comparison

This is the main deliverable table. Record every row.

Expected directional changes from V5 → V6:
- **Total candidates**: higher than 2,021 (ceiling raised, more firms qualify)
- **Unique firms**: higher than 1,595
- **Avg AUM score**: should be reported (was NULL in V5)
- **% high confidence**: should be meaningful (>40% expected based on labeled group validation)
- **Avg V4 percentile**: may dip slightly (new advisors at $1B–$2.5B firms may score lower on V4's mobility model)
- **$1B–$2.5B count**: should be > 0 (this is the new cohort being added)
- **Max per firm**: must be ≤ 50

### 3B: Overlap between new and old tables

Records how much of the V5 pool carried forward. Expected: >90% of V5 advisors
should still qualify (only advisors removed are those who entered the pipeline
since March 4 or where data changed). The new advisors will show as `new_only`.

### 3C: Validation gates

**All five gates must pass before proceeding.** If any fail:

- `duplicate_check` FAIL: Something is wrong with the CTE logic — investigate
  the join producing duplicates before proceeding.
- `no_pipeline_advisors` FAIL: Pipeline exclusion isn't working — check the
  SFDC Lead join. Do not proceed.
- `tenure_populated` FAIL: `PRIMARY_FIRM_START_DATE` parse is failing for >15%
  of advisors. Run format inspection query from V5 error handling.
- `score_populated` FAIL: AUM confidence score CTE has a NULL issue — check
  that all CASE statements have an ELSE clause.
- `firm_cap_ok` FAIL: Some firm has >50 advisors. This is a hard limit —
  investigate which firm and whether there's a data quality issue.

```markdown
## Block 3: Post-Build Validation

### 3A: Side-by-Side Comparison

| Metric | V5 (pre-refresh) | V6 (post-refresh) | Delta |
|--------|-----------------|-------------------|-------|
| Total candidates | 2,021 | | |
| Unique CRDs | 2,021 | | |
| Unique firms | 1,595 | | |
| Avg AUM confidence score | n/a | | |
| % HIGH confidence band | n/a | | |
| Avg V4 percentile | 60.4 | | |
| Avg firm AUM ($B) | | | |
| Under $1B count | | | |
| $1B–$2.5B count | 0 | | |
| % in new ceiling band | 0% | | |
| Avg tenure at firm | 5.3 | | |
| Max per firm | 35 | | |

### 3B: Overlap

| Metric | Count |
|--------|-------|
| In both V5 and V6 | |
| New only (V6) | |
| Old only (V5, dropped) | |
| % of V5 retained | |

### 3C: Validation Gates

| Gate | Passes | Detail |
|------|--------|--------|
| duplicate_check | | |
| no_pipeline_advisors | | |
| tenure_populated | | |
| score_populated | | |
| firm_cap_ok | | |

**All gates passed**: YES / NO
**Proceed to Block 4**: YES / NO (only if all gates pass)
```

**⛔ Hard stop if any validation gate fails.** Do not run Block 4.
Document the failure and stop. Do not overwrite the old table.

---

## BLOCK 4: Score Band Distribution Report

Run all three Block 4 queries (4A, 4B, 4C).

### 4A: Score band summary

This drives quota recommendations. Record the full table.

Read the monthly_at_this_band column as the quota ceiling if we pull
exclusively from that band:
- HIGH band: [count] advisors / 12 = [n]/month max
- MODERATE band: [count] advisors / 12 = [n]/month max
- LOW band: should be deprioritized

### 4B: Score histogram

Look for a bimodal or clearly skewed distribution. If the histogram shows
a large spike at low scores (0–20), that means a significant portion of the
pool has weak signals — worth flagging.

### 4C: Top 20 spot check

Read through the top 20 advisors. Sanity check:
- Do they look like the right profile? (small-to-mid firm, independent RIA,
  high HNW/disc, few licenses)
- Are any at $1B–$2.5B firms? (these are new from the ceiling extension)
- Is `rank_within_firm` = 1 for all of them? (if not, multiple advisors from
  the same firm are in the top 20 — check if this looks right)
- Are there any obvious data quality issues (missing names, suspicious AUM values)?

Record:
```markdown
## Block 4: Score Band Distribution

### 4A: Score Band Summary

| Band | Count | % of Pool | Avg Score | Avg V4 % | % New Ceiling | Monthly Quota |
|------|-------|-----------|-----------|----------|---------------|---------------|
| HIGH (>=50) | | | | | | |
| MODERATE (30-49) | | | | | | |
| LOW (<30) | | | | | | |
| **Total** | | | | | | |

### 4B: Score Histogram

| Score Bucket | Count | % |
|-------------|-------|---|
[paste histogram]

**Distribution shape**: [Unimodal / Bimodal / Right-skewed / Left-skewed]
**Note on LOW band**: [What % is low? Worth noting if >30%]

### 4C: Top 20 Spot Check

[Paste top 20 table]

**Spot check assessment**:
- Profile looks correct: YES / NO (notes)
- $1B-$2.5B firms represented in top 20: YES / NO
- Any data quality concerns: [none / describe]
```

---

## Final Synthesis

```markdown
---

## Final Synthesis

### Pool Size Change
- V5 (aum_mid_tier_candidates): 2,021 advisors
- V6 (aum_substantial_tier_candidates): [n] advisors
- Net new from ceiling extension: [delta]
- % of V6 pool from new $1B-$2.5B ceiling band: [pct]%

### Quota Recommendation
Based on score band distribution:
- **April shadow run**: [n] leads/month, pulled exclusively from HIGH band
  (aum_score_band = 'HIGH', priority_rank order)
- Rationale: HIGH band represents the 4x precision lift threshold (>=50 score).
  At [HIGH count] total advisors, this supports [HIGH count / 12] months of quota.
- If HIGH band exhausted before conversion validated: drop to MODERATE band.
  Do NOT pull LOW band during shadow run.

### Changes Ready for April Lead List
The following SQL change is needed in the lead list pipeline to use the new table:

1. Replace table reference:
   FROM `ml_features.aum_mid_tier_candidates`
   → FROM `ml_features.aum_substantial_tier_candidates`

2. Add score band filter for shadow run (HIGH only):
   WHERE aum_score_band = 'HIGH'
   AND rank_within_firm <= [firm_cap]

3. Update tier label in CASE statement:
   'TIER_AUM_MID' → 'TIER_AUM_SUBSTANTIAL'

4. Firm diversity cap: use rank_within_firm <= 10 at pull time
   (table allows up to 50, but pulling 10 max per firm keeps diversity)

### Table Status
- aum_mid_tier_candidates (V5): PRESERVED — do not drop until April run validates
- aum_substantial_tier_candidates (V6): READY / NOT READY

### Overall Status: COMPLETE / HALTED
```

---

## Validation Summary

```markdown
---

## Validation Summary

| Block | Status | Key Output |
|-------|--------|-----------|
| 1: Pre-refresh snapshot | | V5: 2,021 advisors captured |
| 2: Shadow table build | | [n] rows created |
| 3A: Side-by-side comparison | | Delta: [V6 - 2,021] advisors |
| 3B: Overlap analysis | | [pct]% of V5 retained |
| 3C: Validation gates | | All pass: YES/NO |
| 4A: Score band summary | | HIGH: [n], MOD: [n], LOW: [n] |
| 4B: Score histogram | | [distribution shape] |
| 4C: Top 20 spot check | | Profile correct: YES/NO |

**Overall status**: COMPLETE
**Table ready for April run**: YES / NO
**Recommended monthly quota**: [n] leads/month (HIGH band only)
```

---

## Error Handling

1. **Block 2 query times out**: Add `OPTIONS(statement_timeout=900000)` to the
   CREATE TABLE statement (15 min timeout). The full FINTRX scan at $2.5B ceiling
   is larger than the $1B scan.

2. **AUM confidence score is all NULL**: The score CTE uses fields from
   `base_candidates`. If those fields are NULL, check that `firm_disc_ratio`,
   `firm_hnw_ratio`, and `tenure_at_firm_years` are populating in the base_candidates
   CTE before the score is computed.

3. **firm_cap_ok gate fails (max > 50)**: Find the offending firm:
   ```sql
   SELECT firm_crd, firm_name, COUNT(*) AS cnt
   FROM ml_features.aum_substantial_tier_candidates
   GROUP BY 1, 2
   ORDER BY cnt DESC LIMIT 5
   ```
   If a single large RIA is generating >50 candidates, the firm diversity cap
   at pull time (rank_within_firm <= 10) will handle it. The gate is a warning,
   not a blocker in this case — document and proceed.

4. **Pool smaller than expected (< 2,021)**: The new ceiling should ADD advisors,
   not remove them. If the pool shrank, the tenure ceiling or other criteria may
   have been inadvertently changed. Compare the WHERE clause to V5 criteria line
   by line.

## Cost Awareness
- Block 1: ~1 GB
- Block 2: ~20 GB (full FINTRX universe scan at wider ceiling)
- Block 3: ~3 GB
- Block 4: ~1 GB
- **Total**: ~25 GB
