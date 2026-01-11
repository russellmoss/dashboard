/**
 * Reusable UI Patterns
 * 
 * CURSOR AI: Import these for consistent styling.
 * Example: import { CARD_STYLES, TABLE_STYLES } from '@/config/ui';
 */

export const CARD_STYLES = {
  base: 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm',
  hover: 'hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200',
  selected: 'ring-2 ring-blue-500 border-blue-500',
  padding: {
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  },
} as const;

export const TABLE_STYLES = {
  container: 'overflow-x-auto',
  table: 'min-w-full divide-y divide-gray-200 dark:divide-gray-700',
  header: {
    row: 'bg-gray-50 dark:bg-gray-900',
    cell: 'px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider',
  },
  body: {
    row: {
      base: 'border-b border-gray-100 dark:border-gray-800',
      even: 'bg-white dark:bg-gray-800',
      odd: 'bg-gray-50 dark:bg-gray-900',
      hover: 'hover:bg-blue-50 dark:hover:bg-blue-900/20',
      selected: 'bg-blue-100 dark:bg-blue-900/30',
    },
    cell: 'px-4 py-3 text-sm text-gray-900 dark:text-gray-100',
  },
} as const;

export const INPUT_STYLES = {
  base: 'w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500',
  focus: 'focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none',
  error: 'border-red-500 focus:ring-red-500',
} as const;

export const BUTTON_STYLES = {
  base: 'inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-200',
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  secondary: 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  size: {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  },
} as const;

export function getTableRowClasses(index: number, isSelected = false, isClickable = false): string {
  const base = TABLE_STYLES.body.row.base;
  const zebra = index % 2 === 0 ? TABLE_STYLES.body.row.even : TABLE_STYLES.body.row.odd;
  const hover = isClickable ? TABLE_STYLES.body.row.hover : '';
  const selected = isSelected ? TABLE_STYLES.body.row.selected : '';
  const cursor = isClickable ? 'cursor-pointer' : '';
  
  return `${base} ${zebra} ${hover} ${selected} ${cursor}`.trim();
}
