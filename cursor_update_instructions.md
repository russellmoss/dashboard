# Cursor.ai Task: Update Recruiter Hub Investigation with Finalized Decisions

## Objective

Update `C:\Users\russe\Documents\Dashboard\recruiter_hub_investigation.md` to incorporate all finalized product decisions below. This document will become the **single source of truth** for the Recruiter Hub implementation.

After completing all updates, the investigation document should be complete enough that an agent can execute the implementation without ambiguity.

---

## Instructions for Cursor.ai

Work through each section below sequentially. For each decision:

1. **Find** the relevant section in `recruiter_hub_investigation.md`
2. **Update** the content to reflect the finalized decision
3. **Remove** any "Open / Clarification Points" that are now resolved
4. **Add** any new sections or details as needed

Use your MCP connection to BigQuery if you need to verify any data or test queries.

---

## SECTION 1: Permissions & Access Updates

### 1.1 Recruiter allowedPages — FINALIZED

**Decision:** Recruiters should ONLY have access to pages **7** (Settings) and **12** (Recruiter Hub).

**Update required in `recruiter_hub_investigation.md`:**

1. In **Section 2.2 (New Role: Recruiter)**, update the `allowedPages` specification:
   ```
   allowedPages: [7, 12]  // Settings + Recruiter Hub ONLY
   ```

2. Remove any mentions of recruiters potentially having access to pages 1, 3, or 10.

3. In **Section 10 (Open / Clarification Points)**, remove the bullet about "Exact allowedPages for recruiter" — this is now resolved.

4. Add a note explaining the rationale: "Recruiters are restricted to only their dedicated hub and settings to maintain focus and data isolation."

---

### 1.2 Recruiter Export Permission — FINALIZED

**Decision:** Recruiters CAN export data from their tables (`canExport: true`).

**Update required:**

1. In **Section 2.2**, update the recruiter role definition:
   ```
   canExport: true  // Recruiters can export their agency's data
   ```

2. Ensure any mentions of recruiter permissions include export capability.

---

### 1.3 Google OAuth Domain Allowlist — FINALIZED

**Decision:** Add external recruiter domains to Google OAuth allowlist (not just `@savvywealth.com`).

**Update required:**

1. In **Section 2.4 (Authentication & Provisioning Implications)**, replace the current limitation with:

   ```markdown
   **Google OAuth Domain Configuration:**
   
   Currently, Google OAuth is restricted to `@savvywealth.com` in `src/lib/auth.ts`. 
   To allow external recruiters to use Google sign-in:
   
   1. **Google Cloud Console Configuration:**
      - Navigate to: https://console.cloud.google.com/auth/clients/644017037386-varan6og6ou96mk4tql8d8mmcrkrof37.apps.googleusercontent.com?project=savvy-pirate-extension
      - Under "Authorized domains" or OAuth consent screen, add recruiter agency domains as needed
      - Example domains to add: Agency email domains (e.g., zerostaffing.com, ucare.com, etc.)
   
   2. **Code Change in `src/lib/auth.ts`:**
      - Current restriction: Email must end with `@savvywealth.com`
      - Update to: Check if email domain is in an allowlist OR if user exists in database with role='recruiter'
      - Recommended approach: Allow Google OAuth for ANY email that has a matching User record in the database
        (since recruiters must be pre-provisioned anyway, this is secure)
      
      Example logic change:
      ```typescript
      // Instead of checking domain, check if user exists in DB
      const existingUser = await getUserByEmail(profile.email);
      if (!existingUser) {
        // User not provisioned - redirect with error
        return '/login?error=NotProvisioned';
      }
      // User exists, allow sign-in regardless of domain
      ```
   
   3. **Recruiter Provisioning Flow (unchanged):**
      - Admin creates recruiter user in User Management (provisions email)
      - Recruiter can then sign in via Google OAuth (if their email is Gmail/Google Workspace)
      - OR recruiter can use email/password if they prefer or don't have Google account
   ```

2. Remove the note about "external recruiters cannot use Google today" — they will be able to once this is implemented.

---

## SECTION 2: UI/UX Updates

### 2.1 Page Layout — FINALIZED

**Decision:** Stacked vertically (Prospects section on top, Opportunities section below).

**Update required:**

1. Add a new subsection to **Section 6** or create **Section 6.5 (Page Layout)**:

   ```markdown
   ### 6.5 Page Layout: Stacked Vertical Sections
   
   The Recruiter Hub page uses a **stacked vertical layout**:
   
   1. **Header/Title** - "Recruiter Hub" with optional subtitle showing agency name for recruiters
   2. **Prospects Section** (top)
      - Section header: "Prospects" with count badge
      - Collapsible filter panel (Prospect Stage, Open/Closed)
      - Prospects table
   3. **Opportunities Section** (below)
      - Section header: "Opportunities" with count badge  
      - Collapsible filter panel (SGM, Stage, Open/Closed, External Agency for admins)
      - Opportunities table
   
   This matches the existing dashboard patterns and works well on all screen sizes.
   ```

---

### 2.2 External Agency Field in User Modal — FINALIZED

**Decision:** Dropdown + "Other" option (dropdown for existing agencies, with fallback to text input for new agencies).

**Update required:**

1. In **Section 2.5 (Phase 4: Settings / User Management Integration)**, update the UserModal specification:

   ```markdown
   **External Agency Field (when role = 'recruiter'):**
   
   Implement as a **combo field** with dropdown + "Other" option:
   
   1. **Primary UI:** Dropdown populated from `/api/recruiter-hub/external-agencies`
      - Shows all 32+ existing agencies from BigQuery
      - Includes an "Other (enter manually)" option at the bottom
   
   2. **"Other" behavior:** When "Other" is selected:
      - Show a text input field below the dropdown
      - Text input is required (cannot save with empty "Other")
      - Placeholder: "Enter agency name exactly as it appears in Salesforce"
   
   3. **Form state:**
      ```typescript
      externalAgency: string | null;
      externalAgencyIsOther: boolean;  // true when "Other" selected
      externalAgencyCustom: string;     // value when "Other" selected
      ```
   
   4. **On save:** 
      - If dropdown selection (not "Other"): use dropdown value
      - If "Other": use custom text input value (trimmed)
   
   5. **Validation:**
      - When role is 'recruiter', externalAgency is required
      - Show error: "External Agency is required for Recruiter role"
   ```

---

### 2.3 Admin View — External Agency Filter — FINALIZED

**Decision:** Both sort AND optional filter dropdown for admins.

**Update required:**

1. In **Section 5.4 (Opportunity Table Behavior)** and **Section 4.4 (Prospect Table Behavior)**, update admin behavior:

   ```markdown
   **Admin view:**
   - Default: Show ALL agencies, sorted alphabetically by External Agency
   - **Sort:** External Agency column is sortable (click header to sort A-Z or Z-A)
   - **Filter:** Optional External Agency dropdown in filter panel
     - Multi-select dropdown with all agencies
     - Default: All agencies selected (no filter applied)
     - Admin can select specific agencies to filter the view
   ```

2. In **Section 5.2 (Opportunity Filters)**, add:
   ```markdown
   - **External Agency (Admin only):** Multi-select dropdown of all agencies. 
     Hidden for recruiters (they're already scoped to one agency).
     Default: All selected.
   ```

3. In **Section 4.2 (Prospect Filters)**, add similar note for admin External Agency filter.

---

### 2.4 Filter Panel Default State — FINALIZED

**Decision:** Collapsed by default with summary chips showing active filters.

**Update required:**

1. In **Section 6.1 (Filters: picklist + apply/reset pattern)**, add:

   ```markdown
   **Default state:** Filter panels are **collapsed by default** with summary chips 
   showing the current filter state (e.g., "Open Only", "All Stages", "3 SGMs selected").
   
   User clicks to expand, makes changes, then clicks "Apply Filters" to apply.
   This matches the PipelineFilters pattern.
   ```

---

### 2.5 Sidebar Icon — FINALIZED

**Decision:** `Briefcase` icon from Lucide.

**Update required:**

1. In **Section 7, Phase A, Step 4 (Sidebar & Nav)**, update:

   ```markdown
   - In `src/components/layout/Sidebar.tsx`: Add to `PAGES`:
     ```typescript
     { id: 12, name: 'Recruiter Hub', href: '/dashboard/recruiter-hub', icon: Briefcase }
     ```
   - Import `Briefcase` from `lucide-react` at the top of the file.
   ```

---

### 2.6 Login Redirect — FINALIZED

**Decision:** Yes, redirect recruiters to `/dashboard/recruiter-hub` after login.

**Update required:**

1. In **Section 7, Phase A, Step 5 (Auth redirect)**, change from "optional" to required:

   ```markdown
   5. **Auth redirect (REQUIRED)**
      - In `src/app/login/page.tsx`, add recruiter redirect logic:
        ```typescript
        // After successful sign-in, check role for redirect
        if (session?.user) {
          const permissions = await getUserPermissions(session.user.email);
          if (permissions.role === 'sga') {
            router.push('/dashboard/sga-hub');
          } else if (permissions.role === 'recruiter') {
            router.push('/dashboard/recruiter-hub');
          } else {
            router.push('/dashboard');
          }
        }
        ```
      - This ensures recruiters land directly on their dedicated page.
   ```

---

## SECTION 3: Data & Logic Updates

### 3.1 Next_Steps__c / NextStep in Record Detail Modal — FINALIZED

**Decision:** Yes, add these fields to RecordDetailModal. Phase C is REQUIRED (not optional).

**Update required:**

1. In **Section 7, Phase C**, change header from "Phase C: Record Detail (Optional Enhancement)" to:
   ```markdown
   ### Phase C: Record Detail Enhancement (REQUIRED)
   ```

2. Update the description:
   ```markdown
   7. **Record detail query & type (REQUIRED)**
      - In `src/lib/queries/record-detail.ts`: Add `Next_Steps__c` and `NextStep` to the SELECT
      - In `src/types/record-detail.ts`: Add to `RecordDetailRaw` and `RecordDetailFull`:
        ```typescript
        nextSteps: string | null;      // From Lead.Next_Steps__c
        opportunityNextStep: string | null;  // From Opportunity.NextStep
        ```
      - In `transformToRecordDetail`: Map the new fields
      - In `RecordDetailModal`: Display these fields in an appropriate section
        (e.g., under "Activity" or new "Next Steps" section)
   ```

3. In **Section 10 (Open / Clarification Points)**, remove the bullet about RecordDetailModal displaying Next_Steps__c / NextStep — this is now decided.

---

### 3.2 BigQuery View Deployment via MCP — FINALIZED

**Decision:** Cursor.ai should use MCP to deploy the vw_funnel_master.sql changes directly.

**Update required:**

1. In **Section 7, Phase B, Step 6**, add deployment instructions:

   ```markdown
   6. **vw_funnel_master view update**
      
      **File changes** in `views/vw_funnel_master.sql`:
      - Lead_Base CTE: Add `Next_Steps__c AS Lead_Next_Steps__c`
      - Opp_Base CTE: Add `NextStep AS Opp_NextStep`
      - Combined CTE: Add `l.Lead_Next_Steps__c AS Next_Steps__c`, `o.Opp_NextStep AS NextStep`
      - Final CTE: Pass through `Next_Steps__c` and `NextStep`
      
      **Deployment via MCP (Cursor.ai):**
      
      After editing the SQL file, deploy to BigQuery using MCP:
      
      ```sql
      CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` AS
      -- [paste the entire updated SQL here]
      ```
      
      **Verification query after deployment:**
      ```sql
      SELECT Next_Steps__c, NextStep 
      FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` 
      WHERE External_Agency__c IS NOT NULL 
      LIMIT 5
      ```
      
      Confirm both columns exist and contain expected data.
   ```

---

### 3.3 Role Change — Clear External Agency — FINALIZED

**Decision:** Automatically clear `externalAgency` when role changes FROM recruiter to another role.

**Update required:**

1. In **Section 2.7 (Phase 6: Edge Cases)**, update Q39:

   ```markdown
   **Role change from recruiter (REQUIRED behavior):**
   
   When an admin changes a user's role FROM 'recruiter' TO any other role:
   - Automatically set `externalAgency` to `null` in the same database update
   - This prevents stale data and avoids confusion
   
   Implementation in `src/app/api/users/[id]/route.ts` (PUT handler):
   ```typescript
   // If role changed away from recruiter, clear externalAgency
   if (body.role !== 'recruiter' && existingUser.role === 'recruiter') {
     body.externalAgency = null;
   }
   ```
   ```

---

### 3.4 Empty State Message — FINALIZED

**Decision:** Show prompt to contact admin when no records found.

**Update required:**

1. Add a new subsection **Section 6.6 (Empty States)**:

   ```markdown
   ### 6.6 Empty States
   
   **When a recruiter's agency has zero prospects/opportunities:**
   
   Display a friendly empty state message:
   
   ```
   ┌─────────────────────────────────────────────────────────┐
   │                                                         │
   │     📋  No records found for [Agency Name]              │
   │                                                         │
   │     If you believe this is an error, please contact     │
   │     your administrator.                                 │
   │                                                         │
   └─────────────────────────────────────────────────────────┘
   ```
   
   **Implementation:**
   - Check if `records.length === 0` after API fetch
   - Display empty state component with agency name (from session/permissions)
   - Use existing empty state patterns from other dashboard components
   
   **For admins:** If ALL agency records are somehow empty (unlikely), show:
   "No prospects/opportunities with External Agency found."
   ```

---

## SECTION 4: Security Updates

### 4.1 Direct URL Protection — FINALIZED

**Decision:** Redirect unauthorized page access to Recruiter Hub (or appropriate default).

**Update required:**

1. In **Section 2.7 (Phase 6: Edge Cases)**, update Q40 with required implementation:

   ```markdown
   **Direct URL protection (REQUIRED):**
   
   If a recruiter types a URL directly (e.g., `/dashboard/pipeline`) for a page 
   not in their `allowedPages`, redirect them to their default page.
   
   **Implementation approach — Layout-level guard:**
   
   Create or update `src/app/dashboard/layout.tsx` to include page access checking:
   
   ```typescript
   // In dashboard layout (server component)
   const session = await getServerSession(authOptions);
   if (!session?.user?.email) {
     redirect('/login');
   }
   
   const permissions = await getUserPermissions(session.user.email);
   const pathname = headers().get('x-pathname') || '';
   
   // Map pathname to page ID
   const pageIdMap: Record<string, number> = {
     '/dashboard': 1,
     '/dashboard/pipeline': 3,
     '/dashboard/settings': 7,
     '/dashboard/sga-hub': 8,
     '/dashboard/sga-management': 9,
     '/dashboard/explore': 10,
     '/dashboard/recruiter-hub': 12,
   };
   
   const currentPageId = pageIdMap[pathname];
   
   // If page requires permission and user doesn't have it, redirect
   if (currentPageId && !permissions.allowedPages.includes(currentPageId)) {
     // Redirect to appropriate default based on role
     if (permissions.role === 'recruiter') {
       redirect('/dashboard/recruiter-hub');
     } else if (permissions.role === 'sga') {
       redirect('/dashboard/sga-hub');
     } else {
       redirect('/dashboard');
     }
   }
   ```
   
   **Alternative:** Each page can check its own access (current pattern for SGA Hub/Management).
   The layout-level approach is more centralized and harder to bypass.
   ```

---

## SECTION 5: Final Cleanup

### 5.1 Remove Resolved Open Points

In **Section 10 (Open / Clarification Points)**, remove or mark as resolved:

1. ~~"Exact allowedPages for recruiter"~~ → RESOLVED: [7, 12]
2. ~~"Whether Prospect table should include only lead rows..."~~ → Keep as-is (all rows with External_Agency__c)
3. ~~"Whether RecordDetailModal should display Next_Steps__c / NextStep"~~ → RESOLVED: Yes

Update Section 10 to only contain any remaining open items (if any).

---

### 5.2 Add Decisions Summary Section

Add a new **Section 11: Finalized Product Decisions** at the end (before the Update Logs):

```markdown
## 11. Finalized Product Decisions

This section summarizes all product decisions made for the Recruiter Hub feature.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Recruiter allowedPages | [7, 12] only | Focus recruiters on their dedicated hub |
| Recruiter canExport | true | Allow recruiters to export their agency data |
| Google OAuth | Allow any provisioned user | Recruiters can use Google if pre-provisioned |
| Page layout | Stacked vertical | Prospects on top, Opportunities below |
| External Agency field | Dropdown + "Other" | Support existing and new agencies |
| Admin agency view | Sort + Filter | Admins can sort and optionally filter by agency |
| Filter panel state | Collapsed by default | Match existing patterns |
| Sidebar icon | Briefcase | Business/recruiting connotation |
| Login redirect | Yes, to /dashboard/recruiter-hub | Better UX for recruiters |
| Next Steps in modal | Yes (Phase C required) | Full visibility into record details |
| Role change behavior | Clear externalAgency | Prevent stale data |
| Empty state | "Contact admin" message | Helpful guidance for recruiters |
| Direct URL protection | Redirect to default | Secure page access |
```

---

## SECTION 6: Verification Checklist

After completing all updates, verify the document includes:

- [ ] Recruiter `allowedPages: [7, 12]` clearly stated
- [ ] Recruiter `canExport: true` clearly stated
- [ ] Google OAuth domain configuration instructions with console URL
- [ ] Stacked vertical layout specified
- [ ] External Agency dropdown + "Other" field specification
- [ ] Admin sort + filter for External Agency
- [ ] Collapsed filter panels by default
- [ ] Briefcase icon for sidebar
- [ ] Login redirect to /dashboard/recruiter-hub
- [ ] Phase C marked as REQUIRED (not optional)
- [ ] BigQuery deployment via MCP instructions
- [ ] Role change clears externalAgency
- [ ] Empty state message specification
- [ ] Direct URL protection implementation
- [ ] Section 10 cleaned up (no unresolved items)
- [ ] Section 11 (Decisions Summary) added

---

## Final Output

Once all updates are complete, the `recruiter_hub_investigation.md` file should be:

1. **Complete** — All decisions documented, no ambiguous "TBD" items
2. **Actionable** — An agent can follow the implementation phases without asking questions
3. **Accurate** — All file paths, column names, and patterns verified
4. **Organized** — Clear sections with the new decisions integrated naturally

Save the file and confirm completion.
