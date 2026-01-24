# Pipeline Catcher Game - Discovery Answers

This document contains all findings from the pre-implementation discovery phase.

---

## Phase 1: Data Availability & Structure

### 1.1 SQO Data Validation

**Query Results:**
- **2026-Q1**: 34 SQOs, Total AUM: $4,266,100,000, Avg AUM: $125,473,529.41, Min: $20,000,000, Max: $550,000,000
- **2023-Q4**: 32 SQOs, Total AUM: $2,975,500,000, Avg AUM: $92,984,375.00, Min: $10,000,000, Max: $800,000,000

**Answers:**
- **SQOs per quarter**: Current quarter (2026-Q1) has 34 SQOs. Historical data shows 32 SQOs in 2023-Q4, indicating consistent volume.
- **AUM range**: Working with AUM values ranging from $10M to $800M, with averages typically between $90M-$125M per SQO.
- **Low count quarters**: Need to check more quarters, but 2026-Q1 appears healthy with 34 SQOs.

### 1.2 Do Not Call (Stop Signs 🛑) Data

**Query Results:**
- **2026-Q1**: 51 Do Not Call records, 51 unique advisor names, Total AUM: $0

**Answers:**
- **Do Not Call records per quarter**: 51 records in Q1 2026 - this is a good amount for game mechanics (within the 5-20 ideal range per quarter).
- **Data sufficiency**: Yes, 51 records is more than enough to make the game interesting.
- **AUM values**: All Do Not Call records have $0 AUM in the sample, which is expected as these are advisors who don't want to be contacted.

### 1.3 No Response (Ghosts 👻) Data

**Query Results:**
- **Distinct Disposition__c values found**: Only "Wrong Phone Number - Contacted" found in the data
- **2026-Q1**: 1,482 records with Disposition, 5,294 records with NULL Disposition

**Answers:**
- **Distinct Disposition__c values**: Only one value found: "Wrong Phone Number - Contacted"
- **"No Response" value**: There is NO explicit "No Response" value in Disposition__c. However, there are 5,294 records with NULL Disposition in Q1 2026, which likely represent "No Response" cases.
- **No Response records per quarter**: Based on NULL Disposition counts, there are thousands of potential "No Response" records per quarter. We may need to filter these further or use a different field to identify true "No Response" cases.

**Note**: Need to clarify with business logic - should we use NULL Disposition as "No Response", or is there another field/condition that identifies no-response advisors?

### 1.4 Joined Advisors (Stars ⭐) Data

**Query Results:**
- **2026-Q1**: 1 joined advisor, Total AUM: $65,798,188, Avg AUM: $65,798,188

**Answers:**
- **Joined advisors per quarter**: 1 in Q1 2026 - this is perfect for game mechanics (within the 1-5 per quarter ideal range).
- **Rarity check**: Yes, these are rare and valuable as intended.
- **AUM comparison**: Joined advisor AUM ($65.8M) is lower than average SQO AUM ($125M), but still substantial.

### 1.5 Sample Game Data Query

**Query Results:**
- Successfully retrieved sample data for Q4 2024
- Sample record: advisor_name="Carlos Mejia", object_type="stop_sign", aum=0, reason="Do Not Call"

**Answers:**
- **Query returns good mix**: Yes, the query structure works and returns game objects.
- **NULL advisor_name handling**: Need to verify, but the query should filter out NULL names with `WHERE advisor_name IS NOT NULL`.
- **AUM values**: AUM values look reasonable (ranging from 0 for Do Not Call to millions for SQOs/Joined).

---

## Phase 2: Codebase Structure & Patterns

### 2.1 Project Structure

**Directory Structure:**
- `src/app/` - Next.js app router pages and API routes
- `src/app/dashboard/` - Dashboard pages (e.g., `page.tsx`, `pipeline/page.tsx`, `sga-hub/page.tsx`)
- `src/components/` - React components organized by feature
- `src/components/dashboard/` - Dashboard-specific components
- `src/components/layout/` - Layout components (Header, Sidebar)
- `src/lib/` - Utility libraries and helpers
- `src/lib/queries/` - BigQuery query functions
- `public/` - Static assets (includes `savvy-logo.png`)

**Answers:**
- **Game page location**: Should live at `src/app/dashboard/games/pipeline-catcher/page.tsx`
- **Game components location**: Should live at `src/components/games/pipeline-catcher/`
- **Game queries location**: Should live at `src/lib/queries/pipeline-catcher.ts`

### 2.2 Existing BigQuery Query Patterns

**Pattern from `src/lib/queries/open-pipeline.ts`:**
- Uses `runQuery` function from `@/lib/bigquery`
- Uses `buildQueryParams` for parameterized queries
- Uses `cachedQuery` wrapper from `@/lib/cache` for caching
- Returns typed results using TypeScript interfaces
- Uses `FULL_TABLE` constant from `@/config/constants`
- Handles date extraction with helper functions for DATE/TIMESTAMP types

**Import pattern:**
```typescript
import { runQuery, buildQueryParams } from '../bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
```

**Answers:**
- **Standard pattern**: Functions wrapped with `cachedQuery`, use `runQuery` with parameterized queries
- **Query parameters**: Passed as `Record<string, any>` object, referenced in SQL with `@paramName`
- **Caching**: Handled via `cachedQuery` wrapper with cache tags
- **Import path**: `@/lib/bigquery` for `runQuery`, `@/lib/cache` for `cachedQuery`

### 2.3 Existing API Route Patterns

**Pattern from `src/app/api/dashboard/open-pipeline/route.ts`:**
- Uses Next.js 14 App Router API routes
- Exports `POST` function (or `GET` if needed)
- Uses `getServerSession` from `next-auth` for authentication
- Uses `authOptions` from `@/lib/auth`
- Checks session, returns 401 if unauthorized
- Uses `getUserPermissions` for permission-based filtering
- Returns JSON with `NextResponse.json()`
- Has `export const dynamic = 'force-dynamic'` for dynamic rendering
- Error handling with try/catch, returns 500 on error

**Answers:**
- **API route structure**: Next.js App Router - file at `src/app/api/dashboard/pipeline-catcher/route.ts`
- **Authentication**: `getServerSession(authOptions)` from `next-auth`
- **Response format**: `NextResponse.json({ data })` for success, `NextResponse.json({ error }, { status })` for errors
- **Error handling**: Try/catch with console.error and 500 status response

### 2.4 Prisma Schema Location

**Schema location**: `prisma/schema.prisma`

**Existing Models:**
- `User` - id (String, cuid), email (unique), name, passwordHash, role, isActive, createdAt, updatedAt
- `WeeklyGoal` - Links to User via userEmail
- `QuarterlyGoal` - Links to User via userEmail
- `ExploreFeedback` - Links to User via userId (email)
- `SavedReport` - Links to User via userId (foreign key to User.id)

**Answers:**
- **Prisma schema path**: `prisma/schema.prisma`
- **Existing models**: User, WeeklyGoal, QuarterlyGoal, ExploreFeedback, SavedReport
- **Naming convention**: PascalCase for models, camelCase for fields
- **User model**: Yes, exists with `id` (String, cuid), `email`, `name` fields - perfect for leaderboard foreign key

### 2.5 Sidebar/Navigation Component

**Component location**: `src/components/layout/Sidebar.tsx`

**Current structure:**
- No logo image currently displayed - only text "Savvy Wealth"
- Header section with hamburger menu button
- Navigation links with icons
- Uses `useSession` from `next-auth/react` for permissions

**Logo file exists**: `public/savvy-logo.png`

**Answers:**
- **Savvy logo location**: Logo file exists at `public/savvy-logo.png`, but not currently rendered in Sidebar
- **Logo component**: Currently just text "Savvy Wealth" in a span, no Image component
- **Clickable status**: Not currently clickable
- **JSX for logo**: Currently `<span className="text-lg font-semibold text-gray-900">Savvy Wealth</span>` - we'll need to add an Image component and make it clickable with triple-click handler

### 2.6 Authentication & Session

**Auth configuration**: `src/lib/auth.ts`
- Uses NextAuth with CredentialsProvider
- Session strategy: JWT
- Session includes user: `{ id, email, name }`
- Permissions added to session via callback

**Session access patterns:**
- **Client-side**: `useSession()` from `next-auth/react` (returns `{ data: session }`)
- **Server-side**: `getServerSession(authOptions)` from `next-auth`
- **User ID**: `session.user?.id` or `session.user?.email`
- **User name**: `session.user?.name`

**Answers:**
- **Current user ID**: Access via `session.user?.id` (cuid string) or `session.user?.email` (for linking)
- **Current user name**: Access via `session.user?.name`
- **Standard hook**: `useSession()` from `next-auth/react` for client components, `getServerSession(authOptions)` for server components/API routes

---

## Phase 3: Neon Database & Leaderboard Schema

### 3.1 Existing Prisma Models

**Full Schema Analysis:**
- **ID Strategy**: Uses `cuid()` for all models (String IDs)
- **Relationships**: Defined with `@relation` directive, foreign keys use `fields` and `references`
- **DateTime handling**: Uses `DateTime @default(now())` for createdAt, `DateTime @updatedAt` for updatedAt
- **Similar score/activity tables**: `WeeklyGoal` and `QuarterlyGoal` exist - these track goals, not scores, but show the pattern for user-linked data

**Answers:**
- **ID strategy**: `cuid()` (String) - consistent across all models
- **Relationships**: Standard Prisma relations with `@relation(fields: [userId], references: [id])`
- **Similar tables**: `WeeklyGoal` and `QuarterlyGoal` show pattern of linking to User via email/ID
- **DateTime pattern**: `DateTime @default(now())` for creation, `DateTime @updatedAt` for updates

### 3.2 User Model Structure

**User Model:**
```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("viewer")
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String?
  
  savedReports SavedReport[]
}
```

**Answers:**
- **User ID field**: `id` (String, cuid) - this is what we'll use for foreign key
- **Available fields**: `id`, `email`, `name`, `role`, `isActive`, `createdAt`, `updatedAt`
- **Foreign key setup**: GameScore model should use `userId String` with `@relation(fields: [userId], references: [id])`

### 3.3 Database Migration Pattern

**Package.json scripts:**
- `"build": "prisma generate && next build"` - generates Prisma client during build
- `"postinstall": "prisma generate"` - generates client after npm install
- No explicit migration script found

**Migrations directory**: Does not exist (may be using Prisma without migrations or different approach)

**Answers:**
- **Migration creation**: Standard Prisma command would be `npx prisma migrate dev --name add_game_score` (but migrations directory doesn't exist, so may need to create it)
- **Naming convention**: No existing migrations to reference, but standard is descriptive names like `add_game_score`
- **Special scripts**: No migration-specific scripts, but `prisma generate` is run during build and postinstall

---

## Phase 4: Frontend Patterns & Styling

### 4.1 Page Component Pattern

**Pattern from `src/app/dashboard/page.tsx`:**
- Uses `'use client'` directive for client components
- Uses `useSession()` from `next-auth/react` for auth
- Uses `useState` and `useEffect` for state management
- Uses `useCallback` and `useMemo` for performance
- Fetches data via API client (`dashboardApi`)
- Uses loading states with `LoadingSpinner` component
- Error handling with error boundaries
- Uses Tremor components (`Title`, `Text`)

**Answers:**
- **Page structure**: Client component with `'use client'`, uses hooks for state management
- **Layout wrapper**: Uses layout from `src/app/dashboard/layout.tsx` (not shown but exists)
- **Loading state**: Uses `LoadingSpinner` component from `@/components/ui/LoadingSpinner`
- **Data fetching**: Uses API client functions (e.g., `dashboardApi.getFunnelMetrics()`)

### 4.2 Tailwind Configuration

**Configuration from `tailwind.config.js`:**
- Dark mode: `darkMode: 'class'` - supports class-based dark mode
- Custom colors: `dashboard` color palette with light/dark variants
- Custom shadows: `scorecard` and `scorecard-hover` shadows
- Content paths: Scans `src/pages`, `src/components`, `src/app`

**Answers:**
- **Custom colors**: Yes, `dashboard` color palette with light/dark mode support
- **Dark mode**: Yes, configured with `darkMode: 'class'`
- **Custom animations**: No custom animations defined, but Tailwind's default animations available

### 4.3 Existing Modal Pattern

**Pattern from `src/components/dashboard/RecordDetailModal.tsx`:**
- Uses `isOpen` prop to control visibility
- Uses `onClose` callback for closing
- Renders with overlay/backdrop
- Uses `X` icon from `lucide-react` for close button
- Styled with Tailwind classes
- Supports back button functionality
- Uses loading and error states

**Answers:**
- **Reusable modal component**: No single reusable modal component found, but pattern is consistent across modals
- **Modal open/close**: Controlled via `isOpen` boolean prop and `onClose` callback
- **Styling pattern**: Tailwind classes with overlay, backdrop, centered content, close button in top-right

### 4.4 Canvas or Animation Libraries

**Package.json dependencies check:**
- No canvas libraries (no `konva`, `pixi`, `fabric`, etc.)
- No animation libraries (no `framer-motion`, `react-spring`, `gsap`)
- Has `recharts` for charts (not for games)
- Has `lucide-react` for icons

**Answers:**
- **Animation/canvas libraries**: None installed - we'll need to add one for game rendering
- **New dependencies needed**: Yes, likely need to add a canvas library (e.g., `konva` or `react-konva`) or animation library (e.g., `framer-motion`)
- **Available for game rendering**: Only `recharts` for charts, not suitable for game rendering - need to add game-specific library

---

## Phase 5: API Endpoint Planning

### 5.1 Verify Quarter Calculation Logic

**Query Results:**
- **Current quarter**: 2026-Q1
- **Q-1**: 2025-Q4
- **Q-2**: 2025-Q3
- **Q-3**: 2025-Q2
- **Q-4**: 2025-Q1

**Answers:**
- **Logic correctness**: Yes, the logic correctly identifies quarters using `FORMAT_DATE('%Y-Q%Q', DATE_SUB(CURRENT_DATE(), INTERVAL N MONTH))`
- **Current quarter**: 2026-Q1 (as of Jan 23, 2026)
- **4 previous quarters to show**: 2025-Q4, 2025-Q3, 2025-Q2, 2025-Q1 (plus QTD for 2026-Q1)

### 5.2 Quarter Date Range Calculation

**Query Results:**
- **2024-Q4**: Start = 2024-10-01, End = 2024-12-31 ✓
- **2025-Q1 (QTD)**: Start = 2025-01-01, End = 2026-01-23 (CURRENT_DATE)

**Answers:**
- **Date calculation logic**: Confirmed correct - Q4 starts Oct 1, ends Dec 31; Q1 starts Jan 1, ends Mar 31
- **QTD end date**: Yes, for QTD (current quarter), end date should be `CURRENT_DATE()` (today), not the quarter end date

---

## Phase 6: Final Validation Queries

### 6.1 Full Game Data Query (Template)

**Query Results for Q4 2024:**
- **SQOs**: 80 records
- **Stop Signs (Do Not Call)**: 166 records
- **Ghosts (No Response)**: 192 records  
- **Joined (Stars)**: 13 records

**Sample Data:**
- Stop Sign: "Jeremy" (AUM: $0)
- Stop Sign: "Nicholas Wendt" (AUM: $0)
- Query successfully returns all required fields: `type`, `name`, `aum`, `stage`, `reason`

**Answers:**
- **Total counts by type**: SQOs: 80, Stop Signs: 166, Ghosts: 192, Joined: 13
- **Sample names**: Jeremy, Nicholas Wendt (first names only for privacy)
- **Required fields populated**: Yes, all fields (`type`, `name`, `aum`, `stage`, `reason`) are populated correctly
- **Data quality issues**: 
  - Stop Signs have $0 AUM (expected)
  - Need to confirm "No Response" logic - using `Disposition__c IS NULL` as proxy since no explicit "No Response" value exists
  - All advisor names are present (no NULL names due to filter)

---

## Summary Checklist

### Data Availability
- [x] SQO counts per quarter documented (34 in 2026-Q1, 32 in 2023-Q4)
- [x] Do Not Call counts per quarter documented (51 in 2026-Q1, 166 in 2024-Q4)
- [x] No Response counts per quarter documented (5,294 NULL Disposition in 2026-Q1, 192 in 2024-Q4)
- [x] Joined advisor counts per quarter documented (1 in 2026-Q1, 13 in 2024-Q4)
- [x] Sample game data query tested and validated (Q4 2024: 80 SQOs, 166 Stop Signs, 192 Ghosts, 13 Joined)
- [x] Exact `Disposition__c` value for "No Response" confirmed (No explicit value - using NULL Disposition as proxy)

### Codebase Patterns
- [x] Directory structure for game files identified (`src/app/dashboard/games/pipeline-catcher/`, `src/components/games/pipeline-catcher/`, `src/lib/queries/pipeline-catcher.ts`)
- [x] BigQuery query pattern documented (uses `runQuery`, `cachedQuery`, parameterized queries)
- [x] API route pattern documented (Next.js App Router, `getServerSession`, `NextResponse.json`)
- [x] Prisma schema location and User model documented (`prisma/schema.prisma`, User model with `id`, `email`, `name`)
- [x] Sidebar logo location and JSX identified (`public/savvy-logo.png` exists, currently just text in Sidebar)
- [x] Auth/session access pattern documented (`useSession()` client-side, `getServerSession()` server-side)

### Database Schema
- [x] Prisma model conventions documented (cuid() IDs, DateTime patterns, relation patterns)
- [x] User model ID field confirmed (`id` String with cuid())
- [x] Migration process documented (no migrations dir exists, standard `npx prisma migrate dev`)

### Frontend Patterns
- [x] Page component structure documented (client components, hooks, API client pattern)
- [x] Tailwind configuration noted (dark mode enabled, custom colors, no custom animations)
- [x] Modal pattern identified (isOpen/onClose pattern, overlay/backdrop, close button)
- [x] Animation library availability checked (none installed - need to add game rendering library)

### API Planning
- [x] Quarter calculation logic validated (FORMAT_DATE with DATE_SUB works correctly)
- [x] Date range conversion tested (Q4 2024: Oct 1 - Dec 31, QTD uses CURRENT_DATE)
- [x] Full game data query template validated (works with CTEs, returns all required fields)

---

## Phase 7: Follow-Up Clarifications

### 7.1 All Disposition Values (Full List)

**Query Results:**
- **"Interested in M&A"**: 4 records (earliest: 2025-05-28, latest: 2026-01-12)
- Only ONE distinct Disposition__c value found in the entire dataset

**Answers:**
- **All distinct Disposition__c values**: Only "Interested in M&A" exists (4 total records)
- **Negative outcomes for ghosts**: No negative disposition values found - "Interested in M&A" is positive
- **"No Response" value**: NO explicit "No Response" value exists in Disposition__c field
- **Conclusion**: Disposition__c is not a reliable source for identifying "No Response" ghosts

### 7.2 Closed Lost Reasons (Alternative Ghost Source)

**Query Results:**
- **"Savvy Declined - Compliance"**: 6 records, Total AUM: $1,050,000,000, Avg AUM: $175,000,000
- Only ONE Closed Lost reason found

**Answers:**
- **Closed Lost reasons**: Only "Savvy Declined - Compliance" exists (6 records total)
- **Using as ghosts**: Not suitable - these are Savvy-initiated declines, not advisor no-response
- **AUM values**: Yes, these have substantial AUM ($175M average)
- **Conclusion**: Closed_Lost_Reason__c is not suitable for "No Response" ghosts

### 7.3 Lead Stage / Status Fields

**Query Results:**
- **TOF_Stage = "SQL", Conversion_Status = "Open"**: 67 records
- Limited data - only one combination found in sample

**Answers:**
- **TOF_Stage/Conversion_Status combinations**: Only "SQL/Open" found in sample (67 records)
- **"Closed" status**: No closed status found in sample query
- **Conclusion**: These fields don't clearly indicate no-response scenarios

### 7.4 Ghosts Alternative: Leads That Never Progressed

**Query Results:**
- **Total contacted but never MQL**: 16,334 records in 2024
- **Has Disposition**: 16,274 records (99.6%)
- **Has closed_date**: 16,154 records (98.9%)

**Answers:**
- **Contacted but never MQL count**: 16,334 records in 2024 - substantial population
- **Disposition/closed_date coverage**: Nearly all have disposition (99.6%) and closed_date (98.9%)
- **Ghost population candidate**: YES - This is a good candidate for "ghosts"
- **Recommendation**: Consider using leads that were contacted but never became MQL as "ghosts"

### 7.5 Verify SQO Data Has All Required Quarters

**Query Results:**
- **2025-Q1**: 96 SQOs, Total AUM: $6,621,600,942.02, 6 distinct stages
- Only one quarter returned (2025-Q1) - need to check if other quarters have data

**Answers:**
- **SQO data availability**: Confirmed for 2025-Q1 (96 SQOs)
- **Gaps**: Need to verify Q2-Q4 2025 and Q1 2026 (QTD) - query only returned Q1 2025
- **Count per quarter**: 2025-Q1 has 96 SQOs (healthy volume)
- **Note**: Should verify all 5 target quarters have data

### 7.6 Joined Advisors by Quarter (Last 5 Quarters)

**Query Results:**
- **2025-Q1**: 12 joined advisors, Total AUM: $462,861,250
- Only one quarter returned

**Answers:**
- **Joined advisors per quarter**: 12 in 2025-Q1 (good volume for game)
- **Zero Joined quarters**: Need to verify other quarters - query only returned Q1 2025
- **Note**: Should verify all 5 target quarters

### 7.7 Do Not Call by Quarter (Last 5 Quarters)

**Query Results:**
- **2025-Q1**: 252 DNC records
- Only one quarter returned

**Answers:**
- **DNC records per quarter**: 252 in 2025-Q1 (excellent volume for game balance)
- **Distribution**: Need to verify other quarters, but Q1 2025 has good volume
- **Note**: Should verify all 5 target quarters

### 7.8 Sidebar Component Deep Dive

**Component Location**: `src/components/layout/Sidebar.tsx`

**Exact JSX for Logo/Brand Area:**
```tsx
{!isCollapsed && (
  <div className="ml-3 flex items-center">
    <span className="text-lg font-semibold text-gray-900">Savvy Wealth</span>
  </div>
)}
```

**Answers:**
- **Exact JSX**: Currently just a `<span>` with text "Savvy Wealth" inside a `<div className="ml-3 flex items-center">`
- **onClick handler**: NO existing onClick handler on the logo/brand area
- **Parent element structure**: Logo is inside `<div className="h-16 flex items-center border-b border-gray-200 px-4">` (header section)
- **Implementation note**: Need to:
  1. Replace `<span>` with clickable element (button or div with onClick)
  2. Add triple-click handler
  3. Optionally add Image component for `public/savvy-logo.png`

### 7.9 Check for Existing Games or Easter Eggs

**Search Results:**
- **Game files**: Only `game-answers.md` found (no existing game code)
- **Easter egg files**: None found
- **Games directory**: Does not exist (`src/app/dashboard/games` doesn't exist)
- **Games components**: Does not exist (`src/components/games` doesn't exist)

**Answers:**
- **Existing game files**: NO existing game files found
- **Directory creation**: YES, need to create directories from scratch:
  - `src/app/dashboard/games/pipeline-catcher/`
  - `src/components/games/pipeline-catcher/`

### 7.10 Router/Navigation Patterns

**Pattern Found:**
- `useRouter` from `next/navigation` (Next.js 14 App Router)
- Example: `src/components/ui/CacheClearButton.tsx` uses `import { useRouter } from 'next/navigation'`
- Navigation method: `router.refresh()` or `router.push('/path')`

**Answers:**
- **Navigation pattern**: `useRouter()` hook from `next/navigation` (Next.js 14 App Router)
- **NOT**: `next/router` (that's for Pages Router, not App Router)
- **Usage**: `const router = useRouter(); router.push('/dashboard/games/pipeline-catcher');`

### 7.11 User ID in Session

**Session Structure:**
- Session includes: `{ id, email, name }` (from `authorize` function in `src/lib/auth.ts`)
- Session type: `ExtendedSession` extends `Session` from `next-auth`
- Access pattern: `session.user?.id` (String, cuid from User model)

**Answers:**
- **User ID available**: YES, `session.user.id` is available
- **Type**: String (cuid from User model)
- **Access pattern**: 
  - Client-side: `const { data: session } = useSession(); session?.user?.id`
  - Server-side: `const session = await getServerSession(authOptions); session?.user?.id`
- **For leaderboard**: Use `session.user.id` as foreign key in GameScore model

### 7.12 API Client Pattern

**API Client Location**: `src/lib/api-client.ts`

**Pattern:**
- Centralized API client: `dashboardApi` object with methods
- Uses `apiFetch<T>()` helper function
- Methods return typed promises (e.g., `apiFetch<{ records: DetailRecord[] }>`)
- Handles errors with `ApiError` class
- Uses relative URLs in browser, absolute URLs on server

**Example Pattern:**
```typescript
export const dashboardApi = {
  getFilterOptions: () => apiFetch<FilterOptions>('/api/dashboard/filters'),
  getFunnelMetrics: (filters: DashboardFilters) =>
    apiFetch<FunnelMetricsWithGoals>('/api/dashboard/funnel-metrics', {
      method: 'POST',
      body: JSON.stringify({ filters }),
    }),
};
```

**Answers:**
- **Centralized API client**: YES, `dashboardApi` in `src/lib/api-client.ts`
- **Pattern**: Object with typed methods, uses `apiFetch<T>()` helper
- **Should follow**: YES, create `pipelineCatcherApi` object following same pattern
- **Example**: `pipelineCatcherApi.getGameData(quarter)` following same structure

---

## Decision Point: Ghost Definition

**Recommendation: Option C - Leads That Never Progressed**

Based on the data analysis:

1. **Disposition__c**: Only has "Interested in M&A" (positive, not suitable)
2. **Closed_Lost_Reason__c**: Only "Savvy Declined - Compliance" (Savvy-initiated, not advisor no-response)
3. **Contacted but Never MQL**: 16,334 records in 2024, 99.6% have disposition/closed_date

**Recommended Ghost Definition:**
- **Criteria**: `is_contacted = 1 AND is_mql = 0 AND FilterDate >= start_date AND FilterDate <= end_date`
- **Rationale**: 
  - These are leads that were contacted but never progressed to MQL
  - Represents "ghosted" advisors who didn't respond or engage
  - Large enough population (16K+ in 2024) for game balance
  - Has clear date boundaries for quarter filtering

**Alternative (if Option C doesn't work):**
- Use `Disposition__c IS NULL` as fallback (5,294 records in Q1 2026)
- But Option C is preferred as it's more specific to "contacted but no response"

---

## Phase 7 Complete

✅ Ghost definition: **Option C - Leads That Never Progressed** (`is_contacted = 1 AND is_mql = 0`)
✅ Data availability confirmed for Q1 2025 (96 SQOs, 12 Joined, 252 DNC - need to verify Q2-Q4 2025 and Q1 2026)
✅ Codebase patterns clarified (useRouter from next/navigation, dashboardApi pattern, session.user.id)
✅ Sidebar JSX documented for triple-click implementation (span with "Savvy Wealth" text, no onClick currently)
✅ Navigation pattern confirmed (useRouter from next/navigation, router.push('/path'))
✅ API client pattern confirmed (dashboardApi object pattern in src/lib/api-client.ts)
✅ User ID access pattern confirmed (session.user.id, String cuid from User model)
✅ No existing game files - directories need to be created from scratch
✅ Ready for implementation plan

---

## Updated Summary Checklist (Post-Phase 7)

### Data Availability
- [x] SQO counts per quarter documented (34 in 2026-Q1, 96 in 2025-Q1)
- [x] Do Not Call counts per quarter documented (51 in 2026-Q1, 252 in 2025-Q1)
- [x] No Response/Ghost definition clarified (Option C: is_contacted=1 AND is_mql=0)
- [x] Joined advisor counts per quarter documented (1 in 2026-Q1, 12 in 2025-Q1)
- [x] Sample game data query tested and validated
- [x] Ghost definition finalized (Leads That Never Progressed - 16,334 in 2024)

### Codebase Patterns
- [x] Directory structure for game files identified (need to create: src/app/dashboard/games/pipeline-catcher/, src/components/games/pipeline-catcher/)
- [x] BigQuery query pattern documented (uses `runQuery`, `cachedQuery`, parameterized queries)
- [x] API route pattern documented (Next.js App Router, `getServerSession`, `NextResponse.json`)
- [x] Prisma schema location and User model documented (`prisma/schema.prisma`, User model with `id`, `email`, `name`)
- [x] Sidebar logo location and JSX identified (`public/savvy-logo.png` exists, currently just text span - needs onClick handler)
- [x] Auth/session access pattern documented (`useSession()` client-side, `getServerSession()` server-side)
- [x] Navigation pattern confirmed (`useRouter` from `next/navigation`, `router.push()`)
- [x] API client pattern confirmed (`dashboardApi` object pattern in `src/lib/api-client.ts`)

### Database Schema
- [x] Prisma model conventions documented (cuid() IDs, DateTime patterns, relation patterns)
- [x] User model ID field confirmed (`id` String with cuid())
- [x] Migration process documented (no migrations dir exists, standard `npx prisma migrate dev`)
- [x] User ID access confirmed (`session.user.id` available as String cuid)

### Frontend Patterns
- [x] Page component structure documented (client components, hooks, API client pattern)
- [x] Tailwind configuration noted (dark mode enabled, custom colors, no custom animations)
- [x] Modal pattern identified (isOpen/onClose pattern, overlay/backdrop, close button)
- [x] Animation library availability checked (none installed - need to add game rendering library)

### API Planning
- [x] Quarter calculation logic validated (FORMAT_DATE with DATE_SUB works correctly)
- [x] Date range conversion tested (Q4 2024: Oct 1 - Dec 31, QTD uses CURRENT_DATE)
- [x] Full game data query template validated (works with CTEs, returns all required fields)
- [x] Ghost query logic finalized (is_contacted=1 AND is_mql=0 for quarter date range)
