# Pipeline Catcher: Pre-Implementation Discovery Questions

> **Purpose**: This document contains phased questions that Cursor.ai must answer before we can create a detailed implementation plan for the Pipeline Catcher easter egg game.
> 
> **Instructions for Cursor**: 
> 1. Work through each phase sequentially
> 2. Record ALL answers in a new file called `game-answers.md` at the project root
> 3. Use your MCP connection to BigQuery to run queries and inspect data
> 4. Use your codebase access to examine existing files and patterns
> 5. Do NOT proceed to the next phase until the current phase is complete
> 6. If you encounter issues or uncertainties, document them in the answers file

---

## Phase 1: Data Availability & Structure

### 1.1 SQO Data Validation
Run this query and record the results:
```sql
SELECT 
  FORMAT_DATE('%Y-Q%Q', Date_Became_SQO__c) as quarter,
  COUNT(*) as sqo_count,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum,
  AVG(COALESCE(Underwritten_AUM__c, Amount, 0)) as avg_aum,
  MIN(COALESCE(Underwritten_AUM__c, Amount, 0)) as min_aum,
  MAX(COALESCE(Underwritten_AUM__c, Amount, 0)) as max_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c >= '2024-01-01'
GROUP BY quarter
ORDER BY quarter
```

**Questions to answer:**
- How many SQOs per quarter do we have from Q1 2024 to present?
- What's the AUM range we're working with?
- Are there any quarters with surprisingly low counts we should be aware of?

---

### 1.2 Do Not Call (Stop Signs 🛑) Data
Run this query and record the results:
```sql
SELECT 
  FORMAT_DATE('%Y-Q%Q', FilterDate) as quarter,
  COUNT(*) as dnc_count,
  COUNT(DISTINCT advisor_name) as unique_names,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DoNotCall = TRUE
  AND FilterDate >= '2024-01-01'
GROUP BY quarter
ORDER BY quarter
```

**Questions to answer:**
- How many Do Not Call records exist per quarter?
- Is there enough data to make the game interesting (ideally 5-20 per quarter)?
- Do these records have AUM values, or are they mostly NULL?

---

### 1.3 No Response (Ghosts 👻) Data
Run this query and record the results:
```sql
SELECT 
  FORMAT_DATE('%Y-Q%Q', FilterDate) as quarter,
  Disposition__c,
  COUNT(*) as count,
  COUNT(DISTINCT advisor_name) as unique_names,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Disposition__c IS NOT NULL
  AND FilterDate >= '2024-01-01'
GROUP BY quarter, Disposition__c
ORDER BY quarter, count DESC
```

**Questions to answer:**
- What are all the distinct `Disposition__c` values?
- Which value(s) represent "No Response"? (exact casing/spelling)
- How many No Response records per quarter?

---

### 1.4 Joined Advisors (Stars ⭐) Data
Run this query and record the results:
```sql
SELECT 
  FORMAT_DATE('%Y-Q%Q', advisor_join_date__c) as quarter,
  COUNT(*) as joined_count,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum,
  AVG(COALESCE(Underwritten_AUM__c, Amount, 0)) as avg_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_joined_unique = 1
  AND advisor_join_date__c >= '2024-01-01'
GROUP BY quarter
ORDER BY quarter
```

**Questions to answer:**
- How many Joined advisors per quarter?
- These should be rare and valuable - are the counts low enough (1-5 per quarter)?
- What's their typical AUM compared to SQOs?

---

### 1.5 Sample Game Data Query
Run this query to see what a full game dataset would look like for one quarter:
```sql
-- Sample: Q4 2024 game data
WITH quarter_dates AS (
  SELECT DATE('2024-10-01') as start_date, DATE('2024-12-31') as end_date
)

SELECT 
  'sqo' as object_type,
  advisor_name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  StageName as stage,
  NULL as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`, quarter_dates
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c >= start_date AND Date_Became_SQO__c <= end_date

UNION ALL

SELECT 
  'stop_sign' as object_type,
  advisor_name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  NULL as stage,
  'Do Not Call' as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`, quarter_dates
WHERE DoNotCall = TRUE
  AND FilterDate >= start_date AND FilterDate <= end_date
LIMIT 15

UNION ALL

SELECT 
  'ghost' as object_type,
  advisor_name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  NULL as stage,
  'No Response' as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`, quarter_dates
WHERE LOWER(Disposition__c) LIKE '%no response%'
  AND FilterDate >= start_date AND FilterDate <= end_date
LIMIT 15

UNION ALL

SELECT 
  'joined' as object_type,
  advisor_name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  'Joined' as stage,
  NULL as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`, quarter_dates
WHERE is_joined_unique = 1
  AND advisor_join_date__c >= start_date AND advisor_join_date__c <= end_date

ORDER BY object_type, aum DESC
```

**Questions to answer:**
- Does this query return a good mix of game objects?
- Are there any NULL advisor_name values we need to handle?
- Do the AUM values look reasonable?

---

## Phase 2: Codebase Structure & Patterns

### 2.1 Project Structure
Run these commands and record the output:
```bash
# Show the main directory structure
ls -la src/

# Show app directory structure
ls -la src/app/

# Show components directory structure  
ls -la src/components/

# Show lib directory structure
ls -la src/lib/
```

**Questions to answer:**
- Where should the game page live? (likely `src/app/dashboard/games/pipeline-catcher/`)
- Where should game components live? (likely `src/components/games/`)
- Where should game-related queries live? (likely `src/lib/queries/`)

---

### 2.2 Existing BigQuery Query Patterns
Find and examine an existing BigQuery query file:
```bash
# Find query files
find src -name "*.ts" | xargs grep -l "runQuery\|getBigQueryClient" | head -5

# Show one example query file
cat src/lib/queries/open-pipeline.ts
```

**Questions to answer:**
- What's the standard pattern for BigQuery queries in this project?
- How are query parameters passed?
- How is caching handled?
- What's the import path for `runQuery` or similar functions?

---

### 2.3 Existing API Route Patterns
Find and examine an existing API route:
```bash
# Show an example dashboard API route
cat src/app/api/dashboard/open-pipeline/route.ts
```

**Questions to answer:**
- How are API routes structured?
- How is authentication checked?
- How are responses formatted?
- What error handling pattern is used?

---

### 2.4 Prisma Schema Location
Find and examine the Prisma schema:
```bash
# Find prisma schema
find . -name "schema.prisma" | head -1

# Show current schema
cat prisma/schema.prisma
```

**Questions to answer:**
- What's the path to the Prisma schema?
- What existing models are there?
- What's the naming convention for models?
- Is there an existing User model we can reference for the leaderboard?

---

### 2.5 Sidebar/Navigation Component
Find the sidebar component with the Savvy logo:
```bash
# Find sidebar component
find src -name "*[Ss]idebar*" -o -name "*[Nn]av*" | grep -E "\.tsx$"

# Show the sidebar component
cat src/components/layout/Sidebar.tsx
```

**Questions to answer:**
- Where is the Savvy logo rendered?
- What component/element is the logo?
- Is it clickable currently?
- What's the exact JSX for the logo so we can add a triple-click handler?

---

### 2.6 Authentication & Session
Find how sessions work:
```bash
# Find auth configuration
cat src/lib/auth.ts

# Find how session is accessed in components
grep -r "useSession\|getServerSession" src/app --include="*.tsx" | head -5
```

**Questions to answer:**
- How do we get the current user's ID for the leaderboard?
- How do we get the current user's name for display?
- Is there a standard hook or function used across the app?

---

## Phase 3: Neon Database & Leaderboard Schema

### 3.1 Existing Prisma Models
Look at the full Prisma schema to understand the patterns:
```bash
cat prisma/schema.prisma
```

**Questions to answer:**
- What's the ID strategy? (cuid, uuid, autoincrement?)
- How are relationships defined?
- Are there any similar "score" or "activity" tables we can reference?
- What's the DateTime handling pattern?

---

### 3.2 User Model Structure
Extract just the User model:
```bash
grep -A 30 "model User" prisma/schema.prisma
```

**Questions to answer:**
- What's the User model's ID field type and name?
- What fields are available (name, email, etc.)?
- This is needed to properly set up the foreign key for GameScore

---

### 3.3 Database Migration Pattern
Check how migrations are handled:
```bash
# List existing migrations
ls -la prisma/migrations/ | head -10

# Check package.json for prisma scripts
grep -A 5 "prisma" package.json
```

**Questions to answer:**
- How are migrations created? (`npx prisma migrate dev`?)
- Is there a naming convention for migrations?
- Any special scripts in package.json?

---

## Phase 4: Frontend Patterns & Styling

### 4.1 Page Component Pattern
Find an example dashboard page:
```bash
cat src/app/dashboard/page.tsx
```

**Questions to answer:**
- How are pages structured?
- Is there a layout wrapper?
- How is loading state handled?
- What's the pattern for fetching data?

---

### 4.2 Tailwind Configuration
Check Tailwind config for custom colors/themes:
```bash
cat tailwind.config.js
```

**Questions to answer:**
- Are there custom colors defined?
- Is dark mode configured?
- Any custom animations we can use?

---

### 4.3 Existing Modal Pattern
Find if there's a modal component pattern:
```bash
find src/components -name "*[Mm]odal*" | head -3
ls src/components/dashboard/ | grep -i modal

# Show an example modal
cat src/components/dashboard/RecordDetailModal.tsx | head -100
```

**Questions to answer:**
- Is there a reusable modal component?
- How are modals opened/closed?
- What's the styling pattern?

---

### 4.4 Canvas or Animation Libraries
Check if any canvas/animation libraries are installed:
```bash
grep -E "canvas|konva|pixi|framer-motion|react-spring|gsap" package.json
```

**Questions to answer:**
- Are any animation/canvas libraries already installed?
- Do we need to add any new dependencies?
- What's available for game rendering?

---

## Phase 5: API Endpoint Planning

### 5.1 Verify Quarter Calculation Logic
We need to dynamically show the last 4 quarters + QTD. Test this logic:
```sql
-- Calculate current and last 4 quarters
SELECT 
  FORMAT_DATE('%Y-Q%Q', CURRENT_DATE()) as current_quarter,
  FORMAT_DATE('%Y-Q%Q', DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH)) as q_minus_1,
  FORMAT_DATE('%Y-Q%Q', DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)) as q_minus_2,
  FORMAT_DATE('%Y-Q%Q', DATE_SUB(CURRENT_DATE(), INTERVAL 9 MONTH)) as q_minus_3,
  FORMAT_DATE('%Y-Q%Q', DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)) as q_minus_4
```

**Questions to answer:**
- Does this logic correctly identify the quarters?
- What's the current quarter right now?
- What 4 previous quarters should show?

---

### 5.2 Quarter Date Range Calculation
Verify we can convert quarter strings to date ranges:
```sql
-- For a given quarter like '2024-Q4', get start and end dates
SELECT 
  '2024-Q4' as quarter,
  DATE('2024-10-01') as expected_start,
  DATE('2024-12-31') as expected_end,
  -- QTD example
  '2025-Q1' as current_quarter,
  DATE('2025-01-01') as qtd_start,
  CURRENT_DATE() as qtd_end
```

**Questions to answer:**
- Confirm the date calculation logic is correct
- For QTD, end date should be today, correct?

---

## Phase 6: Final Validation Queries

### 6.1 Full Game Data Query (Template)
This is the query template we'll use. Run it for Q4 2024 to validate:
```sql
DECLARE start_date DATE DEFAULT '2024-10-01';
DECLARE end_date DATE DEFAULT '2024-12-31';

-- SQOs (main targets)
SELECT 
  'sqo' as type,
  advisor_name as name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  StageName as stage,
  CAST(NULL AS STRING) as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c >= start_date 
  AND Date_Became_SQO__c <= end_date
  AND advisor_name IS NOT NULL

UNION ALL

-- Stop Signs (Do Not Call)
SELECT 
  'stop_sign' as type,
  advisor_name as name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  CAST(NULL AS STRING) as stage,
  'Do Not Call' as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DoNotCall = TRUE
  AND FilterDate >= start_date 
  AND FilterDate <= end_date
  AND advisor_name IS NOT NULL
LIMIT 20

UNION ALL

-- Ghosts (No Response)
SELECT 
  'ghost' as type,
  advisor_name as name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  CAST(NULL AS STRING) as stage,
  'No Response' as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE LOWER(Disposition__c) LIKE '%no response%'
  AND FilterDate >= start_date 
  AND FilterDate <= end_date
  AND advisor_name IS NOT NULL
LIMIT 20

UNION ALL

-- Joined (Stars - bonus!)
SELECT 
  'joined' as type,
  advisor_name as name,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  'Joined' as stage,
  CAST(NULL AS STRING) as reason
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_joined_unique = 1
  AND advisor_join_date__c >= start_date 
  AND advisor_join_date__c <= end_date
  AND advisor_name IS NOT NULL

ORDER BY type, aum DESC
```

**Questions to answer:**
- Record the total count for each type
- Record a few sample names (first name only for privacy in docs)
- Confirm all required fields are populated
- Note any data quality issues

---

## Summary Checklist

Before proceeding to the implementation plan, confirm ALL of the following in `game-answers.md`:

### Data Availability
- [ ] SQO counts per quarter documented
- [ ] Do Not Call counts per quarter documented  
- [ ] No Response counts per quarter documented
- [ ] Joined advisor counts per quarter documented
- [ ] Sample game data query tested and validated
- [ ] Exact `Disposition__c` value for "No Response" confirmed

### Codebase Patterns
- [ ] Directory structure for game files identified
- [ ] BigQuery query pattern documented
- [ ] API route pattern documented
- [ ] Prisma schema location and User model documented
- [ ] Sidebar logo location and JSX identified
- [ ] Auth/session access pattern documented

### Database Schema
- [ ] Prisma model conventions documented
- [ ] User model ID field confirmed
- [ ] Migration process documented

### Frontend Patterns
- [ ] Page component structure documented
- [ ] Tailwind configuration noted
- [ ] Modal pattern identified
- [ ] Animation library availability checked

### API Planning
- [ ] Quarter calculation logic validated
- [ ] Date range conversion tested
- [ ] Full game data query template validated

---

## Next Steps

Once all questions are answered and recorded in `game-answers.md`, respond with:

```
✅ Phase 1 complete - Data Availability documented
✅ Phase 2 complete - Codebase Structure documented  
✅ Phase 3 complete - Database Schema documented
✅ Phase 4 complete - Frontend Patterns documented
✅ Phase 5 complete - API Planning documented
✅ Phase 6 complete - Validation Queries documented

Ready for implementation plan generation.
```

Then I will provide you with a detailed, step-by-step agentic implementation plan.
