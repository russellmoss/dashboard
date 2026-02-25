# Multi-Agent Workflow Setup Guide

## What This Guide Does

This guide installs the complete multi-agent dashboard feature workflow into your project. After execution, you will have:

- 3 subagents in `.claude/agents/` (code-inspector, data-verifier, pattern-finder)
- 2 skills in `.claude/skills/` (new-feature, build-guide)
- Updated `CLAUDE.md` with workflow instructions
- Agent Teams enabled in your Claude Code settings
- Everything verified and ready to use

## Pre-Flight Checklist

Before starting, confirm we're in the right project and it's clean:

```bash
# 1. Confirm we're in the dashboard project root
ls package.json src/lib/queries/ src/types/ CLAUDE.md 2>&1

# 2. Check if .claude directory already exists
ls -la .claude/ 2>&1

# 3. Confirm agent-guard is installed
npx agent-guard --version 2>&1 || echo "agent-guard not found"

# 4. Confirm the project builds cleanly
npm run build 2>&1 | tail -10
```

**Expected**: `package.json`, `src/lib/queries/`, `src/types/`, and `CLAUDE.md` all exist. Build passes. `.claude/` may or may not exist yet.

If `CLAUDE.md` does not exist, stop and report — we need to create one from scratch instead of appending.

If the build has pre-existing errors, stop and report — do not proceed with a broken baseline.

**STOP AND REPORT**: Tell the user:
- "Pre-flight complete. Project confirmed at [path]. Build status: [pass/fail]."
- "CLAUDE.md [exists/does not exist]. .claude/ directory [exists/does not exist]."
- "Ready to proceed to Phase 1?"

---

# PHASE 1: Create Directory Structure

## Step 1.1: Create .claude directories

```bash
mkdir -p .claude/agents
mkdir -p .claude/skills/new-feature
mkdir -p .claude/skills/build-guide
```

## PHASE 1 — VALIDATION GATE

```bash
# Verify directory structure
find .claude -type d | sort
```

**Expected**:
```
.claude
.claude/agents
.claude/skills
.claude/skills/build-guide
.claude/skills/new-feature
```

**STOP AND REPORT**: Tell the user:
- "Phase 1 complete. Directory structure created."
- "Ready to proceed to Phase 2?"

---

# PHASE 2: Create Subagent Files

## Step 2.1: Create code-inspector agent

**File**: `.claude/agents/code-inspector.md`

Write the following content exactly:

```markdown
---
name: code-inspector
description: Read-only codebase investigation. Use proactively when exploring types, query functions, component structure, export paths, and file dependencies for a new feature. Never modifies files.
tools: Read, Grep, Glob, Bash
model: sonnet
permissionMode: plan
---

You are a code inspector for a Next.js 14 dashboard application that connects to BigQuery.

## Rules
- NEVER modify any files. Read-only investigation only.
- When asked to find all functions that return a specific type, use grep + read to be exhaustive.
- Report findings as structured facts: file path, line number, relevant code snippet.
- When investigating TypeScript types, trace the full chain: interface → all construction sites → all consumers.
- For query functions, report: SELECT columns, transform logic, return type, which API route calls it, and which component renders it.
- Check BOTH the type definition AND every place that constructs objects of that type — missing a construction site causes build failures.

## Architecture Context
- Query functions live in `src/lib/queries/`
- Types live in `src/types/` (dashboard.ts, bigquery-raw.ts, drill-down.ts)
- Two export paths exist: ExportButton (uses Object.keys — auto-includes new fields) and ExportMenu/MetricDrillDownModal (explicit column mappings — must be updated manually)
- API routes in `src/app/api/dashboard/` are pass-through — they rarely need changes
- Some components manually construct typed records from raw query results (e.g., ExploreResults.tsx) — always check for these
```

## Step 2.2: Create data-verifier agent

**File**: `.claude/agents/data-verifier.md`

Write the following content exactly:

```markdown
---
name: data-verifier
description: BigQuery data verification and schema exploration. Use for checking field population rates, data quality, value distributions, view definitions, and schema questions. Has MCP access to BigQuery.
tools: Read, Bash, mcp__*
model: sonnet
---

You are a data verification specialist with MCP access to BigQuery.

## Rules
- You have MCP access to BigQuery. USE IT to run queries and inspect schema.
- Do NOT assume which views or tables are relevant — ask what the feature needs, then query INFORMATION_SCHEMA or the views directly to discover the right sources.
- The primary analytics view is `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`, but other views and tables exist in the `savvy-gtm-analytics` project. Explore as needed.
- Always use parameterized queries — never string interpolation.
- If a feature might require changes to a BigQuery view, flag this explicitly. Report what columns exist, what's missing, and what the view's SQL logic does for the relevant fields.

## Standard Checks
For any new field being added to exports:
1. Population rate: `SELECT COUNTIF(field IS NOT NULL) / COUNT(*) as rate`
2. Value distribution: `SELECT field, COUNT(*) GROUP BY 1 ORDER BY 2 DESC LIMIT 20`
3. Max length (text fields): `SELECT MAX(LENGTH(field))`
4. Edge cases: NULLs, empty strings, newlines, special characters
5. Cross-field consistency: Do related fields contradict each other?

## Schema Discovery
When you need to understand a view's structure:
- Query `INFORMATION_SCHEMA.COLUMNS` for column names and types
- If the view definition matters (e.g., a field might be computed or filtered), check the view SQL
- Flag any fields that are computed, filtered, or joined from multiple sources — these affect whether upstream changes are needed

## Reporting
- Report results as structured data with exact numbers
- Flag any surprising findings (field <5% populated, unexpected NULLs, truncation)
- If a field doesn't exist in the expected view, say so clearly and suggest where it might come from
```

## Step 2.3: Create pattern-finder agent

**File**: `.claude/agents/pattern-finder.md`

Write the following content exactly:

```markdown
---
name: pattern-finder
description: Finds implementation patterns in existing code. Use when understanding how similar features were built — export paths, transform patterns, date handling, type structures.
tools: Read, Grep, Glob, Bash
model: sonnet
permissionMode: plan
---

You are a pattern analyst for a Next.js 14 dashboard. Your job is to find and document existing implementation patterns so new features follow them consistently.

## Rules
- NEVER modify files. Read-only.
- When asked about a pattern, trace the FULL data flow path: BigQuery view → query function SELECT → transform → return type → API route → component → export/CSV
- Document each pattern as: Entry Point → Data Flow → Key Files → Code Snippets
- Pay special attention to:
  - Date handling: `extractDate()` vs `extractDateValue()` — which files use which?
  - Type coercion: `toString()`, `toNumber()` from bigquery-raw.ts
  - NULL handling: what's the convention for nullable vs required fields?
  - CSV export column mapping: explicit (ExportMenu) vs auto (ExportButton/Object.keys)
- When comparing multiple implementations of the same pattern across files, flag any inconsistencies — these often indicate bugs or evolution of the codebase
- Report which patterns are consistent vs which have drift between files
```

## PHASE 2 — VALIDATION GATE

```bash
# 1. Verify all 3 agent files exist
ls -la .claude/agents/

# 2. Verify each file has valid YAML frontmatter (starts with ---)
head -1 .claude/agents/code-inspector.md
head -1 .claude/agents/data-verifier.md
head -1 .claude/agents/pattern-finder.md

# 3. Verify agent names in frontmatter
grep "^name:" .claude/agents/*.md

# 4. Verify key content is present
grep -l "NEVER modify" .claude/agents/code-inspector.md
grep -l "MCP access to BigQuery" .claude/agents/data-verifier.md
grep -l "FULL data flow path" .claude/agents/pattern-finder.md

# 5. Check file sizes are reasonable (each should be 800-1500 bytes)
wc -c .claude/agents/*.md
```

**Expected**: 3 files, each starting with `---`, names match `code-inspector`, `data-verifier`, `pattern-finder`. All grep checks find matches. File sizes between 800-1500 bytes each.

**STOP AND REPORT**: Tell the user:
- "Phase 2 complete. Created 3 subagent files in `.claude/agents/`."
- "Agents: code-inspector (read-only), data-verifier (BigQuery MCP), pattern-finder (read-only)."
- "Ready to proceed to Phase 3?"

---

# PHASE 3: Create Skill Files

## Step 3.1: Create new-feature skill

**File**: `.claude/skills/new-feature/SKILL.md`

Write the following content exactly:

```markdown
---
name: new-feature
description: "Kick off a new dashboard feature with parallel exploration. Use when adding fields, metrics, or capabilities to the dashboard. Spawns an agent team for codebase inspection, data verification, and pattern analysis."
---

# New Dashboard Feature — Parallel Exploration

You are starting the exploration phase for a new dashboard feature. The user will describe what they want to add. Your job is to run a parallel investigation and produce a comprehensive exploration report.

## Step 1: Understand the Feature

If not already clear from the user's request, ask:
- What fields, metrics, or capabilities are being added?
- Which parts of the dashboard should be affected? (main dashboard, pipeline, SGA Hub, Explore, all?)
- Are there specific BigQuery fields they already know about, or should you discover them?

Do NOT ask more than necessary — infer what you can from the request.

## Step 2: Create Agent Team

Spawn an agent team with 3 teammates:

### Teammate 1: Code Inspector (use code-inspector agent)
Investigate:
- What TypeScript types need new fields? (DetailRecord, DrillDownRecordBase, raw BQ types, and any others)
- What query functions return records that will need changes? List ALL of them — missing one causes build failure
- What export paths exist and which need manual column mapping updates vs auto-include?
- What API routes are involved and are they pass-through or do they transform data?
- Are there any components that manually construct typed records from raw data? (e.g., ExploreResults.tsx drilldown handler)
- Save findings to `code-inspector-findings.md` in the project root

### Teammate 2: Data Verifier (use data-verifier agent)
Investigate using MCP access to BigQuery:
- Do the source fields exist in the relevant BigQuery view(s)? If not, what view changes are needed?
- What are the population rates, value distributions, and data quality for each field?
- Are there edge cases that will affect CSV export? (newlines, special chars, long text, encoding)
- Are there cross-field consistency issues?
- If a view modification is needed, document what needs to change and flag it as a blocker
- Save findings to `data-verifier-findings.md` in the project root

### Teammate 3: Pattern Finder (use pattern-finder agent)
Investigate:
- How do existing similar fields flow end-to-end from BigQuery to CSV export?
- What's the exact transform pattern in each query file that needs changes?
- Are there inconsistencies between query files we should be aware of?
- What date handling, null handling, and type coercion patterns should the new feature follow?
- Save findings to `pattern-finder-findings.md` in the project root

## Step 3: Synthesize Results

Once all teammates complete, read all three findings files and produce `exploration-results.md` containing:

### Sections:
1. **Feature Summary** — What's being added, which fields, which source columns
2. **BigQuery Status** — Fields exist ✅/❌, view changes needed, data quality
3. **Files to Modify** — Complete list with file paths, function names, what changes
4. **Type Changes** — Exact fields to add to each TypeScript interface
5. **Construction Site Inventory** — Every code location that constructs modified types
6. **Recommended Phase Order** — Ordered phases with rationale
7. **Risks and Blockers** — View changes, CSV escaping, missing dates, inconsistencies
8. **Documentation** — Implementation guide must include `npx agent-guard sync` phase

## Step 4: Present to User

Tell the user:
- "Exploration complete. [N] files to modify, [blockers if any]."
- "Run `/build-guide` to generate the implementation guide, or investigate further."
```

## Step 3.2: Create build-guide skill

**File**: `.claude/skills/build-guide/SKILL.md`

Write the following content exactly:

```markdown
---
name: build-guide
description: "Build an agentic implementation guide from exploration results. Use after /new-feature exploration completes. Creates a phased, validation-gated guide that another agent can execute step-by-step."
---

# Build Agentic Implementation Guide

You are building an implementation guide from completed exploration results. The guide must be executable by a single Claude Code agent working phase-by-phase with human checkpoints.

## Prerequisites

Before starting, verify that exploration files exist:
- `exploration-results.md` (synthesized findings)
- `code-inspector-findings.md`
- `data-verifier-findings.md`
- `pattern-finder-findings.md`

Read ALL of them. The exploration results are the primary source, but the raw findings files contain detail you'll need for exact line numbers, code snippets, and edge cases.

## Guide Structure

Create `agentic_implementation_guide.md` in the project root with this exact structure:

### Header Section

# Agentic Implementation Guide: [Feature Name]

## Reference Document
All decisions in this guide are based on the completed exploration files.
Those documents are the single source of truth.

## Feature Summary
[Table of new fields/capabilities being added, their sources, and notes]

## Architecture Rules
- Never use string interpolation in BigQuery queries — always @paramName
- All queries target the appropriate view via constants
- Use toString()/toNumber() helpers for type-safe transforms
- Use extractDate()/extractDateValue() for date fields
- Do not modify API routes unless they transform data (most are pass-through)

## Pre-Flight Checklist
npm run build 2>&1 | head -50
If pre-existing errors, stop and report. Do not proceed with a broken baseline.

### Phase Pattern

Every phase follows this template:

# PHASE N: [Title]

## Context
[Why this phase exists, what it does, which files are affected]

## Step N.1: [Specific action]
**File**: [exact path]
[Exact code to add/change, with before/after when helpful]

## PHASE N — VALIDATION GATE
[bash commands to verify: tsc, lint, grep for expected patterns]

**Expected**: [What the output should look like]

**STOP AND REPORT**: Tell the user:
- "[Summary of what was done]"
- "[Error count change if applicable]"
- "[What's next]"
- "Ready to proceed to Phase [N+1]?"

### Standard Phase Order

**Phase 1: Blocking Prerequisites**
- CSV escaping fixes (if free-text fields with newlines)
- Any other infrastructure fixes that must come first
- Skip if exploration found no prerequisites needed

**Phase 2: Utility Functions**
- New calculation functions (e.g., calculateDaysInStage)
- Add to existing util files, don't create new ones
- Define function signature based on the types that will exist after Phase 3

**Phase 3: Type Definitions**
- Update TypeScript interfaces with new REQUIRED (non-optional) fields
- This INTENTIONALLY breaks the build — TypeScript errors become the Phase 4-7 checklist
- Update ALL relevant types: dashboard types, raw BQ types, drill-down types
- Validation gate: COUNT the errors and list which files have them

**Phase 4: Main Dashboard Query**
- `src/lib/queries/detail-records.ts` (usually)
- Add columns to SELECT, add fields to transform, wire up calculations
- Merge imports into existing import statements (don't add duplicate imports)

**Phase 5: Pipeline Queries**
- `src/lib/queries/open-pipeline.ts` (usually)
- Multiple functions — list ALL of them from exploration results
- Functions whose output doesn't reach exports still need type compliance (minimal fields, null for calculations)
- Unfreeze any hardcoded nulls that should now be real values
- Verify SELECT consistency across functions that should match

**Phase 6: Drill-Down Queries**
- `src/lib/queries/drill-down.ts` (usually)
- Multiple functions with different record types
- Each has its own relevant subset of stage entry dates
- Match the patterns found by pattern-finder

**Phase 7: Component Export Mappings**
- Update explicit column mappings in ExportMenu, MetricDrillDownModal, etc.
- Update any components that manually construct typed records (ExploreResults.tsx drilldown handler, etc.)
- This is where the code-inspector's "construction site inventory" is critical — every site must be covered
- Validation gate: `npm run build` must pass with ZERO errors

**Phase 7.5: Documentation Sync**
Run: npx agent-guard sync
Review changes to ARCHITECTURE.md and generated inventories. Stage if correct.

**Phase 8: UI/UX Validation (Requires User)**
- Present test groups for the user to verify in the browser
- Each test group: steps to perform, what to verify in the CSV, question to ask user
- Cover: pipeline drilldown, main dashboard, SGA Hub, Explore, spot-check accuracy

### Critical Rules for Guide Quality

1. **Every construction site must be covered.** Cross-reference the code-inspector's findings. If 4 functions return `DetailRecord[]`, all 4 must be updated. If a component manually builds records from raw rows, it must include all new required fields.

2. **Include both approaches for transforms.** Show the named-variable pattern AND the inline pattern, let the executing agent pick whichever fits the existing code structure.

3. **Validation gates must have concrete grep commands.** Not "verify the changes" — actual bash commands that produce checkable output.

4. **Import merges, not additions.** Always say "add X to the EXISTING import from Y" — never add a second import from the same module.

5. **Phase 3 errors are the checklist.** Explicitly state that build errors after Phase 3 are expected and represent the work remaining. Count them and track the count decreasing through phases.

6. **Include a Troubleshooting Appendix.** Common causes of persistent TypeScript errors, CSV corruption, null values, negative numbers. Draw from the data-verifier's edge case findings.

7. **Include Known Limitations.** Document any proxies, workarounds, or intentionally-null fields with rationale.

8. **Agent-guard sync before UI validation.** Always include `npx agent-guard sync` as Phase 7.5 (after code changes pass build, before browser testing).

## Output

Save the guide as `agentic_implementation_guide.md` in the project root.

**STOP AND REPORT**: Tell the user:
- "Implementation guide complete: `agentic_implementation_guide.md`"
- "[N] phases, [M] files to modify, [K] functions to update"
- "**Recommended next step**: Take this guide plus the exploration docs to another LLM (Gemini, GPT, etc.) for cross-validation before execution. Look for: missing construction sites, incorrect file paths, and logic gaps."
- "When validated, run: `Read agentic_implementation_guide.md top to bottom. Execute each phase sequentially. Stop and report at every gate. Start with Pre-Flight.`"
```

## PHASE 3 — VALIDATION GATE

```bash
# 1. Verify both skill files exist
ls -la .claude/skills/new-feature/SKILL.md
ls -la .claude/skills/build-guide/SKILL.md

# 2. Verify YAML frontmatter starts correctly
head -1 .claude/skills/new-feature/SKILL.md
head -1 .claude/skills/build-guide/SKILL.md

# 3. Verify skill names in frontmatter
grep "^name:" .claude/skills/*/SKILL.md

# 4. Verify key content is present
grep -l "Spawn an agent team" .claude/skills/new-feature/SKILL.md
grep -l "agentic_implementation_guide.md" .claude/skills/build-guide/SKILL.md
grep -l "agent-guard sync" .claude/skills/build-guide/SKILL.md

# 5. Check file sizes (new-feature ~2500-3500 bytes, build-guide ~4000-6000 bytes)
wc -c .claude/skills/*/SKILL.md
```

**Expected**: Both files exist, frontmatter valid, names are `new-feature` and `build-guide`. All grep checks match. File sizes in expected ranges.

**STOP AND REPORT**: Tell the user:
- "Phase 3 complete. Created 2 skill files."
- "Skills: `/new-feature` (parallel exploration) and `/build-guide` (implementation guide builder)."
- "Ready to proceed to Phase 4?"

---

# PHASE 4: Update CLAUDE.md with Workflow Instructions

## Context

The project's `CLAUDE.md` needs a new section that teaches every Claude Code session about the multi-agent workflow, BigQuery conventions, and documentation sync requirements. This section should be APPENDED to the existing `CLAUDE.md` — do NOT overwrite or modify any existing content.

## Step 4.1: Read current CLAUDE.md

Read the entire `CLAUDE.md` file first. Note where it ends — we'll append after the last line.

## Step 4.2: Append workflow section

Add the following block at the end of `CLAUDE.md`, separated by a blank line from existing content:

```markdown

## Feature Development Workflow

### Exploration Phase
Use `/new-feature` skill to spawn parallel agent team (code-inspector,
data-verifier, pattern-finder). Each saves findings to project root.
Lead synthesizes into exploration-results.md.

### Guide Building Phase
Use `/build-guide` skill to create agentic_implementation_guide.md from
exploration results + actual source code inspection.

### Cross-LLM Validation
Before executing: take the guide + exploration results to another LLM
(Gemini, GPT, DeepSeek) for adversarial review. Fix any gaps found.

### Execution Phase
Single Claude Code agent executes the guide phase-by-phase with
validation gates and stop-and-report checkpoints. Phase 3 (types)
intentionally breaks build as checklist. Never skip validation gates.

### Critical Rule
Every code path that constructs a DetailRecord or DrillDownRecord must
include ALL required fields. Missing even one construction site causes
build failure. The code-inspector subagent should find all of them
during exploration.

### BigQuery
- Multiple views and tables exist in the `savvy-gtm-analytics` project
- The primary analytics view is `vw_funnel_master` but features may
  require other views or view modifications
- The data-verifier subagent has MCP access to BigQuery — use it to
  discover schema, not assumptions
- Never use string interpolation in queries — always @paramName syntax

### Documentation
- This project uses `agent-guard` for documentation sync
- After completing code changes, always run `npx agent-guard sync`
  before committing
- Generated docs in `docs/_generated/` are auto-maintained — never
  edit them manually
- The pre-commit hook runs generators automatically, but explicit
  sync ensures narrative docs (ARCHITECTURE.md, README.md) are
  updated too
- Every implementation guide must include a doc sync phase (7.5)
  after code changes pass build and before UI validation
```

**CRITICAL**: Do NOT remove or modify any existing content in `CLAUDE.md`. Only append.

## PHASE 4 — VALIDATION GATE

```bash
# 1. Verify the new section exists
grep -c "Feature Development Workflow" CLAUDE.md
# Expected: 1

# 2. Verify all subsections are present
grep "Exploration Phase" CLAUDE.md
grep "Guide Building Phase" CLAUDE.md
grep "Cross-LLM Validation" CLAUDE.md
grep "Execution Phase" CLAUDE.md
grep "Critical Rule" CLAUDE.md
grep "BigQuery" CLAUDE.md
grep "Documentation" CLAUDE.md

# 3. Verify agent-guard reference
grep "agent-guard" CLAUDE.md

# 4. Verify the existing content wasn't damaged — check first few lines still match
head -5 CLAUDE.md

# 5. Count total lines (should be previous count + ~45 new lines)
wc -l CLAUDE.md
```

**Expected**: "Feature Development Workflow" appears exactly once. All subsection greps match. First 5 lines of CLAUDE.md are unchanged from before.

**STOP AND REPORT**: Tell the user:
- "Phase 4 complete. Appended Feature Development Workflow section to `CLAUDE.md`."
- "Existing content preserved. Added sections: Exploration, Guide Building, Cross-LLM Validation, Execution, Critical Rule, BigQuery, Documentation."
- "Ready to proceed to Phase 5?"

---

# PHASE 5: Enable Agent Teams

## Context

Claude Code's Agent Teams feature is experimental and must be explicitly enabled. This requires setting an environment variable in your Claude Code settings.

## Step 5.1: Check current settings

```bash
# Check if settings file exists
cat ~/.claude/settings.json 2>/dev/null || echo "No settings file found"

# Check if agent teams is already enabled
grep -r "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" ~/.claude/settings.json 2>/dev/null || echo "Agent teams not configured"
```

## Step 5.2: Enable agent teams

If `~/.claude/settings.json` does not exist, create it:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

If the file already exists, add the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` key to the existing `env` object. If there is no `env` object, add one. Do NOT overwrite other settings.

**IMPORTANT**: Be careful with JSON syntax. The file must be valid JSON after editing.

## PHASE 5 — VALIDATION GATE

```bash
# 1. Verify settings file exists and is valid JSON
cat ~/.claude/settings.json | python3 -c "import sys,json; json.load(sys.stdin); print('Valid JSON')" 2>&1

# 2. Verify agent teams is enabled
grep "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" ~/.claude/settings.json

# 3. Verify the value is "1"
python3 -c "
import json
with open('$HOME/.claude/settings.json') as f:
    d = json.load(f)
    val = d.get('env', {}).get('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')
    print(f'Agent Teams enabled: {val == \"1\"}')
    print(f'Value: {val}')
"
```

**Expected**: Valid JSON, agent teams key present, value is "1".

**NOTE**: Agent Teams will take effect in the NEXT Claude Code session. The current session will not have it active. This is expected.

**STOP AND REPORT**: Tell the user:
- "Phase 5 complete. Agent Teams enabled in `~/.claude/settings.json`."
- "**Important**: Agent Teams will be active in your next Claude Code session, not this one."
- "Ready to proceed to Phase 6 (final verification)?"

---

# PHASE 6: Full Verification

## Context

This phase does a comprehensive check of everything installed. No files are created or modified — this is purely verification.

## Step 6.1: Verify complete file structure

```bash
echo "=== Directory Structure ==="
find .claude -type f | sort

echo ""
echo "=== Expected Files ==="
echo ".claude/agents/code-inspector.md"
echo ".claude/agents/data-verifier.md"
echo ".claude/agents/pattern-finder.md"
echo ".claude/skills/new-feature/SKILL.md"
echo ".claude/skills/build-guide/SKILL.md"
```

## Step 6.2: Verify all frontmatter is valid

```bash
echo "=== Agent Frontmatter ==="
for f in .claude/agents/*.md; do
  echo "--- $f ---"
  grep "^name:\|^description:\|^tools:\|^model:" "$f"
  echo ""
done

echo "=== Skill Frontmatter ==="
for f in .claude/skills/*/SKILL.md; do
  echo "--- $f ---"
  grep "^name:\|^description:" "$f"
  echo ""
done
```

## Step 6.3: Verify CLAUDE.md integration

```bash
echo "=== CLAUDE.md Workflow Sections ==="
grep -n "## Feature Development Workflow\|### Exploration Phase\|### Guide Building Phase\|### Cross-LLM Validation\|### Execution Phase\|### Critical Rule\|### BigQuery\|### Documentation" CLAUDE.md
```

## Step 6.4: Verify agent teams setting

```bash
echo "=== Agent Teams Setting ==="
python3 -c "
import json, os
path = os.path.expanduser('~/.claude/settings.json')
with open(path) as f:
    d = json.load(f)
enabled = d.get('env', {}).get('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS') == '1'
print(f'Agent Teams enabled: {enabled}')
"
```

## Step 6.5: Verify project still builds

```bash
npm run build 2>&1 | tail -10
```

## PHASE 6 — VALIDATION GATE

**Expected results**:
- 5 files in `.claude/` (3 agents + 2 skills)
- All frontmatter has `name:` and `description:` fields
- Agent tools: code-inspector has `Read, Grep, Glob, Bash`; data-verifier has `Read, Bash, mcp__*`; pattern-finder has `Read, Grep, Glob, Bash`
- Skill names: `new-feature` and `build-guide`
- CLAUDE.md has all 7 workflow subsections on distinct line numbers
- Agent Teams is enabled
- Project build still passes

**STOP AND REPORT**: Tell the user:

"Setup complete. Here's what was installed:"

"**Subagents** (`.claude/agents/`):"
- "`code-inspector` — Read-only codebase exploration (types, queries, exports, construction sites)"
- "`data-verifier` — BigQuery schema/data verification via MCP (population rates, edge cases, view changes)"
- "`pattern-finder` — Implementation pattern analysis (transform patterns, date handling, inconsistencies)"

"**Skills** (`.claude/skills/`):"
- "`/new-feature` — Spawns parallel agent team for feature exploration → produces exploration-results.md"
- "`/build-guide` — Builds phased implementation guide from exploration results → produces agentic_implementation_guide.md"

"**CLAUDE.md** — Appended Feature Development Workflow section with exploration, guide building, cross-LLM validation, execution, BigQuery, and documentation sync instructions."

"**Agent Teams** — Enabled in settings. Will be active in your next Claude Code session."

"**To use the workflow**, start a new Claude Code session and type:"
```
/new-feature Add [description of what you want to add]
```

"After exploration completes, type:"
```
/build-guide
```

"Then take the guide to another LLM for cross-validation, and execute."

---

# TROUBLESHOOTING APPENDIX

## If `/new-feature` or `/build-guide` don't appear as slash commands

Skills are loaded when Claude Code starts. If you created them during an active session, you need to restart Claude Code for them to appear. Exit and re-enter.

## If agent teams don't work

Agent Teams is experimental and requires the environment variable to be set BEFORE the session starts. Verify:
```bash
echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
```
If empty, the setting didn't take effect. Check `~/.claude/settings.json` is valid JSON and restart.

## If data-verifier can't access BigQuery

The `mcp__*` tool pattern grants access to all MCP servers. If BigQuery MCP is not connected, the agent will fail. Verify your MCP configuration includes a BigQuery connection.

## If the build breaks after setup

This setup does NOT modify any source code. If the build breaks, it was already broken before setup or an unrelated change occurred. Run:
```bash
git diff --name-only
```
Only `.claude/` files and `CLAUDE.md` should show changes.

## If CLAUDE.md was damaged

Check git for the diff:
```bash
git diff CLAUDE.md
```
Only additions at the end should appear. If existing content was modified, restore with:
```bash
git checkout CLAUDE.md
```
Then re-run Phase 4 manually.
