# Recruiter Hub Implementation - Phased Questions for Cursor.ai

This document contains a comprehensive set of phased questions for Cursor.ai to work through when implementing the Recruiter Hub feature. Based on answers discovered during each phase, Cursor.ai should update `C:\Users\russe\Documents\Dashboard\recruiter_hub_investigation.md` to enhance and refine the implementation plan.

**IMPORTANT**: Cursor.ai has access to BigQuery via MCP and should use it to verify data assumptions and discover actual column names, data distributions, and record counts.

---

## Phase 1: BigQuery Data Discovery & Validation

### 1.1 External Agency Data Validation

**Questions to Answer:**

1. **What are all the distinct External_Agency__c values in the Lead table?**
   ```sql
   SELECT DISTINCT External_Agency__c, COUNT(*) as lead_count
   FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
   WHERE External_Agency__c IS NOT NULL AND TRIM(External_Agency__c) != ''
   GROUP BY External_Agency__c
   ORDER BY lead_count DESC
   ```
   **Update Investigation If:** List the actual agency names found. Update Section 3.4 with the complete list.

2. **What are all the distinct External_Agency__c values in the Opportunity table?**
   ```sql
   SELECT DISTINCT External_Agency__c, COUNT(*) as opp_count
   FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
   WHERE External_Agency__c IS NOT NULL AND TRIM(External_Agency__c) != ''
   GROUP BY External_Agency__c
   ORDER BY opp_count DESC
   ```
   **Update Investigation If:** Note any agencies that exist in Opportunity but not in Lead (or vice versa).

3. **Are there any External_Agency__c values with inconsistent casing or spelling?**
   ```sql
   SELECT LOWER(TRIM(External_Agency__c)) as normalized_agency, 
          ARRAY_AGG(DISTINCT External_Agency__c) as variations
   FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
   WHERE External_Agency__c IS NOT NULL AND TRIM(External_Agency__c) != ''
   GROUP BY LOWER(TRIM(External_Agency__c))
   HAVING COUNT(DISTINCT External_Agency__c) > 1
   ```
   **Update Investigation If:** Document any data quality issues. Consider whether normalization is needed.

### 1.2 Next Steps Fields Validation

**Questions to Answer:**

4. **Does the Lead.Next_Steps__c column exist and what does the data look like?**
   ```sql
   SELECT 
     COUNT(*) as total_leads,
     COUNTIF(Next_Steps__c IS NOT NULL) as has_next_steps,
     COUNTIF(Next_Steps__c IS NULL) as null_next_steps
   FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
   ```
   **Update Investigation If:** If column doesn't exist, document the actual column name or note that feature needs adjustment.

5. **Does the Opportunity.NextStep column exist and what does the data look like?**
   ```sql
   SELECT 
     COUNT(*) as total_opps,
     COUNTIF(NextStep IS NOT NULL) as has_next_step,
     COUNTIF(NextStep IS NULL) as null_next_step
   FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
   WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
   ```
   **Update Investigation If:** Document actual column name and update SQL references in Phase B.

6. **Sample Next_Steps__c and NextStep values:**
   ```sql
   SELECT DISTINCT Next_Steps__c 
   FROM `savvy-gtm-analytics.SavvyGTMData.Lead` 
   WHERE Next_Steps__c IS NOT NULL 
   LIMIT 20
   ```
   **Update Investigation If:** Document the typical format/length of these fields to inform UI column width.

### 1.3 Current vw_funnel_master Validation

**Questions to Answer:**

7. **What columns currently exist in vw_funnel_master?**
   ```sql
   SELECT column_name, data_type
   FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
   WHERE table_name = 'vw_funnel_master'
   ORDER BY ordinal_position
   ```
   **Update Investigation If:** Document which columns are lowercase vs mixed case. Update all SQL references accordingly.

8. **Is External_Agency__c already present in vw_funnel_master and what's the column name?**
   ```sql
   SELECT DISTINCT External_Agency__c
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE External_Agency__c IS NOT NULL
   LIMIT 10
   ```
   **Update Investigation If:** Document the exact column name (case-sensitive). Update all query references.

9. **How many records have External_Agency__c set in vw_funnel_master?**
   ```sql
   SELECT 
     COUNT(*) as total_records,
     COUNTIF(External_Agency__c IS NOT NULL AND TRIM(CAST(External_Agency__c AS STRING)) != '') as has_agency,
     COUNTIF(Full_prospect_id__c IS NOT NULL) as has_prospect,
     COUNTIF(Full_Opportunity_ID__c IS NOT NULL) as has_opportunity
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE External_Agency__c IS NOT NULL AND TRIM(CAST(External_Agency__c AS STRING)) != ''
   ```
   **Update Investigation If:** Update record count estimates for UI loading expectations.

### 1.4 Stage & Status Fields

**Questions to Answer:**

10. **What ProspectStatus/Disposition values exist for filtering Open vs Closed prospects?**
    ```sql
    SELECT DISTINCT Disposition__c, Conversion_Status, TOF_Stage, COUNT(*) as cnt
    FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
    WHERE External_Agency__c IS NOT NULL
    GROUP BY Disposition__c, Conversion_Status, TOF_Stage
    ORDER BY cnt DESC
    ```
    **Update Investigation If:** Update the filter logic definition for "Open Prospects" vs "Closed Prospects".

11. **What StageName values exist for Opportunity filtering?**
    ```sql
    SELECT DISTINCT StageName, COUNT(*) as cnt
    FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
    WHERE External_Agency__c IS NOT NULL AND Full_Opportunity_ID__c IS NOT NULL
    GROUP BY StageName
    ORDER BY cnt DESC
    ```
    **Update Investigation If:** Document all stage values for the filter dropdown.

---

## Phase 2: Permissions & User Model Deep Dive

### 2.1 Current Codebase Verification

**Questions to Answer:**

12. **Verify the current User model in prisma/schema.prisma:**
    - Open `prisma/schema.prisma`
    - Confirm the User model fields
    - **Update Investigation If:** Document any additional fields that exist that weren't captured.

13. **Check if `externalAgency` field already exists in User model:**
    - Search for `externalAgency` in the codebase
    - **Update Investigation If:** Note whether migration is needed or if field already exists.

14. **Review src/lib/permissions.ts for the exact ROLE_PERMISSIONS structure:**
    - Confirm allowedPages for each role
    - Document the exact return type of getUserPermissions
    - **Update Investigation If:** Add any missing permission properties to the investigation.

### 2.2 Page ID Conflicts

**Questions to Answer:**

15. **What page IDs are currently in use?**
    - Check `src/components/layout/Sidebar.tsx` for PAGES array
    - Check `src/lib/permissions.ts` for allowedPages arrays
    - **Update Investigation If:** Confirm page ID 12 is available or choose different ID.

16. **Are there any hidden/disabled pages that use IDs we might conflict with?**
    - Search codebase for references to page IDs (e.g., `pageId`, `page: 11`, `page: 12`)
    - **Update Investigation If:** Document all used page IDs to avoid conflicts.

### 2.3 Authentication Flow for Recruiters

**Questions to Answer:**

17. **Review src/lib/auth.ts to understand OAuth flow:**
    - How does Google OAuth currently work?
    - How is the User record created/linked for OAuth users?
    - **Update Investigation If:** Document special handling needed for recruiter OAuth login.

18. **Review src/app/login/page.tsx:**
    - Is there separate handling for OAuth vs credentials login?
    - **Update Investigation If:** Note if any UI changes needed for recruiter-specific login behavior.

---

## Phase 3: Existing Component Pattern Analysis

### 3.1 Filter Components

**Questions to Answer:**

19. **Analyze src/app/dashboard/pipeline/page.tsx for filter patterns:**
    - How are stage filters implemented?
    - How is the filter state managed?
    - What components are used for multi-select dropdowns?
    - **Update Investigation If:** Document reusable components and patterns.

20. **Analyze OpenPipeline or Leaderboard filter implementations:**
    - Look for PipelineFilters component or similar
    - How are picklists rendered?
    - **Update Investigation If:** List specific components to reuse vs create new.

21. **Review how "Open" vs "Closed" toggles work in existing dashboards:**
    - What field/logic determines open vs closed?
    - Is it a toggle, radio, or dropdown?
    - **Update Investigation If:** Document the exact pattern to follow.

### 3.2 Table Components

**Questions to Answer:**

22. **Review src/components/dashboard/DetailRecordsTable.tsx:**
    - What props does it accept?
    - How is sorting handled?
    - How is row click / drilldown handled?
    - **Update Investigation If:** Determine if this component can be reused or needs modification.

23. **Review the VolumeDrillDownModal component:**
    - How does it handle loading states?
    - How does it pass record IDs to RecordDetailModal?
    - **Update Investigation If:** Document the exact props and callback patterns.

24. **Review RecordDetailModal:**
    - What fields does it display?
    - How does it fetch record details?
    - Does it need modification to show Next_Steps__c / NextStep?
    - **Update Investigation If:** Document changes needed to record-detail query.

### 3.3 API Patterns

**Questions to Answer:**

25. **Review existing drilldown APIs (e.g., /api/dashboard/detail-records):**
    - How are filters passed (query params vs POST body)?
    - How is pagination handled?
    - How is the recruiterFilter/sgaFilter applied?
    - **Update Investigation If:** Document the exact API pattern to follow.

26. **Review how sgaFilter works in existing APIs:**
    - Find an API that uses sgaFilter from permissions
    - How is it applied in BigQuery queries?
    - **Update Investigation If:** Use same pattern for recruiterFilter.

---

## Phase 4: Settings/User Management Integration

### 4.1 User Modal Analysis

**Questions to Answer:**

27. **Review src/components/settings/UserModal.tsx in detail:**
    - How does the role dropdown work?
    - Is there conditional field rendering based on role?
    - **Update Investigation If:** Document exact insertion point for External Agency field.

28. **How does the User API handle optional fields?**
    - Review POST /api/users and PUT /api/users/[id]
    - How are optional fields validated?
    - **Update Investigation If:** Document validation approach for externalAgency.

### 4.2 Recruiter Access Restrictions

**Questions to Answer:**

29. **How does the Settings page determine what to show?**
    - Review src/app/dashboard/settings/page.tsx
    - Is there role-based UI rendering?
    - **Update Investigation If:** Document how to restrict Settings for recruiters to only show password change.

30. **How does the Sidebar handle page visibility?**
    - Review permission check in Sidebar.tsx
    - Confirm that allowedPages properly hides pages
    - **Update Investigation If:** Verify recruiter will only see Recruiter Hub + Settings.

---

## Phase 5: Implementation Readiness Checklist

### 5.1 Database Migration Preparation

**Questions to Answer:**

31. **What is the migration workflow for this project?**
    - Check if there's a migrations folder with existing migrations
    - Review package.json for prisma scripts
    - **Update Investigation If:** Document exact commands needed for migration.

32. **What happens if the column already exists?**
    - Plan for idempotent migration
    - **Update Investigation If:** Add migration script to investigation with error handling.

### 5.2 BigQuery View Update Preparation

**Questions to Answer:**

33. **How is vw_funnel_master deployed?**
    - Is there a deployment script or manual process?
    - Where is the view SQL maintained?
    - **Update Investigation If:** Document exact deployment steps for view changes.

34. **Will adding columns break any existing queries?**
    - Search codebase for `SELECT *` from vw_funnel_master
    - **Update Investigation If:** Note any queries that might need adjustment.

### 5.3 Testing Data Preparation

**Questions to Answer:**

35. **Is there test/sample data with External_Agency__c values?**
    - Query for a specific agency with diverse data
    - **Update Investigation If:** Identify a good test agency name for development.

36. **Are there existing test users in the database?**
    - Check if there's a test/demo recruiter user
    - **Update Investigation If:** Add test user creation to implementation plan.

---

## Phase 6: Edge Cases & Error Handling

### 6.1 Data Edge Cases

**Questions to Answer:**

37. **What happens if External_Agency__c contains special characters?**
    ```sql
    SELECT External_Agency__c
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE External_Agency__c IS NOT NULL 
      AND (External_Agency__c LIKE '%"%' OR External_Agency__c LIKE "%'%" OR External_Agency__c LIKE '%<%')
    LIMIT 10
    ```
    **Update Investigation If:** Document escaping/sanitization needs.

38. **What if a recruiter's agency is renamed or deleted in Salesforce?**
    - How should orphaned recruiter users be handled?
    - **Update Investigation If:** Add admin notification or validation logic.

### 6.2 Permission Edge Cases

**Questions to Answer:**

39. **What happens if an admin changes a user's role FROM recruiter TO something else?**
    - Should externalAgency be cleared?
    - **Update Investigation If:** Document role change handling.

40. **What if a recruiter tries to access a direct URL to another page?**
    - Verify middleware/page-level protection
    - **Update Investigation If:** Add security verification to implementation plan.

---

## Phase 7: Performance & Scale Considerations

### 7.1 Query Performance

**Questions to Answer:**

41. **How many total records with External_Agency__c exist?**
    ```sql
    SELECT COUNT(*) 
    FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
    WHERE External_Agency__c IS NOT NULL
    ```
    **Update Investigation If:** If >10k records, add pagination requirement.

42. **What indexes exist on vw_funnel_master?**
    - Views don't have indexes, but source tables do
    - Check if External_Agency__c is indexed in source tables
    - **Update Investigation If:** Note any performance concerns.

### 7.2 UI Performance

**Questions to Answer:**

43. **How do other tables handle large datasets?**
    - Review DetailRecordsTable pagination
    - Review client-side vs server-side pagination patterns
    - **Update Investigation If:** Document pagination approach for Recruiter Hub tables.

44. **Should External Agency dropdown be cached?**
    - How often do agencies change?
    - Is API response caching implemented elsewhere?
    - **Update Investigation If:** Add caching strategy to implementation.

---

## Phase 8: Final Verification & Documentation

### 8.1 Implementation File Checklist

**For each file in the investigation File Reference Summary (Section 8), verify:**

45. **File exists and matches expected structure?**
    - Check each file path
    - Verify imports and exports
    - **Update Investigation If:** Correct any incorrect file paths.

46. **All dependencies are installed?**
    - Check package.json for required packages
    - **Update Investigation If:** Add any missing npm packages.

### 8.2 Documentation Updates

**Questions to Answer:**

47. **What documentation needs to be updated?**
    - ARCHITECTURE.md (roles, pages)
    - GLOSSARY.md (new terms)
    - Any API documentation
    - **Update Investigation If:** Add documentation tasks to implementation phases.

48. **Are there any README files in relevant directories?**
    - Check src/app/dashboard/ for README
    - Check src/components/ for README
    - **Update Investigation If:** Note which READMEs need updating.

---

## How to Use This Document

1. **Work through phases sequentially** - Later phases depend on answers from earlier phases.

2. **After each question:**
   - Document the answer directly in this file (or a separate working notes file)
   - If the answer reveals something different from the investigation document, update `recruiter_hub_investigation.md`

3. **Use MCP for BigQuery queries** - Don't guess at data; verify with actual queries.

4. **Track modifications** - Keep a changelog at the bottom of `recruiter_hub_investigation.md` noting what was discovered and changed.

5. **Flag blockers** - If any question reveals a blocker (missing feature, incorrect assumption), document it prominently.

---

## Investigation Document Update Log

_This section should be updated as Cursor.ai works through the questions:_

| Phase | Question # | Finding | Investigation Update |
|-------|-----------|---------|---------------------|
| 1.1 | Q1 | (pending) | (pending) |
| ... | ... | ... | ... |

---

## Critical Success Criteria

Before starting implementation, confirm these are documented in the investigation:

- [ ] Exact External_Agency__c column name (case) in vw_funnel_master
- [ ] Exact Next_Steps__c and NextStep column names (or alternatives)
- [ ] Complete list of External Agency values
- [ ] Confirmed page ID (12) is available
- [ ] Confirmed prisma migration path
- [ ] Confirmed BQ view deployment path
- [ ] At least one test agency identified for development
- [ ] All file paths verified
- [ ] Performance approach for large datasets documented
