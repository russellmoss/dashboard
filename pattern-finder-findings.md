# Pattern-Finder Findings: Knowledge Gap Clusters Rewrite

## Pre-Read Confirmation

`bq-patterns.md` covers BigQuery-only patterns (DATE vs TIMESTAMP wrappers, deduplication flags, channel grouping, ARR COALESCE, SGA/SGM dual attribution, cohort vs period mode). None apply to the Neon Postgres helpers in `src/lib/queries/call-intelligence/`. No overlap; nothing to re-document.

---

## A. Postgres SQL Helper Conventions

**Pool access.** Every call-intelligence helper imports `getCoachingPool` from `@/lib/coachingDb` and calls `const pool = getCoachingPool()`. Return value is always `const { rows } = await pool.query<TypedRow>(sql, params)`. Raw `pg` / Pool — not Prisma raw.

**Param binding.** Positional `$1`, `$2`, ... `$N`. Named `@paramName` is BigQuery-only and never appears here. Params passed as `unknown[]`.

**Param comment convention.** Each helper opens with a numbered comment block:
```
// params:
//  $1 = effectiveRepIds (uuid[])
//  $2 = start (date string)
//  $3 = end (date string)
//  $4 = role ('SGA'|'SGM'|NULL when 'both')
```
Verified in `dimension-heatmap.ts`, `knowledge-gap-clusters.ts`, `insights-evals-list.ts`. The rewrite must maintain this block, updated to remove `$9`.

**Date params.** Strings (`yyyy-mm-dd`) bound as TS strings; SQL casts inline: `e.created_at >= $2::date`. Idiom is consistent across helpers.

**`dateBoundsParam` helper.** Both `knowledge-gap-clusters.ts` and `dimension-heatmap.ts` duplicate an identical local `dateBoundsParam(range)` function. `insights-evals-list.ts` has the same logic named `dateBounds`. Not shared — each helper duplicates. The rewrite should keep it local.

**`scoped_reps` CTE.** First CTE; filters `reps` to `effectiveRepIds` ∩ role ∩ pod constraints. Gap and deferral CTEs join `scoped_reps sr ON sr.id = e.rep_id`. Must be preserved identically.

**Advisor-eligible filter.** Verbatim:
```sql
(cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
```
Used identically in `knowledge-gap-clusters.ts`, `dimension-heatmap.ts`, `insights-evals-list.ts`.

**Nullable param pattern.** Optional filters: `$N::type IS NULL OR field = $N`. Boolean flags: `$6::bool = true`. NULL = "no filter".

**Row return.** Raw `pg` Pool. Numeric columns come back as `string` — coerce with `Number(r.field)` in `.map()`. JSONB columns come back as already-parsed JS objects — no `JSON.parse()` needed. `String | null` columns are nullable as-is.

**Array slice cap.** Used exactly once in repo, in existing `knowledge-gap-clusters.ts`:
```sql
(array_agg(DISTINCT evaluation_id ORDER BY evaluation_id))[1:5] AS sample_eval_ids
```
No other helper uses this. The rewrite extends to `[1:5]` (team) / `[1:200]` (rep-focus). The cap LITERAL must be injected into the SQL string (not bound) because Postgres does not accept bound params for array slice bounds.

---

## B. JSONB Extraction Patterns

**`jsonb_array_elements` form.** Used as `CROSS JOIN jsonb_array_elements(e.knowledge_gaps) AS kg(item)` in the existing `gap_hits` CTE. Alias form `AS alias(item)` is the established pattern.

**`jsonb_build_object`.** Used in `knowledge-gap-clusters.ts` for `reps_arr` aggregation:
```sql
json_agg(DISTINCT jsonb_build_object('repId', rep_id, 'repName', rep_name)
         ORDER BY jsonb_build_object('repId', rep_id, 'repName', rep_name)) AS reps_arr
```
Uses `json_agg` (not `jsonb_agg`) with `DISTINCT` + `ORDER BY`. The spec's `jsonb_build_array(jsonb_build_object('utterance_index', d.utterance_index))` follows this idiom.

**`jsonb_agg`.** Not used in any existing call-intelligence helper. Use `json_agg(DISTINCT ... ORDER BY ...)` instead if aggregation is needed.

**Output JSONB columns.** Returned by the pg driver as parsed JS — no `JSON.parse()` in `.map()`.

---

## C. LATERAL JOIN Patterns

**One existing LATERAL in repo:** `src/lib/queries/record-notes.ts:256-262`:
```sql
LEFT JOIN LATERAL (
  SELECT ai_original
  FROM evaluations ev
  WHERE ev.call_note_id = cn.id
  ORDER BY ev.created_at DESC
  LIMIT 1
) e ON TRUE
```
Exactly the shape the spec requires. **Use `ON TRUE` (uppercase)** to match this precedent.

**No LATERAL in `src/lib/queries/call-intelligence/`.** The deferral CTE is the first.

---

## D. `KnowledgeGapClusterRow` Consumer Patterns

1. `src/types/call-intelligence.ts` — definition, `topic: string`.
2. `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx`:
   - Line 631: `key={c.topic}` → `key={c.bucket}`
   - Line 634: `{humanizeKey(c.topic)}` → new helper needed (humanizeKey splits on `_` only; can't handle `/` paths)
3. `src/app/api/call-intelligence/insights/clusters/route.ts` — pass-through, no field-level access.
4. `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts:188` — producer `.map()`, construction site.
5. `src/lib/queries/call-intelligence/__tests__/knowledge-gap-clusters.test.ts:45` — asserts `params[8]` is synonyms JSON. **Will break** after `$9` removal.

`sampleEvalIds` is declared on the type but never rendered in JSX. Backward-compat field only.

**No CSV/export path touches `KnowledgeGapClusterRow`.** Confirmed: no `ExportButton` / `ExportMenu` in `InsightsTab.tsx` or call-intelligence components. No mapping to update.

---

## E. Modal Scaffold Patterns

**Z-stack convention:** Layer 1 = `z-50`, Layer 2 = `z-[60]`, Layer 3 = `z-[70]`.

**InsightsEvalListModal.tsx** (Layer 1, shipped):
- `fixed inset-0 z-50 flex md:items-center md:justify-center`
- `bg-black/40` click-outside layer
- Panel: `relative bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden w-full h-full md:h-auto md:max-w-4xl md:mx-4 md:max-h-[90vh] md:rounded-lg`
- `role="dialog" aria-modal="true" aria-labelledby="..."` + `aria-hidden={ariaHidden}` prop
- No internal Esc handler — owned by `InsightsTab.tsx`
- Focus: `setTimeout(() => closeButtonRef.current?.focus(), 0)` when `!ariaHidden`

**InsightsEvalDetailModal.tsx** (Layer 2, shipped): `z-[60]`. Same scaffold conventions. Topic-drill section scaffolded (deferral-only) at lines 269-300 with comment "reserved for cluster ship".

**TranscriptModal.tsx** (Layer 3, shipped): `zClassName` prop (called as `z-[70]`). `disableOwnEscHandler` prop. Click-outside on outer div; inner `e.stopPropagation()`.

**ConfirmSubmitModal.tsx / RejectReasonModal.tsx**: smaller modal scaffolds. Not directly reused but pattern-aligned.

No `createPortal`. All modals render in their natural DOM position inside `InsightsTab` return.

---

## F. URL State Patterns

**`focus_rep` is URL state** (`useSearchParams`, `router.replace` via `updateUrl` helper).
**Modal stack is React state**, not URL (`useState<InsightsModalStackLayer[]>([])` at `InsightsTab.tsx:208`).

**URL hash sync for browser-back.** `InsightsTab.tsx:261-280` pushes `window.history.pushState(...)` with a hash (`#modal=list`, `#modal=detail&eval=...`) on each stack change, with a `popstate` listener at 282-290 to pop. The cluster-evidence modal must add a new hash entry (e.g., `#modal=cluster&bucket=...`).

---

## G. Sort/Longtail UI Patterns

**No `<details>/<summary>` pattern for data lists** in the dashboard.

**Best precedent: `expandedGroups` toggle in `InsightsTab.tsx:200-205, 548-553`:**
```tsx
const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
<button onClick={() => toggleGroup(group.key)} aria-expanded={expanded}>
  {expanded ? 'Hide per-pod breakdown ▴' : 'Show per-pod breakdown ▾'}
</button>
{canExpand && expanded && <div className="mt-4 pl-4 border-l-2 ...">...</div>}
```

**Recommendation:** `useState<boolean>(false)` (`longtailExpanded`), inline button with `▴`/`▾` chevron matching the pod-expand visual style. No `<details>` element.

---

## H. Export Integrity

**No export for cluster rows today.** No `ExportButton`/`ExportMenu` in `InsightsTab.tsx`. `topic` → `bucket` rename has zero export impact.

---

## I. NULL Handling and Date Rendering

**Pattern across call-intelligence components:** local inline `formatDate` helper, `new Date(ts).toLocaleString()` or `.toLocaleDateString()`, `'—'` for null. Duplicated per-component (no shared util).

- `InsightsEvalListModal.tsx:176`: `new Date(r.call_started_at).toLocaleDateString()` (date-only)
- `InsightsEvalDetailModal.tsx:38-41`: local `formatDate(ts: string | null)` for full date+time
- `EvalDetailClient.tsx:128-132`: identical pattern
- `QueueTab.tsx:43-54`: two helpers — `formatDate` and `formatDateOnly`

**Do NOT use `extractDate()` / `extractDateValue()`** — those are BigQuery helpers.

**Nullable conventions in `call-intelligence.ts`:**
- DB-sourced fields that can be NULL: `string | null` (e.g., `call_started_at: string | null`)
- Application-level optional: `?` (e.g., `expectedSource?: string`, `kbCoverage?: 'covered' | 'partial' | 'missing'`)

For `sampleEvidence[i]`: `text: string` (required), `citations: Citation[]` (required, empty array when none), `expectedSource?: string` (gap-only), `kbCoverage?: ...` (deferral-only).

---

## Conventions Checklist (the new code MUST follow)

**SQL helper:**
- Positional `$N` only; no named params
- Param comment block at top
- `$N::date` casts; pre-cast TS strings
- Keep `dateBoundsParam` local
- `scoped_reps` CTE first; join `sr ON sr.id = e.rep_id`
- Advisor-eligible: `(cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')` verbatim
- Optional filters: `$N::type IS NULL OR field = $N`
- `CROSS JOIN jsonb_array_elements(...) AS alias(item)` for gap extraction
- `LEFT JOIN LATERAL (...) kbc ON TRUE` for chunks (uppercase TRUE)
- Slice cap: inject literal into SQL string (5 in team, 200 in rep-focus)
- `json_agg(DISTINCT jsonb_build_object(...) ORDER BY jsonb_build_object(...))` for rep breakdown dedup
- Numerics → `Number(r.field)`; JSONB → already parsed

**Type:**
- `topic` → `bucket`; update producer and all consumer sites
- `humanizeKey` won't handle `/` paths — write a new display helper that splits on `/` and capitalizes each segment, joining with ` › `
- `sampleEvidence[]`: required `text` and `citations`; optional `?` for `expectedSource` and `kbCoverage`

**UI:**
- Longtail collapse: `useState<boolean>(false)`, button with `▴`/`▾`, match `toggleGroup` visual
- Cluster card click → push `{ kind: 'cluster', payload: ... }` onto `modalStack`
- New cluster-evidence modal at `z-50` (Layer 1 variant)
- Add `#modal=cluster&bucket=...` hash sync to the existing browser-back block
- No `<details>`

**Test file:**
- Remove `$9` synonyms assertion
- Keep `$8` (coverage filter) assertion if still relevant
- Add an assertion that `LEFT JOIN LATERAL` appears in the new SQL

**Cluster-evidence modal date display:**
- Local `formatDate` helper, `new Date(ts).toLocaleDateString()`, `'—'` for null
- Do NOT import BigQuery date helpers

---

## Key files for the implementation

| File | Role |
|---|---|
| `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts` | Full CTE rewrite |
| `src/types/call-intelligence.ts` | `KnowledgeGapClusterRow` reshape + `InsightsModalStackLayer` extension |
| `src/app/api/call-intelligence/insights/clusters/route.ts` | Add `mode` + `?limit=full` |
| `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx` | Click wiring, longtail, new display helper |
| `src/components/call-intelligence/InsightsEvalListModal.tsx` | Either extend or create variant for cluster-evidence |
| `src/components/call-intelligence/InsightsEvalDetailModal.tsx` | Add gap-evidence render path (the existing topic-drill is deferral-only) |
| `src/lib/queries/call-intelligence/__tests__/knowledge-gap-clusters.test.ts` | Update param-index assertions |
| `src/lib/queries/record-notes.ts:256` | Reference only — LATERAL precedent |
