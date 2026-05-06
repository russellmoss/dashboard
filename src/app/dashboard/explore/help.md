# Explore Feature - User Guide

## Overview

The Explore feature allows you to ask questions about your funnel data in natural language. Simply type your question and get instant insights with visualizations.

## What Questions Can You Ask?

### Volume Questions
- "How many SQOs did we have this quarter?"
- "How many MQLs from Paid Search last month?"
- "Show me SQLs by channel this year"

### Conversion Rate Questions
- "What's our SQL to SQO conversion rate?"
- "Conversion rate by channel this quarter"
- "Win rate by SGA"

### Trend Questions
- "SQO trend by month this year"
- "Monthly conversion rates for the last 6 months"
- "Weekly SQLs for Q4"

### Comparison Questions
- "Compare SQOs this quarter vs last quarter"
- "How do SQLs this month compare to last month?"

### List/Detail Questions
- "Who are the people that SQOed this quarter?"
- "Show me all MQLs from the Commonwealth experiment"
- "List scheduled calls for next week"

### Pipeline Questions
- "What's the open pipeline AUM?"
- "Pipeline by stage"
- "Opportunities in Negotiating stage"

## Tips for Better Results

1. **Be Specific**: Include time periods (e.g., "this quarter", "last month", "YTD")
2. **Use Filters**: Add dimension filters like "for Paid Search channel" or "for John Doe"
3. **Natural Language**: Ask questions as you would to a colleague
4. **Check Query Inspector**: Click "View SQL" to see the generated query

## Limitations

- Cannot answer predictive questions (e.g., "What will Q2 SQOs be?")
- Cannot perform causal analysis (e.g., "Why did Q3 underperform?")
- Cannot look up individual advisor details by name alone
- Date ranges are limited to available data in BigQuery

## Interpreting Results

- **Metric Cards**: Single KPI values with optional comparisons
- **Bar Charts**: Comparisons across categories (channels, sources, SGAs)
- **Line Charts**: Trends over time (monthly, quarterly, weekly)
- **Tables**: Detailed record lists (click rows to see full details)

## Export Options

- **CSV**: Download data as spreadsheet
- **SQL**: Copy the generated BigQuery SQL
- **PNG**: Export chart visualizations as images
- **ZIP**: Download all exports in a single file

## Getting Help

If a query fails:
1. Check the Query Inspector for the generated SQL
2. Try simplifying your question
3. Narrow the date range
4. Remove complex filters
5. Use the feedback button to report issues

## Coaching Usage

The Coaching Usage tab is visible to RevOps Admins only. It surfaces six rollup
metrics from the sales-coaching pipeline (a separate Neon DB) over a selectable
date range (7 days, 30 days, 90 days, or All time).

All filters at the top of the page (rep name, advisor name, SQL'd, SQO'd,
Closed Lost, Pushed to SFDC, rep role, stage) are global — they narrow the KPI
cards AND the call drill-down identically. So selecting a single rep for the
last 7 days shows that rep's pushed-to-SFDC rate as the headline metric, not
the team's. Filters are applied in the browser; only the date range triggers a
network round-trip.

### Advisor-facing rule

All KPIs and the drill-down are restricted to advisor-facing calls:

- **Kixie**: every Kixie call counts (it's an outbound dialer, by definition
  prospect-facing; the AI classifier doesn't run on Kixie).
- **Granola**: only when `call_notes.likely_call_type = 'advisor_call'` from
  the AI classifier. `internal_collaboration`, `vendor_call`, `unknown`, and
  unclassified Granola rows are excluded.

### Metric definitions

1. **Active coaching users** (census) — `reps` rows where `is_active = true AND is_system = false`.
   Independent of the date-range selector. Answers "how many seats are provisioned today?"
2. **Active users in range** (period usage) — distinct `reps` with at least one
   advisor-facing call within the selected date range. Answers "how many reps actually
   used the system in this period?" The two together let you see provisioned-vs-engaged
   without conflating them.
3. **Total advisor-facing calls** — `call_notes` in range matching the advisor-facing
   rule above (excluding tombstoned rows).
4. **% pushed to SFDC** — share of in-range advisor-facing calls with at least one
   `sfdc_write_log` row at `status = 'success'`.
5. **% with AI Feedback** — share of in-range advisor-facing calls whose evaluation
   has at least one `ai_feedback` row at `status = 'approved'` and
   `is_synthetic_test_data = false`.
6. **% with manager Edit Evaluation** — share of in-range advisor-facing calls whose
   evaluation has at least one `evaluation_edit_audit_log` row with `edit_source` in
   (`slack_dm_edit_eval_text`, `slack_dm_edit_eval`). The first is the single-claim
   direct-text editor; the second is the multi-claim modal flow. Both count as a
   manager edit. `slack_dm_single_claim` (the AI-Feedback flag flow) is excluded —
   it's covered by metric #5 (% with AI Feedback) instead.

### Date column

The date for both range filtering and the call-date sort is `call_started_at`
(actual call time), not `created_at` (row insertion time).
