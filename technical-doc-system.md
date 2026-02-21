# Self-Healing Documentation & Codebase Health System

## Technical Reference — Savvy Wealth Dashboard

**Author:** Russell Moss, RevOps  
**Date:** February 2026  
**Application:** Savvy Funnel Analytics Dashboard (Next.js 14 / TypeScript)  
**Repository:** github.com/russellmoss/dashboard

---

## 1. Executive Summary

This document describes a four-layer automated system for maintaining documentation accuracy and monitoring codebase health in an AI-assisted development environment. The system was designed specifically for "agentic development" — a workflow where an AI coding agent (Claude Code) implements features through natural language instruction, and where stale documentation directly causes agent hallucination and compounding errors.

The system detects documentation drift and technical debt at four checkpoints — during AI coding sessions, at commit time, at push time, and on a weekly schedule — and generates ready-to-execute AI agent prompts at every stage so that remediation requires no manual investigation or interpretation.

The system requires no external services, no paid APIs, and no custom secrets. It runs entirely on Node.js scripts, git hooks, and built-in GitHub Actions infrastructure.

---

## 2. Problem Statement

### 2.1 Documentation Drift in AI-Assisted Development

When features are built by AI coding agents, the rate of code change dramatically outpaces manual documentation updates. In a traditional development workflow, a developer who adds an API route has the mental context to update the architecture docs. In an agentic workflow, the AI agent builds the route, the developer approves it, and the documentation update falls through because neither party is tracking it.

Over a 30-day period prior to this system's implementation, the Savvy Dashboard accumulated severe drift:

| Category | Documented | Actual | Drift |
|----------|-----------|--------|-------|
| API routes | ~30 | 91 | 61 undocumented (67%) |
| Prisma database models | 3 | 17 | 14 undocumented (82%) |
| Environment variables | 12 | 29 | 19 undocumented (66%) |
| Page routes | 10 | 17 | 4 phantom entries, 7 missing |

This drift directly impacted agent quality. Claude Code reads `docs/ARCHITECTURE.md` and `.cursorrules` at session start to understand the codebase. When those files describe a system with 30 routes and 3 models, the agent makes assumptions and decisions based on that false picture — generating code that conflicts with undocumented routes, duplicating logic that already exists in undocumented modules, and referencing database fields that have been renamed.

### 2.2 Technical Debt Accumulation

Beyond documentation, the codebase exhibited moderate technical debt signals that no process was tracking:

- 39 TypeScript/TSX files exceeding 400 lines, with `query-compiler.ts` at 2,432 lines
- 4 active TODO comments marking unimplemented semantic layer templates
- 3 high-severity npm audit vulnerabilities (including 2 in Next.js itself, requiring a breaking major version upgrade)
- 3 confirmed dead exports and 86 potentially dead exports identified by static analysis
- Next.js 2 major versions behind (14 vs 16), React 1 major version behind (18 vs 19)

Without monitoring, these metrics drift silently until a critical mass triggers a crisis — a security audit flags the vulnerabilities, a component becomes unmaintainable at 3,000 lines, or a breaking dependency upgrade becomes unavoidable and now touches hundreds of files.

---

## 3. System Architecture

### 3.1 Overview

The system operates as four independent layers with increasing latency and decreasing frequency:

```
Layer 1: Standing Instructions
├── Scope: Every AI coding session
├── Latency: Real-time (during implementation)
├── Mechanism: .cursorrules lookup table
└── Cost: Zero (embedded in existing config)

Layer 2: Generated Inventories  
├── Scope: On demand / triggered by other layers
├── Latency: < 2 seconds per run
├── Mechanism: 3 Node.js scripts scanning codebase
└── Cost: Zero (local execution)

Layer 3: Pre-commit Hook
├── Scope: Every git commit
├── Latency: < 200ms per commit
├── Mechanism: Husky + Node.js script analyzing staged files
└── Cost: Zero (local execution)

Layer 4: GitHub Actions
├── Scope: Every push to main / weekly schedule
├── Latency: ~60 seconds per workflow run
├── Mechanism: GitHub Actions workflows
└── Cost: GitHub Actions minutes (free tier sufficient)
```

Each layer is designed to catch what the previous layer missed. In practice, Layers 1 and 3 handle the majority of drift. Layer 4 serves as a safety net and catches slow-moving issues (technical debt) that the commit-level layers don't track.

### 3.2 File Inventory

Files created by this system:

```
.cursorrules                                    # Modified — added standing instructions section
.husky/pre-commit                               # New — shell hook (1 line, calls Node script)
.github/workflows/docs-audit.yml                # New — documentation drift workflow
.github/workflows/refactor-audit.yml            # New — weekly refactoring audit workflow
scripts/generate-api-inventory.cjs              # New — API route inventory generator
scripts/generate-model-inventory.cjs            # New — Prisma model inventory generator
scripts/generate-env-inventory.cjs              # New — environment variable inventory generator
scripts/pre-commit-doc-check.js                 # New — pre-commit analysis and prompt generator
docs/_generated/api-routes.md                   # New — generated API route inventory
docs/_generated/prisma-models.md                # New — generated Prisma model inventory
docs/_generated/env-vars.md                     # New — generated environment variable inventory
docs/_generated/.gitkeep                        # New — ensures directory is tracked
```

Dependencies added: `husky@9.1.7` (devDependency only).

npm scripts added to `package.json`:

```json
"gen:api-routes": "node scripts/generate-api-inventory.cjs",
"gen:models": "node scripts/generate-model-inventory.cjs",
"gen:env": "node scripts/generate-env-inventory.cjs",
"gen:all": "node scripts/generate-api-inventory.cjs && node scripts/generate-model-inventory.cjs && node scripts/generate-env-inventory.cjs",
"prepare": "husky"
```

---

## 4. Layer 1: Standing Instructions

### 4.1 Purpose

Instruct the AI coding agent to update documentation in real-time during the same session that changes the code. This is the cheapest intervention point — documentation is updated while the agent still has full context of what it just changed.

### 4.2 Implementation

A `## Documentation Maintenance — Standing Instructions` section was added to `.cursorrules` (the project-level configuration file that Claude Code reads at session start). The section contains a lookup table mapping code change categories to documentation targets:

| If the agent changes… | It must update… | And run… |
|---|---|---|
| `src/app/api/*/route.ts` | ARCHITECTURE.md feature section | `npm run gen:api-routes` |
| `src/app/*/page.tsx` | ARCHITECTURE.md Section 5 (Page Access Control) | — |
| `prisma/schema.prisma` | ARCHITECTURE.md models section | `npm run gen:models` |
| `.env.example` | ARCHITECTURE.md Section 10 (Env Vars) | `npm run gen:env` |
| `src/lib/permissions.ts` | ARCHITECTURE.md Section 5 (Roles/Permissions) | — |
| `src/lib/semantic-layer/` | ARCHITECTURE.md Section 7 (Semantic Layer) | — |
| `src/config/constants.ts` | Relevant section referencing those constants | — |
| `src/app/api/auth/` | ARCHITECTURE.md Section 5 (Authentication) | — |

### 4.3 Placement

The standing instructions are placed after the `## Architecture Patterns` section in `.cursorrules`, which is approximately line 120 of a 2,175-line file. This positions them after the critical verification protocol (which must remain prominent at the top) and near other operational patterns.

### 4.4 Limitations

The AI agent may forget these instructions during long sessions (context window pressure), may not reach the documentation update before the session ends, or may prioritize the primary task over the documentation side-task. This layer has an estimated compliance rate of 60-70%, which is why Layers 2-4 exist.

---

## 5. Layer 2: Generated Inventories

### 5.1 Purpose

Maintain deterministic, always-accurate inventory files that reflect the actual state of the codebase. Unlike human-written documentation, these inventories are generated from code and cannot drift — they are always a factual snapshot of what exists at the moment they are run.

### 5.2 Architecture

Three CommonJS Node.js scripts (`.cjs` extension due to the project's module configuration) scan the codebase using only Node.js built-in modules (`fs`, `path`, `child_process`). No npm dependencies are required.

**`scripts/generate-api-inventory.cjs`**

Recursively traverses `src/app/api/` to find all `route.ts` files. For each file, reads the first 50 lines and uses regex to detect exported HTTP method handlers (`export async function GET`, `export async function POST`, etc.). Extracts the API path from the file system path and groups routes by top-level feature area (first path segment after `/api/`). Converts kebab-case feature names to Title Case for readability.

Output: `docs/_generated/api-routes.md` — a markdown file with a header, generation timestamp, total count, and per-feature tables listing Route, Methods, and File Path.

Current state: 91 route files across 18 feature areas.

**`scripts/generate-model-inventory.cjs`**

Reads `prisma/schema.prisma` and parses model blocks using regex. For each model, extracts the model name, field names and types, nullability, defaults, relations, and `@@map` directives. Handles the actual patterns used in this specific schema rather than attempting to cover all Prisma syntax.

Output: `docs/_generated/prisma-models.md` — a markdown file with per-model sections containing field tables.

Current state: 17 models.

**`scripts/generate-env-inventory.cjs`**

Reads `.env.example` and parses each non-comment, non-blank line. Categorizes variables by prefix (DATABASE_ → Database, NEXT_ → Next.js, GOOGLE_ → Google/BigQuery, etc.). Also scans all `src/` TypeScript files for `process.env.*` references and flags any that appear in code but are absent from `.env.example` as undocumented.

Output: `docs/_generated/env-vars.md` — a markdown file with categorized variable tables and an undocumented references section.

Current state: 29 documented variables, 11 undocumented references in code.

### 5.3 Generated Files Are Committed

The `docs/_generated/` directory is tracked in git, not gitignored. This is a deliberate design decision:

- Generated files serve as documentation visible in the repository
- Pull request diffs show when routes/models/env vars change
- The doc drift audit (Layer 4a) depends on comparing regenerated files against committed versions
- No script execution is needed to read them — they are always browsable on GitHub

### 5.4 Composite Command

`npm run gen:all` runs all three scripts sequentially. This is the single command referenced throughout the system — the pre-commit hook reminds you to run it, the doc drift audit runs it in CI, and the standing instructions reference it.

---

## 6. Layer 3: Pre-commit Hook

### 6.1 Purpose

Detect documentation-relevant code changes at commit time and generate a ready-to-paste AI agent prompt for remediation. This is the primary "catch point" in the daily workflow — it fires on every commit and produces actionable output.

### 6.2 Architecture

The hook uses a two-file architecture to handle cross-platform compatibility:

**`.husky/pre-commit`** — A single-line shell script (`node scripts/pre-commit-doc-check.js`) that runs in Git Bash on Windows. Husky 9.1.7 manages hook installation via the `prepare` npm script, ensuring the hook travels with the repository.

**`scripts/pre-commit-doc-check.js`** — A 383-line CommonJS Node.js script containing all detection and prompt generation logic. Runs via `node` directly with no compilation or dependency requirements.

### 6.3 Detection Logic

The script executes `git diff --cached --name-only` to get the list of staged files, then categorizes each file against eight pattern categories:

| Pattern | Category | Triggers Gen Command |
|---------|----------|---------------------|
| `src/app/api/*/route.ts` | API Route | `npm run gen:api-routes` |
| `src/app/*/page.tsx` (depth 2-3) | Page Route | — |
| `prisma/schema.prisma` | Prisma Schema | `npm run gen:models` |
| `.env.example` | Environment Variables | `npm run gen:env` |
| `src/lib/permissions.ts` | Permissions / Roles | — |
| `src/lib/semantic-layer/` | Semantic Layer | — |
| `src/config/constants.ts` | Config Constants | — |
| `src/app/api/auth/` | Auth Logic | — |

The script then checks whether any documentation files were also staged (`docs/`, `.cursorrules`, `docs/_generated/`). Three outcomes:

1. **Doc-relevant code changed, no docs staged** → Print categorized warning + Claude Code prompt
2. **Doc-relevant code changed, docs also staged** → Print positive confirmation ("✓ Doc-relevant changes detected — docs also updated. Nice!")
3. **No doc-relevant code changed** → Silent pass (no output)

### 6.4 Prompt Generation

When drift is detected, the script generates a structured Claude Code prompt that includes:

- Exact file paths of every changed file, grouped by feature area
- Feature area names converted from kebab-case to Title Case (e.g., `gc-hub` → "GC Hub")
- Specific ARCHITECTURE.md section numbers to update (e.g., "update Section 5" for permissions)
- Which `npm run gen:*` commands to run
- Standard rules (read before write, match existing format, no source code modifications)

Multiple files from the same feature area are grouped under one heading to avoid prompt clutter.

### 6.5 Edge Cases Handled

- **Empty staging area**: Silent exit
- **Binary files**: Ignored (only text file patterns matched)
- **Deleted files**: Detected and categorized (deleted routes still need doc removal)
- **Renamed/moved files**: Both old and new paths categorized
- **Multiple routes in same feature**: Grouped under single heading
- **Generated inventory files staged**: Count as doc updates (no warning)
- **Outside git repo**: Graceful error, exit 0
- **Large diffs (50+ files)**: File lists truncated at 10-15 per category with "and X more" summary
- **Verbose mode**: `node scripts/pre-commit-doc-check.js --verbose` prints debug output

### 6.6 Non-blocking Design

The hook always exits with code 0. It never prevents a commit. This is a deliberate design choice — blocking commits during rapid feature development causes developers to bypass the hook with `--no-verify`, which defeats the purpose entirely. A warn-only approach maintains trust while still surfacing the information.

### 6.7 Performance

The hook runs `git diff --cached --name-only` (single git command), performs string matching against 8 regex patterns, and writes to stderr. No file I/O, no API calls, no compilation. Measured execution time: < 200ms.

---

## 7. Layer 4a: Documentation Drift Audit (GitHub Action)

### 7.1 Purpose

Detect documentation drift on every push to main by regenerating inventories from current code and comparing them against the committed versions. This is the safety net that catches everything Layers 1-3 missed.

### 7.2 Trigger

```yaml
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
```

The trigger paths mirror the eight categories from the pre-commit hook and the standing instructions lookup table. This means the workflow only runs when code that could cause drift is pushed — not on every push.

### 7.3 Detection Process

1. Check out the repository
2. Set up Node.js 20 with npm cache
3. Install dependencies (`npm ci`)
4. Run `npm run gen:all` to regenerate all three inventories from current code
5. Run `git diff` against each generated file
6. If any diff is non-empty, drift has been detected

The logic works because `npm ci` installs from the lockfile (deterministic), and `npm run gen:all` produces files based solely on the current codebase. If the regenerated files differ from the committed versions, it means code was pushed without regenerating inventories.

### 7.4 Issue Creation

When drift is detected, the workflow creates a GitHub Issue using `actions/github-script@v7` with the `GITHUB_TOKEN` (built-in, no secrets configuration needed).

The issue contains:

- Which inventories drifted (API routes, Prisma models, env vars)
- Truncated `git diff` output showing the specific changes
- The triggering commit SHA and author
- A quick-fix command block (`npm run gen:all` → `git add` → `git commit` → `git push`)
- A full Claude Code prompt for cases where ARCHITECTURE.md also needs narrative updates

The issue is labeled `documentation` and `automated-audit`.

### 7.5 Permissions

```yaml
permissions:
  contents: read
  issues: write
```

No custom repository secrets are required. The workflow uses only the built-in `GITHUB_TOKEN`.

---

## 8. Layer 4b: Weekly Refactoring Audit (GitHub Action)

### 8.1 Purpose

Monitor codebase health signals on a weekly cadence and flag when technical debt metrics worsen. Unlike the doc drift audit (which is event-driven), the refactoring audit runs on a schedule because technical debt accumulates gradually.

### 8.2 Trigger

```yaml
on:
  schedule:
    - cron: '0 8 * * 0'   # Sundays at 8:00 AM UTC
  workflow_dispatch:         # Manual trigger for testing
```

### 8.3 Metrics Tracked

**Large files (>500 lines):**
Uses `find`/`wc -l`/`awk` to count TypeScript and TSX files exceeding 500 lines. These represent growing complexity — files that may need extraction or decomposition.

**TODO/HACK/FIXME comments:**
Uses `grep -rn` across `src/` to find all comment markers. New TODOs indicate accumulating deferred work.

**npm audit vulnerabilities (high severity):**
Runs `npm audit --production --json` and extracts the high-severity count. Tracks whether new vulnerabilities have appeared in the dependency tree.

**Dead exports:**
Scans `src/config/` and `src/lib/` for exported symbols, then checks whether each symbol is referenced in any other file. Symbols referenced only in their own file are flagged as potentially dead. This check is approximate — it produces false positives from type exports, barrel re-exports, and dynamic imports — and the issue body includes a clear caveat about this.

### 8.4 Baseline Comparison

The workflow compares current metrics against hardcoded baselines to avoid noise from known issues:

```yaml
env:
  BASELINE_LARGE_FILES: 25
  BASELINE_TODOS: 4
  BASELINE_VULNS: 3
  BASELINE_DEAD_EXPORTS: 86
```

If all current metrics are at or below their baselines, the workflow succeeds silently and creates no issue. An issue is only created when at least one metric has worsened.

Baselines were established through a comprehensive codebase exploration (documented in `docs_maintenance_exploration.md`, Phase 6) and calibrated against actual CI detection results. The dead exports baseline of 86 reflects the high false-positive rate of the static analysis approach — the original manual inspection found only 3 confirmed dead exports, but the automated `grep` scan flags 86 due to type exports, re-exports, and generically named symbols.

### 8.5 Issue Output

The created issue contains:

- Each metric section with a flag indicating whether it's at baseline (✅) or newly exceeding it (⚠️ NEW)
- Full file lists and line references for actionable items
- npm audit summary
- Dead exports list with false-positive caveat
- A comprehensive Claude Code prompt with prioritized remediation instructions, exact file paths, and safety rules

The Claude Code prompt is designed to be copied and pasted directly into Claude Code with no modification. It includes priority ordering (vulnerabilities first, then TODOs, then large files, then dead exports), specific file paths from the scan results, and rules preventing the agent from making unsafe changes.

### 8.6 Baseline Maintenance

When a refactoring audit reveals a metric that has permanently increased (e.g., a legitimately large file that won't be decomposed, or a new known vulnerability with no available fix), the baseline should be updated in the workflow YAML to prevent recurring noise. This is a manual edit — update the `env` value and commit.

---

## 9. Design Decisions & Rationale

### 9.1 Change-triggered vs. Scheduled Doc Audit

The documentation drift audit triggers on pushes that touch specific paths, not on a daily cron. The exploration phase found severe existing drift (67% of routes undocumented). A daily cron would have created the same issue every day until the backlog was cleared, training users to ignore the system. Change-triggered means the audit only fires when new drift is introduced.

### 9.2 Warn-only Pre-commit Hook

The pre-commit hook exits with code 0 regardless of findings. A blocking hook (exit 1) would cause developers to bypass it with `git commit --no-verify` during rapid development, which is worse than a warning that's occasionally ignored. The hook can be upgraded to blocking later by changing the exit code, once the team has built trust in the system.

### 9.3 CommonJS for Scripts

The project does not set `"type": "module"` in `package.json`, making it CommonJS by default. All maintenance scripts use `.cjs` extension and `require()`/`module.exports` syntax to match the project convention and avoid module resolution issues.

### 9.4 No AI in CI

Neither GitHub Actions workflow uses the Anthropic API or any AI service. All detection is deterministic — file scanning, regex matching, `git diff`, line counting. This eliminates API costs, rate limiting concerns, secrets management, and non-deterministic behavior. AI is used at the remediation stage (Claude Code executing the generated prompts), not at the detection stage.

### 9.5 Generated Inventories Committed to Git

The `docs/_generated/` files are committed rather than gitignored. This enables the doc drift audit's diff-based detection strategy and makes the inventories browsable on GitHub without running scripts. The tradeoff is that PRs may include generated file diffs, but this is actually useful — it surfaces route/model/env changes in code review.

### 9.6 Prerequisite: Bulk Documentation Update

The system was not activated until a one-time bulk documentation update brought `docs/ARCHITECTURE.md` current (from ~30 documented routes to 91, from 3 models to 17, from 12 env vars to 29, plus 7 new feature sections). This prevented the automation from creating dozens of issues about known, pre-existing drift on its first run.

---

## 10. Development Methodology

### 10.1 Investigation-First Approach

The system was built following a phased exploration-then-implementation methodology designed to prevent AI agent hallucination:

1. **Exploration phase**: A structured markdown document (`docs_maintenance_exploration.md`, 1,297 lines) guided Claude Code through 6 phases of codebase investigation — existing documentation inventory, git hooks and tooling, CI/CD patterns, code-vs-docs drift comparison, implementation constraints, and refactoring signal baselines. Every finding was recorded with exact file paths, line counts, and command output.

2. **Planning phase**: Exploration findings were synthesized into implementation constraints and four separate implementation guides (Guides 0-3), each designed for a single Claude Code session with phased prompts and verification checkpoints.

3. **Implementation phase**: Each guide was executed by Claude Code with anti-hallucination rules — mandatory file reads before writes, PowerShell-only commands on Windows, exact path usage, no source code modifications outside the defined scope, and verification commands after every phase.

4. **Calibration phase**: The refactoring audit baselines were calibrated against actual CI output (adjusting dead exports from 3 to 86 after discovering the detection method's false-positive rate) rather than relying on manual estimates.

### 10.2 Anti-hallucination Guardrails

Every implementation guide included these rules for the AI coding agent:

- Read every referenced file before writing any code
- Never guess file contents, paths, or counts — run the command and verify
- Use exact paths from the filesystem, not assumed paths
- No source code modifications outside the defined scope
- Run TypeScript compilation (`npx tsc --noEmit`) after every phase to verify no regressions
- Compare actual counts against expected counts from the exploration phase
- If uncertain, re-read the file from disk rather than relying on context memory

### 10.3 Cross-validation

The system design was cross-validated between multiple AI systems (Claude Projects for architecture, Claude Code for implementation, Cursor.ai for data exploration) and validated against an independent AI review (ChatGPT analysis of the plan, which identified the generated inventories improvement and maturity ladder framework).

---

## 11. Operational Procedures

### 11.1 Daily Development Workflow

1. Develop features with Claude Code as normal
2. Standing instructions remind the agent to update docs during the session
3. On `git commit`, the pre-commit hook either:
   - Prints nothing (no doc-relevant changes, or docs were updated) → proceed normally
   - Prints a warning with a Claude Code prompt → copy prompt, paste into Claude Code, commit the doc update
4. On `git push`, if the doc drift audit triggers and finds drift, a GitHub Issue is created → open the issue, copy the prompt, paste into Claude Code, commit and push

### 11.2 Weekly Refactoring Review (Sundays)

1. Check GitHub Issues for a new refactoring audit issue
2. If no issue was created → codebase health is stable, nothing to do
3. If an issue was created → open it, scroll to the Claude Code Prompt section, copy the entire code block, paste into Claude Code, review what it changed, commit and push
4. If a metric permanently increased (known and accepted), update the baseline in `.github/workflows/refactor-audit.yml`

### 11.3 Baseline Updates

When a refactoring metric permanently changes (e.g., a new large file that won't be decomposed):

```powershell
# Edit .github/workflows/refactor-audit.yml
# Update the relevant BASELINE_* value in the env block
git add .github/workflows/refactor-audit.yml
git commit -m "fix: update refactor audit baseline — [reason]"
git push
```

### 11.4 Adding New Detection Categories

To add a new category to the pre-commit hook (e.g., monitoring changes to a new directory):

1. Add the pattern to `scripts/pre-commit-doc-check.js` in the category detection section
2. Add the corresponding mapping to the `.cursorrules` standing instructions table
3. Add the path to the `paths:` trigger in `.github/workflows/docs-audit.yml`

All three locations must stay synchronized. The Phase 3 verification in Guide 3 includes a cross-reference check for this.

---

## 12. Current Codebase Health Baselines (February 2026)

| Metric | Value | Threshold | Notes |
|--------|-------|-----------|-------|
| Total API routes | 91 | — | Across 18 feature areas |
| Total Prisma models | 17 | — | All documented in ARCHITECTURE.md §1-17 |
| Total environment variables | 29 | — | 11 additional undocumented process.env references |
| ARCHITECTURE.md coverage | 17 sections, 1,867 lines | — | Sections 1-10 (core) + 11-17 (features) + appendices |
| Files >500 lines | 25 | Baseline: 25 | Largest: query-compiler.ts (2,432 lines) |
| TODO/HACK/FIXME comments | 4 | Baseline: 4 | All active gaps in semantic layer compiler |
| npm audit (high severity) | 3 | Baseline: 3 | 2 in next@14, 1 in axios — require breaking upgrades |
| Potentially dead exports | 86 | Baseline: 86 | ~3 confirmed, remainder are false positives |
| Husky version | 9.1.7 | — | Installed as devDependency |
| Pre-commit hook | 383 lines | — | 8 detection categories, warn-only |

---

## 13. Known Limitations

1. **Standing instructions are not enforced.** The AI agent may ignore them under context pressure. Compliance is estimated at 60-70%.

2. **Dead export detection has a high false-positive rate.** The `grep -rw` approach cannot detect dynamic imports, barrel re-exports, or external consumers. The baseline of 86 reflects this. A more accurate approach would require a TypeScript AST analyzer (e.g., ts-prune), which was deferred in favor of the simpler static analysis.

3. **The doc drift audit cannot detect ARCHITECTURE.md narrative drift.** It only compares generated inventory files. If a route's behavior changes but its path doesn't, the inventory won't change and the audit won't fire. Narrative documentation accuracy still depends on Layers 1 and 3.

4. **No duplicate issue prevention.** If the doc drift audit fires on consecutive pushes before the first issue is resolved, it creates duplicate issues. A future improvement could check for existing open issues with the same label before creating a new one.

5. **Single developer optimization.** The system is optimized for a solo developer using AI agents. In a multi-developer team, the pre-commit hook would need to be supplemented with PR-level checks and the refactoring audit would need team-level triage processes.

6. **Windows-specific development.** The local development environment is Windows with PowerShell. All local commands and Claude Code prompts use PowerShell syntax. The GitHub Actions workflows run on ubuntu-latest with bash. This dual-environment setup was handled by using Node.js scripts for local logic (cross-platform) and bash only inside YAML workflow files.
