# Code Inspector Findings — Knowledge Gap Clusters Rewrite

Investigated: 2026-05-12  |  Agent: code-inspector (claude-sonnet-4-6)

---

## A. Current state of the query helper

**File:** src/lib/queries/call-intelligence/knowledge-gap-clusters.ts

### Function signature (lines 27-201)

    export async function getKnowledgeGapClusters(args: ClusterArgs): Promise<KnowledgeGapClusterRow[]>

ClusterArgs (lines 11-17): dateRange, role, podIds, repIds, sourceFilter, visibleRepIds.
The spec adds mode: team | rep_focus to ClusterArgs. There is NO mode arg today.

### Parameter positions (lines 51-65)

| Position | Value | Type |
|---|---|---|
| $1 | effectiveRepIds | uuid[] |
| $2 | start (date bound) | date |
| $3 | end (date bound) | date |
| $4 | roleParam (SGA/SGM/null) | text |
| $5 | podIdsParam (uuid[]/null) | uuid[] |
| $6 | includeGaps | bool |
| $7 | includeDeferrals | bool |
| $8 | coverageFilter (missing/covered/null) | text |
| $9 | synonymsJson — GOES AWAY in rewrite | jsonb |

The spec is correct: $2/$3 are date bounds, $6/$7 are gap/deferral flags, $8 is coverage filter, $9 synonyms JSONB is being removed.
### Gap CTE SELECT columns (lines 89-112)

Current: topics.topic, e.rep_id, r.full_name AS rep_name, e.id AS evaluation_id,
1 AS gap_count, 0 AS deferral_count, NULL::text AS kb_coverage.
Missing in rewrite: evidence_text, citations, expected_source_full, bucket_kind.

Matching mechanism: CROSS JOIN topics (vocab CTE) + EXISTS substring ILIKE against topics.synonyms.
This is the bottleneck dropping 66% of gaps.

### Deferral CTE SELECT columns (lines 113-138)

Current: topics.topic, d.rep_id, r.full_name AS rep_name, d.evaluation_id,
0 AS gap_count, 1 AS deferral_count, d.kb_coverage.
Missing: evidence_text (deferral_text), citations, raw_topic, bucket_kind.
Same CROSS JOIN topics + EXISTS ILIKE mechanism. Drops 84% of deferrals.

### Final SELECT aggregation (lines 144-161)

sample_eval_ids: (array_agg(DISTINCT evaluation_id ORDER BY evaluation_id))[1:5]
Hard-coded [1:5] at line 154. Spec wants [1:5] in team mode, [1:200] in rep-focus mode.
There is NO sample_evidence aggregation today. Must be added from scratch.

### JS post-processing (lines 179-200)

Result mapping is entirely in JS. RawRow type (lines 163-175) defines what postgres returns.
The .map() at line 179 constructs KnowledgeGapClusterRow[].
Numeric columns arrive as strings; coerced via Number(r.total_occurrences) etc.
The rewrite sampleEvidence will come back from postgres as a JSON array and should
be passed through in the mapping step with light coercion.

### KB_VOCAB_SYNONYMS wiring

- Import at line 2: import { KB_VOCAB_SYNONYMS } from ./kb-vocab-synonyms
- Bound as params[8] (0-indexed): becomes $9::jsonb in SQL
- Used at lines 71-76: $9::jsonb -> v.value for synonym lookup per vocab topic
- After rewrite: remove import and param binding. kb-vocab-synonyms.ts file stays.

---

## B. Current type definition

**File:** src/types/call-intelligence.ts, lines 301-309

    export interface KnowledgeGapClusterRow {
      topic: string;
      totalOccurrences: number;
      gapCount: number;
      deferralCount: number;
      deferralByCoverage: { covered: number; partial: number; missing: number };
      repBreakdown: Array<{ repId: string; repName: string; gapCount: number; deferralCount: number }>;
      sampleEvalIds: string[];
    }

Fields after rewrite per spec:
- topic renamed to bucket: string
- Add bucketKind: kb_path | kb_topic | uncategorized
- Add sampleEvidence array: evaluationId, repId, repName, kind, text, citations, expectedSource?, kbCoverage?
- All other existing fields retained

### Cascading rename impact

Two places in InsightsTab.tsx read .topic off a KnowledgeGapClusterRow:
- Line 631: key={c.topic}  ->  key={c.bucket}
- Line 634: humanizeKey(c.topic)  ->  humanizeBucket(c.bucket)  (new helper needed, see section E)
No other files reference .topic on a KnowledgeGapClusterRow.

### Partial scaffolding — modal stack types already present (lines 329-356)

- InsightsModalStackLayer (line 331): discriminated union list | detail | transcript
- EvalListModalPayload (line 336): role, rubricVersion, podId, dimension, dateRange, focusRep
- EvalDetailDrillPayload (line 345): evaluationId, dimension?, topic?
- TranscriptDrillPayload (line 350): evaluationId, initialUtteranceIndex

EvalListModalPayload has dimension: string | null but no bucket/bucketKind.
A new ClusterEvidenceModalPayload type will be needed for the cluster-card drill (section 6c).

### Other types referencing topic — no collision risk

RepDeferral (line 129) has topic: string — separate type, unrelated to cluster rename.
EvalDetailDrillPayload.topic at line 146 filters rep_deferrals — unrelated field, stays as-is.
---

## C. Construction sites for KnowledgeGapClusterRow

| File | Lines | Role | What it does |
|---|---|---|---|
| src/lib/queries/call-intelligence/knowledge-gap-clusters.ts | 179-199 | Producer | .map(r => ({ topic: r.topic, ... })) PRIMARY site |
| src/lib/queries/call-intelligence/__tests__/knowledge-gap-clusters.test.ts | 12-56 | Test | Does NOT construct a row. Asserts params array. Lines 45-56 assert params[8] is synonyms JSON. BREAKS after $9 removed. |
| src/app/api/call-intelligence/insights/clusters/route.ts | 101-110 | Consumer | Calls helper, passes to NextResponse.json({ clusters }). No field access. Transparent to rename at runtime. |
| src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx | 193, 631, 634 | Consumer + renderer | State type + two render reads of .topic. Both must switch to .bucket. |

Files reading .topic that must switch to .bucket:
- InsightsTab.tsx line 631: key={c.topic}  ->  key={c.bucket}
- InsightsTab.tsx line 634: humanizeKey(c.topic)  ->  humanizeBucket(c.bucket)

Export/CSV: no ExportMenu or MetricDrillDownModal references to KnowledgeGapClusterRow found.
Cluster data is not CSV-exported. No export surface changes needed.

---

## D. Section 5 Modal Infrastructure Status

### What IS shipped

MODAL STACK in InsightsTab.tsx (lines 207-258): FULLY SHIPPED.
- useState<InsightsModalStackLayer[]>([]) at line 208
- openListModal, openDetailModal, openTranscriptLayer, popTopLayer, closeAll callbacks at lines 215-245
- Unified Esc handler (lines 248-258), browser hash sync (lines 261-280), popstate (lines 282-290)
- Heat-map cell click trigger at line 517

LAYER 1 — InsightsEvalListModal: SHIPPED.
File: src/components/call-intelligence/InsightsEvalListModal.tsx
Fetches /api/call-intelligence/insights/evals. Whole-row click targets. onRowClick(evaluationId).
Props: isOpen, payload: EvalListModalPayload|null, onClose, onRowClick, ariaHidden.
Gap for section 6c: payload has dimension field but no bucket/bucketKind. A cluster-evidence variant needed.

LAYER 2 — InsightsEvalDetailModal: SHIPPED.
File: src/components/call-intelligence/InsightsEvalDetailModal.tsx
Props: isOpen, payload: EvalDetailDrillPayload|null, detail: EvaluationDetail|null,
loading, error, onClose, onOpenTranscript, onOpenKB?, ariaHidden.
Dimension drill: lines 135-266 (dimension_scores body + citations).
Topic (deferral) drill: lines 269-300 — ALREADY SCAFFOLDED, comment says reserved for cluster ship.
  Filters rep_deferrals by d.topic === payload.topic. Works for deferral clusters.
  Does NOT work for gap clusters — see Surprising Finding 1.
Guard at line 124: returns null if neither payload.dimension nor payload.topic is set.

LAYER 2 data source: InsightsTab.tsx line 232 fetches /api/call-intelligence/evaluations/
The proposed slim /insights/eval-detail route was NEVER CREATED.
The full-eval route returns everything needed and is the current working solution.

LAYER 3 — TranscriptModal: SHIPPED.
File: src/components/call-intelligence/TranscriptModal.tsx
Props: isOpen, onClose, transcript, evaluationId, comments, currentUserId, isAdmin,
canComposeComments, repFullName, advisorName?, onCommentChanged,
initialUtteranceIndex?: number|null (line 28), disableOwnEscHandler?, zClassName?

IMPORTANT: The prop is initialUtteranceIndex (integer), NOT initialUtteranceId (UUID).
Spec section 5 narrative says initialUtteranceId — this is a SPEC LANGUAGE ERROR.
All callers in InsightsTab already use the correct name.

CitationPill: SHIPPED. src/components/call-intelligence/CitationPill.tsx
Props: citation: Citation, chunkLookup, onScrollToUtterance?, onOpenKB?, utteranceTextForTooltip?, disabled?

Modal stack types: SHIPPED in call-intelligence.ts lines 329-356.
/api/call-intelligence/insights/eval-detail/route.ts: NOT CREATED (full-eval route used instead).
/dashboard/call-intelligence/insights/evals/ page: DELETED (Glob finds no files).
/api/call-intelligence/insights/evals/route.ts: ALIVE — serving InsightsEvalListModal.

### Section 5 GO / NO-GO for section 6c

GO for Part 3. Modal stack fully operational for heat-map cell drill-downs.

What section 6c must add:
1. New ClusterEvidenceModalPayload type and cluster-evidence modal component.
2. Cluster card click handler in InsightsTab pushing a cluster layer onto the stack.
3. New gap-evidence render section in InsightsEvalDetailModal (topic-drill covers only
   rep_deferrals, not knowledge_gaps — see Surprising Finding 1).
---

## E. Cluster card render in InsightsTab.tsx

Cluster list section: lines 619-668.

### Current rendering

Cluster cards are <div> elements with NO onClick — not clickable today.
Only repBreakdown chip buttons are interactive (setFocusRep(rep.repId)).
The card shows: humanizeKey(c.topic) as label, c.totalOccurrences as count,
gap/deferral badge counts with coverage sub-chips, rep breakdown chips (team mode only).

### focus_rep URL param

focusRep = searchParams.get(focus_rep) at line 188. isFocusMode = !!focusRep.
In focus mode: rep breakdown buttons hidden by !isFocusMode guard at line 654.
Cluster data scoped to one rep via API (route passes [focusRep] as repIds).

### humanizeKey limitation for KB paths

humanizeKey (InsightsTab.tsx line 54) only splits on underscore.
Bucket profile/ideal-candidate-profile renders as Profile/ideal-candidate-profile.
New humanizeBucket() helper needed: replace / with >, replace _ with space, title-case words.

### Longtail Other (N one-offs) collapse slot

No longtail collapse exists today. Natural insert: after clusters.map() loop (after line 666).
Split clusters in useMemo: main (totalOccurrences > 1 OR bucketKind !== uncategorized)
vs longtail (totalOccurrences === 1 AND bucketKind === uncategorized).
Longtail renders as <details> expander at bottom. Each row still has working drill-down.

### Cluster card click handler slot

Convert <div key={c.topic} at line 631 to a <button> and add:
  onClick={(e) => openClusterModal({ bucket: c.bucket, bucketKind: c.bucketKind, sampleEvidence: c.sampleEvidence }, e.currentTarget)}

A new openClusterModal helper (parallel to openListModal) needed in InsightsTab.

---

## F. API route — clusters

**File:** src/app/api/call-intelligence/insights/clusters/route.ts

### Auth gate (lines 50-62)

1. allowedPages.includes(20) — page-level gate
2. [manager, admin, revops_admin].includes(permissions.role) — role gate
3. getRepIdByEmail for non-privileged users; 403 if not found
4. focusRep validated against visibleRepIds (lines 93-95)
Same auth shape as /insights/evals/route.ts and /insights/heatmap/route.ts.

### Existing query params

range, start/end (custom), role, source, pods, reps, focus_rep. No limit or mode param today.

### Where limit=full / mode=rep_focus slots in

Detect focusRep and pass mode: rep_focus to getKnowledgeGapClusters — a one-liner change.
Optionally also read ?limit=full as an explicit opt-in.

### topic->bucket rename impact on the route

Route line 110: NextResponse.json({ clusters }) — raw pass-through, no field mapping.
JSON response key changes automatically. No intermediate layer hides the rename.
Client receives bucket instead of topic once type and render are updated together.

---

## G. KB_VOCAB_SYNONYMS consumers

**File:** src/lib/queries/call-intelligence/kb-vocab-synonyms.ts

Grep confirmed exactly 2 files import from kb-vocab-synonyms.ts:

| File | Import | Load-bearing? |
|---|---|---|
| src/lib/queries/call-intelligence/knowledge-gap-clusters.ts | KB_VOCAB_SYNONYMS | YES — remove in rewrite |
| (self) | getSynonymsForTopic export | Not imported elsewhere |

Only one external consumer. After removing the import from knowledge-gap-clusters.ts,
kb-vocab-synonyms.ts becomes a dead export but breaks nothing. Safe to keep as theming data.

---

## H. Standing instructions

### Comment for single-bucket-per-deferral trade-off

Place in the deferral_hits CTE, directly above the LATERAL JOIN clause:

    -- Single-bucket-per-deferral: ORDER BY chunk_index LIMIT 1 gives deterministic
    -- bucket assignment. Alternative is fan-out (one deferral counted in N buckets
    -- across topics[]), which inflates total_occurrences and breaks the SUM=ceiling
    -- acceptance criterion in section 6d(a). Revisit if managers report missing
    -- cross-topic visibility.
    LEFT JOIN LATERAL (
      SELECT topics FROM knowledge_base_chunks
       WHERE id = ANY(d.kb_chunk_ids)
         AND is_active = true
         AND topics IS NOT NULL
         AND array_length(topics, 1) > 0
       ORDER BY chunk_index
       LIMIT 1
    ) kbc ON true

### Postgres vs BigQuery parameterization

CONFIRMED: This query hits the Neon Postgres coaching DB via getCoachingPool().
The @paramName convention in CLAUDE.md is BigQuery-specific and does NOT apply here.
All coaching DB helpers use $N positional parameters (verified in knowledge-gap-clusters.ts
and insights-evals-list.ts). Spec SQL sketches correctly use $2::date, $6::bool, etc.

### Coaching DB schema traps — confirmed

- knowledge_base_chunks PK is id (not chunk_id): confirmed — spec LATERAL uses WHERE id = ANY(d.kb_chunk_ids).
- evaluations.knowledge_gaps is JSONB: confirmed — jsonb_array_elements(e.knowledge_gaps) at line 102.
- rep_deferrals.kb_chunk_ids: referenced in spec new deferral CTE but NOT read in the current query.
  VERIFY the column exists and its type (uuid[]) before writing the LATERAL join.
  A live probe against the coaching DB is recommended before merge.
---

## Construction Site Inventory

| File | Lines | What touches KnowledgeGapClusterRow | Change needed |
|---|---|---|---|
| src/lib/queries/call-intelligence/knowledge-gap-clusters.ts | 179-199 | Primary constructor | Rename topic->bucket. Add bucketKind, sampleEvidence. Remove $9. Add mode arg. Rewrite both CTEs. Update RawRow type. |
| src/types/call-intelligence.ts | 301-309 | Interface definition | Rename topic->bucket. Add bucketKind, sampleEvidence fields. |
| src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx | 193, 631, 634 | State type + two render reads of .topic | c.topic->c.bucket at lines 631/634. Add cluster card click handler. Add longtail collapse. Add humanizeBucket() helper. |
| src/app/api/call-intelligence/insights/clusters/route.ts | 101-110 | Calls helper, passes through | Pass mode: focusRep ? rep_focus : team. Optionally parse ?limit=full. No field-rename changes. |
| src/lib/queries/call-intelligence/__tests__/knowledge-gap-clusters.test.ts | 45-56 | Tests $9 synonyms param | Delete synonyms test. Update param-index assertions for new param count. |

---

## Section 5 Modal Infrastructure Status — Explicit GO/NO-GO

SHIPPED. GO for Part 3 (cluster modal chain).

| Component | Status |
|---|---|
| Modal stack helper (useState) in InsightsTab | SHIPPED — lines 207-258 |
| Layer 1 InsightsEvalListModal | SHIPPED — src/components/call-intelligence/InsightsEvalListModal.tsx |
| Layer 2 InsightsEvalDetailModal | SHIPPED — src/components/call-intelligence/InsightsEvalDetailModal.tsx |
| Layer 3 TranscriptModal | SHIPPED — src/components/call-intelligence/TranscriptModal.tsx |
| CitationPill | SHIPPED — src/components/call-intelligence/CitationPill.tsx |
| /api/call-intelligence/insights/evals/route.ts | SHIPPED (list data source for Layer 1) |
| /api/call-intelligence/insights/eval-detail/route.ts | NOT CREATED — full-eval route used instead |
| /dashboard/call-intelligence/insights/evals/ page | DELETED |
| Modal stack types in call-intelligence.ts | SHIPPED — lines 329-356 |

---

## Surprising Findings (not anticipated by spec)

### 1. InsightsEvalDetailModal topic-drill section is deferral-only — gaps have no render path

InsightsEvalDetailModal.tsx line 146:
  topicDeferrals = detail.rep_deferrals.filter(d => d.topic === payload.topic)

For a knowledge-gap cluster drill, rep_deferrals will have no matches because knowledge gaps
live in evaluations.knowledge_gaps (JSONB), not in rep_deferrals.
The modal shows No deferrals captured for this topic — empty.
Gap evidence requires a separate render section reading detail.knowledge_gaps filtered by
expected_source or gap text. This section does NOT exist today.
Must be added to InsightsEvalDetailModal as part of section 6c.
This is a missing implementation requirement not explicitly called out in the spec.

### 2. Test file hard-asserts the $9 synonyms param

knowledge-gap-clusters.test.ts lines 45-56 asserts params[8] is synonyms JSON and validates
parsed.annuity. After the rewrite removes $9, this test fails at assertion.
Must be deleted and replaced with tests for the new CTE behavior.

### 3. humanizeKey cannot handle KB path separators

Existing humanizeKey (InsightsTab.tsx line 54) only splits on underscore.
Bucket profile/ideal-candidate-profile renders as Profile/ideal-candidate-profile.
New humanizeBucket() helper needed for cluster card labels.

### 4. InsightsEvalDetailModal will show empty content for gap cluster drills

The guard at line 124 passes when payload.topic is set. But the topic-drill section (lines 269-300)
filters rep_deferrals which will be empty for gap evidence.
A new knowledge-gap render section reading detail.knowledge_gaps is required.

### 5. No useModalStack abstraction — inline useState in InsightsTab

Spec suggested useModalStack as a possible extraction. Actual implementation uses inline
useState<InsightsModalStackLayer[]> in InsightsTab. No reusable hook exists to import.
The cluster-evidence modal shares the same stack in InsightsTab.

### 6. TranscriptModal prop is initialUtteranceIndex (integer) not initialUtteranceId (UUID)

Spec section 5 narrative says initialUtteranceId. Actual prop at TranscriptModal.tsx line 28 is
initialUtteranceIndex: number | null. All callers in InsightsTab already use the correct name.
Spec language error only. Implementation guide should use initialUtteranceIndex.

### 7. rep_deferrals.kb_chunk_ids is not currently read anywhere in the cluster query

The new deferral CTE joins knowledge_base_chunks via d.kb_chunk_ids. The current query
never reads this column. Before writing the LATERAL join, verify:
(a) column exists on rep_deferrals, (b) type is uuid[], (c) populated on recent rows.
A live probe against the coaching DB is recommended before merge.

### 8. Cluster cards use c.topic as React key — must change to c.bucket

InsightsTab.tsx line 631: key={c.topic}. After rename must become key={c.bucket}.
KB path values with slashes are valid React keys; unique since bucket is the SQL GROUP BY key.