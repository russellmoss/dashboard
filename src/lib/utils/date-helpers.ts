import { DashboardFilters } from '@/types/filters';

export function buildDateRangeFromFilters(filters: DashboardFilters): {
  startDate: string;
  endDate: string;
} {
  const year = filters.year || new Date().getFullYear();
  const today = new Date().toISOString().split('T')[0];
  
  switch (filters.datePreset) {
    case 'ytd':
      return { startDate: `${year}-01-01`, endDate: today };
    
    case 'qtd': {
      const quarter = Math.floor((new Date().getMonth() / 3));
      const quarterStart = new Date(year, quarter * 3, 1);
      return { 
        startDate: quarterStart.toISOString().split('T')[0], 
        endDate: today 
      };
    }
    
    case 'q1':
      return { startDate: `${year}-01-01`, endDate: `${year}-03-31` };
    
    case 'q2':
      return { startDate: `${year}-04-01`, endDate: `${year}-06-30` };
    
    case 'q3':
      return { startDate: `${year}-07-01`, endDate: `${year}-09-30` };
    
    case 'q4':
      return { startDate: `${year}-10-01`, endDate: `${year}-12-31` };
    
    case 'last30': {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return { 
        startDate: thirtyDaysAgo.toISOString().split('T')[0], 
        endDate: today 
      };
    }
    
    case 'last90': {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      return { 
        startDate: ninetyDaysAgo.toISOString().split('T')[0], 
        endDate: today 
      };
    }
    
    case 'custom':
    default:
      return { 
        startDate: filters.startDate, 
        endDate: filters.endDate 
      };
  }
}

export function formatCurrency(value: number | null | undefined): string {
  const v = Number(value) || 0;
  if (v >= 1000000000) return '$' + (v / 1000000000).toFixed(1) + 'B';
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(0) + 'M';
  if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

export function formatPercent(value: number | null | undefined): string {
  const v = Number(value) || 0;
  return (v * 100).toFixed(1) + '%';
}

export function formatNumber(value: number | null | undefined): string {
  const v = Number(value) || 0;
  return v.toLocaleString();
}

// ════════════════════════════════════════════════════════════════════════════
// ROLLING WINDOW UTILITIES
// ════════════════════════════════════════════════════════════════════════════

export function getQuarterFromDate(date: string | Date): { year: number; quarter: number } {
  let d: Date;
  if (typeof date === 'string') {
    // Parse date string as local date to avoid timezone issues
    // Format: YYYY-MM-DD
    const [year, month, day] = date.split('-').map(Number);
    d = new Date(year, month - 1, day); // month is 0-indexed in Date constructor
  } else {
    d = date;
  }
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
