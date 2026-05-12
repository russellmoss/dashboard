# Exploration Results — Knowledge Gap Clusters Rewrite (§6)

**Generated:** 2026-05-12
**Feature:** Rewrite the Knowledge Gap Clusters surface on the Insights tab. Part 1 = bucketing rewrite (drop synonym map; use `expected_source` paths for gaps and `knowledge_base_chunks.topics[]` lateral for deferrals). Part 2 = ranking + longtail-collapse. Part 3 = drill-down modal chain reusing §5's stack.
**Scope:** Dashboard-only. No upstream sales-coaching changes. No Neon backfill required (data already populated).

## Pre-Flight Summary

Three exploration agents finished without blockers. The rewrite is buildable in one PR. Live Neon probes confirm spec field shapes and bucket numbers (with minor decay since the spec was written: 765 gap items / 169 deferrals in 90d, vs spec's 422 / 147). §5's modal stack — `InsightsEvalListModal` (z-50), `InsightsEvalDetailModal` (z-[60]), `TranscriptModal` (z-[70]) plus `CitationPill` — is fully shipped, so Part 3 (modal-chain drill-down) is GO. One unanticipated gap: the existing `InsightsEvalDetailModal` topic-drill section is deferral-only (lines 269–300, commented "reserved for cluster ship"); a gap-evidence render path needs to be added there as part of §6c. The `humanizeKey` UI helper can't render `/`-path bucket labels — a small new display helper is required. The new SQL pattern (LATERAL JOIN to `knowledge_base_chunks` + `unnest(topics)`) is new to the call-intelligence directory but has a verbatim precedent in `src/lib/queries/record-notes.ts:256` (LEFT JOIN LATERAL ... ON TRUE).

## Postgres (Neon) Data Layer Status

All required tables and columns exist with the types the spec assumes.

| Table | Verified columns | Notes |
|---|---|---|
| `evaluations` | `knowledge_gaps` JSONB array, `dimension_scores` JSONB, `rep_id`, `call_note_id`, `created_at`, `rubric_version` | 765 gap items in 90d; `knowledge_gaps[].text` 100% populated, `expected_source` 90.4% populated (vs spec's 92%), `citations` 100% populated |
| `rep_deferrals` | `kb_chunk_ids` uuid[] NOT NULL, `utterance_index` int NULLABLE (schema-level), `deferral_text` text NOT NULL 100% populated, `kb_coverage` text (NOT enum), `is_synthetic_test_data` bool NOT NULL, `call_note_id`, `topic`, `created_at` | 169 advisor-eligible rows in 90d; 100% have at least one active chunk with topics — lateral coverage is 100% |
| `knowledge_base_chunks` | `id` UUID PK, `topics` text[] NOT NULL, `is_active` bool NOT NULL, `chunk_index` int NOT NULL, `body_text`, `chunk_role`, `call_stages`, `rubric_dimensions`, `doc_id`, `drive_file_id` | 31 distinct curated topics across 176 active chunks (within spec's "~10–30" guidance) |
| `call_notes` | `id`, `source`, `likely_call_type` | Advisor-eligible filter `(source='kixie' OR likely_call_type='advisor_call')` is the verbatim repo idiom |
| `reps` | `id`, `full_name`, `is_system`, `is_active`, `role` | Joined via `scoped_reps` CTE |

**Live probe results (90-day window):**

- **Top bucket:** `profile/ideal-candidate-profile` = **143 gaps, 13 reps** (spec said 132/13 — minor decay, criterion (c) needs to be loosened to "rep count ≈ 13")
- **`expected_source` 2-segment bucket distribution:** 20 distinct buckets, top 5 = `profile/ideal-candidate-profile` (143), `playbook/sga-discovery` (103), `facts/process` (32), `playbook/sgm-intro` (26), `playbook/handoff`/`playbook/platform-review` (21 each)
- **Uncategorized gap bucket:** 43/450 advisor-eligible rows = 9.6% (well-bounded)
- **`knowledge_base_chunks.topics` distribution:** top 5 = `sgm_handoff` (46), `discovery_call_structure` (34), `move_mindset` (32), `candidate_persona` (31), `aum_qualification` (27)
- **Lateral deferral-coverage rate:** 169/169 = **100%** — the `'Uncategorized: ' || d.topic` fallback hits zero rows today. Spec assumed >70%; reality is full coverage. **Keep the fallback in SQL** for future-proofing, but don't build dedicated UI logic around it.
- **Unfiltered ceiling (acceptance criterion (a)):** 450 advisor-eligible gaps + 169 advisor-eligible deferrals = 619 rows the rewrite must surface.

**Data quality risks — all probed and clean:**

- 0 rows with leading slashes or backslashes in `expected_source`
- 0 rows with NULL/empty `kb_chunk_ids` (column is NOT NULL)
- 0 chunks with duplicate topics
- 0 deferrals with NULL/empty `d.topic` in 90d
- `NULLIF(split_part('','/',1) || '/' || split_part('','/',2), '/')` returns NULL — COALESCE → 'Uncategorized' works

**Surprise — `kb_source.chunk_id` field name:** In `knowledge_gaps[].citations`, the `kb_source` sub-object uses the field name `chunk_id` (not `id`). This maps to `knowledge_base_chunks.id` via aliasing in `call-intelligence-evaluations.ts:465`. The Citation type in the new `sampleEvidence` array must match: `kb_source?: { doc_id, chunk_id, doc_title, drive_url }`.

## Files to Modify

| File | Type of change |
|---|---|
| `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts` | Full CTE rewrite — drop `topics` CTE, drop `$9::jsonb`, add LATERAL deferral join, add `evidence_text` + `citations` + `expected_source_full` columns, add `mode` arg, conditional slice-cap literal (5 vs 200) |
| `src/types/call-intelligence.ts` | `KnowledgeGapClusterRow`: rename `topic` → `bucket`, add `bucketKind`, add `sampleEvidence[]`. Extend `InsightsModalStackLayer` union with new `kind: 'cluster'` variant + payload type. Add `KnowledgeGapClusterEvidence` type |
| `src/app/api/call-intelligence/insights/clusters/route.ts` | Add `?mode` (or derive from `focusRep`) and `?limit=full` query params; pass `mode: focusRep ? 'rep_focus' : 'team'` to helper |
| `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx` | Cluster card → clickable wrapper; new `humanizeBucket` display helper for `/`-path labels; longtail-collapse state + render; cluster-modal stack entry; URL hash sync entry for `#modal=cluster` |
| `src/components/call-intelligence/InsightsEvalDetailModal.tsx` | Add gap-evidence render path next to existing topic-drill (which is deferral-only today) |
| `src/components/call-intelligence/InsightsEvalListModal.tsx` (or new `InsightsClusterEvidenceModal.tsx`) | Layer 1 cluster-evidence variant — see Phase 5 design decision |
| `src/lib/queries/call-intelligence/__tests__/knowledge-gap-clusters.test.ts` | Remove `params[8]` synonyms assertion; add LATERAL appearance check |
| `src/lib/kb-vocab-synonyms.ts` | Keep file as theming data; remove the `import KB_VOCAB_SYNONYMS` from `knowledge-gap-clusters.ts` only (verified: no other consumers) |

## Type Changes (exact)

```ts
// src/types/call-intelligence.ts

export interface KnowledgeGapClusterEvidence {
  evaluationId: string;
  repId: string;
  repName: string;
  kind: 'gap' | 'deferral';
  text: string;                                  // gap text OR verbatim deferral quote
  callStartedAt: string | null;                  // for the cluster-evidence modal columns
  citations: Array<{
    utterance_index?: number;
    kb_source?: { doc_id: string; chunk_id: string; doc_title: string; drive_url: string };
  }>;
  expectedSource?: string;                       // gap-only, full path
  kbCoverage?: 'covered' | 'partial' | 'missing'; // deferral-only
}

export interface KnowledgeGapClusterRow {
  bucket: string;                                  // renamed from `topic`
  bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized';
  totalOccurrences: number;
  gapCount: number;
  deferralCount: number;
  deferralByCoverage: { covered: number; partial: number; missing: number };
  repBreakdown: Array<{ repId: string; repName: string; gapCount: number; deferralCount: number }>;
  sampleEvalIds: string[];
  sampleEvidence: KnowledgeGapClusterEvidence[];
}

// Modal stack — add to existing InsightsModalStackLayer discriminated union:
export type InsightsModalStackLayer =
  | { kind: 'list'; payload: EvalListModalPayload }
  | { kind: 'detail'; payload: EvalDetailDrillPayload }
  | { kind: 'transcript'; payload: TranscriptModalPayload }
  | { kind: 'cluster'; payload: ClusterEvidenceModalPayload }; // NEW

export interface ClusterEvidenceModalPayload {
  bucket: string;
  bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized';
  evidence: KnowledgeGapClusterEvidence[];
  gapCount: number;
  deferralCount: number;
}
```

## Construction Site Inventory

| File:Line | What it touches | Required change |
|---|---|---|
| `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts:179-200` | `.map(r => ({ topic: r.topic, ... }))` | Rewrite full mapper: `bucket`, `bucketKind`, `sampleEvidence` |
| `src/types/call-intelligence.ts:301-309` | `KnowledgeGapClusterRow` definition | Rename + add fields |
| `src/types/call-intelligence.ts:329-356` | `InsightsModalStackLayer` union | Add `cluster` variant |
| `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx:631` | `key={c.topic}` | → `key={c.bucket}` |
| `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx:634` | `humanizeKey(c.topic)` | → new `humanizeBucket(c.bucket, c.bucketKind)` |
| `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx:193` | Type import | No code change, but the import resolves to a different shape after the rename — verify build |
| `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx:208` | `modalStack` state | Already typed via union — extending union adds new variant cleanly |
| `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx:261-280` | URL hash sync block | Add `#modal=cluster&bucket=...` case |
| `src/app/api/call-intelligence/insights/clusters/route.ts:101-110` | `getKnowledgeGapClusters({...})` call | Add `mode`, accept `?limit=full` (informational — `mode` already implies cap) |
| `src/lib/queries/call-intelligence/__tests__/knowledge-gap-clusters.test.ts:45-56` | `expect(params[8]).toBe(synonymsJson)` | Delete; replace with LATERAL-present assertion |

## §5 Modal Infrastructure Status — GO

All §5 prerequisites are shipped:

| Component | Location | Status |
|---|---|---|
| Modal stack helper (state) | `InsightsTab.tsx:207-258` | shipped |
| Layer 1 — eval-list | `src/components/call-intelligence/InsightsEvalListModal.tsx` | shipped |
| Layer 2 — eval-detail | `src/components/call-intelligence/InsightsEvalDetailModal.tsx` | shipped; topic-drill section deferral-only (gap path needs adding for §6c) |
| Layer 3 — transcript | `src/components/call-intelligence/TranscriptModal.tsx` | shipped; prop is `initialUtteranceIndex` (int), NOT `initialUtteranceId` (spec was loose on the name) |
| Citation pill | `src/components/call-intelligence/CitationPill.tsx` | shipped |
| Eval-detail API route | `/api/call-intelligence/evaluations/[id]` | used (the spec's proposed `/insights/eval-detail` was never created — current implementation reuses the full-eval route) |
| Old page-nav drilldown | `/dashboard/call-intelligence/insights/evals/page.tsx` | deleted |
| URL hash sync for back-button | `InsightsTab.tsx:261-290` | shipped — new `cluster` case slots into the existing block |

## Recommended Phase Order

1. **Pre-Flight** — `npm run build` baseline; capture current bucket totals via SQL probe (sanity baseline for acceptance criterion (a))
2. **Phase 1 — Types** (`src/types/call-intelligence.ts`): add `KnowledgeGapClusterEvidence`, reshape `KnowledgeGapClusterRow`, extend `InsightsModalStackLayer`. **This intentionally breaks the build** — TypeScript errors become the checklist of remaining construction sites.
3. **Phase 2 — Query rewrite** (`knowledge-gap-clusters.ts`): drop `topics` CTE + `$9`, rewrite `gap_hits` and `deferral_hits` CTEs with new bucket logic + evidence columns, add `mode` arg with conditional slice-cap literal, update `.map()` constructor, update RawRow type, remove `KB_VOCAB_SYNONYMS` import
4. **Phase 3 — API route** (`clusters/route.ts`): pass `mode` derived from `focusRep`, accept `?limit=full` validator
5. **Phase 4 — Modal extension** (`InsightsEvalDetailModal.tsx`): add gap-evidence render path (the existing topic-drill is deferral-only)
6. **Phase 5 — Cluster-evidence modal** (Layer 1 variant): extend `InsightsEvalListModal` with a `mode: 'evalList' | 'clusterEvidence'` prop, OR create `InsightsClusterEvidenceModal.tsx` as a sibling. Recommend the latter for clarity — they have different column sets and different row click semantics. Council can adjudicate.
7. **Phase 6 — UI wiring** (`InsightsTab.tsx`): new `humanizeBucket` helper, cluster card click handler that pushes `{ kind: 'cluster', payload }`, longtail-collapse state + render, URL hash sync entry, dispatcher for the new modal variant
8. **Phase 7 — Tests** (`__tests__/knowledge-gap-clusters.test.ts`): remove `$9` assertion, add LATERAL check, optionally add a row-construction snapshot
9. **Phase 7.5 — Doc sync** (`npx agent-guard sync` per CLAUDE.md standing rule)
10. **Phase 8 — Live probes + browser validation** (the three spec probes + manual click-through)

## Risks and Blockers

| Risk | Severity | Mitigation |
|---|---|---|
| **Spec acceptance criterion (c) is decayed** (was 132 gaps / 13 reps; now 143/13) | Low | Loosen criterion to "≈13 reps, ≥130 gaps" or convert to label-only ("top bucket is `profile/ideal-candidate-profile`") |
| **`InsightsEvalDetailModal.tsx` topic-drill is deferral-only** — gap drill path absent | Medium | Add a parallel gap-evidence render section in §6c work. Council should flag the exact slot to insert. |
| **`humanizeKey` can't render `/`-path bucket labels** | Low | Ship a small `humanizeBucket(bucket, kind)` helper that splits on `/` and capitalizes each segment, joining with ` › ` (or similar). Keep `humanizeKey` for non-cluster usage. |
| **Slice-cap literal injection** (5 vs 200) — Postgres rejects bound params for array-slice bounds | Low | Build two SQL variants in TS (or one with a string-substituted literal). Single source of truth for the value (don't hardcode `5` in multiple places). |
| **`utterance_index` is nullable at schema level** | Low | Modal must guard `null` before scrolling. 0 of 169 deferrals are null today, but column allows it. |
| **`kb_source.chunk_id` (gap citations) vs `knowledge_base_chunks.id` (chunks table)** — naming mismatch | Low | Already aliased in existing code at `call-intelligence-evaluations.ts:465`. Document inline. |
| **`InsightsClusterEvidenceModal` — new component vs extending Layer 1?** | Medium | Phase 5 design call. Recommend sibling component (different columns, different click target for "enter rep-focus mode"). Council can adjudicate. |
| **Test file `params[8]` assertion** | Low | One-line removal + replacement. |
| **Lateral coverage is 100% — fallback bucket label "Uncategorized: \<topic\>" never hits** | Informational | Keep the SQL fallback for safety; don't introduce dedicated UI for it. |
| **Deferral `sampleEvidence` aggregation cap of 5 may suppress diversity** in team mode | Low | Document the trade-off in a code comment. Rep-focus mode (200) is the high-fidelity path. |
