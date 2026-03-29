# Council Feedback — RequestDetailModal.tsx Refactor

Generated: 2026-03-27
Both OpenAI (gpt-5.4) and Gemini (gemini-3.1-pro-preview) reviewed successfully.

---

## Critical Issues

**1. (OpenAI) AttachmentList calls dashboardRequestsApi directly — moves API consumption into child**

OpenAI flagged that `AttachmentList` calling `dashboardRequestsApi.getAttachmentUrl` is "moving behavior/API consumption into a child." However, cross-check shows `getAttachmentUrl` is a **synchronous URL string constructor** (not an async API call), and the subcomponent is in the **same file** as the parent. The "API" reference is just constructing a URL path — no fetch, no error handling, no state mutation. **Verdict: not a real issue.** The extraction is safe as-is.

**2. (Gemini) Closure loss on formatFileSize**

Gemini flagged potential closure dependencies. Cross-check of line 464 confirms `formatFileSize` uses only its `bytes` parameter — **no closure variables**. Safe to extract.

**3. (OpenAI) updateStatus return-shape asymmetry**

Both reviewers noted the `result.request` access pattern. The guide already correctly keeps all handlers in the parent — subcomponents receive callbacks only. **Already addressed in the guide.**

---

## Should Fix

**1. (Gemini) File naming: `request-utils.ts` → `request-formatters.ts`**

The ExploreResults decomposition precedent uses `[feature]-formatters.ts` naming. For pattern consistency, rename to `request-formatters.ts`. Valid observation.

**2. (OpenAI) Nullable input types for formatters**

The guide should verify that all call sites pass `string` (not `string | null`) to `formatRequestTimestamp`. In the current code, `errorOccurredAt` and `createdAt` are the main call sites — both are guarded by conditional rendering (`{request.errorOccurredAt && ...}`). The formatter signature `(dateString: string)` is correct; nullable inputs are already filtered at the JSX level.

**3. (OpenAI) Explicitly state contract-preservation rules**

Add explicit statement: do not convert to default export, do not rename, do not alter prop type. The guide already says this but could be more explicit.

**4. (OpenAI) request-utils.ts must remain a leaf utility**

No imports from RequestDetailModal, dashboardRequestsApi, or browser-only APIs. Already planned this way — worth adding as an explicit constraint.

**5. (Gemini) Prop interface placement**

Define each Props interface immediately above its subcomponent, not grouped at the top. Good practice for readability.

**6. (OpenAI) Add intermediate typecheck between Phase 3 and Phase 4**

Guide already has `npx tsc --noEmit` after each phase. But worth being explicit: run typecheck after Phases 1-3 complete (sibling updates) before starting Phase 4 (main file refactor).

---

## Design Questions

**1. (Gemini) React.memo / useCallback optimization**

Should extracted subcomponents be wrapped in `React.memo`? **Out of scope for a non-breaking refactor.** Performance optimization is feature work, not refactor work. Note for future consideration.

**2. (Gemini) Global formatter debt**

Should we patch `src/lib/utils/format-helpers.ts` instead of creating a feature-local formatter? The pattern-finder found that format-helpers.ts `formatDate` lacks time and `formatDateTime` lacks timezone-safe parsing. Creating a feature-local file follows the ExploreResults precedent and is lower risk. Patching the global utility is a separate, broader scope change.

**3. (OpenAI) Should `request-utils.ts` live in `src/lib/utils/` instead?**

Feature-local placement follows the explore-formatters.ts precedent. Moving to `src/lib/utils/` would increase blast radius. Keep feature-local.

**4. (Gemini) Line count threshold for sibling extraction**

With 4 private subcomponents + handlers, the file may still be ~400-500 lines. At what point do we switch to the ExploreResults flat-sibling pattern? For this refactor, the RecordDetailModal pattern is correct — private subcomponents in the same file. If the file grows beyond 600 lines again in the future, a follow-up can extract to sibling files.

---

## Suggested Improvements (ranked by impact)

1. **(Both) Add unit tests for formatters** — `request-formatters.test.ts` with basic cases. High value, low effort. Pure functions are ideal test targets.

2. **(OpenAI) Derive prop types from existing domain types** — Use `DashboardRequestFull['attachments']` etc. instead of manual type definitions. Prevents drift.

3. **(Gemini) Destructure props in subcomponent signatures** — Makes dependencies explicit and readable.

4. **(OpenAI) Make contract-preservation rules explicit in the guide** — Named export, prop type, all route/API return-shape assumptions.

---

## Raw Responses

### OpenAI (gpt-5.4, reasoning_effort: high)

**CRITICAL:** Phase 4d (AttachmentList) moves API consumption into child. Prop list may be incomplete. Safer to keep download behavior in modal and pass handler down.

**SHOULD FIX:** (1) Formatter signatures may be too narrow if inputs are nullable. (2) Preserve export contract explicitly. (3) Type extracted subcomponents from existing domain types. (4) Don't move mutation semantics into children. (5) Same-file constraint should be explicit. (6) request-utils.ts must be dependency-free. (7) Add build/typecheck between phases. (8) Path alias safety is fine for relative imports.

**DESIGN QUESTIONS:** (1) Should AttachmentList own download behavior or stay presentational? (2) Should request-utils.ts live under components/requests/ or in shared utils? (3) Should formatters be strict or tolerant?

**SUGGESTED IMPROVEMENTS:** (1) Make AttachmentList receive parent-owned handler. (2) Derive prop types from domain types. (3) State contract-preservation rules explicitly. (4) Add unit tests for formatters. (5) Phase-by-phase validation steps.

### Gemini (gemini-3.1-pro-preview, thinking: high)

**CRITICAL:** (1) updateStatus return-shape hazard — ensure subcomponents use generic action props. (2) formatFileSize closure risk.

**SHOULD FIX:** (1) File naming: request-utils.ts → request-formatters.ts (follows explore-formatters.ts precedent). (2) Props interfaces should be placed immediately above their subcomponents.

**DESIGN QUESTIONS:** (1) React.memo optimization for subcomponents? (2) Global formatter debt — should we patch format-helpers.ts? (3) Line-count threshold for switching to flat-sibling extraction pattern?

**SUGGESTED IMPROVEMENTS:** (1) Add unit tests for formatters. (2) Strict typing for extracted subcomponents. (3) Destructure props in subcomponent signatures.
