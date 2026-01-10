# Conversion Trends Chart - Tooltip Content Reference (v2)

## Overview

This document contains all UI text for the conversion trends chart enhancements, including:
- Mode toggle tooltips
- Footer explanations
- Use case recommendations

**Key Change from v1**: Cohort mode now uses **resolved-only logic** - open records are excluded from denominators, so no warning banner is needed.

---

## Mode Explanations (for UI tooltips)

### Period Mode Tooltip

**Title**: Period Mode (Activity-Based)

**Short Description**: Shows conversion activity that occurred in each period.

**Example**: An SQL from Q3 that becomes SQO in Q4 counts toward Q4's rate.

**Details**:
- Answers: "What happened in this period?"
- Includes ALL records, including those still in progress
- Rates can exceed 100% when converting older leads
- Best for: Activity tracking, sales performance, executive dashboards

**Calculation Formula**:
```
SQL→SQO Rate = (SQOs created in period) ÷ (SQLs created in period)
```

---

### Cohort Mode Tooltip

**Title**: Cohort Mode (Efficiency-Based)

**Short Description**: Tracks how well leads from each period convert over time.

**Example**: An SQL from Q3 that becomes SQO in Q4 counts toward Q3's rate.

**Details**:
- Answers: "How well do leads from this period convert?"
- Only includes RESOLVED records (converted OR closed/lost)
- Open records are excluded from denominators
- Rates are always 0-100%
- Best for: Funnel efficiency, forecasting, process improvement

**Calculation Formula**:
```
SQL→SQO Rate = (Resolved SQLs that became SQO) ÷ (Resolved SQLs)
```

**Resolved Definition**:
```
Resolved = either converted to next stage OR closed/lost
```

---

## Legend Footer Explanations

### Period Mode Footer
> **Period Mode:** Shows conversion activity in each period. An SQL from Q3 that becomes SQO in Q4 counts toward Q4's rate. Includes all records. Rates can exceed 100% when converting older leads.

### Cohort Mode Footer
> **Cohort Mode:** Tracks each cohort through the funnel using only resolved records. An SQL from Q3 that becomes SQO in Q4 counts toward Q3's rate. Open records (still in progress) are excluded. Rates are always 0-100%.

---

## Subtitle Text (below chart title)

### Period Mode Subtitle
> Activity view: What happened in each period

### Cohort Mode Subtitle
> Cohort view: How well resolved leads from each period convert

---

## What is a "Resolved" Record?

A record is **resolved** when it has reached a final outcome - either converted to the next stage OR been closed/lost. This is determined by:

| Stage | Converted | Closed/Lost |
|-------|-----------|-------------|
| Contact | is_mql = 1 | Disposition__c IS NOT NULL |
| MQL | is_sql = 1 | Disposition__c IS NOT NULL |
| SQL | is_sqo = 1 | Disposition__c IS NOT NULL OR StageName = 'Closed Lost' |
| SQO | is_joined = 1 | StageName = 'Closed Lost' |

**Open records** (neither converted nor closed) are **excluded** from cohort denominators to prevent:
- Artificially low rates for recent periods
- The need for warning banners
- Confusion about "incomplete" data

---

## Conversion Rate Definitions by Mode

### Contacted → MQL

**Period Mode:**
- Numerator: MQLs created in period (`COUNTIF(is_mql = 1)`)
- Denominator: Contacts created in period (`COUNT(*)`)
- Date Field: `stage_entered_contacting__c`

**Cohort Mode:**
- Numerator: Resolved contacts that became MQL (`SUM(contacted_to_mql_progression)`)
- Denominator: Resolved contacts (`SUM(eligible_for_contacted_conversions)`)
- Date Field: `stage_entered_contacting__c`
- Excluded: Contacts where `is_mql = 0 AND Disposition__c IS NULL`

---

### MQL → SQL

**Period Mode:**
- Numerator: SQLs created in period (`COUNTIF(is_sql = 1)`)
- Denominator: MQLs created in period (`COUNTIF(is_mql = 1)`)
- Numerator Date: `converted_date_raw`
- Denominator Date: `stage_entered_contacting__c`

**Cohort Mode:**
- Numerator: Resolved MQLs that became SQL (`SUM(mql_to_sql_progression)`)
- Denominator: Resolved MQLs (`SUM(eligible_for_mql_conversions)`)
- Date Field: `stage_entered_contacting__c`
- Excluded: MQLs where `is_sql = 0 AND Disposition__c IS NULL`

---

### SQL → SQO

**Period Mode:**
- Numerator: SQOs created in period (`COUNTIF(is_sqo_unique = 1)`)
- Denominator: SQLs created in period (`COUNTIF(is_sql = 1)`)
- Numerator Date: `Date_Became_SQO__c`
- Denominator Date: `converted_date_raw`

**Cohort Mode:**
- Numerator: Resolved SQLs that became SQO (`SUM(sql_to_sqo_progression)`)
- Denominator: Resolved SQLs (`SUM(eligible_for_sql_conversions)`)
- Date Field: `converted_date_raw`
- Excluded: SQLs where not (joined OR SQO OR closed)

---

### SQO → Joined

**Period Mode:**
- Numerator: Joined in period (`COUNTIF(is_joined_unique = 1)`)
- Denominator: SQOs created in period (`COUNTIF(SQO_raw = 'yes')`)
- Numerator Date: `advisor_join_date__c`
- Denominator Date: `Date_Became_SQO__c`

**Cohort Mode:**
- Numerator: Resolved SQOs that Joined (`SUM(sqo_to_joined_progression)`)
- Denominator: Resolved SQOs (`SUM(eligible_for_sqo_conversions)`)
- Date Field: `Date_Became_SQO__c`
- Excluded: SQOs where `is_joined = 0 AND StageName != 'Closed Lost'`

---

## Use Case Recommendations

### When to Use Period Mode

| Use Case | Why Period Mode |
|----------|-----------------|
| Executive dashboards | Shows actual activity levels |
| Weekly/monthly sales reviews | "What did we accomplish?" |
| Activity tracking vs. targets | Measures team output |
| Pipeline velocity analysis | See when deals progress |

**Example questions Period Mode answers:**
- "How many SQOs did we create this quarter?"
- "Are we converting more leads to SQL this month?"
- "What was our join rate activity in Q4?"

---

### When to Use Cohort Mode

| Use Case | Why Cohort Mode |
|----------|-----------------|
| Funnel efficiency analysis | True conversion rates |
| Forecasting and modeling | Predictable 0-100% rates |
| Process improvement | Compare cohort performance |
| Marketing attribution | Which sources convert best? |
| Board presentations | Clean, interpretable metrics |

**Example questions Cohort Mode answers:**
- "What percentage of Q3 SQLs became SQOs?"
- "Is our funnel getting more efficient over time?"
- "Which lead source has the best SQL→SQO rate?"
- "How long does it take cohorts to fully resolve?"

---

## Why No Warning Banner?

**Previous approach** (flawed):
```
Cohort Rate = Conversions / All records in cohort
```
This included open records in the denominator, making recent periods appear to have low rates. A warning banner was needed to explain this.

**New approach** (resolved-only):
```
Cohort Rate = Conversions / Resolved records in cohort
```
This excludes open records, so rates represent **true efficiency** among leads that have reached an outcome. No warning needed!

**Benefits of resolved-only:**
1. No confusing warning banners
2. Rates are always interpretable (0-100%)
3. Recent periods are accurate (just smaller sample sizes)
4. Apples-to-apples comparison across periods
5. Matches how the `vw_funnel_master` view calculates eligibility

---

## Sample Tooltip Component Code

```tsx
const ModeTooltip = ({ mode }: { mode: 'period' | 'cohort' }) => {
  const content = {
    period: {
      title: 'Period Mode (Activity-Based)',
      description: 'Shows conversion activity that occurred in each period.',
      example: 'An SQL from Q3 that becomes SQO in Q4 counts toward Q4\'s rate.',
      details: [
        'Answers: "What happened in this period?"',
        'Includes ALL records, including those still in progress',
        'Rates can exceed 100% when converting older leads',
        'Best for: Activity tracking, sales performance',
      ],
      formula: 'Rate = (SQOs created in period) ÷ (SQLs created in period)',
    },
    cohort: {
      title: 'Cohort Mode (Efficiency-Based)',
      description: 'Tracks how well leads from each period convert over time.',
      example: 'An SQL from Q3 that becomes SQO in Q4 counts toward Q3\'s rate.',
      details: [
        'Answers: "How well do leads from this period convert?"',
        'Only includes RESOLVED records (converted OR closed)',
        'Open records are excluded from denominators',
        'Rates are always 0-100%',
        'Best for: Funnel efficiency, forecasting',
      ],
      formula: 'Rate = (Resolved SQLs that became SQO) ÷ (Resolved SQLs)',
      note: 'Resolved = converted to next stage OR closed/lost',
    },
  };
  
  // Render tooltip UI with content[mode]
};
```

---

## Expected Values Comparison

### Q4 2025 Example

| Metric | Period Mode | Cohort Mode | Why Different? |
|--------|-------------|-------------|----------------|
| SQL→SQO Rate | ~74.6% | May vary | Cohort excludes open SQLs |
| SQO→Joined Rate | ~11.6% | May vary | Cohort excludes open SQOs |
| SQLs | 193 | 193 | Same (volume, not rate) |
| SQOs | 144 | 144 | Same (volume, not rate) |

**Note**: Period mode should match scorecard exactly. Cohort mode may show different rates because it only includes resolved records.

---

## Glossary

| Term | Definition |
|------|------------|
| **Resolved** | A record that has either converted to the next stage OR been closed/lost |
| **Open** | A record still in progress (neither converted nor closed) |
| **Cohort** | A group of records that entered a stage during the same period |
| **Period** | A time interval (quarter or month) used for grouping |
| **Eligibility Field** | Pre-calculated field in vw_funnel_master indicating resolved status |
| **Progression Field** | Pre-calculated field indicating conversion to next stage |
| **Disposition__c** | Salesforce field indicating a lead was closed/lost (any non-NULL value) |
| **StageName** | Opportunity stage field; 'Closed Lost' indicates lost opportunity |

---

*For questions about these definitions, reference `conversion_rate_explanations.md` and `vw_funnel_master.sql`.*
