# Triage Results — Council Feedback (Knowledge Gap Clusters Rewrite)

Generated: 2026-05-12.

Maps every council-flagged item to one of three buckets:
- **Bucket 1** — applied autonomously to `agentic_implementation_guide.md` (no judgment needed; correct fix is determinable from the codebase)
- **Bucket 2** — needs human input (business intent or preference)
- **Bucket 3** — noted but deferred (out of scope, or current approach works)

---

## Bucket 1 — Applied autonomously (13 fixes)

All 13 changes were applied directly to `agentic_implementation_guide.md`. See the **Refinement Log** at the bottom of that file for the full diff list. Summary:

| # | Council ID | Fix | Phase impacted |
|---|---|---|---|
| 1 | Codex C1 | Phase 4 — widen `InsightsEvalDetailModal` early-return guard to accept `payload.bucket` alone | Phase 4 §4A |
| 2 | Codex C2 | Phase 6D — explicit `switch (layer.kind)` + TS `never` exhaustiveness guard + `ariaHidden` bookkeeping for `'cluster'` | Phase 6D |
| 3 | Codex C3 | Phase 2E — replace COALESCE/NULLIF idiom with CASE expression checking `position('/' IN ...) = 0` | Phase 2E gap_hits |
| 4 | Codex C4 | Phase 2E — add `, id` tie-breaker to deferral LATERAL `ORDER BY` | Phase 2E deferral_hits |
| 5 | Gemini C5 | Phase 2E — rewrite evidence aggregation as window-function `ROW_NUMBER() OVER (PARTITION BY bucket)` + `FILTER (WHERE rn <= sliceCap)` inside a single `jsonb_agg` | Phase 2E final SELECT |
| 6 | Gemini C7 | Pre-Flight — grep verified ZERO matches in `packages/analyst-bot` and `mcp-server`; cross-functional impact CLOSED | Pre-Flight step 5 |
| 7 | Codex S1 | Phase 2F — citation `.map()` rewritten to drop the entire entry when neither `utterance_index` nor a fully-populated `kb_source` is present (no more `{}` leaks) | Phase 2F constructor |
| 8 | Codex S3 | Phase 6A — `humanizeBucket` returns the raw label when bucket is `'Uncategorized'` or starts with `'Uncategorized: '` | Phase 6A |
| 9 | Codex S4 | Phase 7 — split into 7A (SQL string assertions) and 7B (component-level tests for cluster card → modal push and detail modal bucket-only render) | Phase 7 |
| 10 | Codex S5 | Pre-Flight — added probe for any `evaluations`-level synthetic flag to mirror the `rep_deferrals.is_synthetic_test_data` filter | Pre-Flight step 3 |
| 11 | Gemini Imp.3 | Phase 7.5 — explicit narrative update for `docs/ARCHITECTURE.md` deprecating the vocab-map path | Phase 7.5B |
| 12 | Self check | Corrected `kb-vocab-synonyms.ts` path (lives at `src/lib/queries/call-intelligence/`, not `src/lib/`) | Phase 7.5B |
| 13 | Codex S2 | Removed misleading "LATERAL guarantees" comment; replaced with accurate note about the window-function pattern | Phase 2E note block |

---

## Bucket 2 — Resolved by user 2026-05-12

All 13 questions resolved. User accepted recommended defaults across the board (Q2, Q9, Q12, Q13 via AskUserQuestion structured prompt; Q1/Q3/Q4/Q5/Q6/Q7/Q8/Q10/Q11 by implicit acceptance of documented defaults). See the **Refinement Log** in `agentic_implementation_guide.md` for the per-question decision table.

Three of the user's decisions changed the guide:
- **Q13** → Phase 4 implementation outline rewritten to gate the new gap-evidence section on `payload.bucket !== undefined`
- **Q6** → Phase 6B cluster card render now shows a unique-rep badge (`{N} rep(s)`) in the card header
- **Q7** → Phase 6 gained a new 6B.5 sub-section with the empty-state copy

The remaining 10 decisions match what was already in the guide (or are Bucket 3 deferrals).

See `council-feedback.md` § Design Questions for full original context.

| # | Question | Recommended default | Impact if defaulted |
|---|---|---|---|
| Q1 | Bucket-namespace collision (gap kb_path vs deferral kb_topic) | Keep single bucket+kind, `kb_path` wins precedence | Low — collisions unlikely given naming conventions; if they happen, manager sees one row instead of two |
| Q2 | Detail-modal scope on cluster drill | Filter-on-client: render ALL with highlight | Medium — affects manager mental model; council split on this |
| Q3 | Is `chunk_index` semantic or DB-order? | Treat as DB-order; doc the trade-off | Low — 100% deterministic regardless; only affects which topic is shown for multi-chunk deferrals |
| Q4 | `Uncategorized: <topic>` label format | Keep raw (preserves forensic value) | Low cosmetic |
| Q5 | Longtail collapse rule | Current spec: only `totalOccurrences=1 AND bucketKind='uncategorized'` | Low — different visual but no data hidden |
| Q6 | Sort by occurrences vs unique reps | Occurrences (spec); ADD a unique-rep badge to cards as a low-cost compromise | Low — surfaces both signals |
| Q7 | Empty-state copy | "No advisor calls in this window. Adjust the date range or filters above." | Low UX |
| Q8 | `expected_source` path normalization in SQL | NO — trust upstream AI (data-verifier found 0 backslash / 0 leading-slash rows in 90d; casing inconsistency not probed) | Medium — risk of duplicate buckets if AI emits inconsistent paths |
| Q9 | Rep-focus payload size (200 cap = ~2MB) | Keep eager 200 — accept payload; revisit only if browser metrics flag it | Medium — affects API throughput for power users |
| Q10 | Modal stack preservation on rep-name click | Close all + URL hop (current spec) — simpler, less stack management | Low UX — refocus only loses one Layer-1 modal state |
| Q11 | Triage filters in Layer 1 cluster modal | NO — defer to follow-up after manager feedback | Low — scope expansion |
| Q12 | Deferral fallback when chunks lack `topics[]` | Keep dynamic `'Uncategorized: ' || d.topic` (preserves forensic value; lateral coverage is 100% today so risk is hypothetical) | Medium — future risk if chunks pipeline regresses |
| Q13 | Detail modal gap-render when no `bucket` payload | Render only when `bucket` is set (Gemini's recommendation) | Medium UX — keeps mental model tight per drill |

---

## Bucket 3 — Noted but not applied

| # | Source | Why deferred |
|---|---|---|
| B3-1 | Gemini Imp.1 — Triage filters inside Layer 1 cluster modal | Scope expansion. Worth a follow-up after manager feedback on the initial ship. |
| B3-2 | Gemini Imp.2 — "Show all" pagination | Scope; depends on Q9 outcome (if Q9 picks lazy-load, the pagination falls out of that endpoint). |
| B3-3 | Codex Sugg.4 — Split schema into `gapBucket`/`deferralBucket` | Pre-emptive de-collision. Defer pending Q1 resolution. |
