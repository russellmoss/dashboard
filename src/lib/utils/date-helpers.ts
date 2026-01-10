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
