# Cursor AI Execution Steps - Conversion Trends Enhancement (v2)

## Quick Reference: What We're Building

**Feature 1**: Rolling window (selected quarter + 3 quarters back instead of full year)
**Feature 2**: Period vs Cohort mode toggle with tooltips

### Key Insight: Resolved-Only Cohort Logic

The `vw_funnel_master` view has pre-calculated fields for resolved-only analysis:

| Conversion | Denominator (Resolved Only) | Numerator (Converted) |
|------------|----------------------------|----------------------|
| Contacted→MQL | `eligible_for_contacted_conversions` | `contacted_to_mql_progression` |
| MQL→SQL | `eligible_for_mql_conversions` | `mql_to_sql_progression` |
| SQL→SQO | `eligible_for_sql_conversions` | `sql_to_sqo_progression` |
| SQO→Joined | `eligible_for_sqo_conversions` | `sqo_to_joined_progression` |

**"Resolved" means**: Converted to next stage OR closed/lost. Open records are EXCLUDED.

**Benefits**: 
- No warning banner needed
- Rates always 0-100%
- True funnel efficiency measurement

---

## STEP 1: Update date-helpers.ts

**File**: `src/lib/utils/date-helpers.ts`

**Action**: Add these functions at the END of the file (after existing exports):

```typescript
// ════════════════════════════════════════════════════════════════════════════
// ROLLING WINDOW UTILITIES
// ════════════════════════════════════════════════════════════════════════════

export function getQuarterFromDate(date: string | Date): { year: number; quarter: number } {
  const d = typeof date === 'string' ? new Date(date) : date;
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function calculateQuarterRollingWindow(
  selectedYear: number,
  selectedQuarter: number
): { year: number; quarter: number }[] {
  const quarters: { year: number; quarter: number }[] = [];
  for (let i = 3; i >= 0; i--) {
    let q = selectedQuarter - i;
    let year = selectedYear;
    if (q <= 0) { q += 4; year -= 1; }
    quarters.push({ year, quarter: q });
  }
  return quarters;
}

export function calculateMonthRollingWindow(
  selectedYear: number,
  selectedQuarter: number
): { year: number; month: number }[] {
  const today = new Date();
  const months: { year: number; month: number }[] = [];
  const quarterStartMonth = (selectedQuarter - 1) * 3 + 1;
  
  // 12 months back
  for (let i = 11; i >= 0; i--) {
    const date = new Date(selectedYear, quarterStartMonth - 1 - i, 1);
    months.push({ year: date.getFullYear(), month: date.getMonth() + 1 });
  }
  
  // Completed months in selected quarter
  for (let m = quarterStartMonth; m < quarterStartMonth + 3; m++) {
    const quarterDate = new Date(selectedYear, m - 1, 1);
    if (quarterDate <= today) {
      const exists = months.some(e => e.year === quarterDate.getFullYear() && e.month === m);
      if (!exists) months.push({ year: quarterDate.getFullYear(), month: m });
    }
  }
  
  return months.sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
}

export function getQuarterWindowDateRange(
  quarters: { year: number; quarter: number }[]
): { startDate: string; endDate: string } {
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  const startMonth = (first.quarter - 1) * 3 + 1;
  const endMonth = last.quarter * 3;
  return {
    startDate: `${first.year}-${String(startMonth).padStart(2, '0')}-01`,
    endDate: `${last.year}-${String(endMonth).padStart(2, '0')}-${getDaysInMonth(last.year, endMonth)}`
  };
}

export function getMonthWindowDateRange(
  months: { year: number; month: number }[]
): { startDate: string; endDate: string } {
  const first = months[0];
  const last = months[months.length - 1];
  return {
    startDate: `${first.year}-${String(first.month).padStart(2, '0')}-01`,
    endDate: `${last.year}-${String(last.month).padStart(2, '0')}-${getDaysInMonth(last.year, last.month)}`
  };
}

export function formatQuarterString(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

export function formatMonthString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}
```

---

## STEP 2: Update dashboard.ts types

**File**: `src/types/dashboard.ts`

**Action**: Add this type near the top (after imports, before first interface):

```typescript
export type ConversionTrendMode = 'period' | 'cohort';
```

**Action**: Update TrendDataPoint interface to add isSelectedPeriod:

```typescript
export interface TrendDataPoint {
  period: string;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  isSelectedPeriod?: boolean;  // ADD THIS LINE
}
```

---

## STEP 3: Update conversion-rates.ts

**File**: `src/lib/queries/conversion-rates.ts`

**Action 3.1**: Update imports at top of file:

```typescript
import { 
  buildDateRangeFromFilters,
  getQuarterFromDate,
  calculateQuarterRollingWindow,
  calculateMonthRollingWindow,
  getQuarterWindowDateRange,
  getMonthWindowDateRange,
  formatQuarterString,
  formatMonthString
} from '../utils/date-helpers';
```

**Action 3.2**: Replace the ENTIRE `getConversionTrends` function. Key changes:

1. Accept a `mode` parameter: `mode: 'period' | 'cohort' = 'period'`
2. Calculate rolling window using new utility functions
3. Use `buildPeriodModeQuery` or `buildCohortModeQuery` based on mode

**COHORT MODE KEY DIFFERENCE**: Uses pre-calculated eligibility fields:
```sql
-- Period mode denominator (ALL contacts):
COUNT(*) as contacted_to_mql_denom

-- Cohort mode denominator (RESOLVED contacts only):
SUM(v.eligible_for_contacted_conversions) as contacted_to_mql_denom
```

See the full implementation guide (v2) for complete code.

---

## STEP 4: Update API route

**File**: `src/app/api/dashboard/conversion-rates/route.ts`

**Action**: In the POST handler, extract mode from body and pass to getConversionTrends:

```typescript
const { 
  filters, 
  includeTrends = false, 
  granularity = 'quarter',
  mode = 'period'  // ADD THIS
} = body;

// Later, when calling getConversionTrends:
trends = await getConversionTrends(filteredFilters, granularity, mode);

// In the response, include mode:
return NextResponse.json({ rates, trends, mode });
```

---

## STEP 5: Update api-client.ts

**File**: `src/lib/api-client.ts`

**Action**: Update getConversionRates method to accept and pass mode:

```typescript
getConversionRates: (
  filters: DashboardFilters, 
  options?: { 
    includeTrends?: boolean; 
    granularity?: 'month' | 'quarter';
    mode?: 'period' | 'cohort';  // ADD THIS
  }
) =>
  apiFetch<{ rates: ConversionRates; trends: TrendDataPoint[] | null; mode?: string }>('/api/dashboard/conversion-rates', {
    method: 'POST',
    body: JSON.stringify({ 
      filters, 
      includeTrends: options?.includeTrends ?? false,
      granularity: options?.granularity ?? 'quarter',
      mode: options?.mode ?? 'period',  // ADD THIS
    }),
  }),
```

---

## STEP 6: Update ConversionTrendChart.tsx

**File**: `src/components/dashboard/ConversionTrendChart.tsx`

**Action**: Major rewrite to add:
- Mode toggle buttons with Period and Cohort options
- Info tooltips explaining each mode (hover to see)
- NO warning banner (resolved-only logic eliminates the need)
- Updated props interface

Key additions to props:
```typescript
interface ConversionTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
  mode?: ConversionTrendMode;           // ADD
  onModeChange?: (mode: ConversionTrendMode) => void;  // ADD
  isLoading?: boolean;                  // ADD
}
```

See full implementation guide (v2) for complete component code with tooltips.

---

## STEP 7: Update dashboard page.tsx

**File**: `src/app/dashboard/page.tsx`

**Action 7.1**: Add import:
```typescript
import { ConversionTrendMode } from '@/types/dashboard';
```

**Action 7.2**: Add state:
```typescript
const [trendMode, setTrendMode] = useState<ConversionTrendMode>('period');
const [trendGranularity, setTrendGranularity] = useState<'month' | 'quarter'>('quarter');
```

**Action 7.3**: Update data fetching to include mode:
```typescript
const conversionData = await dashboardApi.getConversionRates(filters, { 
  includeTrends: true, 
  granularity: trendGranularity,
  mode: trendMode,
});
```

**Action 7.4**: Update ConversionTrendChart usage:
```typescript
<ConversionTrendChart
  trends={trends}
  onGranularityChange={(g) => setTrendGranularity(g)}
  mode={trendMode}
  onModeChange={(m) => setTrendMode(m)}
  isLoading={loading}
/>
```

---

## VERIFICATION TEST CASES

After implementation, test with these scenarios:

### Rolling Window Tests

| Test | Filter | Expected Result |
|------|--------|-----------------|
| Rolling Window Q1 2026 | Q1 2026 quarterly | X-axis: 2025-Q2, 2025-Q3, 2025-Q4, 2026-Q1 |
| Rolling Window Q4 2025 | Q4 2025 quarterly | X-axis: 2025-Q1, 2025-Q2, 2025-Q3, 2025-Q4 |
| Cross-year Q2 2026 | Q2 2026 quarterly | X-axis: 2025-Q3, 2025-Q4, 2026-Q1, 2026-Q2 |

### Period Mode Values (Q4 2025)

| Metric | Expected |
|--------|----------|
| SQLs | 193 |
| SQOs | 144 |
| Joined | 17 |
| SQL→SQO | ≈74.6% |
| SQO→Joined | ≈11.6% |

### Cohort Mode Behavior

| Test | Expected |
|------|----------|
| Mode toggle | Updates chart, no warning banner |
| Rates | Always 0-100% (resolved-only) |
| Older periods | Stable rates (all resolved) |
| Tooltips | Show full explanation on hover |

---

## IMPORTANT NOTES

1. **Backup**: Create backup of conversion-rates.ts before modifying
2. **Order**: Follow steps 1-7 in order to avoid import errors
3. **Testing**: Test each step before moving to next
4. **Q4 2025 Baseline**: Period mode Q4 2025 should match scorecard values exactly
5. **NO Warning Banner**: Cohort mode uses resolved-only logic, so no banner needed
6. **Resolved Definition**: Converted to next stage OR closed/lost (Disposition__c IS NOT NULL or StageName = 'Closed Lost')

---

## Key Differences Summary

| Aspect | Period Mode | Cohort Mode |
|--------|-------------|-------------|
| Includes | ALL records | RESOLVED records only |
| Open records | Included | EXCLUDED |
| Denominator | COUNT(*) | SUM(eligible_for_*) |
| Numerator | COUNTIF(is_*) | SUM(*_progression) |
| Rate range | Can exceed 100% | Always 0-100% |
| Warning banner | Not needed | Not needed |
