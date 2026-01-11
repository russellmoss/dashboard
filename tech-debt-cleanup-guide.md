# Tech Debt Cleanup Guide - Savvy Funnel Analytics Dashboard

**Purpose**: Step-by-step instructions for Cursor AI to safely clean up technical debt  
**Estimated Time**: 5-7 hours  
**Risk Level**: Low (isolated changes, high-leverage patterns)  
**Current State**: Pre-flight complete, on `tech-debt-cleanup` branch, build passing

---

## Current Repository State

**Branch**: `tech-debt-cleanup` (created from main)  
**Build**: ✅ Passing  
**Uncommitted Changes**:
- `src/app/login/page.tsx` - Password visibility toggle feature
- `src/components/dashboard/ConversionTrendChart.tsx` - BarChart conversion + partial dark mode

**Existing UI Components**:
- `ErrorBoundary.tsx` - Exists but needs upgrade (no dark mode, no HOC, always logs)
- `ExportButton.tsx`
- `LoadingSpinner.tsx`
- `ThemeToggle.tsx`

---

## Why This Order Matters

| Phase | What | Why First |
|-------|------|-----------|
| 0 | Commit Feature Changes | Clean separation between features and tech debt |
| 1 | Upgrade Error Boundaries | Reusable pattern Cursor copies to all new components |
| 2 | Theme & UI Constants | Every new chart/table/card will use these |
| 3 | Type Safety | Improves all future generated code quality |
| 4 | Console.log Removal | Stops Cursor from copying debug patterns |
| 5 | Final Verification | Ensures everything works together |

---

## ⚠️ CRITICAL RULES FOR CURSOR AI

**READ THESE BEFORE EVERY PHASE:**

1. **DO NOT** modify `src/lib/queries/conversion-rates.ts` except to remove console.log statements
2. **DO NOT** change any business logic, calculation formulas, or SQL queries
3. **DO NOT** modify any files in `src/lib/queries/` beyond logging changes
4. **ALWAYS** run the verification gate after each phase before proceeding
5. **STOP IMMEDIATELY** if `npm run build` fails - report the error and wait for instructions
6. **NEVER** proceed to the next phase until the current verification gate passes
7. **SHOW YOUR WORK** - display before/after for every file modification

---

## PHASE 0: Commit Existing Feature Changes

### Why This Phase Exists
There are uncommitted feature changes (password toggle, chart conversion) that should be committed separately from tech debt cleanup. This keeps the git history clean and makes it easy to revert if needed.

---

### Step 0.1: Commit Feature Changes

#### Cursor AI Prompt:
```
Commit the existing feature changes that are unrelated to tech debt cleanup.

Run these commands:
1. git add src/app/login/page.tsx src/components/dashboard/ConversionTrendChart.tsx
2. git commit -m "feat: add password visibility toggle and convert trend chart to bar chart"

Report the output of each command.
```

#### Expected Result:
- Commit created successfully with 2 files changed

---

### Step 0.2: Add Documentation Files

#### Cursor AI Prompt:
```
Add the documentation files to the repo:

1. git add TECHNICAL_DEBT_ASSESSMENT.md tech-debt-cleanup-guide.md
2. git commit -m "docs: add technical debt assessment and cleanup guide"

Report the output.
```

---

### ✅ VERIFICATION GATE 0

#### Cursor AI Prompt:
```
Verify clean state:
1. git status (should show nothing to commit, working tree clean)
2. git log --oneline -3 (show last 3 commits)

Report results.
```

#### Expected Results:
- Working tree clean
- Two new commits visible in log

---

## PHASE 1: Upgrade Error Boundaries (HIGH LEVERAGE)

### Current State
`src/components/ui/ErrorBoundary.tsx` exists but is missing:
- Dark mode support
- Dev-mode-only logging
- HOC wrapper (withErrorBoundary)
- Customizable title/message props
- Icon in fallback UI

---

### Step 1.1: Upgrade Existing ErrorBoundary Component

#### Cursor AI Prompt:
```
Open src/components/ui/ErrorBoundary.tsx and REPLACE its entire contents with an upgraded version.

The upgraded version must have:
1. 'use client' directive
2. Dark mode support (dark: Tailwind variants throughout)
3. Dev-mode-only logging (check process.env.NODE_ENV === 'development')
4. Customizable props: fallbackTitle, fallbackMessage, onReset
5. AlertTriangle icon from lucide-react in the fallback UI
6. RefreshCw icon on the "Try Again" button
7. Export a withErrorBoundary HOC wrapper function
8. Use handleReset that calls setState AND optional onReset callback (NOT window.location.reload)

Show me the complete new file contents.
```

#### Expected File: `src/components/ui/ErrorBoundary.tsx`

```typescript
'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Only log in development mode
    if (process.env.NODE_ENV === 'development') {
      console.error('[ErrorBoundary] Caught error:', error);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg min-h-[200px]">
          <AlertTriangle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            {this.props.fallbackTitle || 'Something went wrong'}
          </h3>
          <p className="text-sm text-red-600 dark:text-red-300 mb-4 text-center max-w-md">
            {this.props.fallbackMessage || 'An error occurred while loading this section. Please try again.'}
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="text-xs bg-red-100 dark:bg-red-900/40 p-3 rounded mb-4 max-w-full overflow-auto text-red-700 dark:text-red-300 font-mono">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Higher-order component wrapper for functional components
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );
  
  WithErrorBoundary.displayName = `withErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;
  
  return WithErrorBoundary;
}
```

#### Verification:
```
After updating the file, run: npm run build
Report if build passes or fails.
```

---

### Step 1.2: Create Dashboard-Specific Error Boundaries

#### Cursor AI Prompt:
```
Create a new file at src/components/ui/DashboardErrorBoundaries.tsx

This file provides pre-configured error boundaries for specific dashboard sections.

Create these components:
1. ChartErrorBoundary - for Recharts and chart components
2. TableErrorBoundary - for data tables
3. CardErrorBoundary - for scorecard and metric cards
4. FilterErrorBoundary - for the global filters section

Each should import ErrorBoundary from './ErrorBoundary' and have appropriate default messages.

Create the complete file now.
```

#### Expected File: `src/components/ui/DashboardErrorBoundaries.tsx`

```typescript
'use client';

import { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface SectionErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

export function ChartErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Chart Failed to Load"
      fallbackMessage="There was a problem rendering this chart. This might be due to invalid data or a temporary issue. Click 'Try Again' to reload."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}

export function TableErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Table Failed to Load"
      fallbackMessage="There was a problem displaying this data table. The data might be temporarily unavailable."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}

export function CardErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Failed to Load"
      fallbackMessage="This metric could not be loaded. Please try again."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}

export function FilterErrorBoundary({ children, onReset }: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallbackTitle="Filters Unavailable"
      fallbackMessage="The filter controls failed to load. You can still view the dashboard with default settings."
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  );
}
```

---

### Step 1.3: Update UI Component Exports

#### Cursor AI Prompt:
```
Check if src/components/ui/index.ts exists.

If it EXISTS: Add exports for withErrorBoundary (from ErrorBoundary.tsx) and all four Dashboard error boundaries. Keep existing exports.

If it does NOT exist: Create it with exports for ErrorBoundary, withErrorBoundary, and Dashboard error boundaries.

Show me the final file contents.
```

#### Expected Exports:
```typescript
// Error Boundaries
export { ErrorBoundary, withErrorBoundary } from './ErrorBoundary';
export {
  ChartErrorBoundary,
  TableErrorBoundary,
  CardErrorBoundary,
  FilterErrorBoundary,
} from './DashboardErrorBoundaries';

// Keep any existing exports below
```

---

### Step 1.4: Wrap Dashboard Components with Error Boundaries

#### Cursor AI Prompt:
```
Open src/app/dashboard/page.tsx

Add error boundary wrappers around the main dashboard components.

1. Add this import at the top with other imports:
   import { ChartErrorBoundary, TableErrorBoundary, CardErrorBoundary, FilterErrorBoundary } from '@/components/ui';

2. Find and wrap these components in the JSX:
   - Any Chart components (ConversionTrendChart, etc.) → wrap with <ChartErrorBoundary>
   - Any Table components → wrap with <TableErrorBoundary>
   - GlobalFilters → wrap with <FilterErrorBoundary>
   - Scorecard sections → wrap with <CardErrorBoundary>

IMPORTANT:
- Do NOT change any props passed to components
- Do NOT change any other code
- Only add wrapper components

Show me each change with before/after snippets.
```

---

### ✅ VERIFICATION GATE 1

#### Cursor AI Prompt:
```
Run verification:
1. npm run build
2. npm run dev (start server)
3. Open http://localhost:3000/dashboard
4. Verify dashboard loads without errors
5. Check browser console for errors

Report PASS or FAIL for each step.
```

#### If Verification Fails:
**STOP.** Report the error and wait for instructions.

---

## PHASE 2: Theme & UI Constants (HIGH LEVERAGE)

### Current State
`ConversionTrendChart.tsx` already has `RATE_COLORS` and `VOLUME_COLORS` defined locally. We need to:
1. Create centralized theme constants
2. Update the chart to import from the central location
3. Create UI pattern constants for future components

---

### Step 2.1: Create Theme Constants File

#### Cursor AI Prompt:
```
Create a new file at src/config/theme.ts

This centralizes all color values. Future components should import from here.

Include:
1. CHART_COLORS - for Recharts (blues, violets, cyans, etc.)
2. STATUS_COLORS - Tailwind class strings for success/warning/error/info
3. RATE_THRESHOLDS - numeric thresholds for color-coding conversion rates
4. getRateColorClass(rate) - helper function returning Tailwind classes

Create the complete file.
```

#### Expected File: `src/config/theme.ts`

```typescript
/**
 * Centralized Theme Constants
 * 
 * CURSOR AI: Import colors from this file instead of hardcoding.
 * Example: import { CHART_COLORS } from '@/config/theme';
 */

// Colors for Recharts visualizations
export const CHART_COLORS = {
  // Primary palette
  primary: '#3b82f6',      // blue-500
  secondary: '#8b5cf6',    // violet-500
  tertiary: '#06b6d4',     // cyan-500
  quaternary: '#f59e0b',   // amber-500
  quinary: '#10b981',      // emerald-500
  
  // Conversion funnel specific
  contactedToMql: '#3b82f6',
  mqlToSql: '#8b5cf6',
  sqlToSqo: '#06b6d4',
  sqoToJoined: '#10b981',
  
  // Volume/secondary data
  volume: '#94a3b8',
  volumeLight: '#cbd5e1',
  
  // Grid and axis
  grid: '#e2e8f0',
  gridDark: '#334155',
  axis: '#64748b',
} as const;

// Status colors as Tailwind class combinations
export const STATUS_COLORS = {
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-800',
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-200 dark:border-yellow-800',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800',
  },
} as const;

// Thresholds for color-coding rates
export const RATE_THRESHOLDS = {
  excellent: 0.75,
  good: 0.50,
  warning: 0.25,
} as const;

/**
 * Get Tailwind text color class for a conversion rate
 */
export function getRateColorClass(rate: number): string {
  if (rate >= RATE_THRESHOLDS.excellent) {
    return 'text-green-600 dark:text-green-400';
  }
  if (rate >= RATE_THRESHOLDS.good) {
    return 'text-blue-600 dark:text-blue-400';
  }
  if (rate >= RATE_THRESHOLDS.warning) {
    return 'text-yellow-600 dark:text-yellow-400';
  }
  return 'text-red-600 dark:text-red-400';
}
```

---

### Step 2.2: Create UI Pattern Constants

#### Cursor AI Prompt:
```
Create a new file at src/config/ui.ts

This provides reusable UI patterns as Tailwind class strings.

Include:
1. CARD_STYLES - for card containers (base, hover, selected, padding)
2. TABLE_STYLES - for tables (header, rows, cells, zebra striping)
3. INPUT_STYLES - for form inputs
4. BUTTON_STYLES - for buttons (primary, secondary, danger)
5. getTableRowClasses(index, isSelected, isClickable) - helper function

Create the complete file.
```

#### Expected File: `src/config/ui.ts`

```typescript
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
```

---

### Step 2.3: Update ConversionTrendChart to Use Theme Constants

#### Cursor AI Prompt:
```
Open src/components/dashboard/ConversionTrendChart.tsx

This file already has RATE_COLORS and VOLUME_COLORS defined locally. We need to:

1. Add import at top: import { CHART_COLORS } from '@/config/theme';

2. Replace the local RATE_COLORS constant with CHART_COLORS imports:
   - Instead of defining RATE_COLORS locally, use CHART_COLORS.contactedToMql, etc.
   
3. Keep the VOLUME_COLORS if they're specific to this chart, OR use CHART_COLORS.volume

4. Update any other hardcoded hex colors to use CHART_COLORS

Show me:
- The current RATE_COLORS and VOLUME_COLORS definitions
- What you're replacing them with
- Any other hex colors you're updating

IMPORTANT: Do NOT change chart logic, data processing, or component structure.
```

---

### ✅ VERIFICATION GATE 2

#### Cursor AI Prompt:
```
Verify theme constants work:
1. npm run build
2. npm run dev
3. View dashboard - charts should render with same colors as before
4. Toggle dark mode - colors should still look correct

Report PASS or FAIL for each.
```

---

## PHASE 3: Type Safety Improvements (MEDIUM-HIGH LEVERAGE)

### Step 3.1: Audit Current Type Issues

#### Cursor AI Prompt:
```
Search the src/ directory for:
1. (session as any)
2. : any
3. as any

List all files and line numbers. We'll fix them systematically.
```

---

### Step 3.2: Create Auth Types

#### Cursor AI Prompt:
```
Create or update src/types/auth.ts with proper session types.

Include:
1. UserPermissions interface (role, canViewAllData, canManageUsers, etc.)
2. ExtendedSession interface extending Session with permissions
3. hasPermissions() type guard function
4. getSessionPermissions() helper function

If UserPermissions already exists in src/types/user.ts, import it instead of redefining.

Create the complete file.
```

#### Expected File: `src/types/auth.ts`

```typescript
import { Session } from 'next-auth';

export interface UserPermissions {
  canViewAllData: boolean;
  canManageUsers: boolean;
  canExportData: boolean;
  sgaFilter?: string | null;
  sgmFilter?: string | null;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
}

export interface ExtendedSession extends Session {
  permissions?: UserPermissions;
}

export function hasPermissions(
  session: Session | ExtendedSession | null
): session is ExtendedSession & { permissions: UserPermissions } {
  return (
    session !== null &&
    'permissions' in session &&
    session.permissions !== undefined
  );
}

export function getSessionPermissions(
  session: Session | ExtendedSession | null
): UserPermissions | null {
  if (hasPermissions(session)) {
    return session.permissions;
  }
  return null;
}
```

---

### Step 3.3: Fix Session Type Casts

#### Cursor AI Prompt:
```
For each file that has (session as any):

1. Add import: import { ExtendedSession, getSessionPermissions } from '@/types/auth';

2. Replace:
   const permissions = (session as any)?.permissions;
   
   With:
   const permissions = getSessionPermissions(session);

Show before/after for each file.

IMPORTANT: Do NOT change any other logic.
```

---

### Step 3.4: Fix CSV Export Types (If Applicable)

#### Cursor AI Prompt:
```
Open src/lib/utils/export-csv.ts

If it uses 'any' types, replace with proper generics:

type CSVValue = string | number | boolean | null | undefined;
type CSVRow = Record<string, CSVValue>;

export function exportToCSV<T extends CSVRow>(
  data: T[],
  filename: string,
  columns?: (keyof T)[]
): void { ... }

Show the changes made.
```

---

### ✅ VERIFICATION GATE 3

#### Cursor AI Prompt:
```
Verify type safety:
1. npm run build (no type errors?)
2. Count 'as any' in src/ (should be reduced)
3. Confirm src/types/auth.ts exists

Report PASS or FAIL with counts.
```

---

## PHASE 4: Remove Console Logs (MEDIUM LEVERAGE)

### Step 4.1: Remove Login Page Console Logs

#### Cursor AI Prompt:
```
Open src/app/login/page.tsx

Remove ALL console.log and console.error statements.

Show each line removed with line number.

Keep all other code exactly the same.
```

---

### Step 4.2: Remove Header Console Logs

#### Cursor AI Prompt:
```
Open src/components/layout/Header.tsx

Remove ALL console.log statements.

Show what you remove.
```

---

### Step 4.3: Remove Dashboard Page Console Logs

#### Cursor AI Prompt:
```
Open src/app/dashboard/page.tsx

Remove ALL console.log statements.

Show what you remove.
```

---

### Step 4.4: Remove ThemeToggle Console Logs

#### Cursor AI Prompt:
```
Open src/components/ui/ThemeToggle.tsx

Remove ALL console.log statements.

Show what you remove.
```

---

### Step 4.5: Remove Query File Console Logs (CAREFUL)

#### Cursor AI Prompt:
```
Open src/lib/queries/conversion-rates.ts

ONLY remove console.log and console.error statements.

⚠️ DO NOT modify:
- SQL query strings
- Calculation logic
- Function parameters
- Return statements

Show ONLY the console statements you remove.
```

---

### Step 4.6: Scan for Remaining Console Logs

#### Cursor AI Prompt:
```
Search src/ for remaining console.log, console.error, console.warn.

Exclude:
- ErrorBoundary.tsx (it checks for dev mode)
- node_modules, .next

For each found, report:
1. File and line
2. The statement
3. KEEP (error handling) or REMOVE (debug)

Then remove the ones marked REMOVE.
```

---

### ✅ VERIFICATION GATE 4

#### Cursor AI Prompt:
```
Verify console cleanup:
1. npm run build
2. npm run dev
3. Test login flow
4. Check browser console on dashboard - no debug logs?

Report PASS or FAIL.
```

---

## PHASE 5: Final Verification & Commit

### Step 5.1: Full Build Check

#### Cursor AI Prompt:
```
Run complete verification:
1. npm run build
2. npm run dev
3. Test: login page loads
4. Test: login works with credentials
5. Test: dashboard loads
6. Test: charts render
7. Test: dark mode toggle works
8. Test: no console errors in browser

Report all results.
```

---

### Step 5.2: Create Changelog

#### Cursor AI Prompt:
```
Create TECH_DEBT_CHANGELOG.md in project root:

# Tech Debt Cleanup Changelog

## [Cleanup] - [Today's Date]

### Added
- (list new files)

### Changed
- (list modified files and changes)

### Removed
- (list what was removed)

### Type Safety
- (list type improvements)
```

---

### Step 5.3: Stage and Review Changes

#### Cursor AI Prompt:
```
Prepare commit:
1. git add .
2. git status
3. git diff --stat

Report output. Do NOT commit yet.
```

---

### Step 5.4: Commit

#### Cursor AI Prompt:
```
Commit with:

git commit -m "chore: tech debt cleanup - error boundaries, theme constants, type safety, remove console logs"

Report result.
```

---

### ✅ FINAL VERIFICATION GATE

#### Cursor AI Prompt:
```
Final checklist:
1. [ ] npm run build passes
2. [ ] npm run dev works
3. [ ] Login works
4. [ ] Dashboard loads
5. [ ] Charts render correctly
6. [ ] Dark mode works
7. [ ] No debug console.log in browser
8. [ ] Error boundaries exist and work
9. [ ] All committed to tech-debt-cleanup branch
10. [ ] TECH_DEBT_CHANGELOG.md exists

Report status of each. If all pass: CLEANUP COMPLETE.
```

---

## Summary of Changes

### Files Created
| File | Purpose |
|------|---------|
| `src/components/ui/DashboardErrorBoundaries.tsx` | Pre-configured error boundaries |
| `src/config/theme.ts` | Centralized colors |
| `src/config/ui.ts` | Reusable UI patterns |
| `src/types/auth.ts` | Session type definitions |
| `TECH_DEBT_CHANGELOG.md` | Change documentation |

### Files Modified
| File | Changes |
|------|---------|
| `src/components/ui/ErrorBoundary.tsx` | Upgraded with dark mode, HOC, dev logging |
| `src/components/ui/index.ts` | Added exports |
| `src/components/dashboard/ConversionTrendChart.tsx` | Uses theme constants |
| `src/app/dashboard/page.tsx` | Error boundary wrappers, removed logs |
| `src/app/login/page.tsx` | Removed console logs |
| `src/components/layout/Header.tsx` | Removed console logs |
| Various | Fixed session type casts |

### Not Changed
- ❌ `getConversionTrends()` bug (separate task)
- ❌ Business logic or calculations
- ❌ SQL queries
- ❌ Login page styling

---

**Document Version**: 3.0  
**Updated For**: Current repository state  
**Estimated Time**: 5-7 hours
