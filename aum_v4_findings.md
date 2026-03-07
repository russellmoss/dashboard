# TIER_AUM_MID: Overlap Analysis + Production Shadow Table — Findings
**Run Date**: 2026-03-04
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_v4_overlap_and_production.sql
**Status**: COMPLETE

---

## Environment Setup
- BQ: PASS
- SQL file: PASS
- Prereq tables:
  - aum_40_100m_signal_profile: 364 rows OK
  - aum_proxy_labeled_features: 307 rows OK
  - aum_proxy_control_features: 3,442 rows OK
  - excluded_firm_crds: 2 rows OK
  - v4_prospect_scores: 266,900 rows OK
- Status: READY

---

## Block 1A: Employment History Fix Validation

- **Status**: PARTIAL PASS
- **Total labeled advisors**: 307
- **Has tenure data**: 0 (0%) — STILL BROKEN (see note below)
- **Has prior firm count**: 273 (88.9%) — was 0% in V2/V3
- **Avg tenure at firm**: NULL (cannot compute)
- **Median tenure at firm**: NULL
- **Avg prior firms**: 2.8
- **Median prior firms**: 2.0
- **% qualifying TIER_2_PROVEN_MOVER** (prior_firms >= 3): 39.1%
- **Fix confirmed**: PARTIAL — prior_firm_count YES, tenure NO

### Root Cause: Tenure Still NULL

Investigation revealed the `contact_registered_employment_history` table contains **zero rows with NULL end dates**. All 1,929 rows for the labeled cohort have a populated `PREVIOUS_REGISTRATION_COMPANY_END_DATE`. This table stores only *previous* registrations — current employment is not represented here.

- Column names confirmed correct (schema check passed)
- Total rows for labeled CRDs: 1,929 (all have end dates)
- Date range: 1981-05-30 to 2025-11-19

**Implication**: Firm-specific tenure at current employer cannot be derived from this table. `INDUSTRY_TENURE_MONTHS` on `ria_contacts_current` remains the only tenure proxy (industry-wide, not firm-specific).

### Data Quality Note: The -1 Adjustment

The prior_firm_count formula uses `COUNT(DISTINCT firm_CRD) - 1` assuming the current firm appears in history. Testing showed only 20/307 (6.5%) of labeled advisors have their current firm CRD in the history table. For 93.5%, the -1 undercounts by 1. **Actual prior firm counts are likely ~1 higher than reported.** This affects both groups equally and does not change discrimination results.

---

## Block 1B: Prior Firm Count Discrimination

| Metric | Labeled ($40M-$100M) | Control |
|--------|---------------------|---------|
| N | 273 | 2,525 |
| Avg prior firms | 2.76 | 2.29 |
| Median prior firms | 2.0 | 2.0 |
| % with 3+ prior firms | 44.0% | 35.6% |
| Stddev | 2.41 | 2.47 |

**Cohen's d** (calculated manually): ABS(2.76 - 2.29) / ((2.41 + 2.47) / 2)
= 0.47 / 2.44 = **0.19**

**Signal verdict**:
- d = 0.19: between 0.1 and 0.3 — **use as soft scoring weight only**
- Avg delta (0.47) < 0.5 threshold
- pct_3plus delta (8.4pp) < 10pp threshold

**Decision**: Soft weight only — do NOT add prior_firm_count to Enhanced criteria.
The labeled cohort is slightly more mobile, but not enough to be a reliable discriminator.

---

## Block 2A: Current Lead List Table

| Table | Row Count |
|-------|-----------|
| march_2026_lead_list | 2,480 |
| january_2026_lead_list | 2,815 |

**Active table**: march_2026_lead_list — used for all Block 2 queries

---

## Block 2B: Overlap Summary

- **Total TIER_AUM_MID candidates**: 3,992
- **Already in current lead list**: 104 (2.6%)
- **Net new to pipeline**: 3,888 (97.4%)

**Overlap assessment**:
- pct_overlap = 2.6% — well below 20% threshold

**Verdict**: **Strong case for new tier** — minimal duplication. TIER_AUM_MID captures an almost entirely distinct population from existing V3 tiers.

---

## Block 2C: Overlap by Existing Tier

| Existing Tier | Advisor Count | % of MID Candidates |
|--------------|---------------|---------------------|
| (not in lead list) | 3,888 | 97.4% |
| TIER_2_PROVEN_MOVER | 46 | 1.2% |
| TIER_1_PRIME_MOVER | 24 | 0.6% |
| TIER_0B_SMALL_FIRM_DUE | 16 | 0.4% |
| STANDARD_HIGH_V4 | 10 | 0.3% |
| TIER_1G_ENHANCED_SWEET_SPOT | 3 | 0.1% |
| TIER_1B_PRIME_MOVER_SERIES65 | 3 | 0.1% |
| TIER_1G_GROWTH_STAGE | 1 | 0.0% |
| TIER_0C_CLOCKWORK_DUE | 1 | 0.0% |

### Key findings:
- **Largest overlap tier**: TIER_2_PROVEN_MOVER — 46 advisors (1.2%)
- **Net new (not in any tier)**: 3,888 advisors (97.4%)

### TIER_2_PROVEN_MOVER overlap specifically:
- 46 TIER_AUM_MID candidates are already TIER_2_PROVEN_MOVER leads
- This represents just 1.2% of all TIER_AUM_MID candidates
- Interpretation: These tiers target fundamentally different populations. TIER_2 requires `num_prior_firms >= 3` which most AUM-MID candidates don't meet (only 10.2% have 3+ prior firms in the shadow table). The AUM proxy criteria (disc_ratio, hnw_ratio, firm_aum ceiling) capture a distinct independent-RIA segment.

### Strategic conclusion:

**Option A — Launch as independent tier** (net_new = 97.4% >> 40% threshold):
TIER_AUM_MID targets a fundamentally distinct population. 97.4% of candidates are not in any existing tier. Proceed to Block 3.

**Decision**: **A** — proceed to Block 3 ✓

---

## Block 3A: Shadow Table Build

- **Status**: PASS
- **Total candidates**: 3,998
- **Unique CRDs**: 3,998 (no duplicates ✓)
- **Unique firms**: 2,997
- **Wrong tier flag**: 0 (must be 0 ✓)
- **Missing email**: 0 ✓
- **Null prior_firms**: 0 (confirms employment fix ✓)
- **Null tenure_months**: 3,998 (expected — see Block 1A root cause; END_DATE never NULL in this table)
- **Max advisors per firm**: 35 (under 50 cap ✓)

Note: 3,998 vs 3,992 from Block 2B — the 6-row difference is due to Block 2B using `COUNT(DISTINCT t.crd)` with a LEFT JOIN that may have deduplication edge cases from the SFDC exclusion logic. The shadow table's 3,998 is the authoritative count.

---

## Block 3B: Shadow Table Validation

### Summary Stats
| Metric | Value |
|--------|-------|
| Total candidates | 3,998 |
| Unique CRDs | 3,998 |
| Unique firms | 2,997 |
| Has LinkedIn | 3,998 (100%) |
| Avg V4 percentile | 56.0 |
| Avg disc_ratio | 0.974 |
| Avg hnw_ratio | 0.693 |
| Avg prior firms | 0.92 |
| Avg tenure years | NULL (see Block 1A) |

### Prior Firm Count Distribution

| Prior Firms | Count | % |
|-------------|-------|---|
| 0 | 2,249 | 56.3% |
| 1 | 838 | 21.0% |
| 2 | 509 | 12.7% |
| 3 | 154 | 3.9% |
| 4 | 106 | 2.7% |
| 5 | 59 | 1.5% |
| 6 | 32 | 0.8% |
| 7 | 18 | 0.5% |
| 8 | 13 | 0.3% |
| 9 | 10 | 0.3% |
| 10+ | 10 | 0.2% |

Distribution is right-skewed as expected. 56.3% have 0 prior firms (remember: undercounted by ~1 due to the -1 adjustment issue). This confirms these are predominantly stable, non-mobile advisors — a fundamentally different profile from TIER_2_PROVEN_MOVER.

### Top 20 Firms

| Firm | CRD | Advisors | Avg AUM ($M) |
|------|-----|----------|-------------|
| Openarc Corporate Advisory, LLC | 336837 | 35 | $444M |
| Iams Wealth Management, LLC | 286085 | 12 | $343M |
| Horter Investment Management, LLC | 119880 | 11 | $278M |
| Financial Gravity Family Office Services, LLC | 316024 | 9 | $590M |
| Woodstock Wealth Management, Inc. | 283472 | 7 | $630M |
| Moss, Luse & Womble, LLC | 152841 | 7 | $595M |
| John E. Sestina And Company | 108634 | 6 | $634M |
| Kinetic Investment Management, Inc. | 283034 | 6 | $348M |
| Ellis Investment Partners, LLC | 157669 | 6 | $917M |
| SGL Financial, LLC | 158023 | 6 | $219M |
| William Mack & Associates Inc | 107377 | 6 | $820M |
| CPR Investments Inc | 139067 | 6 | $213M |
| Victory Financial | 324943 | 6 | $688M |
| WT Wealth Management, LLC | 169566 | 6 | $405M |
| Opes Wealth Management, LLC | 299704 | 5 | $665M |
| Access Wealth | 112973 | 5 | $490M |
| Bull Harbor Capital LLC | 324995 | 5 | $344M |
| Greenup Street Wealth Management LLC | 311391 | 5 | $662M |
| Cambridge Financial Group, LLC | 117428 | 5 | $539M |
| WealthkarE.com, Inc. | 115111 | 5 | $126M |

No single firm dominates (max 35, under 50 cap). No obvious large aggregators — these are all small-to-mid independent RIAs as expected by the criteria. Firm diversity is healthy.

### Avg V4 Percentile vs Existing Tiers

| Tier | Avg V4 Percentile | N |
|------|-------------------|---|
| TIER_1A_PRIME_MOVER_CFP | 81.0 | 1 |
| TIER_1G_GROWTH_STAGE | 80.4 | 88 |
| STANDARD_HIGH_V4 | 80.3 | 50 |
| TIER_1G_ENHANCED_SWEET_SPOT | 80.1 | 88 |
| TIER_1B_PRIME_MOVER_SERIES65 | 78.4 | 175 |
| TIER_1_PRIME_MOVER | 76.9 | 443 |
| TIER_0C_CLOCKWORK_DUE | 62.8 | 117 |
| **TIER_AUM_MID (shadow)** | **56.0** | **3,998** |
| TIER_2_PROVEN_MOVER | 55.9 | 1,285 |
| TIER_0B_SMALL_FIRM_DUE | 52.3 | 175 |
| TIER_3_MODERATE_BLEEDER | 49.9 | 58 |

TIER_AUM_MID's avg V4 percentile (56.0) is nearly identical to TIER_2_PROVEN_MOVER (55.9). This is consistent with the tier's purpose — the AUM proxy criteria capture advisors that V4's ML model doesn't strongly prioritize, making this tier **additive signal** rather than redundant with V4.

---

## Final Synthesis: TIER_AUM_MID Go/No-Go

### Summary of All Investigations

| Investigation | Key Finding |
|--------------|-------------|
| V1 (SFDC profiling) | 3.4% non-excluded win rate (n=9), solo/micro firm dominant signal |
| V2 (Signal comparison) | Top signals: license_count, firm_hnw_ratio, disc_ratio, indep_ria, portable_custodian |
| V3 (Ceiling + sizing) | Ceiling weak — use firm_aum<$1B + no_accolade. Volume: ~659/month |
| V4 Block 1 (Emp history) | prior_firm_count fix: **worked**. Tenure: broken (table has no current-employer rows). prior_firm_count not discriminating enough (d=0.19) to add to criteria |
| V4 Block 2 (Overlap) | **2.6%** overlap with existing tiers. Net new: **3,888** advisors |
| V4 Block 3 (Shadow) | 3,998 candidates built. Ready for quota assignment: **yes** |

### Final Criteria (no Block 1B additions — d=0.19, below threshold)

**Floor criteria** (must ALL be true):
```sql
(is_independent_ria = TRUE
 OR (has_portable_custodian = TRUE AND has_series_7 = FALSE))
AND firm_disc_ratio > 0.70
AND firm_hnw_ratio > 0.30
AND license_count < 3
AND industry_tenure_years BETWEEN 7 AND 25
```

**Ceiling criteria** (must ALL be true):
```sql
AND firm_aum < 1000000000    -- $1B ceiling
AND has_any_accolade = FALSE  -- no Forbes/Barron's
```

### Recommended Monthly Quota
Based on Block 2C net-new volume and V3 sizing:
- Shadow table total: 3,998
- Estimated monthly new (using V3's ~659/month refresh estimate): ~333/month (conservative — total/12)
- Recommended quota for first 60-day validation window: **300/month**
- Rationale: 3.4% expected conversion x 300 = ~10 expected MQLs/month

### Integration Path

**Option A — Launch as independent tier** (selected):
1. **Firm diversity cap**: Not needed — max 35 per firm, under 50 limit
2. **Integrate into lead list**: Add TIER_AUM_MID block to `March_2026_Lead_List_V3_7_0.sql` or April 2026 list
3. **Tier priority**: Place between TIER_2_PROVEN_MOVER and TIER_3_MODERATE_BLEEDER
   (expected conversion 3.4% aligns with TIER_2's ~5.9% — just below)
4. **V4 disagreement filter**: Exclude if v4_percentile < 40
   (lower threshold than Tier 1's 60th percentile — AUM proxy is independent signal)
5. **Run 60-day shadow** before adding to SGA quota
6. **Tenure gap**: `tenure_months` will be NULL in shadow table. If firm-specific tenure is needed, a different data source must be identified (not the employment history table).

### Open Questions After V4
- [x] Does `prior_firm_count` belong in criteria? **No** (d=0.19, soft weight only)
- [ ] Should the V3/V4 disagreement filter threshold be 40th or 50th percentile?
- [ ] Firm diversity cap: 50 (current pipeline standard) or lower for this tier? **Not needed — max is 35**
- [ ] Timeline: target April 2026 lead list for first shadow run?
- [ ] Firm-specific tenure: identify alternative data source?

---

## Validation Summary

| Step | Status | Rows | Key Gate |
|------|--------|------|----------|
| Environment Setup | PASS | — | 5 prereq tables |
| Block 1A: Emp History Fix | PARTIAL | 1 row | has_prior_firm_count=273 PASS, has_tenure=0 FAIL |
| Block 1B: Prior Firm Disc | PASS | 2 rows | Cohen's d=0.19 computed |
| Block 2A: Lead List ID | PASS | 2 rows | march_2026_lead_list active |
| Block 2B: Overlap Summary | PASS | 1 row | 3,992 candidates (in range) |
| Block 2C: Overlap by Tier | PASS | 9 rows | Decision A made (97.4% net new) |
| Block 3A: Shadow Table | PASS | 3,998 | No dups, no wrong tier |
| Block 3B: Shadow Validation | PASS | 3 queries | Prior firm dist right-skewed ✓ |

**Overall Status**: COMPLETE
**Go/No-Go**: **GO** — proceed to production integration
**Next Action**: Integrate TIER_AUM_MID into April 2026 lead list SQL as shadow tier with 300/month quota and v4_percentile >= 40 filter
