# Weekly Refactor Audit Cheat Sheet

Every Sunday at 8 AM UTC, a GitHub Actions workflow scans this repo and opens an issue titled **"Weekly Refactoring Audit."** That issue flags npm vulnerabilities, oversized files, dead exports, and TODOs. Your job each week is to review that issue and use `/auto-refactor` to safely handle what needs attention.

---

### Weekly checklist

1. **Open the latest audit issue.** Go to GitHub Issues and find the newest "Weekly Refactoring Audit."
2. **Scan for sections above baseline.** Each section says whether it's at baseline or has new findings. Ignore sections at baseline — they need no work.
3. **Run audit remediation mode.** Open Claude Code in the project directory and run:
   ```
   /auto-refactor [paste the full audit issue body here]
   ```
   This handles the routine stuff: runs `npm audit fix`, assesses large files, verifies dead exports. It will not touch protected areas or make risky changes.
4. **Read the report.** When it finishes, review what was changed, what was assessed but left alone, and what it recommends for follow-up.
5. **Review the diff.** Run `git diff` and scan every changed file before committing.
6. **Commit if clean.** If validation passed and the diff looks right, commit the changes.
7. **Run dedicated passes for follow-ups (optional).** If the report flags a specific file as a good candidate for deeper decomposition:
   ```
   /auto-refactor src/path/to/file.tsx — decompose
   ```
   Review the guide it produces, run `/compact`, then execute the guide in a fresh context.

---

### When to use audit mode vs. single-target mode

| Mode | When to use | What it does |
|------|-------------|--------------|
| **Audit mode** | Every week, with the full audit report pasted in | Triages all findings, makes safe fixes, assesses large files, reports what needs follow-up |
| **Single-target mode** | When a specific file is worth properly decomposing | Deep exploration, dependency mapping, builds a step-by-step refactor guide, optional council review |

---

### Good candidates for refactoring

- Large `*Content.tsx` or component files with clearly separable subcomponents, helpers, or constants
- Files where future `/new-feature` agents would benefit from smaller, more focused modules
- Files with pure functions or local UI pieces that can be extracted without changing behavior

### Usually not worth touching

- Files that are large but have a single cohesive job (one query, one complex view)
- Anything in the semantic layer, query construction, export/Sheets logic, drill-down modals, forecast math, or permissions
- Files where extraction would create fuzzy boundaries or awkward prop-drilling
- Files you'd only be splitting because they're over 500 lines, with no real agentic leverage

---

### Before you commit

- [ ] `npx tsc --noEmit` passed (zero type errors)
- [ ] `npm run build` passed
- [ ] `git diff` reviewed — only expected files changed, no business logic modified
- [ ] No protected areas were touched (exports, queries, semantic layer, drill-down, forecast)

---

### If in doubt

**Don't force it.** "Assessed, no safe extraction available — leave as-is" is a valid weekly outcome. A week with zero code changes but a clean assessment is a successful week.

---
---

# `/auto-refactor` Weekly Operating Guide

> **Audience**: Anyone operating the weekly refactor cycle on this repo.
> **Last updated**: 2026-03-27

---

## 1. What `/auto-refactor` Is

Every week, a GitHub Actions workflow scans this codebase and files a report as a GitHub issue. That report flags things like npm vulnerabilities, files that have grown too large, dead code, and leftover TODOs. Someone needs to look at that report and decide what to clean up.

`/auto-refactor` is a Claude Code command that helps with that process. Instead of manually reading every flagged file, figuring out what can safely be changed, and worrying about breaking something, you paste the audit findings (or a single file path) into `/auto-refactor` and it:

1. **Reads and classifies** each finding by risk and value
2. **Maps dependencies** so it knows what else in the codebase would be affected
3. **Decides what is safe to change** and what should be left alone
4. **Builds a step-by-step refactor plan** with validation checks after every change
5. **Optionally sends the plan to other AI models** (OpenAI, Gemini) for adversarial review
6. **Produces a ready-to-execute guide** or a "leave it alone" recommendation

We built it because:

- **Manual triage is slow.** Reading a 1,000-line file to decide if anything can be safely extracted takes time. `/auto-refactor` does this reading and assessment for you.
- **Safety matters more than speed.** This dashboard handles real recruiting data and financial metrics. A bad refactor can break exports, corrupt drill-down views, or silently change metric calculations. `/auto-refactor` has hard-coded guardrails for the most dangerous areas.
- **Agentic friendliness.** Smaller, well-structured files are easier for AI agents (including future `/new-feature` runs) to work with. When a file is 600 lines and half of it is unrelated helpers, agents have to read all of it to change one thing. Decomposition makes future work faster and safer.

---

## 2. What `/auto-refactor` Is NOT For

Do not use `/auto-refactor` for:

| Not for | Why |
|---------|-----|
| **Feature development** | Use `/new-feature` or `/auto-feature` instead. Refactors must have zero intentional behavior change. |
| **Bug fixes** | If `/auto-refactor` finds a bug during exploration, it reports it but does not fix it. Bug fixes are separate work. |
| **Architecture rewrites** | This tool makes small, safe, reversible changes. It will refuse broad restructuring. |
| **Query or semantic layer changes** | The semantic layer (`definitions.ts`, `query-compiler.ts`, `query-templates.ts`) is blocked by default. Changes there affect the Explore AI feature. |
| **Metric or business-rule changes** | Conversion rates, AUM aggregations, penalty math, forecast logic are all off-limits. |
| **Export or Sheets behavior changes** | Both export paths (ExportButton auto-export and ExportMenu explicit columns) are protected. |
| **Forcing decomposition because a file is large** | A 600-line file with one cohesive job is correctly left alone. Line count alone is never sufficient reason to refactor. |

---

## 3. The Two Main Ways We Use It

### Weekly Audit Remediation Mode

**When:** Every week after the GitHub audit issue is filed.

**How:** Paste the full audit report (or relevant sections) as the argument to `/auto-refactor`. The workflow recognizes multi-category audit input and enters **audit remediation mode**.

In this mode, `/auto-refactor`:
- Works through findings in priority order (npm vulnerabilities first, then TODOs, then large files, then dead exports)
- Skips any category that is at baseline (no new findings)
- Makes only clearly safe changes (like `npm audit fix` or removing a verified dead export)
- **Assesses** large files but only extracts code when confidence is very high
- Produces a structured report at the end
- Does NOT spawn full agent teams or run council review (those are heavyweight and reserved for single targets)

**Think of audit mode as triage.** It handles the easy stuff and flags candidates for deeper work.

### Dedicated Single-Target Mode

**When:** A specific file has been flagged as a good refactor candidate (either by the weekly audit or by you), and you want to do a proper decomposition.

**How:** Give `/auto-refactor` a single file path or specific finding. For example:

```
/auto-refactor src/components/dashboard/ExploreResults.tsx — decompose into smaller components
```

In this mode, `/auto-refactor`:
- Classifies the target into a risk lane
- Spawns specialized agents to map dependencies, inspect code, and find patterns
- Builds a detailed refactor guide with exact file moves and validation gates
- Optionally sends the plan for adversarial review by other AI models
- Produces a ready-to-execute package of artifacts

This is the deep-work mode. Use it for files that genuinely benefit from decomposition.

---

## 4. How the Workflow Decides What to Do

### Leverage

Every potential change is evaluated for **agentic leverage**: will this refactor make future AI-assisted development concretely easier?

- **High leverage**: Extracting pure helper functions from a large component so future `/new-feature` agents can add metrics without reading 800 lines of unrelated UI code.
- **Medium leverage**: Splitting out local subcomponents. Useful, makes the file easier to navigate, but doesn't fundamentally change how agents interact with it.
- **Low leverage**: Cosmetic cleanup, renaming, or moving code that doesn't create meaningful new boundaries.

### Risk

Risk is about what could go wrong:

- **How many files import from this one?** A file with 1-3 consumers is low risk. A file consumed by 50+ API routes is high risk.
- **Does it touch protected areas?** Semantic layer, export logic, drill-down modals, forecast math are all high risk.
- **Is the extraction boundary clean?** Can you clearly draw a line around what moves and what stays? Fuzzy boundaries = higher risk.
- **Are there barrel files involved?** Barrel files (like `index.ts` that re-exports many things) increase risk because changes ripple further.

### Blast Radius

How far a change ripples through the codebase:

- **Tiny**: 1-3 consumers, no barrel file, no dynamic imports. Very safe.
- **Small**: 4-10 consumers, all paths mapped and manageable.
- **Large**: 10+ consumers, barrel file involvement, or dynamic import fragility.

### Dispositions: Apply / Assess-Only / Skip

For each finding, `/auto-refactor` assigns one of three dispositions:

| Disposition | Meaning |
|-------------|---------|
| **Apply** | Safe to change now. High confidence, clean boundary, validated afterward. |
| **Assess-only** | Worth investigating but too risky to change during this pass. Noted as a candidate for a future dedicated run. |
| **Skip** | Not worth the effort or risk. Leave it alone. |

### Lane 2a and Lightweight Mode

When a single target is classified as a UI/component file with tiny blast radius (1-3 consumers, no barrel files, no protected areas), it qualifies for **Lane 2a** — a streamlined track that:

- Runs only the dependency mapper (not the full 3-agent team)
- Does a focused code review instead of spawning multiple exploration agents
- Makes council review optional (skipped when the extraction is clearly safe)
- Produces a shorter, more execution-oriented guide

Lane 2a exists because many component extractions are straightforward. Running the full heavyweight pipeline for a simple subcomponent extraction wastes time without adding safety.

### Why Some Files Are Intentionally Left Alone

A file can be large and still be correct as-is. Common reasons to leave a file alone:

- It has a single cohesive responsibility (a query file that builds one complex SQL query)
- Extracting pieces would create more complexity than it removes
- It touches protected areas where the risk of accidental behavior change is too high
- The agentic leverage of splitting it is low (agents don't frequently modify it)

**"Assessed, no safe extraction available — leave as-is"** is a valid and useful output.

---

## 5. High-Risk Areas That Stay Strict

These areas are **blocked by default** in `/auto-refactor`. Changes require explicit approval and are never attempted during weekly audit remediation:

| Area | Why it's protected |
|------|-------------------|
| **Semantic layer** (`src/lib/semantic-layer/`) | Powers the Explore AI feature. Changes ripple into query compilation and agent behavior. |
| **Query construction** (`src/lib/queries/`) | 33+ query files with no barrel file. Every consumer imports by direct path. Moving things breaks imports everywhere. |
| **Drill-down logic** (`*DrillDownModal.tsx` files) | 4 modals that manually construct typed records. Missing a field causes silent data loss. |
| **Export / Sheets flows** (`ExportMenu.tsx`, `ExportButton.tsx`, `src/lib/sheets/`) | Two different export mechanisms with different column mapping approaches. Breaking either corrupts user exports. |
| **API route behavior** (`src/app/api/**/route.ts`) | Thin pass-throughs to query functions. Changes here affect every dashboard consumer. |
| **Permissions / access control** (`src/lib/permissions.ts`) | RBAC source of truth for 8 roles. Wrong changes = wrong data access. |
| **Forecast / penalty logic** (`src/lib/forecast-penalties.ts`) | Single source of truth for `computeAdjustedDeal()`. Must never be duplicated or moved. |
| **Anything affecting metrics, SQL behavior, or data semantics** | Conversion rates, AUM aggregations, record inclusion filters. Silent changes here produce wrong numbers on the dashboard. |

---

## 6. What Happens During a Weekly Audit Run

### Step-by-step checklist

1. **Find the audit issue.** Go to the repo's GitHub Issues tab. Look for the latest "Weekly Refactoring Audit" issue (filed every Sunday at 8 AM UTC, or when manually triggered).

2. **Read the report.** The issue has four sections:
   - Large files (>500 lines) — with line counts
   - TODO/HACK/FIXME comments — with file locations
   - npm vulnerabilities — high-severity count
   - Dead exports — detected by knip

   Each section says whether it's at baseline or has new findings. Sections at baseline can be skipped.

3. **Decide what to run through `/auto-refactor`.** For most weeks, paste the full audit issue text:

   ```
   /auto-refactor [paste the full audit report text here]
   ```

   `/auto-refactor` will:
   - Skip sections at baseline automatically
   - Run `npm audit fix` for new vulnerabilities (without `--force`)
   - Assess each newly-large file
   - Verify and remove confirmed dead exports
   - Run `npx tsc --noEmit` after every code change

4. **Review the output.** At the end, `/auto-refactor` prints a structured report:
   - **Changes Made** — what was actually changed and validation results
   - **Assessed but Intentionally Unchanged** — files that were read and evaluated but left alone, with reasons
   - **Skipped** — sections at baseline
   - **Validation Results** — typecheck and build status
   - **Recommended Follow-ups** — files that warrant a dedicated single-target run

5. **Review the diff.** Run `git diff` to see exactly what changed. Verify the changes match the report.

6. **Decide whether to commit.** If the changes look good and validation passed, commit. If anything looks wrong, `git checkout .` to revert.

7. **Note follow-ups.** If the report recommends any files for a dedicated single-target pass, add those to your list for later in the week.

### Typical prompts for weekly audit mode

**Full audit run** (most common):
```
/auto-refactor Weekly audit report from 2026-03-22:

[paste the full GitHub issue body here]
```

**Just the npm vulnerabilities section**:
```
/auto-refactor npm vulnerabilities — 9 vs baseline 7. Please run npm audit fix and report.
```

---

## 7. What Happens During a Dedicated Single-Target Run

A single-target run is deeper and more thorough than audit mode. Use it when the weekly audit identifies a file worth properly decomposing.

### How it works

1. **Phase 0 — Triage.** The workflow reads the file and classifies it into a lane (1-4). It evaluates leverage, risk, and blast radius. If the file is in a blocked area (Lane 4), it stops immediately and tells you why.

2. **Phase 1 — Exploration.** Three specialized agents run in parallel:
   - **Code Inspector**: Finds types, construction sites, file dependencies
   - **Pattern Finder**: Finds how similar files are structured elsewhere in the codebase
   - **Dependency Mapper**: Maps every import, export, consumer, and barrel file involvement

   For Lane 2a targets (lightweight mode), only the dependency mapper runs, plus a focused review by the orchestrator.

3. **Phase 2 — Guide Building.** A detailed refactor guide is written with exact file moves, import changes, and validation commands for every step.

4. **Phase 3 — Council Review.** The plan is sent to OpenAI and Gemini for adversarial review. They look for type safety gaps, import breakage, behavior drift, and missing steps. For Lane 2a targets, council is optional and often skipped.

5. **Phase 4 — Self-Triage.** Council feedback is categorized: some fixes are applied automatically, some need your input, some are noted but deferred.

6. **Phase 5 — Ready Summary.** A final package of artifacts is produced with a clear recommendation: proceed, split into smaller refactors, or do not execute.

### When it uses lightweight mode

Lightweight mode activates when the target is a UI/component file with:
- 1-3 consumers
- No barrel file involvement
- No dynamic import fragility
- No server/client boundary issues
- No coupling to blocked areas
- Clean extraction boundaries

Example: a `*Content.tsx` component where you want to extract local subcomponents.

### When it uses full exploration and council

Full mode activates for:
- Files with many consumers
- Files near blocked areas
- Any target with ambiguity about safety
- Lane 2 (non-2a) or Lane 3 classifications

### Good candidates for single-target runs

- Large `*Content.tsx` components with clearly separable UI sections
- Component files with local helpers, constants, or subcomponents that could be their own files
- Files where future `/new-feature` work would benefit from smaller, more focused modules

### What a successful result looks like

A successful run produces:
- A refactor guide (`agentic_refactor_guide.md`) with concrete phases
- A ready summary with "Safe to attempt: yes"
- All validation gates defined
- Clear "next steps" to execute the guide

### When "do not proceed" is a good outcome

Sometimes the best answer is "don't refactor this file." This happens when:
- The file is large but cohesive — splitting it would add complexity, not reduce it
- The extraction boundaries are fuzzy — pieces can't be cleanly separated
- The risk is too high relative to the benefit
- The file is in a protected area

This is a **useful output**. It means you've confirmed the file doesn't need work right now and can move on.

---

## 8. Real Examples From This Repo

### ExploreResults.tsx — Proceeded and helped

`ExploreResults.tsx` was 1,779 lines. `/auto-refactor` classified it as Lane 2a (1 consumer, no barrel file, pure presentation logic). The lightweight track ran:

- Dependency mapper confirmed tiny blast radius
- 4 subcomponents were extracted into their own files
- The main file dropped from 1,779 to ~1,139 lines
- Zero behavior change, all validation gates passed
- Future agents modifying the Explore feature now read smaller, focused files

**Why it was a good candidate**: Large file, clear extraction boundaries, low risk, high agentic leverage.

### RequestDetailModal.tsx — Proceeded on a safe UI component

`RequestDetailModal.tsx` was 606 lines. Similar Lane 2a classification — a modal component with local formatting logic and subcomponents that could be extracted. Small consumer count, no protected area coupling, clean boundaries.

**Why it was a good candidate**: Self-contained UI component with obvious local pieces to extract.

### SGAManagementContent.tsx — Correctly decided not to proceed

`SGAManagementContent.tsx` at 570 lines was assessed but left alone. While it was over the 500-line threshold, the content was cohesive — it manages a single management view with tightly coupled state. Extracting pieces would have created awkward prop-drilling and unclear boundaries without meaningful agentic leverage.

**Why "leave as-is" was correct**: The file is large but has a single cohesive responsibility. Splitting it would add complexity without making future agent work easier.

---

## 9. Exact Prompts to Use

### Weekly audit remediation

```
/auto-refactor Weekly audit report from [date]:

[paste the full GitHub issue body]
```

### Dedicated single-target refactor

```
/auto-refactor src/components/sga-hub/AdminQuarterlyFilters.tsx — assess for decomposition
```

### Safe follow-up for a specific UI/component file

```
/auto-refactor src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx — decompose local subcomponents and helpers
```

### Executing the guide after `/auto-refactor` completes

After `/auto-refactor` finishes and you've reviewed the guide:

```
Execute agentic_refactor_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight.
```

(Run `/compact` first to clear context before executing.)

---

## 10. How to Review the Output

### The summary

At the end of every run, `/auto-refactor` prints a console summary. Check:

- **Lane classification** — Does it match your expectation? A file you thought was safe showing up as Lane 3 means it's riskier than expected.
- **Safe to attempt** — `yes`, `no`, or `conditional`. If conditional, read the conditions.
- **Top risks** — The 2-3 biggest things that could go wrong.
- **Human input required** — If yes, answer the questions before proceeding.

### The diff

Run `git diff` after any changes. Verify:

- Only expected files were changed
- No business logic was modified
- Import paths are correct
- No new files were created that shouldn't exist

### Validation results

Every change should have been followed by `npx tsc --noEmit`. Check that:

- The typecheck passed (zero errors)
- `npm run build` passed at the end
- `npm run lint` passed at the end

### Council usage

The summary states whether council was used or skipped. Council is:

- **Used** for standard-track (Lane 2, Lane 3) targets
- **Skipped** for clearly safe Lane 2a targets
- **Unavailable** if council-mcp is not configured (the run still works, just without cross-LLM review)

### What to do with assess-only or skip results

- **Assess-only**: The finding was evaluated and documented but no code was changed. The report explains why. This might become a dedicated single-target run later.
- **Skip**: Not worth pursuing. The file is fine as-is or the risk exceeds the benefit.

Both are normal and expected outcomes.

### Is the result actually useful?

A useful audit run either:
- Fixed something (npm vuln patched, dead export removed, clean extraction applied)
- Confirmed that flagged items don't need work right now (with clear reasoning)
- Identified a specific file worth a dedicated follow-up pass

If the run just says "everything is fine" for items that are clearly above baseline, something may be wrong — re-read the audit report and verify the input was correct.

---

## 11. Common Pitfalls

| Pitfall | What happens | What to do instead |
|---------|-------------|-------------------|
| Refactoring files just because they're large | Forced decomposition of cohesive files adds complexity | Only refactor when there's a clean extraction boundary AND agentic leverage |
| Using `/auto-refactor` for bug fixes | Refactors are zero-behavior-change. Mixing in fixes creates risk. | File bugs separately. Fix them in their own session. |
| Using `/auto-refactor` for feature work | The workflow blocks any behavior change by design. | Use `/new-feature` or `/auto-feature` for features. |
| Trusting reports without reviewing diffs | The AI could miss something. Always review. | Run `git diff` and scan every changed file before committing. |
| Expecting performance gains from every refactor | Most refactors improve maintainability and agentic development, not runtime performance. | Judge success by: Are files smaller? Are boundaries cleaner? Would a future agent have an easier time? |
| Running `/auto-refactor` on protected data-layer files | The workflow will block or produce assess-only results. | For query, semantic layer, or export changes, use the appropriate specialized workflow or do them manually with extra care. |
| Skipping `/compact` before executing the guide | The guide execution needs a clean context window. Running it in the same session as `/auto-refactor` can cause context overflow. | Always `/compact` between planning and execution. |

---

## 12. Troubleshooting

### Council not available

**Symptom**: `/auto-refactor` prints "Council MCP is unavailable. Skipping adversarial cross-LLM review."

**Cause**: The `council-mcp` MCP server is not registered or not running.

**Fix**:
1. Check registration: run `claude mcp list` in your terminal
2. If not listed, register it: `claude mcp add --scope user council-mcp -- node C:/Users/russe/Documents/Council_of_models_mcp/dist/index.js`
3. Restart Claude Code after registering

The run still works without council — you just don't get the adversarial cross-LLM review.

### API keys not visible to council

**Symptom**: Council tools are visible but calls fail with authentication errors.

**Cause**: `OPENAI_API_KEY` and/or `GEMINI_API_KEY` are not available to the MCP process.

**Fix**: Add the keys to your project `.env` file (already in `.gitignore`):
```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
```
This is the most reliable approach on Windows, where environment variable inheritance between shells and processes is unpredictable.

### Audit mode is too conservative

**Symptom**: Every large file gets "assess and report" but nothing is extracted.

**This is by design.** Audit remediation mode is intentionally conservative. If you want to actually decompose a specific file, run a **dedicated single-target pass**:
```
/auto-refactor src/path/to/file.tsx — decompose
```

### Single-target mode declined a file

**Symptom**: The workflow classified the file as Lane 4 (blocked) or recommended "do not execute."

**This is a valid outcome.** The file is either in a protected area or doesn't have clean extraction boundaries. Options:
- Accept the assessment and move on
- If you disagree, you can explicitly expand scope (e.g., "proceed with this refactor, I approve changes to the query layer") — but understand you're overriding a safety guardrail

### Generated docs changed unexpectedly

**Symptom**: `npm run gen:all` at the end of a run shows changes in `docs/_generated/`.

**This is normal.** If files were added, removed, or renamed, the auto-generated inventories will reflect that. Review the changes and commit them with the refactor.

### Typecheck or build failure during a run

**Symptom**: `npx tsc --noEmit` or `npm run build` fails after a change.

**What happens**: `/auto-refactor` stops and reports the failure. It does not continue past a failed validation gate.

**What to do**: Review the error. If it's a simple import issue, fix it and re-run the typecheck. If it's structural, the extraction may not be safe — consider reverting with `git checkout .` and reporting the finding as assess-only.

---

## 13. Weekly Quick-Start Checklist

- [ ] Open the latest "Weekly Refactoring Audit" GitHub issue
- [ ] Note which sections are above baseline (these need attention)
- [ ] Open Claude Code in the project directory
- [ ] Run: `/auto-refactor [paste the full audit report]`
- [ ] Wait for the audit remediation report
- [ ] Review the report: what was changed, what was left alone, what needs follow-up
- [ ] Run `git diff` to review all changes
- [ ] If changes look good and validation passed, commit
- [ ] If the report recommends any dedicated single-target follow-ups, decide whether to run them now or later
- [ ] For each approved follow-up: `/auto-refactor src/path/to/file.tsx — decompose`
- [ ] After single-target runs: review guide, `/compact`, then execute the guide
- [ ] Done for the week

---

## Glossary

| Term | Meaning |
|------|---------|
| **Lane 1** | Mechanical fix. No judgment needed. Example: `npm audit fix`. |
| **Lane 2** | Structural change that is safe if a clean boundary exists. Needs assessment first. |
| **Lane 2a** | A Lane 2 target with very low blast radius (1-3 consumers, no barrel files, no protected areas). Gets the lightweight/faster track. |
| **Lane 3** | Structural change that is risky. Needs full exploration, council review, and caution. |
| **Lane 4** | Blocked by default. Changes here affect metrics, SQL, exports, or business logic. Requires explicit approval to proceed. |
| **Blast radius** | How many files are affected if something goes wrong. Tiny = 1-3 consumers. Large = 10+ or barrel file involvement. |
| **Assess-only** | The file was read and evaluated but no code was changed. The assessment itself is the output. |
| **Council** | Adversarial review by other AI models (OpenAI GPT, Google Gemini) via the council-mcp server. Catches issues Claude might miss. |
| **Blocked-by-default** | Areas of the codebase that `/auto-refactor` will not touch without explicit human approval (semantic layer, exports, drill-down logic, forecast math, permissions). |
| **Agentic leverage** | How much a refactor improves future AI-assisted development. High leverage = smaller files, clearer boundaries, isolated concerns that agents can modify without reading unrelated code. |
| **Validation gate** | A required check (`npx tsc --noEmit`, `npm run build`, `npm run lint`) that must pass before the next step proceeds. If it fails, work stops. |
| **Dependency mapper** | A specialized agent that maps imports, exports, consumers, and barrel files to determine the true blast radius of a proposed change. |
| **Barrel file** | An `index.ts` file that re-exports things from many other files. Changes to barrel files ripple to every consumer. |
| **Lightweight mode** | The streamlined Lane 2a track: dependency mapper only, focused review, optional council, shorter guide. |
| **Standard track** | The full pipeline: 3 exploration agents, full guide, council review, self-triage. Used for Lane 2 (non-2a) and Lane 3 targets. |
