# Triage Results — Council Feedback (Insights Modal Stack)

Generated: 2026-05-11.

---

## Bucket 1 — Applied Autonomously

| # | Item | Action | Source |
|---|---|---|---|
| B1.1 | C1 — TranscriptModal compile failure | Phase 5 fetches full `EvaluationDetail` into a parent-side `Map<evaluationId, EvaluationDetail>` cache on `InsightsTab`. Layer 2 receives `detail` as a prop; Phase 6 passes the cached detail down to Layer 3 (transcript, comments, currentUserId, isAdmin, repFullName, onCommentChanged). | Codex |
| B1.2 | C2 — z-50 hardcoded | Phase 3 adds `zClassName?: string` prop to TranscriptModal (default `'z-50'`). Phase 6 passes `zClassName="z-[70]"`. | Codex |
| B1.3 | C3 — `/insights/evals` API rep filter unverified | Phase 0 adds a check on `insights-evals-list.ts`; if missing, Phase 0.5 (new) adds a `rep` filter. | Gemini |
| B1.4 | C4 — Minimum a11y | Phases 4/5 add focus-on-open. Phase 6 captures heat-map trigger ref for focus-restore. `aria-hidden="true"` on underlying layers managed by parent. | Gemini |
| B1.5 | C6 — Citation isn't a discriminated union | Phase 5 defensive rendering: if both `utterance_index` and `kb_source` are set on a citation, render both affordances. | Codex |
| B1.6 | S1 — `chunk_lookup` only from `ai_original` | Phase 2.5 (new) extends `buildChunkLookup` to scan `dimension_scores` + `rep_deferrals` canonical columns. | Codex + Gemini |
| B1.7 | S3 — Dead-code fallback | Phase 5: replace fallback with `return null` early-out when neither dimension nor topic is set. | Gemini |
| B1.8 | S6 — IIFE-with-cast → type-guard predicates | Phase 6: `.find((l): l is Extract<…, { kind: 'X' }> => l.kind === 'X')`. | Codex |
| B1.9 | S7 — Row affordance | Phase 4: row `aria-label="Open evaluation for <rep_name>"`. | Gemini |
| B1.10 | S9 — Fixed-string grep | Phase 7: `rg -n -F` for the deletion gate. | Codex |
| B1.11 | Cross-check 6 — Phase 1↔2 atomicity | Phase 1 note added: "must execute back-to-back; tsc fails between them." | Orchestrator |

## Bucket 2 — Autonomous Defaults Applied

| # | Item | Default | Rationale |
|---|---|---|---|
| B2a.1 | Q2 — EvalDetailClient migration | **Defer to follow-up.** Layer 2 reads canonical `detail.rep_deferrals`; EvalDetailClient keeps `ai_original.repDeferrals`. | Same-ship migration adds churn to a working page. |
| B2a.2 | Q5 — Redirect query preservation | **Simple 301**, strip query. Redirect `/insights/evals*` → `?tab=insights`. | Revisit if Q4 = URL-hash modal state. |
| B2a.3 | S2 — ← Back semantics | **Drop ← Back.** Phase 3 does NOT add `onBack`. Layer 3 has X + Esc + click-outside only. | Functionally equivalent affordances confuse users. |
| B2a.4 | S8 — Caching | **In-memory `Map` in InsightsTab.** First open fetches; reopens hit cache. | Simple, no new dep. |
| B2a.5 | S5 — disableOwnEscHandler coupling | **Keep the prop.** | Minimal patch; precedent in GCHubAdvisorModal. |

## Bucket 3 — Noted, Not Applied

| # | Item | Reason |
|---|---|---|
| B3.1 | Replace `disableOwnEscHandler` with context-based dispatch | Out of scope; minimal patch correct. |
| B3.2 | React-Query / SWR | Adds a dependency; Map is enough. |

## Bucket 2 — Needs Human Input (3 questions)

- **Q1**: Layer 3 transcript — read-only inside Insights, or full comment-write parity?
- **Q3**: Mobile UX — three stacked modals on a phone?
- **Q4**: Browser back button — what should happen when user hits back with modals open?
