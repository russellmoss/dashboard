# Exploration Results — Per-Dimension AI Narrative ("body" field)

**Generated:** 2026-05-11
**Feature:** Add a 2–3 sentence AI rationale per dimension score in evaluations, with inline citation pills, rendered as the primary content of the Insights drill-down modal.
**Scope:** Cross-repo (sales-coaching upstream + Dashboard downstream) + Neon backfill of 406 existing evaluations.

Source documents:
- `code-inspector-findings.md`
- `data-verifier-findings.md`
- `pattern-finder-findings.md`

---

## 1. Current State (verified)

### Data layer
- 407 evaluations in Neon. 406 have non-empty `dimension_scores`. **100% lack a `body` field on any dimension** — clean slate, no partial backfill.
- `dimension_scores[dim]` is JSONB with exactly two keys today: `score` + `citations`. Same shape in `ai_original.dimensionScores`.
- `ai_original_schema_version` is a dedicated INTEGER column. Distribution: v4 = 319 (78.4%), v5 = 77 (18.9%), v3 = 6, v2 = 5.
- All evals are on `rubric_version = 1`.
- Citations are mixed `{ utterance_index }` or `{ kb_source }` entries.
- Avg ~8.58 dimensions per eval, max 15. Avg transcript ~63K chars.

### Bridge contract
- `src/lib/sales-coaching-client/schemas.ts:349-354` — `DimensionScoreDashSchema` uses **`.strict()`**, which will reject unknown keys at runtime. **Adding `body` server-side without an atomic mirror update breaks every PATCH edit.**
- Sync workflow: `/sync-bridge-schema` skill or `gh api repos/russellmoss/sales-coaching/contents/...`. Drift detected by `scripts/check-schema-mirror.cjs` (byte-equality).
- ⚠️ **Branch discrepancy**: the CI script line 26 says `BRANCH = 'master'` while CLAUDE.md and the skill say `main`. Reconcile before sync.

### Code consumers
Six construction sites of the dimension-score shape — every one must be updated, or `body` is silently dropped:

1. `src/types/call-intelligence.ts:91` — shared TS type for `EvaluationDetail.dimension_scores`. Add `body?: string`.
2. `src/lib/sales-coaching-client/schemas.ts:349-354` — bridge Zod. Add `body: z.string().optional()`. **Must sync atomically with upstream.**
3. `EvalDetailClient.tsx:95-99` — local `DimensionScoreEntry` interface. Add `body?: string`.
4. `EvalDetailClient.tsx:101-117` — `readDimensionScores()` (reads `ai_original.dimensionScores`) drops `body` silently. Add `body: val.body`.
5. `EvalDetailClient.tsx:450-455` — `canonicalDimensionScores` map drops `body`. Add `body: v.body` to the map output.
6. **`EvalDetailClient.tsx:641-661` — `InlineEditDimensionScore.onSave` reconstruction loop.** Rebuilds the entire `dimension_scores` map on every manager score edit and does not include `body`. **THIS IS A DATA-LOSS BUG: once body exists, every manager score edit silently nukes body across all dimensions.** Fix: spread `body` into each entry and widen the `base` type annotation.

### Re-eval / re-evaluation
- **No re-eval invocation exists anywhere in the repo.** All evaluation work is upstream. The Dashboard only calls `editEvaluation` via the bridge.
- Closest pattern: `salesCoachingClient.editEvaluation` at `index.ts:313-325` — `PATCH /api/dashboard/evaluations/:id/edit` with OCC via `expected_edit_version`. Auth: session + `permissions.allowedPages.includes(20)`.
- New endpoint needed in sales-coaching: `POST /api/dashboard/evaluations/:id/re-evaluate`.

### Citation rendering
- **No shared `CitedText` component.** Two private impls have already diverged:
  - `EvalDetailClient.tsx:163-197` — `CitedTextLine` (editable contexts)
  - `InsightsEvalDetailModal.tsx:106-139` — `CitedText` (read-only)
- Both render prose + a **trailing chip row of pills**. Neither splices pills mid-sentence.
- The spec asks for `"...stated the AUM minimum accurately at [💬 109]..."` — inline-in-prose pills. **No infrastructure exists for that pattern.** Either:
  - (a) Accept the existing append-after-prose convention (renderable today), or
  - (b) Build new infrastructure: AI emits `<<cite:109>>` tokens in body text, renderer splits the string on tokens and interpolates pills. Cleaner UX but new work.

### Version gating
`citation-helpers.ts:36-45` already discriminates v3/v4/v5 fields:
```ts
if (field === 'coachingNudge') return version >= 3;
if (field === 'additionalObservations') return version >= 4;
if (field === 'repDeferrals') return version >= 5;
```
**Add v6: `if (field === 'body') return version >= 6;`**. Bump `ai_original_schema_version` to 6 on new evals.

### Admin permission gate
Canonical pattern: `const isAdmin = role === 'admin' || role === 'revops_admin'` (CallIntelligenceClient.tsx:24, EvalDetailClient.tsx:251).

- `InsightsEvalDetailModal` has **no `role` prop today**. To add an admin "Re-evaluate" button, plumb `role` from `InsightsTab` → modal.
- API route gate: mirror `edit/route.ts` plus an explicit `if (role !== 'admin' && role !== 'revops_admin') return 403;` check.

### Backfill script conventions
- New convention (use this): `scripts/backfill-coaching-what-id.cjs` — `.cjs`, **default dry run**, `--commit` to write, idempotency via SQL guard (`WHERE col IS NULL`).
- Closest AI-batch precedent: `scripts/sms-reclassify-step2-classify.js` — `@anthropic-ai/sdk`, `sleep(200)` between batches, `sleep(30000)` + retry on 429.
- No backfill audit table exists. The 0-row `eval_correction_*` tables could be repurposed, but a dedicated table is cleaner.

### Cost (Sonnet 4.6 default, Opus 4.7 explicit upgrade)
| Model | Low | High |
|---|---|---|
| Sonnet 4.6 | $27.29 | $31.08 |
| Opus 4.7 | $136.46 | $155.40 |

Sonnet 4.6 fits the eval rationale task — recommend default unless we find quality issues in pilot.

---

## 2. Target shape

**Per-dimension entry in `dimension_scores[dim]`:**
```ts
{
  score: number,
  citations: Citation[],
  body?: string  // NEW — 2-3 sentence rationale, ~150-300 chars
}
```

**Re-eval endpoint contract (NEW):**
```
POST /api/call-intelligence/evaluations/[id]/re-evaluate
auth: session + role in ['admin', 'revops_admin']
body: { confirm: true }
returns: { ok: true, evaluation_id: uuid, schema_version_after: 6 }
```

**Backfill audit table (NEW migration in sales-coaching):**
```sql
CREATE TABLE eval_body_backfill_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('pending','success','failure','skipped')),
  error_message text,
  input_tokens integer,
  output_tokens integer,
  schema_version_before integer NOT NULL,
  schema_version_after integer,
  score_drift_detected boolean DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_eval_body_backfill_eval_attempt ON eval_body_backfill_audit(evaluation_id, attempt_number);
```

---

## 3. Recommended phase order

(Cross-repo. Each phase blocks the next.)

### Phase A — sales-coaching (upstream) PR #1: schema + audit table
A.1 Add `body: z.string().optional()` to `DimensionScore` in `src/lib/dashboard-api/schemas.ts`. Keep `.strict()`.
A.2 Add corresponding shape change to `src/lib/db/types.ts`.
A.3 Migration: `eval_body_backfill_audit` table.
A.4 Bump `AI_ORIGINAL_SCHEMA_VERSION` constant from 5 → 6.
A.5 New endpoint: `POST /api/dashboard/evaluations/:id/re-evaluate` — auth gate (session, role in admin/revops_admin), idempotent if a re-eval is in-flight, returns updated eval.
A.6 New tests: schema parse, endpoint auth, end-to-end round-trip with the new `body` field.
A.7 **CRITICAL**: schema must roll out before any code emits the new field.

### Phase B — sales-coaching PR #2: AI prompt change (gated on PR #1 merging)
B.1 Update the evaluator system prompt to emit `body` per dimension.
B.2 Body format spec:
   - 2–3 sentences, ~150–300 chars
   - paragraph prose, NOT bullets
   - cites at least one utterance_index that appears in this dimension's `citations` array
   - explains WHY the score, mapping rep behavior to rubric criteria
   - **decision pending council**: inline `<<cite:N>>` tokens or no inline markers
B.3 Manual QA: run the v6 prompt against 5–10 sample transcripts (varied scores, varied dims, varied lengths). Eyeball quality.
B.4 Unit test: schema round-trip with `body` populated.
B.5 Deploy upstream service to prod with `body` emission active. New evals from this moment forward have `body`.

### Phase C — Dashboard PR: mirror + UI + admin re-eval button (gated on B.5)
C.1 `/sync-bridge-schema` to mirror Zod change.
C.2 Run `npm run check:schema-mirror` — must pass byte-equality.
C.3 Update `src/types/call-intelligence.ts:91`.
C.4 Update all 4 EvalDetailClient.tsx construction sites (95-99, 101-117, 450-455, **641-661 with the body spread fix**).
C.5 Update `src/lib/coaching-notes-markdown.ts:57-65` to include `body` in markdown export.
C.6 Restructure `InsightsEvalDetailModal.tsx`:
   - Remove sections: narrative, strengths, weaknesses, knowledge_gaps, compliance_flags, additional_observations, rep_deferrals (from the modal — they stay on /evaluations/[id]).
   - Keep: dimension banner (score badge), topic-drill panel (independent path).
   - Add: body paragraph + inline-or-trailing citation pills, sourced from `detail.dimension_scores[dim].body`.
   - Add: fallback "(no per-dimension rationale on file — admin can re-run AI eval)" when `body` is undefined/empty.
   - Plumb `role` prop from `InsightsTab` and render admin-only "Re-evaluate" button.
C.7 New Dashboard API route: `POST /api/call-intelligence/evaluations/[id]/re-evaluate` — gates on admin role, calls `salesCoachingClient.triggerReEvaluation()` (new bridge method).
C.8 New bridge method: `salesCoachingClient.triggerReEvaluation(id)`.
C.9 Update `citation-helpers.ts:36-45` to add `if (field === 'body') return version >= 6;`.
C.10 Build + lint clean.

### Phase D — Backfill (gated on C deploy)
D.1 Create `scripts/backfill-dimension-bodies.cjs`:
   - default dry run; `--commit` to write
   - resume-from-checkpoint via `eval_body_backfill_audit` (skip evals with `status='success'`)
   - rate limit: `sleep(200)` between calls; `sleep(30000)` + retry on 429
   - per row: SELECT transcript + rubric → POST to re-evaluate endpoint → write audit row
   - **decision pending council**: score-pinning policy
D.2 Sample run: dry run on all 406 → log token counts, expected cost.
D.3 Pilot: run `--commit` on 5 evals across different schema_versions (v2, v3, v4, v5). Manual review.
D.4 Full backfill: 406 evals minus 5 pilot.
D.5 Verification SQL: count evals where ALL dimensions have non-empty body.

---

## 4. Open questions (route to council)

### Q1 — Backfill model selection
Sonnet 4.6 ($27–31) vs Opus 4.7 ($136–155). Quality vs cost. **Default: Sonnet.** Council to confirm if eval rationale is "soft reasoning" Sonnet handles cleanly, or if it warrants Opus.

### Q2 — Score-pinning policy on re-evaluation
When the backfill re-runs the v6 prompt against an existing eval's transcript, the new model run will produce both `body` AND a fresh `score`. Options:
- **(a) Pin score**: write only `body`; keep existing `score` even if new run disagrees. Avoids retroactively changing manager-reviewed scores. Risk: body explains a score the model wouldn't give today.
- **(b) Re-score**: overwrite `score` with the v6 output. Cleaner narrative-to-score consistency. Risk: invalidates prior manager review.
- **(c) Pin, but flag drift**: pin the score, log `score_drift_detected=true` in audit when |old-new| ≥ 1.0 so we can manually review high-drift evals.

### Q3 — Body shape: plain string with separate citations, or inline-cite tokens
- **(a) Plain string + append-after pills** (matches existing CitedText). Easy, ships today.
- **(b) `<<cite:N>>` tokens inline + splicing renderer**. Better UX. Costs: AI prompt complexity, new renderer, edge cases.

### Q4 — Partial-rollout strategy for the `.strict()` schema gate
`DimensionScoreDashSchema` rejects unknown keys. If upstream PR #2 deploys before Dashboard PR (the mirror update), every PATCH /edit by a manager fails 400 Zod.

Options:
- **(a) Atomic deploy**: ship upstream + Dashboard in the same deploy window.
- **(b) Two-PR upstream**: PR #1 schema-only with `body` optional + still-emitted-only-on-flag (default off in prod). Dashboard PR mirrors. Then upstream PR #2 flips the flag.
- **(c) Temporary `.passthrough()`** on `DimensionScoreDashSchema` for the rollout window, revert to `.strict()` after both sides are in sync.

### Q5 — Mid-prose splicing infrastructure ownership
If Q3 lands on (b), where does the splicer live? Shared component extracted from the two existing private `CitedText` impls? New `src/components/call-intelligence/CitedProse.tsx`?

---

## 5. Risk register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Inline-edit loop drops `body` on every save | **CRITICAL** | Fix `EvalDetailClient.tsx:641-661` BEFORE first `body` data is written |
| R2 | `.strict()` schema rejects body if deploy order wrong | High | See Q4 — atomic deploy or staged mirror first |
| R3 | Score drift after re-eval invalidates manager review | High | See Q2 — pin-with-drift-flag is the safe default |
| R4 | Branch drift (`main` vs `master`) in CI sync check | Medium | Reconcile in same PR — set `BRANCH = 'main'` in `scripts/check-schema-mirror.cjs` |
| R5 | KB pills no-op in modal — `onOpenKB` not wired | Medium | Plumb `onOpenKB` from InsightsTab through detail modal during C.6 |
| R6 | Legacy v2/v3 evals (11 total) may produce malformed body | Low | Sample-review pilot run includes them |
| R7 | `coaching-notes-markdown.ts` omits body from exports | Low | C.5 fix; no data loss, just missing from notes |
| R8 | No re-eval endpoint exists upstream — full build | High | Phase A.5 owns it |
| R9 | Backfill could blow Anthropic budget on retry storms | Medium | Default dry run, `sleep + 429 backoff`, per-row audit row |

---

## 6. Files touched (final count)

**sales-coaching repo (upstream):**
- `src/lib/dashboard-api/schemas.ts` — add `body` to DimensionScore
- `src/lib/db/types.ts` — match the change
- new migration: `eval_body_backfill_audit` table
- new route: `POST /api/dashboard/evaluations/:id/re-evaluate`
- AI prompt file (location TBD)
- `AI_ORIGINAL_SCHEMA_VERSION` constant → 6

**Dashboard repo:**
- `src/lib/sales-coaching-client/schemas.ts` — mirror sync
- `src/types/call-intelligence.ts` — add `body?: string`
- `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` — 4 sites (including the data-loss-fix)
- `src/components/call-intelligence/InsightsEvalDetailModal.tsx` — restructure to lead with body
- `src/components/call-intelligence/citation-helpers.ts` — add v6 gate
- `src/lib/coaching-notes-markdown.ts` — include body in exports
- `src/app/api/call-intelligence/evaluations/[id]/re-evaluate/route.ts` (NEW)
- `src/lib/sales-coaching-client/index.ts` — add `triggerReEvaluation` method
- `scripts/check-schema-mirror.cjs` — reconcile branch name
- `scripts/backfill-dimension-bodies.cjs` (NEW)
- `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx` — plumb `role` to modal

Count: ~11 files in Dashboard, ~5 files + 1 migration upstream, 1 new backfill script.

---

## 7. Acceptance criteria

- (a) Manager drills heat-map cell → Layer 2 modal opens → dimension name + score badge + 2–3 sentence body + citation pills.
- (b) Click utterance citation in body → Layer 3 transcript modal jumps to that utterance.
- (c) Click KB citation → renders the KB chunk inline (existing `chunk_lookup` pattern).
- (d) Historic eval pre-backfill → fallback "no rationale on file" message + admin-only "Re-evaluate" button.
- (e) Admin clicks Re-evaluate → endpoint fires → body populates → button hides.
- (f) `npm run check:schema-mirror` passes byte-for-byte.
- (g) Manager edits a dimension score → body for THAT and OTHER dimensions is preserved (data-loss-fix verified).
- (h) After backfill, no eval has `body IS NULL` on any dimension (verification SQL clean).
- (i) Backfill audit table records one row per eval with `status='success'` and no `score_drift_detected=true` unless intentionally re-scored.

---

## 8. Out of scope (separate ships)

- Editing the dimension body via inline edit (read-only for this ship).
- Telemetry on re-eval button click count (basic console.warn only).
- A11y polish on the modal beyond what the original modal-stack work shipped.
- Re-evaluating un-evaluated transcripts (143 exist; covered by a different feature).
- Updating the analyst bot or MCP server with awareness of the new body field.
