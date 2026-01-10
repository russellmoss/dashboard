# Conversion Rate Chart Enhancements

## Overview

This document outlines the enhancements needed for the Conversion Trends Chart to properly display data based on the selected date filter, support both Period and Cohort modes, and show the correct time range in the chart.

## Current Issue

**Problem**: When filtering by Q1 2026, the chart displays Q1-Q4 2024 on the x-axis (wrong year).

**Root Cause**: The current implementation always shows the full year of the selected period's year, but it's incorrectly calculating which year to display. Additionally, it doesn't show a rolling window of periods relative to the selected period.

---

## Desired Behavior

### Quarterly Granularity

When a **quarter** is selected in the date filter:

**Example: Q1 2026 Selected**
- **Chart should display**: Q2 2025, Q3 2025, Q4 2025, Q1 2026
- **Logic**: Show the selected quarter + 3 quarters behind it (rolling 4-quarter window)
- **X-axis labels**: Should show the correct quarters (2025-Q2, 2025-Q3, 2025-Q4, 2026-Q1)

**Example: Q4 2025 Selected**
- **Chart should display**: Q1 2025, Q2 2025, Q3 2025, Q4 2025
- **Logic**: Show the selected quarter + 3 quarters behind it

**Example: Q2 2026 Selected**
- **Chart should display**: Q3 2025, Q4 2025, Q1 2026, Q2 2026
- **Logic**: Show the selected quarter + 3 quarters behind it

### Monthly Granularity

When a **quarter** is selected in the date filter but **monthly** granularity is chosen:

**Example: Q1 2026 Selected (January 1 - March 31, 2026)**
- **Chart should display**: 
  - All months in Q1 2026 that are completed or current (e.g., if today is Feb 15, 2026, show Jan 2026, Feb 2026)
  - Plus 12 months back from the start of Q1 2026
  - **Total**: Up to 15 months (12 months back + up to 3 months in Q1 2026)

**Example: Q1 2026 Selected, Today = February 15, 2026**
- **Chart should display**: 
  - Feb 2025, Mar 2025, Apr 2025, May 2025, Jun 2025, Jul 2025, Aug 2025, Sep 2025, Oct 2025, Nov 2025, Dec 2025, Jan 2026, Feb 2026
  - **Logic**: 12 months back from Jan 2026 + completed months in Q1 2026

**Example: Q1 2026 Selected, Today = January 10, 2026**
- **Chart should display**: 
  - Feb 2025, Mar 2025, Apr 2025, May 2025, Jun 2025, Jul 2025, Aug 2025, Sep 2025, Oct 2025, Nov 2025, Dec 2025, Jan 2026
  - **Logic**: 12 months back from Jan 2026 + only completed months in Q1 2026

**Example: Q4 2025 Selected (October 1 - December 31, 2025), Today = December 20, 2025**
- **Chart should display**: 
  - Nov 2024, Dec 2024, Jan 2025, Feb 2025, Mar 2025, Apr 2025, May 2025, Jun 2025, Jul 2025, Aug 2025, Sep 2025, Oct 2025, Nov 2025, Dec 2025
  - **Logic**: 12 months back from Oct 2025 + completed months in Q4 2025

### When a Month is Selected

If the date filter allows selecting a specific month (not just quarter):

**Example: January 2026 Selected**
- **Chart should display**: 
  - February 2025 through January 2026 (12 months back + selected month)
  - **Total**: 12 months

---

## Period vs Cohort Mode

The chart must support both **Period Mode** and **Cohort Mode** as described in `period-cohort-toggle-implementation.md`.

### Period Mode (Activity-Based)

**Question Answered**: "What happened in this period?"

- **Behavior**: Shows conversion activity that occurred in each period
- **Example**: An SQL from Q3 2025 that becomes SQO in Q4 2025 counts toward Q4 2025's SQO numbers
- **Rates**: Can exceed 100% when converting older leads
- **Use Case**: Activity tracking, sales performance, executive dashboards

**Date Range Logic**:
- For each period shown, count conversions that **happened** in that period
- Numerators and denominators grouped by their respective date fields (as currently implemented)

### Cohort Mode (Efficiency-Based)

**Question Answered**: "How well do leads from this period convert?"

- **Behavior**: Tracks each cohort through the funnel
- **Example**: An SQL from Q3 2025 that becomes SQO in Q4 2025 counts toward Q3 2025's rate (because they became SQL in Q3)
- **Rates**: Always 0-100%
- **Use Case**: Funnel efficiency, forecasting, process improvement
- **Note**: Recent periods show lower rates because conversions are still in progress

**Date Range Logic**:
- For each period shown, count conversions for leads that **entered that stage** in that period
- All metrics for a conversion are grouped by when the lead entered that stage (the denominator date)

**Important**: The rolling window logic (selected period + N periods back) applies to **both** Period and Cohort modes. The difference is in **how** conversions are counted, not **which periods** are shown.

---

## Implementation Requirements

### 1. Date Range Calculation

**Current Implementation** (Incorrect):
```typescript
const { startDate } = buildDateRangeFromFilters(filters);
const selectedYear = new Date(startDate).getFullYear();
const trendStartDate = `${selectedYear}-01-01`;
const trendEndDate = `${selectedYear}-12-31 23:59:59`;
```

**Required Implementation**:

#### For Quarterly Granularity:
```typescript
// Calculate the selected quarter
const { startDate, endDate } = buildDateRangeFromFilters(filters);
const selectedQuarter = getQuarterFromDate(startDate); // e.g., { year: 2026, quarter: 1 }
const selectedYear = selectedQuarter.year;
const selectedQ = selectedQuarter.quarter;

// Calculate 4 quarters back from selected quarter
const quartersToShow = [];
for (let i = 3; i >= 0; i--) {
  const q = selectedQ - i;
  const year = q <= 0 ? selectedYear - 1 : selectedYear;
  const quarter = q <= 0 ? q + 4 : q;
  quartersToShow.push({ year, quarter });
}

// Set date range to cover all quarters
const trendStartDate = `${quartersToShow[0].year}-${(quartersToShow[0].quarter - 1) * 3 + 1}-01`;
const trendEndDate = `${quartersToShow[3].year}-${quartersToShow[3].quarter * 3}-${getDaysInMonth(quartersToShow[3].year, quartersToShow[3].quarter * 3)} 23:59:59`;
```

#### For Monthly Granularity:
```typescript
const { startDate, endDate } = buildDateRangeFromFilters(filters);
const selectedDate = new Date(startDate);
const selectedYear = selectedDate.getFullYear();
const selectedMonth = selectedDate.getMonth() + 1; // 1-12

// Calculate 12 months back + months in selected quarter
const today = new Date();
const monthsToShow = [];

// Add 12 months back
for (let i = 11; i >= 0; i--) {
  const date = new Date(selectedYear, selectedMonth - 1 - i, 1);
  monthsToShow.push({ year: date.getFullYear(), month: date.getMonth() + 1 });
}

// Add months in selected quarter that are completed or current
const quarterStartMonth = Math.floor((selectedMonth - 1) / 3) * 3 + 1;
for (let m = quarterStartMonth; m < quarterStartMonth + 3; m++) {
  const quarterDate = new Date(selectedYear, m - 1, 1);
  if (quarterDate <= today) {
    monthsToShow.push({ year: quarterDate.getFullYear(), month: m });
  }
}

// Set date range
const firstMonth = monthsToShow[0];
const lastMonth = monthsToShow[monthsToShow.length - 1];
const trendStartDate = `${firstMonth.year}-${String(firstMonth.month).padStart(2, '0')}-01`;
const trendEndDate = `${lastMonth.year}-${String(lastMonth.month).padStart(2, '0')}-${getDaysInMonth(lastMonth.year, lastMonth.month)} 23:59:59`;
```

### 2. Query Filtering

The BigQuery query should:
1. Filter data to only include periods within the calculated date range
2. Group by the correct period format (quarter: '2025-Q4', month: '2025-10')
3. Support both Period and Cohort modes (as per `period-cohort-toggle-implementation.md`)

### 3. Period Formatting

**Quarterly**: `'YYYY-QN'` format (e.g., '2025-Q4', '2026-Q1')
**Monthly**: `'YYYY-MM'` format (e.g., '2025-10', '2026-01')

### 4. X-Axis Display

The chart's x-axis should:
- Display periods in chronological order (oldest to newest)
- Show the correct period labels matching the data
- Handle year transitions properly (e.g., '2025-Q4' → '2026-Q1')

---

## User Experience Requirements

### Visual Indicators

1. **Selected Period Highlighting**: The selected period (e.g., Q1 2026) should be visually distinct in the chart
2. **Current Period Indicator**: If showing current/partial periods, indicate which periods are complete vs. in-progress
3. **Mode Toggle**: Clear toggle between Period and Cohort modes with explanatory text

### Chart Behavior

1. **Consistent Period Count**: Always show exactly 4 quarters or 12-15 months (depending on granularity)
2. **No Empty Periods**: If a period has no data, show 0 values rather than omitting the period
3. **Smooth Transitions**: When changing filters, the chart should smoothly update without flickering

---

## Testing Scenarios

### Quarterly Testing

| Selected Filter | Expected X-Axis | Notes |
|----------------|-----------------|-------|
| Q1 2026 | Q2 2025, Q3 2025, Q4 2025, Q1 2026 | 4 quarters, ends with selected |
| Q4 2025 | Q1 2025, Q2 2025, Q3 2025, Q4 2025 | 4 quarters, ends with selected |
| Q2 2026 | Q3 2025, Q4 2025, Q1 2026, Q2 2026 | Cross-year boundary |

### Monthly Testing

| Selected Filter | Today's Date | Expected X-Axis | Notes |
|----------------|--------------|-----------------|-------|
| Q1 2026 | Feb 15, 2026 | Feb 2025 - Feb 2026 (13 months) | Includes completed months in Q1 |
| Q1 2026 | Jan 10, 2026 | Feb 2025 - Jan 2026 (12 months) | Only Jan completed |
| Q4 2025 | Dec 20, 2025 | Nov 2024 - Dec 2025 (14 months) | Includes Oct, Nov, Dec 2025 |

### Mode Testing

| Mode | Selected Period | Expected Behavior |
|------|----------------|-------------------|
| Period | Q4 2025 | Shows Q1-Q4 2025, counts conversions by when they happened |
| Cohort | Q4 2025 | Shows Q1-Q4 2025, counts conversions by when leads entered stage |
| Period | Q1 2026 | Shows Q2 2025-Q1 2026, counts conversions by when they happened |
| Cohort | Q1 2026 | Shows Q2 2025-Q1 2026, counts conversions by when leads entered stage |

---

## Implementation Checklist

### Phase 1: Fix Date Range Calculation
- [ ] Update `getConversionTrends()` to calculate rolling window based on selected period
- [ ] Implement quarterly rolling window (selected + 3 quarters back)
- [ ] Implement monthly rolling window (12 months back + completed months in selected quarter)
- [ ] Fix year calculation to use selected period's year, not current year
- [ ] Test with various quarter selections (Q1-Q4, different years)

### Phase 2: Add Cohort Mode Support
- [ ] Add `mode` parameter to `getConversionTrends()` function
- [ ] Implement `buildCohortQuery()` function (as per `period-cohort-toggle-implementation.md`)
- [ ] Update API route to accept `mode` parameter
- [ ] Update API client to pass `mode` parameter
- [ ] Test both Period and Cohort modes with same date ranges

### Phase 3: Update UI Components
- [ ] Add mode toggle to `ConversionTrendChart` component
- [ ] Update chart to highlight selected period
- [ ] Add explanatory text for each mode
- [ ] Update x-axis to show correct period labels
- [ ] Test visual indicators and transitions

### Phase 4: Edge Cases and Polish
- [ ] Handle year boundaries (e.g., Q1 showing previous year's Q2-Q4)
- [ ] Handle current/partial periods (show only completed months)
- [ ] Handle empty periods (show 0 values)
- [ ] Add loading states during mode/filter changes
- [ ] Test with various date presets (QTD, YTD, custom ranges)

---

## Reference Documents

- `period-cohort-toggle-implementation.md` - Detailed implementation guide for Period vs Cohort toggle
- `conversion-rates-chart-bug.md` - Previous bug fix documentation
- `cursor-ai-fix-instructions.md` - Step-by-step fix instructions (completed)

---

## Success Criteria

The enhancement is complete when:

1. ✅ Selecting Q1 2026 shows Q2 2025, Q3 2025, Q4 2025, Q1 2026 on x-axis (not 2024)
2. ✅ Selecting any quarter shows that quarter + 3 quarters behind it
3. ✅ Monthly granularity shows 12 months back + completed months in selected quarter
4. ✅ Period mode shows activity-based conversions
5. ✅ Cohort mode shows efficiency-based conversions
6. ✅ Mode toggle works correctly and updates chart data
7. ✅ X-axis labels are correct and in chronological order
8. ✅ Chart handles year boundaries correctly
9. ✅ No console errors or data mismatches

---

## Notes

- The current bug (showing 2024 when 2026 is selected) suggests the year calculation is using the wrong reference point
- The rolling window approach ensures users always see context (previous periods) while focusing on the selected period
- Cohort mode is particularly useful for forecasting and understanding funnel efficiency over time
- Period mode is better for executive dashboards showing current activity levels
