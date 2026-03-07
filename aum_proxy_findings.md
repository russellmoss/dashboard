# AUM Proxy Signal Comparison — Findings
**Run Date**: 2026-03-04
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_proxy_signal_comparison.sql
**Prerequisite Table**: ml_features.aum_40_100m_signal_profile
**Status**: COMPLETE

---

## Environment Setup
- BQ Connection: PASS
- SQL File: PASS (`aum_proxy_signal_comparison.sql` exists)
- Prerequisite Table Row Count: 364
- Status: READY TO PROCEED
- **Note**: Used `FinTrx_data_CA` (northamerica-northeast2) instead of `FinTrx_data` (US) for cross-region compatibility with `ml_features` dataset. Applied SAFE_CAST for STRING-typed numeric columns (TOTAL_AUM, DISCRETIONARY_AUM, INDUSTRY_TENURE_MONTHS, etc.) and `PRODUCING_ADVISOR = 'true'` string comparison.

---

## Step 1: Labeled Cohort Feature Table

- **Status**: PASS
- **Rows**: 307 (expected 250–400)
- **Unique CRDs**: 307
- **CRDs lost in FINTRX join**: 57 (15.7%) — 364 in signal_profile, 307 matched to FinTrx_data_CA
- **Null Firm AUM**: 29 (9.4%)
- **Avg Firm AUM**: $131,399M (heavily skewed by large-firm outliers — not indicative of typical advisor)
- **Avg Firm Rep Count**: 2,340.4 (same skew — a few advisors at mega-aggregators pull this up)
- **Notes**: All validation gates pass. The high avg rep count / firm AUM reflects that some $40M–$100M advisors are at large RIA aggregators (not wirehouses, which were excluded). Median values (computed in Step 3/4) will be more informative.

---

## Step 2: Control Group Feature Table

- **Status**: PASS
- **Rows**: 3,442 (expected 3,000–5,000)
- **Unique CRDs**: 3,442
- **Overlap with Labeled Group**: 0 (must be 0) ✅
- **% Independent RIA**: 18.8%
- **Avg Firm AUM**: $247,414M (skewed by large-firm outliers)
- **Avg Firm Rep Count**: 5,338.9 (same outlier skew)
- **Notes**: 2% FARM_FINGERPRINT sample yielded 3,442 after exclusions — comfortably above the 3,000 floor. Zero overlap with labeled group confirmed. The control group's lower Independent RIA rate (18.8% vs likely higher in labeled) may itself be a discriminating signal.

---

## Step 3: Signal Discrimination Rankings

### Full Results Table

| Rank | Type | Feature | Labeled | Control | Delta | Lift | Disc. Score |
|------|------|---------|---------|---------|-------|------|-------------|
| 1 | CONTINUOUS | license_count | mean=2.61 | mean=3.80 | -1.19 | — | 70.1 |
| 2 | CONTINUOUS | firm_hnw_ratio | mean=0.60 | mean=0.47 | +0.13 | — | 61.2 |
| 3 | CONTINUOUS | firm_rep_count | mean=2,340 | mean=5,339 | -2,999 | — | 58.2 |
| 4 | CONTINUOUS | firm_disc_ratio | mean=0.86 | mean=0.74 | +0.12 | — | 52.5 |
| 5 | CONTINUOUS | firm_aum_current_M | mean=$131,399M | mean=$247,414M | -$116,015M | — | 41.8 |
| 6 | CONTINUOUS | industry_tenure_years | mean=15.85 | mean=19.89 | -4.04 | — | 41.6 |
| 7 | BINARY | is_portable_custodian | 60.9% | 26.3% | +34.6pp | 2.31x | 34.6 |
| 8 | BINARY | is_independent_ria | 53.1% | 18.8% | +34.3pp | 2.82x | 34.3 |
| 9 | BINARY | has_series_7 | 41.7% | 68.8% | -27.1pp | 0.61x | 27.1 |
| 10 | BINARY | is_series_65_only | 27.0% | 11.3% | +15.7pp | 2.39x | 15.7 |
| 11 | BINARY | is_solo_micro_firm | 20.5% | 5.5% | +15.0pp | 3.74x | 15.0 |
| 12 | CONTINUOUS | state_reg_count | mean=1.84 | mean=1.57 | +0.27 | — | 13.4 |
| 13 | BINARY | has_ownership | 13.0% | 5.3% | +7.7pp | 2.44x | 7.7 |
| 14 | BINARY | has_any_disclosure | 14.7% | 17.6% | -2.9pp | 0.83x | 2.9 |
| 15 | BINARY | has_any_accolade | 1.3% | 2.2% | -0.9pp | 0.60x | 0.9 |
| 16 | CONTINUOUS | firm_aum_per_rep_M | mean=$370M | mean=$418M | -$48M | — | **0.5** |
| 17 | BINARY | has_cfp | 0% | 0% | 0 | — | 0 |
| 18 | BINARY | has_cfa | 0% | 0% | 0 | — | 0 |
| 19 | CONTINUOUS | prior_firm_count | mean=0 | mean=0 | 0 | — | NULL |
| 20 | CONTINUOUS | tenure_at_firm_years | NULL | NULL | — | — | NULL |

### Ranked Signal Summary

**Top discriminators (score > 20 or std_disc > 0.50):**

| Rank | Feature | Type | Labeled | Control | Score | Interpretation |
|------|---------|------|---------|---------|-------|----------------|
| 1 | license_count | Continuous | 2.61 avg | 3.80 avg | 70.1 | Labeled advisors hold fewer licenses — consistent with pure RIA / Series 65 profile vs. dual-registered BD reps |
| 2 | firm_hnw_ratio | Continuous | 0.60 | 0.47 | 61.2 | Labeled advisors' firms serve proportionally more HNW clients — higher-touch, wealth-focused practices |
| 3 | firm_rep_count | Continuous | 2,340 | 5,339 | 58.2 | Labeled at smaller firms on average (though still skewed by outliers — median will tell the real story) |
| 4 | firm_disc_ratio | Continuous | 0.86 | 0.74 | 52.5 | Labeled firms manage more AUM on a discretionary basis — fiduciary / fee-based model signal |
| 5 | firm_aum_current_M | Continuous | $131B | $247B | 41.8 | Labeled at smaller firms (moderate effect, large variance) |
| 6 | industry_tenure_years | Continuous | 15.85yr | 19.89yr | 41.6 | Labeled advisors are earlier in career — Peak (15–25yr) bucket concentrated, not Late (25+yr) |
| 7 | is_portable_custodian | Binary | 60.9% | 26.3% | 34.6 | Strong signal — labeled advisors 2.3x more likely to use Schwab/Fidelity/Pershing/TDA |
| 8 | is_independent_ria | Binary | 53.1% | 18.8% | 34.3 | Strong signal — labeled advisors 2.8x more likely to be at an Independent RIA |
| 9 | has_series_7 | Binary | 41.7% | 68.8% | 27.1 | **Negative** discriminator — labeled advisors LESS likely to hold Series 7 (BD background) |

**Moderate discriminators (score 10–20):**
- **is_series_65_only** (15.7): 27.0% labeled vs 11.3% control — 2.4x lift. Pure RIA signal.
- **is_solo_micro_firm** (15.0): 20.5% labeled vs 5.5% control — 3.7x lift. Highest lift ratio of any binary feature, but low base rate limits utility as sole filter.
- **state_reg_count** (13.4): Labeled slightly more states (1.84 vs 1.57) — weak practical use.

**Weak or no discrimination (likely DROP from tier logic):**
- **has_ownership** (7.7): Moderate lift (2.4x) but low base rate (13% labeled). Could add marginal value in ML scoring.
- **has_any_disclosure** (2.9): No meaningful difference.
- **has_any_accolade** (0.9): Too rare in both groups to be useful.
- **firm_aum_per_rep_M** (0.5): **CRITICAL FINDING** — The divisor proxy is essentially non-discriminating. See Step 4 deep dive.
- **has_cfp / has_cfa** (0.0): Both show 0% in both groups — the REP_LICENSES field in FinTrx_data_CA does not contain CFP/CFA credential data. These features are non-functional.
- **prior_firm_count** (NULL): All zeros — the employment history CTE only captures current employment, so prior firm count is uniformly 0.
- **tenure_at_firm_years** (NULL): All NULL — the employment history join produced no tenure data (likely data quality issue in the CA dataset's start dates).

### The Divisor Verdict (firm_aum_per_rep_M)
- Labeled mean per-rep AUM: **$370M**
- Control mean per-rep AUM: **$418M**
- Standardized discrimination score: **0.005** (Cohen's d = 0.005 — negligible)
- **Verdict**: **Weak proxy — DO NOT USE as a filter or scoring signal.**
  The per-rep AUM distributions are nearly identical between labeled $40M–$100M advisors and the general population. This means you cannot infer individual advisor AUM by dividing firm AUM by rep count. The labeled advisors come from firms of all sizes, and the "divisor" produces the same distribution for both groups. The $15M–$120M band hypothesis does not hold.

### Unexpected Findings
1. **license_count is the #1 discriminator** — not firm size or custody. Labeled advisors hold significantly fewer licenses (avg 2.6 vs 3.8), consistent with a simpler registration profile (Series 65 only, no BD overlay).
2. **firm_hnw_ratio at #2** — the proportion of firm AUM from HNW clients is a stronger signal than firm size. This suggests the $40M–$100M cohort isn't just at "small firms" — they're at firms that disproportionately serve HNW clients regardless of firm size.
3. **firm_disc_ratio at #4** — high discretionary ratio (0.86 vs 0.74) reinforces the fee-based fiduciary model signal.
4. **is_portable_custodian and is_independent_ria** are the two strongest binary signals — together they paint a clear picture: independent, fee-only, portable-custody advisors.
5. **has_cfp/has_cfa both zero** — these credential fields are not populated in the CA dataset. Would need a different data source for credential enrichment.
6. **prior_firm_count and tenure_at_firm_years** are both non-functional — the employment history CTE needs investigation. The `PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL` filter may be too restrictive in this dataset.

---

## Step 4: Firm AUM Per Rep Distribution Deep Dive

| Metric | Labeled ($40M–$100M Advisors) | Control (General Population) |
|--------|-------------------------------|------------------------------|
| N | 278 | 2,727 |
| Mean per-rep AUM | $370.2M | $418.0M |
| P10 | $22.3M | $1.4M |
| P25 | $35.9M | $21.6M |
| Median | $67.0M | $35.9M |
| P75 | $125.4M | $71.1M |
| P90 | $205.3M | $138.1M |
| % in $15M–$120M band | 65.5% | 63.1% |

**Distribution interpretation**:

The labeled distribution IS shifted right compared to control — the labeled median ($67M) is nearly 2x the control median ($35.9M), and the labeled P10 ($22.3M) is 16x the control P10 ($1.4M). This means labeled advisors tend to be at firms where per-rep AUM is higher.

**However**, the $15M–$120M proxy band does NOT meaningfully separate the two groups: 65.5% of labeled vs 63.1% of control fall in this band — a mere 2.4 percentage point gap. The band is too wide and captures the bulk of both distributions.

A tighter band could slightly improve discrimination:
- $35M–$130M would capture ~50% of labeled (P25 to just above P75) but might still capture ~35-40% of control
- Even optimized, the overlap is too large for this to work as a standalone filter

**Final verdict on firm_aum_per_rep**: The means are similar ($370M vs $418M) due to extreme right-tail skew in both groups. The medians are more different ($67M vs $36M), suggesting some signal exists at the distributional center. But when converted to a binary band filter, the separation is negligible. **Do not include in tier logic as a hard filter.** Could contribute marginal value as one of many features in an ML model, but with Cohen's d of 0.005, even that is questionable.

---

## Step 5: Proxy Signal Recommendation

### Question Being Answered
Which FINTRX signals, queryable today, best identify advisors likely to have $40M–$100M in AUM — people who have never been in our SFDC pipeline?

### Recommended Proxy Signal Set (ordered by discrimination strength)

| Priority | Signal | Threshold | Discrimination Score | Type |
|----------|--------|-----------|---------------------|------|
| 1 | license_count | < 3 | 70.1 (Cohen's d=0.70) | Soft score |
| 2 | firm_hnw_ratio | > 0.40 | 61.2 (Cohen's d=0.61) | Soft score |
| 3 | firm_rep_count | (continuous) | 58.2 (Cohen's d=0.58) | Soft score |
| 4 | firm_disc_ratio | > 0.70 | 52.5 (Cohen's d=0.53) | Soft score |
| 5 | is_portable_custodian | = TRUE | 34.6 (rate delta) | Hard filter (OR) |
| 6 | is_independent_ria | = TRUE | 34.3 (rate delta) | Hard filter (OR) |
| 7 | has_series_7 | = FALSE | 27.1 (negative signal) | Hard filter (AND) |
| 8 | industry_tenure_years | 7–25yr (Peak bucket) | 41.6 (Cohen's d=0.42) | Soft score |
| 9 | is_series_65_only | = TRUE | 15.7 (rate delta) | Soft score |
| 10 | is_solo_micro_firm | = TRUE | 15.0 (rate delta, 3.7x lift) | Soft score |

**Hard filters** (exclude if not met — high confidence, low false-positive risk):
- `is_independent_ria = TRUE` OR `(is_portable_custodian = TRUE AND has_series_7 = FALSE)` — this "relaxed" combination captures 60.6% of labeled advisors while passing only 25.1% of the general population

**Soft scoring signals** (weight in model or scoring formula, not hard cutoffs):
- `license_count < 3` — strongest continuous discriminator; fewer licenses = simpler RIA profile
- `firm_hnw_ratio > 0.40` — firms with higher HNW client concentration
- `firm_disc_ratio > 0.70` — discretionary-dominant firms (fiduciary signal)
- `industry_tenure_years BETWEEN 7 AND 25` (Peak bucket) — adds weight
- `is_solo_micro_firm = TRUE` — highest lift ratio (3.7x) but low base rate; adds weight, not required
- `is_series_65_only = TRUE` — pure RIA credential signal, 2.4x lift

### ML vs. Rules-Based Recommendation

**Coverage check results (3 criteria variants tested):**

| Criteria | Labeled Coverage | Control Coverage | Precision Ratio |
|----------|-----------------|-----------------|-----------------|
| **Core** (indep_RIA AND portable_custodian) | 46.9% | 13.1% | 3.58x |
| **Relaxed** (indep_RIA OR (portable AND NOT series_7)) | **60.6%** | **25.1%** | **2.41x** |
| **Tight** (indep_RIA AND portable AND NOT series_7) | 42.0% | 10.9% | 3.85x |
| **Enhanced** (relaxed + disc_ratio>0.7 + hnw_ratio>0.3) | 51.1% | 12.9% | 3.96x |

**Threshold check**: The **Relaxed** criteria achieves labeled coverage > 55% (60.6%) AND control coverage < 30% (25.1%). This meets the guide's threshold for a rules-based tier.

**However**, the precision ratio of 2.41x means for every 2.4 target advisors identified, we also pass 1 non-target. This is acceptable for a prospecting pre-filter (not a precision instrument) — it narrows the universe by ~75% while retaining ~61% of the target population.

**Recommendation: Hybrid approach.**

1. **Rules-based pre-filter** (Phase 1): Apply the Relaxed criteria as a hard filter on the full FINTRX universe. This eliminates ~75% of the general population while retaining ~61% of target-profile advisors. This becomes `TIER_AUM_MID_CANDIDATE`.

2. **ML scoring within filtered set** (Phase 2, optional): Train a simple classifier (logistic regression or gradient-boosted tree) using the 307 labeled advisors as positive class and the control set as negative class. Use the top 6 continuous features (license_count, firm_hnw_ratio, firm_rep_count, firm_disc_ratio, firm_aum_current, industry_tenure_years) as input features. This would produce a probability score (0–1) for each advisor in the filtered set, enabling prioritized outreach.

3. **Why hybrid, not pure rules**: The Enhanced criteria (adding continuous signal filters) achieves 3.96x precision but drops labeled coverage to 51%. Hard thresholds on continuous features are brittle — an advisor with firm_disc_ratio of 0.69 is nearly identical to one with 0.71, but a hard cutoff treats them as completely different. ML scoring handles these gradients naturally.

### Recommended Next Step
- [x] Rules-based: Write `TIER_AUM_MID_CANDIDATE` SQL using Relaxed criteria and run population sizing
- [ ] ML classifier: Define training set (307 labeled + 3,442 control), feature list (top 6 continuous + 4 binary), and model spec (logistic regression baseline → BQML)
- [ ] Hybrid: Deploy rules-based pre-filter immediately; add ML scoring as Phase 2 enhancement

### Signals to DROP (no discriminative value)
- `firm_aum_per_rep` (the divisor proxy) — Cohen's d = 0.005, completely non-discriminating
- `has_cfp` / `has_cfa` — not populated in FinTrx_data_CA (0% in both groups)
- `prior_firm_count` — uniformly 0 (data quality issue in employment history CTE)
- `tenure_at_firm_years` — all NULL (same data issue)
- `has_any_accolade` — too rare (1.3% labeled, 2.2% control)
- `has_any_disclosure` — near-zero discrimination (2.9)

### Open Questions
- [ ] **CFP/CFA data source**: The credential data is missing from FinTrx_data_CA. Investigate whether it's populated in the US-region FinTrx_data, or if a separate credential enrichment source is needed. CFP status could be a meaningful discriminator if available.
- [ ] **Employment history data quality**: prior_firm_count and tenure_at_firm_years are both non-functional. The employment history CTE may need different join logic for the CA dataset (e.g., relaxing the end_date filter). Career mobility data could improve the model if available.
- [ ] **15.7% CRD loss in FINTRX join**: 57 of 364 labeled advisors (15.7%) didn't match to FinTrx_data_CA. This could introduce bias if the unmatched advisors have systematically different profiles. Worth checking if they match in the US-region dataset.
- [ ] **Large-firm advisors in labeled cohort**: The avg firm_rep_count of 2,340 in the labeled group suggests some $40M–$100M advisors are at large aggregators. The rules-based filter will miss these since they won't be flagged as independent_ria or solo_micro_firm. Consider whether this ~39% (labeled coverage gap) matters for prospecting.

---

## Investigation Validation Summary

| Step | Status | Rows | Key Gate |
|------|--------|------|----------|
| Environment Setup | PASS | — | BQ + prereq table (364 rows) |
| Step 1: Labeled Features | PASS | 307 | 250–400 rows, no dups, 0 null rep count |
| Step 2: Control Features | PASS | 3,442 | 3k–5k rows, 0 overlap with labeled |
| Step 3: Discrimination Ranking | PASS | 20 rows | Both BINARY and CONTINUOUS present |
| Step 4: Divisor Deep Dive | PASS | 2 groups | Both groups present, distributions compared |
| Step 5: Synthesis | COMPLETE | — | Recommendation written with coverage check |

**Overall Status**: COMPLETE
**Primary Finding**: The firm AUM / rep count "divisor proxy" is non-discriminating (Cohen's d = 0.005). Instead, the strongest proxy signals are **license_count** (d=0.70), **firm_hnw_ratio** (d=0.61), **is_portable_custodian** (2.3x lift), and **is_independent_ria** (2.8x lift).
**Recommended Path**: Hybrid — rules-based pre-filter (Relaxed criteria: 60.6% labeled / 25.1% control) + optional ML scoring for prioritization
**Ready for Next Step**: Yes — write TIER_AUM_MID_CANDIDATE SQL and run population sizing
