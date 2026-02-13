# Claude Code Prompt — Fill Investigation Gaps 1 & 2

Copy and paste this entire block into Claude Code as your prompt.

---

## PROMPT START

You are updating an existing codebase investigation document with findings for two gaps that were missed in the first pass. The document is located at:

```
C:\Users\russe\Documents\Dashboard\GC_Hub_Codebase_Investigation_COMPLETED.md
```

**YOUR JOB:** Answer each gap question below by reading the ACTUAL source files in this repository. Then **append your findings to the end of the investigation document** (before the `## Investigation Complete` section), in a new section called `## Addendum A: Gaps 1 & 2 — Role System Deep Dive`. Use the EXACT same format already used throughout the document — headings with numbers, `**Finding:**` blocks with file paths, line numbers, exact code, and interpretation.

**CRITICAL RULES (same as original investigation):**

1. **NEVER answer from memory or training data.** Every finding must come from reading the actual file using `cat`, `grep`, `find`, or file reading tools. If a file doesn't exist, say "FILE NOT FOUND" — do not guess.
2. **NEVER paraphrase code.** Paste the EXACT code from the file with file path and line numbers.
3. **Show your work.** For every finding include: the exact command you ran, the file path + line numbers, and the verbatim code snippet.
4. **Also update the original sections.** After creating the addendum, go back and add a note to the ORIGINAL sections 1.1 and 1.4 that says `> ⚠️ **ADDENDUM:** See Gap 1.x / Gap 2.x in Addendum A for additional findings missed in the original pass.`

---

## GAP 1: `forbidRecruiter()` Helper Function

**Context:** The original investigation (section 1.4) concluded "NO separate forbidRecruiter() function — the logic is inline in middleware." However, the project's own security assessment document (`docs/savvy-dashboard-security-assessment.md`) explicitly references `src/lib/api-authz.ts` containing a `forbidRecruiter()` helper, and says `grep -rn "forbidRecruiter" src/app/api/ | wc -l` should return 20+ matches. This is a SECOND defense-in-depth layer used inside individual API route handlers, separate from the middleware allowlist. Both layers matter because we need an equivalent `forbidCapitalPartner()` function.

**Execute these steps in order:**

### Gap 1.1 — Find and paste the `forbidRecruiter()` implementation

First, check if the file exists:
```bash
ls -la src/lib/api-authz.ts
```

If found, paste the **COMPLETE file** with line numbers:
```bash
cat -n src/lib/api-authz.ts
```

If NOT found, search for the function definition:
```bash
grep -rn "forbidRecruiter\|function forbid\|export.*forbid" src/lib/ --include="*.ts"
```

We need to see:
- The complete function signature (what it takes as input — session? permissions? request?)
- What it returns or throws (NextResponse 403? boolean? void with throw?)
- Any other authorization helper functions defined in the same file
- The exact import path other files use

### Gap 1.2 — Count and list every API route that uses it

Run:
```bash
grep -rn "forbidRecruiter" src/app/api/ --include="*.ts" | sort
```

Paste the **COMPLETE** output. We need:
- The exact count of files
- Which API route directories use it (dashboard/, sga-hub/, admin/, cron/, etc.)
- Whether it appears in `import` lines, function calls, or both

Then run the count:
```bash
grep -rln "forbidRecruiter" src/app/api/ --include="*.ts" | wc -l
```

### Gap 1.3 — Show one complete usage example in context

Pick ONE API route file from the grep results — preferably a dashboard data route (like `funnel-metrics`, `conversion-rates`, or `source-performance`). Paste the **complete POST or GET handler function** so we can see:
- The exact import statement (which file, named or default import)
- Where in the handler flow `forbidRecruiter()` is called (before session check? after? before data query?)
- What arguments are passed to it
- How the result is handled (early return? if/else? try/catch?)

Run `cat -n` on whichever file exists from the grep results.

### Gap 1.4 — Assess extensibility for `capital_partner`

Based on the actual implementation you found, answer:
- Is `forbidRecruiter()` hardcoded to the string `'recruiter'`, or parameterized?
- Could we add `forbidCapitalPartner()` as a sibling function in the same file?
- Would a generic `forbidRoles(...roles: string[])` be cleaner?
- State your recommendation for the implementation guide.

---

## GAP 2: `src/lib/users.ts` Local User Interface

**Context:** The original investigation (section 1.1) found the primary `UserRole` type in `src/types/user.ts` as a 7-value string literal union. It noted that `src/lib/users.ts` "has a local User interface (line 10) with a slightly different list — will need updating" but never pasted the actual code. If this local interface defines its own inline role list (instead of importing `UserRole`), adding `capital_partner` to the main type won't propagate here and things will break silently.

**Execute these steps in order:**

### Gap 2.1 — Paste the local User interface and all role references in users.ts

Run:
```bash
cat -n src/lib/users.ts | head -80
```

Paste the output. Then search for ALL role-related code in the entire file:
```bash
grep -n "role\|Role\|admin\|manager\|sgm\|sga\|viewer\|recruiter\|revops" src/lib/users.ts
```

We need to see:
- The complete `User` interface or type definition (every field)
- Whether `role` is typed as `UserRole` (imported from `@/types/user.ts`) or as an inline string union or just `string`
- Any hardcoded role checks in the file (e.g., `if (role === 'recruiter')`)
- The `validateUser()` function referenced by the auth flow (section 1.5 says it checks `isActive`)
- The `createUser()` function referenced by user creation (section 1.6)

### Gap 2.2 — Trace the import chain

Run:
```bash
head -15 src/lib/users.ts
```

Check if `UserRole` is imported from `src/types/user.ts`. If it IS imported, the local interface uses the single source of truth and adding `capital_partner` there propagates automatically. If it is NOT imported, this file needs a separate edit and we must flag it for the implementation guide.

### Gap 2.3 — Find ALL files with local role definitions or UserRole imports

Run both of these:
```bash
grep -rln "UserRole" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".next" | sort
```

```bash
grep -rn "'admin' | 'manager'" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".next" | grep -v "test" | head -30
```

This gives us the **complete list of every file that either defines or references `UserRole`**. Each one is a file we may need to touch when adding `capital_partner`. List them all in your finding.

---

## OUTPUT FORMAT & PLACEMENT

1. **Insert** a new section in the investigation document called `## Addendum A: Gaps 1 & 2 — Role System Deep Dive` — place it BEFORE the existing `## Investigation Complete` section.

2. Format each finding identically to the existing document style:

```markdown
### Gap 1.1 — forbidRecruiter() Implementation
- **File:** `src/lib/api-authz.ts`
- **Command:** `cat -n src/lib/api-authz.ts`
- **Finding:**
  - **File path:** `src/lib/api-authz.ts`, lines X-Y
  - **Exact code:**
    ```typescript
    // paste here
    ```
  - **Interpretation:** ...
```

3. After writing the addendum, go back to the ORIGINAL sections **1.1** and **1.4** and insert this note below each section's existing content:

```markdown
> ⚠️ **ADDENDUM:** Additional findings for this section were discovered — see Gap 1.x / Gap 2.x in Addendum A below.
```

4. Update the `## Investigation Complete` → `### Key Findings Summary` → **Role System (Phase 1)** bullets to include the new findings about `forbidRecruiter()` and the `users.ts` local interface.

**BEGIN.** Start with Gap 1.1 — run `ls -la src/lib/api-authz.ts` right now.

## PROMPT END
