# Self-Serve Analytics - Implementation Validation Questionnaire

**Purpose:** Work through these questions step-by-step to validate and refine the implementation plan  
**Instructions for Cursor.ai:**
1. Work through each section in order
2. After completing each section, log any changes needed in `SELF-SERVE-PLAN-CHANGES.md`
3. Make those alterations directly to `SAVVY-SELF-SERVE-ANALYTICS-IMPLEMENTATION.md`
4. Check off the section as complete before moving to the next

**Files to update:**
- `C:\Users\russe\Documents\Dashboard\SELF-SERVE-PLAN-CHANGES.md` (append changes)
- `C:\Users\russe\Documents\Dashboard\SAVVY-SELF-SERVE-ANALYTICS-IMPLEMENTATION.md` (make alterations)

---

## Section 1: Sidebar Navigation Structure

### Questions to Answer:

1. **Examine `src/components/layout/Sidebar.tsx`:**
   - What is the exact structure of the `PAGES` array?
   - What properties does each page object have (id, label, icon, href, etc.)?
   - How are icons imported and used?
   - Is there any conditional logic for showing/hiding pages based on permissions?

2. **Document the exact code needed:**
   - What is the complete page object that needs to be added for the Explore feature?
   - What import statement is needed for the icon?
   - Where exactly in the PAGES array should page 10 be inserted?

3. **Check for permission-based rendering:**
   - Does Sidebar.tsx use `allowedPages` from UserPermissions to filter visible pages?
   - If yes, how is this filtering done?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Exact PAGES array structure
- [ ] Complete page object code
- [ ] Exact insertion point
- [ ] Any permission-based rendering logic

---

## Section 2: Existing API Route Patterns Deep Dive

### Questions to Answer:

1. **Examine `src/app/api/dashboard/funnel-metrics/route.ts`:**
   - What is the complete import list at the top of the file?
   - How exactly is `getServerSession(authOptions)` used?
   - How exactly is `getUserPermissions()` called?
   - What is the exact error response format for 401 errors?
   - What is the exact error response format for 500 errors?
   - How is `logger` used (what methods, what parameters)?

2. **Examine `src/app/api/dashboard/conversion-rates/route.ts`:**
   - Are there any differences in pattern from funnel-metrics?
   - How are request body parameters validated?
   - How are BigQuery query results transformed before returning?

3. **Examine `src/lib/bigquery.ts`:**
   - What is the exact signature of `runQuery<T>()`?
   - Does it accept parameters? If so, how are they passed?
   - Are there any timeout configurations?
   - Are there any error handling patterns built in?

4. **Check for any streaming patterns:**
   - Are there ANY existing SSE (Server-Sent Events) implementations in the codebase?
   - If not, what is the recommended Next.js App Router pattern for streaming?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Exact import list for API routes
- [ ] Exact authentication pattern
- [ ] Exact error response formats
- [ ] Exact runQuery signature and usage
- [ ] Streaming pattern (existing or new)

---

## Section 3: Permissions System Verification

### Questions to Answer:

1. **Examine `src/lib/permissions.ts`:**
   - What is the complete `UserPermissions` interface?
   - What is the complete `ROLE_PERMISSIONS` object (all roles)?
   - What does `getUserPermissions(email: string)` return exactly?
   - How are `sgaFilter` and `sgmFilter` populated?

2. **Verify page access control:**
   - How does the existing code check if a user has access to a page?
   - Is there a function like `hasPageAccess(pageId, userPermissions)`?
   - Where is this check performed (middleware, page component, API route)?

3. **Document the exact changes needed:**
   - For each role in ROLE_PERMISSIONS, show the before and after for adding page 10
   - Should viewers (canExport: false) have access to Explore?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Complete UserPermissions interface
- [ ] Complete ROLE_PERMISSIONS object with page 10 added
- [ ] Page access control pattern
- [ ] Viewer access decision

---

## Section 4: BigQuery Query Patterns

### Questions to Answer:

1. **Examine existing queries in `src/lib/queries/funnel-metrics.ts`:**
   - How are parameterized queries structured?
   - How is the channel JOIN written (exact SQL)?
   - How are date filters applied (TIMESTAMP() wrapper or direct comparison)?
   - How are SGA/SGM filters applied in existing queries?

2. **Examine `src/lib/queries/conversion-rates.ts`:**
   - How are cohort mode conversion rates calculated?
   - What is the exact SQL pattern for sql_to_sqo_rate?
   - How are progression/eligibility flags used?

3. **Verify DATE vs TIMESTAMP handling:**
   - For each date field in vw_funnel_master, document the correct comparison pattern
   - FilterDate: DATE or TIMESTAMP comparison?
   - Date_Became_SQO__c: DATE or TIMESTAMP comparison?
   - converted_date_raw: DATE or TIMESTAMP comparison?
   - mql_stage_entered_ts: DATE or TIMESTAMP comparison?

4. **Examine record type filtering:**
   - How is RECRUITING_RECORD_TYPE used in existing queries?
   - How is the parameter passed to BigQuery?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Exact parameterized query pattern
- [ ] Exact channel JOIN SQL
- [ ] DATE vs TIMESTAMP handling for each field
- [ ] Cohort mode SQL pattern
- [ ] Record type filtering pattern

---

## Section 5: API Client Structure

### Questions to Answer:

1. **Examine `src/lib/api-client.ts`:**
   - What is the structure of `dashboardApi` object?
   - How are API methods defined (signature pattern)?
   - How is authentication handled in requests?
   - How are errors handled?
   - What is the `apiFetch()` helper function signature?

2. **Document existing method pattern:**
   - Pick one method (e.g., `getFunnelMetrics`) and show its complete implementation
   - How are request bodies structured?
   - How are response bodies typed?

3. **Plan the agent API addition:**
   - What should `agentApi.query()` look like?
   - What should `agentApi.queryStream()` look like for SSE?
   - Where in the file should these be added?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Complete dashboardApi structure
- [ ] Exact method pattern to follow
- [ ] Complete agentApi object definition
- [ ] SSE handling in client (if any special handling needed)

---

## Section 6: Chart Component Patterns

### Questions to Answer:

1. **Find existing Recharts usage:**
   - Which files use Recharts for bar charts?
   - Which files use Recharts for line charts?
   - What is the import pattern?

2. **Examine chart configuration:**
   - How are chart colors configured?
   - How are tooltips customized?
   - How are axes formatted (especially for currency and percentages)?
   - How is responsive behavior handled?

3. **Document a complete chart example:**
   - Find a bar chart implementation and document:
     - Complete imports
     - Complete component structure
     - Data format expected
     - Dark mode handling

4. **Find metric card examples:**
   - How are single metric values displayed?
   - What component is used for scorecards?
   - How are large numbers formatted?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Recharts import pattern
- [ ] Bar chart complete example
- [ ] Line chart complete example
- [ ] Metric/scorecard component pattern
- [ ] Dark mode handling for charts

---

## Section 7: Export Functionality

### Questions to Answer:

1. **Examine `src/lib/utils/export-csv.ts`:**
   - What is the complete `exportToCSV()` function?
   - How does it handle different data types?
   - How does it escape special characters?

2. **Check for any existing download patterns:**
   - Are there any file download utilities elsewhere in the codebase?
   - How are blobs created and downloaded?

3. **Plan new export functions:**
   - What pattern should `exportToSQL()` follow?
   - For PNG export with `html-to-image`, any existing image handling patterns to follow?
   - For ZIP export with `jszip`, any existing archive patterns?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Complete exportToCSV function
- [ ] Download utility pattern
- [ ] exportToSQL implementation
- [ ] exportToPNG implementation
- [ ] exportToZIP implementation

---

## Section 8: Component State Management Patterns

### Questions to Answer:

1. **Examine `src/app/dashboard/page.tsx`:**
   - How is state managed (useState, useReducer, context)?
   - How is data fetched (useEffect, React Query, SWR)?
   - How are loading states handled?
   - How are error states handled?

2. **Examine component composition:**
   - How are child components passed data?
   - How are callbacks passed for user interactions?
   - What is the pattern for conditionally rendering based on data availability?

3. **Check for any existing conversation/chat patterns:**
   - Are there any components that maintain message history?
   - How is session-only state handled (if any examples)?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] State management pattern
- [ ] Data fetching pattern
- [ ] Loading/error state patterns
- [ ] Component composition pattern

---

## Section 9: Form and Input Patterns

### Questions to Answer:

1. **Find existing text input components:**
   - What input components exist in `src/components/ui/`?
   - How are inputs styled (Tailwind classes)?
   - How is dark mode handled for inputs?

2. **Find existing button patterns:**
   - What button components exist?
   - How are loading states shown on buttons?
   - How are disabled states styled?

3. **Check for any command/search patterns:**
   - Are there any existing search inputs?
   - Any autocomplete or suggestion components?
   - Any keyboard shortcut handling (e.g., Enter to submit)?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Input component pattern
- [ ] Button component pattern
- [ ] Search/command input pattern (if exists)
- [ ] Keyboard handling pattern

---

## Section 10: Error Handling and Feedback

### Questions to Answer:

1. **Examine `src/lib/logger.ts`:**
   - What is the complete logger interface?
   - How is `logger.error()` used (parameters)?
   - How is `logger.info()` used?
   - Is there a `logger.warn()`?

2. **Find error display patterns:**
   - How are errors shown to users in the UI?
   - Are there any toast/notification components?
   - How are inline error messages displayed?

3. **Check validation patterns:**
   - How is client-side validation performed?
   - How are validation errors displayed?
   - Any existing patterns for character limits on inputs?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Complete logger usage pattern
- [ ] Error display UI pattern
- [ ] Validation pattern

---

## Section 11: Semantic Layer Integration

### Questions to Answer:

1. **Examine `src/lib/semantic-layer/index.ts`:**
   - What exactly is exported?
   - How should other files import from the semantic layer?

2. **Verify all exports from `definitions.ts`:**
   - List all exported constants (VOLUME_METRICS, AUM_METRICS, etc.)
   - List the complete SEMANTIC_LAYER object structure
   - Verify SGA_FILTER_PATTERNS structure

3. **Verify all exports from `query-templates.ts`:**
   - List all exported constants
   - What is the complete QUERY_TEMPLATES structure?
   - What is BASE_QUERY?

4. **Check TypeScript compatibility:**
   - Can you import and use `QUERY_TEMPLATES['single_metric']` without errors?
   - Are the template IDs typed correctly?
   - How should parameter validation reference these constants?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Complete import patterns for semantic layer
- [ ] SEMANTIC_LAYER object structure
- [ ] QUERY_TEMPLATES structure
- [ ] Type-safe access patterns

---

## Section 12: MCP BigQuery Validation Queries

### Questions to Answer:

Use your MCP connection to BigQuery to run these validation queries:

1. **Test SQO count query (single_metric template pattern):**
```sql
SELECT 
  COUNT(DISTINCT CASE 
    WHEN Date_Became_SQO__c IS NOT NULL
      AND DATE(Date_Became_SQO__c) >= DATE_TRUNC(CURRENT_DATE(), QUARTER)
      AND DATE(Date_Became_SQO__c) <= CURRENT_DATE()
      AND is_sqo_unique = 1
      AND recordtypeid = '012Dn000000mrO3IAI'
    THEN sfdc_lead_id
  END) as sqos
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
```
- Does this query execute successfully?
- What is the SQO count returned?

2. **Test SQOs by channel query (metric_by_dimension template pattern):**
```sql
SELECT 
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  COUNT(DISTINCT CASE 
    WHEN v.Date_Became_SQO__c IS NOT NULL
      AND DATE(v.Date_Became_SQO__c) >= DATE_TRUNC(CURRENT_DATE(), QUARTER)
      AND DATE(v.Date_Became_SQO__c) <= CURRENT_DATE()
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = '012Dn000000mrO3IAI'
    THEN v.sfdc_lead_id
  END) as sqos
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm 
  ON v.Original_source = nm.original_source
GROUP BY 1
HAVING sqos > 0
ORDER BY sqos DESC
```
- Does this query execute successfully?
- How many channels are returned?
- What are the top 3 channels and their SQO counts?

3. **Test conversion rate query (conversion_by_dimension template pattern):**
```sql
SELECT 
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.converted_date_raw IS NOT NULL 
        AND DATE(v.converted_date_raw) >= DATE_TRUNC(CURRENT_DATE(), QUARTER)
        THEN v.sql_to_sqo_progression ELSE 0 END),
    SUM(CASE WHEN v.converted_date_raw IS NOT NULL 
        AND DATE(v.converted_date_raw) >= DATE_TRUNC(CURRENT_DATE(), QUARTER)
        THEN v.eligible_for_sql_conversions ELSE 0 END)
  ) as sql_to_sqo_rate,
  SUM(CASE WHEN v.converted_date_raw IS NOT NULL 
      AND DATE(v.converted_date_raw) >= DATE_TRUNC(CURRENT_DATE(), QUARTER)
      THEN v.sql_to_sqo_progression ELSE 0 END) as numerator,
  SUM(CASE WHEN v.converted_date_raw IS NOT NULL 
      AND DATE(v.converted_date_raw) >= DATE_TRUNC(CURRENT_DATE(), QUARTER)
      THEN v.eligible_for_sql_conversions ELSE 0 END) as denominator
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm 
  ON v.Original_source = nm.original_source
GROUP BY 1
HAVING denominator > 0
ORDER BY sql_to_sqo_rate DESC
```
- Does this query execute successfully?
- What are the conversion rates for top channels?
- Are numerator and denominator values reasonable?

4. **Test SGA filter pattern (for RBAC):**
```sql
SELECT 
  v.SGA_Owner_Name__c as sga,
  COUNT(DISTINCT CASE 
    WHEN v.Date_Became_SQO__c IS NOT NULL
      AND DATE(v.Date_Became_SQO__c) >= DATE_TRUNC(CURRENT_DATE(), QUARTER)
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = '012Dn000000mrO3IAI'
      AND (v.SGA_Owner_Name__c = 'Chris Morgan' OR v.Opp_SGA_Name__c = 'Chris Morgan')
    THEN v.sfdc_lead_id
  END) as sqos
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.SGA_Owner_Name__c = 'Chris Morgan' OR v.Opp_SGA_Name__c = 'Chris Morgan'
GROUP BY 1
```
- Does this query execute successfully?
- Does it return data for the specific SGA?
- (Note: Replace 'Chris Morgan' with an actual SGA name from your data)

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Verified single_metric SQL pattern
- [ ] Verified metric_by_dimension SQL pattern
- [ ] Verified conversion_by_dimension SQL pattern
- [ ] Verified SGA filter pattern for RBAC
- [ ] Any corrections to SQL patterns based on execution results

---

## Section 13: Vercel Configuration

### Questions to Answer:

1. **Examine `vercel.json`:**
   - Does it exist?
   - What is its current content?
   - Are there any function timeout configurations?

2. **Check for Next.js route configuration:**
   - Is there any `route.ts` configuration in the codebase?
   - How are API route timeouts typically configured?

3. **Document timeout requirements:**
   - The agent route may need 60s timeout (Claude API + BigQuery)
   - What is the correct configuration for this?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Current vercel.json content
- [ ] Required changes for agent route timeout

---

## Section 14: Dark Mode Implementation

### Questions to Answer:

1. **Examine `src/components/providers/ThemeProvider.tsx` (or similar):**
   - How is dark mode implemented?
   - How do components access the current theme?
   - What is the Tailwind dark mode strategy (`class` vs `media`)?

2. **Find dark mode patterns in existing components:**
   - How are background colors handled (`bg-white dark:bg-gray-800`)?
   - How are text colors handled?
   - How are borders handled?
   - How are hover states handled?

3. **Check chart dark mode:**
   - How do existing charts handle dark mode?
   - Are chart colors adjusted for dark mode?
   - How is the chart background handled?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Dark mode implementation pattern
- [ ] Component dark mode classes
- [ ] Chart dark mode handling

---

## Section 15: Existing Tests and Validation

### Questions to Answer:

1. **Check `src/lib/semantic-layer/__tests__/`:**
   - What test files exist?
   - What testing framework is used (Jest, Vitest)?
   - What is the test file naming convention?

2. **Examine existing test patterns:**
   - How are unit tests structured?
   - How are mocks handled?
   - How are BigQuery queries tested (mocked or integration)?

3. **Check for any E2E tests:**
   - Is Playwright or Cypress configured?
   - Are there any existing E2E tests for dashboard features?

### After answering, log changes needed in SELF-SERVE-PLAN-CHANGES.md and update the implementation guide with:
- [ ] Test framework and location
- [ ] Unit test pattern
- [ ] E2E test pattern (if applicable)
- [ ] Recommended tests for agent feature

---

## Final Summary

After completing all sections above:

1. **Create a summary in SELF-SERVE-PLAN-CHANGES.md** with:
   - Total number of changes identified
   - Critical changes (blocking implementation)
   - Minor changes (improvements)
   - Questions that remain unanswered

2. **Verify the implementation guide is complete** by checking:
   - [ ] All file paths are correct and verified
   - [ ] All import statements are complete and correct
   - [ ] All code examples compile without errors
   - [ ] All BigQuery queries have been validated via MCP
   - [ ] All component patterns match existing codebase
   - [ ] All API patterns match existing codebase
   - [ ] All type definitions are complete and correct
   - [ ] Dark mode is fully addressed
   - [ ] Export functionality is fully specified
   - [ ] Error handling is fully specified
   - [ ] RBAC is fully specified

3. **Flag any remaining uncertainties** that need human decision-making

---

## Appendix: Change Log Template

When logging changes in `SELF-SERVE-PLAN-CHANGES.md`, use this format:

```markdown
### Change [NUMBER]: [SHORT TITLE]

**Section:** [Which section of the questionnaire]

**Issue:** [What was wrong or missing]

**Finding:** [What you discovered from the codebase]

**Change Made:** [What was updated in the implementation guide]

**Location in Implementation Guide:** [Phase X, Step X.X, Line XXX]
```

---

**END OF QUESTIONNAIRE**
