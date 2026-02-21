# Tech Debt Sensor Upgrade — Supplemental Exploration (Phase 0 & Phase 6)

> **Purpose**: Two missing phases that must be completed before the implementation guide is written. These protect the dashboard and Vercel deployment from unintended side effects.
>
> **Rules**:
> - Do NOT modify any source code, workflow files, or package.json during exploration.
> - Answer every question by reading the actual files. No assumptions. No hallucination.
> - Paste exact snippets where requested.
> - If a question reveals something unexpected, note it in the ⚠️ DISCOVERY section at the end of that phase.
> - After completing each phase, stop and report before moving to the next.
> - **When both phases are complete**: Append the completed Phase 0 and Phase 6 content to `C:\Users\russe\Documents\Dashboard\tech_debt_exploration.md` — insert Phase 0 before Phase 1, and Phase 6 after Phase 5 but before the EXPLORATION SUMMARY section. Update the summary checklist to include the new verification items.

---

## PHASE 0: Pre-Flight Safety Checks

**Objective**: Confirm the changes we're about to plan cannot affect the running dashboard, Vercel deployments, or production behavior in any way.

### 0.1 — Vercel build configuration

**Q0.1a**: Does Vercel install devDependencies during build? Check the Vercel project settings or `vercel.json` if it exists. Also check if `package.json` has a custom `build` script that references any dev tooling:

```bash
cat vercel.json 2>/dev/null || echo "No vercel.json"
node -e "const p = require('./package.json'); console.log('build script:', p.scripts?.build); console.log('postinstall:', p.scripts?.postinstall);"
```

```
Answer:
```

**Q0.1b**: Does the project use `--production` or `--omit=dev` anywhere in its deployment pipeline? If Vercel only installs production deps, a new devDependency won't affect the deployment at all:

```
Answer:
```

**Q0.1c**: Run `npm ls --production --depth=0` to see the current production dependency tree. Record the count — we'll re-verify this hasn't changed after implementation:

```bash
npm ls --production --depth=0 2>/dev/null | tail -1
```

```
Answer (production dep count):
```

### 0.2 — Existing workflow issue state

**Q0.2a**: Are there any currently open GitHub Issues created by the refactoring audit workflow? Check for the `automated-audit` or `refactoring` labels:

```bash
gh issue list --label "automated-audit" --state open 2>/dev/null || echo "gh CLI not available — check GitHub manually"
gh issue list --label "refactoring" --state open 2>/dev/null || echo "gh CLI not available — check GitHub manually"
```

```
Answer:
```

**Q0.2b**: If open issues exist with the old baselines, will changing the baselines cause a confusing duplicate on the next run?

```
Answer:
```

### 0.3 — Branch strategy

**Q0.3a**: Confirm — we will implement on a feature branch (e.g., `feat/tech-debt-sensors`), trigger a manual `workflow_dispatch` run on that branch to validate, and only merge to main after the test run passes cleanly. Correct?

```
Answer: YES — implementation will use feature branch with manual dispatch validation before merge.
```

### ⚠️ PHASE 0 DISCOVERIES

```
(Record anything unexpected here)
```

---

## PHASE 6: CI Environment Alignment & Test Plan

**Objective**: Ensure local exploration findings will match what CI actually produces, and define the exact test sequence.

### 6.1 — Node/npm version alignment

**Q6.1a**: What Node.js and npm versions does `ubuntu-latest` with `setup-node@v4 node-version: '20'` provide? Compare against your local versions:

```bash
node --version
npm --version
```

```
Answer:
Local Node: ?
Local npm: ?
CI Node 20.x will use npm: ? (check GitHub Actions runner images or Node.js release schedule)
Match: YES / NO
```

**Q6.1b**: If npm versions differ, does the `npm audit --json` schema differ between them? Test by comparing the top-level keys from Phase 3 Q3.1a against the documented schema for the CI npm version:

```
Answer:
```

### 6.2 — Error handling preservation

**Q6.2a**: List every instance of `|| true`, `2>/dev/null`, or `try/catch` in the current workflow. These are safety valves — every one must be preserved or replaced with equivalent handling in the implementation:

```bash
grep -n "|| true\|2>/dev/null\|try.*catch\|continue-on-error" .github/workflows/refactor-audit.yml
```

```
Answer:
```

**Q6.2b**: Does the workflow use `continue-on-error: true` on any steps?

```bash
grep -n "continue-on-error" .github/workflows/refactor-audit.yml
```

```
Answer:
```

**Q6.2c**: If the dead exports tool (ts-prune/knip/whatever was recommended in Phase 4) exits with a non-zero code when it finds dead exports (which many linting tools do), will that kill the workflow step? How should we handle this?

```
Answer:
```

### 6.3 — Manual test plan

**Q6.3a**: Can `workflow_dispatch` run on a non-main branch? Verify by checking the workflow trigger config:

```bash
head -10 .github/workflows/refactor-audit.yml
```

```
Answer:
```

**Q6.3b**: Define the exact test sequence after implementation. This is the checklist we'll follow before merging:

```
Test Plan:
1. [ ] Create feature branch: feat/tech-debt-sensors
2. [ ] Commit all changes (workflow + package.json + lockfile only)
3. [ ] Push branch to GitHub
4. [ ] Trigger workflow_dispatch on the feature branch
5. [ ] Verify workflow completes without failure
6. [ ] Verify: if issue is created, baselines are accurate
7. [ ] Verify: if no issue is created, confirm counts match baselines
8. [ ] Run `npm run build` locally to confirm build still works
9. [ ] Run `npx tsc --noEmit` to confirm no TypeScript regressions
10. [ ] Verify production dep count unchanged from Phase 0 Q0.1c
11. [ ] Verify no source code files were modified: git diff --name-only
12. [ ] Merge to main only after all above pass
```

### ⚠️ PHASE 6 DISCOVERIES

```
(Record anything unexpected here)
```

---

## APPEND INSTRUCTIONS

> After completing both phases above, do the following:
>
> 1. Read `C:\Users\russe\Documents\Dashboard\tech_debt_exploration.md` in full.
> 2. Insert the completed **Phase 0** section immediately before the existing **Phase 1** header (`## PHASE 1: Current Workflow Anatomy`).
> 3. Insert the completed **Phase 6** section immediately after the existing **Phase 5** section (after `⚠️ PHASE 5 DISCOVERIES`) and before the **EXPLORATION SUMMARY** section.
> 4. In the **EXPLORATION SUMMARY** checklist at the bottom, replace the existing checklist with:
>
> ```
> [ ] All 7 phases complete (0 through 6)
> [ ] All questions answered with evidence from actual files
> [ ] No unresolved discoveries that block implementation
> [ ] Vercel deployment confirmed safe (Phase 0)
> [ ] Ground truth baselines established
> [ ] Tool selection confirmed
> [ ] CI/local environment alignment verified (Phase 6)
> [ ] Error handling patterns documented and preservation plan confirmed
> [ ] Manual test plan defined with branch strategy
> [ ] Rollback plan defined
> ```
>
> 5. Report: "Supplemental exploration complete. Phase 0 and Phase 6 appended to tech_debt_exploration.md. Document is now the complete single source of truth for implementation."