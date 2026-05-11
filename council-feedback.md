# Council Feedback — Per-Dimension AI Narrative

Reviewers: Codex (gpt-5.4) + Gemini (gemini-3.1-pro-preview).
Date: 2026-05-11.

---

## Consensus answers (both reviewers agreed)

| Q | Decision | Why |
|---|---|---|
| Q1 (model) | **Sonnet 4.6** | 4-5x Opus cost not justified for 2-3 sentence prose summarization |
| Q3 (body shape) | **(a) plain string + trailing citation pills** | Inline `<<cite:N>>` token splicing creates brittle parsing failures on malformed model output |
| Q4 (rollout) | **(b) schema-first, then emission flag** | Atomic cross-repo deploys are fake safety; `.passthrough()` permanently weakens contract |
| Q5 (splicing infra) | **(a) extract shared `CitedProse` component** | Two diverged private impls already exist; a third copy guarantees inconsistent rendering |

---

## Q2 (score pinning) — split

- **Codex: (c) pin + drift flag** — overwrite hides regressions you'll eventually need to debug
- **Gemini: (a) pure pin** — pure pin protects historical reporting from retroactive changes

**Pragmatic merger**: (c) is strictly more information than (a) — log drift but never auto-overwrite. Manual review of high-drift evals is a follow-up audit job, not a blocker.

---

## MAJOR PUSHBACK — both councils flagged the same scope reduction

**Both reviewers said: do not build an application-layer re-eval endpoint for a one-time 406-row backfill.**

### Codex's alternatives
1. Don't re-run the full evaluator — run a narrow "dimension rationale only" job that takes existing scores + existing citations as **locked inputs** and generates only `body`. Eliminates score-drift entirely.
2. Generate `body` lazily on first modal open; backfill only hot records.
3. Deterministic templated rationale from score + cited snippets — no AI call, no model drift.

### Gemini's alternatives
1. **Zero-backfill**: gracefully handle missing `body` in UI; only generate for new evals going forward.
2. **Offline scripting**: isolated locally-executed script generates `.sql` file of JSONB UPDATE statements. No app-layer re-eval routing.

### Combined recommendation
**Build an offline "body-only" generation script** (Codex's narrow job + Gemini's offline script):

- Standalone `scripts/backfill-dimension-bodies.cjs` runs locally
- For each eval: pull score + citations + ONLY the utterances cited (not the full transcript) → tight prompt asking ONLY for `body` per dimension → JSONB UPDATE
- Locked inputs guarantee no score drift, no dimension-set mismatch across schema versions
- No new bridge method, no new Dashboard API route, no admin "Re-evaluate" button
- Schema mirror change + UI restructure remain in scope — those are needed for any path

### What gets cut
- Phase A.5 (upstream re-eval endpoint) — DELETED
- Phase C.7 (Dashboard re-eval route) — DELETED
- Phase C.8 (`triggerReEvaluation` bridge method) — DELETED
- Admin "Re-evaluate" button — DELETED
- Re-eval idempotency / auth / rate-limiting design — DELETED

Replaces with: a single offline script that reads + writes Neon directly, callable from a dev machine. Re-runnable. Audit table still useful as a checkpoint store.

### What we lose
- No in-app way for a manager to refresh body on a specific eval. Historic v5 evals with missing body show the fallback message; admins must trigger a fresh CLI run to fill them. **Acceptable** for a one-time backfill.

---

## Additional risks both councils raised (not in the original spec)

### Hard blockers / production failures

1. **The `EvalDetailClient.tsx:641-661` data-loss bug must be fixed BEFORE backfill writes any body**, or the first manager score-edit silently nukes $30 of AI work across all dimensions. (Spec already flagged this as R1 critical.)

2. **Schema-version dimension mismatch**: v2-v5 historicals have different dimension sets than v6 will produce. A "rerun v6 evaluator" approach hallucinates body for dims that don't exist in legacy JSONB. The body-only narrow job eliminates this because dimensions are read from the existing JSONB, not invented from the v6 prompt.

3. **Token count ≠ char count**: max transcript is 247K chars. Spec claims "fits in 200K context" — but that's chars, not tokens. 247K chars ≈ 60K-80K tokens depending on language, well under 200K, but verify with the actual tokenizer before pushing the longest transcripts through.

4. **No idempotency story**: retries can double-bill, double-write, or race with concurrent live edits. Audit table with `(evaluation_id, attempt_number)` UNIQUE handles double-write; need a `WHERE body IS NULL OR length(body)=0` guard to handle resumption.

5. **JSONB partial-update semantics unspecified**: if the bridge replaces the whole `dimension_scores` blob instead of merging per-dimension keys, concurrent edits clobber body. Use `jsonb_set` per-dim, not full replace.

6. **Cache invalidation**: if bridge caches eval payloads (`CACHE_TAGS.CALL_INTELLIGENCE_QUEUE`), backfilled body shows stale until cache busts. Add `revalidateTag` after backfill completes, or accept short staleness.

7. **`.strict()` mirror upgrade is system-wide**: every consumer and test fixture deserializing `dimension_scores` must be upgraded, not just PATCH path. Search for all callers.

8. **Rate limits**: 406 evals × Anthropic API calls = real RPM/TPM pressure. Spec's `sleep(200)` is naive — need exponential backoff on 429 and probably batching.

9. **Orphan citations**: if the model emits a citation `utterance_index` not in the existing citations array, the pill will be a dead click. Validate body citations against the locked input array before write.

10. **Body provenance audit**: per-eval audit row should record `model_id`, `prompt_version`, `schema_version`, `body_generated_at`. Codex's exact request.

---

## Revised phase order (post-council)

### Phase A — sales-coaching (upstream) PR
A.1 Add `body: z.string().optional()` to DimensionScore Zod schema. Keep `.strict()`.
A.2 Match in `src/lib/db/types.ts`.
A.3 Migration: `eval_body_backfill_audit` table.
A.4 Bump `AI_ORIGINAL_SCHEMA_VERSION` to 6.
A.5 ~~POST /re-evaluate endpoint~~ **DELETED per council**.
A.6 Add prompt-update guard: emission of `body` controlled by env flag (`EMIT_DIMENSION_BODY=false` by default in prod). Allows mirror to deploy first.
A.7 Deploy A.1-A.6. Flag stays OFF until Dashboard mirror is live.

### Phase B — Dashboard PR (gated on A merging)
B.1 `/sync-bridge-schema` to mirror the Zod change.
B.2 Fix `EvalDetailClient.tsx:641-661` body-spread (the R1 data-loss-fix). Must merge first.
B.3 Update remaining construction sites (types, readDimensionScores, canonicalDimensionScores).
B.4 Extract shared `CitedProse` component (Q5 consensus).
B.5 Restructure `InsightsEvalDetailModal` to lead with body + fallback message.
B.6 Update `citation-helpers.ts` v6 gate.
B.7 Update `coaching-notes-markdown.ts` to include body.
B.8 ~~New Dashboard /re-evaluate route + bridge method + admin button~~ **DELETED per council**.
B.9 Reconcile `scripts/check-schema-mirror.cjs` `BRANCH = 'main'`.
B.10 Build clean. Deploy.

### Phase C — Upstream prompt flip (gated on B deploy)
C.1 Update evaluator prompt to emit `body` per dimension.
C.2 Set `EMIT_DIMENSION_BODY=true`. New evals from this moment have body.

### Phase D — Backfill (gated on C deploy)
D.1 Build `scripts/backfill-dimension-bodies.cjs`:
   - Direct Neon connection via `SALES_COACHING_DATABASE_URL_UNPOOLED`
   - Direct Anthropic SDK call (no bridge)
   - For each eval: pull score + citations + cited-utterance text only → tight body-only prompt → `jsonb_set` per dim
   - Defaults to dry run; `--commit` to write
   - Resume from audit checkpoint (`WHERE body IS NULL`)
   - Sleep 200ms between calls; exponential backoff on 429
   - Per-row audit insert with model, prompt_version, schema_version_before
   - Validate emitted citation utterance_indexes against existing citations array; drop unmatched citations
   - Manual pilot on 5 evals across schema versions, then full run
D.2 Verification SQL: every eval has body on every dimension.

---

## Open decisions for human gate

1. **Approve scope reduction**: drop application-layer re-eval endpoint + admin button, replace with offline script.
2. **Approve cost**: ~$27-31 (Sonnet 4.6 narrow body-only prompt).
3. **Approve score-pinning policy**: pin scores; log drift only IF we choose to also re-eval for drift detection (currently NO — the body-only prompt doesn't even produce a new score, so drift is moot).
4. **Approve body shape**: plain string + trailing citation pills (no inline tokens).
5. **Approve rollout**: schema mirror first, then upstream prompt flip behind env flag, then offline backfill.

If all five approved → proceed to Phase 5 (build agentic_implementation_guide.md).
