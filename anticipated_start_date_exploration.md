# Anticipated Start Date — Forecast Impact Analysis

> **Purpose:** The preliminary exploration of `OpportunityFieldHistory` revealed that recruiter anticipated dates are NOT the stable input the Phase 7.1 research assumed. 57% of deals revise the date, 92% of revisions push it later, and the median per-change shift is 25 days. The average total drift from first-set to final value is 45 days (P90: 143 days).
>
> This document investigates the specific impact on our forecast model and determines what changes are needed before shipping the enhanced model.
>
> **Last updated:** 2026-03-24
>
> **Key finding already established:** Phase 7.1 found "+2 days average slip" — but that measured FINAL anticipated date vs actual join date. The real question is: how far off was the FIRST anticipated date?

---

## What We Already Know (From Preliminary Exploration)

Do NOT re-query these — they're established facts:

- **743 change records** across **292 opportunities** for `Earliest_Anticipated_Start_Date__c`
- **57% of opps with an anticipated date have changed it at least once**
- **92% of non-initial changes push the date later** (408 pushed later vs 37 pulled earlier)
- **Median per-change shift: 25 days.** Average: 31 days.
- **Average total drift (first→final): 45 days.** Median: 7 days. P90: 143 days.
- **Serial pushers (5+ changes, all later): 32 opps (19% of multi-change opps)**
- **Revision count and outcome:** 2-3 changes has the highest join rate (38.6%). 1 change has the lowest (18.3%). 4+ drops to 25.0%.
- **Field name in history table:** `Earliest_Anticipated_Start_Date__c`
- **DataType:** `DateOnly`
- **Date values are stored as strings** in `OldValue`/`NewValue`

---

## Rules for Claude Code

1. **Run one phase at a time.** Complete all steps, write results, save, STOP.
2. **Do not re-query anything from the "What We Already Know" section above.**
3. **Standard Joined deal filters:** `SQO_raw = 'Yes'`, `is_primary_opp_record = 1`, `recordtypeid = '012Dn000000mrO3IAI'`, deal actually Joined (`StageName = 'Joined'` or `advisor_join_date__c IS NOT NULL`, excluding `Closed Lost`).
4. **Standard open pipeline filters:** `SQO_raw = 'Yes'`, `StageName NOT IN ('On Hold', 'Closed Lost', 'Joined')`, `Full_Opportunity_ID__c IS NOT NULL`, `is_sqo_unique = 1`, `recordtypeid = '012Dn000000mrO3IAI'`.
5. **Date parsing:** Use `SAFE_CAST(value AS DATE)` or `SAFE.PARSE_DATE('%Y-%m-%d', value)` for OldValue/NewValue. Handle NULLs.
6. **Join key:** `OpportunityFieldHistory.OpportunityId = vw_funnel_master.Full_Opportunity_ID__c`

---

## Phase 1: First-Date Slip for Joined Deals — The Real Accuracy

The preliminary exploration showed drift across ALL opps. We need to isolate the deals that actually Joined to understand what the first anticipated date told us about when they'd actually close.

### 1.1 Reconstruct first and final anticipated dates for Joined deals

For each Joined deal that has field history for `Earliest_Anticipated_Start_Date__c`:

1. **First anticipated date:** From the earliest history record (lowest `CreatedDate`) for that deal — use `OldValue` if it's not NULL (that was the value before the first tracked change), otherwise use `NewValue` (the first value set).
2. **Final anticipated date:** The current `Earliest_Anticipated_Start_Date__c` from `vw_funnel_master` (this is more reliable than the last history record, since the field may have been set before history tracking was enabled).
3. **Actual join date:** `advisor_join_date__c` from `vw_funnel_master`.

Compute per deal:
- `first_slip_days = DATE_DIFF(DATE(advisor_join_date__c), first_anticipated_date, DAY)` — positive = actual joined LATER than first estimate
- `final_slip_days = DATE_DIFF(DATE(advisor_join_date__c), DATE(Earliest_Anticipated_Start_Date__c), DAY)` — should match Phase 7.1 (~+2 days)
- `total_revision_days = DATE_DIFF(DATE(Earliest_Anticipated_Start_Date__c), first_anticipated_date, DAY)` — positive = date was pushed out
- `revision_count` = number of history records for that deal on this field

Show summary statistics:

| Metric | First→Actual Slip | Final→Actual Slip | Total Revision (First→Final) |
|--------|-------------------|-------------------|------------------------------|
| N | 49 | 49 | 49 |
| Average days | **+18.3** | +1.1 | +17.2 |
| Median days | **+7** | 0 | +6 |
| P25 | 0 | 0 | 0 |
| P75 | +31 | 0 | +22 |
| P90 | **+69** | +1 | +69 |
| Min | -63 | 0 | -63 |
| Max | **+133** | +39 | +133 |
| % late (positive) | **65.3%** | 12.2% | 61.2% |

**Results:**

49 Joined deals had both field history for `Earliest_Anticipated_Start_Date__c` and a valid `advisor_join_date__c`. The first anticipated date overshoots by an average of **+18.3 days** (median +7), meaning the actual join date is almost always later than what was first estimated. By contrast, the final anticipated date (after all revisions) overshoots by only +1.1 days (median 0) — confirming the Phase 7.1 finding. The gap between these two numbers is the total revision: recruiters push the date out by an average of 17.2 days before the deal closes, making the final date look accurate only because it was chased to match reality.

65% of first estimates are late (actual join date came after the first anticipated date). Only 12% of final estimates are late — the revisions absorb the slippage.

---

### 1.2 First-date slip distribution (compare against Phase 7.1)

Bucket the `first_slip_days` into the same categories Phase 7.1 used, and show them side by side:

| Bucket | First Date → Actual (NEW) | Final Date → Actual (Phase 7.1) |
|--------|---------------------------|--------------------------------|
| >30 days early | 2.0% | 0% |
| 1-30 days early | 14.3% | 5.3% |
| On time (0 days) | **18.4%** | **73.3%** |
| 1-30 days late | **38.8%** | 18.7% |
| 31-60 days late | **14.3%** | 2.7% |
| 61-90 days late | **6.1%** | 0% |
| 90+ days late | **6.1%** | 0% |

**Results:**

The contrast is stark. Phase 7.1 reported 73.3% of deals joined on the exact anticipated date — but that's the **final** anticipated date, after all revisions. Looking at the **first** anticipated date:

- Only **18.4%** of deals joined on the date originally set (vs 73.3% for the final date)
- **65.3%** of deals joined LATER than the first estimate (vs 21.4% for the final date)
- **26.5%** of deals joined 31+ days late relative to the first estimate (vs 2.7% for the final date)
- **12.2%** joined 61+ days late — a group that didn't exist in the Phase 7.1 final-date analysis

The first anticipated date is a meaningfully different (and worse) predictor than the final date. The "+2 days average slip" from Phase 7.1 only holds because recruiters iteratively revised the date to track reality.

---

### 1.3 First-date slip by revision count

Split the first-date slip by how many times the date was revised. This tells us whether serial revisers have dramatically worse first-date accuracy.

| Revisions | N (Joined) | Avg First→Actual Slip | Median First Slip | Avg Final→Actual Slip | Avg Days Pushed Out |
|-----------|-----------|----------------------|-------------------|----------------------|---------------------|
| 1 (set once) | 11 | +8.5 | 0 | +3.5 | +5.0 |
| 2 | 14 | +10.7 | +7 | +0.4 | +10.3 |
| 3 | 14 | +17.7 | +9 | +0.6 | +17.1 |
| 4+ | 10 | **+40.7** | **+32** | +0.2 | **+40.5** |

**Results:**

The revision count is a strong predictor of first-date inaccuracy:

- **Set once (1 change):** Average first-date slip of +8.5 days. These are the most accurate first estimates — but note the final slip is still +3.5 days, meaning even the "stable" dates overshoot slightly.
- **2 revisions:** +10.7 days first slip. The 10.3 days pushed out almost exactly accounts for the gap between first and final slip.
- **3 revisions:** +17.7 days first slip. The pattern continues — each revision adds ~7-10 days of correction.
- **4+ revisions:** **+40.7 days first slip (median +32)**. These serial revisers' first estimates are off by over a month. Yet their final-date slip is only +0.2 days — by the time they're done revising, they've chased the actual date almost perfectly.

The takeaway: the final-date accuracy (+0.2 to +3.5 days) is roughly equal regardless of revision count. The revision process *creates* the accuracy. The first date is the honest signal of how wrong the initial estimate was, and it degrades sharply with revision count.

---

### 1.4 First-date slip by stage at time of first date set

If we can determine what stage the deal was in when the anticipated date was first set (by comparing the first date-change `CreatedDate` against `Stage_Entered_*` timestamps), break out the first-date slip:

| Stage When Date First Set | N | Avg First→Actual Slip | Median First Slip | Avg Revisions |
|--------------------------|---|----------------------|-------------------|---------------|
| Discovery/Qualifying | 2 | +14.5 | +7 | 2.5 |
| Sales Process | 39 | +16.8 | +5 | 2.6 |
| Negotiating | 7 | +24.0 | +12 | 2.7 |
| Signed | 1 | +48.0 | +48 | 1.0 |

**Results:**

Stage at date set was determined by comparing the first field-history `CreatedDate` against `Stage_Entered_*` timestamps. Limitations:

- **Discovery/Qualifying (N=2) and Signed (N=1) are too small to draw conclusions.** Only Sales Process and Negotiating have usable sample sizes.
- The vast majority of first date-sets happen during **Sales Process (39 of 49 = 80%)**. This makes sense — the anticipated date is typically set during active deal negotiation, not at Discovery or after Signing.
- **Sales Process dates slip +16.8 days on average (median +5).** The median is modest but the average is dragged up by a tail of large slips.
- **Negotiating dates slip +24.0 days on average (median +12).** Later-stage first-sets are slightly less accurate, possibly because Negotiating deals that need a date set are already running behind.
- Stage-based buffer differentiation is **not justified by this data** — the sample sizes are too unbalanced (39 vs 7 vs 2 vs 1) to reliably distinguish stage effects from noise.

---

### Phase 1 Summary

**The Phase 7.1 finding of "+2 days average slip" is genuinely misleading.** It measures the accuracy of the *last guess*, not the first. The first recruiter estimate — the one that exists when the forecast first uses the anticipated date — is off by an average of **+18.3 days (median +7)**, with 65% of deals joining later than first estimated.

The "accuracy" of the final anticipated date is an artifact of iterative revision: recruiters push the date out an average of 17 days over the life of the deal, converging on reality by the time the deal closes. This means the forecast is using a moving target that only becomes accurate after the information is no longer needed.

**Key numbers for the model:**
- **Flat buffer for all deals with an anticipated date: +18 days** would center the first-date distribution (average first slip = +18.3)
- **Revision-count-based buffer is more precise:** +9 days for 1 change, +11 days for 2, +18 days for 3, **+41 days for 4+**
- **Stage-based buffer is NOT supported** — 80% of dates are first set during Sales Process, so there isn't enough data to distinguish stage effects
- **Sample size caveat:** N=49 Joined deals with field history. Adequate for directional findings but not for fine-grained bucketing. The 4+ revision bucket (N=10) is the thinnest.

---

## Phase 2: Impact on Current Open Pipeline

### 2.1 Current open pipeline — revision status and anticipated date reliability

For all current open pipeline deals with `Earliest_Anticipated_Start_Date__c` populated, join to field history and classify:

| Bucket | Deals | AUM ($M) | Avg Revisions | Avg Days Pushed Out So Far | Avg Days Until Anticipated Date |
|--------|-------|----------|---------------|---------------------------|-------------------------------|
| Set once, never revised | 63 | $6,604M | 1.0 | 0 | 82 days |
| Revised 1-2 times | 15 | $974M | 2.1 | 22 | 46 days |
| Revised 3+ times | 12 | $1,336M | 7.3 | **227** | 39 days |
| **Anticipated date already passed** | **2** | *(included in "Set once" above)* | 1 | 0 | — |

**Note:** No deals fell in a "No history (predates tracking)" bucket — all open pipeline deals with an anticipated date have at least one field history record, which makes sense given tracking started April 2025 and most current pipeline deals were created after that.

**Stage breakdown:**

| Stage | Deals w/ Anticipated Date | % Revised 2+ Times | Avg Days Pushed Out |
|-------|--------------------------|--------------------|--------------------|
| Sales Process | 55 | 10.9% | 8 days |
| Negotiating | 31 | **54.8%** | **63 days** |
| Signed | 4 | **100%** | **176 days** |

**Results:**

The pattern is clear and concerning:

- **Sales Process deals (55)** are mostly fresh dates — only 11% have been revised 2+ times, with a modest 8 days of average push. These dates are relatively trustworthy.
- **Negotiating deals (31)** are a mixed bag — **55% have been revised 2+ times**, with an average of 63 days pushed out. These dates are already showing significant drift.
- **Signed deals (4)** have ALL been revised at least twice, with an average of **176 days** pushed out. These dates are essentially meaningless as timing signals — they've been chased across multiple quarters.
- The **12 deals with 3+ revisions** represent only 13% of deals by count but carry **$1.34B in AUM** (15% of the dated pipeline). Their dates have been pushed an average of **227 days** — over 7 months of drift. These dates should not be trusted for timing.
- **2 deals have anticipated dates that have already passed** but the deal is still open — their dates are demonstrably stale.

---

### 2.2 Deals with anticipated dates projected for Q2 2026 — risk assessment

List all current open pipeline deals with anticipated dates in Q2 2026 (April 1 – June 30, 2026). For each, show:

| Advisor | Stage | AUM ($M) | Anticipated Date | Rev Count | Days Pushed | First Date Set | Risk |
|---------|-------|----------|-----------------|-----------|-------------|---------------|------|
| Will Velekei | Negotiating | $437M | 2026-06-01 | 1 | 0 | 2026-06-01 | **Low** |
| Brandon Harrison | Sales Process | $400M | 2026-06-30 | 1 | 0 | 2026-06-30 | Medium |
| James Phillips | Sales Process | $300M | 2026-06-30 | 1 | 0 | 2026-06-30 | Medium |
| Allen Buckley | Sales Process | $240M | 2026-04-30 | 1 | 0 | 2026-04-30 | Medium |
| **Kurt Wedewer** | **Signed** | **$235M** | **2026-04-24** | **14** | **266** | **2025-08-01** | **High** |
| **Pablo Bianchi** | **Negotiating** | **$208M** | **2026-05-29** | **4** | **119** | **2026-01-30** | **High** |
| **Tony Parrish 2025** | **Signed** | **$206M** | **2026-05-11** | **6** | **346** | **2025-05-30** | **High** |
| Drake Newkirk | Sales Process | $200M | 2026-06-30 | 1 | 0 | 2026-06-30 | Medium |
| Diamond Wealth Mgmt | Sales Process | $200M | 2026-05-29 | 1 | 0 | 2026-05-29 | Medium |
| Carl Grund | Negotiating | $185M | 2026-04-30 | 2 | 17 | 2026-04-13 | Medium |
| **Emily Hermeno** | **Sales Process** | **$160M** | **2026-05-22** | **5** | **301** | **2025-07-25** | **High** |
| Fred Ymker | Sales Process | $150M | 2026-05-15 | 1 | 0 | 2026-05-15 | Medium |
| **Matt Mai** | **Negotiating** | **$150M** | **2026-05-23** | **5** | **302** | **2025-07-25** | **High** |
| Daniel Murphy | Sales Process | $150M | 2026-06-19 | 2 | -3 | 2026-06-22 | Medium |
| Jonathan Benge | Sales Process | $140M | 2026-06-30 | 1 | 0 | 2026-06-30 | Medium |
| George Rabon + Mike Henry | Sales Process | $120M | 2026-06-19 | 1 | 0 | 2026-06-19 | Medium |
| **Chris Chorlins** | **Signed** | **$111M** | **2026-04-16** | **4** | **94** | **2026-01-12** | **High** |
| Scott Bell | Negotiating | $107M | 2026-06-30 | 1 | 0 | 2026-06-30 | **Low** |
| Matt Pohlman | Sales Process | $102M | 2026-04-30 | 1 | 0 | 2026-04-30 | Medium |
| Blake Furgerson | Sales Process | $100M | 2026-06-26 | 1 | 0 | 2026-06-26 | Medium |
| Steven Sivak | Sales Process | $95M | 2026-05-11 | 1 | 0 | 2026-05-11 | Medium |
| **Debbie Huttner** | **Negotiating** | **$90M** | **2026-05-15** | **9** | **322** | **2025-06-27** | **High** |
| Shiv Mittal | Sales Process | $90M | 2026-06-09 | 1 | 0 | 2026-06-09 | Medium |
| Ashley Dominey Stewart | Sales Process | $90M | 2026-05-01 | 1 | 0 | 2026-05-01 | Medium |
| Jason Silva | Sales Process | $87M | 2026-06-01 | 1 | 0 | 2026-06-01 | Medium |
| Clint Heisler | Sales Process | $80M | 2026-05-27 | 1 | 0 | 2026-05-27 | Medium |
| Katherine Fibiger | Signed | $79M | 2026-04-22 | 2 | -2 | 2026-04-24 | Medium |
| **AJ Patrick** | **Sales Process** | **$75M** | **2026-04-15** | **1** | **0** | **2026-04-15** | **High** |
| Corey Long | Sales Process | $75M | 2026-04-30 | 1 | 0 | 2026-04-30 | Medium |
| Bradley Small | Negotiating | $65M | 2026-05-13 | 1 | 0 | 2026-05-13 | **Low** |
| Gary Jones | Sales Process | $65M | 2026-05-11 | 1 | 0 | 2026-05-11 | Medium |
| Timothy Cleveland | Sales Process | $65M | 2026-06-22 | 1 | 0 | 2026-06-22 | Medium |
| Leo Nunez | Negotiating | $60M | 2026-04-24 | 2 | 21 | 2026-04-03 | Medium |
| David Warshaw | Sales Process | $60M | 2026-06-30 | 1 | 0 | 2026-06-30 | Medium |
| Jonathon Jordan | Sales Process | $60M | 2026-05-06 | 2 | 41 | 2026-03-26 | Medium |
| Matthew Aquilia | Negotiating | $60M | 2026-05-15 | 1 | 0 | 2026-05-15 | **Low** |
| Randy Long | Negotiating | $55M | 2026-04-17 | 2 | 17 | 2026-03-31 | Medium |
| James Soukup | Sales Process | $55M | 2026-06-22 | 1 | 0 | 2026-06-22 | Medium |
| Corey Lehan | Negotiating | $55M | 2026-06-26 | 2 | -17 | 2026-07-13 | Medium |
| Andrew Farinelli | Negotiating | $55M | 2026-05-20 | 1 | 0 | 2026-05-20 | **Low** |
| Justin Wollman | Sales Process | $50M | 2026-05-22 | 1 | 0 | 2026-05-22 | Medium |
| Kyle Martin | Sales Process | $50M | 2026-05-15 | 2 | 15 | 2026-04-30 | Medium |
| Salim Admon | Sales Process | $50M | 2026-05-05 | 1 | 0 | 2026-05-05 | Medium |
| Bryan Havighurst | Sales Process | $47M | 2026-06-08 | 1 | 0 | 2026-06-08 | Medium |
| Carolyn Simon | Negotiating | $42M | 2026-05-15 | 2 | 39 | 2026-04-06 | Medium |
| Steve Holdsworth | Sales Process | $40M | 2026-05-18 | 1 | 0 | 2026-05-18 | Medium |
| Sean Emory | Sales Process | $40M | 2026-05-18 | 1 | 0 | 2026-05-18 | Medium |
| Thomas Dexter | Negotiating | $38M | 2026-04-23 | 3 | 38 | 2026-03-16 | Medium |
| **David Matuszak** | **Negotiating** | **$37M** | **2026-04-10** | **16** | **284** | **2025-06-30** | **High** |
| Greg Schiffli | Negotiating | $36M | 2026-04-15 | 2 | 15 | 2026-03-31 | Medium |
| Thomas Esposito | Sales Process | $35M | 2026-05-01 | 1 | 0 | 2026-05-01 | Medium |
| **Consolidated Planning** | **Negotiating** | **$31M** | **2026-05-04** | **4** | **63** | **2026-03-02** | **High** |
| Elias Crist | Negotiating | $31M | 2026-04-07 | 1 | 0 | 2026-04-07 | **Low** |
| Bryan Sitzer | Negotiating | $30M | 2026-04-30 | 1 | 0 | 2026-04-30 | **Low** |
| Don Rudolph | Sales Process | $30M | 2026-04-24 | 1 | 0 | 2026-04-24 | Medium |
| **Amy Colton** | **Sales Process** | **$30M** | **2026-04-20** | **2** | **28** | **2026-03-23** | **High** |
| Mason Sheehy | Sales Process | $30M | 2026-05-12 | 1 | 0 | 2026-05-12 | Medium |
| Alex Black | Sales Process | $30M | 2026-05-18 | 1 | 0 | 2026-05-18 | Medium |
| **Ryan Drews** | **Negotiating** | **$26M** | **2026-04-10** | **10** | **284** | **2025-06-30** | **High** |
| Jay Dover | Sales Process | $25M | 2026-05-18 | 1 | 0 | 2026-05-18 | Medium |
| Kevin Mautte | Sales Process | $25M | 2026-06-19 | 1 | 0 | 2026-06-19 | Medium |
| Thomas Wendt | Negotiating | $25M | 2026-04-24 | 1 | 0 | 2026-04-24 | **Low** |
| **Mike Krueger** | **Negotiating** | **$24M** | **2026-05-12** | **6** | **85** | **2026-02-16** | **High** |
| Ryan Walker | Sales Process | $20M | 2026-05-22 | 1 | 0 | 2026-05-22 | Medium |
| Brian Patterson | Sales Process | $20M | 2026-05-05 | 2 | 35 | 2026-03-31 | Medium |
| Michael DeSantis | Sales Process | $20M | 2026-06-22 | 1 | 0 | 2026-06-22 | Medium |
| Matt Wylie | Negotiating | $19M | 2026-04-27 | 1 | 0 | 2026-04-27 | **Low** |
| Rob Giordano | Negotiating | $17M | 2026-04-24 | 1 | 0 | 2026-04-24 | Medium |
| Kurt Fetter | Sales Process | $15M | 2026-05-01 | 1 | 0 | 2026-05-01 | Medium |
| Chris Cummock | Negotiating | $13M | 2026-04-27 | 1 | 0 | 2026-04-27 | **Low** |

Risk level classification:
- **Low risk:** 0-1 revisions, date set recently, late-funnel stage (Negotiating/Signed)
- **Medium risk:** 2-3 revisions, OR early-funnel stage, OR date set >60 days ago
- **High risk:** 4+ revisions, OR date already pushed 60+ days, OR date within 30 days but deal is in Discovery/SP

**Results:**

**70 deals** with anticipated dates in Q2 2026, totaling **$6.24B in raw pipeline AUM**.

**Risk distribution:**

| Risk Level | Deals | AUM ($M) | % of Q2 AUM |
|------------|-------|----------|-------------|
| **High** | 13 | $1,613M | 25.8% |
| Medium | 46 | $3,779M | 60.5% |
| Low | 11 | $851M | 13.6% |

**13 High-risk deals** carry **$1.61B (26%)** of Q2 2026's anticipated AUM. The worst offenders:
- **Tony Parrish** (Signed, $206M): date pushed **346 days** across 6 revisions — originally anticipated May 2025, now May 2026
- **Emily Hermeno** (SP, $160M): pushed **301 days** across 5 revisions — originally July 2025
- **Matt Mai** (Neg, $150M): pushed **302 days** across 5 revisions — originally July 2025
- **Kurt Wedewer** (Signed, $235M): pushed **266 days** across 14 revisions — originally August 2025
- **David Matuszak** (Neg, $37M): pushed **284 days** across **16 revisions** — the most-revised deal in the pipeline

---

### 2.3 Quarter impact simulation

Using the first-date slip findings from Phase 1, estimate how the Q2 2026 projected AUM would change if we applied a slip buffer based on revision count:

1. Take all deals currently projected for Q2 2026 (using their current anticipated date or model date)
2. For deals with revision history, add a buffer equal to the average first-date slip for their revision count bucket (from Phase 1.3)
3. Recompute projected quarter with the buffered date
4. Show how many deals shift from Q2 to Q3 or later, and how much AUM moves with them

| Scenario | Q2 2026 Raw AUM | Q2 Deals | Q3 2026 Raw AUM | Q3 Deals | Deals Shifted Q2→Q3 |
|----------|----------------|----------|----------------|----------|---------------------|
| Current (no buffer) | **$6,243M** | 70 | $2,214M | 13 | — |
| With revision-based buffer | **$4,368M** | 59 | $3,584M | 25 | **14** |

**AUM moved out of Q2: $1,875M (30% of Q2 raw pipeline)**

**Results:**

Applying the Phase 1.3 revision-based buffers (+9d for 1 rev, +11d for 2, +18d for 3, +41d for 4+) shifts **14 deals totaling $1.88B** from Q2 into Q3. The shifted deals:

| Advisor | Stage | AUM ($M) | Original Date | Buffered Date | Revisions |
|---------|-------|----------|---------------|---------------|-----------|
| Brandon Harrison | SP | $400M | 2026-06-30 | 2026-07-09 | 1 |
| James Phillips | SP | $300M | 2026-06-30 | 2026-07-09 | 1 |
| Pablo Bianchi | Neg | $208M | 2026-05-29 | 2026-07-09 | 4 |
| Drake Newkirk | SP | $200M | 2026-06-30 | 2026-07-09 | 1 |
| Emily Hermeno | SP | $160M | 2026-05-22 | 2026-07-02 | 5 |
| Matt Mai | Neg | $150M | 2026-05-23 | 2026-07-03 | 5 |
| Jonathan Benge | SP | $140M | 2026-06-30 | 2026-07-09 | 1 |
| Scott Bell | Neg | $107M | 2026-06-30 | 2026-07-09 | 1 |
| Blake Furgerson | SP | $100M | 2026-06-26 | 2026-07-05 | 1 |
| Timothy Cleveland | SP | $65M | 2026-06-22 | 2026-07-01 | 1 |
| David Warshaw | SP | $60M | 2026-06-30 | 2026-07-09 | 1 |
| James Soukup | SP | $55M | 2026-06-22 | 2026-07-01 | 1 |
| Corey Lehan | Neg | $55M | 2026-06-26 | 2026-07-07 | 2 |
| Michael DeSantis | SP | $20M | 2026-06-22 | 2026-07-01 | 1 |

**Important observation:** Most of the shifted deals (11 of 14) have only 1 revision and are shifting because their anticipated date is at the very end of Q2 (June 22–30). Even the modest +9 day buffer for 1-revision deals pushes them past the quarter boundary. This is a **quarter-boundary artifact**, not a sign of high-risk slippage. The truly high-risk shifts are Pablo Bianchi (+41d buffer, 4 revisions), Emily Hermeno (+41d, 5 revisions), and Matt Mai (+41d, 5 revisions) — serial revisers whose dates have already drifted months.

---

### Phase 2 Summary

**26% of Q2 2026's anticipated AUM ($1.61B across 13 deals) is at high risk of slipping.** These are deals with 4+ revisions, 60+ days already pushed out, or early-funnel deals with imminent dates. The worst offenders have been pushed 266–346 days across 6–16 revisions — their anticipated dates are essentially fiction that gets rewritten monthly.

**The revision-based buffer would move $1.88B (30%) of Q2 raw AUM to Q3.** However, most of that movement ($1.5B) comes from deals with only 1 revision whose dates happen to land in late June — a quarter-boundary artifact, not a reliability concern. The genuinely unreliable deals (3+ revisions: Pablo Bianchi $208M, Emily Hermeno $160M, Matt Mai $150M) account for $518M of shifted AUM.

**Stage pattern is stark:** 100% of Signed deals and 55% of Negotiating deals have been revised 2+ times, vs only 11% of Sales Process deals. Later-stage dates have more time to accumulate revisions and drift. This argues for stage-aware trust levels rather than a flat buffer.

**The practical concern for forecasting:** The model currently uses the anticipated date as the projected join date when it's populated, overriding the model-computed date. For the 12 deals with 3+ revisions ($1.34B AUM, avg 227 days pushed), this means the forecast's timing is based on a date that has been demonstrably wrong multiple times and will likely be pushed again.

---

## Phase 3: Recommendations — What Should We Change in the Model?

### 3.1 Should we add a date buffer?

**Yes, but not a flat buffer. Use a revision-count-based override threshold instead.**

A flat +18 day buffer (the average first-date slip) would improve accuracy overall but creates a false-precision problem: it penalizes fresh, never-revised dates that are already accurate (median slip = 0 for 1-revision deals) while under-penalizing serial revisers (+41 days average slip for 4+ revisions).

A per-revision buffer is more precise, but the Phase 2.3 simulation showed it creates **quarter-boundary artifacts** — 11 of 14 shifted deals were single-revision deals landing in late June that got bumped past July 1 by a mere +9 day buffer. This produces misleading quarter shifts for deals that are actually low-risk.

**Recommended approach: Don't buffer — override.** Instead of adding days to the anticipated date, stop trusting it entirely for deals with 3+ revisions and fall back to the model date. This is cleaner than a buffer because:
- 0-2 revisions: the anticipated date is usable (avg slip +9 to +11 days, median +0 to +7)
- 3+ revisions: the anticipated date has been demonstrably wrong 3+ times and the model date is a better signal

**Proposed values if a buffer IS implemented (V2 enhancement, not V1):**

| Revisions | Buffer (days) | Source | Confidence |
|-----------|--------------|--------|------------|
| 0 (no history) | +0 | No data to adjust | — |
| 1 (set once) | +9 | Phase 1.3: avg first slip +8.5, rounded up | N=11 |
| 2 | +11 | Phase 1.3: avg first slip +10.7 | N=14 |
| 3 | +18 | Phase 1.3: avg first slip +17.7 | N=14 |
| 4+ | +41 | Phase 1.3: avg first slip +40.7 | N=10 |

**Stage-based buffer: NOT recommended.** Phase 1.4 showed 80% of dates are first set during Sales Process. The Negotiating and Signed samples (N=7 and N=1) are too small to justify different buffers by stage.

---

### 3.2 Should we change when the forecast trusts the anticipated date?

**Recommendation: Option (c) — Only trust the anticipated date for deals with 0-2 revisions. For 3+ revisions, use the model date.**

Justification from the data:

| Approach | Pros | Cons |
|----------|------|------|
| **(a) Trust all (current)** | Simple | 12 deals with 3+ revisions ($1.34B) use dates pushed avg 227 days — demonstrably unreliable |
| **(b) Trust only Signed** | Removes worst early-funnel dates | Only 4 Signed deals in pipeline; throws out good SP dates (89% of which are accurate) |
| **(c) Trust 0-2 revisions, model for 3+** | Preserves good dates (78 of 90 dated pipeline deals), overrides only the worst | Requires revision count data from field history |
| **(d) Weighted blend** | Smooth degradation | Over-engineered for 12 deals; harder to explain; blend weights not empirically derivable from N=49 |

**Why (c):** The data shows a clear quality cliff between 2 and 3 revisions:
- **1-2 revisions:** avg first slip +9 to +11 days. Dates are noisy but directionally useful. 78 of 90 dated open pipeline deals (87%) fall here.
- **3+ revisions:** avg first slip +18 to +41 days, avg total drift 227 days. These dates track a moving target — they're optimistic projections that get chased forward monthly. Only 12 deals (13%) fall here, but they carry $1.34B.

For the 12 deals with 3+ revisions, the model-computed date (based on avg stage durations and days already in stage) is likely more honest than an anticipated date that has been wrong 3+ times.

**Implementation:** In the `useMemo` and `recomputeP2WithRates`, after computing the model date and checking for the anticipated date:

```
if (revisionCount >= 3) {
  // Don't trust anticipated date — use model date
  finalDate = modelDate;
  dateSource = 'Model (date override — 3+ revisions)';
} else if (anticipatedDate) {
  finalDate = anticipatedDate;
  dateSource = 'Anticipated';
} else {
  finalDate = modelDate;
  dateSource = 'Model';
}
```

---

### 3.3 Should we add a "date confidence" indicator?

**Yes. Add all three to the Sheets export; add the confidence label to the dashboard.**

**Sheets export (new columns after AE):**

| Col | Header | Value |
|-----|--------|-------|
| AF | Date Revisions | Integer count from field history (0 if no history) |
| AG | Date Confidence | `High` (0-1 revisions), `Medium` (2 revisions), `Low` (3+ revisions) |
| AH | First Date Set | The earliest anticipated date from field history (OldValue of first record, or NewValue if OldValue is NULL). Blank if no history. |

**Dashboard (PipelineDetailTable):**
- Add a date confidence badge next to the "Source" column (or replace "Source" with a more informative label):
  - **High** (green): 0-1 revisions — date is likely reliable
  - **Medium** (amber): 2 revisions — date has been adjusted once
  - **Low** (red): 3+ revisions — serial reviser, date unreliable

This gives the RevOps team immediate visibility into which Q2 dates are trustworthy and which are being chased forward.

---

### 3.4 What changes are needed in forecast_enhancement_guide.md?

**Changes needed before shipping the enhanced model:**

1. **page.tsx useMemo — timing logic (Step 2):**
   - After the existing anticipated date check, add the 3+ revision override:
     - Need `revision_count` per deal (from a new API endpoint or pre-computed field)
     - If `revision_count >= 3`, ignore the anticipated date and use the model date
     - Set `date_source = 'Model (date override)'`
   - **Dependency:** revision count data must be available client-side. Two options:
     - (a) Pre-compute in a BQ view or add to `vw_forecast_p2` (requires view change — conflicts with "no view changes" rule)
     - (b) Fetch from a new API endpoint that queries `OpportunityFieldHistory` and returns `{ oppId: revisionCount }` map
     - (c) Defer to V2 — ship without the override, add it after the shadow-mode quarter validates the penalty model

2. **Monte Carlo SQL — projected_join_date logic (Step 3):**
   - Same override: if a deal has 3+ revisions on `Earliest_Anticipated_Start_Date__c`, the `projected_join_date` CTE should use the model-computed date instead of `Earliest_Anticipated_Start_Date__c`
   - This requires joining `OpportunityFieldHistory` in the MC SQL or passing revision counts as a parameter
   - **Complexity: HIGH.** Adding a JOIN to the MC SQL increases query cost and risk. Consider deferring to V2.

3. **Sheets export columns (Step 5):**
   - Add columns AF (Date Revisions), AG (Date Confidence), AH (First Date Set) after AE
   - The revision count can be fetched server-side in the export route (it already has access to BigQuery)
   - **Complexity: LOW.** This is the easiest change and provides immediate value.

4. **New data needed:**
   - `revision_count`: `COUNT(*) FROM OpportunityFieldHistory WHERE Field = 'Earliest_Anticipated_Start_Date__c' GROUP BY OpportunityId`
   - `first_anticipated_date`: from earliest history record per opp
   - These can be fetched as a lookup map server-side (export route, MC route) without changing any BQ views

**Recommended shipping plan:**

| Change | Ship in V1? | Rationale |
|--------|-------------|-----------|
| Sheets export: revision count, confidence, first date | **Yes** | Low risk, immediate visibility for RevOps |
| Dashboard: date confidence badge | **Yes** | Low risk, visual indicator only |
| useMemo: 3+ revision override | **Defer to V2** | Needs revision count in client, adds complexity |
| Monte Carlo: 3+ revision override | **Defer to V2** | Highest risk change, defer until shadow-mode validates penalty model |

---

### 3.5 Updated assessment of Phase 7.1

**Original Phase 7.1 conclusion:**

> "Recruiter date estimates are surprisingly accurate. The average slip between the anticipated date and actual join date is just +2.0 days, with 78.7% of deals joining on or before the anticipated date. A date slippage buffer is NOT warranted."

**Revised conclusion:**

> Recruiter anticipated dates appear accurate (+2 days average slip) only because they are iteratively revised to track reality. The **first** anticipated date — the one that exists when the forecast first uses it — overshoots by an average of **+18 days** (median +7 days), with 65% of deals joining later than initially estimated. The "+2 days" finding measures the accuracy of the **last** guess, not the first.
>
> The revision process creates a survivorship bias: by the time a deal closes, the date has been pushed out an average of 17 days across 2.5 revisions, converging on the actual join date. For forecasting purposes, the current anticipated date on any given day is likely to be revised again before the deal closes — especially for deals with 3+ prior revisions (average first-date slip: +41 days, average total drift: 227 days).
>
> **Revised recommendation:** The anticipated date is usable for deals with 0-2 revisions (87% of the dated pipeline), where the average first-date slip is +9 to +11 days. For deals with 3+ revisions (13% of deals, $1.34B AUM), the anticipated date should be overridden by the model-computed date, as it has been demonstrably wrong multiple times. A flat buffer is not recommended — the revision count is a more precise indicator of date reliability than any single adjustment factor.

---

## Appendix: Key Reference Numbers

### From Preliminary Exploration (All Opps)

| Metric | Value |
|--------|-------|
| Total opps with date history | 292 |
| % that revised the date at least once | 57% |
| % of revisions that push later | 92% |
| Median per-change shift | 25 days |
| Average total drift (first→final) | 45 days |
| P90 total drift | 143 days |
| Serial pushers (5+ changes) | 32 opps (19% of multi-change) |

### From Phase 7.1 (Final Date vs Actual — Joined Deals Only)

| Metric | Value |
|--------|-------|
| Sample size | 75 of 114 Joined deals |
| Average slip (final→actual) | +2.0 days |
| Median slip (final→actual) | 0 days |
| On time or early | 78.7% |
| Max slip | +39 days |
