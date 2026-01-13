// Additional formatting utilities if needed beyond date-helpers
export function formatDate(date: string | Date | null | undefined): string {
  // Handle null/undefined
  if (!date) return '';
  
  let d: Date;
  
  if (typeof date === 'string') {
    // Check if it's a DATE type string (YYYY-MM-DD format without time)
    // DATE types should be parsed as local dates, not UTC
    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (dateOnlyPattern.test(date)) {
      // Parse as local date to avoid timezone issues
      const [year, month, day] = date.split('-').map(Number);
      d = new Date(year, month - 1, day);
    } else {
      // TIMESTAMP strings (with time/timezone) - parse normally
      d = new Date(date);
    }
  } else {
    d = date;
  }
  
  // Check if date is valid
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return '';
  }
  
  return d.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  // Handle null/undefined
  if (!date) return '';
  
  // Convert to Date object if string
  const d = typeof date === 'string' ? new Date(date) : date;
  
  // Check if date is valid
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return '';
  }
  
  return d.toLocaleString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
