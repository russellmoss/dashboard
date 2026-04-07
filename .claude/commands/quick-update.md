---
name: quick-update
description: "Lightweight update workflow for small dashboard changes — add a column, tweak a filter, fix a calculation, update a query. No parallel agents, no council review. Use instead of /auto-feature when the change touches 1-5 files."
---

# /quick-update — Lightweight Dashboard Update

You are handling a small, scoped dashboard change. This is NOT a new feature — it's a targeted update to existing functionality. You do the investigation, planning, and (optionally) execution yourself in a single pass.

**Update request:** $ARGUMENTS

---

## RULES

1. Read the schema docs FIRST. Do not query BigQuery for things already documented.
2. Keep investigation focused — read only the files relevant to this change.
3. Do NOT spawn sub-agents. You handle everything sequentially.
4. Produce a scoped change plan, not a multi-phase implementation guide.
5. Ask the user before executing. Never auto-execute without confirmation.
6. If this turns out to be bigger than expected (>5 files, needs view changes, needs new types), STOP and recommend `/auto-feature` instead.

---

## STEP 1: SCHEMA CONTEXT

Read these files silently (do not summarize them to the user):
- `.claude/bq-views.md` — which views and query files are relevant
- `.claude/bq-field-dictionary.md` — field names, types, correct wrappers
- `.claude/bq-patterns.md` — canonical patterns to follow
- `.claude/bq-salesforce-mapping.md` — field lineage if touching SF fields

---

## STEP 2: SCOPE THE CHANGE

Based on the user's request and the schema docs, determine:

1. **What's changing?** (new column, filter tweak, calculation fix, query update, UI change)
2. **Which view(s) are involved?** (check bq-views.md for the consumer mapping)
3. **Which query file(s) need edits?** (usually 1-3 files)
4. **Which type(s) need updates?** (if adding a field to a return type)
5. **Are there construction sites?** (other files that build objects of the modified type)

### Scope Check — Is This Actually Small?

Count the files that need changes. If ANY of these are true, STOP and recommend `/auto-feature`:

- More than 5 files need code changes
- A BigQuery view needs to be modified (blocker — requires manual SQL change)
- A new TypeScript interface or type needs to be created (not just adding a field)
- The change affects both the main funnel AND the forecast page
- Multiple drill-down modals need updating
- A new API route is needed
- The Sheets export needs a new tab (not just a new column in an existing tab)

If the scope check passes, continue. If not, tell the user:

```
This is bigger than a quick update — it touches [N] files and [reason].
I'd recommend running `/auto-feature [their request]` instead for the full exploration + council review.
```

---

## STEP 3: INVESTIGATE

Read ONLY the files identified in Step 2. For each file:

1. **Read the current code** around the area that needs changing
2. **Identify the exact lines** to modify
3. **Check the pattern** — how do adjacent/similar fields handle the same thing? (date wrappers, NULL handling, type coercion)
4. **Check construction sites** — if you're adding a field to a type, grep for every file that constructs that type:
   ```bash
   grep -rn "TypeName" src/ --include="*.ts" --include="*.tsx" | grep -v "import\|from\|type \|interface " | head -30
   ```
5. **Verify field exists in BQ** — if adding a new field from BigQuery, confirm it exists:
   - First check `.claude/bq-field-dictionary.md`
   - Only query BQ if the field isn't documented: `SELECT column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'view_name' AND column_name = 'field_name'`

---

## STEP 4: PRODUCE CHANGE PLAN

Write a concise change plan directly in the conversation (NOT a separate file). Format:

```
## Quick Update Plan: [Title]

### What's Changing
[1-2 sentences]

### Files to Modify

**1. [file path]**
- [ ] [What to change — be specific: add field X to SELECT, update type Y, etc.]

**2. [file path]**
- [ ] [What to change]

[repeat for each file, usually 1-5]

### Pattern Notes
- [Any pattern to follow from bq-patterns.md]
- [Date wrapper to use, NULL handling approach, etc.]

### Validation
```bash
npm run build 2>&1 | tail -5
# Expected: Compiled successfully
```

### Scope: [N] files, estimated [time]
```

---

## STEP 5: CONFIRM AND EXECUTE

Present the plan and ask:

```
Quick update plan ready — [N] files to modify. 

Want me to:
1. Execute now (I'll make the changes and validate)
2. Just show me the plan (you'll do it manually or via /auto-feature)
```

### If the user says execute:

1. Make changes file by file
2. After each file, run a quick type check if relevant
3. After all changes, run the validation gate:
   ```bash
   npm run build 2>&1 | tail -20
   ```
4. If build passes, run `npx agent-guard sync` to update docs
5. Report results:
   ```
   ✅ Quick update complete.
   
   Changes made:
   - [file]: [what changed]
   - [file]: [what changed]
   
   Build: ✅ passing
   Docs: [synced / no doc-relevant changes detected]
   
   Recommend: verify in browser at [relevant URL/page]
   ```

### If the build fails after changes:

1. Read the error messages
2. If it's a missing construction site you missed, fix it
3. If it's something deeper, report:
   ```
   ⚠️ Build failed after changes. Error:
   [error]
   
   This might be bigger than a quick update. Options:
   1. I can try to fix this error (likely [diagnosis])
   2. Revert changes and run /auto-feature for full exploration
   ```

---

## STEP 6: POST-UPDATE

If changes were executed successfully:

1. Stage the changed files: `git add [files]`
2. Suggest a commit message:
   ```
   feat: [concise description of what changed]
   
   - [file1]: [what changed]
   - [file2]: [what changed]
   ```
3. Do NOT commit — let the user review and commit themselves

---

## WHAT THIS COMMAND IS FOR vs NOT FOR

### Good for /quick-update:
- Add a column to an existing detail table or drill-down
- Fix a calculation bug in a single query file
- Update a filter to include/exclude a value
- Add a field to an existing TypeScript type + the 2-3 construction sites
- Tweak a UI component's display logic
- Update a Salesforce field reference after a field rename
- Add a metric to the semantic layer definitions
- Fix a date wrapper (DATE vs TIMESTAMP) on a field
- Add a column to an existing Sheets export tab
- Update a constant (record type ID, stage list, threshold)

### Not for /quick-update (use /auto-feature):
- Adding a new page or tab to the dashboard
- Creating a new BigQuery view or modifying an existing one
- Adding a new data pipeline or sync
- Building a new drill-down modal
- Adding a new export tab to Google Sheets
- Any change that needs council review for business logic validation
- Changes spanning both the funnel and forecast systems
- Anything requiring more than 5 file changes
