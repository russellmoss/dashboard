# Council Feedback — Knowledge Gap Clusters Rewrite (§6)

Adversarial review of `exploration-results.md` + `agentic_implementation_guide.md` by:
- **Codex** (gpt-5.4-mini, fallback from gpt-5.4) — TypeScript / build-correctness lens
- **Gemini** (gemini-3.1-pro-preview) — data engineering / product UX lens

Plus self-cross-checks (Postgres conventions, construction sites, NULL handling).

---

## Critical Issues — merged and deduped

### C1. `InsightsEvalDetailModal` early-return blocks cluster payloads
**Source:** Codex Critical 1.
The existing modal gates on `(!payload.dimension && !payload.topic)` (line 124) and renders nothing. The new cluster drill passes `payload.bucket` only. Phase 4 must widen the guard so `bucket` is also a valid trigger.

### C2. Modal dispatcher and `ariaHidden` bookkeeping
**Source:** Codex Critical 2.
The current modal render in `InsightsTab.tsx` uses `find(...)` + `if/else` per layer, with `listAriaHidden` / `detailAriaHidden` booleans that only know about `detail` / `transcript`. A topmost `cluster` layer would leave lower layers interactive. Phase 6 must update the dispatcher pattern and aria-hidden bookkeeping (preferably via an explicit `switch (layer.kind)` with a TS exhaustiveness guard).

### C3. Single-segment `expected_source` mislabels as `value/` not `Uncategorized`
**Source:** Codex Critical 3.
`split_part('profile','/',2)` returns `''`, so the COALESCE/NULLIF idiom in Phase 2E evaluates to `'profile/'` instead of `'Uncategorized'`. Affects any one-segment values the upstream AI emits. **Fix:** switch to a `CASE` expression that explicitly checks `position('/' IN ...) = 0`.

### C4. `ORDER BY chunk_index LIMIT 1` has no tie-breaker
**Source:** Codex Critical 4.
If two active chunks share `chunk_index`, the LATERAL subquery picks non-deterministically. **Fix:** `ORDER BY chunk_index, id` to make it fully deterministic.

### C5. Correlated-subquery performance for evidence aggregation
**Source:** Gemini Critical 2.
The Phase 2E `sample_evidence` aggregation uses a correlated subquery per `bg.bucket`. For 20+ buckets in 90d, that's 20 subqueries. Postgres usually plans this fine, but Gemini's window-function alternative is cleaner and faster:
```sql
WITH ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY evaluation_id, kind) AS rn
    FROM all_hits
)
... jsonb_agg(jsonb_build_object(...)) FILTER (WHERE rn <= ${sliceCap})
```
**Apply.** Better engineering pattern, faster, simpler to reason about.

### C6. Deferral fallback may explode the longtail
**Source:** Gemini Critical 3.
If the chunks pipeline ever drops `topics[]` population, the `'Uncategorized: ' || d.topic` fallback creates per-deferral buckets (each `d.topic` is essentially unique — 146/147 are distinct). The longtail collapse hides one-offs but the totals are still inflated and the cluster grid is polluted. Today 100% of deferrals bucket via chunks; the risk is future. **Bucket 2 / Q12** — keep dynamic label for forensic value, or fall back to a static "Uncategorized Deferrals" label?

### C7. Cross-functional impact unclear (Slack bot / MCP server)
**Source:** Gemini Critical 4.
`KnowledgeGapClusterRow` is a Dashboard-only TS type; the bot doesn't import it. But the bot/MCP server may query the same Postgres tables and depend on the old vocab bucketing for its own surfaces. **Verify with a grep** before declaring closed.

### C8. Rep-focus payload size — 2MB+
**Source:** Gemini Critical 1.
At 200 sampleEvidence × 20 buckets × ~500B = ~2MB response. **Bucket 2 / Q9** — keep eager 200 cap and accept the payload, OR cap at 5 globally and lazy-load on modal open via a new endpoint?

---

## Should Fix — merged

### S1. Empty `kb_source` citation entries can leak
**Source:** Codex Should-Fix 3.
The Phase 2F `.map()` admits `c.kb_source` truthy but only emits the citation if `chunk_id` AND `doc_id` are present — partial `kb_source` objects produce `{}` entries (because the `kb_source` ternary returns `{}` while the `utterance_index` ternary may also be empty). Apply guard to drop the entire citation entry if neither side is valid.

### S2. Misleading SQL comment ("LATERAL guarantees")
**Source:** Codex Should-Fix 2.
The note in Phase 2E says "LATERAL guarantees ORDER BY + LIMIT before aggregation" but the actual SQL is a correlated subquery. Will be moot after C5 (window-function rewrite).

### S3. `humanizeBucket` doesn't special-case `Uncategorized: <topic>` prefix
**Source:** Codex Should-Fix 4.
The current Phase 6A helper falls through to a raw return. Add an explicit early-return when `bucket.startsWith('Uncategorized: ')` so the label reads as written.

### S4. Tests are SQL-text-only
**Source:** Codex Should-Fix 5.
Phase 7 only asserts strings in the rendered SQL. Add at least:
- One test that clicking a cluster card pushes `{ kind: 'cluster', payload: ... }` onto the modal stack.
- One test that `InsightsEvalDetailModal` renders when only `payload.bucket` is set (the widened C1 guard).

### S5. Asymmetric synthetic-data filtering between ceiling probe and helper
**Source:** Codex Should-Fix 6 + Codex Q3.
The Pre-Flight `gap_ceiling` probe does NOT filter any synthetic flag, but `rep_deferrals` filters `is_synthetic_test_data = false`. If `evaluations` has an equivalent flag, the gap ceiling is inflated and acceptance criterion (a) will appear to fail. **Live probe required** before declaring closed.

### S6. `expected_source` path normalization
**Source:** Gemini Should-Fix 1.
AI-emitted paths may have casing/separator inconsistencies. Data-verifier probed 0 leading-slash / 0 backslash rows but did NOT probe case-inconsistency. **Bucket 2 / Q8.**

### S7. Context loss on rep-name click in Layer 1 cluster modal
**Source:** Gemini Should-Fix 2.
The current Phase 6D click handler closes all modals. Alternative: keep cluster modal stack and re-fetch with rep-scoped data. **Bucket 2 / Q10.**

### S8. Detail modal renders ALL gaps when no `bucket` payload set
**Source:** Gemini Should-Fix 3.
When entering from a heat-map cell (no `bucket`), the new gap-rendering section shows all eval's `knowledge_gaps[]`. Gemini argues this breaks the mental model. **Bucket 2 / Q13.**

---

## Design Questions — needs human input

### Q1. Bucket-namespace collision (gap kb_path vs deferral kb_topic)
**Source:** Codex Q1, Should-Fix 1.
If `playbook/sga-discovery` (kb_path) and `playbook-sga-discovery` (kb_topic) share a bucket string, the row collapses across kinds with `kb_path` winning. Acceptable? Or namespace the bucket strings explicitly?

### Q2. Detail-modal scope on cluster drill
**Source:** Codex Q2, Gemini Should-Fix 3.
Show **all** gaps+deferrals on the eval (with the matched ones highlighted), or scope strictly to the bucket?

### Q3. Is `chunk_index` semantic order or DB-insertion order?
**Source:** Codex Q3, Gemini Q3.
Single-bucket-per-deferral assumes `chunk_index` reflects something meaningful about primary topic. If it's just creation order, picking the first chunk's first topic may misrepresent the deferral.

### Q4. Bucket label normalization for `Uncategorized: <topic>`
**Source:** Codex Q4.
Leave raw or re-format?

### Q5. Longtail collapse rule
**Source:** Gemini Q1.
Collapse only `totalOccurrences=1 AND bucketKind='uncategorized'` (current), or collapse all `totalOccurrences=1` regardless of kind?

### Q6. Sort by occurrences vs unique reps
**Source:** Gemini Q2.
Add a secondary unique-rep signal in the card UI?

### Q7. Empty state copy
**Source:** Gemini Q5.
What does the cluster surface render when there's no advisor-eligible data in the window?

### Q8. `expected_source` path normalization in SQL
**Source:** Gemini Should-Fix 1.
Apply `LOWER()` + trailing-slash strip + separator normalization, or trust upstream AI?

### Q9. Rep-focus payload size
**Source:** Gemini Critical 1.
Eager 200 cap with ~2MB response, OR cap at 5 + lazy-load via new endpoint?

### Q10. Modal stack preservation on rep-name click
**Source:** Gemini Should-Fix 2.
Close all modals + URL hop, or keep stack and re-fetch with rep scope?

### Q11. Triage filters inside Layer 1 cluster modal
**Source:** Gemini Suggestion 1.
Add in-modal filters (coverage, recency, rep)?

### Q12. Deferral fallback when chunks lack `topics[]`
**Source:** Gemini Critical 3.
Keep dynamic `'Uncategorized: ' || d.topic` OR static `'Uncategorized Deferrals'`?

### Q13. Detail modal — gap render when no `bucket` payload
**Source:** Gemini Should-Fix 3.
Render new gap section only when `bucket` is set, or always?

---

## Suggested Improvements — ranked by impact

| # | Improvement | Source | Effort | Status |
|---|---|---|---|---|
| 1 | Window-function rewrite of evidence aggregation | Gemini | Small | Apply (Bucket 1, replaces C5) |
| 2 | Deterministic chunk tie-breaker (`ORDER BY chunk_index, id`) | Codex | Trivial | Apply (Bucket 1, C4) |
| 3 | Update `ARCHITECTURE.md` to deprecate vocab map | Gemini | Trivial | Apply (Phase 7.5 addition) |
| 4 | Component-level cluster-click test | Codex | Small | Apply (Phase 7) |
| 5 | Empty-state copy in Phase 6 | Gemini | Small | Bucket 2 / Q7 |
| 6 | "Show all" pagination in cluster modal | Gemini | Medium | Bucket 3 (scope) |
| 7 | Triage filters inside Layer 1 | Gemini | Medium | Bucket 3 (scope) |

---

## Raw responses

### Codex (gpt-5.4-mini)

```
## CRITICAL ISSUES (will break build or cause data loss)
1. Phase 4 in InsightsEvalDetailModal.tsx: the modal still gates on (!payload.dimension && !payload.topic) at line 124. The new cluster drill payload only has bucket / bucketKind, so Phase 6 will open a blank modal unless this guard is widened.
2. Phase 6 in InsightsTab.tsx: adding kind: 'cluster' does not become exhaustive protection because the current stack render is find(...) + if/else, not a switch on layer.kind. TypeScript will not force the new branch. The current listAriaHidden / detailAriaHidden booleans only account for detail and transcript, so a topmost cluster layer will leave lower modals exposed.
3. Phase 2E in knowledge-gap-clusters.ts: COALESCE(NULLIF(split_part(...), '/'), 'Uncategorized') does not catch single-segment expected_source values. split_part('profile','/',2) returns '', so the expression becomes profile/, not Uncategorized.
4. Phase 2E: the deferral bucket selection is only deterministic if chunk_index is unique. ORDER BY chunk_index LIMIT 1 has no tie-breaker.

## SHOULD FIX
1. Phase 2E bucket-kind precedence is only safe if bucket strings can never collide across gap and deferral namespaces.
2. Phase 2E sample-evidence comments say "LATERAL guarantees" but the pattern is a correlated subquery.
3. Phase 2F sampleEvidence mapping can admit citation objects with empty {} when kb_source is truthy but missing chunk_id/doc_id.
4. Phase 6 humanizeBucket needs an explicit Uncategorized: <topic> path.
5. Phase 7 only adds SQL-string assertions. Add component-level tests for cluster row click -> detail payload.
6. The pre-flight ceiling probe and the deferral query are asymmetric on synthetic-data filtering.

## DESIGN QUESTIONS
1. Should bucketKind prefer kb_path over kb_topic when the same bucket string appears in both, or never collapse?
2. Should the cluster detail modal show whole evaluation context plus matched evidence, or only the clicked bucket's rows?
3. Is there an evaluations-level synthetic-test flag the gap ceiling probe should exclude?
4. Should uncategorized bucket labels stay raw, or be normalized?

## SUGGESTED IMPROVEMENTS
1. Update modal stack bookkeeping so ariaHidden + exhaustive handling include cluster.
2. Make deferral chunk selection fully deterministic with secondary sort key.
3. Add fixture-driven test for single-segment expected_source case.
4. Split cluster schema into gapBucket and deferralBucket if collisions are possible.
5. Add integration test: cluster card -> row -> detail modal accepts bucket-only payload.
```

### Gemini (gemini-3.1-pro-preview)

```
## CRITICAL ISSUES
1. API Payload Bloat in Rep-Focus Mode: 200 sampleEvidence × 20 buckets × ~500B = ~2MB response. Cap globally at 5; lazy-load full 200 via a new endpoint.
2. SQL Correlated Subquery Bottleneck: 20+ subqueries per call. Rewrite using window functions (ROW_NUMBER() OVER (PARTITION BY bucket ...)) + jsonb_agg().
3. Deferral Clustering Destruction via Fallback: 'Uncategorized: ' || d.topic explodes to 146 distinct buckets if topics[] are unpopulated. Replace with static 'Uncategorized Deferrals'.
4. Cross-Functional Breakage in Bots/MCP: Audit KnowledgeGapClusterRow upstream dependencies (Slack bot, MCP server).

## SHOULD FIX
1. Path Normalization: Apply LOWER() + trailing-slash strip + separator normalization to expected_source.
2. Context Loss on Rep Focus Click: Maintain modal stack; re-fetch cluster-evidence scoped to rep.
3. Context-Free Gap Rendering: When entering EvalDetailModal from a heat-map cell with no bucket, don't render the gap-section.

## DESIGN QUESTIONS
1. Are isolated gaps truly clusters? Collapse all totalOccurrences=1, not just uncategorized.
2. What defines "Top Bucket" — occurrences or unique reps?
3. Is chunk_index an accurate primary topic discriminator?
4. How strictly should rep-focus bound 1x occurrences?
5. How should empty states be handled?

## SUGGESTED IMPROVEMENTS
1. Triage filters in Layer 1 modal.
2. Show-all pagination.
3. ARCHITECTURE.md deprecation note for vocab map.
```
