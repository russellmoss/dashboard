# Agentic Implementation Guide — Knowledge Gap Clusters Rewrite (§6)

> **Read first:** `insights-refinements.md` §6 (the spec), then `exploration-results.md` (the synthesis), then `code-inspector-findings.md` / `data-verifier-findings.md` / `pattern-finder-findings.md` for the deep dives. All five files are in the project root.

> **§5 prerequisite is shipped.** GO for Part 3.

---

## Pre-Flight

**Goal:** establish a clean baseline.

1. Confirm working tree is clean except for the five exploration `.md` files and this guide:
   ```bash
   git status --short
   ```
2. `npm run build` baseline — must pass before touching any code:
   ```bash
   npm run build
   ```
3. Probe for an `evaluations`-level synthetic flag (council S5 — symmetry with the deferral filter):
   ```bash
   node -e "require('dotenv').config(); const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.SALES_COACHING_DATABASE_URL}); p.query(\`SELECT column_name FROM information_schema.columns WHERE table_name='evaluations' AND (column_name ILIKE '%synthetic%' OR column_name ILIKE '%test%' OR column_name ILIKE '%seed%')\`).then(r=>{console.log('EVAL_SYNTHETIC_FLAGS',r.rows);p.end();})"
   ```
   If a column comes back, ADD it as a filter to BOTH the gap_ceiling probe in step 4 AND the helper's `gap_hits` CTE in Phase 2E (mirroring the deferral side). If no column comes back, both gap and deferral sides are symmetric (deferrals filter via `is_synthetic_test_data`, gaps have no equivalent), and the ceiling probe is valid as-is.

4. Capture pre-change baseline numbers (will be compared in Phase 8 acceptance criterion (a)):
   ```bash
   node -e "require('dotenv').config(); const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.SALES_COACHING_DATABASE_URL}); p.query(\`SELECT (SELECT SUM(jsonb_array_length(e.knowledge_gaps)) FROM evaluations e JOIN call_notes cn ON cn.id=e.call_note_id WHERE (cn.source='kixie' OR cn.likely_call_type='advisor_call') AND e.created_at >= NOW() - INTERVAL '90 days') AS gap_ceiling, (SELECT COUNT(*) FROM rep_deferrals d JOIN evaluations e ON e.id=d.evaluation_id JOIN call_notes cn ON cn.id=e.call_note_id WHERE d.is_synthetic_test_data=false AND (cn.source='kixie' OR cn.likely_call_type='advisor_call') AND d.created_at >= NOW() - INTERVAL '90 days') AS def_ceiling\`).then(r=>{console.log('CEILINGS',r.rows[0]);p.end();}).catch(e=>{console.error(e);process.exit(1);});"
   ```
   Expected as of 2026-05-12: `gap_ceiling=450, def_ceiling=169`. Record what the probe returns.

5. **Cross-functional impact check** (council C7 — already closed in Phase 3, included here for traceability): confirm the Slack analyst bot and MCP server don't depend on the old bucketing. Should return nothing:
   ```bash
   grep -rE "knowledge_gaps|rep_deferrals|knowledge_base_chunks|kb_vocab_topics|KB_VOCAB_SYNONYMS" packages/analyst-bot mcp-server 2>/dev/null
   ```
   If this returns matches, STOP and re-evaluate scope. (At triage time this returned zero matches.)

**Validation gate:** `npm run build` exits 0. Baseline ceiling numbers recorded. Step-3 probe result recorded. Step-5 grep returned no matches.

**STOP AND REPORT.** Numbers + build status before proceeding to Phase 1.

---

## Phase 1 — Types (intentional build break)

**Goal:** reshape `KnowledgeGapClusterRow` and extend the modal stack union. Build WILL break — the TypeScript errors are the checklist of remaining work.

**File:** `src/types/call-intelligence.ts`

Two edits in this file.

### 1A. Add `KnowledgeGapClusterEvidence` and reshape `KnowledgeGapClusterRow`

Replace the current block at lines 301–309 with:

```ts
export interface KnowledgeGapClusterEvidence {
  evaluationId: string;
  repId: string;
  repName: string;
  /** 'gap' = item from evaluations.knowledge_gaps[]; 'deferral' = row from rep_deferrals. */
  kind: 'gap' | 'deferral';
  /** Gap text OR verbatim deferral quote. */
  text: string;
  callStartedAt: string | null;
  citations: Array<{
    utterance_index?: number;
    kb_source?: { doc_id: string; chunk_id: string; doc_title: string; drive_url: string };
  }>;
  /** Full expected_source path — gap only (undefined for deferrals). */
  expectedSource?: string;
  /** Coverage classification — deferral only (undefined for gaps). */
  kbCoverage?: 'covered' | 'partial' | 'missing';
}

export interface KnowledgeGapClusterRow {
  bucket: string;
  bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized';
  totalOccurrences: number;
  gapCount: number;
  deferralCount: number;
  deferralByCoverage: { covered: number; partial: number; missing: number };
  repBreakdown: Array<{ repId: string; repName: string; gapCount: number; deferralCount: number }>;
  sampleEvalIds: string[];
  sampleEvidence: KnowledgeGapClusterEvidence[];
}
```

### 1B. Extend `InsightsModalStackLayer` (lines 329–354)

```ts
export type InsightsModalStackLayer =
  | { kind: 'list';       payload: EvalListModalPayload }
  | { kind: 'detail';     payload: EvalDetailDrillPayload }
  | { kind: 'transcript'; payload: TranscriptDrillPayload }
  | { kind: 'cluster';    payload: ClusterEvidenceModalPayload };

export interface ClusterEvidenceModalPayload {
  bucket: string;
  bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized';
  evidence: KnowledgeGapClusterEvidence[];
  gapCount: number;
  deferralCount: number;
}
```

Also extend `EvalDetailDrillPayload` so a Layer-2 opened from a cluster row carries the bucket context:

```ts
export interface EvalDetailDrillPayload {
  evaluationId: string;
  dimension?: string;
  topic?: string;
  bucket?: string;
  bucketKind?: 'kb_path' | 'kb_topic' | 'uncategorized';
}
```

**Validation gate (intentional break):**
```bash
npm run build 2>&1 | grep -E "(error TS|Property 'topic'|Property 'bucket'|sampleEvidence)" | head -30
```
Expected errors:
- `InsightsTab.tsx:631` — `Property 'topic' does not exist on type 'KnowledgeGapClusterRow'`
- `InsightsTab.tsx:634` — same
- `knowledge-gap-clusters.ts:188` — `Property 'topic' does not exist on type 'KnowledgeGapClusterRow'` (the `.map()` constructor doesn't emit `bucket`/`bucketKind`/`sampleEvidence`)

Save the error list as the construction-site checklist for the following phases.

**STOP AND REPORT.** List of TS errors + count.

---

## Phase 2 — Query rewrite

**Goal:** rewrite `getKnowledgeGapClusters` to produce the new bucket logic, drop the synonyms map, surface richer evidence rows, and accept a `mode` arg.

**File:** `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts`

### 2A. Imports

Remove the `KB_VOCAB_SYNONYMS` import on line 2:
```ts
// DELETE:
import { KB_VOCAB_SYNONYMS } from './kb-vocab-synonyms';
```

### 2B. Args type

Extend `ClusterArgs` (lines 10–17) with `mode`:
```ts
interface ClusterArgs {
  dateRange: InsightsDateRange;
  role: InsightsRoleFilter;
  podIds: string[];
  repIds: string[];
  sourceFilter: InsightsSourceFilter;
  visibleRepIds: string[];
  /** 'team' caps sampleEvalIds / sampleEvidence at 5 each; 'rep_focus' lifts to 200. */
  mode?: 'team' | 'rep_focus';
}
```
Default to `'team'` in the destructure on line 28:
```ts
const { dateRange, role, podIds, repIds, sourceFilter, visibleRepIds, mode = 'team' } = args;
```

### 2C. Slice cap literal

Add right above the SQL string construction:
```ts
const sliceCap = mode === 'rep_focus' ? 200 : 5;
```
Postgres does not accept bound params for array slice bounds, so the literal must be interpolated into the SQL string. The value is constrained to `5 | 200` — no injection surface.

### 2D. Param block

Remove the `$9` synonyms param. Update the comment block and `params` array (lines 51–65):

```ts
// params (ALL parameterized — no SQL injection surface):
//  $1 = effectiveRepIds (uuid[])
//  $2 = start (date), $3 = end (date)
//  $4 = role ('SGA'|'SGM'|null)
//  $5 = podIds (uuid[]|null)
//  $6 = includeGaps (bool)
//  $7 = includeDeferrals (bool)
//  $8 = coverageFilter ('missing'|'covered'|null)
const params: unknown[] = [
  effectiveRepIds, start, end, roleParam, podIdsParam,
  includeGaps, includeDeferrals, coverageFilter,
];
```

### 2E. SQL rewrite

Replace the entire `sql` template (lines 67–161) with:

```ts
const sql = `
  WITH scoped_reps AS (
    SELECT DISTINCT r.id
      FROM reps r
      LEFT JOIN coaching_team_members tm ON tm.rep_id = r.id
      LEFT JOIN coaching_teams t          ON t.id = tm.team_id AND t.is_active = true
     WHERE r.is_active = true
       AND r.is_system = false
       AND r.id = ANY($1::uuid[])
       AND ($4::text IS NULL OR r.role = $4)
       AND ($5::uuid[] IS NULL OR t.id = ANY($5::uuid[]) OR t.id IS NULL)
  ),
  gap_hits AS (
    SELECT
      -- Council C3 fix: COALESCE/NULLIF on `split_part||/||split_part` mislabels
      -- single-segment values (e.g., 'profile' becomes 'profile/' not 'Uncategorized').
      -- Use CASE to explicitly require at least two slash-segments.
      CASE
        WHEN kg.item->>'expected_source' IS NULL
          OR kg.item->>'expected_source' = ''
          OR position('/' IN kg.item->>'expected_source') = 0
          THEN 'Uncategorized'
        ELSE
          split_part(kg.item->>'expected_source','/',1) || '/' ||
          split_part(kg.item->>'expected_source','/',2)
      END AS bucket,
      CASE
        WHEN kg.item->>'expected_source' IS NULL
          OR kg.item->>'expected_source' = ''
          OR position('/' IN kg.item->>'expected_source') = 0
          THEN 'uncategorized'
        ELSE 'kb_path'
      END AS bucket_kind,
      e.rep_id,
      r.full_name AS rep_name,
      e.id AS evaluation_id,
      cn.call_started_at AS call_started_at,
      kg.item->>'text'             AS evidence_text,
      kg.item->'citations'         AS citations,
      kg.item->>'expected_source'  AS expected_source_full,
      'gap'::text AS kind,
      1 AS gap_count,
      0 AS deferral_count,
      NULL::text AS kb_coverage
    FROM evaluations e
    JOIN scoped_reps sr ON sr.id = e.rep_id
    JOIN reps r ON r.id = e.rep_id
    JOIN call_notes cn ON cn.id = e.call_note_id
    CROSS JOIN jsonb_array_elements(e.knowledge_gaps) AS kg(item)
    WHERE $6::bool = true
      AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
      AND e.created_at >= $2::date
      AND e.created_at <  $3::date
  ),
  deferral_hits AS (
    -- TRADE-OFF: single-bucket-per-deferral assignment via ORDER BY chunk_index LIMIT 1.
    -- Deterministic; no count inflation. Alternative would be to fan out across
    -- topics (one deferral counted N times), which would inflate totals and break
    -- acceptance criterion (a). Revisit if managers report missing cross-topic visibility.
    SELECT
      COALESCE(
        (SELECT t FROM unnest(kbc.topics) AS t LIMIT 1),
        'Uncategorized: ' || d.topic
      ) AS bucket,
      CASE
        WHEN kbc.topics IS NULL OR array_length(kbc.topics, 1) IS NULL
          THEN 'uncategorized'
        ELSE 'kb_topic'
      END AS bucket_kind,
      d.rep_id,
      r.full_name AS rep_name,
      d.evaluation_id,
      cn.call_started_at AS call_started_at,
      d.deferral_text AS evidence_text,
      jsonb_build_array(
        jsonb_build_object('utterance_index', d.utterance_index)
      ) AS citations,
      NULL::text AS expected_source_full,
      'deferral'::text AS kind,
      0 AS gap_count,
      1 AS deferral_count,
      d.kb_coverage
    FROM rep_deferrals d
    JOIN scoped_reps sr ON sr.id = d.rep_id
    JOIN reps r ON r.id = d.rep_id
    JOIN evaluations e ON e.id = d.evaluation_id
    JOIN call_notes cn ON cn.id = e.call_note_id
    LEFT JOIN LATERAL (
      SELECT topics FROM knowledge_base_chunks
       WHERE id = ANY(d.kb_chunk_ids)
         AND is_active = true
         AND topics IS NOT NULL
         AND array_length(topics, 1) > 0
       -- Council C4 fix: chunk_index can have ties. Add `id` as tie-breaker
       -- so the bucket is deterministic across runs.
       ORDER BY chunk_index, id
       LIMIT 1
    ) kbc ON TRUE
    WHERE $7::bool = true
      AND d.is_synthetic_test_data = false
      AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
      AND d.created_at >= $2::date
      AND d.created_at <  $3::date
      AND ($8::text IS NULL OR d.kb_coverage = $8)
  ),
  all_hits AS (
    SELECT * FROM gap_hits
    UNION ALL
    SELECT * FROM deferral_hits
  ),
  -- Council C5 rewrite: window-function ranking inside the row set, then a single
  -- FILTER-gated jsonb_agg per group at the final SELECT. Replaces a per-bucket
  -- correlated subquery (20+ subqueries → 1 sort + 1 aggregation pass).
  ranked AS (
    SELECT
      ah.*,
      ROW_NUMBER() OVER (
        PARTITION BY bucket
        -- Stable, deterministic ordering for the evidence sample:
        -- newest evidence first when call_started_at is available, then by evaluation_id.
        ORDER BY call_started_at DESC NULLS LAST, evaluation_id, kind
      ) AS rn
    FROM all_hits ah
  )
  SELECT
    bucket,
    -- bucket_kind reduction: prefer the most informative kind within a bucket.
    -- 'kb_path' (gap-derived) wins over 'kb_topic' (deferral-derived) wins over 'uncategorized'.
    (array_agg(bucket_kind ORDER BY
      CASE bucket_kind
        WHEN 'kb_path' THEN 1
        WHEN 'kb_topic' THEN 2
        ELSE 3
      END
    ))[1] AS bucket_kind,
    SUM(gap_count + deferral_count) AS total_occurrences,
    SUM(gap_count) AS gap_count,
    SUM(deferral_count) AS deferral_count,
    COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'covered'), 0) AS deferral_covered,
    COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'partial'), 0) AS deferral_partial,
    COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'missing'), 0) AS deferral_missing,
    json_agg(DISTINCT jsonb_build_object('repId', rep_id, 'repName', rep_name)
             ORDER BY jsonb_build_object('repId', rep_id, 'repName', rep_name)) AS reps_arr,
    (array_agg(DISTINCT evaluation_id ORDER BY evaluation_id) FILTER (WHERE rn <= ${sliceCap})) AS sample_eval_ids,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'evaluationId',   evaluation_id,
          'repId',          rep_id,
          'repName',        rep_name,
          'kind',           kind,
          'text',           evidence_text,
          'callStartedAt',  call_started_at,
          'citations',      citations,
          'expectedSource', expected_source_full,
          'kbCoverage',     kb_coverage
        ) ORDER BY rn
      ) FILTER (WHERE rn <= ${sliceCap}),
      '[]'::jsonb
    ) AS sample_evidence,
    json_object_agg(rep_id || '|gap', gap_count ORDER BY rep_id || '|gap') FILTER (WHERE gap_count > 0) AS rep_gap_map,
    json_object_agg(rep_id || '|def', deferral_count ORDER BY rep_id || '|def') FILTER (WHERE deferral_count > 0) AS rep_def_map
  FROM ranked
  GROUP BY bucket
  HAVING SUM(gap_count + deferral_count) > 0
  ORDER BY total_occurrences DESC, bucket ASC
`;
```

> **Note on the evidence aggregation idiom:** `ROW_NUMBER()` ranks rows within each bucket, then a single `FILTER (WHERE rn <= ${sliceCap})` gate inside `jsonb_agg` produces the capped sample. One pass through the data; the planner can usually do this with a single sort. The slice cap literal (`5` or `200`) is the only string-interpolated value and is constrained at the TS layer to those two integers (no injection surface).

### 2F. RawRow type + `.map()` constructor (lines 163–200)

Replace with:

```ts
type RawRow = {
  bucket: string;
  bucket_kind: 'kb_path' | 'kb_topic' | 'uncategorized';
  total_occurrences: string;
  gap_count: string;
  deferral_count: string;
  deferral_covered: string;
  deferral_partial: string;
  deferral_missing: string;
  reps_arr: Array<{ repId: string; repName: string | null }> | null;
  sample_eval_ids: string[] | null;
  sample_evidence: Array<{
    evaluationId: string;
    repId: string;
    repName: string | null;
    kind: 'gap' | 'deferral';
    text: string | null;
    callStartedAt: string | null;
    citations: Array<{
      utterance_index?: number | null;
      kb_source?: { doc_id?: string; chunk_id?: string; doc_title?: string; drive_url?: string };
    }> | null;
    expectedSource: string | null;
    kbCoverage: 'covered' | 'partial' | 'missing' | null;
  }> | null;
  rep_gap_map: Record<string, number> | null;
  rep_def_map: Record<string, number> | null;
};

const { rows } = await pool.query<RawRow>(sql, params);

return rows.map(r => {
  const reps = r.reps_arr ?? [];
  const breakdown = reps.map(rep => ({
    repId: rep.repId,
    repName: rep.repName ?? '(unknown)',
    gapCount: Number(r.rep_gap_map?.[`${rep.repId}|gap`] ?? 0),
    deferralCount: Number(r.rep_def_map?.[`${rep.repId}|def`] ?? 0),
  }));
  const sampleEvidence = (r.sample_evidence ?? []).map(e => {
    const cit = Array.isArray(e.citations) ? e.citations : [];
    return {
      evaluationId: e.evaluationId,
      repId: e.repId,
      repName: e.repName ?? '(unknown)',
      kind: e.kind,
      text: e.text ?? '',
      callStartedAt: e.callStartedAt,
      citations: cit
        .map(c => {
          const hasUtterance = typeof c.utterance_index === 'number';
          const hasKbSource = !!(c.kb_source && c.kb_source.chunk_id && c.kb_source.doc_id);
          if (!hasUtterance && !hasKbSource) return null;
          return {
            ...(hasUtterance ? { utterance_index: c.utterance_index as number } : {}),
            ...(hasKbSource
              ? {
                  kb_source: {
                    doc_id: c.kb_source!.doc_id!,
                    chunk_id: c.kb_source!.chunk_id!,
                    doc_title: c.kb_source!.doc_title ?? '',
                    drive_url: c.kb_source!.drive_url ?? '',
                  },
                }
              : {}),
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null),
      // Council S1 fix: dropping the citation entirely when neither side is valid
      // prevents empty {} objects from leaking into the array.
      ...(e.expectedSource ? { expectedSource: e.expectedSource } : {}),
      ...(e.kbCoverage ? { kbCoverage: e.kbCoverage } : {}),
    };
  });
  return {
    bucket: r.bucket,
    bucketKind: r.bucket_kind,
    totalOccurrences: Number(r.total_occurrences),
    gapCount: Number(r.gap_count),
    deferralCount: Number(r.deferral_count),
    deferralByCoverage: {
      covered: Number(r.deferral_covered),
      partial: Number(r.deferral_partial),
      missing: Number(r.deferral_missing),
    },
    repBreakdown: breakdown,
    sampleEvalIds: r.sample_eval_ids ?? [],
    sampleEvidence,
  };
});
```

### 2G. Probe-validate the SQL before moving on

Run the new query end-to-end against Neon, verifying acceptance criterion (a) — total occurrences match the ceiling.

Write a temp probe script (do NOT commit):
```bash
mkdir -p scripts/_tmp
cat > scripts/_tmp/probe-cluster-rewrite.js <<'EOF'
// One-off probe — delete after running.
require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.SALES_COACHING_DATABASE_URL });
(async () => {
  // Pull a visible-rep set for the smoke test:
  const { rows: reps } = await p.query("SELECT id FROM reps WHERE is_active=true AND is_system=false LIMIT 100");
  const allRepIds = reps.map(r => r.id);
  // Paste your rewritten SQL string here, or import the helper:
  // For the simplest check, just sum totals:
  const sql = require('fs').readFileSync('scripts/_tmp/cluster.sql', 'utf8');
  const { rows } = await p.query(sql, [
    allRepIds,
    '2026-02-11', '2026-05-12',
    null, null, true, true, null,
  ]);
  const total = rows.reduce((s, r) => s + Number(r.total_occurrences), 0);
  console.log({ totalRows: rows.length, totalOccurrences: total });
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
EOF
# Paste the SQL from §2E into scripts/_tmp/cluster.sql then:
node scripts/_tmp/probe-cluster-rewrite.js
rm -rf scripts/_tmp
```

**Validation gate:**
```bash
npm run build 2>&1 | grep -E "error TS"
```
The build errors should now be limited to the UI side (`InsightsTab.tsx`) — the helper's signature and constructor should typecheck.

Live SQL check: `SUM(total_occurrences)` should equal `gap_ceiling + def_ceiling` from Pre-Flight when `$6=true`, `$7=true`, `$8=NULL`.

**STOP AND REPORT.** TS errors remaining + sum-vs-ceiling result.

---

## Phase 3 — API route

**Goal:** pass `mode` through to the helper, accept `?limit=full` validator.

**File:** `src/app/api/call-intelligence/insights/clusters/route.ts`

Insert near the existing query-param parsing (around line 87, after the `focusRep` validation), then pass to the helper (line 101).

```ts
const limitRaw = sp.get('limit');
if (limitRaw && limitRaw !== 'full') {
  return NextResponse.json({ error: 'invalid limit' }, { status: 400 });
}
const mode: 'team' | 'rep_focus' = (focusRep || limitRaw === 'full') ? 'rep_focus' : 'team';
```

Then in the helper call at line 101:
```ts
const clusters = await getKnowledgeGapClusters({
  dateRange,
  role,
  podIds,
  repIds: effectiveRepIds,
  sourceFilter: sourceRaw,
  visibleRepIds,
  mode,
});
```

**Validation gate:**
```bash
npm run build 2>&1 | grep -E "error TS.*clusters/route\.ts"
```
Empty.

**STOP AND REPORT.** Build status for the route file.

---

## Phase 4 — Eval-detail modal: add gap-evidence render path

**Goal:** `InsightsEvalDetailModal.tsx` currently has a deferral-only topic-drill section. When the user clicks a gap-evidence row in the new cluster modal, the existing section returns empty. Add a parallel gap render.

**File:** `src/components/call-intelligence/InsightsEvalDetailModal.tsx`

Read lines 1–300 to understand current structure first. The existing topic-drill section is around lines 269–300 (per exploration).

### 4A. Widen the modal's render guard (council C1 — REQUIRED)

The modal currently early-returns around line 124 with:
```ts
if (!payload.dimension && !payload.topic) return null;
```
This will hide the modal entirely when entering from a cluster row (where only `payload.bucket` is set). Update the guard to:
```ts
if (!payload.dimension && !payload.topic && !payload.bucket) return null;
```
Then route the three drill modes through the existing if/else (dimension → existing dimension-drill section; topic → existing deferral-only topic section; bucket → the new gap+deferral section below).

### Decision: filter-on-client (recommended) vs filter-on-server

- **Filter-on-client (recommended):** the modal already fetches the full eval via `/api/call-intelligence/evaluations/[id]`. When `payload.bucket` is set, render ALL `knowledge_gaps[]` and ALL `rep_deferrals` on the eval, but highlight the matched ones with a lighter background and a "ⓘ matched bucket" chip. User sees the wider context (other gaps/deferrals on the same call), which is often useful.
- **Filter-on-server:** Add `?bucket=` and `?bucketKind=` query params to `/api/call-intelligence/evaluations/[id]`; helper filters server-side; modal shows only the matched items. Tighter result but loses context.

Ship the filter-on-client variant first. If managers find the unfiltered context confusing, switch to server-side in a follow-up.

### Implementation outline

Per Q13 (user decision 2026-05-12): **the new gap-evidence section renders ONLY when `payload.bucket` is set.** When entering from a heat-map cell (`payload.dimension` set, no `bucket`), the dimension-drill section stays as-is and the new gap section does NOT appear. This keeps the mental model tight per drill entry point.

In `InsightsEvalDetailModal.tsx`:

1. Read `payload.bucket` and `payload.bucketKind` from props.
2. After the existing dimension-drill and topic-drill render sections, ADD a new "Knowledge gaps" section. Gate the render on `payload.bucket !== undefined` (Q13). Inside the section:
   - Show ALL `evaluations.knowledge_gaps[]` for the eval (Q2 user decision: filter-on-client with highlight, not server-side scope).
   - Sort the matching items first (matches the cluster bucket).
   - Apply a highlight CSS class (e.g., a subtle accent bar on the left + slightly different bg) to the matched items, plus a "ⓘ matched bucket" chip.
3. For each gap item: render the `text` and `expected_source` path. Render citation pills (existing `CitationPill.tsx`) for each entry in `item.citations`.
4. Matching logic:
   ```ts
   function isMatch(gap, payload) {
     if (!payload.bucket || payload.bucketKind !== 'kb_path') return false;
     const src = gap.expected_source ?? '';
     // Match the same CASE bucket logic from the SQL (council C3 fix):
     // single-segment values bucket to 'Uncategorized'.
     if (!src || !src.includes('/')) {
       return payload.bucket === 'Uncategorized';
     }
     const twoSeg = src.split('/').slice(0, 2).join('/');
     return twoSeg === payload.bucket;
   }
   ```
5. For deferrals, the existing topic-drill section handles `payload.topic` paths. When `payload.bucket` is set with `bucketKind === 'kb_topic'`, the modal would need to know which chunks' `topics[]` contain the bucket label. Simplest path: don't filter deferrals when entering from a cluster — show them all. The cluster modal at Layer 1 already showed the user which deferral they clicked into. Apply the same "ⓘ matched bucket" highlight chip to any deferral whose `kb_chunk_ids` resolve to a chunk topic equal to `payload.bucket` (this requires the eval-detail API to return `kb_chunk_ids` on each deferral — verify when reading the route file).

**Validation gate:**
- `npm run build` exits 0.
- Manual sanity check: open the eval-detail modal from a heat-map cell (existing §5 path) — the dimension-drill render must be unchanged.

**STOP AND REPORT.** Confirm existing §5 drills still work; describe the new gap-render layout.

---

## Phase 5 — Cluster-evidence Layer 1 modal

**Goal:** ship a Layer 1 modal that renders the bucket's `sampleEvidence[]`. The spec says "the cluster-evidence Layer 1 modal IS the same scaffold as §5's eval-list modal — just a different data source."

### Design decision: extend `InsightsEvalListModal` vs. sibling component

The two modals have different columns and different click semantics:

| | `InsightsEvalListModal` | `InsightsClusterEvidenceModal` |
|---|---|---|
| Data source | List of evals matching (dim, role, version, pod, dateRange) | `KnowledgeGapClusterEvidence[]` |
| Columns | rep, call_date, dimension_score, call_title | rep, call_date, kind chip (gap/deferral+coverage), text preview |
| Row click | Push detail with `{ evaluationId, dimension }` | Push detail with `{ evaluationId, bucket, bucketKind }` |
| Rep cell click | (no special handler today) | Enter rep-focus mode (new) |

**Decision:** create a sibling `InsightsClusterEvidenceModal.tsx` rather than overloading the existing eval-list modal. Cleaner. Avoids a `mode: 'evalList' | 'clusterEvidence'` prop on the shared component.

### New file: `src/components/call-intelligence/InsightsClusterEvidenceModal.tsx`

Copy `InsightsEvalListModal.tsx` as the scaffold (z-50, same aria-modal, same focus pattern, same close-button ref, same `aria-hidden` prop). Replace the table body with the cluster-evidence rows.

Props:
```ts
interface Props {
  payload: ClusterEvidenceModalPayload;
  onClose: () => void;
  onSelectRow: (e: KnowledgeGapClusterEvidence) => void;
  onSelectRep: (repId: string) => void;
  ariaHidden?: boolean;
}
```

Columns:
1. Rep (clickable, opens rep-focus mode — `onSelectRep`)
2. Call date (`new Date(e.callStartedAt).toLocaleDateString()`, `'—'` for null)
3. Kind chip:
   - `gap` → small chip "Gap"
   - `deferral` + `kbCoverage='covered'` → "Deferral · Covered" (green)
   - `deferral` + `kbCoverage='partial'` → "Deferral · Partial" (yellow)
   - `deferral` + `kbCoverage='missing'` → "Deferral · Missing" (red)
   - `deferral` + no coverage → "Deferral"
4. Text preview — truncate to first ~120 chars, ellipsis

Whole row is the click target (`onSelectRow(e)`). Cell-level click on the rep cell calls `e.stopPropagation()` then `onSelectRep(repId)`.

`min-h-[44px]` row height for touch parity (matching `InsightsEvalListModal`).

**Validation gate:** `npm run build` exits 0.

**STOP AND REPORT.** New file path + line count.

---

## Phase 6 — UI wiring

**Goal:** make cluster cards clickable, add longtail collapse, add `humanizeBucket` helper, dispatch the new modal variant.

**File:** `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx`

### 6A. New display helper

Near the existing `humanizeKey` declaration in the file:
```ts
function humanizeBucket(bucket: string, kind: 'kb_path' | 'kb_topic' | 'uncategorized'): string {
  // Council S3 fix: 'Uncategorized: <topic>' deferral fallback labels stay as-written
  // (the raw deferral topic is the most useful surface label).
  if (bucket === 'Uncategorized' || bucket.startsWith('Uncategorized: ')) return bucket;
  if (kind === 'kb_path') {
    return bucket.split('/').map(seg =>
      seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    ).join(' › ');
  }
  // kb_topic — single tag like 'sgm_handoff'
  return bucket.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
```

### 6B. Cluster card → clickable

At lines 631–634, wrap each cluster card in a clickable element. Match the existing dashboard pattern for clickable cards (probably `<button type="button">` or `<div role="button" tabIndex={0}>` with keyboard handlers).

```tsx
<button
  key={c.bucket}
  type="button"
  onClick={() => setModalStack(s => [...s, {
    kind: 'cluster',
    payload: {
      bucket: c.bucket,
      bucketKind: c.bucketKind,
      evidence: c.sampleEvidence,
      gapCount: c.gapCount,
      deferralCount: c.deferralCount,
    },
  }])}
  className={/* preserve existing card styling */}
>
  <div className="flex items-baseline justify-between gap-2">
    <span>{humanizeBucket(c.bucket, c.bucketKind)}</span>
    {/* Q6 user decision: unique-rep badge as a secondary signal alongside occurrences */}
    <span
      className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap"
      title={`${c.repBreakdown.length} rep${c.repBreakdown.length === 1 ? '' : 's'} contributed to this bucket`}
    >
      {c.repBreakdown.length} {c.repBreakdown.length === 1 ? 'rep' : 'reps'}
    </span>
  </div>
  {/* ... rest of card body unchanged (counts, etc.) ... */}
</button>
```

### 6B.5. Empty state (Q7 user decision)

When `clusters.length === 0` (no advisor-eligible data in the window), render an empty-state message in place of the cluster grid. Copy:

> **No advisor calls in this window.** Adjust the date range or filters above.

Implementation:
```tsx
{clusters.length === 0 ? (
  <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
    <p className="text-sm text-gray-600 dark:text-gray-400">
      <strong className="block text-gray-900 dark:text-gray-100 mb-1">No advisor calls in this window.</strong>
      Adjust the date range or filters above.
    </p>
  </div>
) : (
  <>
    {/* main + longtail cluster render */}
  </>
)}
```

Wrap the entire cluster section (main + longtail) in this conditional. Loading state stays as-is (don't show the empty-state during the initial fetch).

### 6C. Longtail collapse

After computing the cluster list (where it's currently destructured from the SWR/fetch result), split into main and longtail:
```tsx
const longtail = clusters.filter(c => c.totalOccurrences === 1 && c.bucketKind === 'uncategorized');
const main = clusters.filter(c => !(c.totalOccurrences === 1 && c.bucketKind === 'uncategorized'));
const [longtailOpen, setLongtailOpen] = useState(false);
```
Render `main` as the primary list. Below it, if `longtail.length > 0`:
```tsx
<div className="mt-4">
  <button
    type="button"
    onClick={() => setLongtailOpen(o => !o)}
    aria-expanded={longtailOpen}
    className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
  >
    {longtailOpen ? `Hide ${longtail.length} one-offs ▴` : `Other (${longtail.length} one-offs) ▾`}
  </button>
  {longtailOpen && (
    <div className="mt-2 grid ...">
      {longtail.map(c => /* same clickable card render as main */)}
    </div>
  )}
</div>
```

### 6D. Modal dispatcher — switch + ariaHidden bookkeeping (council C2)

The existing dispatcher uses `find(...)` + `if/else` to render each `kind`, with `listAriaHidden` / `detailAriaHidden` booleans. Both must be updated when the new variant is added:

1. **Find every `find(l => l.kind === ...)` call** in `InsightsTab.tsx` and add the corresponding `clusterLayer`:
   ```ts
   const listLayer       = modalStack.find(l => l.kind === 'list');
   const detailLayer     = modalStack.find(l => l.kind === 'detail');
   const transcriptLayer = modalStack.find(l => l.kind === 'transcript');
   const clusterLayer    = modalStack.find(l => l.kind === 'cluster');
   ```

2. **Update the `ariaHidden` derivations** so any topmost layer correctly hides all lower layers. The new logic should be expressed off the stack's TOP layer kind:
   ```ts
   const topKind = modalStack[modalStack.length - 1]?.kind;
   const listAriaHidden       = topKind && topKind !== 'list';
   const clusterAriaHidden    = topKind && topKind !== 'cluster';
   const detailAriaHidden     = topKind === 'transcript';
   // transcript is always topmost when present
   ```

3. **Refactor the render block to an explicit switch with an exhaustiveness check** so TypeScript fails the build if a future variant is added without a render branch:
   ```tsx
   {modalStack.map((layer, i) => {
     const isTop = i === modalStack.length - 1;
     switch (layer.kind) {
       case 'list':
         return (
           <InsightsEvalListModal
             key={`list-${i}`}
             payload={layer.payload}
             ariaHidden={!isTop}
             onClose={() => setModalStack(s => s.slice(0, -1))}
             onSelectRow={/* unchanged from existing */}
           />
         );
       case 'cluster':
         return (
           <InsightsClusterEvidenceModal
             key={`cluster-${i}`}
             payload={layer.payload}
             ariaHidden={!isTop}
             onClose={() => setModalStack(s => s.slice(0, -1))}
             onSelectRow={(e) => setModalStack(s => [...s, {
               kind: 'detail',
               payload: {
                 evaluationId: e.evaluationId,
                 bucket: layer.payload.bucket,
                 bucketKind: layer.payload.bucketKind,
               },
             }])}
             onSelectRep={(repId) => {
               setModalStack([]);
               updateUrl({ focus_rep: repId });
             }}
           />
         );
       case 'detail':
         return (/* existing detail render */);
       case 'transcript':
         return (/* existing transcript render */);
       default: {
         // TS exhaustiveness guard — adding a new InsightsModalStackLayer variant
         // without a render branch will fail at compile time here.
         const _exhaustive: never = layer;
         return _exhaustive;
       }
     }
   })}
   ```

Don't forget to import `InsightsClusterEvidenceModal` at the top of the file.

### 6E. URL hash sync

In the existing `pushState`/`popstate` block (lines 261–290), add a new case for `'cluster'`. Example addition inside the switch:
```ts
case 'cluster':
  hash = `modal=cluster&bucket=${encodeURIComponent(top.payload.bucket)}`;
  break;
```

The `popstate` handler already does `setModalStack(s => s.slice(0, -1))` — no change needed.

**Validation gate:**
```bash
npm run build
```
Must exit 0. All TS errors from Phase 1 should now be resolved.

```bash
npm run lint -- --max-warnings=0 src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx 2>&1 | tail -20
```
No new warnings.

**STOP AND REPORT.** Build status. Lint status.

---

## Phase 7 — Tests

### 7A. SQL-string assertions

**File:** `src/lib/queries/call-intelligence/__tests__/knowledge-gap-clusters.test.ts`

Read the file first (the agent exploration found assertions at lines 45–56). Update assertions:

1. Delete the existing `params[8]` synonyms assertion.
2. Add: `expect(sql).toMatch(/LEFT JOIN LATERAL/);`
3. Add: `expect(sql).toContain("split_part(kg.item->>'expected_source','/',1)");`
4. Add: `expect(sql).not.toContain('kb_vocab_topics');`
5. Add (council C3 guard): `expect(sql).toContain("position('/' IN kg.item->>'expected_source') = 0");`
6. Add (council C4 guard): `expect(sql).toContain('ORDER BY chunk_index, id');`
7. Add (council C5 guard): `expect(sql).toContain('ROW_NUMBER() OVER');`
8. If the existing tests call `getKnowledgeGapClusters({...})` directly with a stubbed pool, add a `mode: 'rep_focus'` case verifying the SQL contains `rn <= 200` instead of `rn <= 5`.

### 7B. Component-level tests (council S4 — REQUIRED)

Add the following:

1. **Cluster card → modal push** — file `src/app/dashboard/call-intelligence/tabs/__tests__/InsightsTab.cluster-click.test.tsx` (or add to an existing test file in that dir). Render the `InsightsTab` with a fixture `clusters` list and a mocked SWR. Click a cluster card. Assert that the modal stack now contains `{ kind: 'cluster', payload: { bucket: <card.bucket>, ... } }`.

2. **Detail modal — bucket-only payload renders** — file `src/components/call-intelligence/__tests__/InsightsEvalDetailModal.test.tsx`. Render the modal with `payload = { evaluationId: '<uuid>', bucket: 'profile/ideal-candidate-profile', bucketKind: 'kb_path' }` (no `dimension`, no `topic`). Assert that the modal's root `div` is rendered (i.e., the guard does not early-return null) and the new gap-evidence section appears.

3. **Optional but recommended:** snapshot test of the SQL string for `mode: 'team'` and `mode: 'rep_focus'` — catches accidental slice-cap regressions.

**Validation gate:**
```bash
npm test -- knowledge-gap-clusters InsightsTab.cluster-click InsightsEvalDetailModal 2>&1 | tail -30
```
All tests pass.

**STOP AND REPORT.** Test count + pass/fail.

---

## Phase 7.5 — Doc sync (standing CLAUDE.md rule)

### 7.5A. Auto-generated inventory sync

```bash
npx agent-guard sync
git status --short
```

If `docs/_generated/*` files change, stage them.

### 7.5B. Narrative doc — `docs/ARCHITECTURE.md` (council Improvement 3)

`docs/ARCHITECTURE.md` references `kb_vocab_topics` and the 32-value vocab map. Find that section (Grep for `kb_vocab_topics` or `KB_VOCAB_SYNONYMS`), and update the call-intelligence module description to note:

- The cluster surface no longer buckets via `kb_vocab_topics` substring matching.
- Gaps now bucket on the first two path segments of `knowledge_gaps[].expected_source`.
- Deferrals now bucket on the first topic of the first active chunk in `kb_chunk_ids` (deterministic via `ORDER BY chunk_index, id LIMIT 1`).
- `src/lib/queries/call-intelligence/kb-vocab-synonyms.ts` remains in the codebase as theming data (badge colors) but is no longer load-bearing for filtering.

Note the path correction: the file is `src/lib/queries/call-intelligence/kb-vocab-synonyms.ts`, not `src/lib/kb-vocab-synonyms.ts` (the exploration synthesis had it wrong; verified during triage grep).

**STOP AND REPORT.** Doc deltas + ARCHITECTURE.md snippet updated.

---

## Phase 8 — Live probes + browser validation

### Live probes (run against Neon via `node -e ...` with `SALES_COACHING_DATABASE_URL`)

**Probe 1 — chunks.topics distribution still healthy:**
```sql
SELECT unnest(topics) AS t, COUNT(*)
  FROM knowledge_base_chunks
 WHERE is_active = true AND topics IS NOT NULL
 GROUP BY t ORDER BY COUNT(*) DESC LIMIT 50;
```
Expect ~10–30 distinct curated tags. (Was 31 at exploration time.)

**Probe 2 — deferral lateral coverage:**
```sql
SELECT
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM knowledge_base_chunks kbc
     WHERE kbc.id = ANY(d.kb_chunk_ids)
       AND kbc.is_active
       AND array_length(kbc.topics, 1) > 0
  )) AS would_bucket,
  COUNT(*) AS total
FROM rep_deferrals d
JOIN evaluations e ON e.id = d.evaluation_id
JOIN call_notes cn ON cn.id = e.call_note_id
WHERE d.is_synthetic_test_data = false
  AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
  AND d.created_at >= NOW() - INTERVAL '90 days';
```
Expect `would_bucket / total > 0.70` per spec; at exploration time, 169/169 = 100%.

**Probe 3 — bucket totals == unfiltered ceiling (acceptance criterion (a)):**

Hit `/api/call-intelligence/insights/clusters?range=90d&role=both&source=all` while signed in as an admin. Sum the returned `clusters[].totalOccurrences`. Compare to Pre-Flight `gap_ceiling + def_ceiling`. Must match exactly.

### Browser validation

Spin up the dev server:
```bash
npm run dev
```
Open the Insights tab. Verify:

| Criterion | How to check |
|---|---|
| (a) Bucket totals match ceiling | Probe 3 above |
| (b) "Uncategorized" bucket exists | Cluster list includes the bucket when any row has no `expected_source` (gaps) or no tagged chunks (deferrals). `bucketKind` = `'uncategorized'`. |
| (c) Top bucket = `profile/ideal-candidate-profile` | Read top cluster card label after `humanizeBucket`: should display "Profile › Ideal Candidate Profile" with `gapCount ≈ 143` and `repBreakdown.length ≈ 13`. **Note: spec said 132 gaps — at 2026-05-12, live = 143. Treat criterion (c) as label + rep count ≈ 13.** |
| (d) Modal chain works | Cluster card click → Layer 1 opens. Row click → Layer 2 opens. Citation pill (utterance) → Layer 3 opens at right utterance. Esc closes one layer at a time. Click-outside on Layer 1 closes all. |
| (e) Rep-focus mode lists all buckets | Click a rep name in Layer 1 → focus_rep set in URL → cluster list shows every bucket the rep contributed to (1× included). Order: most-deferred first. |
| (f) Single-bucket-per-deferral is deterministic | Verify the SQL comment is present in `deferral_hits` CTE. |
| (g) `is_active = true` filter on chunks join | Verify the LATERAL clause contains `AND is_active = true`. |

Plus:
- Longtail collapse — "Other (N one-offs)" expand/collapse works. Each longtail card still has working drill-down.
- Dark-mode parity on the new modal.
- Keyboard: Tab traps inside the topmost modal. Esc closes one layer at a time.

**Validation gate:** All eight checks pass.

**STOP AND REPORT.** Acceptance matrix (criterion → pass/fail/notes).

---

## Refinement Log

Updated 2026-05-12 from council review (Codex + Gemini) and self-cross-checks.

### Bucket 1 — applied autonomously (concrete fixes from council)

| # | Source | Change applied | Where |
|---|---|---|---|
| 1 | Codex Critical 1 (C1) | Phase 4 now explicitly widens the `InsightsEvalDetailModal` early-return guard to allow `payload.bucket` alone to trigger render | Phase 4, new 4A section |
| 2 | Codex Critical 2 (C2) | Phase 6D rewritten with explicit `switch (layer.kind)` + TS `never` exhaustiveness guard; `ariaHidden` derivations now driven off top-of-stack kind including `'cluster'` | Phase 6D |
| 3 | Codex Critical 3 (C3) | Phase 2E gap_hits bucket logic switched from `COALESCE/NULLIF` to `CASE` with explicit `position('/' IN ...) = 0` single-segment guard. `bucket_kind` derivation aligned | Phase 2E gap_hits CTE |
| 4 | Codex Critical 4 (C4) | Phase 2E deferral LATERAL gained `, id` tie-breaker → fully deterministic single-bucket assignment | Phase 2E deferral_hits CTE |
| 5 | Gemini Critical 2 (C5) | Phase 2E evidence aggregation rewritten from correlated-subquery-per-bucket to a single window-function rank (`ROW_NUMBER() OVER (PARTITION BY bucket ...)`) + `FILTER (WHERE rn <= sliceCap)` | Phase 2E final SELECT |
| 6 | Gemini Critical 4 (C7) | Verified: `grep -rE "knowledge_gaps\|rep_deferrals\|knowledge_base_chunks\|kb_vocab_topics" packages/analyst-bot mcp-server` returned ZERO matches. No cross-functional impact. Documented in Pre-Flight step 5 | Pre-Flight |
| 7 | Codex Should-Fix 1 (S1) | Phase 2F `.map()` citation transformer rewritten to drop the entire citation entry when neither `utterance_index` nor a fully-populated `kb_source` is present (instead of emitting `{}`) | Phase 2F constructor |
| 8 | Codex Should-Fix 4 (S3) | Phase 6A `humanizeBucket` now explicitly returns the raw bucket label when it equals `'Uncategorized'` or starts with `'Uncategorized: '` | Phase 6A |
| 9 | Codex Should-Fix 5 (S4) | Phase 7 split into 7A (SQL assertions) and 7B (component-level tests). 7B mandates a `cluster-click → modal push` test and a `detail-modal renders with bucket-only payload` test | Phase 7 |
| 10 | Codex Should-Fix 6 (S5) | Pre-Flight gained a probe (step 3) for any `evaluations`-level synthetic flag, mirroring the `rep_deferrals.is_synthetic_test_data` filter | Pre-Flight |
| 11 | Gemini Improvement 3 | Phase 7.5 expanded with 7.5B — explicit `docs/ARCHITECTURE.md` narrative update for the deprecated vocab-map path | Phase 7.5 |
| 12 | Self cross-check | Corrected `kb-vocab-synonyms.ts` path: lives at `src/lib/queries/call-intelligence/kb-vocab-synonyms.ts`, not `src/lib/kb-vocab-synonyms.ts` (exploration synthesis was wrong) | Phase 7.5B |
| 13 | Codex Should-Fix 2 (S2) | Removed the misleading "LATERAL guarantees ORDER BY + LIMIT" comment (it was a correlated subquery, not a LATERAL); replaced with an accurate note about the window-function rewrite | Phase 2E note block |

### Bucket 2 — resolved by user 2026-05-12

| # | Question | User decision | Guide change applied |
|---|---|---|---|
| Q1 | Bucket-namespace collision (gap kb_path vs deferral kb_topic) | Keep single `bucket` + `bucketKind`; `kb_path` precedence | No change (matches spec / Phase 2E) |
| Q2 | Detail-modal scope on cluster drill | Show all + highlight matched (filter-on-client) | No change (matches Phase 4 design decision) |
| Q3 | `chunk_index` semantic vs DB-order | Treat as DB-order; document trade-off | No change (existing SQL comment in Phase 2E deferral_hits already documents) |
| Q4 | `Uncategorized: <topic>` label format | Keep raw | No change |
| Q5 | Longtail collapse rule | Current spec — only `totalOccurrences=1 AND bucketKind='uncategorized'` | No change |
| Q6 | Sort by occurrences vs unique reps | Sort by occurrences + ADD unique-rep badge to card | **Applied** — Phase 6B card render now shows `{N} rep(s)` badge in the card header |
| Q7 | Empty-state copy | "No advisor calls in this window. Adjust the date range or filters above." | **Applied** — new Phase 6B.5 section |
| Q8 | `expected_source` path normalization | No normalization; trust upstream AI | No change |
| Q9 | Rep-focus payload size | Eager 200 cap | No change (matches spec / Phase 2C) |
| Q10 | Modal stack preservation on rep-name click | Close all modals + URL hop | No change (matches Phase 6D) |
| Q11 | Triage filters inside Layer 1 cluster modal | NO — defer to follow-up | No change (Bucket 3) |
| Q12 | Deferral fallback when chunks lack `topics[]` | Dynamic `'Uncategorized: ' || d.topic` | No change (matches Phase 2E deferral_hits) |
| Q13 | Detail modal gap-render when no `bucket` payload | Render only when `bucket` is set | **Applied** — Phase 4 implementation outline rewritten to gate the new gap section on `payload.bucket !== undefined`; matching helper rewritten to align with the Phase 2E SQL CASE logic |

### Bucket 3 — noted but not applied

| # | Source | Why deferred |
|---|---|---|
| 1 | Gemini Improvement 1 — Triage filters inside Layer 1 cluster modal | Scope expansion. Worth a follow-up after manager feedback on the initial ship. |
| 2 | Gemini Improvement 2 — "Show all" pagination | Scope; depends on Q9 outcome (if Q9 picks lazy-load, the pagination falls out of that endpoint). |
| 3 | Codex Suggestion 4 — Split schema into `gapBucket`/`deferralBucket` | Pre-emptive de-collision. Defer pending Q1 resolution. |
