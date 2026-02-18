# Guide 2: Husky + Pre-commit Hook (Prompt Generator)

> **Purpose**: Install Husky for managed git hooks, then create a smart pre-commit hook that detects doc-relevant code changes, categorizes them by impact type, and generates a ready-to-paste Claude Code prompt telling it exactly what documentation to update.
> **Prerequisites**: Guide 0 (bulk doc update) and Guide 1 (generated inventories + standing instructions) complete and committed.
> **Date**: 2026-02-18
> **Estimated Time**: ~1.5-2 hours in one Claude Code session

---

## ⚠️ IMPORTANT: Windows Environment

This project runs on **Windows (win32)**. All commands use **PowerShell syntax**. Do NOT use `grep`, `ls -la`, `head`, `wc -l`, `find` (Unix), or other Linux-only commands.

---

## What We're Building

### Husky Setup
Husky manages git hooks so they travel with the repo (unlike raw `.git/hooks/` which is local-only). We install it as a dev dependency and configure it to run our pre-commit script.

### Pre-commit Hook (The Smart Part)
When you run `git commit`, the hook:

1. **Reads your staged files** (`git diff --cached --name-only`)
2. **Categorizes changes** by impact type:
   - API routes (`src/app/api/*/route.ts`)
   - Page routes (`src/app/*/page.tsx`)
   - Prisma schema (`prisma/schema.prisma`)
   - Environment variables (`.env.example`)
   - Permissions (`src/lib/permissions.ts`)
   - Semantic layer (`src/lib/semantic-layer/`)
   - Config constants (`src/config/constants.ts`)
   - Auth logic (`src/app/api/auth/`)
3. **Checks if you also touched docs** (`docs/`, `.cursorrules`, or `docs/_generated/`)
4. **If doc-relevant code changed without doc updates**, it:
   - Prints a categorized summary of what changed
   - Generates a ready-to-paste Claude Code prompt with exact file paths and instructions
   - Also reminds you to run the relevant `npm run gen:*` commands
   - Exits with code 0 (warning, NOT blocking)

### Flow After This Guide
```
You commit code → Hook detects "3 API routes changed, schema changed"
→ Prints: "⚠️ Doc-relevant changes detected without doc updates"
→ Prints: Ready-to-paste Claude Code prompt
→ You paste prompt into Claude Code → Docs get updated → You commit the doc update
```

---

## How to Use This Guide

1. Open Claude Code in your project root (`C:\Users\russe\Documents\Dashboard`)
2. Copy-paste each **PHASE PROMPT** one at a time
3. After each phase, Claude Code runs verification and reports results
4. Do NOT skip phases — each builds on the previous

---

## PHASE 1: Install Husky + Initialize

### Prompt

```
You are implementing Guide 2, Phase 1: Install Husky and initialize git hooks.

⚠️ RULES:
- Windows environment. PowerShell only. No Unix commands.
- Read files BEFORE modifying them.
- Do NOT modify any existing source code (.ts, .tsx files).
- The only files you will modify are package.json (adding devDependency + prepare script) and creating the .husky/ directory structure.

**Step 1.1** — Read `package.json` in full. Record:
- Current devDependencies (list them)
- Current "scripts" section (list all scripts)
- Confirm Guide 1 scripts exist: gen:api-routes, gen:models, gen:env, gen:all
- Confirm there is NO existing "prepare" script
- Confirm there is NO existing Husky reference

**Step 1.2** — Install Husky as a dev dependency:
```powershell
npm install -D husky
```
Wait for it to complete. Confirm it installed by checking:
```powershell
npm ls husky
```

**Step 1.3** — Initialize Husky:
```powershell
npx husky init
```
This should:
- Create the `.husky/` directory
- Create a sample `.husky/pre-commit` file
- Add a `"prepare": "husky"` script to package.json

Verify all three happened:
```powershell
Test-Path .husky
Get-ChildItem .husky/
Get-Content package.json | Select-String "prepare"
```

**Step 1.4** — Read the default pre-commit hook that Husky created:
```powershell
Get-Content .husky/pre-commit
```
Record what's in it (usually just `npm test`). We will REPLACE this content in Phase 2.

**Step 1.5** — Verify nothing else changed unexpectedly:
```powershell
git diff --name-only
```
Should show:
- `package.json` (modified — new devDependency + prepare script)
- `package-lock.json` (modified — dependency lock)
- `.husky/pre-commit` (new)

If any source files (.ts, .tsx) appear, something went wrong.

Report: "Phase 1 complete. Husky [version] installed. .husky/ directory created. Default pre-commit hook exists. Prepare script added to package.json."
```

### Expected Outcome
- Husky installed as devDependency
- `.husky/` directory exists with default pre-commit file
- `"prepare": "husky"` script in package.json
- No source code modified

---

## PHASE 2: Create the Smart Pre-commit Hook Script

### Prompt

```
You are implementing Guide 2, Phase 2: Create the smart pre-commit hook script.

⚠️ RULES:
- Windows environment. PowerShell only.
- Read files BEFORE writing.
- Do NOT modify any existing source code.
- This script must work cross-platform (git hooks run in sh/bash on Windows Git Bash, NOT PowerShell). The hook file itself uses shell syntax, but we'll write the logic in a Node.js script that the hook calls.

**IMPORTANT ARCHITECTURE DECISION:**
Git hooks run in a minimal shell environment (Git Bash on Windows). Writing complex logic directly in shell is fragile, especially on Windows. Instead, we'll use a two-file approach:
1. `.husky/pre-commit` — A thin shell script that calls the Node.js script
2. `scripts/pre-commit-doc-check.js` — The actual logic in Node.js (reliable, cross-platform)

**Step 2.1** — Read these files to understand the doc mapping (from Guide 1):
- Read `.cursorrules` — find the "Documentation Maintenance — Standing Instructions" section. Note the lookup table mapping code paths to doc targets.
- Read `scripts/generate-api-inventory.cjs` (first 20 lines — confirm it exists and get the path pattern)
- Run: `Get-ChildItem -Path src/app/api -Recurse -Filter "route.ts" | Select-Object FullName | Measure-Object` — record route count
- Run: `Get-ChildItem -Path src/app -Recurse -Filter "page.tsx" -Depth 2 | Select-Object FullName | Measure-Object` — record page count

**Step 2.2** — Create `scripts/pre-commit-doc-check.js`:

This script must:

1. Run `git diff --cached --name-only` to get staged files (use `child_process.execSync`)
2. Categorize each staged file into impact types:

   | Pattern | Category | Doc Target | Gen Command |
   |---------|----------|------------|-------------|
   | `src/app/api/*/route.ts` | API Route | ARCHITECTURE.md (feature section) | `npm run gen:api-routes` |
   | `src/app/*/page.tsx` (depth 2-3) | Page Route | ARCHITECTURE.md Section 5 | — |
   | `prisma/schema.prisma` | Prisma Schema | ARCHITECTURE.md (models section) | `npm run gen:models` |
   | `.env.example` | Env Vars | ARCHITECTURE.md Section 10 | `npm run gen:env` |
   | `src/lib/permissions.ts` | Permissions | ARCHITECTURE.md Section 5 | — |
   | `src/lib/semantic-layer/` | Semantic Layer | ARCHITECTURE.md Section 7 | — |
   | `src/config/constants.ts` | Config | Relevant section referencing constants | — |
   | `src/app/api/auth/` | Auth | ARCHITECTURE.md Section 5 | — |

3. Check if any doc files were also staged:
   - `docs/ARCHITECTURE.md`
   - `docs/_generated/*`
   - `.cursorrules`
   - Any file in `docs/`

4. If doc-relevant code changed AND no doc files were staged:
   a. Print a clear warning header:
      ```
      ⚠️  Documentation may need updating
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      ```
   b. Print categorized changes:
      ```
      Changed:
        📁 API Routes (3 files):
           - src/app/api/funnel/route.ts
           - src/app/api/gc-hub/advisors/route.ts
           - src/app/api/gc-hub/filters/route.ts
        📁 Prisma Schema:
           - prisma/schema.prisma
      ```
   c. Print which gen commands to run:
      ```
      Run these inventory commands:
        npm run gen:api-routes
        npm run gen:models
      ```
   d. Print a ready-to-paste Claude Code prompt:
      ```
      ┌─────────────────────────────────────────────┐
      │  Claude Code Prompt (copy-paste this):       │
      └─────────────────────────────────────────────┘

      The following files were changed and documentation may need updating.
      Read each changed file listed below, then update docs/ARCHITECTURE.md accordingly.

      Changed API routes:
      - Read src/app/api/funnel/route.ts — update the Funnel section
      - Read src/app/api/gc-hub/advisors/route.ts — update the GC Hub section
      - Read src/app/api/gc-hub/filters/route.ts — update the GC Hub section

      Changed schema:
      - Read prisma/schema.prisma — check if any models were added/removed/renamed. Update the models section.

      After updating ARCHITECTURE.md, run:
      npm run gen:api-routes
      npm run gen:models

      Rules:
      - Read each file BEFORE updating docs
      - Match the existing format in ARCHITECTURE.md
      - Do NOT modify any source code files
      ```

5. Always exit with code 0 (non-blocking). The hook is a REMINDER, not a gate.

6. If doc-relevant code changed BUT doc files WERE also staged, print a brief positive note:
   ```
   ✓ Doc-relevant changes detected — docs also updated. Nice!
   ```

7. If no doc-relevant files changed at all, print nothing (silent pass).

**IMPORTANT DETAILS FOR THE SCRIPT:**
- Use `require('child_process').execSync` to run git commands
- Use `process.stderr.write()` for output (NOT console.log — git hooks should write to stderr for warnings)
- The feature area for an API route is derived from the path: `src/app/api/gc-hub/advisors/route.ts` → feature = "gc-hub" → section title = "GC Hub"
- Convert kebab-case feature names to Title Case for the prompt (e.g., "dashboard-requests" → "Dashboard Requests")
- Handle the case where `git diff --cached --name-only` returns empty (nothing staged)
- Handle the case where the script is run outside a git repo (graceful error, exit 0)

**Step 2.3** — Create the thin shell hook at `.husky/pre-commit`:

Replace the default Husky pre-commit content with:
```sh
node scripts/pre-commit-doc-check.js
```

That's it — one line. All logic lives in the Node.js script.

**Step 2.4** — Verify the script runs without errors (dry run):
```powershell
node scripts/pre-commit-doc-check.js
```
It should either print nothing (no staged files) or print the warning (if you have staged files). It should NOT crash.

Report: "Phase 2 complete. Pre-commit hook script created at scripts/pre-commit-doc-check.js ([X] lines). Husky pre-commit updated to call it. Dry run: [result]."
```

### Expected Outcome
- `scripts/pre-commit-doc-check.js` exists with full categorization and prompt generation logic
- `.husky/pre-commit` calls the Node.js script
- Dry run completes without errors

---

## PHASE 3: Test the Hook with Simulated Changes

### Prompt

```
You are implementing Guide 2, Phase 3: Test the pre-commit hook with real git operations.

⚠️ RULES:
- Windows environment. PowerShell only.
- Do NOT modify any existing source code permanently. We will create temporary test files and revert them.
- Be extremely careful with git operations — we're testing the hook, not making real changes.

**Step 3.1** — Test Case 1: No doc-relevant changes (should be silent)

Create a harmless temporary file, stage it, and verify the hook stays silent:
```powershell
# Create a temp file
"test" | Out-File -FilePath temp-test-file.txt
git add temp-test-file.txt

# Run the hook manually
node scripts/pre-commit-doc-check.js

# Clean up
git reset HEAD temp-test-file.txt
Remove-Item temp-test-file.txt
```
Expected: No output (silent pass).

**Step 3.2** — Test Case 2: API route change without doc update (should warn + generate prompt)

We need to simulate a staged API route change WITHOUT actually modifying the file. The safest way:
```powershell
# Touch an API route file (add a blank line at end, then we'll revert)
Add-Content -Path "src/app/api/funnel/route.ts" -Value ""
git add src/app/api/funnel/route.ts

# Run the hook manually
node scripts/pre-commit-doc-check.js

# IMPORTANT: Revert immediately
git reset HEAD src/app/api/funnel/route.ts
git checkout -- src/app/api/funnel/route.ts
```
Expected: Warning with "API Routes" category, mentions funnel, suggests `npm run gen:api-routes`, includes Claude Code prompt.

Capture and record the FULL output of the hook.

**Step 3.3** — Test Case 3: Multiple categories (API route + schema change)

```powershell
# Touch both files
Add-Content -Path "src/app/api/funnel/route.ts" -Value ""
Add-Content -Path "prisma/schema.prisma" -Value ""
git add src/app/api/funnel/route.ts prisma/schema.prisma

# Run the hook
node scripts/pre-commit-doc-check.js

# Revert
git reset HEAD src/app/api/funnel/route.ts prisma/schema.prisma
git checkout -- src/app/api/funnel/route.ts prisma/schema.prisma
```
Expected: Warning with BOTH "API Routes" and "Prisma Schema" categories. Claude Code prompt mentions both. Gen commands include both `gen:api-routes` and `gen:models`.

**Step 3.4** — Test Case 4: Doc-relevant change WITH doc update (should show positive note)

```powershell
# Touch an API route AND the architecture doc
Add-Content -Path "src/app/api/funnel/route.ts" -Value ""
Add-Content -Path "docs/ARCHITECTURE.md" -Value ""
git add src/app/api/funnel/route.ts docs/ARCHITECTURE.md

# Run the hook
node scripts/pre-commit-doc-check.js

# Revert
git reset HEAD src/app/api/funnel/route.ts docs/ARCHITECTURE.md
git checkout -- src/app/api/funnel/route.ts docs/ARCHITECTURE.md
```
Expected: Positive message like "✓ Doc-relevant changes detected — docs also updated."

**Step 3.5** — Test Case 5: Full commit cycle (hook runs automatically)

```powershell
# Create a harmless temp file
"test" | Out-File -FilePath temp-hook-test.txt
git add temp-hook-test.txt

# Do a real commit — the hook should run automatically
git commit -m "test: verify pre-commit hook runs"

# If it worked, revert the commit
git reset --soft HEAD~1
git reset HEAD temp-hook-test.txt
Remove-Item temp-hook-test.txt
```
Expected: Commit succeeds (hook exits 0). If temp file isn't doc-relevant, hook is silent.

**Step 3.6** — Verify the hook exit code is always 0:
After each test case above, check that the hook did NOT block the operation. The hook should NEVER prevent a commit.

Report each test case result:
```
Test Case 1 (no doc changes): [PASS/FAIL] — [what happened]
Test Case 2 (API route only): [PASS/FAIL] — [what happened]  
Test Case 3 (multi-category): [PASS/FAIL] — [what happened]
Test Case 4 (code + docs):    [PASS/FAIL] — [what happened]
Test Case 5 (full commit):    [PASS/FAIL] — [what happened]
```

If any test fails, fix the script and re-run that test before proceeding.

Report: "Phase 3 complete. All 5 test cases passed. Hook is warn-only (exit 0). No source code permanently modified."
```

### Expected Outcome
- All 5 test cases pass
- Hook warns correctly when doc-relevant code changes without doc updates
- Hook stays silent when no doc-relevant changes
- Hook shows positive note when docs are updated alongside code
- Hook never blocks commits (always exit 0)
- All test changes reverted cleanly

---

## PHASE 4: Edge Cases + Hardening

### Prompt

```
You are implementing Guide 2, Phase 4: Handle edge cases and harden the hook script.

⚠️ RULES:
- Windows environment. PowerShell only.
- Read `scripts/pre-commit-doc-check.js` BEFORE making any changes.
- Do NOT modify any source code files.

**Step 4.1** — Read `scripts/pre-commit-doc-check.js` in full. Review for these edge cases:

1. **Empty staging area**: What happens if `git diff --cached --name-only` returns nothing? Should print nothing and exit 0.

2. **Binary files in staging**: Some staged files might be images, PDFs, etc. The categorization should ignore anything that doesn't match a known pattern.

3. **Deleted files**: If a route file is deleted (git shows it as staged for deletion), the hook should still detect it. A deleted route still needs a doc update (removing it from docs).

4. **Renamed/moved files**: `git diff --cached --name-only` shows both old and new paths for renames. Both should be categorized.

5. **Multiple routes in same feature area**: If 5 files changed in `src/app/api/gc-hub/`, the prompt should group them under one "GC Hub" heading, not repeat the heading 5 times.

6. **Generated inventory files staged**: If someone stages `docs/_generated/api-routes.md`, that counts as a doc update (don't warn about API routes if the generated inventory is also staged).

7. **Script called outside git repo**: Should not crash. Check for `.git/` directory or catch the execSync error.

8. **Very large diffs**: If 50+ files are staged, the prompt should still be readable. Consider truncating the file list in the prompt if more than 15 files per category (show first 10 + "and X more").

**Step 4.2** — Fix any edge cases that aren't handled. For each fix:
- Describe what was missing
- Show what you changed
- Test the fix

**Step 4.3** — Add a `--verbose` flag for debugging:
If the script is called with `node scripts/pre-commit-doc-check.js --verbose`, it should print additional info:
- Total files staged
- How many matched each category
- Which files were ignored (didn't match any pattern)
This is useful when debugging why the hook isn't catching something.

In normal operation (called from the git hook without --verbose), it should print only the warning/prompt or nothing.

**Step 4.4** — Verify the script still passes all test cases from Phase 3:
Re-run Test Cases 1, 2, and 4 from Phase 3 (the quick ones) to confirm nothing broke.

Report: "Phase 4 complete. [X] edge cases addressed. Verbose mode added. All re-tests passed."
```

### Expected Outcome
- All edge cases handled gracefully
- `--verbose` flag works for debugging
- Existing test cases still pass
- Script is robust against unusual git states

---

## PHASE 5: Final Verification + Commit

### Prompt

```
You are implementing Guide 2, Phase 5: Final verification and preparation for commit.

**Step 5.1** — Verify the complete file inventory:
```powershell
Get-ChildItem .husky/ -Recurse
```
Should show `.husky/pre-commit` (and possibly `.husky/_/` internal Husky files).

```powershell
Test-Path scripts/pre-commit-doc-check.js
```
Should be True.

**Step 5.2** — Read `.husky/pre-commit` and confirm it contains ONLY the call to the Node.js script (one line: `node scripts/pre-commit-doc-check.js`).

**Step 5.3** — Read `scripts/pre-commit-doc-check.js` and report:
- Total line count
- Number of category patterns defined
- Confirm it exits with code 0 in all paths
- Confirm it uses `process.stderr.write()` for output (not console.log)

**Step 5.4** — Read `package.json` and confirm:
- `husky` is in devDependencies
- `"prepare": "husky"` is in scripts
- All Guide 1 gen:* scripts still present
- No other changes were made

**Step 5.5** — Verify no source code was modified:
```powershell
git diff --name-only
```
Should show ONLY:
- `package.json` (modified — husky dep + prepare script)
- `package-lock.json` (modified)
- `.husky/pre-commit` (new)
- `scripts/pre-commit-doc-check.js` (new)

If ANY `.ts`, `.tsx`, or other source files appear — revert them immediately.

**Step 5.6** — Run TypeScript compilation to confirm nothing broke:
```powershell
npx tsc --noEmit
```
Should produce the same results as before Guide 2 (zero new errors).

**Step 5.7** — One final end-to-end test:
```powershell
# Stage a real API route change
Add-Content -Path "src/app/api/funnel/route.ts" -Value ""
git add src/app/api/funnel/route.ts

# Commit — hook should fire, warn, but NOT block
git commit -m "test: end-to-end hook verification"

# Revert everything
git reset --soft HEAD~1
git reset HEAD src/app/api/funnel/route.ts
git checkout -- src/app/api/funnel/route.ts
```
Confirm: commit succeeded, hook printed warning, no permanent changes.

**Step 5.8** — Report final summary:

```
Guide 2 Complete:
- Husky version: [X]
- Pre-commit hook: .husky/pre-commit → scripts/pre-commit-doc-check.js
- Hook script: [X] lines
- Categories tracked: [list them]
- Behavior: warn-only (exit 0), never blocks commits
- Generated prompt: includes file paths, feature sections, gen commands
- Edge cases handled: [list them]
- Verbose mode: --verbose flag available
- Test results: [X/5] passed
- Source code modified: NONE
- TypeScript compilation: [PASS/FAIL]
- Ready for commit: [YES/NO]
```
```

### Expected Outcome
- All files in place
- Hook runs correctly end-to-end
- No source code modified
- TypeScript compilation clean
- Ready to commit

---

## Post-Completion Checklist

After Claude Code reports Guide 2 complete:

### Quick Scan
- [ ] Run `node scripts/pre-commit-doc-check.js --verbose` — does it show debug info?
- [ ] Stage a random non-doc file and commit — hook silent?
- [ ] Stage an API route file (add blank line) — hook warns?
- [ ] Check `.husky/pre-commit` — just one line calling the Node script?

### Verify No Source Code Changes
```powershell
git diff --name-only
```
Only `package.json`, `package-lock.json`, `.husky/`, and `scripts/pre-commit-doc-check.js` should appear.

### Commit
```powershell
git add package.json package-lock.json .husky/ scripts/pre-commit-doc-check.js
git commit -m "feat: add Husky pre-commit hook with doc-drift detection + prompt generator"
```

### Ready for Guide 3
Once committed, you're ready for **Guide 3: GitHub Actions (Doc Audit + Refactor Audit)**.

---

## Claude Code Execution Prompt

Copy-paste this into Claude Code to execute the full guide:

```
You are executing Guide 2: Husky + Pre-commit Hook.

Read the full implementation guide at:
C:\Users\russe\Documents\Dashboard\guide-2-husky-hook.md

Then read the exploration knowledge base for context:
C:\Users\russe\Documents\Dashboard\docs_maintenance_exploration.md

Then read the standing instructions you added in Guide 1:
Read .cursorrules — find the "Documentation Maintenance — Standing Instructions" section. This contains the lookup table the hook must mirror.

RULES — follow these strictly:
1. Read EVERY file mentioned in a phase BEFORE writing any code in that phase.
2. NEVER modify existing source code (.ts, .tsx files). You are creating: scripts/pre-commit-doc-check.js and .husky/pre-commit. You are modifying: package.json (Husky dep + prepare script only).
3. Windows environment — use PowerShell for all commands. No Unix commands.
4. The pre-commit hook file (.husky/pre-commit) uses shell syntax (it runs in Git Bash). The logic script (scripts/pre-commit-doc-check.js) uses Node.js CommonJS.
5. Work phase by phase (1 through 5). Complete each phase fully before starting the next.
6. Run ALL verification commands and test cases shown in each phase. If any fail, fix before moving on.
7. The hook must ALWAYS exit with code 0. It is a warning system, NOT a gate. It must NEVER block a commit.
8. Use process.stderr.write() for hook output, not console.log. Git hooks should write warnings to stderr.
9. After Phase 3 testing, revert ALL test changes. No source files should remain modified.

Begin with Phase 1 now.
```
