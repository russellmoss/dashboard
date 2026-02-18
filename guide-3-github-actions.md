# Guide 3: GitHub Actions — Doc Audit + Refactor Audit

> **Purpose**: Create two GitHub Actions workflows — a change-triggered documentation drift audit and a weekly refactoring signals audit. Both create GitHub Issues with findings and pre-written Claude Code prompts for remediation.
> **Prerequisites**: Guide 0 (bulk doc update), Guide 1 (generated inventories + standing instructions), and Guide 2 (Husky + pre-commit hook) complete and committed.
> **Date**: 2026-02-18
> **Estimated Time**: ~2-3 hours in one Claude Code session

---

## ⚠️ IMPORTANT: Windows Environment

This project runs on **Windows (win32)**. All local commands use **PowerShell syntax**. The GitHub Actions workflows themselves run on `ubuntu-latest` (Linux) — shell commands inside YAML workflow files use bash.

---

## What We're Building

### Workflow 1: Documentation Drift Audit (`docs-audit.yml`)

**Trigger**: Pushes to `main` that touch doc-relevant paths:
- `src/app/api/**`
- `src/app/*/page.tsx`
- `prisma/schema.prisma`
- `.env.example`
- `src/lib/permissions.ts`
- `src/lib/semantic-layer/**`
- `src/config/constants.ts`

**What it does**:
1. Checks out the repo
2. Runs `npm run gen:all` to regenerate inventories from current code
3. Compares the regenerated inventories against the committed versions using `git diff`
4. If drift is detected (generated files differ from committed), creates a GitHub Issue with:
   - Which inventories drifted (routes, models, env vars)
   - The specific diffs
   - A ready-to-paste Claude Code prompt for fixing the drift

**Why change-triggered, not daily**: The exploration found that daily cron would create noise. Change-triggered means it only fires when someone pushes code that could cause new drift. If you always run `npm run gen:all` before committing (as the pre-commit hook reminds you), this Action will never fire.

### Workflow 2: Weekly Refactoring Audit (`refactor-audit.yml`)

**Trigger**: Cron schedule — every Sunday at 8:00 AM UTC

**What it does**:
1. Checks out the repo
2. Runs pure static analysis (no AI, no API keys):
   - Files over 500 lines (trending toward "god files")
   - New TODO/HACK comments since last audit
   - `npm audit` for dependency vulnerabilities
   - Dead exports (exported but never imported)
   - Files that grew significantly since last week
3. Creates a GitHub Issue with findings as a prioritized backlog item for sprint planning

**Why static analysis only**: No Anthropic API key needed. Deterministic, reproducible, zero cost. AI analysis can be added later if the static version isn't catching enough.

### Shared Infrastructure
Both workflows:
- Use `GITHUB_TOKEN` (built-in, no secrets to configure)
- Run on `ubuntu-latest`
- Create Issues in the same repo
- Use the same Node.js setup pattern
- Live in `.github/workflows/`

---

## How to Use This Guide

1. Open Claude Code in your project root (`C:\Users\russe\Documents\Dashboard`)
2. Copy-paste each **PHASE PROMPT** one at a time
3. After each phase, Claude Code runs verification and reports results
4. Do NOT skip phases — each builds on the previous

---

## PHASE 1: Create GitHub Actions Directory + Doc Audit Workflow

### Prompt

```
You are implementing Guide 3, Phase 1: Create the GitHub Actions infrastructure and the documentation drift audit workflow.

⚠️ RULES:
- You are creating files in .github/workflows/ ONLY. Do NOT modify any existing source code (.ts, .tsx files).
- The workflow YAML runs on ubuntu-latest (Linux). Shell commands INSIDE the YAML use bash syntax (grep, wc, diff, etc.).
- Local verification commands (run by you now) use PowerShell (Windows).
- Read files BEFORE writing to understand existing patterns.

**Step 1.1** — Verify prerequisites from Guides 0-2:
- Confirm `docs/ARCHITECTURE.md` exists and is substantial (1000+ lines)
- Confirm generated inventory scripts exist:
  Run: Get-ChildItem scripts/generate-*.cjs (or .js — note exact extension)
- Confirm npm scripts exist:
  Run: Get-Content package.json | Select-String "gen:"
- Record the exact npm script names and file extensions — the workflow must use these exactly.

**Step 1.2** — Create the directory structure:
```powershell
New-Item -ItemType Directory -Path ".github/workflows" -Force
```
Verify:
```powershell
Test-Path ".github/workflows"
```

**Step 1.3** — Create `.github/workflows/docs-audit.yml`:

```yaml
name: Documentation Drift Audit

on:
  push:
    branches: [main]
    paths:
      - 'src/app/api/**'
      - 'src/app/*/page.tsx'
      - 'src/app/dashboard/*/page.tsx'
      - 'prisma/schema.prisma'
      - '.env.example'
      - 'src/lib/permissions.ts'
      - 'src/lib/semantic-layer/**'
      - 'src/config/constants.ts'
      - 'src/app/api/auth/**'

permissions:
  contents: read
  issues: write

jobs:
  audit-docs:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Regenerate inventories from current code
        run: npm run gen:all

      - name: Check for inventory drift
        id: check-drift
        run: |
          DRIFT_FOUND=false
          DRIFT_DETAILS=""

          # Check if any generated files changed
          if ! git diff --quiet docs/_generated/api-routes.md 2>/dev/null; then
            DRIFT_FOUND=true
            DRIFT_DETAILS="${DRIFT_DETAILS}### API Routes Drift\n\`\`\`diff\n$(git diff docs/_generated/api-routes.md | head -80)\n\`\`\`\n\n"
          fi

          if ! git diff --quiet docs/_generated/prisma-models.md 2>/dev/null; then
            DRIFT_FOUND=true
            DRIFT_DETAILS="${DRIFT_DETAILS}### Prisma Models Drift\n\`\`\`diff\n$(git diff docs/_generated/prisma-models.md | head -80)\n\`\`\`\n\n"
          fi

          if ! git diff --quiet docs/_generated/env-vars.md 2>/dev/null; then
            DRIFT_FOUND=true
            DRIFT_DETAILS="${DRIFT_DETAILS}### Environment Variables Drift\n\`\`\`diff\n$(git diff docs/_generated/env-vars.md | head -80)\n\`\`\`\n\n"
          fi

          echo "drift_found=$DRIFT_FOUND" >> $GITHUB_OUTPUT

          if [ "$DRIFT_FOUND" = "true" ]; then
            # Write drift details to a temp file (avoids multiline output issues)
            printf "%b" "$DRIFT_DETAILS" > /tmp/drift-details.md
          fi

      - name: Count current inventory totals
        if: steps.check-drift.outputs.drift_found == 'true'
        id: counts
        run: |
          API_COUNT=$(grep -c "^|" docs/_generated/api-routes.md | tail -1 || echo "0")
          MODEL_COUNT=$(grep -c "^## " docs/_generated/prisma-models.md || echo "0")
          ENV_COUNT=$(grep -c "^|" docs/_generated/env-vars.md | tail -1 || echo "0")
          echo "api_count=$API_COUNT" >> $GITHUB_OUTPUT
          echo "model_count=$MODEL_COUNT" >> $GITHUB_OUTPUT
          echo "env_count=$ENV_COUNT" >> $GITHUB_OUTPUT

      - name: Create drift issue
        if: steps.check-drift.outputs.drift_found == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const driftDetails = fs.readFileSync('/tmp/drift-details.md', 'utf8');

            const issueBody = `## 📋 Documentation Drift Detected

            The generated inventory files no longer match the committed code. This means code was pushed to main without regenerating the inventories.

            **Triggered by**: Push to \`main\` by @${context.actor}
            **Commit**: ${context.sha.substring(0, 7)}

            ---

            ## Drift Details

            ${driftDetails}

            ---

            ## How to Fix

            ### Option A: Run inventory scripts (quick fix)
            \`\`\`powershell
            npm run gen:all
            git add docs/_generated/
            git commit -m "docs: regenerate inventories"
            git push
            \`\`\`

            ### Option B: Claude Code prompt (if ARCHITECTURE.md also needs updating)
            \`\`\`
            Documentation drift was detected after a push to main.

            1. Run: npm run gen:all
            2. Read the regenerated files in docs/_generated/ to understand what changed
            3. Update docs/ARCHITECTURE.md to reflect the new routes/models/env vars
            4. Follow the Documentation Maintenance standing instructions in .cursorrules

            Rules:
            - Read each changed file BEFORE updating docs
            - Match the existing format in ARCHITECTURE.md
            - Do NOT modify any source code files
            \`\`\`

            ---
            _This issue was created automatically by the Documentation Drift Audit workflow._
            `;

            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '📋 Documentation drift detected — inventories out of sync',
              body: issueBody,
              labels: ['documentation', 'automated-audit']
            });
```

**IMPORTANT**: The YAML above is a starting template. Before writing it to disk, verify:
- The npm script names match exactly (check if it's `gen:all` or something else in package.json)
- The generated file paths match exactly (check if they're in `docs/_generated/` with the exact filenames from Guide 1)
- The checkout and Node.js setup use current action versions (v4 for both)

Adjust the YAML as needed based on what you find in the actual repo.

**Step 1.4** — Validate the YAML syntax locally:
There's no built-in YAML linter, but check for obvious issues:
```powershell
Get-Content ".github/workflows/docs-audit.yml" | Select-String "^\s*-\s" | Measure-Object
```
(Just confirms the file has content and YAML list items)

Read the file back and visually verify:
- Indentation is consistent (2 spaces, standard for GitHub Actions)
- All `${{ }}` expressions are properly closed
- The `run: |` blocks use correct multiline syntax
- The `actions/github-script` block has valid JavaScript

**Step 1.5** — Verify no source code was modified:
```powershell
git diff --name-only
```
Should show ONLY `.github/workflows/docs-audit.yml` (new file).

Report: "Phase 1 complete. Created .github/workflows/docs-audit.yml. Triggers on pushes to main touching [X] path patterns. Creates issues with drift diffs and Claude Code remediation prompts. No source code modified."
```

### Expected Outcome
- `.github/workflows/docs-audit.yml` exists with correct trigger paths
- Workflow checks out repo, runs gen:all, diffs against committed inventories
- Creates a GitHub Issue with drift details and remediation prompt
- Only uses `GITHUB_TOKEN` (no custom secrets needed)

---

## PHASE 2: Create Weekly Refactoring Audit Workflow

### Prompt

```
You are implementing Guide 3, Phase 2: Create the weekly refactoring signals audit workflow.

⚠️ RULES:
- You are creating ONE new file: .github/workflows/refactor-audit.yml
- Do NOT modify any existing source code.
- Do NOT modify the docs-audit.yml from Phase 1.
- Workflow runs on ubuntu-latest (bash). Local commands use PowerShell.

**Step 2.1** — Read the exploration doc to understand the refactoring baseline:
Read C:\Users\russe\Documents\Dashboard\docs_maintenance_exploration.md — find the Phase 6 findings. Record:
- How many files were over 400 lines? (baseline: 39)
- How many TODO comments existed? (baseline: 4)
- What npm audit issues existed? (baseline: 3 high-severity)
- Any dead exports? (baseline: 3 — INPUT_STYLES, BUTTON_STYLES, DEFAULT_YEAR)

These baselines are important — the weekly audit should flag NEW issues beyond these, not re-report known ones.

**Step 2.2** — Create `.github/workflows/refactor-audit.yml`:

The workflow should:

1. **Trigger**: Cron schedule `0 8 * * 0` (Sundays at 8:00 AM UTC) and manual dispatch (`workflow_dispatch` so you can test it)

2. **Job: audit-refactoring** running on `ubuntu-latest`

3. **Steps**:

   a. Checkout the repo

   b. Setup Node.js 20

   c. Install dependencies (`npm ci`)

   d. **Large files check** — Find all .ts/.tsx files over 500 lines:
      ```bash
      find src/ -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | awk '$1 > 500 {print $0}' > /tmp/large-files.txt
      LARGE_COUNT=$(wc -l < /tmp/large-files.txt)
      ```

   e. **TODO/HACK scan** — Count TODO and HACK comments:
      ```bash
      grep -rn "TODO\|HACK\|FIXME\|XXX" src/ --include="*.ts" --include="*.tsx" > /tmp/todos.txt
      TODO_COUNT=$(wc -l < /tmp/todos.txt)
      ```

   f. **npm audit** — Check for vulnerabilities:
      ```bash
      npm audit --production 2>/dev/null > /tmp/npm-audit.txt || true
      VULN_SUMMARY=$(npm audit --production 2>/dev/null | tail -5 || echo "Audit unavailable")
      ```

   g. **Dead exports scan** — Find exports that are never imported:
      This is the trickiest check. A lightweight approach:
      ```bash
      # Extract all named exports from src/config/ and src/lib/
      grep -rh "^export " src/config/ src/lib/ --include="*.ts" | \
        grep -oP "(?:const|function|class|type|interface|enum)\s+\K\w+" | \
        sort -u > /tmp/all-exports.txt

      # For each export, check if it's imported anywhere
      DEAD_EXPORTS=""
      while read -r name; do
        IMPORT_COUNT=$(grep -rl "$name" src/ --include="*.ts" --include="*.tsx" | wc -l)
        if [ "$IMPORT_COUNT" -le 1 ]; then
          DEAD_EXPORTS="${DEAD_EXPORTS}\n- \`${name}\` (only referenced in its own file)"
        fi
      done < /tmp/all-exports.txt
      ```
      NOTE: This is an approximation. It may have false positives (re-exports, dynamic usage). The issue should note this.

   h. **Create the issue** — Only if there are findings worth reporting. Use `actions/github-script@v7`:

      The issue body should include:
      - **📏 Large Files** section — list files over 500 lines with line counts
      - **📝 TODO/HACK Comments** section — list all with file:line references
      - **🔒 Dependency Vulnerabilities** section — npm audit summary
      - **♻️ Potential Dead Exports** section — list with caveat about false positives
      - **Baselines** section — compare against known baselines (39 large files, 4 TODOs, 3 vulns, 3 dead exports) and highlight what's NEW
      - **Claude Code Prompt** — a remediation prompt for the most actionable items

      Label the issue with `refactoring` and `automated-audit`.

      The issue title should include the date: `🔧 Weekly Refactoring Audit — YYYY-MM-DD`

4. **Skip issue creation if nothing changed from baseline**:
   Add logic to compare current counts against the baselines. If large files count is still 39, TODO count is still 4, etc. — don't create an issue (nothing new to report). Only create an issue if something got WORSE.

   Store baselines as environment variables at the top of the job:
   ```yaml
   env:
     BASELINE_LARGE_FILES: 39
     BASELINE_TODOS: 4
     BASELINE_VULNS: 3
     BASELINE_DEAD_EXPORTS: 3
   ```

**Step 2.3** — Read the workflow file back and verify:
- YAML indentation is consistent (2 spaces)
- Cron expression is valid: `0 8 * * 0`
- `workflow_dispatch` is included for manual testing
- Baseline comparison logic exists
- Issue creation uses `actions/github-script@v7`
- Only `GITHUB_TOKEN` is used (no custom secrets)

**Step 2.4** — Verify no source code was modified:
```powershell
git diff --name-only
```
Should show ONLY:
- `.github/workflows/docs-audit.yml` (from Phase 1)
- `.github/workflows/refactor-audit.yml` (new)

Report: "Phase 2 complete. Created .github/workflows/refactor-audit.yml. Runs Sundays at 8:00 AM UTC. Checks: large files, TODOs, npm audit, dead exports. Compares against baselines. Only creates issue if something got worse. No source code modified."
```

### Expected Outcome
- `.github/workflows/refactor-audit.yml` exists with correct cron trigger
- Static analysis checks for 4 refactoring signals
- Baseline comparison prevents noise from known issues
- Issue includes remediation Claude Code prompt
- Manual dispatch available for testing

---

## PHASE 3: Create Issue Labels + Verify Both Workflows

### Prompt

```
You are implementing Guide 3, Phase 3: Verify both workflows and prepare for commit.

⚠️ RULES:
- Do NOT modify any source code.
- Read both workflow files BEFORE verification.

**Step 3.1** — Read both workflow files in full:
- Read `.github/workflows/docs-audit.yml`
- Read `.github/workflows/refactor-audit.yml`

For each, verify:
- [ ] `permissions` block is present with `contents: read` and `issues: write`
- [ ] `actions/checkout@v4` is used
- [ ] `actions/setup-node@v4` with `node-version: '20'` is used
- [ ] `npm ci` is used (not `npm install` — ci is faster and more reliable in CI)
- [ ] Issue creation uses `actions/github-script@v7`
- [ ] Only `GITHUB_TOKEN` is referenced (no custom secrets)
- [ ] Labels referenced in issue creation (`documentation`, `automated-audit`, `refactoring`) are strings, not variables

Report any issues found and fix them.

**Step 3.2** — Verify the docs-audit trigger paths cover all doc-relevant code:
Cross-reference against the standing instructions in .cursorrules. Every category in the lookup table should have a matching trigger path in the workflow.

Read `.cursorrules` — find the Documentation Maintenance standing instructions lookup table.
Compare each row against the `paths:` list in docs-audit.yml:

| Standing Instruction Category | Expected Path Pattern | In Workflow? |
|---|----|---|
| API routes | `src/app/api/**` | ? |
| Page routes | `src/app/*/page.tsx` | ? |
| Prisma schema | `prisma/schema.prisma` | ? |
| Env vars | `.env.example` | ? |
| Permissions | `src/lib/permissions.ts` | ? |
| Semantic layer | `src/lib/semantic-layer/**` | ? |
| Config constants | `src/config/constants.ts` | ? |
| Auth logic | `src/app/api/auth/**` | ? |

If any are missing from the workflow, add them.

**Step 3.3** — Verify the refactor-audit baselines match the exploration findings:
Read the exploration doc Phase 6 findings. Confirm the baselines in the workflow match:
- Large files (>400 lines): 39 (but workflow checks >500 — that's fine, different threshold)
- TODOs: 4
- npm audit high-severity: 3
- Dead exports: 3

If the workflow baselines don't match, fix them.

**Step 3.4** — Dry-run test the inventory scripts to confirm they still work:
```powershell
npm run gen:all
```
Confirm all three complete without errors. This is what the docs-audit workflow will run.

**Step 3.5** — Check that generated files are committed (not gitignored):
```powershell
git ls-files docs/_generated/
```
Should list api-routes.md, prisma-models.md, env-vars.md. If they're not tracked, the diff check in the workflow won't work.

**Step 3.6** — Verify the complete file inventory for this guide:
```powershell
Get-ChildItem ".github/workflows/"
```
Should show exactly:
- `docs-audit.yml`
- `refactor-audit.yml`

**Step 3.7** — Verify no source code was modified:
```powershell
git diff --name-only
```
Should show ONLY:
- `.github/workflows/docs-audit.yml` (new)
- `.github/workflows/refactor-audit.yml` (new)

If ANY `.ts`, `.tsx`, or other source files appear — revert them immediately.

**Step 3.8** — Run TypeScript compilation to confirm nothing broke:
```powershell
npx tsc --noEmit
```
Should produce the same results as before Guide 3 (zero new errors).

**Step 3.9** — Report final summary:

```
Guide 3 Complete:

Workflow 1 — Documentation Drift Audit:
- File: .github/workflows/docs-audit.yml
- Trigger: push to main touching [X] path patterns
- Checks: regenerates inventories, diffs against committed versions
- Action: creates GitHub Issue with drift details + Claude Code prompt
- Secrets: GITHUB_TOKEN only (built-in)
- Trigger path coverage: [X/8] standing instruction categories covered

Workflow 2 — Weekly Refactoring Audit:
- File: .github/workflows/refactor-audit.yml
- Trigger: cron (Sundays 8 AM UTC) + manual dispatch
- Checks: large files, TODOs, npm audit, dead exports
- Baselines: [large files: X, TODOs: X, vulns: X, dead exports: X]
- Action: creates GitHub Issue ONLY if metrics worsen beyond baselines
- Secrets: GITHUB_TOKEN only (built-in)

Infrastructure:
- .github/workflows/ directory created (first time)
- No custom secrets required
- Source code modified: NONE
- TypeScript compilation: [PASS/FAIL]
- Ready for commit: [YES/NO]
```
```

### Expected Outcome
- Both workflow files pass all verification checks
- Trigger paths align with standing instruction categories
- Baselines match exploration findings
- Inventory scripts still run cleanly
- Generated files are tracked in git
- No source code modified
- TypeScript compilation clean

---

## Post-Completion Checklist

After Claude Code reports Guide 3 complete:

### Quick Scan
- [ ] Open `.github/workflows/docs-audit.yml` — does the YAML look correct?
- [ ] Open `.github/workflows/refactor-audit.yml` — does the YAML look correct?
- [ ] Are the trigger paths comprehensive?
- [ ] Do the baselines match what you know about the codebase?

### Verify No Source Code Changes
```powershell
git diff --name-only
```
Only `.github/workflows/` files should appear.

### Commit
```powershell
git add .github/
git commit -m "feat: add GitHub Actions for doc drift audit + weekly refactoring audit"
```

### Post-Push Setup

After pushing to GitHub, you need to create the labels referenced by the workflows:

1. Go to your repo on GitHub → Issues → Labels
2. Create these labels if they don't exist:
   - `documentation` (color: `#0075ca`)
   - `automated-audit` (color: `#d4c5f9`)
   - `refactoring` (color: `#fbca04`)

### Testing the Workflows

**Test docs-audit**: Make a trivial change to any API route, push to main WITHOUT running `npm run gen:all`. The workflow should detect drift and create an issue.

**Test refactor-audit**: Go to GitHub → Actions → "Weekly Refactoring Audit" → "Run workflow" → select main branch → click "Run workflow". It should run and either create an issue (if anything exceeds baselines) or succeed silently.

### The Four-Layer System is Complete

After Guide 3, all four layers are operational:

| Layer | Guide | Status |
|-------|-------|--------|
| Standing instructions (.cursorrules) | Guide 1 | ✅ Active in every Claude Code session |
| Generated inventories (npm scripts) | Guide 1 | ✅ `npm run gen:all` |
| Pre-commit hook (Husky) | Guide 2 | ✅ Warns on every commit |
| Doc drift audit (GitHub Action) | Guide 3 | ✅ Checks every push to main |
| Refactoring audit (GitHub Action) | Guide 3 | ✅ Runs every Sunday |
