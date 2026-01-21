# Open Pipeline Implementation Guide - Validation Plan

## Purpose
This document provides step-by-step instructions for Cursor.ai to **validate** the `Open_Pipeline_Implementation_Guide.md` against the **actual codebase**. After completing this validation, update the implementation guide to fix any discrepancies so the plan will work correctly when executed.

**Input File**: `C:\Users\russe\Documents\Dashboard\Open_Pipeline_Implementation_Guide.md`
**Output**: Updated version of the same file with corrections

---

## Instructions for Cursor.ai

1. Work through each validation step in order
2. For each step, compare what the implementation guide says vs. what actually exists
3. Document any discrepancies found
4. After completing all validations, update the implementation guide with corrections
5. Add a "Validation Log" section at the end of the implementation guide documenting changes made

---

## VALIDATION SECTION 1: File Paths & Directory Structure

### V1.1: Verify Dashboard Page Structure
```bash
# Check the actual structure of the dashboard directory
ls -la src/app/dashboard/

# Verify the main dashboard page exists and note its actual structure
cat src/app/dashboard/page.tsx | head -100
```

**Check in Implementation Guide**:
- Does the page structure pattern in Phase 6 match the actual main dashboard page?
- Are the imports correct?
- Is the component structure (useState, useEffect, useCallback) accurate?

**Update if needed**: Adjust the page template in Phase 6.1 to match actual patterns.

### V1.2: Verify API Route Structure
```bash
# Check existing API route structure
ls -la src/app/api/dashboard/

# Look at an existing route for the correct pattern
cat src/app/api/dashboard/open-pipeline/route.ts
```

**Check in Implementation Guide**:
- Does the API route pattern in Phase 3 match existing routes?
- Is the authentication pattern (`getServerSession`, `authOptions`) correct?
- Is the error handling pattern correct?

**Update if needed**: Adjust Phase 3.1 and 3.2 API route templates.

### V1.3: Verify Query File Location
```bash
# Check the queries directory structure
ls -la src/lib/queries/

# View the actual open-pipeline.ts file
cat src/lib/queries/open-pipeline.ts
```

**Check in Implementation Guide**:
- Does the file `src/lib/queries/open-pipeline.ts` exist?
- What functions are already exported?
- What is the exact signature of `_getOpenPipelineSummary`?
- What imports are used at the top of the file?

**Update if needed**: Adjust Phase 1.1 and 1.2 to match actual file structure and imports.

### V1.4: Verify Components Directory
```bash
# Check dashboard components directory
ls -la src/components/dashboard/

# Check if any pipeline-related components already exist
ls src/components/dashboard/ | grep -i pipeline
```

**Check in Implementation Guide**:
- Do any pipeline components already exist that we should reuse or extend?
- What's the naming convention for components in this directory?

**Update if needed**: Adjust component file names in Phase 5 if needed.

---

## VALIDATION SECTION 2: Import Statements & Dependencies

### V2.1: Verify Tremor Imports
```bash
# Find how Tremor components are imported in existing files
grep -r "from '@tremor" src/components/dashboard/ | head -20
grep -r "from '@tremor" src/app/dashboard/ | head -10
```

**Check in Implementation Guide**:
- Are the Tremor imports (`Card`, `Metric`, `Text`, `Title`) correct?
- What's the actual import path used?

**Update if needed**: Fix Tremor import statements throughout the guide.

### V2.2: Verify Recharts Imports
```bash
# Find how Recharts is imported
grep -r "from 'recharts'" src/components/ | head -10
```

**Check in Implementation Guide**:
- Are all Recharts components (`BarChart`, `Bar`, `XAxis`, `YAxis`, etc.) imported correctly?
- Is there a pattern for how charts are structured?

**Update if needed**: Fix Recharts imports in Phase 5.2.

### V2.3: Verify Lucide Icons
```bash
# Check how icons are imported
grep -r "from 'lucide-react'" src/components/ | head -10
```

**Check in Implementation Guide**:
- Is `Loader2` imported correctly?
- What other icons are commonly used?

**Update if needed**: Fix icon imports.

### V2.4: Verify Auth Imports
```bash
# Check how auth is imported in API routes
grep -r "getServerSession" src/app/api/ | head -5
grep -r "authOptions" src/app/api/ | head -5
```

**Check in Implementation Guide**:
- What is the correct import path for `authOptions`?
- Is it `@/lib/auth` or something else?

**Update if needed**: Fix auth imports in Phase 3.

### V2.5: Verify Permission Imports
```bash
# Check how permissions are imported and used
grep -r "getUserPermissions" src/app/api/ | head -5
grep -r "getSessionPermissions" src/ | head -5
cat src/lib/permissions.ts | head -50
```

**Check in Implementation Guide**:
- What's the correct function name and import path?
- How are permissions checked in existing routes?

**Update if needed**: Fix permission imports and usage.

---

## VALIDATION SECTION 3: Type Definitions

### V3.1: Verify Dashboard Types File
```bash
# Check the types file structure
cat src/types/dashboard.ts
```

**Check in Implementation Guide**:
- Does `src/types/dashboard.ts` exist?
- What types are already defined?
- Is `DetailRecord` defined there or elsewhere?
- Where should new types be added?

**Update if needed**: Adjust Phase 2.1 type definitions location and structure.

### V3.2: Verify Existing OpenPipeline Types
```bash
# Check for any existing open pipeline types
grep -r "OpenPipeline" src/types/
grep -r "interface.*Pipeline" src/types/
```

**Check in Implementation Guide**:
- Do any OpenPipeline types already exist?
- Should we extend them or create new ones?

**Update if needed**: Adjust type definitions to avoid conflicts.

### V3.3: Verify DetailRecord Type
```bash
# Find the DetailRecord type definition
grep -r "interface DetailRecord" src/
grep -r "type DetailRecord" src/
```

**Check in Implementation Guide**:
- Where is `DetailRecord` actually defined?
- What fields does it have?
- Does the drill-down function return the correct type?

**Update if needed**: Ensure type compatibility.

---

## VALIDATION SECTION 4: API Client

### V4.1: Verify API Client Structure
```bash
# View the API client file
cat src/lib/api-client.ts
```

**Check in Implementation Guide**:
- What is the structure of `dashboardApi`?
- Is it an object with methods, a class, or named exports?
- What's the pattern for adding new methods?
- Are there existing methods we can reference for patterns?

**Update if needed**: Adjust Phase 4.1 to match actual API client structure.

### V4.2: Verify Existing Open Pipeline Methods
```bash
# Check if getOpenPipelineRecords already exists in API client
grep -A 20 "getOpenPipeline" src/lib/api-client.ts
```

**Check in Implementation Guide**:
- Does `getOpenPipelineRecords` already exist?
- What's its signature?
- Can we reuse it or do we need new methods?

**Update if needed**: Avoid duplicating existing methods.

---

## VALIDATION SECTION 5: Existing Components to Reuse

### V5.1: Verify OpenPipelineAumTooltip
```bash
# Check if this component exists
cat src/components/dashboard/OpenPipelineAumTooltip.tsx
```

**Check in Implementation Guide**:
- Does this component exist?
- What props does it accept?
- Can we use it directly in PipelineScorecard?

**Update if needed**: Adjust Phase 5.3 if tooltip component differs.

### V5.2: Verify DetailRecordsTable
```bash
# Check the DetailRecordsTable component
cat src/components/dashboard/DetailRecordsTable.tsx | head -100
```

**Check in Implementation Guide**:
- What props does `DetailRecordsTable` accept?
- Does it have `onRecordClick` prop?
- Does it have `canExport` prop?
- What's the records prop type?

**Update if needed**: Fix drill-down modal in Phase 6 to use correct props.

### V5.3: Verify RecordDetailModal
```bash
# Check the RecordDetailModal component
cat src/components/dashboard/RecordDetailModal.tsx | head -100
```

**Check in Implementation Guide**:
- What props does `RecordDetailModal` accept?
- Does it have `showBackButton`, `onBack`, `backButtonLabel` props?
- What's the `recordId` prop type?

**Update if needed**: Fix modal usage in Phase 6.

### V5.4: Verify Existing Scorecards
```bash
# Check how scorecards are implemented
cat src/components/dashboard/Scorecards.tsx | head -150
```

**Check in Implementation Guide**:
- How are existing scorecards structured?
- Should we reuse the existing scorecard component instead of creating new?
- What props do they accept?

**Update if needed**: Consider reusing existing scorecard component.

---

## VALIDATION SECTION 6: Constants & Configuration

### V6.1: Verify Constants File
```bash
# Check the constants file
cat src/config/constants.ts
```

**Check in Implementation Guide**:
- Is `OPEN_PIPELINE_STAGES` exported correctly?
- What are the actual stage values?
- Is `RECRUITING_RECORD_TYPE` correct?
- Is `FULL_TABLE` correct?
- Is `MAPPING_TABLE` correct?

**Update if needed**: Fix any constant references.

### V6.2: Verify Cache Configuration
```bash
# Check caching setup
cat src/lib/cache.ts | head -50
grep -r "CACHE_TAGS" src/lib/ | head -10
```

**Check in Implementation Guide**:
- Is `cachedQuery` the correct function name?
- What's the import path for caching utilities?
- Is `CACHE_TAGS.DASHBOARD` correct?

**Update if needed**: Fix caching usage in Phase 1.

---

## VALIDATION SECTION 7: Sidebar & Navigation

### V7.1: Verify Sidebar Location and Structure
```bash
# Find the sidebar component
find src -name "*Sidebar*" -o -name "*sidebar*"
cat src/components/layout/Sidebar.tsx 2>/dev/null || cat src/components/Sidebar.tsx 2>/dev/null
```

**Check in Implementation Guide**:
- What's the correct file path for the Sidebar?
- How is the PAGES array structured?
- What icons are imported?
- How are page permissions checked?

**Update if needed**: Fix Phase 7.1 sidebar modifications.

### V7.2: Verify Existing Page IDs
```bash
# Check what page IDs are already used
grep -r "id:" src/components/*Sidebar* | head -20
grep -r "allowedPages" src/lib/permissions.ts
```

**Check in Implementation Guide**:
- Is page ID 3 already used for something else?
- What page IDs exist?
- How are permissions structured?

**Update if needed**: Fix page ID references.

---

## VALIDATION SECTION 8: Utility Functions

### V8.1: Verify formatCurrency Function
```bash
# Find the formatCurrency function
grep -r "formatCurrency" src/lib/ | head -5
grep -r "export.*formatCurrency" src/lib/
```

**Check in Implementation Guide**:
- Where is `formatCurrency` defined?
- What's the correct import path?
- What's the function signature?

**Update if needed**: Fix import statements for formatCurrency.

### V8.2: Verify BigQuery Helper Functions
```bash
# Check BigQuery helpers
cat src/lib/bigquery.ts | head -50
grep -r "runQuery" src/lib/queries/ | head -5
grep -r "toNumber\|toString" src/types/bigquery-raw.ts | head -10
```

**Check in Implementation Guide**:
- Is `runQuery` the correct function name?
- Where are `toNumber` and `toString` helpers?
- What's the correct import path?

**Update if needed**: Fix BigQuery utility imports in Phase 1.

---

## VALIDATION SECTION 9: Dark Mode Support

### V9.1: Verify Dark Mode Pattern
```bash
# Check how dark mode is detected in existing components
grep -r "dark:" src/components/dashboard/ | head -10
grep -r "isDark" src/components/dashboard/ | head -10
grep -r "classList.*dark" src/ | head -5
```

**Check in Implementation Guide**:
- How is dark mode detected?
- What's the pattern for dark mode CSS classes?
- Is the `isDark` variable correctly computed?

**Update if needed**: Fix dark mode detection in Phase 6.

---

## VALIDATION SECTION 10: Error Boundaries

### V10.1: Verify Error Boundary Usage
```bash
# Check for error boundaries
grep -r "ErrorBoundary" src/components/ | head -10
grep -r "CardErrorBoundary\|TableErrorBoundary" src/ | head -10
```

**Check in Implementation Guide**:
- Are error boundaries used on the main dashboard?
- Should we add them to the pipeline page?

**Update if needed**: Add error boundaries to Phase 6 if they're used elsewhere.

---

## VALIDATION SECTION 11: Session Handling

### V11.1: Verify useSession Pattern
```bash
# Check how useSession is used in dashboard pages
grep -A 5 "useSession" src/app/dashboard/page.tsx
grep -r "status.*loading\|status.*authenticated" src/app/dashboard/ | head -5
```

**Check in Implementation Guide**:
- Is the session handling pattern correct?
- How is loading state handled during auth check?

**Update if needed**: Fix session handling in Phase 6.

---

## VALIDATION SECTION 12: Query Function Signatures

### V12.1: Deep Dive into open-pipeline.ts
```bash
# Get the full file content
cat src/lib/queries/open-pipeline.ts
```

**Perform detailed analysis**:
1. What are the exact function signatures?
2. What are the return types?
3. What parameters are accepted?
4. What imports are at the top of the file?
5. How is `cachedQuery` used?

**Update if needed**: Completely rewrite Phase 1 if necessary to match actual code.

### V12.2: Verify RawOpenPipelineResult Type
```bash
# Find the raw result type
grep -r "RawOpenPipelineResult" src/
cat src/types/bigquery-raw.ts | grep -A 20 "RawOpenPipelineResult"
```

**Check in Implementation Guide**:
- Does `RawOpenPipelineResult` exist?
- What fields does it have?
- Is it used correctly in the query function?

**Update if needed**: Fix type usage in Phase 1.2.

---

## FINAL STEPS: Update the Implementation Guide

After completing all validations above:

### Step 1: Create Validation Log
Add a new section at the end of `Open_Pipeline_Implementation_Guide.md`:

```markdown
---

## Validation Log

**Validated By**: Cursor.ai
**Validation Date**: [DATE]

### Changes Made

| Section | Issue Found | Correction Made |
|---------|-------------|-----------------|
| Phase 1.1 | [describe issue] | [describe fix] |
| Phase 3.1 | [describe issue] | [describe fix] |
| ... | ... | ... |

### Files Verified Against Codebase
- [x] src/lib/queries/open-pipeline.ts
- [x] src/lib/api-client.ts
- [x] src/components/dashboard/DetailRecordsTable.tsx
- ... (list all files checked)

### Confidence Level
[HIGH/MEDIUM/LOW] - [explanation of confidence in the corrected plan]
```

### Step 2: Update All Code Blocks
For each code block in the implementation guide:
1. Verify all imports are correct
2. Verify all function names match actual codebase
3. Verify all type names match actual codebase
4. Verify all file paths are correct

### Step 3: Add Missing Dependencies
If validation revealed missing imports or dependencies, add them to the guide.

### Step 4: Remove Non-Existent References
If validation revealed references to things that don't exist, either:
- Remove them from the guide
- Add steps to create them

### Step 5: Reorder Steps If Needed
If dependencies between steps are incorrect, reorder them.

---

## Validation Completion Checklist

Before marking validation complete, ensure:

- [ ] All file paths verified and corrected
- [ ] All import statements verified and corrected
- [ ] All function signatures verified and corrected
- [ ] All type definitions verified and corrected
- [ ] All component props verified and corrected
- [ ] All constants verified and corrected
- [ ] Validation log added to implementation guide
- [ ] Implementation guide saved with all corrections

---

## Command Summary for Quick Validation

Run these commands to get a comprehensive view of the codebase:

```bash
# Directory structures
ls -la src/app/dashboard/
ls -la src/app/api/dashboard/
ls -la src/lib/queries/
ls -la src/components/dashboard/
ls -la src/types/

# Key files to review in full
cat src/lib/queries/open-pipeline.ts
cat src/lib/api-client.ts
cat src/app/api/dashboard/open-pipeline/route.ts
cat src/components/dashboard/DetailRecordsTable.tsx | head -100
cat src/components/dashboard/RecordDetailModal.tsx | head -100
cat src/config/constants.ts
cat src/lib/permissions.ts
cat src/types/dashboard.ts | head -100
cat src/types/bigquery-raw.ts | head -50

# Sidebar location
find src -name "*Sidebar*" -type f
```

---

*Validation Plan Version: 1.0*
*Created: January 2026*
