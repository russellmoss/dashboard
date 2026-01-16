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
