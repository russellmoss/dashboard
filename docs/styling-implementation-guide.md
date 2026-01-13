# Savvy Funnel Analytics Dashboard - Comprehensive Styling Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing consistent styling across the dashboard using Cursor.ai agentic prompts. Each step includes verification gates to ensure correctness.

**Goals:**
1. ✅ Permanent zebra striping in all tables
2. ✅ Borders around scorecards with hover effects (indicating clickability)
3. ✅ Small vertical divider lines in tables
4. ✅ Hover effects on table rows
5. ✅ Dark mode / light mode toggle

---

## Pre-Implementation Checklist

Before starting, verify these files exist in your project:
- [x] `src/app/globals.css`
- [x] `tailwind.config.js`
- [x] `src/components/dashboard/Scorecards.tsx`
- [x] `src/components/dashboard/ConversionRateCards.tsx`
- [x] `src/components/dashboard/ChannelPerformanceTable.tsx`
- [x] `src/components/dashboard/SourcePerformanceTable.tsx`
- [x] `src/components/dashboard/DetailRecordsTable.tsx`
- [x] `src/components/settings/UserManagement.tsx`
- [x] `src/components/layout/Header.tsx`

---

## PHASE 1: Dark Mode Infrastructure

### Step 1.1: Install Required Dependencies

**Cursor.ai Prompt:**
```
Install next-themes package for dark mode support. Run: npm install next-themes
```

**Verification Command:**
```bash
npm list next-themes
```

**Expected Output:** `next-themes@x.x.x`

---

### Step 1.2: Update Tailwind Configuration

**Cursor.ai Prompt:**
```
Update tailwind.config.js to enable dark mode with the 'class' strategy and add custom color variables for light/dark themes. Add extended colors for dashboard components including scorecard borders, table zebra striping, and hover states.
```

**Replace `tailwind.config.js` with:**
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Include Tremor module for tree-shaking
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom dashboard colors
        'dashboard': {
          // Light mode
          'bg': '#f9fafb',
          'card': '#ffffff',
          'border': '#e5e7eb',
          'border-hover': '#3b82f6',
          // Zebra striping
          'zebra-even': '#ffffff',
          'zebra-odd': '#f9fafb',
          'zebra-hover': '#eff6ff',
          // Dark mode equivalents
          'dark-bg': '#111827',
          'dark-card': '#1f2937',
          'dark-border': '#374151',
          'dark-border-hover': '#60a5fa',
          'dark-zebra-even': '#1f2937',
          'dark-zebra-odd': '#111827',
          'dark-zebra-hover': '#1e3a5f',
        },
        // Tremor dark mode overrides
        tremor: {
          brand: {
            faint: '#eff6ff',
            muted: '#bfdbfe',
            subtle: '#60a5fa',
            DEFAULT: '#3b82f6',
            emphasis: '#1d4ed8',
            inverted: '#ffffff',
          },
          background: {
            muted: '#f9fafb',
            subtle: '#f3f4f6',
            DEFAULT: '#ffffff',
            emphasis: '#374151',
          },
          border: {
            DEFAULT: '#e5e7eb',
          },
          ring: {
            DEFAULT: '#e5e7eb',
          },
          content: {
            subtle: '#9ca3af',
            DEFAULT: '#6b7280',
            emphasis: '#374151',
            strong: '#111827',
            inverted: '#ffffff',
          },
        },
        // Dark mode Tremor overrides
        'dark-tremor': {
          brand: {
            faint: '#0B1229',
            muted: '#172554',
            subtle: '#1e40af',
            DEFAULT: '#3b82f6',
            emphasis: '#60a5fa',
            inverted: '#030712',
          },
          background: {
            muted: '#131A2B',
            subtle: '#1f2937',
            DEFAULT: '#111827',
            emphasis: '#d1d5db',
          },
          border: {
            DEFAULT: '#374151',
          },
          ring: {
            DEFAULT: '#1f2937',
          },
          content: {
            subtle: '#4b5563',
            DEFAULT: '#6b7280',
            emphasis: '#e5e7eb',
            strong: '#f9fafb',
            inverted: '#000000',
          },
        },
      },
      boxShadow: {
        // Tremor shadows
        'tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'tremor-card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'tremor-dropdown': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        // Dark mode shadows
        'dark-tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'dark-tremor-card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'dark-tremor-dropdown': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        // Scorecard hover shadow
        'scorecard': '0 2px 4px rgba(0, 0, 0, 0.05)',
        'scorecard-hover': '0 4px 12px rgba(59, 130, 246, 0.15)',
      },
      borderRadius: {
        'tremor-small': '0.375rem',
        'tremor-default': '0.5rem',
        'tremor-full': '9999px',
      },
      fontSize: {
        'tremor-label': ['0.75rem', { lineHeight: '1rem' }],
        'tremor-default': ['0.875rem', { lineHeight: '1.25rem' }],
        'tremor-title': ['1.125rem', { lineHeight: '1.75rem' }],
        'tremor-metric': ['1.875rem', { lineHeight: '2.25rem' }],
      },
    },
  },
  safelist: [
    {
      pattern: /^(bg|text|border|ring|shadow)-/,
      variants: ['dark', 'hover', 'dark:hover'],
    },
  ],
  plugins: [],
};
```

**✅ VERIFICATION GATE 1.2:**
- [ ] Run `npm run dev` - no Tailwind errors
- [ ] Check browser console for no CSS warnings

---

### Step 1.3: Update Global CSS with Theme Variables

**Cursor.ai Prompt:**
```
Update src/app/globals.css to include CSS variables for light and dark themes, add Tremor component styling overrides, and define base styles for tables with zebra striping and scorecards with borders.
```

**Replace `src/app/globals.css` with:**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ============================================
   CSS Custom Properties for Theming
   ============================================ */
:root {
  /* Light mode colors */
  --foreground-rgb: 17, 24, 39;
  --background-rgb: 249, 250, 251;
  
  /* Dashboard specific */
  --card-bg: 255, 255, 255;
  --card-border: 229, 231, 235;
  --card-border-hover: 59, 130, 246;
  
  /* Table zebra */
  --table-row-even: 255, 255, 255;
  --table-row-odd: 249, 250, 251;
  --table-row-hover: 239, 246, 255;
  --table-border: 229, 231, 235;
  
  /* Scorecard */
  --scorecard-bg: 255, 255, 255;
  --scorecard-border: 229, 231, 235;
  --scorecard-border-hover: 59, 130, 246;
  --scorecard-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  --scorecard-shadow-hover: 0 4px 12px rgba(59, 130, 246, 0.15);
}

.dark {
  /* Dark mode colors */
  --foreground-rgb: 249, 250, 251;
  --background-rgb: 17, 24, 39;
  
  /* Dashboard specific */
  --card-bg: 31, 41, 55;
  --card-border: 55, 65, 81;
  --card-border-hover: 96, 165, 250;
  
  /* Table zebra */
  --table-row-even: 31, 41, 55;
  --table-row-odd: 17, 24, 39;
  --table-row-hover: 30, 58, 95;
  --table-border: 55, 65, 81;
  
  /* Scorecard */
  --scorecard-bg: 31, 41, 55;
  --scorecard-border: 55, 65, 81;
  --scorecard-border-hover: 96, 165, 250;
  --scorecard-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  --scorecard-shadow-hover: 0 4px 12px rgba(96, 165, 250, 0.2);
}

/* ============================================
   Base Styles
   ============================================ */
body {
  color: rgb(var(--foreground-rgb));
  background: rgb(var(--background-rgb));
  transition: background-color 0.3s ease, color 0.3s ease;
}

/* ============================================
   Scorecard Styles
   ============================================ */
.scorecard {
  background: rgb(var(--scorecard-bg));
  border: 2px solid rgb(var(--scorecard-border));
  border-radius: 0.5rem;
  box-shadow: var(--scorecard-shadow);
  transition: all 0.2s ease-in-out;
  cursor: pointer;
}

.scorecard:hover {
  border-color: rgb(var(--scorecard-border-hover));
  box-shadow: var(--scorecard-shadow-hover);
  transform: translateY(-2px);
}

.scorecard.selected {
  border-color: rgb(var(--scorecard-border-hover));
  background: rgba(59, 130, 246, 0.1);
}

.dark .scorecard.selected {
  background: rgba(96, 165, 250, 0.15);
}

/* Click indicator on scorecards */
.scorecard::after {
  content: '';
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--scorecard-border));
  transition: background 0.2s ease;
}

.scorecard:hover::after {
  background: rgb(var(--scorecard-border-hover));
}

/* ============================================
   Table Styles with Zebra Striping
   ============================================ */
.dashboard-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

.dashboard-table thead th {
  background: rgb(var(--table-row-odd));
  border-bottom: 2px solid rgb(var(--table-border));
  font-weight: 600;
  text-align: left;
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--foreground-rgb));
}

/* Vertical dividers in header */
.dashboard-table thead th:not(:last-child) {
  border-right: 1px solid rgb(var(--table-border));
}

/* Zebra striping */
.dashboard-table tbody tr:nth-child(even) {
  background: rgb(var(--table-row-even));
}

.dashboard-table tbody tr:nth-child(odd) {
  background: rgb(var(--table-row-odd));
}

/* Row hover effect */
.dashboard-table tbody tr {
  transition: background-color 0.15s ease;
}

.dashboard-table tbody tr:hover {
  background: rgb(var(--table-row-hover)) !important;
}

/* Cell styling */
.dashboard-table tbody td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgb(var(--table-border));
  font-size: 0.875rem;
}

/* Vertical dividers in cells */
.dashboard-table tbody td:not(:last-child) {
  border-right: 1px solid rgb(var(--table-border));
}

/* Clickable rows */
.dashboard-table tbody tr.clickable {
  cursor: pointer;
}

.dashboard-table tbody tr.selected {
  background: rgba(59, 130, 246, 0.1) !important;
}

.dark .dashboard-table tbody tr.selected {
  background: rgba(96, 165, 250, 0.15) !important;
}

/* ============================================
   Tremor Component Overrides
   ============================================ */

/* Card overrides for dark mode */
.dark [data-testid="Card"],
.dark .tremor-Card-root {
  background-color: rgb(31, 41, 55);
  border-color: rgb(55, 65, 81);
}

/* Table overrides for Tremor tables */
.dark .tremor-TableRow-root:nth-child(even) {
  background-color: rgb(31, 41, 55);
}

.dark .tremor-TableRow-root:nth-child(odd) {
  background-color: rgb(17, 24, 39);
}

.dark .tremor-TableRow-root:hover {
  background-color: rgb(30, 58, 95) !important;
}

.dark .tremor-TableCell-root {
  border-color: rgb(55, 65, 81);
}

.dark .tremor-TableHeaderCell-root {
  background-color: rgb(17, 24, 39);
  border-color: rgb(55, 65, 81);
}

/* Badge overrides */
.dark .tremor-Badge-root {
  background-color: rgba(55, 65, 81, 0.5);
}

/* Text overrides */
.dark .tremor-Text-root {
  color: rgb(209, 213, 219);
}

.dark .tremor-Title-root {
  color: rgb(249, 250, 251);
}

.dark .tremor-Metric-root {
  color: rgb(249, 250, 251);
}

/* Select/Input overrides */
.dark .tremor-Select-root,
.dark .tremor-TextInput-root {
  background-color: rgb(31, 41, 55);
  border-color: rgb(55, 65, 81);
}

/* ============================================
   Conversion Rate Card Specific
   ============================================ */
.conversion-card {
  position: relative;
  background: rgb(var(--scorecard-bg));
  border: 2px solid rgb(var(--scorecard-border));
  border-radius: 0.5rem;
  padding: 1rem;
  transition: all 0.2s ease-in-out;
}

.conversion-card:hover {
  border-color: rgb(var(--scorecard-border-hover));
  box-shadow: var(--scorecard-shadow-hover);
}

/* ============================================
   Theme Toggle Button
   ============================================ */
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 0.5rem;
  background: rgb(var(--card-bg));
  border: 1px solid rgb(var(--card-border));
  cursor: pointer;
  transition: all 0.2s ease;
}

.theme-toggle:hover {
  background: rgb(var(--table-row-hover));
  border-color: rgb(var(--card-border-hover));
}

.theme-toggle svg {
  width: 20px;
  height: 20px;
  color: rgb(var(--foreground-rgb));
  transition: transform 0.3s ease;
}

.theme-toggle:hover svg {
  transform: rotate(15deg);
}

/* ============================================
   Utility Classes
   ============================================ */
.divider-vertical {
  width: 1px;
  height: 100%;
  background: rgb(var(--table-border));
}

.clickable-indicator {
  position: relative;
}

.clickable-indicator::before {
  content: 'Click to filter';
  position: absolute;
  bottom: -20px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.625rem;
  color: rgb(var(--foreground-rgb));
  opacity: 0;
  transition: opacity 0.2s ease;
  white-space: nowrap;
}

.clickable-indicator:hover::before {
  opacity: 0.6;
}

/* ============================================
   Loading States
   ============================================ */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.skeleton {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  background: linear-gradient(
    90deg,
    rgb(var(--table-row-odd)) 0%,
    rgb(var(--table-row-even)) 50%,
    rgb(var(--table-row-odd)) 100%
  );
  background-size: 200% 100%;
}
```

**✅ VERIFICATION GATE 1.3:**
- [ ] CSS compiles without errors
- [ ] Browser shows styled scorecards with borders
- [ ] No console errors related to CSS

---

### Step 1.4: Create Theme Provider Component

**Cursor.ai Prompt:**
```
Create a new file src/components/providers/ThemeProvider.tsx that wraps the app with next-themes ThemeProvider. Also create a ThemeToggle component that switches between light and dark mode with sun/moon icons.
```

**Create `src/components/providers/ThemeProvider.tsx`:**
```typescript
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { ReactNode, useEffect, useState } from 'react';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={true}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}
```

**Create `src/components/ui/ThemeToggle.tsx`:**
```typescript
'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button className="theme-toggle" aria-label="Toggle theme">
        <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
      </button>
    );
  }

  const cycleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('system');
    } else {
      setTheme('light');
    }
  };

  const getIcon = () => {
    if (theme === 'system') {
      return <Monitor className="w-5 h-5" />;
    }
    return resolvedTheme === 'dark' ? (
      <Moon className="w-5 h-5" />
    ) : (
      <Sun className="w-5 h-5" />
    );
  };

  const getLabel = () => {
    if (theme === 'system') return 'System theme';
    return resolvedTheme === 'dark' ? 'Dark mode' : 'Light mode';
  };

  return (
    <button
      onClick={cycleTheme}
      className="theme-toggle group relative"
      aria-label={getLabel()}
      title={getLabel()}
    >
      {getIcon()}
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 px-2 py-1 rounded">
        {getLabel()}
      </span>
    </button>
  );
}
```

**✅ VERIFICATION GATE 1.4:**
- [ ] Files created without TypeScript errors
- [ ] Import `Sun`, `Moon`, `Monitor` from lucide-react works

---

### Step 1.5: Update Root Layout with Theme Provider

**Cursor.ai Prompt:**
```
Update src/app/layout.tsx to wrap the application with the ThemeProvider component. Import ThemeProvider from '@/components/providers/ThemeProvider'.
```

**Update `src/app/layout.tsx`:**
```typescript
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { AuthProvider } from '@/components/providers/AuthProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Savvy Funnel Analytics Dashboard',
  description: 'Revenue Operations Analytics Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-900 transition-colors`}>
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**✅ VERIFICATION GATE 1.5:**
- [ ] App loads without hydration errors
- [ ] `suppressHydrationWarning` prevents theme flicker warnings

---

### Step 1.6: Add Theme Toggle to Header

**Cursor.ai Prompt:**
```
Update src/components/layout/Header.tsx to include the ThemeToggle component in the header navigation area, positioned on the right side next to user profile/logout.
```

**Update Header component - add this import and component:**
```typescript
// Add import at top
import { ThemeToggle } from '@/components/ui/ThemeToggle';

// In the JSX, add before the user menu/logout button:
<div className="flex items-center gap-4">
  <ThemeToggle />
  {/* existing user menu/logout */}
</div>
```

**Full Header Update (`src/components/layout/Header.tsx`):**
```typescript
'use client';

import { useSession, signOut } from 'next-auth/react';
import { Button } from '@tremor/react';
import { LogOut, User } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Savvy Funnel Analytics
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <ThemeToggle />
          
          {session?.user && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <User className="w-4 h-4" />
                <span>{session.user.name || session.user.email}</span>
              </div>
              <Button
                variant="secondary"
                size="xs"
                icon={LogOut}
                onClick={() => signOut({ callbackUrl: '/login' })}
              >
                Logout
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
```

**✅ VERIFICATION GATE 1.6:**
- [ ] Theme toggle appears in header
- [ ] Clicking toggle cycles through light → dark → system
- [ ] Theme persists on page reload (stored in localStorage)
- [ ] No hydration mismatch errors

---

## PHASE 2: Scorecard Styling with Click Indicators

### Step 2.1: Update Scorecards Component

**Cursor.ai Prompt:**
```
Update src/components/dashboard/Scorecards.tsx to use the new scorecard CSS classes. Add visible borders, hover effects with shadow and slight lift, and a visual indicator (small dot or icon) showing cards are clickable. Ensure dark mode compatibility using CSS variables.
```

**Replace `src/components/dashboard/Scorecards.tsx`:**
```typescript
'use client';

import { Card, Metric, Text } from '@tremor/react';
import { FunnelMetrics } from '@/types/dashboard';
import { formatCurrency, formatNumber } from '@/lib/utils/date-helpers';
import { TrendingUp, Users, DollarSign, Package, MousePointerClick } from 'lucide-react';

interface ScorecardsProps {
  metrics: FunnelMetrics;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
}

interface ScorecardItemProps {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  iconColor: string;
  isSelected: boolean;
  isClickable: boolean;
  onClick?: () => void;
}

function ScorecardItem({
  id,
  title,
  value,
  subtitle,
  icon,
  iconColor,
  isSelected,
  isClickable,
  onClick,
}: ScorecardItemProps) {
  return (
    <div
      className={`
        relative p-4 rounded-lg transition-all duration-200 ease-in-out
        bg-white dark:bg-gray-800
        border-2 
        ${isSelected 
          ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 shadow-lg' 
          : 'border-gray-200 dark:border-gray-700 shadow-sm'
        }
        ${isClickable 
          ? 'cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5' 
          : ''
        }
      `}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {/* Header with icon */}
      <div className="flex items-center justify-between mb-3">
        <Text className="text-gray-600 dark:text-gray-400 font-medium text-sm">
          {title}
        </Text>
        <div className={`p-2 rounded-lg ${iconColor}`}>
          {icon}
        </div>
      </div>
      
      {/* Value */}
      <Metric className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        {value}
      </Metric>
      
      {/* Subtitle */}
      <Text className="text-xs text-gray-500 dark:text-gray-400">
        {subtitle}
      </Text>
      
      {/* Click indicator */}
      {isClickable && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 text-gray-400 dark:text-gray-500">
          <MousePointerClick className="w-3 h-3" />
          <span className="text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            Click to filter
          </span>
        </div>
      )}
      
      {/* Selection indicator dot */}
      {isClickable && (
        <div 
          className={`
            absolute top-2 right-2 w-2 h-2 rounded-full transition-colors
            ${isSelected 
              ? 'bg-blue-500 dark:bg-blue-400' 
              : 'bg-gray-300 dark:bg-gray-600'
            }
          `}
        />
      )}
    </div>
  );
}

export function Scorecards({ metrics, selectedMetric, onMetricClick }: ScorecardsProps) {
  const isSelected = (id: string) => selectedMetric === id;
  const isClickable = !!onMetricClick;

  const handleClick = (id: string) => {
    if (onMetricClick) {
      // Toggle selection
      onMetricClick(isSelected(id) ? '' : id);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <ScorecardItem
        id="sql"
        title="SQLs"
        value={formatNumber(metrics.sqls)}
        subtitle="Sales Qualified Leads"
        icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
        iconColor="bg-blue-100 dark:bg-blue-900/40"
        isSelected={isSelected('sql')}
        isClickable={isClickable}
        onClick={() => handleClick('sql')}
      />

      <ScorecardItem
        id="sqo"
        title="SQOs"
        value={formatNumber(metrics.sqos)}
        subtitle="Sales Qualified Opportunities"
        icon={<TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />}
        iconColor="bg-green-100 dark:bg-green-900/40"
        isSelected={isSelected('sqo')}
        isClickable={isClickable}
        onClick={() => handleClick('sqo')}
      />

      <ScorecardItem
        id="joined"
        title="Joined"
        value={formatNumber(metrics.joined)}
        subtitle="Advisors Joined"
        icon={<Package className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
        iconColor="bg-purple-100 dark:bg-purple-900/40"
        isSelected={isSelected('joined')}
        isClickable={isClickable}
        onClick={() => handleClick('joined')}
      />

      <ScorecardItem
        id="openPipeline"
        title="Open Pipeline AUM"
        value={formatCurrency(metrics.openPipelineAum)}
        subtitle="Current open pipeline (all time)"
        icon={<DollarSign className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />}
        iconColor="bg-yellow-100 dark:bg-yellow-900/40"
        isSelected={isSelected('openPipeline')}
        isClickable={isClickable}
        onClick={() => handleClick('openPipeline')}
      />
    </div>
  );
}
```

**✅ VERIFICATION GATE 2.1:**
- [ ] Scorecards show visible borders
- [ ] Hover effect shows shadow lift
- [ ] Click indicator dot visible in corner
- [ ] Selection state shows blue border and background
- [ ] Works in both light and dark mode

---

### Step 2.2: Update Conversion Rate Cards

**Cursor.ai Prompt:**
```
Update src/components/dashboard/ConversionRateCards.tsx to match the new styling pattern. Add borders around each card, hover effects, and ensure dark mode compatibility.
```

**Add these styles to the RateCard component in `src/components/dashboard/ConversionRateCards.tsx`:**

Find the Card component in RateCard and update its className:
```typescript
// Before
<Card className="p-4">

// After  
<Card className={`
  p-4 rounded-lg transition-all duration-200
  bg-white dark:bg-gray-800
  border-2 border-gray-200 dark:border-gray-700
  hover:border-blue-400 dark:hover:border-blue-500
  hover:shadow-md
`}>
```

**Full updated RateCard function:**
```typescript
function RateCard({ 
  title, 
  rate, 
  label, 
  previousRate, 
  isResolved 
}: { 
  title: string; 
  rate: number; 
  label: string;
  previousRate?: number;
  isResolved: boolean;
}) {
  const rateChange = previousRate !== undefined ? rate - previousRate : null;
  
  return (
    <Card className={`
      p-4 rounded-lg transition-all duration-200
      bg-white dark:bg-gray-800
      border-2 border-gray-200 dark:border-gray-700
      hover:border-blue-400 dark:hover:border-blue-500
      hover:shadow-md
    `}>
      <Flex alignItems="start" justifyContent="between">
        <Text className="text-gray-600 dark:text-gray-400 font-medium text-sm">
          {title}
        </Text>
        {rateChange !== null && (
          <Badge 
            size="xs" 
            color={rateChange >= 0 ? 'green' : 'red'}
          >
            {rateChange >= 0 ? '+' : ''}{(rateChange * 100).toFixed(1)}%
          </Badge>
        )}
      </Flex>
      <Metric className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
        {formatPercent(rate)}
      </Metric>
      <Flex className="mt-2" justifyContent="start">
        {isResolved ? (
          <SimpleTooltip 
            content="Only includes records that have a final outcome (converted to next stage OR closed/lost). Open records still being worked are excluded."
          >
            <Text className="text-xs text-blue-600 dark:text-blue-400 cursor-help">
              {label}
            </Text>
          </SimpleTooltip>
        ) : (
          <Text className={`text-xs ${isResolved ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
            {label}
          </Text>
        )}
      </Flex>
    </Card>
  );
}
```

**✅ VERIFICATION GATE 2.2:**
- [ ] Conversion rate cards have visible borders
- [ ] Hover effect shows shadow
- [ ] Dark mode colors work correctly

---

## PHASE 3: Table Styling with Zebra Striping and Dividers

### Step 3.1: Create Reusable Table Component

**Cursor.ai Prompt:**
```
Create a new reusable table component at src/components/ui/DashboardTable.tsx that implements consistent zebra striping, vertical dividers between columns, and hover effects. This will be the base for all dashboard tables.
```

**Create `src/components/ui/DashboardTable.tsx`:**
```typescript
'use client';

import { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
  render?: (item: T, index: number) => ReactNode;
  className?: string;
}

interface DashboardTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onRowClick?: (item: T, index: number) => void;
  selectedKey?: string | null;
  emptyMessage?: string;
  isLoading?: boolean;
  className?: string;
}

export function DashboardTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  selectedKey,
  emptyMessage = 'No data available',
  isLoading = false,
  className = '',
}: DashboardTableProps<T>) {
  if (isLoading) {
    return (
      <div className={`overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}>
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800">
              {columns.map((col, idx) => (
                <th
                  key={col.key}
                  className={`
                    px-4 py-3 text-xs font-semibold uppercase tracking-wider
                    text-gray-600 dark:text-gray-400
                    ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                    ${idx < columns.length - 1 ? 'border-r border-gray-200 dark:border-gray-700' : ''}
                  `}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(5)].map((_, rowIdx) => (
              <tr 
                key={rowIdx}
                className={rowIdx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'}
              >
                {columns.map((col, colIdx) => (
                  <td
                    key={col.key}
                    className={`
                      px-4 py-3
                      ${colIdx < columns.length - 1 ? 'border-r border-gray-200 dark:border-gray-700' : ''}
                    `}
                  >
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}>
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b-2 border-gray-200 dark:border-gray-700">
              {columns.map((col, idx) => (
                <th
                  key={col.key}
                  className={`
                    px-4 py-3 text-xs font-semibold uppercase tracking-wider
                    text-gray-600 dark:text-gray-400
                    ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                    ${idx < columns.length - 1 ? 'border-r border-gray-200 dark:border-gray-700' : ''}
                  `}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td 
                colSpan={columns.length} 
                className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
              >
                {emptyMessage}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 ${className}`}>
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 border-b-2 border-gray-200 dark:border-gray-700">
            {columns.map((col, idx) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={`
                  px-4 py-3 text-xs font-semibold uppercase tracking-wider
                  text-gray-600 dark:text-gray-400
                  ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                  ${idx < columns.length - 1 ? 'border-r border-gray-200 dark:border-gray-700' : ''}
                `}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, rowIdx) => {
            const key = keyExtractor(item, rowIdx);
            const isSelected = selectedKey === key;
            const isClickable = !!onRowClick;
            
            // Zebra striping
            const zebraClass = rowIdx % 2 === 0 
              ? 'bg-white dark:bg-gray-800' 
              : 'bg-gray-50 dark:bg-gray-900';
            
            // Hover class
            const hoverClass = isClickable
              ? 'hover:bg-blue-50 dark:hover:bg-blue-900/20'
              : '';
            
            // Selected class
            const selectedClass = isSelected
              ? '!bg-blue-100 dark:!bg-blue-900/30'
              : '';

            return (
              <tr
                key={key}
                className={`
                  ${zebraClass}
                  ${hoverClass}
                  ${selectedClass}
                  ${isClickable ? 'cursor-pointer' : ''}
                  transition-colors duration-150
                  border-b border-gray-100 dark:border-gray-800 last:border-b-0
                `}
                onClick={() => onRowClick?.(item, rowIdx)}
              >
                {columns.map((col, colIdx) => (
                  <td
                    key={col.key}
                    className={`
                      px-4 py-3 text-sm
                      text-gray-700 dark:text-gray-300
                      ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}
                      ${colIdx < columns.length - 1 ? 'border-r border-gray-100 dark:border-gray-800' : ''}
                      ${col.className || ''}
                    `}
                  >
                    {col.render 
                      ? col.render(item, rowIdx) 
                      : (item as any)[col.key]
                    }
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

**✅ VERIFICATION GATE 3.1:**
- [ ] Component compiles without TypeScript errors
- [ ] Generic typing works for different data types

---

### Step 3.2: Update SourcePerformanceTable

**Cursor.ai Prompt:**
```
Update src/components/dashboard/SourcePerformanceTable.tsx to use consistent zebra striping with CSS variables, add vertical dividers between all columns, and ensure hover effects work properly in both light and dark mode. Keep the existing Tremor Table components but add the new styling classes.
```

**Replace the table body styling in `src/components/dashboard/SourcePerformanceTable.tsx`:**
```typescript
'use client';

import { Card, Title, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge, Text } from '@tremor/react';
import { SourcePerformance } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';

interface SourcePerformanceTableProps {
  sources: SourcePerformance[];
  selectedSource: string | null;
  onSourceClick?: (source: string | null) => void;
  channelFilter: string | null;
}

export function SourcePerformanceTable({ 
  sources, 
  selectedSource, 
  onSourceClick,
  channelFilter 
}: SourcePerformanceTableProps) {
  const filteredData = channelFilter 
    ? sources.filter(s => s.channel === channelFilter)
    : sources;

  return (
    <Card className="mb-6 p-0 overflow-hidden border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <Title className="dark:text-white">Source Performance</Title>
        {channelFilter && (
          <Text className="text-sm text-blue-600 dark:text-blue-400 mt-1">
            Filtered by channel: {channelFilter}
          </Text>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700">
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Source
              </TableHeaderCell>
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Channel
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Prospects
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Contacted
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                MQLs
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQLs
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQOs
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Joined
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                MQL→SQL
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQL→SQO
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQO→Joined
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                AUM
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredData.map((source, idx) => {
              // Zebra striping
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              const isSelected = selectedSource === source.source;
              const selectedClass = isSelected 
                ? '!bg-blue-100 dark:!bg-blue-900/30' 
                : '';
              
              const hoverClass = 'hover:bg-blue-50 dark:hover:bg-blue-900/20';
              
              return (
                <TableRow 
                  key={idx}
                  className={`
                    ${zebraClass} 
                    ${selectedClass} 
                    ${hoverClass}
                    cursor-pointer transition-colors duration-150
                    border-b border-gray-100 dark:border-gray-800
                  `}
                  onClick={() => onSourceClick?.(isSelected ? null : source.source)}
                >
                  <TableCell className="font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-800">
                    {source.source}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400 border-r border-gray-100 dark:border-gray-800">
                    {source.channel}
                  </TableCell>
                  <TableCell className="text-right text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.prospects)}
                  </TableCell>
                  <TableCell className="text-right text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.contacted)}
                  </TableCell>
                  <TableCell className="text-right text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.mqls)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.sqls)}
                  </TableCell>
                  <TableCell className="text-right text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.sqos)}
                  </TableCell>
                  <TableCell className="text-right text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.joined)}
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge size="sm" color={source.mqlToSqlRate > 0.3 ? 'green' : source.mqlToSqlRate > 0.2 ? 'yellow' : 'red'}>
                      {formatPercent(source.mqlToSqlRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge size="sm" color={source.sqlToSqoRate > 0.5 ? 'green' : source.sqlToSqoRate > 0.3 ? 'yellow' : 'red'}>
                      {formatPercent(source.sqlToSqoRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge size="sm" color={source.sqoToJoinedRate > 0.4 ? 'green' : source.sqoToJoinedRate > 0.2 ? 'yellow' : 'red'}>
                      {formatPercent(source.sqoToJoinedRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(source.aum)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {filteredData.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No source data available
        </div>
      )}
    </Card>
  );
}
```

**✅ VERIFICATION GATE 3.2:**
- [ ] Zebra striping visible (alternating row colors)
- [ ] Vertical dividers between columns visible
- [ ] Hover effect highlights entire row
- [ ] Selected row has blue background
- [ ] Dark mode shows appropriate colors

---

### Step 3.3: Update ChannelPerformanceTable

**Cursor.ai Prompt:**
```
Update src/components/dashboard/ChannelPerformanceTable.tsx with the same styling patterns: zebra striping, vertical dividers, hover effects, and dark mode support. Match the structure used in SourcePerformanceTable.
```

**Replace `src/components/dashboard/ChannelPerformanceTable.tsx`:**
```typescript
'use client';

import { Card, Title, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge } from '@tremor/react';
import { ChannelPerformance } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';

interface ChannelPerformanceTableProps {
  channels: ChannelPerformance[];
  selectedChannel: string | null;
  onChannelClick?: (channel: string | null) => void;
}

export function ChannelPerformanceTable({ 
  channels, 
  selectedChannel, 
  onChannelClick 
}: ChannelPerformanceTableProps) {
  return (
    <Card className="mb-6 p-0 overflow-hidden border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <Title className="dark:text-white">Channel Performance</Title>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700">
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Channel
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQLs
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQOs
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQL→SQO
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Joined
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SQO→Joined
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                AUM
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {channels.map((channel, idx) => {
              // Zebra striping
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              const isSelected = selectedChannel === channel.channel;
              const selectedClass = isSelected 
                ? '!bg-blue-100 dark:!bg-blue-900/30' 
                : '';
              
              const hoverClass = 'hover:bg-blue-50 dark:hover:bg-blue-900/20';
              
              return (
                <TableRow 
                  key={idx}
                  className={`
                    ${zebraClass} 
                    ${selectedClass} 
                    ${hoverClass}
                    cursor-pointer transition-colors duration-150
                    border-b border-gray-100 dark:border-gray-800
                  `}
                  onClick={() => onChannelClick?.(isSelected ? null : channel.channel)}
                >
                  <TableCell className="font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-800">
                    {channel.channel}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(channel.sqls)}
                  </TableCell>
                  <TableCell className="text-right text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(channel.sqos)}
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge color={channel.sqlToSqoRate >= 0.5 ? 'green' : 'amber'}>
                      {formatPercent(channel.sqlToSqoRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(channel.joined)}
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge color={channel.sqoToJoinedRate >= 0.15 ? 'green' : 'amber'}>
                      {formatPercent(channel.sqoToJoinedRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(channel.aum)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {channels.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No channel data available
        </div>
      )}
    </Card>
  );
}
```

**✅ VERIFICATION GATE 3.3:**
- [ ] Channel table has zebra striping
- [ ] Vertical dividers visible
- [ ] Hover and selection work correctly

---

### Step 3.4: Update DetailRecordsTable

**Cursor.ai Prompt:**
```
Update src/components/dashboard/DetailRecordsTable.tsx with consistent zebra striping, vertical dividers, hover effects, and dark mode support. This table shows individual records so ensure it handles potentially many rows well.
```

**Update key sections of `src/components/dashboard/DetailRecordsTable.tsx`:**
```typescript
'use client';

import { Card, Title, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge, Button, Text } from '@tremor/react';
import { DetailRecord } from '@/types/dashboard';
import { ExternalLink, Download } from 'lucide-react';

interface DetailRecordsTableProps {
  records: DetailRecord[];
  title: string;
  filterDescription: string;
  canExport: boolean;
}

function getStageColor(stage: string): string {
  const stageColors: Record<string, string> = {
    'Joined': 'green',
    'Signed': 'emerald',
    'Negotiating': 'blue',
    'Sales Process': 'cyan',
    'Discovery': 'indigo',
    'Call Scheduled': 'violet',
    'Qualifying': 'purple',
    'Engaged': 'fuchsia',
    'Outreach': 'pink',
    'Re-Engaged': 'rose',
  };
  return stageColors[stage] || 'gray';
}

export function DetailRecordsTable({ 
  records, 
  title, 
  filterDescription,
  canExport 
}: DetailRecordsTableProps) {
  const handleExport = () => {
    // CSV export logic
    const headers = ['Advisor', 'Source', 'Stage', 'SGA', 'SGM', 'AUM'];
    const rows = records.map(r => [
      r.advisorName,
      r.source,
      r.stage,
      r.sga || '',
      r.sgm || '',
      r.aumFormatted
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `records-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <Card className="p-0 overflow-hidden border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <Title className="dark:text-white">{title}</Title>
          <Text className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {filterDescription}
          </Text>
        </div>
        {canExport && records.length > 0 && (
          <Button
            variant="secondary"
            size="xs"
            icon={Download}
            onClick={handleExport}
            className="dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
          >
            Export CSV
          </Button>
        )}
      </div>
      
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <Table>
          <TableHead className="sticky top-0 z-10">
            <TableRow className="bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700">
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Advisor
              </TableHeaderCell>
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Source
              </TableHeaderCell>
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                Stage
              </TableHeaderCell>
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SGA
              </TableHeaderCell>
              <TableHeaderCell className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                SGM
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
                AUM
              </TableHeaderCell>
              <TableHeaderCell className="text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                SF
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((record, idx) => {
              // Zebra striping
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              const hoverClass = 'hover:bg-blue-50 dark:hover:bg-blue-900/20';
              
              return (
                <TableRow 
                  key={record.id}
                  className={`
                    ${zebraClass} 
                    ${hoverClass}
                    transition-colors duration-150
                    border-b border-gray-100 dark:border-gray-800
                  `}
                >
                  <TableCell className="font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-800">
                    {record.advisorName}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400 border-r border-gray-100 dark:border-gray-800">
                    {record.source}
                  </TableCell>
                  <TableCell className="border-r border-gray-100 dark:border-gray-800">
                    <Badge color={getStageColor(record.stage) as any}>
                      {record.stage}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400 border-r border-gray-100 dark:border-gray-800">
                    {record.sga || '—'}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400 border-r border-gray-100 dark:border-gray-800">
                    {record.sgm || '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-800">
                    {record.aumFormatted}
                  </TableCell>
                  <TableCell className="text-center">
                    {record.salesforceUrl && (
                      <a
                        href={record.salesforceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {records.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No records match the current filters
        </div>
      )}
      
      {records.length > 0 && (
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
          Showing {records.length} record{records.length !== 1 ? 's' : ''}
        </div>
      )}
    </Card>
  );
}
```

**✅ VERIFICATION GATE 3.4:**
- [ ] Detail table has zebra striping
- [ ] Vertical dividers visible
- [ ] Hover effects work
- [ ] Sticky header works on scroll
- [ ] Dark mode styling correct

---

### Step 3.5: Update UserManagement Table

**Cursor.ai Prompt:**
```
Update src/components/settings/UserManagement.tsx to use consistent table styling with zebra striping, vertical dividers, and hover effects matching the dashboard tables.
```

**Update the table in UserManagement component:**
```typescript
// Find the <table> element and update it:

<div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
  <table className="w-full">
    <thead>
      <tr className="bg-gray-50 dark:bg-gray-900 border-b-2 border-gray-200 dark:border-gray-700">
        <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
          Name
        </th>
        <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
          Email
        </th>
        <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
          Role
        </th>
        <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
          Status
        </th>
        <th className="text-left py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
          Created
        </th>
        <th className="text-right py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Actions
        </th>
      </tr>
    </thead>
    <tbody>
      {users.map((user, idx) => {
        const zebraClass = idx % 2 === 0 
          ? 'bg-white dark:bg-gray-800' 
          : 'bg-gray-50 dark:bg-gray-900';
        
        return (
          <tr 
            key={user.id} 
            className={`
              ${zebraClass}
              hover:bg-blue-50 dark:hover:bg-blue-900/20
              transition-colors duration-150
              border-b border-gray-100 dark:border-gray-800
            `}
          >
            <td className="py-3 px-4 border-r border-gray-100 dark:border-gray-800">
              <span className="font-medium text-gray-900 dark:text-white">{user.name}</span>
              {user.email === currentUserEmail && (
                <Badge size="xs" color="blue" className="ml-2">You</Badge>
              )}
            </td>
            <td className="py-3 px-4 text-gray-600 dark:text-gray-400 border-r border-gray-100 dark:border-gray-800">
              {user.email}
            </td>
            <td className="py-3 px-4 border-r border-gray-100 dark:border-gray-800">
              <Badge color={ROLE_COLORS[user.role] as any} size="sm">
                {user.role.toUpperCase()}
              </Badge>
            </td>
            <td className="py-3 px-4 border-r border-gray-100 dark:border-gray-800">
              {user.isActive ? (
                <Badge color="green" size="sm">Active</Badge>
              ) : (
                <Badge color="red" size="sm">Inactive</Badge>
              )}
            </td>
            <td className="py-3 px-4 text-gray-600 dark:text-gray-400 border-r border-gray-100 dark:border-gray-800">
              {new Date(user.createdAt).toLocaleDateString()}
            </td>
            <td className="py-3 px-4 text-right">
              {/* Action buttons */}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>
```

**✅ VERIFICATION GATE 3.5:**
- [ ] User management table has consistent styling
- [ ] All verification gates from 3.1-3.4 still pass

---

## PHASE 4: Chart Dark Mode Support

### Step 4.1: Update ConversionTrendChart

**Cursor.ai Prompt:**
```
Update src/components/dashboard/ConversionTrendChart.tsx to support dark mode. The Recharts library needs theme-aware colors for axes, grid lines, tooltips, and the chart container.
```

**Key updates for the chart:**
```typescript
'use client';

import { useTheme } from 'next-themes';
import { Card, Title, Text, TabGroup, TabList, Tab } from '@tremor/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendDataPoint, ConversionTrendMode } from '@/types/dashboard';

// Add this inside the component:
const { resolvedTheme } = useTheme();
const isDark = resolvedTheme === 'dark';

// Theme colors
const chartColors = {
  grid: isDark ? '#374151' : '#e5e7eb',
  axis: isDark ? '#9ca3af' : '#6b7280',
  tooltip: {
    bg: isDark ? '#1f2937' : '#ffffff',
    border: isDark ? '#374151' : '#e5e7eb',
    text: isDark ? '#f9fafb' : '#111827',
  },
};

// Update the ResponsiveContainer section:
<ResponsiveContainer width="100%" height={350}>
  <LineChart data={trends}>
    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
    <XAxis 
      dataKey="period" 
      tick={{ fill: chartColors.axis }}
      axisLine={{ stroke: chartColors.grid }}
    />
    <YAxis 
      tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
      tick={{ fill: chartColors.axis }}
      axisLine={{ stroke: chartColors.grid }}
    />
    <Tooltip 
      contentStyle={{
        backgroundColor: chartColors.tooltip.bg,
        border: `1px solid ${chartColors.tooltip.border}`,
        borderRadius: '8px',
        color: chartColors.tooltip.text,
      }}
      formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, '']}
    />
    <Legend 
      wrapperStyle={{ color: chartColors.axis }}
    />
    {/* Lines */}
  </LineChart>
</ResponsiveContainer>
```

**Full component with dark mode:**
```typescript
'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Card, Title, Text, TabGroup, TabList, Tab, Select, SelectItem } from '@tremor/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendDataPoint, ConversionTrendMode } from '@/types/dashboard';

interface ConversionTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange: (granularity: 'month' | 'quarter') => void;
  granularity: 'month' | 'quarter';
  mode: ConversionTrendMode;
  onModeChange: (mode: ConversionTrendMode) => void;
  isLoading?: boolean;
}

const CONVERSION_COLORS = {
  contactedToMql: '#3b82f6', // blue
  mqlToSql: '#10b981',      // green  
  sqlToSqo: '#f59e0b',      // amber
  sqoToJoined: '#8b5cf6',   // purple
};

export function ConversionTrendChart({ 
  trends, 
  onGranularityChange,
  granularity,
  mode,
  onModeChange,
  isLoading 
}: ConversionTrendChartProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  const isDark = mounted && resolvedTheme === 'dark';
  
  const chartColors = {
    grid: isDark ? '#374151' : '#e5e7eb',
    axis: isDark ? '#9ca3af' : '#6b7280',
    tooltip: {
      bg: isDark ? '#1f2937' : '#ffffff',
      border: isDark ? '#374151' : '#e5e7eb',
      text: isDark ? '#f9fafb' : '#111827',
    },
  };

  if (isLoading || !mounted) {
    return (
      <Card className="mb-6 p-4 border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
        <div className="h-[400px] flex items-center justify-center">
          <div className="animate-pulse text-gray-400">Loading chart...</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6 p-4 border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Title className="dark:text-white">Conversion Rate Trends</Title>
          <Text className="text-gray-500 dark:text-gray-400">
            Track conversion rates over time
          </Text>
        </div>
        <div className="flex items-center gap-4">
          <Select
            value={mode}
            onValueChange={(v) => onModeChange(v as ConversionTrendMode)}
            className="w-32"
          >
            <SelectItem value="period">Period</SelectItem>
            <SelectItem value="cohort">Cohort</SelectItem>
          </Select>
          <TabGroup 
            index={granularity === 'month' ? 0 : 1}
            onIndexChange={(idx) => onGranularityChange(idx === 0 ? 'month' : 'quarter')}
          >
            <TabList variant="solid" className="dark:bg-gray-700">
              <Tab className="dark:text-gray-300">Monthly</Tab>
              <Tab className="dark:text-gray-300">Quarterly</Tab>
            </TabList>
          </TabGroup>
        </div>
      </div>
      
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={trends}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
          <XAxis 
            dataKey="period" 
            tick={{ fill: chartColors.axis, fontSize: 12 }}
            axisLine={{ stroke: chartColors.grid }}
            tickLine={{ stroke: chartColors.grid }}
          />
          <YAxis 
            tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
            tick={{ fill: chartColors.axis, fontSize: 12 }}
            axisLine={{ stroke: chartColors.grid }}
            tickLine={{ stroke: chartColors.grid }}
            domain={[0, 'auto']}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: chartColors.tooltip.bg,
              border: `1px solid ${chartColors.tooltip.border}`,
              borderRadius: '8px',
              color: chartColors.tooltip.text,
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            }}
            labelStyle={{ color: chartColors.tooltip.text, fontWeight: 600 }}
            formatter={(value: number, name: string) => [
              `${(value * 100).toFixed(1)}%`,
              name.replace(/([A-Z])/g, ' $1').replace('To', '→').trim()
            ]}
          />
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
            formatter={(value) => (
              <span style={{ color: chartColors.axis }}>
                {value.replace(/([A-Z])/g, ' $1').replace('To', '→').trim()}
              </span>
            )}
          />
          <Line 
            type="monotone" 
            dataKey="contactedToMql" 
            stroke={CONVERSION_COLORS.contactedToMql}
            strokeWidth={2}
            dot={{ fill: CONVERSION_COLORS.contactedToMql, strokeWidth: 2 }}
            activeDot={{ r: 6, strokeWidth: 2 }}
          />
          <Line 
            type="monotone" 
            dataKey="mqlToSql" 
            stroke={CONVERSION_COLORS.mqlToSql}
            strokeWidth={2}
            dot={{ fill: CONVERSION_COLORS.mqlToSql, strokeWidth: 2 }}
            activeDot={{ r: 6, strokeWidth: 2 }}
          />
          <Line 
            type="monotone" 
            dataKey="sqlToSqo" 
            stroke={CONVERSION_COLORS.sqlToSqo}
            strokeWidth={2}
            dot={{ fill: CONVERSION_COLORS.sqlToSqo, strokeWidth: 2 }}
            activeDot={{ r: 6, strokeWidth: 2 }}
          />
          <Line 
            type="monotone" 
            dataKey="sqoToJoined" 
            stroke={CONVERSION_COLORS.sqoToJoined}
            strokeWidth={2}
            dot={{ fill: CONVERSION_COLORS.sqoToJoined, strokeWidth: 2 }}
            activeDot={{ r: 6, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
```

**✅ VERIFICATION GATE 4.1:**
- [ ] Chart renders in light mode with correct colors
- [ ] Chart renders in dark mode with dark background
- [ ] Axis labels readable in both modes
- [ ] Tooltip styled correctly in both modes
- [ ] No hydration errors

---

## PHASE 5: Global Filters Dark Mode

### Step 5.1: Update GlobalFilters Component

**Cursor.ai Prompt:**
```
Update src/components/dashboard/GlobalFilters.tsx to support dark mode. Update all Select components, Button, and container styling to use dark mode compatible colors.
```

**Key styling updates:**
```typescript
// Card container
<Card className="mb-6 p-4 border border-gray-200 dark:border-gray-700 dark:bg-gray-800">

// Labels
<label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">

// Select components - add dark mode classes
<Select 
  className="dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
  ...
>

// Reset button
<Button 
  variant="secondary" 
  onClick={onReset}
  className="dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600"
>
  Reset
</Button>
```

**✅ VERIFICATION GATE 5.1:**
- [ ] Filter dropdowns visible in dark mode
- [ ] Labels readable in dark mode
- [ ] Reset button styled correctly

---

## PHASE 6: Final Integration Testing

### Step 6.1: Run Full Test Suite

**Cursor.ai Prompt:**
```
Run npm run dev and manually test all components in both light and dark mode. Check: 1) Theme toggle cycles correctly, 2) All scorecards have borders and hover effects, 3) All tables have zebra striping and vertical dividers, 4) All hover effects work, 5) Theme persists on reload.
```

**Manual Testing Checklist:**

| Component | Light Mode | Dark Mode | Hover | Selection |
|-----------|------------|-----------|-------|-----------|
| Theme Toggle | [ ] | [ ] | [ ] | N/A |
| Scorecards | [ ] | [ ] | [ ] | [ ] |
| Conversion Cards | [ ] | [ ] | [ ] | N/A |
| Channel Table | [ ] | [ ] | [ ] | [ ] |
| Source Table | [ ] | [ ] | [ ] | [ ] |
| Detail Table | [ ] | [ ] | [ ] | N/A |
| Trend Chart | [ ] | [ ] | N/A | N/A |
| Global Filters | [ ] | [ ] | [ ] | N/A |
| User Management | [ ] | [ ] | [ ] | N/A |

**✅ FINAL VERIFICATION GATE:**
- [ ] All manual tests pass
- [ ] No console errors in browser
- [ ] Theme persists after page reload
- [ ] No flash of unstyled content (FOUC)
- [ ] TypeScript compiles without errors (`npm run build`)

---

## Quick Reference: Class Patterns

### Zebra Striping
```typescript
const zebraClass = idx % 2 === 0 
  ? 'bg-white dark:bg-gray-800' 
  : 'bg-gray-50 dark:bg-gray-900';
```

### Hover Effect
```typescript
const hoverClass = 'hover:bg-blue-50 dark:hover:bg-blue-900/20';
```

### Selection State
```typescript
const selectedClass = isSelected 
  ? '!bg-blue-100 dark:!bg-blue-900/30' 
  : '';
```

### Vertical Divider
```typescript
className="border-r border-gray-100 dark:border-gray-800"
```

### Header Cell
```typescript
className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700"
```

### Card Container
```typescript
className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800"
```

### Clickable Scorecard
```typescript
className={`
  relative p-4 rounded-lg transition-all duration-200
  bg-white dark:bg-gray-800
  border-2 
  ${isSelected 
    ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20' 
    : 'border-gray-200 dark:border-gray-700'
  }
  ${isClickable 
    ? 'cursor-pointer hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5' 
    : ''
  }
`}
```

---

## Troubleshooting

### Issue: Hydration Mismatch
**Solution:** Add `suppressHydrationWarning` to `<html>` tag and use `mounted` state check before rendering theme-dependent content.

### Issue: Theme Not Persisting
**Solution:** Ensure `next-themes` is properly configured and `localStorage` is not blocked.

### Issue: Tremor Components Not Styled
**Solution:** Add Tremor classes to Tailwind safelist and ensure globals.css overrides are specific enough.

### Issue: Dark Mode Flash on Load
**Solution:** Use the `class` strategy and add a script to `<head>` that sets the class before render.

---

## Summary

This guide implements:
1. **Dark/Light Mode Toggle** - Three-way toggle (light/dark/system) using next-themes
2. **Scorecard Borders & Hover** - Visual indicators showing clickability
3. **Table Zebra Striping** - Alternating row colors for readability
4. **Vertical Dividers** - Column separation for data clarity
5. **Consistent Hover States** - Blue highlight on hover for interactive elements

All changes maintain accessibility, support keyboard navigation, and follow the existing codebase patterns.
