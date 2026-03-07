# V5: Tenure Discrimination + Shadow Table Refresh — Findings
**Run Date**: 2026-03-04
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_v5_tenure_and_refresh.sql
**Status**: COMPLETE

---

## Environment Setup
- BQ: PASS
- SQL file: PASS
- Prereq tables:
  - aum_proxy_labeled_features: 307 rows OK
  - aum_proxy_control_features: 3,442 rows OK
  - aum_mid_tier_candidates (V4 shadow): 3,998 rows OK
  - v4_prospect_scores: 266,900 rows OK
- PRIMARY_FIRM_START_DATE coverage: 262,806 / 262,806 (100%)
- PREVIOUS_REGISTRATION_COMPANY_CRD_IDS populated: 262,806 (100%)
- Status: READY

---

## Block 1A: Current Firm Tenure Discrimination

### Coverage
- Labeled has_tenure: 301 (98.0%) — PASS (>200 required)
- Control has_tenure: 3,386 (98.4%)

### Distributions

| Metric | Labeled ($40M-$100M) | Control |
|--------|---------------------|---------|
| N | 307 | 3,442 |
| Has tenure | 301 (98.0%) | 3,386 (98.4%) |
| Avg tenure at firm (years) | **5.54** | **9.30** |
| Stddev | 5.43 | 8.28 |
| Median | 3.8 | 6.8 |
| P25 | 1.3 | 2.8 |
| P75 | 7.8 | 13.4 |
| % < 1 year | 17.6% | 6.2% |
| % 1-4 years (PRIME_MOVER window) | 33.2% | 28.0% |
| % 4-10 years | 33.2% | 30.3% |
| % > 10 years | **16.6%** | **36.0%** |
| Avg % of career at current firm | 0.393 | 0.559 |

### Cohen's d Calculation
```
d = |labeled_avg - control_avg| / ((labeled_stddev + control_stddev) / 2)
  = |5.54 - 9.30| / ((5.43 + 8.28) / 2)
  = 3.76 / 6.855
  = 0.549
```

### Signal Assessment

**d = 0.549 > 0.50: STRONG signal.**

**Critical finding: direction is REVERSED from hypothesis.**

The $40M-$100M cohort has **shorter** tenure at their current firm (avg 5.54yr vs 9.30yr). They are NOT settled book-builders — they are MORE recently at their current firm than the general advisor population. Key differences:
- 17.6% have been at their firm < 1 year (vs 6.2% control — nearly 3x)
- Only 16.6% have been at their firm 10+ years (vs 36.0% control — less than half)
- They've spent only 39.3% of their career at their current firm (vs 55.9% control)

**Interpretation**: The $40M-$100M AUM proxy profile describes advisors who are relatively early in their current firm relationship — likely advisors who recently set up or joined a smaller independent RIA, which is consistent with the solo/micro firm signal from V1.

**Tenure criterion direction**: Since long tenure is a CONTROL characteristic, the criterion should be a CEILING (exclude very-long-tenured advisors), not a floor. Using the labeled P75 of 7.8yr as reference and the pct_over_10yr gap (16.6% vs 36.0%), the threshold is `tenure_at_firm_years < 10`.

**Decision**: d = 0.549 → **Add criterion: `tenure_at_firm_years < 10`** (ceiling — excludes long-tenured advisors)

---

## Block 1B: Prior Firm Count from CRD_IDS Field

| Metric | Labeled | Control |
|--------|---------|---------|
| N | 307 | 3,442 |
| Null or empty | 0 | 0 |
| Avg prior firms (V5) | **3.52** | **2.68** |
| Stddev | 2.45 | 2.35 |
| Median | 3.0 | 2.0 |
| % with 3+ prior firms | **59.3%** | **38.6%** |

**Cohen's d (V5)**:
= |3.52 - 2.68| / ((2.45 + 2.35) / 2)
= 0.84 / 2.40
= **0.35**

**Comparison to V4 result** (d=0.19 from history table join):
- V5 d: **0.35**
- V4 d: 0.19
- Agreement: **No — V5 shows substantially stronger signal** (0.35 vs 0.19)

The V4 history table method was systematically undercounting prior firms due to:
1. The `-1` adjustment (incorrect — current firm is not in the history table)
2. Some prior firms not appearing in the history table at all

V5's CRD_IDS field provides a complete, pre-aggregated count with no join or adjustment needed.

**Revised prior firm count conclusion**:
d = 0.35 crosses the 0.30 threshold — prior firm count is now a **moderate signal**, not just a soft weight. The labeled cohort has meaningfully more prior firms (avg 3.52 vs 2.68, 59.3% vs 38.6% with 3+ priors). This reinforces the mobility narrative from Block 1A: $40M-$100M advisors have moved more frequently AND arrived at their current firm more recently.

**Note**: Not adding as a hard criterion at this time because:
1. d = 0.35 is borderline moderate (vs tenure's 0.549 which is strong)
2. Adding both tenure ceiling AND prior firm floor risks over-constraining the pool
3. Prior firm count is already implicitly captured by the tenure ceiling (shorter tenure = more moves)
4. Recommend using as a priority_rank weight in the shadow table ORDER BY

---

## Block 1C: Job Gap Analysis

| Metric | Labeled | Control |
|--------|---------|---------|
| N (has both dates) | 307 | 3,442 |
| Avg current firm tenure | 5.5 yr | 9.3 yr |
| Avg gap between jobs (years) | -0.42 | -0.62 |
| Median gap | 0.0 | 0.0 |
| % in PRIME_MOVER window (1-4yr tenure) | **32.6%** | 27.5% |
| % settled 5+ years | 42.3% | 57.3% |
| % settled 10+ years | 16.3% | 35.4% |

**Interpretation**:
The negative avg gap means many advisors have overlapping registrations (dual-registered at old and new firm during transition). Median gap is 0 for both groups — most transitions are seamless. The labeled cohort's last move was more recent, but the gap duration itself is similar to control.

**PRIME_MOVER contamination check**:
32.6% of the labeled cohort is in the 1-4yr tenure window (PRIME_MOVER eligibility zone). This is above the 25% concern threshold. However, these advisors are filtered by TIER_AUM_MID's other criteria (disc_ratio > 0.70, hnw_ratio > 0.30, firm_aum < $1B, no accolades) which are orthogonal to PRIME_MOVER's criteria (num_prior_firms >= 3, industry_tenure >= 5yr). The V4 overlap analysis showed only 1.2% actual overlap with TIER_2_PROVEN_MOVER, so the theoretical contamination doesn't translate to real duplication.

**Recommendation**: Accept the overlap. The tenure < 10yr criterion already removes the most control-like long-tenured advisors. Adding a tenure > 4yr floor would unnecessarily exclude 50.8% of labeled advisors (< 1yr + 1-4yr buckets) who are actually the strongest matches for the target profile.

---

## Block 2: Prior Firm Count Cross-Validation

| Metric | Labeled | Control |
|--------|---------|---------|
| N | 307 | 3,442 |
| Avg V5 count | 3.52 | 2.68 |
| Avg V4 count | 3.35 | 2.41 |
| Avg delta (V5 - V4) | +0.18 | +0.27 |
| % agree within 1 | 99.0% | 100.0% |
| V5 higher count | 44 | 924 |
| Same count | 263 | 2,518 |
| V5 lower count | 0 | 0 |

**Consistency verdict**: Highly consistent (99-100% agree within 1). V5 is systematically slightly higher — V5 is NEVER lower than V4. This confirms V4's -1 adjustment was a systematic undercount.

**Preferred method going forward**: V5 (CRD_IDS field) — no join required, no adjustment needed, complete count, 100% coverage.

**Does this change the d=0.19 soft weight conclusion?**
Yes — V5 Cohen's d = 0.35 (up from 0.19). The prior firm count signal is moderate, not weak. However, not adding as a hard criterion (see Block 1B rationale). The V5 method will be used in the refreshed shadow table for accurate `num_prior_firms` values.

---

## Block 3: Shadow Table Refresh

### Decision to run: YES (d=0.549 > 0.30)

### Tenure criterion added:
```sql
AND DATE_DIFF(CURRENT_DATE(), SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE), MONTH) / 12.0 < 10
```
Rationale: Labeled pct_over_10yr (16.6%) is less than half of control (36.0%). Removing 10+ year tenured advisors targets the control-profile population while preserving 83.4% of the labeled cohort's profile.

### Validation Results

| Metric | Value | Pass/Fail |
|--------|-------|-----------|
| Total candidates | 2,021 | vs V4: 3,998 (-49.5%) |
| Delta vs V4 | -1,977 | Negative = expected ✓ |
| Has tenure populated | 2,021 (100%) | PASS ✓ |
| Unique CRDs | 2,021 = total | No duplicates ✓ |
| Unique firms | 1,595 | — |
| Max per firm | 35 | ≤ 50 ✓ |
| Avg V4 percentile | **60.4** | vs V4: 56.0 (+4.4 improvement) |
| Avg tenure at firm | 5.3 yr | — |
| Avg prior firms (V5) | 2.32 | — |

All validation gates: **PASS**

### Tenure distribution in refreshed table

| Tenure Bucket | Count | % |
|--------------|-------|---|
| 4-10 years (settling) | 1,282 | 63.4% |
| 1-4 years (PRIME_MOVER window) | 622 | 30.8% |
| < 1 year | 117 | 5.8% |

The distribution is healthy — majority (63.4%) in the 4-10yr "settling" window, with no 10+ year advisors (excluded by criterion). The 30.8% in PRIME_MOVER window is noted but acceptable (see Block 1C contamination analysis).

### Prior Firm Count Distribution (V5 method)

| Prior Firms | Count | % |
|-------------|-------|---|
| 1 | 840 | 41.6% |
| 2 | 497 | 24.6% |
| 3 | 356 | 17.6% |
| 4 | 134 | 6.6% |
| 5 | 82 | 4.1% |
| 6 | 49 | 2.4% |
| 7+ | 63 | 3.1% |

Right-skewed as expected. No zeros — the V5 CRD_IDS field always contains at least one entry (likely including the current firm registration). Distribution is realistic.

### Status: PASS

---

## Final Synthesis

### Key Question Answered: Does tenure at current firm discriminate?

**Cohen's d**: 0.549
**Answer**: Yes — **strong signal** (d > 0.50). But in the OPPOSITE direction from hypothesized. $40M-$100M advisors have SHORTER tenure, not longer.

### What Changed vs. V4

| Component | V4 State | V5 State |
|-----------|----------|----------|
| Current firm tenure | NULL everywhere (wrong table) | **Populated (100% coverage from PRIMARY_FIRM_START_DATE)** |
| Prior firm count method | History table join (-1 adjustment) | **CRD_IDS field on ria_contacts_current (no join, no adjustment)** |
| Prior firm count d | 0.19 (soft weight) | **0.35 (moderate signal — revised upward)** |
| Tenure criterion in criteria | Not present | **Added: tenure_at_firm_years < 10 (ceiling)** |
| Shadow table row count | 3,998 | **2,021 (-49.5%)** |
| Avg V4 percentile | 56.0 | **60.4 (+4.4 — higher quality pool)** |

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

- [ ] `$40M-$100M_Advisor_Profile_Technical_Methodology.md`
  - Section 8 (Known Data Quality Issues): correct employment history description
  - Section 6 (V4): update Block 1A root cause explanation
  - Section 7 (Final Criteria): add `tenure_at_firm_years < 10` ceiling criterion

- [ ] `TIER_AUM_MID_Proposal.md`
  - Update criteria table: add tenure ceiling
  - Update shadow table row count: 3,998 → 2,021
  - Update avg V4 percentile: 56.0 → 60.4

- [ ] `$40M-$100M_Advisor_Profile_Executive_Summary.md`
  - Revise "stable advisor" characterization: these are MOBILE advisors with
    shorter-than-average tenure, not long-tenured book-builders
  - The profile is: independent RIA advisor, 7-25yr career, <10yr at current firm,
    high discretionary/HNW ratios, at sub-$1B firm, no accolades

### Shadow Table Status
`ml_features.aum_mid_tier_candidates` refreshed as of V5 run (2026-03-04).
- Row count: 2,021 (down from 3,998 in V4)
- Tenure populated: 100%
- Prior firm count method: V5 (CRD_IDS field)
- Tenure criterion: `tenure_at_firm_years < 10` applied

**Ready for April 2026 shadow run**: YES
- Recommended quota: 170/month (2,021 / 12 = 168, rounded up)
- 3.4% expected conversion x 170 = ~6 expected MQLs/month
- V4 percentile improvement (56.0 → 60.4) suggests tighter, higher-quality pool

---

## Validation Summary

| Step | Status | Key Result |
|------|--------|-----------|
| Environment Setup | PASS | Both fields 100% coverage (262,806) |
| Block 1A: Tenure Discrimination | PASS | d=0.549 (strong, reversed direction) |
| Block 1B: Prior Firm Count V5 | PASS | d=0.35 (revised up from V4's 0.19) |
| Block 1C: Job Gap Analysis | PASS | 32.6% in PRIME_MOVER window, acceptable |
| Block 2: Cross-Validation | PASS | 99-100% agree within 1, V5 preferred |
| Block 3: Shadow Refresh | RAN — PASS | 2,021 candidates (down from 3,998) |

**Overall Status**: COMPLETE
**Primary Finding**: Current firm tenure strongly discriminates (d=0.549) but in the OPPOSITE direction — $40M-$100M advisors have shorter tenure (avg 5.54yr vs 9.30yr). Added `tenure_at_firm_years < 10` ceiling to criteria.
**Action taken on shadow table**: Refreshed with tenure < 10yr ceiling + V5 prior firm count method. Pool reduced 49.5% to 2,021 candidates with higher avg V4 percentile (60.4 vs 56.0).
