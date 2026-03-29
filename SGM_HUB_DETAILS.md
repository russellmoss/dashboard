# SGM Hub — Manager's Guide

> **Audience**: Managers and admins who oversee SGM performance and set quarterly quotas.
> **Access**: All managers have admin-level access. SGMs have a restricted self-service view.

---

## What Is the SGM Hub?

The SGM Hub is the central page for tracking SGM (Sales Growth Manager) performance. It has three tabs:

1. **Leaderboard** — Who's winning this quarter?
2. **Dashboard** — How is the pipeline performing across the team?
3. **Quota Tracking** — Are SGMs on pace to hit their ARR targets?

You'll find it in the left sidebar under **SGM Hub**.

---

## Tab 1: Leaderboard

The Leaderboard ranks all SGMs by **Joined AUM** (total assets under management from advisors who joined during the selected quarter).

### What You See

| Column | What It Means |
|--------|---------------|
| Rank | Position based on Joined AUM. Top 3 get gold/silver/bronze medals. |
| SGM Name | The SGM. If an SGM is viewing their own row, a blue "You" badge appears. |
| # Joined | Count of advisors who joined. **Click this number** to see the full list of joined advisors. |
| Joined AUM | Total AUM from joined advisors. **Click this number** to see the same list with AUM details. |

### Filters

Use the filter bar above the table to narrow by:
- **Quarter** (default: current quarter)
- **Channels** (e.g., Organic, Paid, Referral)
- **Sources** (e.g., LinkedIn, Google)
- **SGMs** (select specific SGMs or view all)

### Coaching Use

Compare SGMs head-to-head on the same quarter. If an SGM is ranked low, click their Joined count to see the actual advisors — check if they're closing smaller AUM deals or fewer total deals.

---

## Tab 2: Dashboard

The Dashboard gives you a funnel-wide view of SGM performance with four sections.

### Scorecards (Top Row)

Nine metric cards showing team-wide or filtered totals:

| Metric | What It Means | Clickable? |
|--------|---------------|------------|
| SQLs | Sales Qualified Leads received | Yes — see the records |
| SQOs | Sales Qualified Opportunities created | Yes |
| Signed | Advisors who signed | Yes |
| Signed AUM | AUM from signed advisors | No |
| Joined | Advisors who fully joined | Yes |
| Joined AUM | AUM from joined advisors | No |
| Open Pipeline AUM | AUM from all currently open opportunities | Yes |
| Joined ARR (Actual) | Actual recurring revenue from joined advisors | No |
| Pipeline Est. ARR | Estimated ARR from the open pipeline | No |

Click any blue-bordered card to drill down into the underlying records.

### Conversion Charts

Two side-by-side charts showing quarterly trends:

- **Left chart (line)**: SQL-to-SQO % and SQO-to-Joined % over time
- **Right chart (bar)**: Raw counts of SQLs, SQOs, and Joined per quarter

Click any bar in the volume chart to drill into the records for that quarter and metric.

### Pipeline by Stage

A bar chart showing how many opportunities sit at each pipeline stage (Qualifying, Discovery, Sales Process, Negotiating, Signed, On Hold). Click any bar to see those records.

### SGM Conversion & Velocity Table

This is the most important coaching table on the Dashboard tab. It shows each SGM's conversion efficiency.

| Column | What It Shows | Clickable? |
|--------|---------------|------------|
| SGM | Name | No |
| SQLs | Number of SQLs received | Yes — drill into SQL records |
| SQL-to-SQO % | Conversion rate from SQL to SQO | Yes — drill into the eligible pool |
| SQOs | Number of SQOs created | Yes — drill into SQO records |
| SQO-to-Joined % | Conversion rate from SQO to Joined | Yes — drill into the eligible pool |
| Joined | Number of joined advisors | Yes — drill into joined records |
| SQO-to-Joined (days) | Average days from SQO to Joined | No |

**Team Average** row is pinned at the bottom (blue background) for easy comparison.

#### How Conversion Rates Are Calculated

The conversion rates use a **cohort-based eligible pool**, not a simple division.

**SQL-to-SQO %:**
- **Numerator**: SQLs that progressed to SQO (became a qualified opportunity)
- **Denominator**: SQLs that have **resolved** (either became SQO OR were Closed Lost) PLUS any orphan opportunities (records that became SQO without going through the lead/SQL stage)
- This means the denominator can be larger than the SQLs count, which is why the percentage may look lower than you'd expect from `SQOs / SQLs`

**SQO-to-Joined %:**
- **Numerator**: SQOs that eventually Joined
- **Denominator**: SQOs that have **resolved** (either Joined OR Closed Lost)
- SQOs still in active pipeline stages are excluded from the denominator since their outcome is unknown

**Why not just divide SQOs by SQLs?** Simple division overstates the rate because it ignores records that are still in-progress. The eligible pool method only counts records with a known outcome, giving you an accurate success rate.

#### Tooltips and Drilldowns

- **Hover** over any conversion rate to see "X of Y eligible" — the raw numbers behind the percentage
- **Click** a conversion rate to open a drilldown table showing every record in the eligible pool
- The drilldown includes special columns:
  - **SQL** — Yes/No, whether the record was an SQL
  - **Rate Eligible** — Yes/No, whether this record is counted in the conversion rate denominator
  - **Converted** — Yes/No, whether the record progressed to the next stage
  - **Closed Lost** — Yes/No, whether the record was closed lost
- You can **Export CSV** from any drilldown to analyze the data offline

---

## Tab 3: Quota Tracking

This is where you monitor ARR quota progress and manage quota targets. **What you see depends on your role.**

### What Managers/Admins See

As an admin, you get the full team view with three sections:

#### 1. Team Progress Card

A summary of the entire SGM team's quota performance for the selected quarter:

- **Total Joined ARR** vs **Total Team Quota** with a progress bar
- **Pacing badge**: Green "Ahead," Yellow "On Track," Red "Behind," or Gray "No Goal"
- **Expected ARR**: Where the team should be based on linear daily pacing
- **Pacing Diff**: How far ahead or behind (green = good, red = behind)
- **Days Elapsed**: e.g., "45 / 91" — how far through the quarter

#### 2. Individual SGM Breakdown Table

A sortable table showing each SGM's pipeline and progress:

| Column | What It Shows | Clickable? |
|--------|---------------|------------|
| SGM | Name | No |
| Open Opps | Count of all open opportunities | Yes — see the full list |
| 90+ Days | Opps open longer than 90 days (stale) | Yes (red) — see the stale opps |
| Open AUM | Total AUM in the open pipeline | No |
| Open ARR | Estimated ARR from open pipeline | No |
| Joined ARR | Actual ARR from joined advisors this quarter | No |
| Progress % | Pacing badge with percentage | No |

**Coaching tip**: Sort by "90+ Days" descending to find SGMs with stale pipeline. Click the number to see exactly which opportunities are stuck and in which stage.

#### 3. Quota Management Table

This is where you **set and edit quotas**. It shows a grid with:
- Rows: All 12 SGMs (sorted alphabetically)
- Columns: Q1 through Q4 for the selected year
- A year selector to switch between years

**To edit a quota:**
1. Click any dollar amount in the grid
2. Type the new value (raw number, e.g., `1300000`)
3. Press **Enter** or click away to save
4. Press **Escape** to cancel

Changes save immediately. The SGM will see the updated quota the next time they load the page.

### What SGMs See

SGMs see only their own data — they cannot see other SGMs' numbers or edit quotas.

#### 1. Quarterly Progress Card

Shows the SGM's ARR progress for the selected quarter:
- **Actual ARR** — with an "(est)" label if the value is estimated from account-level data rather than confirmed ARR
- **Quota** — the target set by the admin
- **Progress bar** — color-coded: green (100%+), blue (75%+), yellow (50%+), red (below 50%)
- **Pacing badge** and description (e.g., "Behind by $250,000 (38%)")
- **Stats**: Joined count, Expected ARR, Projected ARR (where they'll end up at current pace), Days Elapsed

#### 2. Historical ARR by Quarter Chart

A bar chart showing up to 8 quarters of history. A dashed gold line marks the current quarter's quota goal so the SGM can see how their actual performance compares.

**Click any bar** to see the joined advisors for that specific quarter.

#### 3. Open Opportunities Table

A sortable table of the SGM's currently open opportunities:

| Column | Notes |
|--------|-------|
| Advisor Name | Click to see the full record detail |
| Days Open | Color-coded: green (<30d), yellow (30-59d), orange (60-89d), red (90d+) |
| Stage | Current pipeline stage |
| Days in Stage | Color-coded same as Days Open. Shows "—" if data is unavailable |
| AUM | Opportunity AUM |
| Est. ARR | SGM's estimated ARR for this opportunity |

---

## How Pacing Works

Pacing is calculated using **linear daily interpolation**:

1. **Expected ARR** = (Quarterly Quota / Days in Quarter) x Days Elapsed
2. **Pacing Diff** = Actual ARR - Expected ARR
3. **Pacing %** = Pacing Diff / Expected ARR x 100

| Pacing % | Status | What It Means |
|----------|--------|---------------|
| More than +15% | Ahead | ARR is significantly above the daily run-rate |
| Between -15% and +15% | On Track | ARR is roughly where it should be |
| Below -15% | Behind | ARR is significantly below the daily run-rate |
| No quota set | No Goal | No target has been entered for this quarter |

**Projected ARR** extrapolates the current daily rate to the end of the quarter: if an SGM has $250K in ARR after 45 days of a 90-day quarter, their projected finish is $500K.

The ±15% tolerance band prevents false alarms — early in the quarter, a single large deal can swing the percentage. The band ensures "On Track" covers normal deal timing variance.

---

## How to Set Quotas (Step by Step)

1. Go to **SGM Hub** > **Quota Tracking** tab
2. Scroll down to the **Quota Management** section
3. Select the year using the dropdown (default: current year)
4. Click any cell in the grid to edit it
5. Enter the dollar amount as a number (e.g., `1300000` for $1.3M)
6. Press **Enter** or click away to save

**Current 2026 quotas are pre-loaded** for all 12 SGMs based on the approved ramp schedule. Ramping SGMs have lower Q1/Q2 targets that increase over the year.

**Note**: Only admin and revops_admin users can edit quotas. SGMs can view their own quota but cannot change it. Managers with admin access can edit any SGM's quota for any quarter.

---

## Tips for Coaching with the SGM Hub

### Weekly Check-In Prep
1. Open the **Leaderboard** tab to see who's winning the quarter
2. Switch to the **Dashboard** tab and check the **Conversion & Velocity** table
3. Look for SGMs with low SQL-to-SQO rates — hover the rate to see if it's based on a small sample
4. Click the rate to pull up the eligible records — export to CSV if needed for the 1:1

### Identifying Stale Pipeline
1. Go to **Quota Tracking** tab
2. Sort the breakdown table by **90+ Days** descending
3. Click the red number to see which opportunities are stuck
4. Check the **Days in Stage** column to find where they're getting stuck (Qualifying? Discovery?)

### Understanding the ARR Estimate
When you see "(est)" next to an ARR number, it means the actual confirmed ARR hasn't been entered in Salesforce yet. The system falls back to the Account Total ARR field. Once the Actual ARR field is populated in Salesforce, the estimate label will disappear automatically.

### Exporting Data
Every drill-down table has an **Export CSV** button in the top right. Use this to:
- Share specific records in a 1:1
- Build custom analysis on conversion rate eligible pools
- Track stale pipeline over time
