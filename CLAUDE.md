# CLAUDE.md — Claude Code Standing Instructions

> This file is read automatically by Claude Code at session start.
> For Cursor-specific instructions, see `.cursorrules`.

## Project Overview

Savvy Wealth recruiting funnel analytics dashboard.

- **Stack**: Next.js 14, TypeScript, Tailwind CSS, Tremor React
- **Data**: Neon PostgreSQL (Prisma) + Google BigQuery (semantic layer)
- **Deployment**: Vercel (serverless)
- **Integrations**: Salesforce, Wrike, SendGrid, Claude API (Explore feature)

## Environment

- **Windows (win32)** — shell is bash (Git Bash / Husky hook context)
- Use Unix/bash commands: `grep`, `ls`, `head`, `wc -l`, `find` all work
- Do NOT use PowerShell-only commands: `Get-Content`, `Test-Path`, `Get-ChildItem`, `Select-String`, `$env:VAR`

## Git Commit Protocol — Wrike Session Context

**Before every `git commit`, you MUST write `.ai-session-context.md` first.**

A post-commit hook reads this file and auto-creates a Wrike task card in the Dashboards kanban. This is how we track all development work — do NOT skip this step.

Structure:

```
### Session Summary
One paragraph: what was built/fixed/changed.

### Business Context
Why — what problem, who asked, what it enables.

### Technical Approach
Key decisions and tradeoffs.

### What Changed
Brief list of meaningful changes.

### Verification
What was tested and how.
```

Rules:
- ALWAYS write this before `git commit` — never skip
- 10–20 lines total, concise
- Focus on WHY — the diff captures WHAT
- Do NOT stage the file — it is in .gitignore
- The hook deletes it after reading

## Documentation Maintenance

When you add, rename, remove, or significantly modify code, update the relevant documentation in the same session. See the full lookup table in `.cursorrules` under "Documentation Maintenance — Standing Instructions."

Key commands:
- `npm run gen:api-routes` — regenerate API route inventory
- `npm run gen:models` — regenerate Prisma model inventory
- `npm run gen:env` — regenerate env var inventory
- `npm run gen:all` — regenerate all inventories

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
