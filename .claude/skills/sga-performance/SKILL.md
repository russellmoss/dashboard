---
name: sga-performance
description: "Deep-dive into SGA team performance. Analyzes activity patterns, SMS behavior, conversion rates, velocity, and response habits to identify what top performers do differently and how to replicate it."
---

# SGA Performance Analysis — Agent Team

You are analyzing Sales Growth Advisor (SGA) performance at Savvy Wealth to answer: **What do our best SGAs do? How do we learn from them and replicate their success?**

## Data Sources

All queries use BigQuery MCP (`mcp__bigquery__execute_sql`). Key tables:

- **`savvy-gtm-analytics.Tableau_Views.vw_funnel_master`** — Funnel stages, conversion flags, SGA assignments
- **`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2`** — SMS behavior per lead aligned to funnel master
- **`savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`** — Activity-level records (SMS, calls) with timestamps and direction
- **`savvy-gtm-analytics.savvy_analytics.sms_intent_classified`** — AI-classified SMS intent by task_id
- **`savvy-gtm-analytics.savvy_analytics.sms_weekly_metrics_daily`** — Weekly SGA scorecards (bookend adherence, response times, coverage)
- **`savvy-gtm-analytics.SavvyGTMData.Task`** — Raw task/SMS/call records with Description (message body)

**Important**: Never use string interpolation in queries — always use literal values.

## Step 1: Spawn Agent Team

Create 2 agents in parallel:

### Agent 1: Funnel & Conversion Analyst (use data-verifier agent)

**Goal**: Build a comprehensive SGA performance profile from funnel data.

**Run these queries via BigQuery MCP:**

1. **SGA Conversion Leaderboard** — For each SGA with ≥100 contacted prospects:
   - Contacted → MQL rate, MQL → SQL rate, SQL → SQO rate, SQO → Joined rate
   - Total volume at each stage
   - Average deal velocity (days between stages)
   - Average AUM of won deals
   - Channel/source mix (what % of their book is Outbound vs Marketing vs Partnerships)

2. **Time-Period Trends** — For each SGA, compare their conversion rates:
   - Last 90 days vs prior 90 days (improving or declining?)
   - Best quarter vs worst quarter

3. **Source-Adjusted Performance** — Control for lead quality by comparing SGAs within the same source:
   - For "LinkedIn (Self Sourced)" leads only, rank SGAs by MQL rate
   - For "Provided List (Lead Scoring)" leads only, rank SGAs by MQL rate
   - This isolates SGA skill from territory quality

4. **Bottleneck Analysis** — For each SGA, identify which stage transition is weakest relative to team average

Save findings to `sga-funnel-analysis.md` in project root.

### Agent 2: Activity & Behavior Analyst (use data-verifier agent)

**Goal**: Analyze SMS/call behavior patterns that differentiate top performers.

**Run these queries via BigQuery MCP:**

1. **Activity Volume Profile** — For each active SGA:
   - Daily SMS volume (outbound), daily call volume
   - SMS-to-call ratio
   - Weekend vs weekday activity split
   - First activity hour (when do they start their day?)

2. **SMS Behavior Patterns** — Using `vw_sga_sms_timing_analysis_v2`:
   - First SMS speed (% same-day, % next-day)
   - Time-of-day distribution of first texts
   - Double-tap adherence rate
   - Reply rate and response speed distribution
   - First SMS intent distribution (Value Prop vs Nudge vs Scheduling)
   - Link usage rate (should be 0% per anti-link policy)

3. **Response Speed Deep-Dive** — Using activity data:
   - Average and median response time to inbound SMS
   - % of replies responded to within 1 hour
   - Examples of slow responses from `sms_weekly_metrics_daily.slow_response_details`

4. **Call Behavior** — From activity performance view:
   - Cold call volume per SGA
   - Call duration distribution (meaningful connects vs quick drops)
   - Call-to-SMS sequencing patterns (do top SGAs call then text, or text then call?)

5. **Playbook Adherence** — Using weekly metrics:
   - Bookend strategy adherence (AM + PM texts)
   - Golden window adherence (texting in optimal hours)
   - Coverage rates (% of contacted leads that get texted)

Save findings to `sga-behavior-analysis.md` in project root.

## Step 2: Synthesize into Performance Profiles

Once both agents complete, read their findings and produce `sga-performance-report.md`:

### Report Structure

```markdown
# SGA Performance Intelligence Report
*Generated: [date]*

## Executive Summary
- [N] active SGAs analyzed
- Top performer: [name] — [key stat]
- Biggest team-wide gap: [specific behavior]
- Estimated impact of closing gap: [N] additional [MQLs/SQOs] per quarter

## 1. SGA Ranking Matrix
[Table with all SGAs ranked across 5 dimensions: conversion rate, velocity, SMS discipline, response speed, volume]

## 2. Top Performer Profiles
For the top 3 SGAs by SQO production:
- What sources they work
- Their SMS timing patterns
- Their response speed habits
- Their call-to-text sequencing
- Their conversion rates vs team average at each stage

## 3. Behavior Gap Analysis
[For each controllable behavior, show the gap between top performers and the team:]
| Behavior | Top 3 Avg | Team Avg | Bottom 3 Avg | Impact |
|----------|-----------|----------|--------------|--------|
| Response time (min) | | | | |
| Same-day first SMS % | | | | |
| Double-tap rate % | | | | |
| Bookend adherence % | | | | |
| Link violation rate % | | | | |
| Value Prop intent % | | | | |

## 4. Source-Adjusted Rankings
[Show that top performers win even when controlling for lead quality]

## 5. Coaching Recommendations
For each SGA below team average, list their top 2 specific behaviors to improve:
- [SGA name]: Improve [behavior] from [current] to [target]. Expected lift: [N] additional MQLs/month.

## 6. Replication Playbook
Distill the top performer behaviors into a concrete, actionable playbook:
1. Speed: Contact within [N] hours of lead creation
2. First text: Send [intent type], no links, during [time window]
3. Persistence: If no reply, send [follow-up type] within [window]
4. Response: When lead replies, respond within [N] minutes
5. Call integration: [when to call vs text]
```

## Step 3: Present to User

Tell the user:
- "[N] SGAs analyzed across [M] contacted prospects"
- "Top performer: [name] — [headline stat]"
- "Biggest replicable gap: [behavior] — closing it could add [N] SQOs/quarter"
- "Full report saved to `sga-performance-report.md`"

**IMPORTANT**:
- ALL numbers must come from actual BigQuery queries — never estimate or hallucinate
- Focus on **controllable behaviors**, not outcomes the SGA can't influence
- Be respectful in comparisons — frame as "opportunity to improve" not "failing"
- If a query fails or returns unexpected results, report transparently
