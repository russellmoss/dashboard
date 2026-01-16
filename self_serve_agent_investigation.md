# Self-Serve Analytics Agent - Codebase Investigation

## Purpose

This document contains a comprehensive set of questions for Cursor.ai to investigate the Savvy Dashboard codebase. All answers should be logged to `self_serve_agent_answers.md` in the root directory.

**IMPORTANT**: Answer each question thoroughly with code snippets, file paths, and specific implementation details. If validation against BigQuery is needed, use the MCP connection to `savvy-gtm-analytics` project.

---

## Instructions for Cursor.ai

1. Read each section and investigate the codebase thoroughly
2. For each question, provide:
   - Specific file paths
   - Relevant code snippets
   - Current patterns used
   - Any gaps or missing pieces
3. Log all answers to `self_serve_agent_answers.md` in the project root
4. Use BigQuery MCP connection when validation is needed
5. Be thorough - this investigation will inform the implementation plan

---

## SECTION 1: Project Structure & Architecture

### 1.1 Current Directory Structure

**Question**: What is the complete directory structure under `src/`? List all folders and their purposes.

**Investigation Steps**:
1. Run `tree src/ -L 3` or equivalent
2. Document each folder's purpose
3. Identify where new files should go for this feature

### 1.2 Semantic Layer Current Location

**Question**: The semantic layer files are currently in `docs/semantic_layer/`. Where should they be moved to for proper integration?

**Investigation Steps**:
1. Review the target location specified in the spec: `src/lib/semantic-layer/`
2. Check if this directory exists
3. Verify there are no conflicts with existing files
4. Document the migration path

### 1.3 Configuration Files

**Question**: What configuration files exist and what patterns do they follow?

**Investigation Steps**:
1. Examine `src/config/constants.ts` - what constants are defined?
2. Check `tsconfig.json` for path aliases (especially `@/` alias)
3. Review `next.config.js` or `next.config.mjs` for any relevant settings
4. Document any environment variables currently used

---

## SECTION 2: API Route Patterns

### 2.1 Existing API Routes

**Question**: What API routes currently exist under `src/app/api/dashboard/`?

**Investigation Steps**:
1. List all route files in `src/app/api/dashboard/`
2. For each route, document:
   - HTTP methods supported (GET, POST)
   - Request/response patterns
   - Authentication approach
   - Permission filtering approach

### 2.2 API Route Structure Pattern

**Question**: What is the standard pattern for API routes in this codebase?

**Investigation Steps**:
1. Examine `src/app/api/dashboard/funnel-metrics/route.ts` as a reference
2. Document the pattern for:
   - Session authentication
   - Permission-based filtering
   - Error handling
   - Response formatting
3. Provide a code snippet of the standard pattern

### 2.3 Dynamic Route Patterns

**Question**: Are there any existing dynamic routes (e.g., `[id]`)? What pattern do they follow?

**Investigation Steps**:
1. Search for dynamic route files like `[id]/route.ts`
2. Examine `src/app/api/users/[id]/route.ts` if it exists
3. Document the parameter extraction pattern
4. Note any validation patterns used

---

## SECTION 3: BigQuery Integration

### 3.1 BigQuery Client Setup

**Question**: How is the BigQuery client configured and used?

**Investigation Steps**:
1. Examine `src/lib/bigquery.ts`
2. Document:
   - How the client is instantiated
   - The `runQuery<T>()` function signature
   - Parameterized query patterns
   - Error handling approach

### 3.2 Query Function Patterns

**Question**: What is the standard pattern for query functions in `src/lib/queries/`?

**Investigation Steps**:
1. List all files in `src/lib/queries/`
2. Examine `src/lib/queries/funnel-metrics.ts` as a reference
3. Document:
   - Import patterns
   - Function signatures
   - Parameter handling
   - Type transformations
4. Provide a template for creating new query functions

### 3.3 Table References

**Question**: How are BigQuery table names referenced throughout the codebase?

**Investigation Steps**:
1. Check `src/config/constants.ts` for table constants
2. Verify the following tables are defined:
   - `vw_funnel_master` (main view)
   - `new_mapping` (channel mapping - should be in SavvyGTMData, NOT Tableau_Views)
   - `q4_2025_forecast` (forecast data)
   - `vw_daily_forecast` (daily forecast view)
3. Document how these are imported and used in queries

### 3.4 BigQuery Validation (MCP)

**Question**: Validate that the semantic layer table references are correct.

**Investigation Steps (Use BigQuery MCP)**:
```sql
-- Validate vw_funnel_master exists and has expected columns
SELECT column_name, data_type 
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
LIMIT 20;

-- Validate new_mapping table location (should be SavvyGTMData, not Tableau_Views)
SELECT table_schema, table_name 
FROM `savvy-gtm-analytics.INFORMATION_SCHEMA.TABLES`
WHERE table_name = 'new_mapping';

-- Validate key columns exist
SELECT 
  COUNT(*) as total_records,
  COUNT(DISTINCT SGA_Owner_Name__c) as distinct_sgas,
  COUNT(DISTINCT Original_source) as distinct_sources
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate >= '2025-01-01';
```

---

## SECTION 4: Authentication & Permissions

### 4.1 Session Management

**Question**: How is user session management implemented?

**Investigation Steps**:
1. Examine `src/lib/auth.ts`
2. Document:
   - NextAuth configuration
   - Session structure
   - How permissions are attached to session
3. Show how to get the current session in an API route

### 4.2 Permission System

**Question**: How does the permission system work?

**Investigation Steps**:
1. Examine `src/lib/permissions.ts`
2. Document:
   - `UserPermissions` interface
   - Role definitions (admin, manager, sgm, sga, viewer)
   - `getUserPermissions()` function
   - How SGA/SGM filters are applied
3. Document which roles should have access to the self-serve analytics feature

### 4.3 RBAC Filter Application

**Question**: How are RBAC filters applied to BigQuery queries?

**Investigation Steps**:
1. Search for usage of `sgaFilter` and `sgmFilter` in API routes
2. Document the pattern for:
   - Lead-level metrics (using `SGA_Owner_Name__c`)
   - Opportunity-level metrics (using both `SGA_Owner_Name__c` and `Opp_SGA_Name__c`)
3. Provide code examples of filter application

---

## SECTION 5: Type System

### 5.1 Dashboard Types

**Question**: What types are defined in `src/types/dashboard.ts`?

**Investigation Steps**:
1. List all interfaces/types in `src/types/dashboard.ts`
2. Document key types that will be relevant:
   - `FunnelMetrics`
   - `ConversionRates`
   - `DetailRecord`
   - `TrendDataPoint`
3. Identify any types that need to be extended for the agent

### 5.2 Filter Types

**Question**: What filter types exist in `src/types/filters.ts`?

**Investigation Steps**:
1. Examine `src/types/filters.ts`
2. Document:
   - `DashboardFilters` interface
   - `FilterOptions` interface
   - Date range handling
3. Identify what new types might be needed for agent parameters

### 5.3 BigQuery Raw Types

**Question**: What helper types exist for BigQuery transformations?

**Investigation Steps**:
1. Examine `src/types/bigquery-raw.ts`
2. Document:
   - `toString()` helper
   - `toNumber()` helper
   - `extractDateValue()` if it exists
3. Document patterns for handling BigQuery's return types

---

## SECTION 6: Component Patterns

### 6.1 Dashboard Components

**Question**: What dashboard components exist and what patterns do they follow?

**Investigation Steps**:
1. List all files in `src/components/dashboard/`
2. For key components, document:
   - Props interface
   - State management approach
   - Data fetching pattern (if any)
   - Export/download functionality

### 6.2 Modal Patterns

**Question**: How are modals implemented in this codebase?

**Investigation Steps**:
1. Examine `src/components/settings/UserModal.tsx` or similar
2. Document:
   - Modal structure (overlay, content, close handling)
   - State management (isOpen, loading)
   - Animation/transition approach (if any)
   - ESC key and backdrop click handling

### 6.3 Drawer/Slide-out Patterns

**Question**: Are there any existing drawer or slide-out components?

**Investigation Steps**:
1. Search for "drawer", "slide", "panel" in components
2. If none exist, document the pattern from modals that could be adapted
3. Note any libraries available for drawers (e.g., Headless UI)

### 6.4 Chart Components

**Question**: What chart components are used and how?

**Investigation Steps**:
1. Examine chart components like `ConversionTrendChart.tsx`, `VolumeTrendChart.tsx`
2. Document:
   - Libraries used (Tremor, Recharts)
   - Data format expected
   - Customization patterns
   - Theme/dark mode handling

### 6.5 Table Components

**Question**: How are tables implemented?

**Investigation Steps**:
1. Examine `DetailRecordsTable.tsx`, `ChannelPerformanceTable.tsx`
2. Document:
   - Tremor Table component usage
   - Sorting implementation
   - Pagination approach
   - Row click handling
   - Export functionality

---

## SECTION 7: API Client & Data Fetching

### 7.1 API Client Structure

**Question**: How is the API client structured?

**Investigation Steps**:
1. Examine `src/lib/api-client.ts`
2. Document:
   - `apiFetch()` function pattern
   - `dashboardApi` object methods
   - Error handling (`ApiError` class)
   - How methods are called from components

### 7.2 Dashboard Page Data Fetching

**Question**: How does the main dashboard page fetch data?

**Investigation Steps**:
1. Examine `src/app/dashboard/page.tsx`
2. Document:
   - State variables used
   - `useEffect` hooks for data fetching
   - Loading state management
   - Error state handling
   - Filter change handling

---

## SECTION 8: Export & Download Patterns

### 8.1 CSV Export

**Question**: How is CSV export implemented?

**Investigation Steps**:
1. Search for CSV export functionality
2. Examine `src/lib/utils/` for export helpers
3. Document:
   - Function used for CSV generation
   - Download trigger mechanism
   - File naming convention

### 8.2 Other Export Types

**Question**: What other export types are supported?

**Investigation Steps**:
1. Check for PNG/image export (html-to-image library?)
2. Check for SQL file export
3. Document any existing patterns
4. Identify what libraries might be needed

---

## SECTION 9: Styling & Theme

### 9.1 Tailwind Configuration

**Question**: How is Tailwind CSS configured?

**Investigation Steps**:
1. Examine `tailwind.config.js` or `tailwind.config.ts`
2. Document:
   - Custom colors defined
   - Custom spacing/sizing
   - Plugin usage
   - Dark mode configuration

### 9.2 Theme System

**Question**: How is theming handled (especially dark mode)?

**Investigation Steps**:
1. Search for `next-themes` or similar
2. Examine `src/config/theme.ts` if it exists
3. Document:
   - Chart colors (`CHART_COLORS`)
   - Dark mode class patterns
   - Theme switching mechanism

---

## SECTION 10: Existing Chat/AI Patterns

### 10.1 Claude/AI Integration

**Question**: Are there any existing AI/Claude integrations in the codebase?

**Investigation Steps**:
1. Search for "anthropic", "claude", "ai", "openai" in the codebase
2. Check for any API routes related to AI
3. Document any existing patterns or identify that this is a new capability

### 10.2 Streaming Patterns

**Question**: Are there any existing streaming response patterns?

**Investigation Steps**:
1. Search for "stream", "ReadableStream", "TextEncoder"
2. Check if any API routes use streaming
3. Document patterns if found, or note this needs to be implemented fresh

---

## SECTION 11: Semantic Layer Specific Questions

### 11.1 Metric SQL Validation

**Question**: Validate that the SQL in the semantic layer definitions matches actual BigQuery field names.

**Investigation Steps (Use BigQuery MCP)**:
```sql
-- Validate key metric fields exist
SELECT 
  CASE WHEN COUNT(FilterDate) > 0 THEN 'EXISTS' ELSE 'MISSING' END as FilterDate,
  CASE WHEN COUNT(stage_entered_contacting__c) > 0 THEN 'EXISTS' ELSE 'MISSING' END as stage_entered_contacting,
  CASE WHEN COUNT(mql_stage_entered_ts) > 0 THEN 'EXISTS' ELSE 'MISSING' END as mql_stage_entered_ts,
  CASE WHEN COUNT(converted_date_raw) > 0 THEN 'EXISTS' ELSE 'MISSING' END as converted_date_raw,
  CASE WHEN COUNT(Date_Became_SQO__c) > 0 THEN 'EXISTS' ELSE 'MISSING' END as Date_Became_SQO__c,
  CASE WHEN COUNT(advisor_join_date__c) > 0 THEN 'EXISTS' ELSE 'MISSING' END as advisor_join_date__c,
  CASE WHEN COUNT(is_sqo_unique) > 0 THEN 'EXISTS' ELSE 'MISSING' END as is_sqo_unique,
  CASE WHEN COUNT(is_joined_unique) > 0 THEN 'EXISTS' ELSE 'MISSING' END as is_joined_unique
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate >= '2025-01-01';

-- Validate conversion progression flags exist
SELECT 
  CASE WHEN COUNT(sql_to_sqo_progression) > 0 THEN 'EXISTS' ELSE 'MISSING' END as sql_to_sqo_progression,
  CASE WHEN COUNT(eligible_for_sql_conversions) > 0 THEN 'EXISTS' ELSE 'MISSING' END as eligible_for_sql_conversions,
  CASE WHEN COUNT(mql_to_sql_progression) > 0 THEN 'EXISTS' ELSE 'MISSING' END as mql_to_sql_progression,
  CASE WHEN COUNT(eligible_for_mql_conversions) > 0 THEN 'EXISTS' ELSE 'MISSING' END as eligible_for_mql_conversions
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate >= '2025-01-01';
```

### 11.2 Dimension Field Validation

**Question**: Validate dimension fields and channel JOIN pattern.

**Investigation Steps (Use BigQuery MCP)**:
```sql
-- Validate channel JOIN works correctly
SELECT 
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm 
  ON v.Original_source = nm.original_source
WHERE v.FilterDate >= '2025-01-01'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;

-- Validate experimentation tag UNNEST pattern
SELECT DISTINCT Experimentation_Tag_Raw__c
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Experimentation_Tag_Raw__c IS NOT NULL
LIMIT 10;
```

### 11.3 Record Type Validation

**Question**: Validate the Recruiting record type ID.

**Investigation Steps (Use BigQuery MCP)**:
```sql
-- Validate Recruiting record type ID
SELECT DISTINCT recordtypeid, record_type_name, COUNT(*) as cnt
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE record_type_name = 'Recruiting'
GROUP BY 1, 2;

-- Expected: recordtypeid = '012Dn000000mrO3IAI'
```

---

## SECTION 12: Implementation Readiness

### 12.1 Dependencies Check

**Question**: What additional dependencies might be needed?

**Investigation Steps**:
1. Examine `package.json`
2. Check if these are already installed:
   - `@anthropic-ai/sdk` (or equivalent for Claude API)
   - `html-to-image` (for PNG export)
   - `jszip` (for ZIP export)
3. Document what needs to be installed

### 12.2 Environment Variables

**Question**: What environment variables are currently used and what new ones will be needed?

**Investigation Steps**:
1. Check `.env.example` or documentation for current env vars
2. Document:
   - BigQuery credentials
   - NextAuth secrets
   - Any API keys
3. Note that `ANTHROPIC_API_KEY` will be needed

### 12.3 Deployment Configuration

**Question**: How is the project configured for Vercel deployment?

**Investigation Steps**:
1. Check `vercel.json` if it exists
2. Review any build configuration
3. Document any considerations for the new feature (e.g., API route timeouts)

---

## SECTION 13: UI/UX Context

### 13.1 Current Page Layout

**Question**: What is the current layout structure of the dashboard?

**Investigation Steps**:
1. Examine `src/app/dashboard/layout.tsx`
2. Document:
   - Header component and structure
   - Sidebar (if any)
   - Main content area
   - Footer (if any)
3. Identify where the "Explore" entry point should be added

### 13.2 Navigation Structure

**Question**: How is navigation structured?

**Investigation Steps**:
1. Examine `src/components/layout/Header.tsx`
2. Examine `src/components/layout/Navigation.tsx` if it exists
3. Document where to add "Explore" or "Ask AI" navigation item

### 13.3 Responsive Design Patterns

**Question**: How is responsive design handled?

**Investigation Steps**:
1. Search for responsive breakpoints in components
2. Document mobile vs desktop patterns
3. Identify considerations for the explore drawer/panel

---

## Summary Checklist

After completing this investigation, ensure you have documented:

- [ ] Complete project structure with file purposes
- [ ] API route patterns with code examples
- [ ] BigQuery integration patterns with query templates
- [ ] Authentication and permission patterns
- [ ] Type definitions needed for the agent
- [ ] Component patterns for UI elements
- [ ] Export functionality patterns
- [ ] Theme and styling patterns
- [ ] Validation results from BigQuery MCP queries
- [ ] Dependencies needed
- [ ] Environment variables needed
- [ ] Navigation/layout integration points

---

## Output Format

Create `self_serve_agent_answers.md` with the following structure:

```markdown
# Self-Serve Analytics Agent - Codebase Investigation Answers

**Investigation Date**: [DATE]
**Investigated By**: Cursor.ai

---

## Section 1: Project Structure & Architecture

### 1.1 Current Directory Structure
[Answer with tree output and descriptions]

### 1.2 Semantic Layer Target Location
[Answer]

[Continue for all sections...]

---

## BigQuery Validation Results

### Metric Field Validation
[Query results]

### Dimension Field Validation
[Query results]

[Continue for all validations...]

---

## Implementation Readiness Summary

### Dependencies Needed
- [ ] Dependency 1
- [ ] Dependency 2

### Environment Variables Needed
- [ ] ANTHROPIC_API_KEY
- [ ] Any others

### Key Integration Points
1. Point 1
2. Point 2

### Potential Challenges Identified
1. Challenge 1
2. Challenge 2
```

---

**END OF INVESTIGATION DOCUMENT**
