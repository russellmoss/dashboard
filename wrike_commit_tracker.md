# Wrike Commit Tracking — Agentic Execution Guide

> **Purpose**: Auto-create a Wrike task in the Dashboards kanban on every git commit, with an AI-generated description of what was done and why. Claude Code and Cursor write a session context file before each commit (per standing instructions), and a post-commit hook reads it, calls Claude API for a description, then creates a Wrike task via the existing Wrike API integration.
> **Prerequisites**: Husky installed (Guide 2 complete), Wrike integration working (dashboard requests sync to Wrike), `WRIKE_ACCESS_TOKEN` and `ANTHROPIC_API_KEY` in environment.
> **Date**: 2026-02-18
> **Estimated Time**: ~1.5–2 hours in one Claude Code session

---

## ⚠️ Shell Environment Note

This project runs on **Windows (win32)** but uses **bash shell** (Git Bash / Husky hook context). Claude Code also runs in bash. Use Unix/bash syntax for all commands. Do NOT use PowerShell-only commands like `Get-Content`, `Test-Path`, `Get-ChildItem`, `Select-String`, or `$env:VAR` syntax.

---

## What We're Building

### Post-commit Hook (New)
A Node.js script (`scripts/post-commit-wrike.js`) that runs after every `git commit`:

1. **Reads `.ai-session-context.md`** if it exists (written by Claude Code / Cursor per standing instructions) → rich mode
2. **Falls back to git diff parsing** if no context file exists → diff-only mode
3. **Calls Claude API** to generate a professional task description
4. **Calls Wrike API** (reusing your existing `WRIKE_ACCESS_TOKEN`) to create a task in the **Dashboards** folder (`MQAAAAEEBpOb`) with **Backlog** status
5. **Cleans up** the session context file after reading it
6. **Never blocks commits** — all errors are caught and logged, exit 0 always

### Standing Instructions (Added to both .cursorrules and new CLAUDE.md)
Instructions that tell Claude Code / Cursor: "Before every `git commit`, write `.ai-session-context.md`." This happens automatically — no manual prompting needed.

### Flow After Implementation
```
Claude Code session → does work → writes .ai-session-context.md (automatic)
  → git commit → pre-commit hook (existing: doc check)
               → post-commit hook (NEW: Wrike task creation)
                    → reads context file + diff
                    → Claude API generates description
                    → Wrike API creates task in Dashboards/Backlog
You: drag task from Backlog → Done in Wrike when ready
```

---

## How to Use This Guide

1. Open Claude Code in your project root (`C:\Users\russe\Documents\Dashboard`)
2. Copy-paste each **PHASE PROMPT** into Claude Code one at a time
3. After each phase, Claude Code runs verification steps and reports results
4. Where indicated, YOU perform manual checks before proceeding
5. Do NOT skip phases — each phase depends on the previous one passing verification

---

## PHASE 1: Explore Existing Infrastructure

### Prompt

```
You are implementing the Wrike Commit Tracking feature. Before writing ANY code, you must understand the existing infrastructure.

⚠️ RULES:
- Shell is bash. Use Unix commands or Claude Code's native tools (Read, Glob, Grep, Bash).
- Do NOT write any files in this phase. Read only.
- Record all findings — you will need them in later phases.

**Step 1.1** — Read `src/types/wrike.ts` in full. Record:
- The existing WRIKE_CONFIG object (folder ID, workflow ID, all status IDs)
- All type exports (WrikeTask, CreateTaskData, etc.)
- What STATUS_TO_WRIKE and WRIKE_TO_STATUS map
- Does a DASHBOARDS_WRIKE_CONFIG already exist? (It should NOT — we're adding it)

**Step 1.2** — Read `src/lib/wrike.ts` in full. Record:
- What class/functions are exported (WrikeClient, syncToWrike, etc.)
- How createTask is called — what parameters does it take?
- How is the Wrike API token accessed? (env var name)
- How is the folder ID determined? (env var fallback to config)
- What does isWrikeConfigured() check?

**Step 1.3** — Read `.husky/pre-commit` in full. Record its exact contents.

**Step 1.4** — Check if `.husky/post-commit` exists:
```bash
[ -f .husky/post-commit ] && echo "EXISTS" || echo "NOT FOUND"
```
Record: does it exist? If yes, read its contents.

**Step 1.5** — Read `scripts/pre-commit-doc-check.js` — just the first 30 lines and the last 20 lines. Record:
- What pattern does it follow? (CommonJS? How does it handle errors?)
- How does it interact with git? (what commands does it exec?)
- Does it exit 0 always?

**Step 1.6** — Read `package.json`. Record:
- Is "type": "module" set? (determines .js vs .cjs for our script)
- Does a "prepare" script exist?
- Is Husky in devDependencies?
- What is the ANTHROPIC_API_KEY env var name used elsewhere? Search for it:
```bash
grep -r "ANTHROPIC" src/ --include="*.ts" -l | head -5
```

**Step 1.7** — Read `.gitignore` in full. Record:
- Is `.ai-session-context.md` already listed? (It should NOT be — we're adding it)
- What other generated/temp files are ignored?

**Step 1.8** — Read `.cursorrules` in full. Record:
- Total line count
- All section headers (## and ###)
- Where is "Documentation Maintenance — Standing Instructions"?
- What is the LAST section? (We will add our new section after it)

**Step 1.9** — Check if `CLAUDE.md` exists:
```bash
[ -f CLAUDE.md ] && echo "EXISTS" || echo "NOT FOUND"
```
Record: does it exist? If yes, read its contents.

**Step 1.10** — Read `.env.local` (or `.env`) — just check what Wrike-related vars exist:
```bash
grep -E "WRIKE|ANTHROPIC" .env.local 2>/dev/null || true
grep -E "WRIKE|ANTHROPIC" .env 2>/dev/null || true
```
Record: which env vars are set? (Do NOT record values, just var names)

Report findings in this format:
```
Phase 1 Exploration Complete:
- WRIKE_CONFIG folder ID: [X]
- Dashboards folder ID from discovery scripts: MQAAAAEEBpOb
- WrikeClient exports: [list them]
- createTask signature: [describe it]
- Wrike token env var: [name]
- .husky/pre-commit: [exists, contents summary]
- .husky/post-commit: [exists or not]
- package.json type: [module or commonjs]
- Husky installed: [yes/no, version]
- .ai-session-context.md in .gitignore: [yes/no]
- CLAUDE.md exists: [yes/no]
- .cursorrules last section: [name]
- Env vars available: [list names only]
```
```

### Expected Outcome
- Full understanding of existing Wrike infrastructure
- Know exactly how createTask works
- Know hook setup pattern
- Know where to add new sections in .cursorrules
- No files modified

---

## PHASE 2: Discover Dashboards Workflow Status IDs

### Prompt

```
You are implementing Phase 2: Discover the actual Wrike status IDs for the Dashboards workflow.

⚠️ RULES:
- Shell is bash. Use Unix/bash syntax.
- Do NOT write any files in this phase.
- We need REAL status IDs from the Wrike API — do NOT use placeholder values.

**Step 2.1** — Read `scripts/discover-dashboards-workflow-v2.ts` in full. Understand what it does and what output it produces.

**Step 2.2** — Run the discovery script:
```bash
npx ts-node scripts/discover-dashboards-workflow-v2.ts
```

If ts-node fails, try:
```bash
npx tsx scripts/discover-dashboards-workflow-v2.ts
```

**Step 2.3** — Record the EXACT output. We need:
- Workflow name and ID (should be IEAGT6KAK4GPYD3U)
- Every status in the workflow with:
  - Status name
  - Status ID
  - Status group (Active, Completed, Cancelled)

**Step 2.4** — Map the statuses to our needs:
- Which status ID = "Backlog" or the first Active status? → This is where new commit tasks land.
- Which status ID = "Done" or Completed? → This is where you drag tasks when finished.

Record in this format:
```
Phase 2 Discovery Complete:
- Dashboards Workflow ID: IEAGT6KAK4GPYD3U
- Dashboards Folder ID: MQAAAAEEBpOb
- BACKLOG status: "[name]" → ID: [exact ID]
- PLANNED status: "[name]" → ID: [exact ID]  
- IN_PROGRESS status: "[name]" → ID: [exact ID]
- DONE status: "[name]" → ID: [exact ID]
- CANCELLED status: "[name]" → ID: [exact ID] (if exists)
```

These EXACT IDs will be used in Phase 3. Do NOT proceed without them.
```

### Expected Outcome
- Real status IDs from Wrike API (not placeholders)
- Clear mapping of which status = Backlog for new tasks
- Ready to build config

---

## PHASE 3: Add Dashboards Config to wrike.ts

### Prompt

```
You are implementing Phase 3: Add the Dashboards project configuration to src/types/wrike.ts.

⚠️ RULES:
- Shell is bash. Use Unix/bash syntax.
- Read `src/types/wrike.ts` BEFORE modifying it.
- Do NOT modify any existing code in the file. Only ADD new exports after the existing ones.
- Use the EXACT status IDs discovered in Phase 2. Do NOT use placeholders.

**Step 3.1** — Read `src/types/wrike.ts` in full. Note the last line / last export.

**Step 3.2** — Add the following new config AFTER all existing exports (do not modify anything above):

Add a `DASHBOARDS_WRIKE_CONFIG` const export using the exact status IDs from Phase 2:

```typescript
// Dashboards Project Configuration (for dev commit tracking)
// Discovered from scripts/discover-dashboards-workflow-v2.ts
// Commit tasks are auto-created by scripts/post-commit-wrike.js
export const DASHBOARDS_WRIKE_CONFIG = {
  FOLDER_ID: 'MQAAAAEEBpOb', // Dashboards project
  WORKFLOW_ID: 'IEAGT6KAK4GPYD3U', // Dashboards Workflow

  STATUS_IDS: {
    BACKLOG: '[EXACT_ID_FROM_PHASE_2]',
    PLANNED: '[EXACT_ID_FROM_PHASE_2]',
    IN_PROGRESS: '[EXACT_ID_FROM_PHASE_2]',
    DONE: '[EXACT_ID_FROM_PHASE_2]',
  },
} as const;
```

Replace every `[EXACT_ID_FROM_PHASE_2]` with the real IDs you recorded in Phase 2.

**Step 3.3** — Verify the file is valid TypeScript:
```bash
npx tsc --noEmit 2>&1 | head -10
```
If there are errors, fix them before proceeding.

**Step 3.4** — Verify you did NOT modify existing exports:
```bash
git diff src/types/wrike.ts
```
The diff should show ONLY additions at the end of the file. No deletions, no modifications to existing lines.

Report:
```
Phase 3 Complete:
- DASHBOARDS_WRIKE_CONFIG added: [yes/no]
- BACKLOG status ID: [value]
- TypeScript compilation: [PASS/FAIL]
- Existing code modified: [NONE expected]
```
```

### Expected Outcome
- New config added without touching existing Wrike integration
- TypeScript compiles cleanly
- Only additions in the diff

---

## PHASE 4: Create the Post-Commit Wrike Script

### Prompt

```
You are implementing Phase 4: Create the post-commit hook script.

⚠️ RULES:
- Shell is bash. Use Unix/bash syntax.
- Read the files listed below BEFORE writing any code.
- This script must use CommonJS (require/module.exports) — the project does NOT have "type": "module" in package.json.
- The script must NEVER throw an unhandled error. Every code path must be wrapped in try/catch. The script must always exit cleanly.
- The script runs in the background after a commit. It must not block git operations.
- Use the existing WRIKE_ACCESS_TOKEN env var (same one the dashboard request integration uses).
- Use ANTHROPIC_API_KEY env var for Claude API calls.

**MANDATORY READS before writing:**
1. Read `scripts/pre-commit-doc-check.js` in full — match its style and patterns.
2. Read `src/types/wrike.ts` — reference the DASHBOARDS_WRIKE_CONFIG you added in Phase 3.
3. Read `src/lib/wrike.ts` — understand the API call pattern (but do NOT import from src/ — this script runs standalone with direct fetch calls, not through the Next.js app).

**Step 4.1** — Create `scripts/post-commit-wrike.js` with this architecture:

```
/**
 * Post-commit hook: Creates a Wrike task in the Dashboards kanban
 * with AI-generated description of what was done and why.
 *
 * Context sources (in priority order):
 * 1. .ai-session-context.md — written by Claude Code / Cursor (rich mode)
 * 2. Git diff analysis — fallback when no context file exists (diff-only mode)
 *
 * Non-blocking: catches all errors, never prevents commits.
 * Called from: .husky/post-commit
 */
```

The script must:

a) **Gather git context** using child_process.execSync:
   - Commit hash (short): `git rev-parse --short HEAD`
   - Commit message: `git log -1 --pretty=%B`
   - Branch name: `git rev-parse --abbrev-ref HEAD`
   - Files changed: `git diff-tree --no-commit-id --name-status -r HEAD`
   - Diff stats: `git diff-tree --no-commit-id --stat -r HEAD`
   - Condensed diff (max 4000 chars): `git diff HEAD~1 HEAD --unified=3` (wrap in try/catch for first commit)

b) **Read .ai-session-context.md** if it exists (path.join(process.cwd(), '.ai-session-context.md')):
   - If found: use rich prompt mode, set contextSource = 'ai-session'
   - If not found: use diff-only prompt mode, set contextSource = 'diff-only'

c) **Build the Claude API prompt** — two versions:
   
   Rich mode (with session context):
   - Include the full session context
   - Include git details (hash, branch, message, files)
   - Ask for: Summary (what + why), Technical Changes, Impact
   
   Diff-only mode (fallback):
   - Include commit message, files changed, diff stats, condensed diff
   - Ask for: Summary, Technical Changes
   - Tell Claude this is a "recruiting funnel analytics dashboard built with Next.js, BigQuery, and Prisma" for context

d) **Call Claude API** via fetch:
   - Endpoint: https://api.anthropic.com/v1/messages
   - Model: claude-sonnet-4-6
   - Max tokens: 1024
   - Headers: Content-Type, x-api-key (from ANTHROPIC_API_KEY), anthropic-version: 2023-06-01
   - Timeout: 30 seconds (use AbortController)
   - If API fails, use fallback description: commit message + file list

e) **Create Wrike task** via fetch:
   - Endpoint: https://www.wrike.com/api/v4/folders/{FOLDER_ID}/tasks
   - FOLDER_ID: MQAAAAEEBpOb (Dashboards — hardcode it, same as DASHBOARDS_WRIKE_CONFIG)
   - Auth header: Bearer {WRIKE_ACCESS_TOKEN}
   - Task title: `[{branch}] {commitMsg}` (truncated to 250 chars)
   - Task description: AI-generated text + metadata footer with commit hash, branch, context source, date
   - customStatus: BACKLOG status ID from DASHBOARDS_WRIKE_CONFIG (hardcode the exact ID from Phase 2)
   - metadata: [{ key: 'source', value: 'git-commit-hook' }, { key: 'commit_hash', value: '{full_hash}' }]

f) **Clean up**: Delete .ai-session-context.md after reading (so stale context doesn't attach to future commits)

g) **Logging**: Use console.log with `[wrike-commit]` prefix for all output. Log success with ✓, warnings with ⚠.

**Step 4.2** — Verify the script is syntactically valid:
```bash
node -c scripts/post-commit-wrike.js
```
Should print nothing (no syntax errors).

**Step 4.3** — Verify it handles missing env vars gracefully:
```bash
# Temporarily unset vars and run
WRIKE_ACCESS_TOKEN="" node scripts/post-commit-wrike.js
```
Should exit silently without errors when env vars are missing.

**Step 4.4** — Count lines and verify structure:
```bash
wc -l scripts/post-commit-wrike.js
```
Report line count. Script should be roughly 150-250 lines.

Report:
```
Phase 4 Complete:
- scripts/post-commit-wrike.js created: [yes/no]
- Line count: [X]
- Syntax check: [PASS/FAIL]
- Missing env var handling: [silent exit / error — should be silent]
- Context source modes: [rich + diff-only]
- Wrike folder ID: MQAAAAEEBpOb
- Backlog status ID: [value from Phase 2]
- Claude model: claude-sonnet-4-6
- Cleanup of context file: [yes/no]
```
```

### Expected Outcome
- Script created following pre-commit-doc-check.js patterns
- Syntax valid
- Handles all error cases gracefully
- Never blocks or throws

---

## PHASE 5: Wire Up the Husky Post-Commit Hook

### Prompt

```
You are implementing Phase 5: Connect the post-commit script to Husky.

⚠️ RULES:
- Shell is bash. Use Unix/bash syntax.
- Read before writing.
- The hook file uses shell syntax (runs in Git Bash on Windows).
- The hook must run the script in the BACKGROUND so commits aren't slowed down.

**Step 5.1** — Read `.husky/pre-commit` to confirm the pattern:
```bash
cat .husky/pre-commit
```
Record its exact contents — we'll mirror this pattern.

**Step 5.2** — Create `.husky/post-commit` with this exact content:

```sh
node scripts/post-commit-wrike.js &
```

The `&` runs it in the background so the commit completes immediately. The Wrike task creation happens asynchronously.

**Step 5.3** — Verify the file was created correctly:
```bash
cat .husky/post-commit
```
Should show exactly one line: `node scripts/post-commit-wrike.js &`

**Step 5.4** — Verify Husky will pick it up:
```bash
ls .husky/
```
Should show both `pre-commit` and `post-commit`.

Report:
```
Phase 5 Complete:
- .husky/post-commit created: [yes/no]
- Contents: node scripts/post-commit-wrike.js &
- Background execution: [yes — & present]
- Husky directory listing: [list files]
```
```

### Expected Outcome
- Post-commit hook file created
- Runs script in background
- Mirrors pre-commit pattern

---

## PHASE 6: Add Standing Instructions to .cursorrules and Create CLAUDE.md

### Prompt

```
You are implementing Phase 6: Add the session context standing instructions so Claude Code and Cursor automatically write .ai-session-context.md before every commit.

⚠️ RULES:
- Shell is bash. Use Unix/bash syntax.
- Read files BEFORE modifying them.
- For .cursorrules: Do NOT modify any existing content. Only ADD a new section.
- For CLAUDE.md: Create a new file. Do NOT copy the entire .cursorrules into it — CLAUDE.md should be concise and focused.

**Step 6.1** — Read `.cursorrules` in full. Find the LAST section header (##). Record it. Your new section goes AFTER it.

**Step 6.2** — Add the following new section to the END of `.cursorrules`:

```markdown
## Git Commit Protocol — Wrike Session Context

**Before every `git commit`, you MUST write a session context file to `.ai-session-context.md`.**

A post-commit hook reads this file and auto-creates a Wrike task card in the Dashboards kanban (Backlog column). This is how all development work is tracked.

**Write this file BEFORE running `git add` / `git commit`. The hook reads it from the working directory, then deletes it.**

Required structure:

```
### Session Summary
One paragraph: what was built, fixed, or changed this session.

### Business Context
Why this work was needed — the problem, who requested it, what it enables.

### Technical Approach
Key decisions made, tradeoffs considered, alternatives rejected.

### What Changed
Brief list of meaningful changes (focus on important files, not every file).

### Verification
What was tested and how — TypeScript compilation, manual UI testing, data validation, etc.
```

**Rules:**
- ALWAYS write this file before committing — never skip this step.
- Keep it concise: 10–20 lines total.
- Focus on the WHY — the git diff already captures what files changed.
- Do NOT stage `.ai-session-context.md` — it is in .gitignore.
- The post-commit hook deletes it after reading.
- If you make multiple commits in one session, write a fresh context file before each commit.
```

**Step 6.3** — Verify you did NOT modify any existing .cursorrules content:
```bash
git diff .cursorrules
```
The diff should show ONLY additions at the end. No deletions or modifications.

**Step 6.4** — Create `CLAUDE.md` in the project root with this content:

```markdown
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
```

**Step 6.5** — Verify CLAUDE.md was created:
```bash
[ -f CLAUDE.md ] && echo "EXISTS" || echo "NOT FOUND"
wc -l CLAUDE.md
```

**Step 6.6** — Verify total changes so far:
```bash
git diff --name-only
git status --short
```
Should show modifications/additions to: .cursorrules, CLAUDE.md, src/types/wrike.ts, scripts/post-commit-wrike.js, .husky/post-commit. Nothing else.

Report:
```
Phase 6 Complete:
- .cursorrules updated: [yes/no, new section added at end]
- Existing .cursorrules content modified: [NONE expected]
- CLAUDE.md created: [yes/no, line count]
- Both files contain commit protocol: [yes/no]
```
```

### Expected Outcome
- .cursorrules has new section at end, existing content untouched
- CLAUDE.md created with project overview + commit protocol
- Both tools (Claude Code + Cursor) will now auto-write session context

---

## PHASE 7: Update .gitignore and Final Verification

### Prompt

```
You are implementing Phase 7: Update .gitignore and run final verification.

⚠️ RULES:
- Shell is bash. Use Unix/bash syntax.
- Read files before modifying.

**Step 7.1** — Read `.gitignore` in full. Find an appropriate place to add the session context exclusion (near other generated/temp file entries).

**Step 7.2** — Add to `.gitignore`:
```
# AI session context (transient — consumed by post-commit hook)
.ai-session-context.md
```

**Step 7.3** — Verify the addition:
```bash
grep "ai-session-context" .gitignore
```

**Step 7.4** — Run TypeScript compilation to confirm nothing is broken:
```bash
npx tsc --noEmit
```
Should produce the same results as before (zero new errors from our changes).

**Step 7.5** — Verify the complete file inventory of all changes:
```bash
git diff --name-only
git status --short
```

Expected changed files (and ONLY these):
- `src/types/wrike.ts` (modified — added DASHBOARDS_WRIKE_CONFIG)
- `.cursorrules` (modified — added commit protocol section)
- `.gitignore` (modified — added .ai-session-context.md)
- `scripts/post-commit-wrike.js` (new)
- `.husky/post-commit` (new)
- `CLAUDE.md` (new)

If ANY other files appear (especially .ts or .tsx source files), revert them immediately:
```bash
# Example: git checkout -- path/to/unexpected/file.ts
```

**Step 7.6** — Verify no existing source code was modified:
```bash
git diff --name-only -- 'src/**/*.ts' 'src/**/*.tsx' | grep -v "src/types/wrike.ts"
```
Should return nothing. Only src/types/wrike.ts should have changes, and only additions.

**Step 7.7** — Dry-run the post-commit script to verify it handles the "no context file" case:
```bash
# Make sure no stale context file exists
[ -f .ai-session-context.md ] && rm .ai-session-context.md

# Run the script directly (outside of a commit context — it will try to read git state)
node scripts/post-commit-wrike.js
```
It should either:
- Create a Wrike task (diff-only mode) if env vars are set, OR
- Exit silently if env vars are missing
It must NOT crash or throw unhandled errors.

Report:
```
Phase 7 Complete:
- .gitignore updated: [yes/no]
- TypeScript compilation: [PASS/FAIL]
- Changed files: [list them — should be exactly 6]
- Unexpected source changes: [NONE expected]
- Dry-run result: [created task / silent exit / error]
```
```

### Expected Outcome
- All files accounted for
- No unexpected changes
- Script runs without errors
- TypeScript clean

---

## PHASE 8: End-to-End Test

### Prompt

```
You are implementing Phase 8: End-to-end test of the complete commit → Wrike flow.

⚠️ RULES:
- Shell is bash. Use Unix/bash syntax.
- This phase creates a TEST commit that we will REVERT after verification.
- Do NOT leave test artifacts in the codebase.

**Step 8.1** — First, test WITH a session context file. Create `.ai-session-context.md` manually:

Write this to `.ai-session-context.md`:
```
### Session Summary
Test commit to verify Wrike commit tracking integration.

### Business Context
Implementing automated development tracking — every commit auto-creates a Wrike task card for visibility into RevOps development work.

### Technical Approach
Post-commit hook reads this context file + git diff, calls Claude API for a description, then creates a Wrike task via the existing Wrike API integration.

### What Changed
- scripts/post-commit-wrike.js (new post-commit hook script)
- .husky/post-commit (hook wiring)
- CLAUDE.md (Claude Code standing instructions)

### Verification
End-to-end test: this commit should create a Wrike task in Dashboards/Backlog.
```

**Step 8.2** — Stage all our new files and make a test commit:
```bash
git add scripts/post-commit-wrike.js .husky/post-commit CLAUDE.md src/types/wrike.ts .cursorrules .gitignore
git commit -m "feat: add Wrike commit tracking with AI-generated descriptions"
```

**Step 8.3** — Watch the output. You should see:
```
[wrike-commit] ✓ Found session context file
[wrike-commit] ✓ Wrike task created: [main] feat: add Wrike commit tracking...
```

If you see warnings or errors, record them exactly.

**Step 8.4** — Verify in Wrike. The task should appear in:
- Folder: Dashboards (MQAAAAEEBpOb)
- Status: Backlog
- Title: `[branch] feat: add Wrike commit tracking with AI-generated descriptions`
- Description: AI-generated with session context (Summary, Technical Changes, Impact sections)
- Metadata footer: commit hash, branch, "ai-session" context source

**NOTE TO RUSSELL**: After this commit, check your Wrike Dashboards board. The task should be in Backlog. If it's there with a good description, the integration works. If the commit succeeded but no Wrike task appeared, check the console output for error messages.

**Step 8.5** — Verify the session context file was cleaned up:
```bash
[ -f .ai-session-context.md ] && echo "STILL EXISTS (problem)" || echo "Cleaned up (good)"
```
Should say "Cleaned up" (hook deletes it after reading).

**Step 8.6** — Test a second commit WITHOUT session context (diff-only fallback):
Make a trivial change:
```bash
echo "" >> CLAUDE.md
git add CLAUDE.md
git commit -m "test: verify diff-only Wrike task creation"
```

Check output — should say it's using diff-only mode and still create a Wrike task.

**Step 8.7** — Revert the test commit (keep the first real commit):
```bash
git reset --soft HEAD~1
git reset HEAD CLAUDE.md
git checkout -- CLAUDE.md
```

**Step 8.8** — Report final summary:

```
Phase 8 — End-to-End Test Complete:
- Test commit with context file: [SUCCESS/FAIL]
- Wrike task created (rich mode): [yes/no]
- Context file cleaned up: [yes/no]
- Test commit without context file: [SUCCESS/FAIL]
- Wrike task created (diff-only mode): [yes/no]
- Test commits reverted: [yes/no]
- Source code clean: [yes/no]

IMPLEMENTATION COMPLETE:
- scripts/post-commit-wrike.js: [X] lines
- .husky/post-commit: wired
- CLAUDE.md: created ([X] lines)
- .cursorrules: commit protocol section added
- .gitignore: .ai-session-context.md excluded
- src/types/wrike.ts: DASHBOARDS_WRIKE_CONFIG added
- TypeScript compilation: [PASS/FAIL]
- Source code modified: ONLY src/types/wrike.ts (additions only)
- Ready for use: [YES/NO]
```
```

### Expected Outcome
- Both rich and diff-only modes create Wrike tasks
- Context file is cleaned up automatically
- No test artifacts remain
- Everything committed and ready

---

## Post-Completion Checklist

After Claude Code reports Phase 8 complete:

### Quick Verification (YOU do these manually)
- [ ] Check Wrike Dashboards board — test task appeared in Backlog?
- [ ] Task description has AI-generated Summary / Technical Changes / Impact?
- [ ] Description footer shows commit hash and context source?
- [ ] Run `git log --oneline -3` — commit history clean?
- [ ] Run `[ -f .ai-session-context.md ] && echo "exists" || echo "gone"` — returns "gone"?
- [ ] Open `.cursorrules` — new section at end, existing content intact?
- [ ] Open `CLAUDE.md` — project overview + commit protocol?
- [ ] Open `.husky/post-commit` — one line with background execution?

### Wrike Cleanup
- [ ] Delete the test task(s) from Wrike Dashboards board (they were just for verification)

### Final Commit (if test commit was reverted)
If you reverted the test in Step 8.7, recommit the real changes:
```bash
git add scripts/post-commit-wrike.js .husky/post-commit CLAUDE.md src/types/wrike.ts .cursorrules .gitignore
git commit -m "feat: add Wrike commit tracking with AI-generated descriptions"
```

This commit itself will create a Wrike task — which is exactly what we want!

---

## Claude Code Execution Prompt

Copy-paste this into Claude Code to execute the full guide:

```
You are executing the Wrike Commit Tracking implementation guide.

Read the full guide at:
C:\Users\russe\Documents\Dashboard\wrike_commit_tracker.md

RULES — follow these strictly:
1. Read EVERY file mentioned in a phase BEFORE writing any code in that phase.
2. Do NOT modify existing source code (.ts, .tsx files) EXCEPT for adding new exports to src/types/wrike.ts. You are CREATING: scripts/post-commit-wrike.js, .husky/post-commit, CLAUDE.md. You are APPENDING to: .cursorrules, .gitignore, src/types/wrike.ts.
3. Shell is bash (running on Windows via Git Bash). Use Unix/bash syntax for all commands.
4. Work phase by phase (1 through 8). Complete each phase fully before starting the next.
5. Run ALL verification commands shown in each phase. If any fail, fix before moving on.
6. The post-commit script must NEVER throw unhandled errors. Wrap everything in try/catch. Always exit cleanly.
7. The post-commit hook runs in the BACKGROUND (& at end of shell command). It must never block commits.
8. Use CommonJS (require/module.exports) for the post-commit script. Do NOT use ES modules.
9. Use REAL status IDs from Phase 2 discovery — do NOT use placeholders like 'FILL_FROM_DISCOVERY'.
10. After Phase 8 testing, revert test commits. Only the real implementation commit should remain.
11. If you are unsure about any file's contents, READ IT. Do not guess.

Begin with Phase 1 now. Read the guide, then explore the codebase files specified in Phase 1.
```