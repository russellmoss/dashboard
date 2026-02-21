# Tech Debt Sensor Upgrade — Implementation Guide

> **Source of Truth**: `tech_debt_exploration.md` (1,789 lines, 7 phases + pre-implementation verification)
>
> **Objective**: Replace the broken dead-exports grep sensor with knip (AST-based), update the stale npm audit baseline from 3 to the correct value, and preserve all existing safety patterns. Zero source code changes. Zero production impact.
>
> **Files that will change** (and ONLY these files):
> - `.github/workflows/refactor-audit.yml` (modified)
> - `package.json` (modified — new devDependency)
> - `package-lock.json` (modified — lockfile update)
> - `knip.json` (already created during exploration — verify it exists)
>
> **Rules**:
> - Do NOT modify any file in `src/`, `scripts/`, or any other source directory.
> - Read every file BEFORE modifying it.
> - Run every verification command listed. Do not skip verifications.
> - If any verification fails, STOP and report. Do not proceed to the next phase.
> - After completing each phase, report the results before moving to the next.

---

## PHASE 1: Create Feature Branch & Fix Axios Vulnerability

**Objective**: Create an isolated branch and resolve the one fixable high-severity vulnerability before setting baselines.

### Step 1.1 — Create the feature branch

```bash
git checkout main
git pull origin main
git checkout -b feat/tech-debt-sensors
```

### Step 1.2 — Run npm audit fix to resolve axios vulnerability

The axios vulnerability (advisory 1113275, GHSA-43fc-jf86-j433) has `fixAvailable: true` and is NOT a semver major bump. This is the only fixable high-severity vuln.

```bash
npm audit fix
```

**Do NOT run `npm audit fix --force`** — that would attempt major version bumps for @sentry/nextjs and next, which would break the application.

### Step 1.3 — Verify axios fix

```bash
npm audit --omit=dev --json 2>nul | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const v = d.metadata && d.metadata.vulnerabilities;
  console.log('High vulnerabilities:', v ? (v.high || 0) : 'PARSE ERROR');
"
```

**Expected result**: `High vulnerabilities: 7`

If the count is still 8, the axios fix did not apply. Record the actual count — this becomes BASELINE_VULNS in Phase 3. Do NOT block on this; proceed with whatever the actual count is.

### Step 1.4 — Verify no source code was modified by npm audit fix

```bash
git diff --name-only
```

**Expected output**: Only `package.json` and `package-lock.json` should appear. If ANY file in `src/` appears, run `git checkout -- src/` immediately.

### Step 1.5 — Verify build still works

```bash
npm run build
```

**Expected**: Build completes successfully. If build fails, `npm audit fix` introduced a breaking change. Run `git checkout -- package.json package-lock.json` to revert and set BASELINE_VULNS to 8 instead of 7.

### Step 1.6 — Verify TypeScript compilation

```bash
npx tsc --noEmit
```

**Expected**: Same output as before (zero NEW errors). Pre-existing errors are acceptable if they existed before this branch.

### Step 1.7 — Verify production dependency count unchanged

```bash
npm ls --production --depth=0 2>nul | tail -1
```

**Expected**: 31 direct production dependencies (matching Phase 0 Q0.1c baseline). If the count changed, `npm audit fix` modified a production dependency — investigate before proceeding.

### ✅ PHASE 1 VERIFICATION CHECKPOINT

```
Report:
- [ ] Feature branch created: feat/tech-debt-sensors
- [ ] npm audit fix ran (axios fix attempted)
- [ ] High vulnerability count is now: ___ (expected: 7)
- [ ] Only package.json and package-lock.json modified
- [ ] npm run build: PASS / FAIL
- [ ] npx tsc --noEmit: PASS / FAIL (no new errors)
- [ ] Production dep count: ___ (expected: 31)
- [ ] BASELINE_VULNS will be set to: ___ (7 if axios fixed, 8 if not)
```

**If any check fails, STOP and report. Do not proceed to Phase 2.**

---

## PHASE 2: Install knip & Verify Configuration

**Objective**: Add knip as a devDependency and confirm the knip.json configuration produces the expected baseline count.

### Step 2.1 — Verify knip.json exists

```bash
cat knip.json
```

**Expected contents** (created during exploration):
```json
{
  "$schema": "https://unpkg.com/knip/schema.json",
  "ignore": ["scripts/**", "src/**/__tests__/**", "src/**/*.test.{ts,tsx}"]
}
```

If `knip.json` does NOT exist, create it with exactly that content. If it exists with different content, verify it matches and correct if needed.

### Step 2.2 — Install knip as a devDependency

```bash
npm install --save-dev knip
```

### Step 2.3 — Verify knip installed correctly

```bash
npx knip --version
```

**Expected**: Version 5.x (5.84.1 or newer). If install fails, check Node.js version meets knip's requirement (>=18.18.0).

### Step 2.4 — Run knip and capture the baseline count

```bash
npx knip --reporter json 2>nul > /tmp/knip-verify.json || true
```

Then extract the unused value exports count:

```bash
node -e "
  const d = JSON.parse(require('fs').readFileSync('/tmp/knip-verify.json', 'utf8'));
  const issues = d.issues || [];
  let exportCount = 0;
  issues.forEach(i => { exportCount += (i.exports || []).length; });
  console.log('Unused value exports:', exportCount);
  console.log('Unused files:', (d.files || []).length);
"
```

**Expected**: `Unused value exports: 92` (matching pre-implementation verification)

If the count differs from 92, record the actual count. This becomes BASELINE_DEAD_EXPORTS in Phase 3. Small deviations (±3) from code changes between exploration and now are acceptable — use the actual count.

### Step 2.5 — Verify the 3 known dead exports are within the results

```bash
node -e "
  const d = JSON.parse(require('fs').readFileSync('/tmp/knip-verify.json', 'utf8'));
  const issues = d.issues || [];
  const files = d.files || [];
  const allExports = [];
  issues.forEach(i => (i.exports || []).forEach(e => allExports.push(e.name + ' (' + i.file + ')')));
  const fileList = files.map(f => typeof f === 'string' ? f : f.file || f);

  console.log('=== Checking 3 confirmed dead exports ===');
  console.log('DEFAULT_YEAR in exports:', allExports.some(e => e.includes('DEFAULT_YEAR')));
  console.log('INPUT_STYLES (via ui.ts in unused files):', fileList.some(f => f.includes('config/ui.ts')));
  console.log('BUTTON_STYLES (via ui.ts in unused files):', fileList.some(f => f.includes('config/ui.ts')));
"
```

**Expected**: All three return `true`. INPUT_STYLES and BUTTON_STYLES appear as part of the entirely-unused `src/config/ui.ts` file, not as individual exports. DEFAULT_YEAR appears in the exports list for `src/config/constants.ts`.

### Step 2.6 — Verify build still works with knip installed

```bash
npm run build
```

**Expected**: Build completes successfully. knip is a devDependency — it installs but is never invoked during build.

### Step 2.7 — Verify TypeScript compilation

```bash
npx tsc --noEmit
```

**Expected**: No new errors. knip does not affect TypeScript compilation.

### Step 2.8 — Verify production dependency count unchanged

```bash
npm ls --production --depth=0 2>nul | tail -1
```

**Expected**: Still 31. knip is a devDependency and must NOT appear in the production tree.

### Step 2.9 — Check files modified so far

```bash
git diff --name-only
```

**Expected**: Only these files:
- `package.json`
- `package-lock.json`
- `knip.json` (if newly created; already tracked if committed during exploration)

If ANY `src/` file appears, something went wrong. Revert with `git checkout -- src/`.

### ✅ PHASE 2 VERIFICATION CHECKPOINT

```
Report:
- [ ] knip.json exists with correct content
- [ ] knip installed as devDependency (version: ___)
- [ ] knip unused value exports count: ___ (expected: 92)
- [ ] 3 confirmed dead exports present in knip results: YES / NO
- [ ] npm run build: PASS / FAIL
- [ ] npx tsc --noEmit: PASS / FAIL (no new errors)
- [ ] Production dep count: ___ (expected: 31)
- [ ] Only package.json, package-lock.json, knip.json modified
- [ ] BASELINE_DEAD_EXPORTS will be set to: ___ (expected: 92)
```

**If any check fails, STOP and report. Do not proceed to Phase 3.**

---

## PHASE 3: Update the Workflow File

**Objective**: Modify `.github/workflows/refactor-audit.yml` to replace the grep-based dead exports sensor with knip, update baselines, and modernize the npm audit flag. Preserve ALL existing safety valves.

### Step 3.0 — Read the current workflow file FIRST

```
Read the full contents of .github/workflows/refactor-audit.yml before making any changes.
```

Confirm you can see:
- The `env:` block with BASELINE_LARGE_FILES, BASELINE_TODOS, BASELINE_VULNS, BASELINE_DEAD_EXPORTS
- The "Scan for potential dead exports" step (lines ~65–86)
- The "Run npm audit" step (lines ~51–63)
- The "Determine if issue is needed" step (lines ~88–104)
- The issue creation step with the labels `['refactoring', 'automated-audit']`

### Step 3.1 — Update the baseline environment variables

Find this block (lines ~15–19):
```yaml
    env:
      BASELINE_LARGE_FILES: 25
      BASELINE_TODOS: 4
      BASELINE_VULNS: 3
      BASELINE_DEAD_EXPORTS: 86
```

Replace with (use the actual counts from Phase 1 and Phase 2 verifications):
```yaml
    env:
      BASELINE_LARGE_FILES: 25
      BASELINE_TODOS: 4
      # Updated 2026-02-18: actual production high-severity count after npm audit fix (axios resolved).
      # Remaining 7 are unfixable without major upgrades: 5x @sentry/nextjs cascade + 2x next.js.
      # See tech_debt_exploration.md Phase 3 for full advisory breakdown.
      BASELINE_VULNS: 7
      # Updated 2026-02-18: replaced grep-based detection (86 false positives) with knip AST analysis.
      # knip reports 92 genuinely unused value exports across src/config/ and src/lib/.
      # See tech_debt_exploration.md PRE-IMPLEMENTATION VERIFICATION Q1 for breakdown.
      BASELINE_DEAD_EXPORTS: 92
```

**IMPORTANT**: If Phase 1 determined BASELINE_VULNS should be 8 (axios fix failed), use 8 instead of 7. If Phase 2 found a different knip count than 92, use that actual count.

### Step 3.2 — Update the npm audit step for forward compatibility

Find this block (lines ~51–63):
```yaml
      - name: Run npm audit
        id: npm-audit
        run: |
          npm audit --production --json 2>/dev/null > /tmp/npm-audit.json || true
          HIGH_COUNT=$(node -e "
            try {
              const d = JSON.parse(require('fs').readFileSync('/tmp/npm-audit.json', 'utf8'));
              const v = d.metadata && d.metadata.vulnerabilities;
              console.log(v ? (v.high || 0) : 0);
            } catch(e) { console.log(0); }
          ")
          echo "high_count=$HIGH_COUNT" >> $GITHUB_OUTPUT
          npm audit --production 2>/dev/null | tail -5 > /tmp/npm-audit-summary.txt || true
```

Replace with:
```yaml
      - name: Run npm audit
        id: npm-audit
        run: |
          # --omit=dev replaces deprecated --production flag (forward-compatible with npm 11+)
          npm audit --omit=dev --json 2>/dev/null > /tmp/npm-audit.json || true
          HIGH_COUNT=$(node -e "
            try {
              const d = JSON.parse(require('fs').readFileSync('/tmp/npm-audit.json', 'utf8'));
              const v = d.metadata && d.metadata.vulnerabilities;
              console.log(v ? (v.high || 0) : 0);
            } catch(e) { console.log(0); }
          ")
          echo "high_count=$HIGH_COUNT" >> $GITHUB_OUTPUT
          npm audit --omit=dev 2>/dev/null | tail -5 > /tmp/npm-audit-summary.txt || true
```

**Changes**: `--production` → `--omit=dev` in both audit invocations (lines 54 and 63). Nothing else changes. The `|| true`, `2>/dev/null`, and `try/catch` safety valves are ALL preserved.

### Step 3.3 — Replace the dead exports scanning step with knip

Find this block (lines ~65–86):
```yaml
      - name: Scan for potential dead exports
        id: dead-exports
        run: |
          grep -rh "^export " src/config/ src/lib/ --include="*.ts" 2>/dev/null | \
            grep -oP "(?:const|function|class|type|interface|enum)\s+\K\w+" | \
            sort -u > /tmp/all-exports.txt

          DEAD_EXPORTS_LIST=""
          DEAD_COUNT=0

          while IFS= read -r name; do
            if [ -z "$name" ]; then continue; fi
            IMPORT_COUNT=$(grep -rw "$name" src/ --include="*.ts" --include="*.tsx" \
              2>/dev/null -l | wc -l | tr -d ' ')
            if [ "${IMPORT_COUNT}" -le 1 ]; then
              DEAD_EXPORTS_LIST="${DEAD_EXPORTS_LIST}\n- \`${name}\`"
              DEAD_COUNT=$((DEAD_COUNT + 1))
            fi
          done < /tmp/all-exports.txt

          echo "dead_count=$DEAD_COUNT" >> $GITHUB_OUTPUT
          printf "%b" "$DEAD_EXPORTS_LIST" > /tmp/dead-exports.txt
```

Replace with:
```yaml
      - name: Scan for unused exports (knip)
        id: dead-exports
        run: |
          # knip exits 1 when unused exports are found (expected linting behavior).
          # || true prevents non-zero exit from killing the step — mirrors npm audit pattern.
          npx knip --reporter json 2>/dev/null > /tmp/knip-output.json || true

          # Extract unused value export count from knip JSON output.
          # knip JSON schema: { issues: [{ file, exports: [{ name, ... }] }], files: [...] }
          # We count individual exports across all files, NOT unused files.
          DEAD_COUNT=$(node -e "
            try {
              const d = JSON.parse(require('fs').readFileSync('/tmp/knip-output.json', 'utf8'));
              const issues = d.issues || [];
              let count = 0;
              issues.forEach(i => { count += (i.exports || []).length; });
              console.log(count);
            } catch(e) { console.log(0); }
          ")
          echo "dead_count=$DEAD_COUNT" >> $GITHUB_OUTPUT

          # Build a human-readable list for the issue body
          node -e "
            try {
              const d = JSON.parse(require('fs').readFileSync('/tmp/knip-output.json', 'utf8'));
              const issues = d.issues || [];
              const lines = [];
              issues.forEach(i => {
                (i.exports || []).forEach(e => {
                  lines.push('- \`' + e.name + '\` in ' + i.file);
                });
              });
              const files = (d.files || []).map(f => typeof f === 'string' ? f : f.file || f);
              if (files.length) {
                lines.push('');
                lines.push('**Entirely unused files:**');
                files.forEach(f => lines.push('- ' + f));
              }
              require('fs').writeFileSync('/tmp/dead-exports.txt', lines.join('\n'));
            } catch(e) {
              require('fs').writeFileSync('/tmp/dead-exports.txt', 'knip analysis unavailable');
            }
          " 2>/dev/null || true
```

**Safety valve inventory for new step**:
- `2>/dev/null` on knip invocation — suppresses stderr noise ✅
- `|| true` on knip invocation — prevents exit code 1 from killing the step ✅
- `try/catch` in count extraction — falls back to 0 on parse failure ✅
- `try/catch` in list generation — writes fallback text on failure ✅
- `2>/dev/null || true` on list generation — suppresses and ignores errors ✅

### Step 3.4 — Update the dead exports section in the issue body

Find the dead exports section in the issue creation step. Look for the line referencing dead exports in the issue body — it currently says something about "false positives" and "dynamic usage patterns".

Find this text block within the issue creation step:
```javascript
              '## ♻️ Potential Dead Exports',
              '',
              '> ⚠️ These may be false positives — verify before removing.',
              '> Dynamic imports, re-exports, and external consumers are not detected.',
```

Replace with:
```javascript
              '## ♻️ Unused Exports (knip)',
              '',
              '> Detected by knip AST analysis — significantly more accurate than grep.',
              '> Ignores scripts/ and test files. See knip.json for configuration.',
```

### Step 3.5 — Update the Claude Code remediation prompt in the issue body

Find the remediation prompt section in the issue body. Look for the line:
```javascript
              '4. Verify dead exports before removing — check for dynamic usage patterns',
```

Replace with:
```javascript
              '4. Unused exports flagged by knip — verify before removing, check if used by external consumers',
```

### Step 3.6 — Verify the full workflow file

After all changes, read the complete workflow file back. Verify:

1. **env block** has updated BASELINE_VULNS and BASELINE_DEAD_EXPORTS with comments
2. **npm audit step** uses `--omit=dev` (not `--production`) in BOTH invocations
3. **dead exports step** uses `npx knip --reporter json`, NOT grep
4. **dead exports step** has `|| true` after the knip invocation
5. **dead exports step** has `try/catch` in the node -e count extraction
6. **dead exports step** output variable is still `dead_count` (same name as before)
7. **comparison logic** is UNCHANGED — still uses `$DEAD -gt $BASELINE_DEAD_EXPORTS`
8. **issue creation step** is UNCHANGED except for the two text updates in 3.4 and 3.5
9. **labels** are UNCHANGED: `['refactoring', 'automated-audit']`
10. **all other steps** (large files, TODOs) are COMPLETELY UNTOUCHED

Count safety valves in the modified steps:
- npm audit step: `2>/dev/null` (×2), `|| true` (×2), `try/catch` (×1) = **5 valves** ✅
- dead exports step: `2>/dev/null` (×2), `|| true` (×2), `try/catch` (×2) = **6 valves** ✅
- Large files step: UNTOUCHED
- TODOs step: UNTOUCHED

### Step 3.7 — Validate YAML syntax

```bash
npx yaml-lint .github/workflows/refactor-audit.yml 2>nul || node -e "
  const fs = require('fs');
  try {
    const y = fs.readFileSync('.github/workflows/refactor-audit.yml', 'utf8');
    // Basic YAML checks: consistent indentation, no tabs
    const lines = y.split('\n');
    let errors = [];
    lines.forEach((line, i) => {
      if (line.includes('\t')) errors.push('Line ' + (i+1) + ': contains tab character');
    });
    if (errors.length) console.log('YAML ERRORS:\n' + errors.join('\n'));
    else console.log('Basic YAML validation: PASS');
  } catch(e) { console.log('ERROR reading file:', e.message); }
"
```

**Expected**: No errors. YAML indentation must be consistent 2-space throughout.

### ✅ PHASE 3 VERIFICATION CHECKPOINT

```
Report:
- [ ] Workflow file read BEFORE modifications
- [ ] BASELINE_VULNS updated to: ___ (expected: 7 or 8)
- [ ] BASELINE_DEAD_EXPORTS updated to: ___ (expected: 92)
- [ ] npm audit step uses --omit=dev (both invocations)
- [ ] Dead exports step uses knip (not grep)
- [ ] Dead exports step has || true guard
- [ ] Dead exports step has try/catch in count extraction
- [ ] Dead exports step output variable is still dead_count
- [ ] Comparison logic UNCHANGED
- [ ] Issue body text updated (2 sections)
- [ ] Labels UNCHANGED
- [ ] Large files step UNTOUCHED
- [ ] TODOs step UNTOUCHED
- [ ] YAML validation: PASS / FAIL
- [ ] Total files modified so far: .github/workflows/refactor-audit.yml, package.json,
      package-lock.json, knip.json (if new)
```

**If any check fails, STOP and report. Do not proceed to Phase 4.**

---

## PHASE 4: Full Pre-Commit Verification

**Objective**: Confirm the complete change set is correct, safe, and ready for push.

### Step 4.1 — Verify no source code was modified

```bash
git diff --name-only
```

**Expected output** (exactly these files, no others):
```
.github/workflows/refactor-audit.yml
knip.json
package-lock.json
package.json
```

**HARD STOP if any file in `src/` or `scripts/` appears.** Revert with `git checkout -- src/ scripts/`.

### Step 4.2 — Verify build

```bash
npm run build
```

**Expected**: Successful build. knip is inert during build.

### Step 4.3 — Verify TypeScript compilation

```bash
npx tsc --noEmit
```

**Expected**: No new errors compared to before this branch.

### Step 4.4 — Verify linting (if configured)

```bash
npm run lint 2>nul || echo "No lint script configured"
```

**Expected**: No new lint errors. If lint script doesn't exist, skip.

### Step 4.5 — Verify production dependency count

```bash
npm ls --production --depth=0 2>nul | tail -1
```

**Expected**: 31 direct production dependencies (unchanged from Phase 0 Q0.1c).

### Step 4.6 — Run knip one final time to confirm count

```bash
npx knip --reporter json 2>nul > /tmp/knip-final.json || true
node -e "
  const d = JSON.parse(require('fs').readFileSync('/tmp/knip-final.json', 'utf8'));
  const issues = d.issues || [];
  let count = 0;
  issues.forEach(i => { count += (i.exports || []).length; });
  console.log('Final knip unused value exports:', count);
  console.log('Matches BASELINE_DEAD_EXPORTS?', count === 92 ? 'YES' : 'NO — update baseline to ' + count);
"
```

**Expected**: Count matches the BASELINE_DEAD_EXPORTS value in the workflow. If it doesn't, update the workflow env var to match BEFORE committing.

### Step 4.7 — Run npm audit one final time to confirm count

```bash
npm audit --omit=dev --json 2>nul > /tmp/audit-final.json || true
node -e "
  const d = JSON.parse(require('fs').readFileSync('/tmp/audit-final.json', 'utf8'));
  const v = d.metadata && d.metadata.vulnerabilities;
  const high = v ? (v.high || 0) : 0;
  console.log('Final high vulnerability count:', high);
  console.log('Matches BASELINE_VULNS?', high === 7 ? 'YES' : 'NO — update baseline to ' + high);
"
```

**Expected**: Count matches the BASELINE_VULNS value in the workflow. If it doesn't, update the workflow env var to match BEFORE committing.

### ✅ PHASE 4 VERIFICATION CHECKPOINT

```
Report:
- [ ] git diff --name-only shows ONLY workflow, knip.json, package.json, package-lock.json
- [ ] npm run build: PASS
- [ ] npx tsc --noEmit: PASS (no new errors)
- [ ] npm run lint: PASS or N/A
- [ ] Production dep count: 31 (unchanged)
- [ ] knip count matches BASELINE_DEAD_EXPORTS: YES / NO (adjusted to: ___)
- [ ] npm audit high count matches BASELINE_VULNS: YES / NO (adjusted to: ___)
- [ ] Ready to commit: YES / NO
```

**If any check fails, STOP and report. Do not proceed to Phase 5.**

---

## PHASE 5: Commit, Push & Remote Validation

**Objective**: Push to GitHub and validate the workflow runs correctly on the feature branch via manual dispatch.

### Step 5.1 — Stage and commit

```bash
git add .github/workflows/refactor-audit.yml package.json package-lock.json knip.json
git status
```

**Verify** `git status` shows ONLY those files staged. Nothing else.

```bash
git commit -m "fix(ci): upgrade tech debt sensors — knip replaces grep, update stale baselines

- Replace grep-based dead export detection (86 false positives) with knip AST analysis
- Update BASELINE_DEAD_EXPORTS: 86 → 92 (knip's accurate count)
- Update BASELINE_VULNS: 3 → 7 (actual count after npm audit fix resolved axios)
- Add knip v5.84.1 as devDependency (Next.js-aware, TS 5.9.3 compatible)
- Add knip.json config (ignore scripts/, test files)
- Modernize npm audit flag: --production → --omit=dev (forward-compatible with npm 11+)
- Preserve all 8 error-handling safety valves (|| true, 2>/dev/null, try/catch)

No source code changes. No production impact.
See tech_debt_exploration.md for full investigation and baseline evidence."
```

### Step 5.2 — Push to GitHub

```bash
git push -u origin feat/tech-debt-sensors
```

### Step 5.3 — Trigger workflow_dispatch on the feature branch

In GitHub:
1. Go to the repository → **Actions** tab
2. Click **"Weekly Refactoring Audit"** in the left sidebar
3. Click **"Run workflow"** dropdown (top right)
4. Select branch: **`feat/tech-debt-sensors`**
5. Click **"Run workflow"**

### Step 5.4 — Monitor the workflow run

Wait for the workflow to complete. Check each step:

1. **Checkout**: should pass (standard)
2. **Setup Node.js**: should pass (Node 20 + npm cache)
3. **Install dependencies**: should pass (npm ci installs knip as devDep)
4. **Check for large files**: should pass (untouched step)
5. **Scan for TODO/HACK/FIXME**: should pass (untouched step)
6. **Run npm audit**: should pass — verify high_count output matches BASELINE_VULNS
7. **Scan for unused exports (knip)**: should pass — verify dead_count output matches BASELINE_DEAD_EXPORTS
8. **Determine if issue is needed**: should output `needs_issue=false` (all counts ≤ baselines)
9. **Create refactoring issue**: should be SKIPPED (conditional `if: needs_issue == 'true'`)

### Step 5.5 — Validate the workflow result

**If all steps are green and no issue was created**: The baselines are correct. The sensors are working.

**If an issue WAS created**: The baselines don't match CI's counts. Open the created issue, read the counts, and compare against your local counts. The CI environment (Node 20 / npm 10) may produce slightly different numbers. If so:
1. Update the workflow env vars to match CI's actual counts
2. Commit and push the fix
3. Re-trigger workflow_dispatch
4. Repeat until no issue is created

**If any step failed (red X)**: Read the step's log output. Common causes:
- knip step missing `|| true` → exits 1 and kills the job
- YAML syntax error → job fails at parse time
- Node.js version incompatibility → install step fails

### ✅ PHASE 5 VERIFICATION CHECKPOINT

```
Report:
- [ ] Commit message includes all changes
- [ ] Push to feat/tech-debt-sensors: SUCCESS
- [ ] workflow_dispatch triggered on feature branch
- [ ] All workflow steps: GREEN
- [ ] needs_issue output: false (no issue created)
- [ ] If issue created: baselines adjusted and re-run passed
- [ ] Workflow run URL: ___
```

**If the workflow did not pass cleanly, STOP. Fix and re-run before proceeding to Phase 6.**

---

## PHASE 6: Cleanup & Merge

**Objective**: Close stale issues, merge to main, and confirm the sensor is operational.

### Step 6.1 — Close the stale automated issue

Go to GitHub Issues. Find the open issue:
- Title: "🔧 Weekly Refactoring Audit — 2026-02-18"
- Labels: `automated-audit`, `refactoring`

Close it with a comment:
```
Closing: baselines corrected in feat/tech-debt-sensors. Previous BASELINE_VULNS (3) and
BASELINE_DEAD_EXPORTS (86/grep) were stale. New baselines: VULNS=7, DEAD_EXPORTS=92 (knip).
See tech_debt_exploration.md for full investigation.
```

### Step 6.2 — Merge to main

```bash
git checkout main
git pull origin main
git merge feat/tech-debt-sensors
git push origin main
```

Or create a Pull Request on GitHub if that's the preferred workflow.

### Step 6.3 — Post-merge verification

After merge, the workflow will run automatically next Sunday at 8:00 AM UTC. To verify immediately:

1. Go to **Actions** → **"Weekly Refactoring Audit"**
2. Click **"Run workflow"** → select **`main`**
3. Confirm all steps green, `needs_issue=false`

### Step 6.4 — Delete the feature branch

```bash
git branch -d feat/tech-debt-sensors
git push origin --delete feat/tech-debt-sensors
```

### ✅ PHASE 6 VERIFICATION CHECKPOINT

```
Report:
- [ ] Stale issue "🔧 Weekly Refactoring Audit — 2026-02-18" closed
- [ ] Merged to main
- [ ] Post-merge workflow_dispatch on main: all steps GREEN, needs_issue=false
- [ ] Feature branch deleted
```

---

## IMPLEMENTATION COMPLETE — Final Summary

```
Files changed (and ONLY these):
  .github/workflows/refactor-audit.yml  — knip replaces grep, baselines updated, --omit=dev
  package.json                          — knip added as devDependency
  package-lock.json                     — lockfile updated
  knip.json                             — configuration for knip (ignore scripts/, tests)

Files NOT changed:
  src/**                                — zero source code modifications
  scripts/**                            — zero script modifications
  .github/workflows/docs-audit.yml      — untouched
  vercel.json                           — untouched

Baselines:
  BASELINE_VULNS:        3 → 7 (or 8)   — reflects actual high-severity count
  BASELINE_DEAD_EXPORTS: 86 → 92        — knip AST analysis replaces grep false positives

Safety:
  All 8 original error-handling safety valves preserved or equivalently replaced
  knip step includes || true + try/catch (matches existing patterns)
  Zero production impact — workflow is decoupled from Vercel deployments
  Rollback: git revert <sha> restores everything instantly

What the sensors now do correctly:
  Dead exports: knip traces the actual TypeScript import graph via AST analysis.
    If a new unused export appears (count > 92), a GitHub Issue is created.
  NPM audit: baseline matches reality. If a new high-severity advisory appears
    (count > 7), a GitHub Issue is created immediately.
```