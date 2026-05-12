# Insights Tab — Refinement Pass

Six UX/data fixes layered on top of the shipped 5c-1 build. All client-side except for the new "previous-period" series on the trend SQL. Sections are ordered to match the suggested build order — each step is independently shippable.

---

## 1. Global rep type-ahead filter (top of tab) — `/auto-feature`

**Problem.** No way to jump to a specific rep without first clicking through a cluster card.

**Change.** Add a combobox at the top of the filter bar:

```
<input type="text" placeholder="Filter by rep…" />
   → dropdown of matches from /api/call-intelligence/insights/reps
```

Selection behavior:

- Updates URL: `?focus_rep=<uuid>` (same param the existing focus mode uses).
- **Role inferred from rep**: if `reps.role = 'SGA'` → only SGA blocks render; if `'SGM'` → only SGM block(s). Implementation: when entering focus mode, `role` filter is locked to the rep's role and the role-toggle chips switch to read-only. Already mostly true — just need the auto-set.
- Clearing the input (or hitting "← Back to team") drops `focus_rep` and re-enables manual role/pod controls.

**New API.** `GET /api/call-intelligence/insights/reps` → `{ reps: Array<{ id, full_name, role }> }`, scoped to `getRepIdsVisibleToActor`. Used both for the type-ahead and (later) for a pod-axis rep multi-select. Pure read, ~30 rows for a manager, no pagination needed.

### Prompt — paste after `/auto-feature `

```
Add a global rep type-ahead filter to the Insights tab on /dashboard/call-intelligence. Sits in the sticky filter bar at the top of `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx`, alongside the existing date-range / role / pod / source filters.

Behavior:
- Combobox input "Filter by rep…" — typing fetches matching reps from a new API route /api/call-intelligence/insights/reps which returns { reps: Array<{ id, full_name, role, pod_name?, pod_id? }> } scoped to getRepIdsVisibleToActor(actor) from src/lib/queries/call-intelligence/visible-reps.ts. ~30 rows for a manager, no pagination.
- Selecting a rep sets ?focus_rep=<uuid> on the URL (same param the existing rep-focus mode already uses). When `focus_rep` is set, role filter is locked to the rep's role; role-toggle chips become read-only. Already partially true — wire the auto-set.
- Clearing the input (or clicking the existing "← Back to team" button) drops focus_rep and re-enables role/pod controls.

New files:
- src/app/api/call-intelligence/insights/reps/route.ts — same auth shape as the existing insights routes (manager+admin+revops_admin gate, allowedPages.includes(20), admin/revops short-circuit before getRepIdByEmail). Returns the active reps the actor can see plus the rep's pod_name/pod_id (LEFT JOIN through coaching_team_members → coaching_teams).
- src/lib/queries/call-intelligence/visible-reps-detail.ts (or extend pods.ts) — new helper that returns full names + pod context for the visible set in one shot.

Modified:
- src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx — combobox component, dropdown logic, role-lock when focus_rep is set.

Acceptance:
- (a) Manager types "Bre" → only Bre McDaniel matches → click → URL becomes ?tab=insights&focus_rep=<bre-uuid> → SGM-only blocks render. (Bre is an SGM with no pod, so the "Unassigned (no pod)" rendering must work.)
- (b) Admin (GinaRose) types anything → can match all 31 visible reps. SGA-role rep filters to SGA blocks; SGM-role rep filters to SGM blocks.
- (c) Combobox closed by default. Opens on focus or type. Esc closes. Click-outside closes.
- (d) Component reuses an existing input/dropdown pattern from the codebase if one exists (search for combobox / typeahead patterns first); falls back to a minimal custom impl if not.
- (e) Dark-mode parity with the rest of the filter bar.

Out of scope: pod-axis rep multi-select (reuses the same API later, separate ship).
```

---

## 2. Rep-focus header — show name + explain what mode means — `/quick-update`

**Current.** Header just says "Rep focus mode" with a Back button.

**Change.** Two-line header:

```
Rep focus mode — <Full Name> (<role>, <pod or "Unassigned">)
This view shows only <name>'s evaluations. The cards below are their personal averages for the selected period.
```

Pull rep metadata from the new `/insights/reps` cache (or a new `/insights/reps/[id]` if we want to keep it light). Surface role + pod so the user remembers *why* the page is shaped the way it is. Title needs to live above the sticky filter bar.

### Prompt — paste after `/quick-update `

```
In src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx, replace the current rep-focus header (the `<div>` that renders "Rep focus mode" alongside the "← Back to team" button) with a two-line header that lives ABOVE the sticky filter bar:

  Line 1 (h2, large): "Rep focus mode — <Full Name> (<role>, <pod or 'Unassigned'>)"
  Line 2 (text-sm, muted): "This view shows only <name>'s evaluations. The cards below are their personal averages for the selected period."

Pull rep metadata (full_name, role, pod_name) from the /api/call-intelligence/insights/reps response that §1 already fetches — find the focusRep entry by id and use its full_name/role/pod_name. If §1 hasn't shipped yet, add a minimal one-off /api/call-intelligence/insights/reps/[id] route that returns the same three fields, scoped through visibleRepIds for the authority gate (notFound() if out of scope, matching the focus_rep gate in page.tsx).

Keep the "← Back to team" button as-is; just relocate it inline with the new header.

Files expected to change: 1 (InsightsTab.tsx) if §1 shipped; otherwise 2 (add a minimal route).
Acceptance: header renders correct rep name/role/pod for Bre (Unassigned SGM), Erin (SGA), Nick (SGM, his own pod as lead). Dark-mode parity.
```

---

## 3. Heat-map cell layout — full dimension titles must be readable — `/quick-update`

**Problem.** The current grid (`InsightsTab.tsx:228` — `grid-cols-[200px_repeat(auto-fill,minmax(80px,1fr))]`) packs each rubric dimension into an 80px-wide cell, so labels like *Aum Qualification Rigor* truncate to `Aum Quali…` on every row. The 200px first column is unused at the moment (there is no row-label axis), so it just steals horizontal space.

**Change.** Drop the row-label column. Render each row block as **two horizontal columns of stacked cards** instead of a single tight grid, so each card has ~50% of the block width and the full dimension title fits on one or two lines.

```
grid-cols-1 md:grid-cols-2 gap-2          // 2 vertical columns on md+
min-h-[72px]                              // taller card → title + score + n stack cleanly
text-sm leading-snug                      // remove `truncate`
```

If we want to keep more density on wide screens, gate to `md:grid-cols-2 xl:grid-cols-3`. Avoid going back to 4+ columns — that's the regime that caused truncation.

**Files.** `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx` (heat-map render block; the grid-template literal and the `<a>` cell markup). No SQL change.

### Prompt — paste after `/quick-update `

```
In src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx, the heat-map cells truncate dimension titles like "Aum Qualification Rigor" → "Aum Quali…". Fix:

1. Find the heat-map grid: currently `grid-cols-[200px_repeat(auto-fill,minmax(80px,1fr))]` wrapping each block's cells.
2. Replace with `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2`. Drop the unused 200px first column entirely.
3. Cell card: bump min height to `min-h-[72px]`, change text-xs → text-sm, remove the `truncate` class on the title div, allow wrapping with `leading-snug`. Keep score `font-bold tabular-nums` and the n-count text-[10px].
4. Keep all existing cell colors (#175242 / #8e7e57 / #c7bca1) and the hover-opacity and href behavior. No SQL or type change.

Files: 1 (InsightsTab.tsx). No new components.
Acceptance: "Aum Qualification Rigor" renders in full on a card at md+ widths. 2 cards per row on md, 3 per row on xl. Mobile: single column. Dark-mode parity.
```

---

## 4. Trend mode: period-over-period, not "trailing 90 days always" — `/quick-update`

**Problem.** Sparkline lookback is hardcoded to 90 days regardless of the main date filter (`dimension-heatmap.ts:138`, decoupling decided in 5c-1 to avoid `n=1` collapse). When the user enters focus mode with a 30d main filter, the heat-map cells reflect 30d but the sparkline reflects 90d — confusing and never explicitly explained in the UI.

**Change.** Replace the trailing sparkline with a **two-bucket period-over-period comparison**, controlled by a small selector inline with the trend header:

```
Trend: [ Last 30d vs prior 30d ] [ Last 90d vs prior 90d ]
```

Per dimension, render two adjacent bars (current vs prior) plus a delta chip:

```
intro_call_framing      [██████] 3.4   →   [████] 2.9     ▲ +0.5
qualification           [████] 2.1     →   [██████] 3.1   ▼ −1.0
```

Or, if we want to keep the line-style aesthetic, a 2-point sparkline (prior → current) with a colored delta chip. Either way the user sees *what the trend is relative to*, which the current freeform 90d sparkline doesn't communicate.

**SQL.** Helper grows two windowed averages:

```sql
SELECT
  ds.key AS dimension_name,
  AVG((ds.value->>'score')::numeric) FILTER (WHERE e.created_at >= $current_start AND e.created_at < $current_end) AS current_avg,
  AVG((ds.value->>'score')::numeric) FILTER (WHERE e.created_at >= $prior_start   AND e.created_at < $prior_end)   AS prior_avg,
  COUNT(*) FILTER (WHERE e.created_at >= $current_start AND e.created_at < $current_end) AS current_n,
  COUNT(*) FILTER (WHERE e.created_at >= $prior_start   AND e.created_at < $prior_end)   AS prior_n
FROM evaluations e JOIN call_notes cn ON cn.id = e.call_note_id
CROSS JOIN jsonb_each(e.dimension_scores) AS ds(key, value)
WHERE … (advisor-eligible, rep filter, dimension_scores <> '{}')
GROUP BY ds.key
```

Returns `Array<{ dimensionName, currentAvg, currentN, priorAvg, priorN, delta }>` instead of `periodBuckets`. Type change touches `RepFocusSparklineSeries` in `src/types/call-intelligence.ts` → rename or replace with `RepFocusTrendComparison`. Sparkline component becomes either deprecated or repurposed as a 2-bar bullet chart.

Default the toggle to `30d vs prior 30d` to keep most users in a high-signal regime; 90d available for slow-trending dimensions.

### Prompt — paste after `/quick-update `

```
In rep-focus mode on the Insights tab, replace the trailing-90d sparkline with a period-over-period comparison. The current sparkline is hardcoded to 90d regardless of the main date filter — confusing because the heat-map cells respect the filter but the trend doesn't.

SQL (src/lib/queries/call-intelligence/dimension-heatmap.ts, the `sparkSql` block):
Replace the per-week jsonb_each output with two windowed averages per dimension:

  SELECT
    ds.key AS dimension_name,
    AVG((ds.value->>'score')::numeric) FILTER (WHERE e.created_at >= $current_start AND e.created_at < $current_end) AS current_avg,
    AVG((ds.value->>'score')::numeric) FILTER (WHERE e.created_at >= $prior_start   AND e.created_at < $prior_end)   AS prior_avg,
    COUNT(*) FILTER (WHERE e.created_at >= $current_start AND e.created_at < $current_end) AS current_n,
    COUNT(*) FILTER (WHERE e.created_at >= $prior_start   AND e.created_at < $prior_end)   AS prior_n
  FROM evaluations e
  JOIN reps r ON r.id = e.rep_id AND r.is_system = false
  JOIN call_notes cn ON cn.id = e.call_note_id
  CROSS JOIN jsonb_each(e.dimension_scores) AS ds(key, value)
  WHERE (cn.source='kixie' OR cn.likely_call_type='advisor_call')
    AND e.rep_id = $1
    AND e.dimension_scores <> '{}'::jsonb
    AND ($current_n_param::int IS NULL OR e.rubric_version = $current_n_param)
  GROUP BY ds.key

Window math: trendMode = '30d_vs_prior_30d' → current=[today-30, today), prior=[today-60, today-30). trendMode = '90d_vs_prior_90d' → current=[today-90, today), prior=[today-180, today-90). All bounds are date strings (yyyy-mm-dd) bound as $::date params. Probe live against the Neon DB before wiring.

Type (src/types/call-intelligence.ts):
Replace `RepFocusSparklineSeries` with:
  export interface RepFocusTrendComparison {
    dimensionName: string;
    currentAvg: number | null;
    currentN: number;
    priorAvg: number | null;
    priorN: number;
    delta: number | null;  // currentAvg - priorAvg; null if either side is null
  }
And update `DimensionHeatmapResult.sparklines: RepFocusTrendComparison[] | null`.

UI (src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx, the rep-focus sparkline block):
- Inline selector at top of trend section: two buttons "Last 30d vs prior 30d" / "Last 90d vs prior 90d". State stored in URL via ?trend=30d|90d. Default 30d.
- Per row: dimension name + two horizontal mini bars (current vs prior, same color thresholds as cells) + delta chip ("▲ +0.5" green / "▼ −1.0" red / "— flat" gray).
- Hide rows where currentN + priorN < 2 (too sparse to display).

The existing Sparkline component (src/components/call-intelligence/Sparkline.tsx) can be repurposed for a 2-point bar OR a small new component <TrendCompare /> can render the two-bar inline. Pick whichever ships faster.

Files: 1 SQL helper + 1 types + 1 InsightsTab + maybe 1 new TrendCompare (or Sparkline edit) = 3-4 files.
Acceptance:
- Toggling 30d↔90d swaps the SQL params; verified via live probe before merge.
- The trend section header makes it obvious WHAT is being compared.
- n=0 in current OR prior windows → row shows "—" not NaN.
```

---

## 5. Drill-down: replace page nav with a modal stack — `/auto-feature`

**Current behavior.** Clicking a heat-map cell navigates to `/dashboard/call-intelligence/insights/evals?…`, which renders a table with an `Open →` link per row that further navigates to `/evaluations/[id]`. Two full page loads to reach the eval; context lost on each transition.

**Target behavior.**

1. Cell click → **eval-list modal** opens in-tab over the current Insights view (no navigation).
   - Whole-row click target; remove the `Open →` cell.
   - `min-h-[44px]` row height for touch parity.
2. Row click → **eval-detail modal** opens on top of the list modal (z-index stacked, dim background).
   - Body: the relevant slice of the eval — for a heat-map drill, the dimension's `body` / `evidence` text from `dimension_scores[dim]`; for a cluster drill, the matched `knowledge_gaps[].text` or `rep_deferrals.topic` + reason.
   - Citation pills next to each evidence chunk (existing `CitationPill.tsx` pattern from `EvalDetailClient.tsx:147`).
3. Citation pill click → **transcript modal** on top of the eval-detail modal, auto-scrolled to the cited utterance.
   - Reuse `src/components/call-intelligence/TranscriptModal.tsx` (already supports `initialUtteranceId` per `EvalDetailClient.tsx:200`).
   - A "← Back" affordance in the transcript modal header pops back to the eval-detail modal (close transcript only, keep list+detail mounted).
4. Click-outside / Esc on the topmost modal closes only that layer. Closing all the way bubbles back to the Insights tab with filters intact.

**Implementation notes.**

- Build a tiny modal stack helper (`useModalStack<T extends string>()`) or just `useState<Array<{ kind, payload }>>([])` in `InsightsTab` and render conditionally. Avoid React portals nesting — single portal target, conditional layers.
- The eval-detail modal needs the same data the existing `/evaluations/[id]` page renders. Cheapest path: a new `/api/call-intelligence/insights/eval-detail?id=…&dimension=…&topic=…` route that returns just the slice we need (eval row + matched evidence text + utterance refs + KB chunk refs). Reuses `getEvaluationDetail` from `src/lib/queries/call-intelligence-evaluations.ts:273`.
- The transcript modal already exists and is invoked from the standalone eval page. We're just calling it from a different parent.

**Deletion.** Once the modal chain works, retire the page route at `src/app/dashboard/call-intelligence/insights/evals/` (page.tsx + EvalsListClient.tsx) along with `src/app/api/call-intelligence/insights/evals/route.ts`. The corresponding helper `src/lib/queries/call-intelligence/insights-evals-list.ts` can be re-pointed at the modal route or deleted if the new route subsumes it.

### Prompt — paste after `/auto-feature `

```
Replace the Insights tab's page-navigation drill-down (currently at /dashboard/call-intelligence/insights/evals) with an in-tab three-layer modal stack. Goal: a manager clicks a heat-map cell, sees the list of evals, clicks a row, sees the evaluation's narrative + citations, clicks a citation, sees the transcript jumped to that utterance — all without leaving the Insights tab.

Modal layers (each render conditionally, single portal target, z-index stacked):
  Layer 1: Eval-list modal. Trigger = heat-map cell click. Renders one row per eval matching (block.role, block.rubricVersion, block.podId, cell.dimensionName, date range, focused rep if any). WHOLE-ROW click target — no "Open →" link. min-h-[44px] row height. Columns: rep_name | call_started_at | (dimension score for that dim, color-bucketed) | call_title.
  Layer 2: Eval-detail modal. Trigger = row click in Layer 1. Renders the slice of the eval relevant to the drill — for a dimension drill, the dimension's body/evidence/citations from dimension_scores[dimName]; for a cluster drill (§6), the matched knowledge_gaps[].text or rep_deferrals.deferral_text + AI's reasoning. Citation pills next to each evidence chunk (existing CitationPill.tsx pattern from EvalDetailClient.tsx).
  Layer 3: Transcript modal. Trigger = citation pill click in Layer 2. REUSE src/components/call-intelligence/TranscriptModal.tsx — it already supports auto-scroll to a given utterance_index. Add a "← Back" affordance in the modal header that closes ONLY the transcript layer (Layer 2 remains mounted).

Behavior:
- Click-outside / Esc on the topmost layer closes only that layer.
- All filter state on the underlying InsightsTab is preserved while modals are open.
- Modal stack helper: useState<Array<{ kind: 'list'|'detail'|'transcript', payload: ... }>>([]) inside InsightsTab. No portals nesting — one portal target, conditional render of each layer with separate z-index.

New API route:
- src/app/api/call-intelligence/insights/eval-detail/route.ts — GET ?id=<uuid>&dimension=<string>&topic=<string>. Reuses getEvaluationDetail() from src/lib/queries/call-intelligence-evaluations.ts:273. Returns { evaluationId, callTitle, callStartedAt, repId, repName, evidence: Array<{ text, citations: Array<{ utterance_index?: number, kb_source?: {...} }> }>, kbChunks?: [...] }. Same auth shape as the existing /insights/heatmap route (manager+admin+revops_admin gate, focus_rep authority check via getRepIdsVisibleToActor → notFound() on out-of-scope).

Existing /api/call-intelligence/insights/evals/route.ts and src/lib/queries/call-intelligence/insights-evals-list.ts can stay as the LIST data source for Layer 1 (we just stop linking to it from a separate page).

Files to delete after the modal stack works end-to-end:
- src/app/dashboard/call-intelligence/insights/evals/page.tsx
- src/app/dashboard/call-intelligence/insights/evals/EvalsListClient.tsx

Existing components to reuse:
- src/components/call-intelligence/TranscriptModal.tsx (Layer 3)
- src/components/call-intelligence/CitationPill.tsx (Layer 2 evidence chunks)
- src/components/call-intelligence/KBSidePanel.tsx (KB chunk viewer pattern if needed)
- Modal scaffold patterns in src/components/call-intelligence/ConfirmSubmitModal.tsx, RejectReasonModal.tsx (focus trap, Esc, aria-modal)

Acceptance tests:
- (a) From team-mode heat-map: click a cell → Layer 1 opens with the right evals. Click any row → Layer 2 opens with that eval's evidence. Click citation pill → Layer 3 opens with transcript jumped to the cited utterance.
- (b) "← Back" in Layer 3 closes only Layer 3 (Layer 2 still visible).
- (c) Esc on Layer 2 closes only Layer 2 (Layer 1 still visible).
- (d) Click-outside on Layer 1 closes all layers.
- (e) Filter state (date range, role, source, focus_rep) on the underlying InsightsTab is unchanged after closing all modals.
- (f) The deleted /insights/evals page no longer exists in build output. Removing the page does not break any existing inbound links from the rest of the app (grep for `/insights/evals` across the repo first; only InsightsTab.tsx should reference it).
- (g) The same chain works in rep-focus mode (heat-map cells in focus mode trigger the same stack with rep-scoped eval list).

Out of scope (separate ships):
- §6's cluster-card drill-down (uses this same modal stack but is its own auto-feature).
- A11y focus-trap polish on stacked modals (mark as follow-up).
```

---

## 6. Clusters — replace bucketing strategy + add drill-down — `/auto-feature`

This is the biggest change in the pass. It has two parts: (a) fix what we're bucketing on (current strategy drops ~66% of gaps and ~84% of deferrals); (b) once buckets are correct, add the modal-chain drill-down so cluster cards open the same eval/transcript surface as heat-map cells.

### 6a. Bucketing — drop `kb_vocab_topics`/`KB_VOCAB_SYNONYMS`, use structured fields the data already carries

**Problem.** `getKnowledgeGapClusters` forces every gap and deferral into one of 32 `kb_vocab_topics` values via substring matching against the curated `KB_VOCAB_SYNONYMS` map. Audit numbers (last 90 days, advisor-eligible):

| Source | Rows in DB | Surfaced now | Coverage |
|---|---:|---:|---:|
| Knowledge gaps | 422 | 142 | 34% |
| Deferrals | 147 | 23 | 16% |

The AI on the sales-coaching side writes free-form `rep_deferrals.topic` strings (146 distinct topics in 147 rows — essentially 1:1) and structured `knowledge_gaps[].expected_source` paths. Hand-curated synonym matching against a 32-value taxonomy was never going to hit either signal cleanly.

**Fix — use the structured keys that already exist on the data:**

- **Knowledge gaps** group by `knowledge_gaps[].expected_source`, truncated to the first two path segments. 388/422 rows (92%) have it populated. That gives **20 natural buckets** mapping directly to the KB structure:

  ```
  profile/ideal-candidate-profile     132 occurrences, 13 reps
  playbook/sga-discovery               98 occurrences, 18 reps
  facts/process                        31 occurrences, 10 reps
  playbook/sgm-intro                   26 occurrences,  7 reps
  playbook/handoff                     21 occurrences,  5 reps
  playbook/platform-review             21 occurrences,  5 reps
  facts/compensation                   14 occurrences,  7 reps
  …(13 more, plus an "Uncategorized" bucket for the 34 rows without expected_source)
  ```

- **Deferrals** group via the `kb_chunk_ids → knowledge_base_chunks.topics[]` join. `knowledge_base_chunks` already has a curated `topics` array column (and a `chunk_role`, `call_stages`, `rubric_dimensions` set we can use later for sub-filters). Every deferral row has the `kb_chunk_ids` array of chunks the retrieval system pulled when scoring `kb_coverage`. We `unnest(d.kb_chunk_ids)` → join `knowledge_base_chunks` → `unnest(chunks.topics)` → that's the bucket. For deferrals where no chunk has `topics[]` populated (or `kb_chunk_ids` is empty), fall through to a `'Uncategorized: ' || d.topic` label so the raw AI topic surfaces in the longtail bucket.

**Effect.** Coverage moves from 34%/16% → ~100%. Bucket labels stop being narrow vocab values and start being either KB paths (gaps) or curated chunk tags (deferrals) — both already aligned with how managers think about coaching focus.

**SQL sketch (`knowledge-gap-clusters.ts` rewrite, the gap CTE):**

```sql
WITH gap_hits AS (
  SELECT
    COALESCE(
      NULLIF(split_part(kg.item->>'expected_source','/',1) || '/' ||
             split_part(kg.item->>'expected_source','/',2), '/'),
      'Uncategorized'
    ) AS bucket,
    e.rep_id,
    r.full_name AS rep_name,
    e.id AS evaluation_id,
    kg.item->>'text' AS evidence_text,
    kg.item->'citations' AS citations,
    kg.item->>'expected_source' AS expected_source_full,
    1 AS gap_count, 0 AS deferral_count, NULL::text AS kb_coverage
  FROM evaluations e
  JOIN scoped_reps sr ON sr.id = e.rep_id
  JOIN reps r ON r.id = e.rep_id
  JOIN call_notes cn ON cn.id = e.call_note_id
  CROSS JOIN jsonb_array_elements(e.knowledge_gaps) AS kg(item)
  WHERE $6::bool = true
    AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
    AND e.created_at >= $2::date
    AND e.created_at <  $3::date
)
```

**SQL sketch (the deferral CTE):**

```sql
deferral_hits AS (
  SELECT
    COALESCE(
      (SELECT t FROM unnest(kbc.topics) AS t LIMIT 1),  -- primary topic of first matched chunk
      'Uncategorized: ' || d.topic
    ) AS bucket,
    d.rep_id,
    r.full_name AS rep_name,
    d.evaluation_id,
    d.deferral_text AS evidence_text,            -- verbatim rep quote, currently unused
    jsonb_build_array(
      jsonb_build_object('utterance_index', d.utterance_index)
    ) AS citations,
    d.topic AS raw_topic,                         -- preserved for "show raw label" affordance
    0 AS gap_count, 1 AS deferral_count, d.kb_coverage
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
     ORDER BY chunk_index
     LIMIT 1
  ) kbc ON true
  WHERE $7::bool = true
    AND d.is_synthetic_test_data = false
    AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
    AND d.created_at >= $2::date
    AND d.created_at <  $3::date
    AND ($8::text IS NULL OR d.kb_coverage = $8)
)
```

The `topics` MCP parameter (`$9::jsonb`) and the `topics` CTE go away entirely. The `KB_VOCAB_SYNONYMS` map can stay in the codebase as theming data (badge colors per known canonical bucket) but is no longer load-bearing for filtering.

**Type changes** (`src/types/call-intelligence.ts`):

```ts
export interface KnowledgeGapClusterRow {
  bucket: string;                                  // renamed from `topic`; new semantics
  bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized';   // distinguishes gap-side vs deferral-side bucket label
  totalOccurrences: number;
  gapCount: number;
  deferralCount: number;
  deferralByCoverage: { covered: number; partial: number; missing: number };
  repBreakdown: Array<{ repId: string; repName: string; gapCount: number; deferralCount: number }>;
  sampleEvalIds: string[];
  // NEW — for the drill-down modal:
  sampleEvidence: Array<{
    evaluationId: string;
    repId: string;
    repName: string;
    kind: 'gap' | 'deferral';
    text: string;                                  // gap text OR verbatim deferral quote
    citations: Array<{ utterance_index?: number; kb_source?: { doc_id: string; chunk_id: string; doc_title: string; drive_url: string } }>;
    expectedSource?: string;                       // gap-only, full path
    kbCoverage?: 'covered' | 'partial' | 'missing'; // deferral-only
  }>;
}
```

`sampleEvidence` is what powers the modal in §6c. Cap is `[1:5]` in team mode and `[1:200]` in rep-focus mode (`mode: 'team' | 'rep_focus'` arg to the helper).

### 6b. Ranking + longtail

**Ordering.** Each cluster row sorts `total_occurrences DESC, bucket ASC`. Single render order across the whole tab: most-deferred buckets at the top, descending.

**Longtail.** Anything with `total_occurrences = 1` AND `bucketKind != 'kb_path'` (i.e., one-off "Uncategorized: …" buckets) renders collapsed under a `<details>`-style "Other (N one-offs)" group at the bottom. Manager expands when they want to scan. Each longtail row still has a working drill-down to the modal — nothing is hidden, just visually deprioritized.

`HAVING total_occurrences >= 1` stays (we never want zero-rows in the result). The only collapse is visual.

### 6c. Drill-down modal chain from cluster cards

Once 6a + 6b are in, every cluster card becomes clickable, opening the same modal stack defined in §5:

1. **Cluster click → cluster-evidence modal.** Renders the `sampleEvidence[]` rows for that bucket. Each row shows: rep name (clickable → enter rep-focus mode), call date, evidence kind chip (`gap` / `deferral` with `kb_coverage` sub-chip), and a truncated preview of `text`. Whole-row click target.
2. **Row click → eval-detail modal** on top. Body shows the full `text`, the `expected_source` (gap) or `kb_chunk_ids → chunks.title` list (deferral), and citation pills for each utterance/kb-source reference.
3. **Citation pill click → transcript modal** on top, scrolled to `utterance_index`. "← Back" closes only the transcript layer.
4. **Same chain wired to heat-map cells in rep-focus mode** (§5 already covers this for team mode; the rep-focus version needs the same trigger).

**Helper-side change.** `getKnowledgeGapClusters` grows an optional `sampleLimit` (or `mode: 'team' | 'rep_focus'`) arg. Team mode keeps `[1:5]` on `sample_eval_ids` AND on `sampleEvidence[]` to keep payload sane. Rep-focus mode lifts to `[1:200]` since the scope is one rep. Lift `array_agg(DISTINCT evaluation_id ORDER BY evaluation_id)[1:5]` accordingly.

**API.** The clusters route accepts `?limit=full` (manager in rep-focus mode passes it). No change to the URL params surface beyond that.

### 6d. Acceptance criteria for §6

- (a) Sum of `totalOccurrences` across all cluster rows = total advisor-eligible (gaps + deferrals) in the date window. **No data dropped.** Verify with a `COUNT(*)` sanity probe against the unfiltered CTE.
- (b) The "Uncategorized" bucket exists when any row has no `expected_source` (gaps) or no tagged chunks (deferrals). Its `bucketKind` is `'uncategorized'`.
- (c) Clicking any cluster card opens the cluster-evidence modal. Clicking a row inside opens the eval-detail modal. Clicking a citation pill opens the transcript modal at the right utterance. Each layer's close affordance only closes that layer.
- (d) In rep-focus mode, the cluster list shows every cluster the focused rep contributed to (1× included). Sort order: most-deferred first.
- (e) `knowledge_base_chunks` join must filter `is_active = true` so retired KB chunks don't poison the topic tag.
- (f) When a deferral's `kb_chunk_ids` has multiple chunks with different `topics`, the bucket is determined by the FIRST chunk's first topic (deterministic via `ORDER BY chunk_index`). Document this — alternative is to fan out across topics (one deferral counts in N buckets) which inflates totals. Single-bucket assignment is simpler; revisit only if managers report missing cross-topic visibility.

### Prompt — paste after `/auto-feature `

```
Rewrite the Knowledge Gap Clusters surface on the Insights tab. Two parts: (1) fix the bucketing strategy — current strategy drops 66% of gaps and 84% of deferrals; (2) add a drill-down modal chain so cluster cards open the same eval/transcript modal stack that §5 introduces for heat-map cells. §5 MUST ship first; this build reuses its modal infra.

==== Part 1: Bucketing rewrite ====

CURRENT (broken): src/lib/queries/call-intelligence/knowledge-gap-clusters.ts forces every gap and deferral into one of 32 kb_vocab_topics values via substring matching against the curated KB_VOCAB_SYNONYMS map. Coverage: 142/422 gaps (34%), 23/147 deferrals (16%). The remaining ~66%/84% of advisor-eligible signal is invisible to managers.

REPLACE with the structured fields the upstream AI already writes:

  GAPS: group by knowledge_gaps[].expected_source truncated to first 2 path segments.
    - 388/422 gap rows (92%) have expected_source populated. Distribution:
      profile/ideal-candidate-profile  132 occurrences  13 reps
      playbook/sga-discovery           98               18
      facts/process                    31               10
      playbook/sgm-intro               26                7
      playbook/handoff                 21                5
      playbook/platform-review         21                5
      facts/compensation               14                7
      …14 more buckets…
    - Rows with null expected_source land in an "Uncategorized" bucket.

  DEFERRALS: group via kb_chunk_ids → knowledge_base_chunks.topics[].
    - Every rep_deferrals row has kb_chunk_ids (uuid[]).
    - knowledge_base_chunks has a `topics` text[] column (curated tag list, plus is_active flag).
    - For each deferral: LEFT JOIN LATERAL (SELECT topics FROM knowledge_base_chunks WHERE id = ANY(d.kb_chunk_ids) AND is_active = true AND topics IS NOT NULL AND array_length(topics, 1) > 0 ORDER BY chunk_index LIMIT 1).
    - Bucket = first topic from that lateral. Fallback when no tagged chunk: 'Uncategorized: ' || d.topic (so the raw AI topic surfaces as a longtail label).
    - Single-bucket-per-deferral by design (deterministic, no count inflation).

SQL CTE rewrite (gap_hits and deferral_hits CTEs in knowledge-gap-clusters.ts) — see insights_refinement.md §6a for the full SQL sketch. The `topics` MCP-style CTE goes away entirely. The $9::jsonb synonyms param goes away. KB_VOCAB_SYNONYMS stays in the codebase as theming data but is no longer load-bearing.

Output rows now carry richer per-row evidence for the modal:
  - evidence_text = kg.item->>'text' (gap) OR d.deferral_text (deferral — verbatim rep quote, currently unused).
  - citations = kg.item->'citations' (gap) OR jsonb_build_array(jsonb_build_object('utterance_index', d.utterance_index)) (deferral).
  - expected_source_full = kg.item->>'expected_source' (gap only, full path)
  - kb_coverage (deferral only).

Type change (src/types/call-intelligence.ts):

  export interface KnowledgeGapClusterRow {
    bucket: string;                                  // renamed from `topic`
    bucketKind: 'kb_path' | 'kb_topic' | 'uncategorized';
    totalOccurrences: number;
    gapCount: number;
    deferralCount: number;
    deferralByCoverage: { covered: number; partial: number; missing: number };
    repBreakdown: Array<{ repId: string; repName: string; gapCount: number; deferralCount: number }>;
    sampleEvalIds: string[];
    sampleEvidence: Array<{
      evaluationId: string;
      repId: string;
      repName: string;
      kind: 'gap' | 'deferral';
      text: string;
      citations: Array<{ utterance_index?: number; kb_source?: { doc_id: string; chunk_id: string; doc_title: string; drive_url: string } }>;
      expectedSource?: string;
      kbCoverage?: 'covered' | 'partial' | 'missing';
    }>;
  }

Helper signature grows:
  getKnowledgeGapClusters({ ..., mode: 'team' | 'rep_focus' = 'team' })
sampleEvalIds cap = [1:5] in team mode, [1:200] in rep_focus mode.
sampleEvidence cap = [1:5] in team mode, [1:200] in rep_focus mode.

==== Part 2: Ranking + longtail ====

ORDER BY total_occurrences DESC, bucket ASC.

Longtail collapse on the UI side: rows with total_occurrences = 1 AND bucketKind = 'uncategorized' render collapsed under an expandable "Other (N one-offs)" group at the bottom of the cluster list. Each longtail row still has working drill-down via the modal chain. No data hidden, just visually deprioritized.

==== Part 3: Modal-chain drill-down ====

Cluster cards become clickable. Reuse the modal stack from §5:
  Layer 1: Cluster-evidence modal. Trigger = cluster card click. Renders the bucket's sampleEvidence[] rows. Columns: rep_name (clickable → enter rep-focus mode), call date, kind chip (gap | deferral w/ coverage sub-chip), text preview (truncated). Whole-row click target.
  Layer 2: Eval-detail modal — same component as §5 Layer 2. Body scoped to the matched evidence (gap text + expected_source, or deferral_text + kb_chunk_ids → chunks.title list). Citation pills.
  Layer 3: Transcript modal — same as §5 Layer 3 (reuse TranscriptModal.tsx, scroll to utterance_index).

The same chain also wires to heat-map cells in rep-focus mode (§5 covered team-mode cells; this finishes the symmetry).

==== Files ====

Modified:
- src/lib/queries/call-intelligence/knowledge-gap-clusters.ts (full CTE rewrite — both gap_hits and deferral_hits)
- src/types/call-intelligence.ts (KnowledgeGapClusterRow reshape)
- src/app/api/call-intelligence/insights/clusters/route.ts (pass mode='rep_focus' through when focus_rep is set, add ?limit=full param)
- src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx (cluster card render: new label, click handler wiring to modal stack from §5, longtail collapse, ranking)

Existing modal components reused from §5:
- The cluster-evidence Layer 1 modal IS the same scaffold as §5's eval-list modal — just a different data source.
- Layer 2 and Layer 3 are identical to §5.

Optionally retire:
- KB_VOCAB_SYNONYMS map and kb-vocab-synonyms.ts → keep the file as theming data (badge colors per canonical bucket) but stop importing it in knowledge-gap-clusters.ts.

==== Acceptance ====

- (a) SUM(totalOccurrences) across all cluster rows EQUALS the total advisor-eligible (gaps + deferrals) in the date window. No data dropped. Verify with a COUNT(*) sanity probe against the unfiltered CTE at execution time.
- (b) The "Uncategorized" bucket exists when any row has no expected_source (gaps) or no tagged chunks (deferrals). Its bucketKind = 'uncategorized'.
- (c) Top bucket in last 90d is profile/ideal-candidate-profile (132 gaps, 13 reps). Verify live.
- (d) Cluster card click → Layer 1 modal opens. Row click → Layer 2. Citation pill → Layer 3 jumped to right utterance. Esc closes one layer at a time. Click-outside closes all.
- (e) In rep-focus mode, cluster list shows every bucket the focused rep contributed to (1× included). Order: most-deferred first.
- (f) Single-bucket-per-deferral assignment is deterministic (ORDER BY chunk_index LIMIT 1). Document the trade-off vs fan-out in a code comment.
- (g) knowledge_base_chunks JOIN filters is_active = true so retired KB chunks don't poison the topic tag.

==== Live data probes to run before merge ====

1. Verify chunks.topics distribution: SELECT unnest(topics) AS t, COUNT(*) FROM knowledge_base_chunks WHERE is_active=true AND topics IS NOT NULL GROUP BY t ORDER BY COUNT(*) DESC LIMIT 50. Expect a reasonable number (~10-30) of distinct curated tags.
2. Verify the lateral join produces a bucket for >70% of advisor-eligible deferrals. If coverage is poor, the fallback to 'Uncategorized: ' || d.topic absorbs the rest but the team should see the actual rate.
3. Compare bucket totals against the unfiltered ceiling to confirm 100% data surfacing.

Depends on §5 shipping first.
```

---

## Out of scope for this pass

- LLM-based topic clustering / judge — not needed; the structured fields already cover ~100% of the signal.
- Retiring `KB_VOCAB_SYNONYMS` / `kb_vocab_topics` entirely — out of scope (sales-coaching may still consume them); just stop joining against them in Dashboard's cluster query.
- Server-side caching of the new `/insights/reps` route — re-evaluate if response time on slow networks bites.
- A11y pass on the modal stack (focus trapping, Esc-stack semantics) — track separately.
