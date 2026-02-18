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
