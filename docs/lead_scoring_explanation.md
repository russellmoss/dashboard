# Lead Scoring System Explanation

**Version**: V3.6.1 + V4.2.0 Hybrid
**Last Updated**: February 2026
**Purpose**: Documentation for understanding, debugging, and refining lead scoring to maximize contacting-to-MQL conversion rate

---

## Table of Contents

1. [System Overview](#system-overview)
2. [The Hybrid Approach: V3 Rules + V4 ML](#the-hybrid-approach-v3-rules--v4-ml)
3. [Tier Definitions and Statistical Validation](#tier-definitions-and-statistical-validation)
4. [Why ML is Used for Deprioritization, Not Prioritization](#why-ml-is-used-for-deprioritization-not-prioritization)
5. [Lead List Generation Process](#lead-list-generation-process)
6. [Exclusions and Filters](#exclusions-and-filters)
7. [Key Metrics and Monitoring](#key-metrics-and-monitoring)

---

## System Overview

The lead scoring system uses a **hybrid approach** combining:

1. **V3 Rules-Based Tiers**: Human-interpretable rules that identify high-converting advisor profiles based on validated behavioral patterns
2. **V4 XGBoost ML Model**: Machine learning model that identifies low-converting leads for deprioritization (exclusion from lead lists)

**Baseline Conversion Rate**: 3.82% (STANDARD tier leads)

The goal is to maximize the contacting-to-MQL (Marketing Qualified Lead) conversion rate by:
- **Prioritizing** leads with characteristics proven to convert at above-baseline rates (V3 tiers)
- **Deprioritizing** leads the ML model predicts will convert poorly (V4 bottom 20%)

---

## The Hybrid Approach: V3 Rules + V4 ML

### Why Not Pure ML?

Early testing revealed that **V3 rules outperform V4 ML for prioritization** (top decile identification):

| Metric | V3 Rules | V4 ML | Winner |
|--------|----------|-------|--------|
| Top Decile Lift | **1.74x** | 1.51x | V3 |
| Bottom 20% Detection | N/A | **0.31x** | V4 |
| Interpretability | High | Low | V3 |

**Key insight**: Rules-based scoring works better for prioritization because:
- Domain expertise is directly encoded (e.g., "advisors at bleeding firms are looking to move")
- Conversion patterns are highly interpretable and actionable for SDRs
- Sample sizes for rule validation are transparent

### Why Use ML for Deprioritization?

V4 ML excels at identifying leads to **exclude**:

| V4 Percentile | Conversion Rate | Lift vs Baseline |
|---------------|-----------------|------------------|
| Bottom 20% | 1.21% | 0.31x |
| 20th-80th | ~3.5% | ~0.92x |
| Top 20% | ~4.5% | ~1.18x |

**Business Impact**:
- Skip bottom 20% of leads = lose only 8.3% of conversions
- **11.7% efficiency gain** by not contacting low-converting leads

### How the Hybrid Works in Practice

```
Lead Scoring Pipeline:
1. V3 Rules  --> Assign Tier (TIER_0A, TIER_1A, etc.)
2. V4 Score  --> Assign Percentile (1-100)
3. Filtering:
   - V4 bottom 20% --> EXCLUDED (unless V3 tier is high-priority)
   - V3/V4 Disagreement Filter --> Tier 1 leads with V4 < 60th percentile excluded
4. Final List --> Tiered leads with V4 >= 20th percentile
```

---

## Tier Definitions and Statistical Validation

### Tier 0: Career Clock Tiers (Highest Priority)

These tiers identify advisors with **predictable career patterns** who are currently in their "move window" - the optimal time to contact them based on their historical tenure patterns.

| Tier | Description | Conversion Rate | Lift | Sample Size | Confidence |
|------|-------------|-----------------|------|-------------|------------|
| **TIER_0A_PRIME_MOVER_DUE** | Prime Mover + In Move Window | 16.67% | 5.89x | 12 leads | Low (wide CI: 0%-37%) |
| **TIER_0B_SMALL_FIRM_DUE** | Small Firm + In Move Window | 33.33% | 5.64x | 12 leads | **Significant** (CI: 6.66%-60.01% above baseline) |
| **TIER_0C_CLOCKWORK_DUE** | Any Predictable Advisor in Window | 9.52% | 4.29x | 84 leads | Medium (CI: 3.25%-15.80%) |

**Career Clock Methodology**:
- Uses advisor employment history to detect predictable career patterns
- `tenure_cv < 0.5` = Predictable pattern (Clockwork or Semi-Predictable)
- `In_Window` = 70-130% through typical tenure cycle
- Independent from age (correlation = 0.035)

**Statistical Note on TIER_0B**: Despite small sample size (12 leads), TIER_0B is statistically validated:
- 95% CI lower bound (6.66%) is **1.78x above baseline (3.75%)**
- Even worst-case scenario significantly outperforms baseline
- Need 25-50 leads for more precise estimates

### Tier 1: Prime Mover Tiers

These tiers identify advisors showing multiple signals of readiness to move.

| Tier | Description | Conversion Rate | Lift | Sample Size | Confidence |
|------|-------------|-----------------|------|-------------|------------|
| **TIER_1B_PRIME_ZERO_FRICTION** | Series 65 + Portable Custodian + Small Firm + Bleeding + No CFP | 13.64% | 3.57x | 22 leads | Low |
| **TIER_1A_PRIME_MOVER_CFP** | CFP holder at bleeding firm, 1-4yr tenure, 5+yr experience | 10.00% | 2.62x | 73 leads | Medium |
| **TIER_1G_ENHANCED_SWEET_SPOT** | Growth stage (5-15yr exp) + AUM $500K-$2M + stable firm | 9.09% | 2.38x | 66 leads | Medium |
| **TIER_1B_PRIME_MOVER_SERIES65** | Fee-only RIA (Series 65 only) meeting Prime Mover criteria | 5.49% | 1.44x | 91 leads | Medium |
| **TIER_1G_GROWTH_STAGE** | Growth stage outside AUM sweet spot | 5.08% | 1.33x | 59 leads | Medium |
| **TIER_1_PRIME_MOVER** | Mid-career (1-4yr tenure, 5-15yr exp) at small/unstable firm | 7.10% | 1.86x | 176 leads | High |
| **TIER_1F_HV_WEALTH_BLEEDER** | High-value wealth title at bleeding firm | 6.50% | 1.70x | 266 leads | High |

**Zero Friction Bleeder (T1B_PRIME) Explanation**:
This tier combines all friction-reducing factors:
- **Series 65 Only**: No broker-dealer ties (easier transition)
- **Portable Custodian**: Schwab/Fidelity/Pershing (book moves with advisor)
- **Small Firm**: <= 10 reps (less bureaucracy)
- **Bleeding**: Net loss of advisors (others already leaving)
- **No CFP**: CFP leads go to T1A (separate tier)

**Key Insight**: Matrix effects create multiplicative lift - all friction reducers combined = 13.64% conversion.

### Tier 2-3: Behavioral Signal Tiers

| Tier | Description | Conversion Rate | Lift | Sample Size | Confidence |
|------|-------------|-----------------|------|-------------|------------|
| **TIER_2_PROVEN_MOVER** | 3+ prior firms, 5+yr experience | 5.20% | 1.36x | 402 leads | High |
| **TIER_3_MODERATE_BLEEDER** | Experienced advisor at firm losing 1-10 reps | 4.40% | 1.15x | 274 leads | High |

### M&A Tiers (Event-Driven)

These tiers target advisors at firms undergoing merger/acquisition activity.

| Tier | Description | Conversion Rate | Lift | Sample Size | Confidence |
|------|-------------|-----------------|------|-------------|------------|
| **TIER_MA_ACTIVE_PRIME** | Senior/mid-career at M&A target | 9.00% | 2.36x | 847 leads | High |
| **TIER_MA_ACTIVE** | Any advisor at M&A target | 5.40% | 1.41x | 1,103 leads | High |

**M&A Window**: 60-365 days after M&A announcement. M&A creates uncertainty about future platform, compensation, and culture.

### Excluded Tiers (Below Baseline)

These tiers were tested but excluded because they convert at or below baseline:

| Tier | Conversion Rate | Lift | Reason for Exclusion |
|------|-----------------|------|---------------------|
| TIER_4_EXPERIENCED_MOVER | 2.74% | 0.72x | Below baseline |
| TIER_5_HEAVY_BLEEDER | 3.27% | 0.86x | Below baseline (best advisors already left) |
| TIER_NURTURE_TOO_EARLY | 3.72% | 0.97x | Below baseline (advisors not ready) |

### Nurture Tier

| Tier | Description | Conversion Rate | Lift | Action |
|------|-------------|-----------------|------|--------|
| **TIER_NURTURE_TOO_EARLY** | Predictable pattern but <70% through cycle | 3.72% | 0.97x | Excluded from active list, add to nurture sequence |

### STANDARD Tier

| Tier | Description | Conversion Rate | Lift |
|------|-------------|-----------------|------|
| **STANDARD** | All other leads | 3.82% | 1.00x (baseline) |

---

## Why ML is Used for Deprioritization, Not Prioritization

### The Core Finding

After extensive testing, we discovered a fundamental asymmetry:

| Task | Best Approach | Performance |
|------|---------------|-------------|
| **Prioritization** (finding best leads) | V3 Rules | 1.74x top decile lift |
| **Deprioritization** (finding worst leads) | V4 ML | 0.31x bottom 20% lift |

### Why Rules Beat ML for Prioritization

1. **Domain Expertise Matters**:
   - Human-crafted rules encode proven behavioral patterns (e.g., "mid-career advisors at bleeding firms are more likely to move")
   - ML models can find spurious correlations that don't generalize

2. **Interpretability**:
   - SDRs can understand and act on rule-based narratives
   - "This advisor is at a firm that lost 5 reps" is actionable
   - "V4 score: 0.72" is not actionable without context

3. **Transparent Validation**:
   - Each rule has explicit sample size and confidence interval
   - ML feature importance is harder to interpret and validate

4. **Low Event Rate**:
   - ~3.8% baseline conversion rate limits ML predictive power
   - Rules can leverage domain knowledge despite sparse positive examples

### Why ML Excels at Deprioritization

1. **Capturing Complex Negative Patterns**:
   - ML can identify subtle combinations of features that predict low conversion
   - Many factors (large firm + long tenure + no mobility) combine to signal "won't move"

2. **Efficiency Gain**:
   - Skipping 20% of leads loses only 8.3% of conversions
   - SDR time is expensive; avoiding wasted calls is valuable

3. **Complementary to Rules**:
   - Rules miss some low-converting leads that ML catches
   - ML catches leads that pass rule filters but still won't convert

### The V3/V4 Disagreement Filter

For Tier 1 leads (high-priority rule matches), we apply an additional filter:

```
If V3_Tier IN (Tier 1 variants) AND V4_Percentile < 60:
    EXCLUDE (likely false positive in V3)
```

**Rationale**: When V3 rules say "high priority" but V4 ML says "low probability", the lead may be a false positive - matching rules but lacking underlying conversion signals.

---

## Lead List Generation Process

### February 2026 Lead List Example

The lead list generation follows this process (from `February_2026_Lead_List_V3_V4_Hybrid.sql`):

#### Step 1: Define Active SGAs
```sql
-- Get active Sales Growth Advisors (15 SGAs x 200 leads = 3,000 total)
active_sgas AS (
    SELECT Id, Name, ROW_NUMBER() as sga_number
    FROM SavvyGTMData.User
    WHERE IsActive = true AND IsSGA__c = true
)
```

#### Step 2: Apply Exclusions
- **Firm Exclusions**: Partner firms (Ritholtz), internal firms (Savvy)
- **Age Exclusions**: 70+ (converts at 1.48%, 0.41x baseline)
- **Disclosure Exclusions**: Criminal, regulatory, termination, investigation (compliance risk)
- **Title Exclusions**: Paraplanners, assistants, operations, compliance, insurance agents
- **Recent Promotee Exclusions**: <5yr tenure + mid/senior title (no portable book yet)

#### Step 3: Enrich with Features
- Advisor employment history (moves, industry tenure)
- Firm metrics (headcount, departures, arrivals, turnover)
- Certifications (CFP, CFA, Series 65/7)
- Career Clock stats (tenure CV, cycle position)

#### Step 4: Apply V4 Deprioritization Filter
```sql
-- Exclude bottom 20% of V4 scores
WHERE v4_percentile >= 20 OR v4_percentile IS NULL
```

#### Step 5: Assign V3 Tiers
- Evaluate each lead against tier criteria in priority order
- Assign highest-matching tier
- Calculate expected conversion rate

#### Step 6: Apply V3/V4 Disagreement Filter
```sql
-- Exclude Tier 1 leads where V4 < 60th percentile
WHERE NOT (
    score_tier IN ('TIER_1A_PRIME_MOVER_CFP', 'TIER_1B_PRIME_ZERO_FRICTION', ...)
    AND v4_percentile < 60
)
```

#### Step 7: Apply Tier Quotas
Dynamic quotas based on SGA count, e.g., for 15 SGAs:
- TIER_0A: 100 * 15/12 = 125 leads
- TIER_0C: 200 * 15/12 = 250 leads
- TIER_1_PRIME_MOVER: 300 * 15/12 = 375 leads
- STANDARD_HIGH_V4: 1500 * 15/12 = 1875 leads (backfill)

#### Step 8: SGA Assignment
- Stratified round-robin distribution by conversion rate bucket
- Partner/Founder leads grouped to same SGA (prevent multiple outreach to same firm leadership)
- Each SGA receives exactly 200 leads

#### Step 9: Generate Narratives
For each lead, generate human-readable narrative explaining why they're prioritized:

```
"CAREER CLOCK + PRIME MOVER: John matches Prime Mover criteria AND
has a predictable career pattern showing they are in their 'move window'
(85% through typical tenure). Career Clock + Prime Mover leads convert
at 5.59% (2.43x vs advisors with no pattern). Firm has lost 5 advisors."
```

---

## Exclusions and Filters

### Firm-Level Exclusions

| Exclusion | Rationale | Impact |
|-----------|-----------|--------|
| Large firms (>50 reps) | Convert at 0.60x baseline | ~30% of prospects |
| Partner firms | Internal/partner relationships | Specific CRDs |
| Low discretionary AUM (<50%) | Non-portable books | ~7% of prospects |
| Wirehouses | Cannot move books easily | Pattern match |

### Advisor-Level Exclusions

| Exclusion | Rationale | Impact |
|-----------|-----------|--------|
| Age 70+ | 1.48% conversion (0.41x baseline) | ~5% of prospects |
| Disclosures (criminal, regulatory, termination) | Compliance/reputational risk | ~10% of prospects |
| Support titles (paraplanner, assistant, operations) | No client book | ~8.5% of prospects |
| Recent promotees (<5yr + senior title) | No portable book yet | ~1,915 leads |

### ML-Based Exclusions

| Filter | Threshold | Rationale | Impact |
|--------|-----------|-----------|--------|
| V4 Bottom 20% | v4_percentile < 20 | 0.31x lift | 20% of prospects |
| V3/V4 Disagreement | Tier 1 + V4 < 60 | False positive detection | ~5% of Tier 1 |

---

## Key Metrics and Monitoring

### Conversion Metrics

| Metric | Current | Target | Notes |
|--------|---------|--------|-------|
| Baseline Conversion | 3.82% | - | STANDARD tier |
| Weighted List Conversion | ~5.5% | >5% | Blended across tiers |
| Top Tier Conversion | 10-15% | >8% | T0A/T0B/T1B_PRIME |

### Sample Size Guidelines

| Confidence Level | Minimum Sample | Margin of Error |
|-----------------|----------------|-----------------|
| High | >= 1,000 leads | +/- 5% |
| Medium | >= 300 leads | +/- 10% |
| Low | >= 100 leads | +/- 10% |
| Very Low | >= 30 leads | +/- 18% |
| Insufficient | < 30 leads | Too wide to be useful |

### Tier Performance Monitoring

Run `tier_confidence_analysis.sql` quarterly to:
1. Calculate confidence intervals for each tier
2. Identify tiers with statistical significance issues
3. Track tier stability across time periods
4. Update tier definitions based on new data

### V4 Model Monitoring

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Bottom 20% Conversion | > 2% | Investigate model drift |
| Feature Distribution Shift | > 20% | Consider retraining |
| AUC-ROC | < 0.60 | Retrain model |

### Monthly Review Checklist

- [ ] Verify tier conversion rates match expectations
- [ ] Check V4 deprioritization effectiveness
- [ ] Review excluded lead counts
- [ ] Validate SGA distribution equity
- [ ] Update M&A target list if needed

---

## Appendix A: V4 Model Features (23 Features)

| Rank | Feature | Type | Description |
|------|---------|------|-------------|
| 1 | has_email | Boolean | Contact availability |
| 2 | firm_rep_count_at_contact | Integer | Firm size |
| 3 | mobility_tier | Categorical | Stable/Low/High |
| 4 | firm_net_change_12mo | Integer | Arrivals - departures |
| 5 | tenure_bucket | Categorical | Tenure range |
| 6 | is_wirehouse | Boolean | Wirehouse flag |
| 7 | firm_stability_tier | Categorical | Bleeding/Stable/Growing |
| 8 | experience_bucket | Categorical | Experience range |
| 9 | has_linkedin | Boolean | LinkedIn presence |
| 10 | is_broker_protocol | Boolean | Broker protocol firm |
| ... | ... | ... | ... |
| 23 | age_bucket_encoded | Integer | Age range (0-4) |

### Career Clock Features (7 features, included in V4.2.0)

| Feature | Type | Description |
|---------|------|-------------|
| cc_tenure_cv | Float | Coefficient of variation of tenure lengths |
| cc_pct_through_cycle | Float | Percent through typical tenure cycle |
| cc_is_clockwork | Boolean | Highly predictable pattern (CV < 0.3) |
| cc_is_in_move_window | Boolean | 70-130% through cycle |
| cc_is_too_early | Boolean | < 70% through cycle |
| cc_months_until_window | Integer | Months until move window |
| cc_completed_jobs | Integer | Count of completed employment records |

---

## Appendix B: Historical Tier Statistics

From training data (2024-02 to 2025-10):

| Tier | Lead Count | Conversions | Conversion Rate | Actual Lift |
|------|------------|-------------|-----------------|-------------|
| TIER_1_PRIME_MOVER | 176 | 25 | 14.20% | 4.05x |
| TIER_3_EXPERIENCED_MOVER | 402 | 42 | 10.45% | 2.98x |
| TIER_4_HEAVY_BLEEDER | 1,128 | 92 | 8.16% | 2.32x |
| TIER_2_MODERATE_BLEEDER | 274 | 22 | 8.03% | 2.29x |
| STANDARD | 37,468 | 1,314 | 3.51% | 1.00x |

---

## Appendix C: Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| V3.6.1 | Jan 2026 | Added recent promotee exclusion |
| V3.6.0 | Jan 2026 | Added Career Clock tiers (TIER_0A/0B/0C) |
| V3.5.2 | Jan 2026 | Added disclosure exclusions |
| V3.5.1 | Jan 2026 | Changed age exclusion from 65+ to 70+ |
| V3.5.0 | Jan 2026 | Added M&A tiers |
| V3.3.3 | Dec 2025 | Added TIER_1B_PRIME_ZERO_FRICTION, TIER_1G_ENHANCED |
| V4.2.0 | Jan 2026 | Added age_bucket_encoded feature (+12.3% top decile lift) |
| V4.1.0 | Dec 2025 | Baseline V4 model (22 features) |

---

## Appendix D: Debugging Common Issues

### Low Conversion Rate This Month

1. **Check tier distribution**: Are we getting enough high-tier leads?
2. **Check V4 filter**: Is the 20th percentile threshold too aggressive?
3. **Check exclusions**: Have new exclusions removed high-converting leads?
4. **Check M&A list**: Is it up-to-date with current M&A activity?

### Tier Converting Below Expected

1. **Check sample size**: Is the sample large enough for statistical significance?
2. **Check time period**: Are we in a seasonally low period?
3. **Check data quality**: Are features being calculated correctly?
4. **Consider retraining**: Has the advisor market changed?

### V4 Deprioritizing Too Many Leads

1. **Check V4 percentile distribution**: Should be uniform 1-100
2. **Check model drift**: Compare current feature distributions to training
3. **Verify scoring pipeline**: Are features calculated correctly?

---

*Document maintained by Lead Scoring Team. For questions, contact the data science team.*
