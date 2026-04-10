# /auto-build — Automated Greenfield Build Pipeline

You are an orchestrator. Your job is to take a build specification document, run a full exploration and planning pipeline, produce a phased implementation guide with actual code, get adversarial review, and deliver a refined guide ready for execution. You do NOT execute the guide — that happens in a fresh context after this command completes.

**Build spec:** $ARGUMENTS

---

## RULES

1. Execute phases in strict order. Do not skip phases.
2. Write all artifacts to disk in the project root (or the target subdirectory if specified in the spec). Later phases read them from disk.
3. Print a progress header at the start of each phase.
4. Do not ask the user anything until the Human Input Gate in Phase 4.
5. If a phase fails (MCP timeout, API connection error, missing dependency), report clearly and stop.
6. This command builds NEW code from a spec. It does not modify existing features. If you find yourself tracing existing types or construction sites, you're using the wrong command — that's `/auto-feature`.

---

## PHASE 1: EXPLORATION

Read the build spec document first. Then spawn an agent team with 3 teammates to investigate in parallel:

### Teammate 1: Spec Analyzer (agent: spec-analyzer)

Task: "Read the build spec at: $ARGUMENTS

Analyze the specification and produce a structured breakdown:
- Every module/file that needs to be created (with proposed file paths)
- The dependency graph between modules (what imports what, what must be built first)
- Interfaces between modules (function signatures, data shapes, event flows)
- Every external integration point (APIs, databases, services, SDKs)
- Ambiguities, contradictions, or gaps in the spec (things that are implied but not specified)
- Decisions that were made in the spec vs. decisions left open
- The critical path: which module is the foundation everything else depends on

Map the build order as a DAG. Identify which modules can be built in parallel and which are sequential dependencies.

Save findings to `spec-analyzer-findings.md` in the target directory."

### Teammate 2: Infrastructure Scout (agent: infrastructure-scout)

Task: "Read the build spec at: $ARGUMENTS

Investigate what already exists and what needs to be created:
- Check the repo for existing code that can be reused (shared types, utility functions, configs, similar patterns)
- Check for existing database tables, schemas, or migrations that overlap with what the spec requires
- Verify connectivity to external services mentioned in the spec (databases, cloud services, APIs)
- Check that required environment variables exist or are documented
- Check that required npm packages are available and compatible with the project's Node version and module system (ESM vs CJS)
- Identify infrastructure that needs to be provisioned (database tables, cloud services, API keys, Slack apps)
- Check the existing project's tsconfig, package.json, and module system for compatibility constraints
- If the build target is a subdirectory of an existing project, check for workspace/monorepo configuration needs

Save findings to `infrastructure-scout-findings.md` in the target directory."

### Teammate 3: API/Integration Researcher (agent: integration-researcher)

Task: "Read the build spec at: $ARGUMENTS

For every external API, SDK, and integration point in the spec:
- Find working code examples for the specific usage patterns the spec requires
- Document the correct import paths, initialization patterns, and auth mechanisms
- Identify version-specific gotchas (breaking changes between versions, deprecated methods)
- Document rate limits, payload size limits, timeout defaults, and retry patterns
- For Slack Bolt: event types, message formatting (Block Kit vs mrkdwn), file upload API, reaction handlers, thread handling
- For Claude API with MCP servers: the mcp_servers parameter format, how to parse tool_use and tool_result content blocks, conversation history management
- For chart/image libraries: system dependencies (canvas, cairo), rendering to buffer, supported chart types and configuration
- For Excel/spreadsheet libraries: formula support, chart embedding, streaming large workbooks
- For database clients: connection pooling, parameterized queries, JSON column handling
- Flag any integration where the spec assumes behavior that doesn't match the actual API

Save findings to `integration-researcher-findings.md` in the target directory."

### Synthesis

Once all three teammates complete, read all three findings files and produce `exploration-results.md` containing:

1. **Pre-Flight Summary** — 5-10 line plain-English summary of what was found. Print this to console so the user sees it scroll by.
2. **Build Order** — DAG of modules with sequential dependencies and parallel opportunities
3. **Infrastructure Status** — What exists ✅, what needs provisioning ❌, what needs configuration ⚙️
4. **Reusable Code** — Existing utilities, types, patterns, configs that should be imported, not rebuilt
5. **Integration Findings** — Key patterns, gotchas, and working examples for each external dependency
6. **Module Inventory** — Every file to create with path, purpose, dependencies, and estimated complexity
7. **Spec Gaps** — Ambiguities, contradictions, or missing details that need resolution
8. **Risks and Blockers** — System dependencies, provisioning steps, API limitations, compatibility issues

Proceed immediately to Phase 2.

---

## PHASE 2: BUILD GUIDE

Read all exploration documents and produce `build_implementation_guide.md` with actual code.

### Structure

The guide must be organized as sequential phases. Each phase produces something testable. The dependency graph from the spec analyzer determines phase ordering.

**Phase 0: Scaffold**
- Directory structure creation
- `package.json` with all dependencies (exact versions from integration researcher findings)
- `tsconfig.json` compatible with the parent project if this is a subdirectory build
- Environment variable template (`.env.example`)
- Dockerfile if the spec calls for containerized deployment

**Phase 1: Types and Interfaces**
- Every shared TypeScript type, interface, and enum
- Data shapes for inter-module communication
- Include JSDoc comments explaining each type's purpose
- This phase produces no runnable code but establishes the contract between all modules

**Phase 2: Foundation Module**
- The critical-path module that everything else depends on (identified by spec analyzer)
- Full implementation with actual code, not pseudocode
- Validation gate: the module compiles and its core function can be called from a test script

**Phases 3-N: Remaining Modules**
- One phase per module or per logical group of tightly coupled modules
- Build order follows the dependency DAG
- Each phase includes the actual code for the module
- Each phase has a validation gate that proves the module works in isolation or with its dependencies

**Final Phase: Integration and Deployment**
- Wire all modules together
- End-to-end test script
- Deployment steps (if applicable)
- Documentation sync

### Code Requirements

Every phase must include:
- **Actual TypeScript code** for every file in that phase, not descriptions of what to write. Full implementations.
- **A validation gate** with a concrete bash command or test script that proves the phase worked
- **A STOP AND REPORT checkpoint** — do not proceed to the next phase until the gate passes
- **Import statements** that reference the exact file paths from the module inventory
- **Error handling** for every external call (API, database, file system)
- **Comments** on non-obvious logic, referencing the spec when relevant

### Code Rules

- All database queries use parameterized syntax — never string interpolation
- All external API calls are wrapped in try/catch with meaningful error messages
- All environment variables are validated at startup, not at first use
- Secrets are never logged, even in error messages
- Every module has a single responsibility — if a phase has a file doing two unrelated things, split it
- Imports from the same module are merged, not duplicated
- If this is a subdirectory build, imports from the parent project use the correct path alias or relative path
- Match the parent project's module system (ESM vs CJS), linting rules, and formatting conventions

Write the guide to `build_implementation_guide.md`, then proceed immediately to Phase 3.

---

## PHASE 3: ADVERSARIAL COUNCIL REVIEW

Send the implementation guide and exploration results to Codex and Gemini for adversarial review using the council-mcp tools. Send **separate** prompts — do NOT use `ask_all`.

### Prepare the payload

Read and concatenate:
- `exploration-results.md`
- `build_implementation_guide.md`

### Send to Codex

Use `ask_codex`.

**System prompt:** "You are a senior software architect reviewing a greenfield implementation plan. Your job is adversarial — find what will break, what's missing, and what won't work as written."

**Prompt:** Include the full payload, then ask Codex to focus on:
- **Code correctness**: Will the code in each phase actually compile and run? Are there syntax errors, wrong method signatures, incorrect API usage?
- **Dependency ordering**: Can each phase execute given what prior phases produce? Are there circular dependencies?
- **Integration points**: Do the module interfaces actually match? Will data flow correctly between modules?
- **Error handling**: What happens when external calls fail? Are there unhandled promise rejections, missing try/catch, silent failures?
- **Security**: Are secrets handled correctly? SQL injection risks? Input validation gaps?
- **Missing modules**: Is anything implied by the spec but not present in the guide?
- **Build and deploy**: Will the Dockerfile work? Are system dependencies accounted for? Will the deployment steps actually produce a running service?

**Required response format:**
```
## CRITICAL ISSUES (will prevent build, cause crashes, or create security vulnerabilities)
## SHOULD FIX (bugs, pattern drift, missing edge cases, incomplete error handling)
## DESIGN QUESTIONS (decisions needing human input — number each one)
## SUGGESTED IMPROVEMENTS (ranked by impact)
```

### Send to Gemini

Use `ask_gemini` (thinking enabled by default).

**System prompt:** "You are a senior systems engineer and integration specialist reviewing a greenfield implementation plan. Your job is to find integration failures, infrastructure gaps, and operational risks."

**Prompt:** Include the full payload, then ask Gemini to focus on:
- **Integration correctness**: Do the external API calls match actual API behavior? Are the Slack event types correct? Does the Claude API mcp_servers parameter work as described?
- **Infrastructure gaps**: Are all required cloud resources, database tables, API keys, and permissions accounted for?
- **Operational risks**: What happens at scale? Cold starts? Memory pressure from chart rendering? Thread history growing unbounded? Rate limits hit?
- **Data flow**: Does data transform correctly between layers? Are types compatible across boundaries?
- **Deployment**: Will the container build? Are system dependencies (canvas, cairo) handled? Will the health check work?
- **What's missing**: Any integration the spec describes but the guide doesn't implement?

**Same required response format as Codex.**

### Cross-Checks

After receiving both responses, run these checks yourself:

1. Every file path in the guide matches the module inventory from exploration
2. Every import statement references a file that exists in the guide
3. Every external API call matches the patterns documented by the integration researcher
4. Every database query uses parameterized syntax
5. Every environment variable used in code is listed in the `.env.example`
6. The Dockerfile installs all system dependencies identified by the integration researcher
7. The build order matches the dependency DAG from the spec analyzer

### Write council-feedback.md

Write `council-feedback.md` with:
- **Critical Issues** — merged and deduplicated from both reviewers plus your cross-checks
- **Should Fix** — merged
- **Design Questions** — merged, numbered sequentially
- **Suggested Improvements** — merged, ranked by impact vs effort
- **Raw Responses** — full text from each reviewer, labeled

Proceed immediately to Phase 4.

---

## PHASE 4: SELF-TRIAGE AND REFINEMENT

Read `council-feedback.md` and triage EVERY item into one of three buckets:

### Bucket 1 — APPLY AUTONOMOUSLY

Items where the correct fix is determinable from the spec, exploration findings, or standard engineering practice:
- Wrong API method signatures → fix to match integration researcher findings
- Missing error handling → add try/catch with meaningful messages
- Missing environment variable validation → add startup check
- Wrong import paths → fix to match module inventory
- Missing dependency in package.json → add it
- Missing system dependency in Dockerfile → add it
- Incorrect event types or API parameter shapes → fix to match documented behavior
- Phase ordering errors → reorder to match dependency DAG
- Missing validation gates → add concrete commands
- Security issues (logged secrets, missing input validation) → fix

**Apply all Bucket 1 fixes directly to `build_implementation_guide.md`.** Update the actual code in the affected phases.

### Bucket 2 — NEEDS HUMAN INPUT

Items where the answer depends on product intent, business logic, or preference:
- Architectural choices where multiple valid approaches exist
- Feature scope decisions (should X also do Y?)
- UX behavior choices (how should the bot respond to Z?)
- Performance vs. simplicity tradeoffs
- Infrastructure choices (which database, which hosting tier, how much to cache)
- Security posture decisions (who gets access, what's the rate limit)

### Bucket 3 — NOTE BUT DON'T APPLY

Valid observations that are out of scope or premature:
- Scale optimizations not needed for v1
- Feature suggestions beyond the spec
- Alternative architectures where the current approach is sound
- Nice-to-haves that would delay the build

### Apply and Log

1. Apply all Bucket 1 fixes to `build_implementation_guide.md` — edit the actual code, not just notes
2. Update any validation gates affected by the fixes
3. Append a **Refinement Log** to the bottom of the guide:
   - Every Bucket 1 change (what changed, why, which reviewer flagged it, which phase)
   - Every Bucket 3 item (what it was, why deferred)
4. Self-review the updated guide for internal consistency — do the phases still build on each other correctly after the fixes?
5. Write triage details to `triage-results.md`

### Human Input Gate

**IF Bucket 2 is empty:**

Print:
```
✅ Council review complete. All feedback resolved autonomously.

[N] fixes applied to the implementation guide (see Refinement Log).
[M] items noted but deferred.

The guide is ready for execution. Recommended next steps:
1. Run /compact to clear context
2. Then: "Execute build_implementation_guide.md phase by phase. Start with Phase 0: Scaffold. Stop at each validation gate and report results before proceeding."
```

**STOP. Do not proceed further.**

**IF Bucket 2 has items:**

Print:
```
🛑 Human Input Required

The council raised [N] questions that need your judgment.
[M] other issues were resolved autonomously (see Refinement Log).
[K] items noted but deferred.

Please answer each question:

Q1: [question]
    Context: [why it matters, what the tradeoffs are]
    Options: [concrete choices, not open-ended]

Q2: [question]
    ...

After you answer, I'll apply your decisions to the guide.
```

**STOP. WAIT FOR THE USER TO RESPOND.**

When the user responds, apply their answers to `build_implementation_guide.md` — update the actual code in the affected phases. Add each decision to the Refinement Log with rationale. Then print:

```
✅ Guide updated with your decisions.

The guide is ready for execution. Recommended next steps:
1. Run /compact to clear context
2. Then: "Execute build_implementation_guide.md phase by phase. Start with Phase 0: Scaffold. Stop at each validation gate and report results before proceeding."
```

**STOP. Do not proceed further.**

---

## FILES PRODUCED

| File | Phase | Purpose |
|------|-------|---------|
| `spec-analyzer-findings.md` | 1 | Module inventory, dependency DAG, build order, spec gaps |
| `infrastructure-scout-findings.md` | 1 | Existing infrastructure, reusable code, provisioning needs |
| `integration-researcher-findings.md` | 1 | API patterns, SDK gotchas, working code examples |
| `exploration-results.md` | 1 | Synthesized summary with pre-flight check |
| `build_implementation_guide.md` | 2 (created), 4 (refined) | Phased build plan with actual code and validation gates |
| `council-feedback.md` | 3 | Codex + Gemini adversarial review |
| `triage-results.md` | 4 | Categorized triage of council feedback |

---

## FAILURE MODES

- **MCP tool timeout (council):** Retry once. If both retries fail for a provider, proceed with whichever responded. If both fail, STOP and tell the user.
- **Infrastructure check failure (scout):** Report what couldn't be verified. Flag as a risk in exploration results. Do not block the pipeline — the guide should include provisioning steps for anything unverified.
- **Agent teammate failure:** If one of the three exploration agents fails, report which one and what it couldn't do. Do not proceed — the exploration is incomplete.
- **Spec document not found:** STOP immediately and tell the user the file path doesn't exist.

---

## DIFFERENCES FROM /auto-feature

| | /auto-feature | /auto-build |
|---|---|---|
| **Purpose** | Add a feature to existing code | Build new code from a spec |
| **Input** | A feature request (natural language) | A spec document (file path) |
| **Exploration** | Inspects existing types, queries, patterns | Analyzes spec, checks infrastructure, researches APIs |
| **Guide content** | References existing files to modify | Contains actual code for new files |
| **Council focus** | Type safety, construction sites, field names | Code correctness, integration points, infrastructure |
| **Output** | Modified existing codebase | New codebase or package |

Use `/auto-feature` when you're adding to something that exists.
Use `/auto-build` when you're creating something new.

---

## BEGIN

Start Phase 1 now. The build spec is at: **$ARGUMENTS**
