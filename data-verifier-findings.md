# Data Verifier Findings — Per-Dimension AI Narrative
Date: 2026-05-11
Scope: Neon Postgres data layer for evaluations.dimension_scores body field
DB: sales-coaching Neon via SALES_COACHING_DATABASE_URL

---

## Probe 1 — evaluations Schema

- 43 columns confirmed.
- `dimension_scores` is JSONB NOT NULL.
- `ai_original` is JSONB NOT NULL.
- `ai_original_schema_version` is a dedicated INTEGER NOT NULL column on the row (NOT embedded inside the JSONB blob).
- `ai_baseline_shadow` exists (nullable JSONB) but never populated (all 407 rows NULL).

---

## Probe 2 — Version Distribution

All 407 evaluations are on rubric_version = 1.

`ai_original_schema_version` distribution:
- v4 = 319 (78.4%)
- v5 = 77 (18.9%)
- v3 = 6
- v2 = 5

The camelCase key `ai_original->>'schemaVersion'` inside the JSONB returns NULL for all rows — version is exclusively in the dedicated column.

---

## Probe 3 — Current dimension_scores Shape

Exhaustive key scan across all 406 evals with non-empty `dimension_scores` found **exactly two keys** per dimension entry:
- `score`
- `citations`

**No `body`, `reasoning`, `rationale`, or any prose field exists anywhere.** The field is clean — no partial backfill has occurred.

Citations are a mixed array. Each entry is either:
- `{ "utterance_index": number }`
- `{ "kb_source": { doc_id, chunk_id, doc_title, drive_url } }`

Dimension count per eval: avg 8.58, min 7, max 15.

---

## Probe 4 — ai_original.dimensionScores Shape

Exhaustive key scan confirms the upstream AI prompt is currently emitting **only `{ score, citations }`** per dimension — identical to what is stored in `dimension_scores`.

**No prose field exists at the per-dimension level in any schema version.**

Top-level `ai_original` keys include `narrative`, `strengths`, `weaknesses`, `knowledgeGaps` (prose at the eval level) but nothing per-dimension. Adding `body` requires a genuine new AI prompt instruction.

---

## Probe 5 — Backfill Sizing

- Total evaluations: 407
- With non-empty dimension_scores: 406
- Missing `body` on any dimension: **406 (100%)**
- Avg dims/eval: 8.58, min 7, max 15
- Avg transcript chars: 63,476; max 246,852; min 394
- call_transcripts rows: 550 (143 unevaluated transcripts exist — out of scope)

---

## Probe 6 — Audit Table Status

No backfill/re-eval audit table exists. The `eval_correction_diff_jobs`, `eval_correction_judgments`, and `eval_correction_retrievals` tables all have 0 rows — infrastructure exists but never used in production.

A new migration is needed to track backfill job state. `evaluation_edit_audit_log` (active, with `edit_source`, `field_path`, `old_value`/`new_value`) could be repurposed for lightweight logging of backfill writes, but a dedicated table is cleaner.

---

## Probe 7 — call_transcripts Shape

3 columns only:
- `call_note_id` (PK/FK, no surrogate id)
- `transcript` (jsonb, NOT NULL)
- `created_at`

Transcript is a JSONB array. Utterance shape:
```json
{ "text": "...", "start_seconds": 0, "end_seconds": 0.08, "speaker_role": "other_party", "utterance_index": 0 }
```

Transcript content field is `text`, **not** `body`.

Utterance counts per call: avg 276, min 3, max 1,495.

---

## Probe 8 — Cost Estimate

| Model | Low estimate | High estimate |
|---|---|---|
| Sonnet 4.6 | $27.29 | $31.08 |
| Opus 4.7 | $136.46 | $155.40 |

Assumptions:
- ~19,300 input tokens/call (avg transcript + system prompt + rubric context)
- 622–943 output tokens/call (150–300 chars/dim narrative × ~8.58 dims)
- All 406 evals in scope
- Both models fit within 200k context window for even the longest transcript (246k chars)

**Sonnet 4.6 is the clear default. Opus requires explicit justification.**

---

## Probe 9 — Bridge Zod Schema

`DimensionScoreDashSchema` at `src/lib/sales-coaching-client/schemas.ts` lines 349–354 declares only `{ score, citations }` with `.strict()`. `body` is NOT declared.

If `body` appears in API responses before both schema mirrors are updated, all `EditEvaluationRequest` calls that touch `dimension_scores` will fail with a Zod `unrecognized_keys` error at the bridge. This is a **hard cross-repo coordination gate**.

---

## Critical Planning Implications

1. **The AI prompt change is the critical path.** There is no latent `body` field anywhere to surface — it must be added to the prompt output spec from scratch.

2. **`.strict()` on `DimensionScoreDashSchema` is a deployment ordering hard gate.** Schema mirrors (both repos) must be updated and deployed before any re-eval emits the new field. Sequence: update schemas → deploy → run backfill.

3. **A new migration is required for backfill job tracking.** The existing `eval_correction_*` infrastructure is 0-row untested.

4. **Backfill script JOIN path:**
   ```
   evaluations e
     LEFT JOIN call_transcripts ct ON ct.call_note_id = e.call_note_id
     LEFT JOIN rubrics r ON r.id = e.rubric_id
   ```
   The rubrics join is essential — rubric level descriptions must be in the prompt for quality narratives.

5. **The 11 legacy schema v2/v3 evals are a small-but-real edge case.** Manual sampling recommended before finalizing the prompt.
