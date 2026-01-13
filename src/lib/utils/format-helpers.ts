// Additional formatting utilities if needed beyond date-helpers
export function formatDate(date: string | Date | null | undefined): string {
  // Handle null/undefined
  if (!date) return '';
  
  // Convert to Date object if string
  const d = typeof date === 'string' ? new Date(date) : date;
  
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
