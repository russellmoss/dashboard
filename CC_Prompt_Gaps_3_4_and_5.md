# Claude Code Prompt — Fill Investigation Gaps 3, 4 & 5

Copy and paste this entire block into Claude Code as your prompt.

---

## PROMPT START

You are updating an existing codebase investigation document with findings for three gaps that were missed in the first pass. The document is located at:

```
C:\Users\russe\Documents\Dashboard\GC_Hub_Codebase_Investigation_COMPLETED.md
```

**PREREQUISITE:** This prompt assumes Addendum A (Gaps 1 & 2) has already been added to the document. If it hasn't, that's fine — just add this as the next addendum section.

**YOUR JOB:** Answer each gap question below by reading the ACTUAL source files in this repository. Then **append your findings to the investigation document** (before the `## Investigation Complete` section, after any existing Addendum A), in a new section called `## Addendum B: Gaps 3, 4 & 5 — UI, Credentials & UX Decisions`. Use the EXACT same format already used throughout the document.

**CRITICAL RULES (same as original investigation):**

1. **NEVER answer from memory or training data.** Every finding must come from reading the actual file using `cat`, `grep`, `find`, or file reading tools. If a file doesn't exist, say "FILE NOT FOUND" — do not guess.
2. **NEVER paraphrase code.** Paste the EXACT code from the file with file path and line numbers.
3. **Show your work.** For every finding include: the exact command you ran, the file path + line numbers, and the verbatim code snippet.

---

## GAP 3: UserModal.tsx Role Dropdown

**Context:** The original investigation (section 1.6) mentions "Would be in `src/components/settings/UserModal.tsx` (needs to add `capital_partner` option)" but never pasted the actual dropdown code. If the role dropdown is a hardcoded array of strings with display labels, we need the EXACT code to write the correct Cursor prompt for adding `capital_partner`. We also need to know if there are any conditional fields that appear based on role selection (like `externalAgency` appearing when `recruiter` is selected), because `capital_partner` may need a similar conditional field (e.g., `capitalPartnerCompany`).

**Execute these steps in order:**

### Gap 3.1 — Find and paste the role dropdown/select in UserModal.tsx

Run:
```bash
cat -n src/components/settings/UserModal.tsx
```

Paste the **COMPLETE file**. Yes, the whole thing — it's a modal component and we need to see:
- The role selection element (dropdown, select, radio buttons — whatever it is)
- The hardcoded role options array (e.g., `['admin', 'manager', 'sgm', ...]` or `[{value: 'admin', label: 'Admin'}, ...]`)
- Any conditional fields that show/hide based on role (e.g., `externalAgency` input appearing only when `role === 'recruiter'`)
- The form submission handler and what fields it sends to the API
- Any validation logic on the role field

If the file is very long (300+ lines), paste it anyway. We need every detail.

### Gap 3.2 — Check for role display labels elsewhere

Sometimes the role labels shown to users ("RevOps Admin" for `revops_admin`) are defined in a utility function rather than inline. Search:

```bash
grep -rn "RevOps\|revops_admin\|role.*label\|role.*display\|formatRole\|roleLabel\|ROLE_LABELS\|ROLE_OPTIONS" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".next"
```

If there's a role label mapping anywhere, paste it. We need to know what display name `capital_partner` should get (e.g., "Capital Partner", "GC Partner", etc.).

### Gap 3.3 — Check for role validation on the Settings page

The Settings page renders the user management table and the modal. Check if there's any role filtering or validation in the Settings page component itself:

```bash
grep -n "role\|Role\|UserModal" src/app/dashboard/settings/ -r --include="*.ts" --include="*.tsx"
```

And if there's a settings content component:
```bash
ls src/app/dashboard/settings/
```
```bash
ls src/components/settings/
```

List all files so we know the full settings surface area.

---

## GAP 4: Google Sheets Service Account Email

**Context:** The original investigation (section 4.4) says "Share the Revenue Estimates spreadsheet with the service account email (found in credentials JSON as `client_email`)" but didn't retrieve the actual email. We now know the service account email is:

```
sheet-436@savvy-pirate-extension.iam.gserviceaccount.com
```

And we know the Revenue Estimates workbook (`1-6cBC1V2H7V-DrzpkII2qPshJyzriWpfjS80VEnPWq4`) is ALREADY shared with this service account.

**Execute these steps to verify and document:**

### Gap 4.1 — Verify the service account email in the codebase

We can't read the actual credentials JSON (it's in env vars / secret files), but we can verify the project ID matches. Run:

```bash
grep -rn "savvy-pirate-extension\|sheet-436" src/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.env*"
```

And check the env example:
```bash
grep -n "GOOGLE_SHEETS\|service.account\|client_email\|project_id" .env.example
```

Also check if there's a local service account key file referenced:
```bash
ls -la *.json | grep -i service
ls -la google-sheets*.json 2>/dev/null
ls -la service-account*.json 2>/dev/null
```

### Gap 4.2 — Verify the Sheets exporter can read (not just write)

The existing `google-sheets-exporter.ts` uses scope `https://www.googleapis.com/auth/spreadsheets` (full read/write). Verify this by running:

```bash
grep -n "scopes\|googleapis.com/auth" src/lib/sheets/google-sheets-exporter.ts
```

Document whether the existing scope grants read access (it does — full `spreadsheets` scope includes read). This means the GC Hub sync can reuse the same auth client without requesting additional scopes.

### Gap 4.3 — Check if the Billing Frequency workbook needs sharing too

The data exploration doc notes that the Billing Frequency & Style workbook (`1JdAxt4ceY8PFMWGERK5IM2xOCXcQy-oQarlCbWI9UhU`) returned "PERMISSION DENIED" during exploration. This workbook contains per-advisor billing metadata needed for the advisor dimension table.

Document this as an **action item**: The Billing Frequency workbook must also be shared with `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com` (Viewer access) before the ETL can pull billing metadata. Record this in the finding.

### Gap 4.4 — List all workbooks that need service account access

Create a clear checklist documenting the sharing status of every workbook the GC Hub needs:

| Workbook | Spreadsheet ID | Shared with Service Account? | Access Needed |
|---|---|---|---|
| Revenue Estimates (2026+) | `1-6cBC1V2H7V-...` | ✅ YES (already shared) | Read (live sync) |
| Advisor Payouts Tracker | `1nwovNkfJw8MZ...` | ??? | Read (one-time ETL) |
| Q3 2025 Payouts | `18J5UqxhIIxVx...` | ??? | Read (one-time ETL) |
| Q4 2025 Payroll Summary | `1mEFirIgl9iwr...` | ??? | Read (one-time ETL) |
| Billing Freq & Style | `1JdAxt4ceY8PF...` | ❌ NO (permission denied in exploration) | Read (one-time ETL) |

For the historical workbooks, we accessed them via MCP during exploration, but the dashboard service account is a different credential. We can't test access from Claude Code, so document each as "NEEDS VERIFICATION — share with `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com` if not already shared."

---

## GAP 5: UI/UX Decision Framework (Not Codebase — Architecture Recommendation)

**Context:** Alice has not yet provided UI/UX decisions for the GC Hub. The scoping document says what DATA to show but not HOW to show it. Rather than leaving this as a blank gap, we should document what the existing codebase patterns support so we can present Alice with concrete options grounded in what's already built, rather than open-ended questions.

**This gap is different from the others — it's about analyzing existing UI patterns to create a decision menu, not finding a specific file.**

**Execute these steps:**

### Gap 5.1 — Catalog all existing dashboard page layouts

For each of these pages, open the main content component and note the high-level layout pattern (KPI cards → chart → table? tabs → content? etc.):

```bash
head -50 src/app/dashboard/page.tsx
```

```bash
head -100 src/components/dashboard/DashboardContent.tsx 2>/dev/null || echo "No DashboardContent.tsx"
```

```bash
head -80 src/app/dashboard/sga-hub/SGAHubContent.tsx 2>/dev/null || echo "Check actual path"
```

```bash
ls src/app/dashboard/sga-hub/
```

```bash
head -60 src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx
```

For each page, document the layout pattern:
- **Funnel Performance (page 1):** [scorecards on top? → chart? → table?]
- **SGA Hub (page 8):** [tabs → tab content?]
- **Recruiter Hub (page 12):** [filter panel → table → table?]

### Gap 5.2 — Catalog existing drill-down patterns

Search for how drill-downs work across the app:

```bash
grep -rn "DrillDown\|drillDown\|drill-down\|RecordDetail\|setSelected.*Id\|onClick.*detail" src/components/ --include="*.tsx" | head -30
```

```bash
ls src/components/dashboard/RecordDetailModal.tsx 2>/dev/null && head -40 src/components/dashboard/RecordDetailModal.tsx
```

```bash
ls src/components/sga-hub/MetricDrillDownModal.tsx 2>/dev/null && head -40 src/components/sga-hub/MetricDrillDownModal.tsx
```

Document which drill-down styles exist:
- Modal overlay (like RecordDetailModal)?
- Expandable row?
- Separate page navigation?
- Click metric card → filtered table?

### Gap 5.3 — Catalog existing time period controls

Search for how time ranges are selected:

```bash
grep -rn "DateRange\|dateRange\|period\|quarter\|timePeriod\|timeRange\|DatePicker\|month.*select\|year.*select" src/components/ --include="*.tsx" | head -30
```

```bash
grep -rn "filterDate\|startDate\|endDate\|selectedPeriod\|selectedQuarter" src/components/dashboard/ --include="*.tsx" | head -20
```

Document what time controls exist:
- Dropdown with preset periods?
- Date range picker?
- Quarter selector?
- Monthly toggle?

### Gap 5.4 — Write the UI/UX Decision Menu for Alice

Based on your findings from 5.1–5.3, write a structured "Decision Menu" section that presents Alice with concrete options. Format it as a decision matrix — for each decision, show 2-3 options with the tradeoff and which existing pattern it follows. Example format:

```markdown
### Decision 1: GC Hub Home Page Layout

**Option A: Scorecard Row + Chart + Table** (follows Funnel Performance pattern)
- KPI cards across the top (Total Revenue, Total Commissions, Total Amount Earned, Active Advisors)
- Revenue trend chart below
- Advisor summary table at bottom
- PRO: Familiar layout, proven pattern
- CON: May be too data-heavy for Capital Partner view

**Option B: Tabs with Focused Views** (follows SGA Hub pattern)
- Tab 1: Portfolio Overview (KPIs + chart)
- Tab 2: Advisor Detail (searchable/sortable table)
- Tab 3: Period Comparison (side-by-side quarters)
- PRO: Organized, less overwhelming
- CON: More clicks to find data

**Option C: Single Scrolling Page** (follows Recruiter Hub pattern)
- All content on one page, vertically stacked
- PRO: Everything visible, simple
- CON: Long scroll, harder to navigate

**RECOMMENDATION:** Option B — tabs provide clean separation between Capital Partner view (Portfolio Overview only) and Admin view (all tabs). The anonymization boundary maps cleanly to tab visibility.
```

Cover these decisions:
1. **Home page layout** (scorecard + chart + table vs. tabs vs. single scroll)
2. **Drill-down style** (modal vs. expandable row vs. separate page)
3. **Chart types** (line chart for trends, bar chart for comparisons, or both?)
4. **Time period controls** (dropdown, date picker, or period tabs?)
5. **Capital Partner vs Admin view** (same page with hidden elements, or separate component?)
6. **Mobile responsiveness** (required? existing pages mobile-ready?)

For each, ground the options in the existing codebase patterns you found — don't propose anything the codebase doesn't already have a pattern for.

---

## OUTPUT FORMAT & PLACEMENT

1. **Insert** a new section called `## Addendum B: Gaps 3, 4 & 5 — UI, Credentials & UX Decisions` — place it BEFORE `## Investigation Complete` (and after Addendum A if it exists).

2. Format each finding identically to the existing document style (headings, code blocks, interpretation).

3. After writing the addendum, go back to the ORIGINAL sections and add cross-reference notes:
   - Section **1.6** (User Creation Flow): `> ⚠️ **ADDENDUM:** See Gap 3.1 in Addendum B for the actual UserModal role dropdown code.`
   - Section **4.4** (Service Account Permissions): `> ⚠️ **ADDENDUM:** Service account email confirmed as sheet-436@savvy-pirate-extension.iam.gserviceaccount.com — see Gap 4.x in Addendum B for full workbook access checklist.`

4. In the **Key Findings Summary** at the bottom, add a new bullet section:

```markdown
**UI/UX Patterns (Addendum B):**
- UserModal role dropdown: [summary of what you found]
- Service account: `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com`
- Workbook access: [X of 5 confirmed, Y need sharing]
- UI/UX Decision Menu: Ready for Alice review (6 decisions)
```

**BEGIN.** Start with Gap 3.1 — run `cat -n src/components/settings/UserModal.tsx` right now.

## PROMPT END
