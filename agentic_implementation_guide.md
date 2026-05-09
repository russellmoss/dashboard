# Agentic Implementation Guide: Step 5b-1-UI — Eval Detail Audit + Calibration Surface

## Reference Documents

All decisions in this guide are based on the completed exploration files in the project root:
- `exploration-results.md` — synthesized summary
- `code-inspector-findings.md` — files, types, construction sites, line refs
- `data-verifier-findings.md` — coaching Postgres schema, error contracts
- `pattern-finder-findings.md` — implementation patterns to mirror

These are the single source of truth. Re-read the relevant section before each phase.

---

## Feature Summary

| Capability | Scope | Files affected |
|---|---|---|
| Citation pills (transcript / KB / combined) inline in eval narrative | Render only — `ai_original` already carries citations | `CitationPill`, `EvalDetailClient`, `citation-helpers` |
| KB side panel + "Refine this content" → modal | Augment KB chunks with `owner` + `chunk_text` from `knowledge_base_chunks` | API GET route, new query, panel + modal |
| Manager inline edit (dimension scores, narrative, list fields, coaching nudge) | OCC via `expected_edit_version`; 409 → reload banner; 404 → auto-route to queue | 3 new InlineEdit\* components, edit API route |
| Utterance-level comments | Selectable text → composer; pinned cards; delete (own or admin) | Comment composer + card, 2 new API routes |
| Audit toggle ("show original AI output") | Single canonical view OFF; two-column comparison ON; version-aware on `ai_original_schema_version` v2-v5 | `AuditToggle`, defensive readers |
| `/dashboard/call-intelligence/my-refinements` sub-route | Per-user content-refinement list (table) | New page + table component + GET API route |
| 5 new bridge methods | `editEvaluation`, `createTranscriptComment`, `deleteTranscriptComment`, `submitContentRefinement`, `listMyContentRefinements` | `sales-coaching-client/index.ts`, `errors.ts`, `schemas.ts` |

**Two new error classes:** `EvaluationNotFoundError` (404), `ContentRefinementDuplicateError` (409 `content_refinement_duplicate`).

**One new schema:** `DeleteTranscriptCommentResponse` = `{ ok: true }`.

**Bridge infrastructure:** `bridgeRequest` extended to support `GET` + `DELETE` (skip body + `Content-Type` for those methods).

---

## Schema Reference

This feature touches **only** the Neon coaching Postgres database (via `src/lib/coachingDb.ts`).
**No BigQuery views are read or modified.** Skip `schema-context` MCP — it's funnel-master scope.

For coaching DB schema, the authoritative sources are:
1. `data-verifier-findings.md` Section 2 (table + column definitions)
2. The sales-coaching repo at `C:/Users/russe/Documents/sales-coaching/` (migration files, especially 001/004/011/018/024/028/036/037)
3. `src/lib/sales-coaching-client/schemas.ts` (Zod mirror — request/response contracts)

Key facts (do NOT re-derive):
- `evaluations.ai_original` is **immutable** (DB trigger `trg_prevent_ai_original_update`)
- `transcript_comments` has hard-delete via SQL predicate (no soft delete)
- `content_refinement_requests.idx_content_refinement_open_unique` is the partial-UNIQUE that fires SQLSTATE 23505 → 409 `content_refinement_duplicate`
- `call_transcripts` is keyed on `call_note_id` (renamed from `evaluation_transcripts` in migration 004)
- `ai_original_schema_version` has values 2, 3, 4, 5 in production (5 known v2 rows)

---

## Construction Site Inventory

`EvaluationDetail` has TWO construction sites in this feature (council fix B1.12 — corrects the prior "one site" claim):

1. **DB helper merge** at `src/lib/queries/call-intelligence-evaluations.ts:~282` — spreads `RawDetailRow` and coerces `overall_score` from string to number (existing pattern; Phase 4 just adds new columns to the SELECT, the spread carries them).
2. **API route merge** at `src/app/api/call-intelligence/evaluations/[id]/route.ts` — spreads the helper's return and adds `transcript_comments`, `chunk_lookup`, and `coaching_nudge_effective` from independent queries (Phase 6.1).

Plus one inherited construction-site-of-sorts:
3. **Client-side cast** at `EvalDetailClient.tsx:~175` — `setDetail(json as EvaluationDetail)`. Pre-existing from Step 5a-UI; not validated at runtime. We don't add Zod parsing in 5b-1 (deferred — see Bucket 3 / B3.9). New fields will type-check at compile time but trust the API's JSON shape at runtime.

No `DrillDownRecord` / `DetailRecord` / `ExploreResult` sites exist — coaching data is outside the funnel-master world.

`EvaluationQueueRow` has its own explicit return literal but is NOT modified by this step.

---

## Architecture Rules

- **Coaching DB queries** — direct `pg.Pool` via `getCoachingPool()` from `src/lib/coachingDb.ts`. Use positional `$1/$2` parameters. Validate UUIDs with `UUID_RE` before hitting the pool. Coerce NUMERIC columns with `Number()`.
- **Bridge calls** — every Dashboard API route handler that mutates coaching state calls `salesCoachingClient.*`. The `import 'server-only'` guard at `src/lib/sales-coaching-client/index.ts:2` means client components must NEVER import the client directly.
- **Never use `dangerouslySetInnerHTML`** — all transcript text + comment text must render via JSX children (auto-escaped). Audit `5a-UI` confirms this is the existing convention.
- **Dark mode** — every Tremor `<Card>` carries `dark:bg-gray-800 dark:border-gray-700`. Every text class has a `dark:text-*` variant. Pattern is uniform across `EvalDetailClient.tsx`, `QueueTab.tsx`, `AdminRefinementsTab.tsx`.
- **Inline-banner feedback (NOT toasts)** — no toast library is installed. The 6 spec "toast" strings render as inline `<div>`s using the existing pattern at `EvalDetailClient.tsx:244` (red-50/red-900/20) and `:388` (amber for OCC). This is the explicit guide default; revisit in Phase 4 triage if council disagrees.
- **OCC** — never auto-reload on 409. Set conflict state, render an inline banner with a Reload button, freeze the form until the user acts. (Pattern I.)
- **Authority-lost vs stale-version disambiguation** — branch on `error.message.includes('Authority lost')`. Authority-lost auto-routes to queue; stale-version blocks until manual reload.
- **Write-merge imports** — when adding to an existing file, add new imports to the existing import statement from the same module. Never add a second import.
- **No new packages** — do NOT add `sonner`, `@radix-ui/*`, or any other dependency in this step. (See Bucket 2 toast question — defer to council.)

---

## Pre-Flight Checklist

Run these in order. STOP if any fails.

```bash
# 1. Confirm we're on main with the expected baseline
git status --short
git log -1 --oneline   # should show 832e3dc Step 5a-UI commit (or successor)

# 2. Confirm the byte-for-byte schema mirror is uncommitted (per the spec's pre-req)
git diff --stat src/lib/sales-coaching-client/schemas.ts

# 3. Baseline build — must pass cleanly with the uncommitted schemas.ts
npm run build 2>&1 | tail -50
```

**Expected:**
- `git status` shows `M src/lib/sales-coaching-client/schemas.ts` (+ the misc unrelated M's already on disk)
- `git log` shows the 5a-UI commit on `main`
- `npm run build` exits 0 with **zero TS errors**

If pre-existing build errors exist, **STOP** and tell the user. Do not proceed with a broken baseline.

**STOP AND REPORT:**
- "Pre-flight clean: build passes; `schemas.ts` byte-for-byte mirror is staged-as-uncommitted as expected."
- "Ready to proceed to Phase 1 (Bridge Infrastructure)?"

---

# PHASE 1: BRIDGE INFRASTRUCTURE

## Context

The Dashboard's `salesCoachingClient` is missing the plumbing for 5 new bridge endpoints:
- Two new typed error classes (404 + 409 `content_refinement_duplicate`)
- One new schema (`DeleteTranscriptCommentResponse`)
- `GET`/`DELETE` method support in `bridgeRequest`
- Dispatch arms for the new error codes
- A CI step asserting byte-equality of the Zod mirror (acceptance test `m`)

This phase lays the foundation. No UI code yet.

## Step 1.1: Commit the existing byte-for-byte schemas.ts mirror

The mirror is already correct in the working tree. Stage it on its own to avoid pulling in unrelated WIP files.

```bash
git add src/lib/sales-coaching-client/schemas.ts
```

Do NOT commit yet — Step 1.2 adds one missing schema to the same file, then we commit both changes together.

## Step 1.2: Add `DeleteTranscriptCommentResponse` schema

**File**: `src/lib/sales-coaching-client/schemas.ts`

Locate the inferred-types block at the bottom (lines 492-519 in current file). Add the new schema near `MyContentRefinementsResponse` (line 443) — group by feature, not alphabetically:

```ts
export const DeleteTranscriptCommentResponse = z.object({ ok: z.literal(true) }).strict();
export type DeleteTranscriptCommentResponseT = z.infer<typeof DeleteTranscriptCommentResponse>;
```

This intentionally diverges from byte-equality with sales-coaching's `dashboard-api/schemas.ts` ONLY if the schema is also missing on the server side. Verify by `grep DeleteTranscriptCommentResponse C:/Users/russe/Documents/sales-coaching/src/lib/dashboard-api/schemas.ts` — if the server has it, mirror exactly; if not, we add it on both sides (reach out for sales-coaching coordination — note this in the gate report).

## Step 1.3: Add error classes

**File**: `src/lib/sales-coaching-client/errors.ts`

After the existing `ContentRefinementAlreadyResolvedError` class, append:

```ts
export class EvaluationNotFoundError extends BridgeError {
  constructor(message: string, status = 404, requestId?: string) {
    super(message, status, requestId);
    this.name = 'EvaluationNotFoundError';
  }
}

export class ContentRefinementDuplicateError extends BridgeError {
  constructor(message: string, status = 409, requestId?: string) {
    super(message, status, requestId);
    this.name = 'ContentRefinementDuplicateError';
  }
}
```

Make sure the existing `BridgeError` base class is the only superclass referenced — do not introduce intermediate classes.

## Step 1.4: Extend `bridgeRequest` to support GET + DELETE

**File**: `src/lib/sales-coaching-client/index.ts`

The current `PostOptions.method` (line 49) is `'POST' | 'PATCH'`. Change to `'GET' | 'POST' | 'PATCH' | 'DELETE'`.

In the `bridgeRequest` body, wrap body serialization + `Content-Type: application/json` so they only apply to `POST` and `PATCH`:

```ts
const isBodyMethod = options.method === 'POST' || options.method === 'PATCH';

const headers: Record<string, string> = {
  Authorization: `Bearer ${token}`,
};
if (isBodyMethod) headers['Content-Type'] = 'application/json';

const init: RequestInit = {
  method: options.method,
  headers,
};
if (isBodyMethod && options.body !== undefined) {
  // existing requestSchema parse + JSON.stringify
  init.body = JSON.stringify(options.requestSchema!.parse(options.body));
}
```

For `GET` and `DELETE`, the `requestSchema` and `body` properties are unused but the `responseSchema` is still required.

## Step 1.5: Add 404 + 409 dispatch arms in `bridgeRequest`

**File**: `src/lib/sales-coaching-client/index.ts`

After the existing `if (status === 401 || status === 403)` block, add a **path-scoped** 404 dispatch (so non-evaluation 404s like `DELETE /transcript-comments/:id` fall through to `BridgeTransportError` correctly):

```ts
if (status === 404 && /\/evaluations\/[^/]+/.test(options.path)) {
  throw new EvaluationNotFoundError(errMsg ?? 'Evaluation not found', 404, requestId);
}
```

The path filter matches `/api/dashboard/evaluations/:id/edit`, `/api/dashboard/evaluations/:id/transcript-comments`, and `/api/dashboard/content-refinements` (which embeds `evaluation_id` in the body — the 404 from sales-coaching when the eval is tombstoned still surfaces here, but path-wise it matches because the route NOT being `/evaluations/:id` means it falls through; the parent eval tombstone still raises 404 from sales-coaching but with a `evaluation_not_found` error code we can match instead — see below). Add a fallback by error code so `content-refinements` also routes correctly:

```ts
if (status === 404 && errCode === 'evaluation_not_found') {
  throw new EvaluationNotFoundError(errMsg ?? 'Evaluation not found', 404, requestId);
}
```

(The two arms together cover both "the URL targets an eval" AND "the upstream told us the parent eval is gone".)

Inside the existing `if (status === 409)` block, after the existing `evaluation_conflict` / `deactivate_blocked` / `content_refinement_already_resolved` cases, add:

```ts
if (errCode === 'content_refinement_duplicate') {
  throw new ContentRefinementDuplicateError(
    errMsg ?? 'You already have an open suggestion on this chunk.',
    409,
    requestId,
  );
}
```

Update the imports at the top of the file to merge in the two new classes:

```ts
import {
  BridgeAuthError,
  BridgeError,
  BridgeTransportError,
  BridgeValidationError,
  ContentRefinementAlreadyResolvedError,
  ContentRefinementDuplicateError,   // NEW
  DeactivateBlockedError,
  EvaluationConflictError,
  EvaluationNotFoundError,           // NEW
} from './errors';
```

## Step 1.6: Schema mirror byte-equality CI step

**Already done outside this guide** — the script + skill + cross-repo CLAUDE.md mentions were planted as part of the /auto-feature triage (Bucket 2 Q4 resolution). What this step needs to do:

1. **Confirm `scripts/check-schema-mirror.cjs` already exists**:
   ```bash
   ls -la scripts/check-schema-mirror.cjs
   head -5 scripts/check-schema-mirror.cjs
   ```
   It uses GH raw (Option 3) with optional `SALES_COACHING_SCHEMAS_PATH` for local sibling-repo dev. Auth via `GH_TOKEN` / `GITHUB_TOKEN`.

2. **Confirm `.claude/skills/sync-bridge-schema/SKILL.md` already exists**:
   ```bash
   ls -la .claude/skills/sync-bridge-schema/SKILL.md
   ```

3. **Add `check:schema-mirror` to `package.json` `scripts`** if not already present:
   ```bash
   grep -E '"check:schema-mirror"' package.json || echo "needs adding"
   ```
   If missing, add to the `scripts` block:
   ```json
   "check:schema-mirror": "node scripts/check-schema-mirror.cjs"
   ```

4. **Run it once locally** (use the sibling-repo override for speed):
   ```bash
   SALES_COACHING_SCHEMAS_PATH=C:/Users/russe/Documents/sales-coaching/src/lib/dashboard-api/schemas.ts \
     npm run check:schema-mirror
   ```
   Expected: `Schema mirror byte-equal with russellmoss/sales-coaching@main:src/lib/dashboard-api/schemas.ts ✓` (provided the working-tree schemas.ts matches sales-coaching's main).

5. **Wire to CI** — add a step in `.github/workflows/ci.yml` (or wherever the existing build workflow lives) AFTER `npm ci`:
   ```yaml
   - name: Check sales-coaching schema mirror
     run: npm run check:schema-mirror
     env:
       GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```
   `secrets.GITHUB_TOKEN` works if sales-coaching is in the same org with workflow permissions; otherwise use a PAT with `repo:read` scope and store as `secrets.SALES_COACHING_RO_PAT`.

**Do NOT wire to pre-commit hook** — leave the check at CI granularity. Pre-commit drift detection would flag drift on every commit including unrelated WIP, which is noise.

## PHASE 1 — VALIDATION GATE

```bash
# 1. Type-check the bridge module in isolation
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "sales-coaching-client|errors\\.ts" | head -30

# 2. Confirm both new error classes are exported
grep -E "^export class (EvaluationNotFoundError|ContentRefinementDuplicateError)" src/lib/sales-coaching-client/errors.ts

# 3. Confirm the new schema + type are exported
grep -E "^export (const|type) DeleteTranscriptCommentResponse" src/lib/sales-coaching-client/schemas.ts

# 4. Confirm GET + DELETE in the method union
grep -E "method.*'GET'.*'POST'.*'PATCH'.*'DELETE'" src/lib/sales-coaching-client/index.ts

# 5. Confirm 404 + 409 dispatch arms exist
grep -nE "(EvaluationNotFoundError|content_refinement_duplicate)" src/lib/sales-coaching-client/index.ts

# 6. Mirror script runnable
node scripts/check-schema-mirror.cjs || true   # may fail without sibling repo — informational

# 7. Build still passes (NO new methods on salesCoachingClient yet — those land in Phase 5)
npm run build 2>&1 | tail -20
```

**Expected:**
- `tsc` zero errors in `sales-coaching-client/*`
- 2 lines from grep (#2)
- 2 lines from grep (#3) — `const` + `type`
- 1 line from grep (#4)
- ≥3 lines from grep (#5) — import + 404 throw + 409 case
- Build green

**STOP AND REPORT:**
- "Phase 1 done — bridge infra ready. New error classes + schema + GET/DELETE support in place."
- "Build green; no `salesCoachingClient` methods added yet (Phase 5)."
- "Schema mirror script exposed but not wired to CI."
- "Ready to proceed to Phase 2 (Utilities)?"

---

# PHASE 2: UTILITIES

## Context

One pure helper. The citation helper that imports the `Citation` type was MOVED to Phase 3 (after the type lands) so the Phase 2 gate stays clean. (Council fix B1.2.)

## Step 2.1: Add `formatRelativeTimestamp` to freshness-helpers

**File**: `src/lib/utils/freshness-helpers.ts`

The existing `formatRelativeTime(minutes)` takes pre-computed minutes; we need an ISO-string variant for transcript / comment / "Last edited" timestamps. Add below the existing helpers (do NOT modify them):

```ts
/**
 * Relative time from an ISO-8601 timestamp ("2 min ago", "3 hr ago", "yesterday").
 * Wraps the existing `formatRelativeTime(minutes)` so call sites don't redo the math.
 */
export function formatRelativeTimestamp(isoTs: string | null | undefined): string {
  if (!isoTs) return '—';
  const ts = new Date(isoTs).getTime();
  if (Number.isNaN(ts)) return '—';
  const minutesAgo = Math.max(0, (Date.now() - ts) / 60_000);
  return formatRelativeTime(minutesAgo);
}
```

## PHASE 2 — VALIDATION GATE

```bash
# 1. Build is still green (no broken imports)
npm run build 2>&1 | grep -c "error TS" || echo "0 errors"

# 2. Helper exported
grep -E "^export function formatRelativeTimestamp" src/lib/utils/freshness-helpers.ts
```

**Expected:**
- Build green (0 errors).
- 1 grep match.

**STOP AND REPORT:**
- "Phase 2 done — `formatRelativeTimestamp` planted. Build green."
- "Ready to proceed to Phase 3 (Types — INTENTIONALLY breaks build)?"

---

# PHASE 3: TYPE DEFINITIONS — INTENTIONALLY BREAKS BUILD

## Context

This phase expands `EvaluationDetail` (preserving the existing Step 5a-UI fields), adds 4 new types, and creates `citation-helpers.ts` (which imports `Citation` from the new types). Build errors after this phase are EXPECTED and represent the construction-site checklist that Phases 4-7 chip away at. Track the error count.

## Step 3.1: Expand `EvaluationDetail` and add new types

**File**: `src/types/call-intelligence.ts`

**Read the current `EvaluationDetail` first.** As of Step 5a-UI it already has: `evaluation_id`, `call_note_id`, `call_started_at`, `rep_id`, `rep_full_name`, `assigned_manager_id_snapshot`, `assigned_manager_full_name`, `status`, `edit_version`, `scheduled_reveal_at`, `revealed_at`, `reveal_override_action`, `reveal_override_delay_minutes`, `reveal_policy_snapshot`, `reveal_delay_minutes_snapshot`, `reveal_reminder_minutes_snapshot`, `overall_score`, `ai_original`, `ai_original_schema_version` (number | null), `call_summary_markdown`, `transcript`, `created_at`, `updated_at`. **Don't redefine those.**

Add ONLY these new fields to the interface (council fix B1.4):

```ts
export interface EvaluationDetail {
  // ... existing fields (DO NOT modify them — keep evaluation_id, edit_version,
  //                     ai_original, ai_original_schema_version: number | null,
  //                     transcript, etc. exactly as they are)

  // NEW (Step 5b-1) — append to the interface:
  dimension_scores: Record<string, { score: number; rationale?: string }> | null;
  narrative: string | null;
  strengths: Array<{ text: string; citations?: Citation[] }>;
  weaknesses: Array<{ text: string; citations?: Citation[] }>;
  knowledge_gaps: Array<{ text: string; citations?: Citation[]; expected_source?: string }>;
  compliance_flags: Array<{ text: string; citations?: Citation[] }>;
  additional_observations: Array<{ text: string; citations?: Citation[] }>;
  coaching_nudge: { text: string; citations?: Citation[] } | null;
  /** COALESCE(canonical, ai_original.coachingNudge) — computed in API route for pre-024 evals. */
  coaching_nudge_effective: { text: string; citations?: Citation[] } | null;
  manager_edited_at: string | null;
  manager_edited_by: string | null;
  manager_edited_by_name: string | null;
  /** false when the editor's `reps.is_active` is false — UI renders "(inactive)" suffix. */
  manager_edited_by_active: boolean | null;
  transcript_comments: TranscriptCommentRow[];
  chunk_lookup: Record<string, KbChunkAugmentation>;
}
```

`ai_original_schema_version` stays `number | null` (council fix B1.3 — don't widen the existing nullable type).

Append below the `EvaluationDetail` interface:

```ts
export interface TranscriptCommentRow {
  id: string;
  evaluation_id: string;
  utterance_index: number;
  author_id: string;
  author_full_name: string | null;
  author_role: 'manager' | 'rep' | 'admin';
  text: string;
  created_at: string;
}

export interface Citation {
  utterance_index?: number;
  kb_source?: {
    chunk_id: string;
    doc_id: string;
    drive_url: string;
    doc_title: string;
  };
}

export interface KbChunkAugmentation {
  owner: string;
  chunk_text: string;
}

export interface TranscriptUtterance {
  utterance_index: number;
  speaker: 'rep' | 'advisor' | 'unknown';
  text: string;
  start_ms?: number;
  end_ms?: number;
  timestamp?: string;
}
```

## Step 3.2: Create `citation-helpers.ts`

**File**: `src/components/call-intelligence/citation-helpers.ts` (new directory + file — moved here from Phase 2 per council fix B1.2)

```ts
import type { Citation } from '@/types/call-intelligence';

/**
 * Defensive citation extractor. ai_original shape varies by version (v2-v5 in prod);
 * each field independently may be `string[]` (v2) OR `Array<{text, citations}>` (v3+).
 * Always returns `{text, citations}` shape; missing citations → empty array.
 */
export function readCitedItems(
  raw: unknown,
): Array<{ text: string; citations: Citation[]; expected_source?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return { text: item, citations: [] as Citation[] };
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const text = typeof obj.text === 'string' ? obj.text : '';
        const citations = Array.isArray(obj.citations) ? (obj.citations as Citation[]) : [];
        const expected_source = typeof obj.expected_source === 'string' ? obj.expected_source : undefined;
        return { text, citations, expected_source };
      }
      return null;
    })
    .filter((x): x is { text: string; citations: Citation[]; expected_source?: string } => x !== null && x.text !== '');
}

/**
 * v2-v5 schema field availability map. Used by AuditToggle and the canonical
 * EvalDetailClient renderer to hide unavailable sections rather than render
 * empty boxes (council fix B1.15).
 */
export function isFieldSupportedByAiOriginalVersion(
  version: number | null,
  field: 'coachingNudge' | 'additionalObservations' | 'repDeferrals',
): boolean {
  if (version === null) return false;
  if (field === 'coachingNudge') return version >= 3;
  if (field === 'additionalObservations') return version >= 4;
  if (field === 'repDeferrals') return version >= 5;
  return true;
}

/**
 * Pre-migration-024 fallback: canonical `evaluations.coaching_nudge` is NULL for
 * older rows. Read from `ai_original.coachingNudge` (immutable). Used in the
 * API route handler to compute `coaching_nudge_effective`.
 */
export function readAiOriginalCoachingNudge(
  aiOriginal: unknown,
): { text: string; citations?: Citation[] } | null {
  if (!aiOriginal || typeof aiOriginal !== 'object') return null;
  const cn = (aiOriginal as Record<string, unknown>).coachingNudge;
  if (!cn || typeof cn !== 'object') return null;
  const obj = cn as Record<string, unknown>;
  const text = typeof obj.text === 'string' ? obj.text : null;
  if (!text) return null;
  const citations = Array.isArray(obj.citations) ? (obj.citations as Citation[]) : undefined;
  return citations ? { text, citations } : { text };
}
```

## Step 3.3: Confirm the build break and count errors

```bash
npm run build 2>&1 | tee /tmp/phase3-errors.log | tail -50
```

Then count + bucket the errors:

```bash
grep -E "error TS" /tmp/phase3-errors.log | wc -l
grep -E "error TS" /tmp/phase3-errors.log | sed 's/(.*//' | sort | uniq -c | sort -rn | head -20
```

**Expected**: errors in roughly these locations (will guide Phases 4–7):
- `src/lib/queries/call-intelligence-evaluations.ts` — `RawDetailRow` no longer matches `EvaluationDetail` after expansion (Phase 4 fixes)
- `src/app/api/call-intelligence/evaluations/[id]/route.ts` — return shape missing new fields (Phase 6 fixes)
- `src/components/call-intelligence/citation-helpers.ts` — compiles cleanly (the `Citation` type is now in place)

**Record the error count.** It will decrease through Phases 4–7 and must reach zero before Phase 7.5.

## PHASE 3 — VALIDATION GATE

```bash
# 1. Build IS expected to fail
npm run build 2>&1 | grep -c "error TS" || echo "0 errors"

# 2. The new types are exported
grep -E "^export interface (TranscriptCommentRow|Citation|KbChunkAugmentation|TranscriptUtterance)" \
  src/types/call-intelligence.ts

# 3. citation-helpers should now compile cleanly (its only failure was the missing Citation type)
npx tsc --noEmit 2>&1 | grep "citation-helpers" || echo "citation-helpers OK"

# 4. Confirm new fields appear in EvaluationDetail
grep -E "(transcript_comments|chunk_lookup|manager_edited_by_name)" src/types/call-intelligence.ts
```

**Expected:**
- Non-zero error count (record it; we'll watch it shrink)
- 4 lines from grep (#2)
- "citation-helpers OK"
- ≥3 lines from grep (#4)

**STOP AND REPORT:**
- "Phase 3 done — types expanded; build broke as expected."
- "Error count: **N** errors. Bucketed by file: [brief list]."
- "These errors are the construction-site checklist for Phases 4-7."
- "Ready to proceed to Phase 4 (Query layer)?"

---

# PHASE 4: QUERY LAYER

## Context

Three jobs:
1. Rewrite `getEvaluationDetail()` to SELECT the 12 missing columns + `LEFT JOIN reps` for `manager_edited_by_name`.
2. Add `getTranscriptComments(evaluationId)`.
3. Add `getKbChunksByIds(chunkIds)` for the KB augmentation.

The page eats these via the API route in Phase 6; the queries themselves don't construct `EvaluationDetail` in full (the route does the merge).

## Step 4.1: Extend `getEvaluationDetail()` (do NOT rewrite from scratch)

**File**: `src/lib/queries/call-intelligence-evaluations.ts`

The current function at lines ~237-285 already has the right shape — the existing aliases (`e.id AS evaluation_id`, `cn.summary_markdown AS call_summary_markdown`, `mgr.full_name AS assigned_manager_full_name`, `e.reveal_policy_snapshot`, etc.) and JOINs (`call_notes`, two `reps`, `call_transcripts`) are all preserved by Step 5b-1.

**Council fix B1.5 — extend, don't replace.** Add new columns to the existing SELECT, add ONE new JOIN for the editor, and DO NOT touch the rep/reviewer aliases or the snapshot reveal fields.

Add these to the existing SELECT, between `e.ai_original_schema_version` and `cn.summary_markdown`:

```sql
    e.dimension_scores,
    e.narrative,
    e.strengths,
    e.weaknesses,
    e.knowledge_gaps,
    e.compliance_flags,
    e.additional_observations,
    e.coaching_nudge,
    e.manager_edited_at,
    e.manager_edited_by,
    editor.full_name                  AS manager_edited_by_name,
    editor.is_active                  AS manager_edited_by_active,
```

Add this JOIN after the existing `mgr` join, before the `call_transcripts ct` join:

```sql
    LEFT JOIN reps editor             ON editor.id      = e.manager_edited_by   AND editor.is_system = false
```

`editor.full_name` is the existing column on `reps` (not `first_name` / `last_name` — council fix B1.6). `editor.is_active` powers the "(inactive)" suffix in the UI (council fix B1.7).

Update the `RawDetailRow` interface — keep the existing one-key Omit, just widen it to also exclude the post-spread merge fields (council fix B1.8):

```ts
interface RawDetailRow extends Omit<
  EvaluationDetail,
  'overall_score' | 'transcript_comments' | 'chunk_lookup' | 'coaching_nudge_effective'
> {
  overall_score: number | string | null;
}
```

The return statement preserves the existing `overall_score` coercion and adds empty merges that the API route fills in:

```ts
return {
  ...row,
  overall_score:
    row.overall_score === null || row.overall_score === undefined
      ? null
      : Number(row.overall_score),
  transcript_comments: [],            // populated by API route (Phase 6.1)
  chunk_lookup: {},                   // populated by API route (Phase 6.1)
  coaching_nudge_effective: row.coaching_nudge,  // overwritten by API route via COALESCE
};
```

This keeps the query function focused on the eval row + transcript; comment list, KB chunk augmentation, and the COALESCE coaching_nudge fallback all happen in the API route handler in Phase 6.

## Step 4.2: Add `getTranscriptComments`

**File**: `src/lib/queries/call-intelligence-evaluations.ts` (append below `getEvaluationDetail`)

```ts
export async function getTranscriptComments(
  evaluationId: string,
): Promise<TranscriptCommentRow[]> {
  if (!UUID_RE.test(evaluationId)) return [];
  const pool = getCoachingPool();
  const sql = `
    SELECT
      tc.id,
      tc.evaluation_id,
      tc.utterance_index,
      tc.author_id,
      r.full_name        AS author_full_name,
      tc.author_role,
      tc.text,
      tc.created_at
    FROM transcript_comments tc
    LEFT JOIN reps r ON r.id = tc.author_id AND r.is_system = false
    WHERE tc.evaluation_id = $1
    ORDER BY tc.utterance_index ASC, tc.created_at ASC
  `;
  const { rows } = await pool.query<TranscriptCommentRow>(sql, [evaluationId]);
  return rows;
}
```

`r.full_name` is the canonical column (council fix B1.6). When `r.is_system = true` or the row doesn't exist, the LEFT JOIN returns null and the UI falls back to a role label.

Add the import for `TranscriptCommentRow` to the existing types import at the top of the file.

## Step 4.3: Add `getKbChunksByIds`

**File**: `src/lib/queries/call-intelligence-evaluations.ts` (append)

```ts
export async function getKbChunksByIds(
  chunkIds: string[],
): Promise<Record<string, { owner: string; chunk_text: string }>> {
  if (chunkIds.length === 0) return {};
  const validIds = chunkIds.filter((id) => UUID_RE.test(id));
  if (validIds.length === 0) return {};

  const pool = getCoachingPool();
  const sql = `
    SELECT chunk_id, owner, chunk_text
    FROM knowledge_base_chunks
    WHERE chunk_id = ANY($1::uuid[])
  `;
  const { rows } = await pool.query<{ chunk_id: string; owner: string; chunk_text: string }>(
    sql,
    [validIds],
  );

  return rows.reduce<Record<string, { owner: string; chunk_text: string }>>((acc, r) => {
    acc[r.chunk_id] = { owner: r.owner, chunk_text: r.chunk_text };
    return acc;
  }, {});
}
```

**Note on `chunk_id` type**: data-verifier confirms `knowledge_base_chunks.chunk_id` is `uuid`. If a future migration changes the type, adjust the `::uuid[]` cast.

## PHASE 4 — VALIDATION GATE

```bash
# 1. Three new exports present
grep -E "^export (async )?function (getEvaluationDetail|getTranscriptComments|getKbChunksByIds)" \
  src/lib/queries/call-intelligence-evaluations.ts

# 2. The new SELECT covers all 12 missing columns
grep -cE "(dimension_scores|narrative|strengths|weaknesses|knowledge_gaps|compliance_flags|additional_observations|coaching_nudge|manager_edited_at|manager_edited_by|ai_original|edit_version)" \
  src/lib/queries/call-intelligence-evaluations.ts

# 3. LEFT JOIN reps editor present
grep -E "LEFT JOIN reps editor.*is_system" src/lib/queries/call-intelligence-evaluations.ts

# 4. UUID validation in the new functions
grep -E "UUID_RE.test" src/lib/queries/call-intelligence-evaluations.ts | wc -l   # >=3 (existing + 2 new)

# 5. Build error count decreasing
npm run build 2>&1 | grep -c "error TS" || echo "0 errors"
```

**Expected:**
- 3 exports
- ≥12 grep matches (each new column appears at least once)
- 1 LEFT JOIN match
- ≥3 UUID_RE.test calls
- Error count strictly less than Phase 3's count (the query layer now satisfies its own type contracts)

**STOP AND REPORT:**
- "Phase 4 done — query layer rewritten + 2 new helpers."
- "Error count down from N (Phase 3) to M."
- "Remaining errors expected in API routes (Phase 6) and components (Phase 7)."
- "Ready to proceed to Phase 5 (Bridge client methods)?"

---

# PHASE 5: BRIDGE CLIENT METHODS

## Context

Add 5 new methods to the `salesCoachingClient` object. All follow Pattern A from `pattern-finder-findings.md`.

## Step 5.1: Add the 5 methods

**File**: `src/lib/sales-coaching-client/index.ts`

Update the imports near the top to merge the new schemas:

```ts
import {
  // ... existing schemas
  EditEvaluationRequest,
  EditEvaluationResponse,
  TranscriptCommentCreateRequest,
  TranscriptCommentResponse,
  ContentRefinementCreateRequest,
  ContentRefinementResponse,
  MyContentRefinementsResponse,
  DeleteTranscriptCommentResponse,
} from './schemas';
```

Inside the `salesCoachingClient` object (the existing literal at lines 196-241), append the 5 new methods after the existing `resolveContentRefinement`:

```ts
  editEvaluation: (email: string, evaluationId: string, body: EditEvaluationRequestT) =>
    bridgeRequest({
      method: 'PATCH',
      path: `/api/dashboard/evaluations/${encodeURIComponent(evaluationId)}/edit`,
      email,
      requestSchema: EditEvaluationRequest,
      responseSchema: EditEvaluationResponse,
      body,
      context: {
        evaluationId,
        expectedEditVersion: body.expected_edit_version,
      },
    }),

  createTranscriptComment: (
    email: string,
    evaluationId: string,
    body: TranscriptCommentCreateRequestT,
  ) =>
    bridgeRequest({
      method: 'POST',
      path: `/api/dashboard/evaluations/${encodeURIComponent(evaluationId)}/transcript-comments`,
      email,
      requestSchema: TranscriptCommentCreateRequest,
      responseSchema: TranscriptCommentResponse,
      body,
      context: { evaluationId },
    }),

  deleteTranscriptComment: (email: string, commentId: string) =>
    bridgeRequest({
      method: 'DELETE',
      path: `/api/dashboard/transcript-comments/${encodeURIComponent(commentId)}`,
      email,
      responseSchema: DeleteTranscriptCommentResponse,
    }),

  submitContentRefinement: (email: string, body: ContentRefinementCreateRequestT) =>
    bridgeRequest({
      method: 'POST',
      path: `/api/dashboard/content-refinements`,
      email,
      requestSchema: ContentRefinementCreateRequest,
      responseSchema: ContentRefinementResponse,
      body,
    }),

  listMyContentRefinements: (email: string) =>
    bridgeRequest({
      method: 'GET',
      path: `/api/dashboard/my-content-refinements`,
      email,
      responseSchema: MyContentRefinementsResponse,
    }),
```

The `context` payload on `editEvaluation` is what makes `EvaluationConflictError.expectedVersion` populate. `bridgeRequest` ALREADY merges `options.context` into the thrown error today (`src/lib/sales-coaching-client/index.ts:123`, `errors.ts:27`) — confirmed by Codex. No side-quest needed (council fix B1.10).

## PHASE 5 — VALIDATION GATE

```bash
# 1. All 5 methods exist
grep -E "^\\s+(editEvaluation|createTranscriptComment|deleteTranscriptComment|submitContentRefinement|listMyContentRefinements):" \
  src/lib/sales-coaching-client/index.ts

# 2. HMAC token signing path unchanged (sanity check — should still be referenced)
grep -E "signDashboardToken" src/lib/sales-coaching-client/index.ts

# 3. Method types compile
npx tsc --noEmit 2>&1 | grep "sales-coaching-client" | head -10 || echo "bridge module OK"

# 4. Build error count further down
npm run build 2>&1 | grep -c "error TS" || echo "0 errors"
```

**Expected:**
- 5 grep matches in (#1)
- 1+ match in (#2)
- "bridge module OK" or zero `sales-coaching-client` errors
- Error count strictly ≤ Phase 4

**STOP AND REPORT:**
- "Phase 5 done — 5 bridge methods plumbed."
- "Error count: P (was M after Phase 4)."
- "Ready for Phase 6 (Dashboard API routes)?"

---

# PHASE 6: DASHBOARD API ROUTES

## Context

Five new App Router routes + one augmentation. All follow the auth + error-dispatch shape established by `src/app/api/call-intelligence/evaluations/[id]/reveal-scheduling/route.ts`. Read that file first to mirror the auth pattern.

## Step 6.1: Augment GET `/api/call-intelligence/evaluations/[id]/route.ts`

**File**: existing — add comment + chunk merging + COALESCE fallback into the response.

After fetching `detail` from `getEvaluationDetail(id)`:

```ts
// Step 5b-1: assemble transcript_comments + chunk_lookup + coaching_nudge_effective
const [comments, chunkLookup] = await Promise.all([
  getTranscriptComments(id),
  buildChunkLookup(detail.ai_original),
]);

const coachingNudgeEffective =
  detail.coaching_nudge ?? readAiOriginalCoachingNudge(detail.ai_original);

return NextResponse.json({
  ...detail,
  transcript_comments: comments,
  chunk_lookup: chunkLookup,
  coaching_nudge_effective: coachingNudgeEffective,  // pre-024 fallback (council fix B1.9)
});
```

Import `readAiOriginalCoachingNudge` from `@/components/call-intelligence/citation-helpers`.

The chunk-lookup walker (council fix B1.11 — replaces the unsafe `obj.kb_source === undefined` check from the prior draft) walks specifically into citation shapes:

```ts
async function buildChunkLookup(
  aiOriginal: unknown,
): Promise<Record<string, { owner: string; chunk_text: string }>> {
  if (!aiOriginal || typeof aiOriginal !== 'object') return {};
  const chunkIds = new Set<string>();
  walkForKbSources(aiOriginal, chunkIds);
  return getKbChunksByIds([...chunkIds]);
}

/**
 * Walk the ai_original JSONB tree and collect every valid `kb_source.chunk_id`.
 * Validates the full kb_source shape — chunk_id, doc_id, drive_url, doc_title all
 * non-empty strings — before adding to the set. Dedupes implicitly via Set.
 */
function walkForKbSources(node: unknown, acc: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkForKbSources(item, acc));
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  // Citation-shaped node: has `kb_source` whose contents we validate.
  const kb = obj.kb_source;
  if (kb && typeof kb === 'object') {
    const k = kb as Record<string, unknown>;
    if (
      typeof k.chunk_id === 'string' && k.chunk_id !== '' &&
      typeof k.doc_id === 'string' &&
      typeof k.drive_url === 'string' &&
      typeof k.doc_title === 'string'
    ) {
      acc.add(k.chunk_id);
    }
  }

  // Recurse into all values (citations may be nested inside arrays of arrays etc.).
  Object.values(obj).forEach((v) => walkForKbSources(v, acc));
}
```

This walker only picks up `chunk_id`s nested under a valid `kb_source` block — false positives from arbitrary `chunk_id` strings elsewhere in the tree are filtered out (council fix B1.11).

## Step 6.2: PATCH `/api/call-intelligence/evaluations/[id]/edit/route.ts`

**File** (new):

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/lib/permissions';
import { salesCoachingClient } from '@/lib/sales-coaching-client';
import {
  BridgeAuthError,
  BridgeTransportError,
  BridgeValidationError,
  EvaluationConflictError,
  EvaluationNotFoundError,
} from '@/lib/sales-coaching-client/errors';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const perms = await getSessionPermissions(session);
  if (!perms.allowedPages.has(20)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json();

  try {
    const result = await salesCoachingClient.editEvaluation(
      session.user.email,
      id,
      body,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EvaluationConflictError) {
      return NextResponse.json(
        {
          ok: false,
          error: 'evaluation_conflict',
          message: err.message,
          edit_version_expected: err.expectedVersion,
        },
        { status: 409 },
      );
    }
    if (err instanceof EvaluationNotFoundError) {
      return NextResponse.json({ ok: false, error: 'evaluation_not_found' }, { status: 404 });
    }
    if (err instanceof BridgeValidationError) {
      return NextResponse.json(
        { ok: false, error: 'invalid_request', issues: (err as { issues?: unknown }).issues ?? [] },
        { status: 400 },
      );
    }
    if (err instanceof BridgeAuthError) {
      return NextResponse.json({ ok: false, error: 'role_forbidden' }, { status: 403 });
    }
    if (err instanceof BridgeTransportError) {
      return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    }
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
```

## Step 6.3: POST + GET `/api/call-intelligence/evaluations/[id]/transcript-comments/route.ts`

**File** (new):

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/lib/permissions';
import { salesCoachingClient } from '@/lib/sales-coaching-client';
import {
  BridgeAuthError,
  BridgeTransportError,
  BridgeValidationError,
  EvaluationConflictError,
  EvaluationNotFoundError,
} from '@/lib/sales-coaching-client/errors';
import { getTranscriptComments } from '@/lib/queries/call-intelligence-evaluations';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const perms = await getSessionPermissions(session);
  if (!perms.allowedPages.has(20)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Bucket 2 Q2 (user-confirmed): managers + admins only. Reps never see manager comments.
  // Coaching framing in comments may be private ("Reps don't usually push back here") — this
  // is the strictest sensible default. Revisit in a future step if reveal_policy nuance is needed.
  const role = perms.role;
  if (role !== 'manager' && role !== 'admin' && role !== 'revops_admin') {
    return NextResponse.json({ comments: [] });   // empty list, not 403, so the UI renders cleanly
  }

  const { id } = await context.params;
  const comments = await getTranscriptComments(id);
  return NextResponse.json({ comments });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const perms = await getSessionPermissions(session);
  if (!perms.allowedPages.has(20)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json();

  try {
    const result = await salesCoachingClient.createTranscriptComment(
      session.user.email,
      id,
      body,
    );
    return NextResponse.json(result);
  } catch (err) {
    // Same error mapping as Step 6.2 — extract to a shared helper if desired.
    if (err instanceof EvaluationConflictError) {
      return NextResponse.json(
        { ok: false, error: 'evaluation_conflict', message: err.message },
        { status: 409 },
      );
    }
    if (err instanceof EvaluationNotFoundError) {
      return NextResponse.json({ ok: false, error: 'evaluation_not_found' }, { status: 404 });
    }
    if (err instanceof BridgeValidationError) {
      return NextResponse.json(
        { ok: false, error: 'invalid_request', issues: (err as { issues?: unknown }).issues ?? [] },
        { status: 400 },
      );
    }
    if (err instanceof BridgeAuthError) return NextResponse.json({ ok: false, error: 'role_forbidden' }, { status: 403 });
    if (err instanceof BridgeTransportError) return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
```

## Step 6.4: DELETE `/api/call-intelligence/transcript-comments/[id]/route.ts`

**File** (new):

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/lib/permissions';
import { salesCoachingClient } from '@/lib/sales-coaching-client';
import { BridgeAuthError, BridgeTransportError } from '@/lib/sales-coaching-client/errors';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const perms = await getSessionPermissions(session);
  if (!perms.allowedPages.has(20)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await context.params;
  try {
    const result = await salesCoachingClient.deleteTranscriptComment(session.user.email, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BridgeAuthError) return NextResponse.json({ ok: false, error: 'role_forbidden' }, { status: 403 });
    if (err instanceof BridgeTransportError) return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
```

## Step 6.5: POST `/api/call-intelligence/content-refinements/route.ts`

**File** (new):

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/lib/permissions';
import { salesCoachingClient } from '@/lib/sales-coaching-client';
import {
  BridgeAuthError,
  BridgeTransportError,
  BridgeValidationError,
  ContentRefinementDuplicateError,
  EvaluationNotFoundError,
} from '@/lib/sales-coaching-client/errors';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const perms = await getSessionPermissions(session);
  if (!perms.allowedPages.has(20)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json();

  try {
    const result = await salesCoachingClient.submitContentRefinement(session.user.email, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ContentRefinementDuplicateError) {
      return NextResponse.json({ ok: false, error: 'content_refinement_duplicate' }, { status: 409 });
    }
    if (err instanceof EvaluationNotFoundError) {
      return NextResponse.json({ ok: false, error: 'evaluation_not_found' }, { status: 404 });
    }
    if (err instanceof BridgeValidationError) {
      return NextResponse.json(
        { ok: false, error: 'invalid_request', issues: (err as { issues?: unknown }).issues ?? [] },
        { status: 400 },
      );
    }
    if (err instanceof BridgeAuthError) return NextResponse.json({ ok: false, error: 'role_forbidden' }, { status: 403 });
    if (err instanceof BridgeTransportError) return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
```

## Step 6.6: GET `/api/call-intelligence/my-content-refinements/route.ts`

**File** (new):

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/lib/permissions';
import { salesCoachingClient } from '@/lib/sales-coaching-client';
import { BridgeAuthError, BridgeTransportError } from '@/lib/sales-coaching-client/errors';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const perms = await getSessionPermissions(session);
  if (!perms.allowedPages.has(20)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const result = await salesCoachingClient.listMyContentRefinements(session.user.email);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BridgeAuthError) return NextResponse.json({ ok: false, error: 'role_forbidden' }, { status: 403 });
    if (err instanceof BridgeTransportError) return NextResponse.json({ ok: false, error: 'upstream_error' }, { status: 502 });
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
```

## PHASE 6 — VALIDATION GATE

```bash
# 1. All 5 new route files exist
ls src/app/api/call-intelligence/evaluations/[id]/edit/route.ts \
   src/app/api/call-intelligence/evaluations/[id]/transcript-comments/route.ts \
   src/app/api/call-intelligence/transcript-comments/[id]/route.ts \
   src/app/api/call-intelligence/content-refinements/route.ts \
   src/app/api/call-intelligence/my-content-refinements/route.ts

# 2. Augmented GET route includes new merge logic
grep -E "(buildChunkLookup|getTranscriptComments|chunk_lookup)" src/app/api/call-intelligence/evaluations/[id]/route.ts

# 3. Each route's HTTP method export matches its file purpose
grep -E "^export async function (GET|POST|PATCH|DELETE)" \
  src/app/api/call-intelligence/evaluations/[id]/edit/route.ts \
  src/app/api/call-intelligence/evaluations/[id]/transcript-comments/route.ts \
  src/app/api/call-intelligence/transcript-comments/[id]/route.ts \
  src/app/api/call-intelligence/content-refinements/route.ts \
  src/app/api/call-intelligence/my-content-refinements/route.ts

# 4. Build error count decreasing toward zero (UI is the only remaining work)
npm run build 2>&1 | grep -c "error TS" || echo "0 errors"
```

**Expected:**
- All 5 files listed (no "No such file" errors)
- ≥3 grep matches in (#2)
- 6 method export matches in (#3): PATCH, GET, POST, DELETE, POST, GET
- Error count strictly ≤ Phase 5

**STOP AND REPORT:**
- "Phase 6 done — 5 new routes + augmented eval GET response."
- "Error count: Q (was P after Phase 5). Remaining errors live in `EvalDetailClient.tsx` (Phase 7)."
- "Ready for Phase 7 (Components + page)?"

---

# PHASE 7: COMPONENTS + PAGE

## Context

This is the largest phase. Eleven new components plus the EvalDetailClient rewire plus the new my-refinements page plus the Settings link. Subdivide into independent steps; complete + sanity-check each before moving on.

**Order of attack** (each step compiles on its own once Phase 3-6 land):

1. Leaf components first (CitationPill, KBSidePanel, RefinementModal, all InlineEdit\*, AuditToggle, UtteranceCommentCard, UtteranceCommentComposer)
2. TranscriptViewer (depends on UtteranceCommentCard + composer)
3. MyRefinementsTable + my-refinements page
4. EvalDetailClient rewire + Settings link
5. Final build pass

## Step 7.1: CitationPill

**File**: `src/components/call-intelligence/CitationPill.tsx`

```tsx
'use client';

import type { Citation } from '@/types/call-intelligence';

interface Props {
  citation: Citation;
  chunkLookup: Record<string, { owner: string; chunk_text: string }>;
  onScrollToUtterance?: (idx: number) => void;
  onOpenKB?: (kbSource: NonNullable<Citation['kb_source']> & { owner: string; chunk_text: string }) => void;
  utteranceTextForTooltip?: string;   // first 80 chars for hover, optional
  disabled?: boolean;                  // freeze pill during inline edit
}

export function CitationPill({
  citation,
  chunkLookup,
  onScrollToUtterance,
  onOpenKB,
  utteranceTextForTooltip,
  disabled = false,
}: Props) {
  const hasUtterance = typeof citation.utterance_index === 'number';
  const hasKb = !!citation.kb_source;

  const handleClick = () => {
    if (disabled) return;
    if (hasUtterance && onScrollToUtterance) onScrollToUtterance(citation.utterance_index!);
    if (hasKb && onOpenKB && citation.kb_source) {
      const aug = chunkLookup[citation.kb_source.chunk_id];
      onOpenKB({
        ...citation.kb_source,
        owner: aug?.owner ?? '—',
        chunk_text: aug?.chunk_text ?? '',
      });
    }
  };

  const truncatedTitle = citation.kb_source?.doc_title
    ? citation.kb_source.doc_title.length > 24
      ? `${citation.kb_source.doc_title.slice(0, 24)}…`
      : citation.kb_source.doc_title
    : '';

  let label: string;
  let baseClasses: string;
  if (hasUtterance && hasKb) {
    label = `💬📄 ${citation.utterance_index} · ${truncatedTitle}`;
    baseClasses = 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200';
  } else if (hasKb) {
    label = `📄 ${truncatedTitle}`;
    baseClasses = 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
  } else {
    label = `💬 ${citation.utterance_index}`;
    baseClasses = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }

  const tooltip = hasKb
    ? citation.kb_source?.doc_title
    : utteranceTextForTooltip?.slice(0, 80);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={tooltip}
      className={`inline-flex items-center px-2 py-0.5 mx-0.5 rounded-full text-xs font-medium ${baseClasses} ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}`}
    >
      {label}
    </button>
  );
}
```

## Step 7.2: KBSidePanel

**File**: `src/components/call-intelligence/KBSidePanel.tsx`

```tsx
'use client';

import { Card } from '@tremor/react';
import { ExternalLink, X } from 'lucide-react';

interface Props {
  kbSource: {
    chunk_id: string;
    doc_id: string;
    drive_url: string;
    doc_title: string;
    owner: string;
    chunk_text: string;
  } | null;
  onClose: () => void;
  onOpenRefinement: () => void;
}

export function KBSidePanel({ kbSource, onClose, onOpenRefinement }: Props) {
  if (!kbSource) return null;

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-base font-semibold dark:text-white">{kbSource.doc_title}</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Close KB panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Owner: <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{kbSource.owner}</span>
      </div>
      <pre className="text-xs whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900 rounded p-3 max-h-48 overflow-y-auto font-mono">
        {kbSource.chunk_text || '(chunk text unavailable)'}
      </pre>
      <div className="flex justify-end gap-2 mt-3">
        <a
          href={kbSource.drive_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 dark:text-gray-200"
        >
          Open in Drive <ExternalLink className="w-3 h-3" />
        </a>
        <button
          onClick={onOpenRefinement}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Refine this content →
        </button>
      </div>
    </Card>
  );
}
```

## Step 7.3: RefinementModal

**File**: `src/components/call-intelligence/RefinementModal.tsx`

Pattern F variant 2 (extracted, isOpen). Includes both validation rules from the spec; rule #1 (placeholder ≠ trimmed value) is UI-only, rule #2 (≥20 chars) matches the server.

```tsx
'use client';

import { useState } from 'react';

interface Props {
  isOpen: boolean;
  evaluationId: string;
  docId: string;
  driveUrl: string;
  docTitle: string;
  currentChunkExcerpt: string;
  onClose: () => void;
  onSuccess: () => void;
  onDuplicate: () => void;
  onEvaluationGone: () => void;
}

export function RefinementModal(props: Props) {
  const placeholder = `Suggested change to ${props.docTitle}: `;
  const [text, setText] = useState(placeholder);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.isOpen) return null;

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (trimmed === placeholder.trim()) {
      setError('Please describe the suggested change instead of leaving the placeholder.');
      return;
    }
    if (trimmed.length < 20) {
      setError('Suggested change must be at least 20 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/call-intelligence/content-refinements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluation_id: props.evaluationId,
          doc_id: props.docId,
          drive_url: props.driveUrl,
          current_chunk_excerpt: props.currentChunkExcerpt,
          suggested_change: text,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        props.onSuccess();
        return;
      }
      if (res.status === 409 && json.error === 'content_refinement_duplicate') {
        props.onDuplicate();
        return;
      }
      if (res.status === 404 && json.error === 'evaluation_not_found') {
        props.onEvaluationGone();
        return;
      }
      if (res.status === 400 && json.error === 'invalid_request' && Array.isArray(json.issues)) {
        const fieldIssue = json.issues.find(
          (i: unknown) => i && typeof i === 'object' && Array.isArray((i as { path?: unknown[] }).path) &&
            (i as { path: unknown[] }).path[0] === 'suggested_change',
        );
        setError(
          (fieldIssue && typeof (fieldIssue as { message?: string }).message === 'string'
            ? (fieldIssue as { message: string }).message
            : null) ?? 'Suggested change is invalid.',
        );
        return;
      }
      setError('Something went wrong. Please try again.');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-lg w-full p-6 mx-4">
        <h3 className="text-lg font-semibold mb-3 dark:text-white">Refine: {props.docTitle}</h3>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 text-sm p-2"
        />
        {error && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={props.onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Send refinement request'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

The success/duplicate/eval-gone callbacks are emitted to the parent so the parent can show a banner (no toast library) + redirect on `onEvaluationGone`.

## Step 7.4: InlineEdit\* components

Create three files following Pattern H (toggle between display + Tremor `Textarea`/`select`/list editor).

**Files**:
- `src/components/call-intelligence/InlineEditDimensionScore.tsx` — popover with rubric levels + 4 radio buttons. On save, PATCH `/api/call-intelligence/evaluations/:id/edit` with `{ expected_edit_version, dimension_scores: { [name]: { score: n } } }`.
- `src/components/call-intelligence/InlineEditTextField.tsx` — for `narrative` and `coaching_nudge`. Save sends `{ expected_edit_version, narrative: text }` OR `{ expected_edit_version, coaching_nudge: { text } }`.
- `src/components/call-intelligence/InlineEditListField.tsx` — for `strengths`, `weaknesses`, `knowledge_gaps`, `compliance_flags`, `additional_observations`. Save sends the FULL updated array (not a diff).

**Shared `disabled` prop (council fix B1.13).** Each InlineEdit\* component takes a `disabled: boolean` prop from the parent that — when true — blocks entering edit mode, blocks form submission, and blocks the popover from opening. The parent flips this prop via the shared `mutationLock` state described in Step 7.10.

Each component:
- Receives `disabled: boolean` as a prop. When true, the trigger pencil/score/text becomes a static read-only render (still visible, but hover/click is no-op).
- Calls the parent's `onSave({ patch })` callback rather than fetching directly. The parent's single fetch handler is responsible for OCC handling + reload + 404 redirect (Step 7.10).
- Has its own `useState<boolean>` for `isEditing`, `useState<string | array>` for the draft, and `useState<string|null>` for inline error.
- On Cancel, reverts the draft to the prop value.
- On Save success (parent acks via callback), exits edit mode.
- Disables save button when the draft equals the original (no-op edits).

## Step 7.5: AuditToggle

**File**: `src/components/call-intelligence/AuditToggle.tsx`

```tsx
'use client';

import type { EvaluationDetail } from '@/types/call-intelligence';

interface Props {
  evaluation: EvaluationDetail;
  enabled: boolean;
  onToggle: () => void;
}

const SUPPORTED_VERSIONS = [2, 3, 4, 5];

export function AuditToggle({ evaluation, enabled, onToggle }: Props) {
  const v = evaluation.ai_original_schema_version;
  const supported = SUPPORTED_VERSIONS.includes(v);

  return (
    <div className="flex items-center gap-2">
      <label className="inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="sr-only peer"
        />
        <div className="relative w-9 h-5 bg-gray-200 dark:bg-gray-700 peer-checked:bg-blue-600 rounded-full peer transition-colors">
          <div
            className={`absolute top-0.5 ${enabled ? 'left-5' : 'left-0.5'} h-4 w-4 bg-white rounded-full transition-all`}
          />
        </div>
        <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
          Audit: show original AI output
        </span>
      </label>
      {!supported && enabled && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          Schema v{v} not supported in renderer
        </span>
      )}
    </div>
  );
}
```

The two-column comparison rendering is done in the consumer (`EvalDetailClient`), not here — this component only owns the toggle UI + version-support badge.

## Step 7.6: UtteranceCommentCard + UtteranceCommentComposer

**File**: `src/components/call-intelligence/UtteranceCommentCard.tsx`

```tsx
'use client';

import { X } from 'lucide-react';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';
import type { TranscriptCommentRow } from '@/types/call-intelligence';

interface Props {
  comment: TranscriptCommentRow;
  currentUserId: string;
  isAdmin: boolean;
  onDelete: (commentId: string) => void;
}

export function UtteranceCommentCard({ comment, currentUserId, isAdmin, onDelete }: Props) {
  const canDelete = isAdmin || comment.author_id === currentUserId;
  const displayName = comment.author_full_name ?? roleLabel(comment.author_role);

  return (
    <div className="border-l-2 border-blue-200 dark:border-blue-800 pl-3 py-1 my-2 bg-blue-50/40 dark:bg-blue-900/10 rounded-r">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs">
          <span className="font-medium dark:text-gray-200">{displayName}</span>
          <span className="ml-2 inline-flex items-center px-1.5 py-0 rounded-full text-[10px] uppercase bg-gray-200 dark:bg-gray-700 dark:text-gray-300">
            {comment.author_role}
          </span>
          <span className="ml-2 text-gray-500 dark:text-gray-400">
            {formatRelativeTimestamp(comment.created_at)}
          </span>
        </div>
        {canDelete && (
          <button
            onClick={() => onDelete(comment.id)}
            aria-label="Delete comment"
            className="text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-sm dark:text-gray-200 mt-1 whitespace-pre-wrap">{comment.text}</p>
    </div>
  );
}

function roleLabel(role: 'manager' | 'rep' | 'admin'): string {
  if (role === 'manager') return 'Manager';
  if (role === 'admin') return 'Admin';
  return 'Rep';
}
```

**File**: `src/components/call-intelligence/UtteranceCommentComposer.tsx`

```tsx
'use client';

import { useState } from 'react';

interface Props {
  evaluationId: string;
  utteranceIndex: number;
  onSubmitted: () => void;
  onCancel: () => void;
}

export function UtteranceCommentComposer({ evaluationId, utteranceIndex, onSubmitted, onCancel }: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/call-intelligence/evaluations/${encodeURIComponent(evaluationId)}/transcript-comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ utterance_index: utteranceIndex, text }),
        },
      );
      if (res.ok) {
        onSubmitted();
        return;
      }
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `HTTP ${res.status}`);
    } catch {
      setError('Failed to submit comment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-2">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
        Add comment on utterance {utteranceIndex}
      </div>
      <textarea
        rows={3}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 text-sm p-2"
      />
      {error && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 dark:text-gray-200"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !text.trim()}
          className="px-3 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post comment'}
        </button>
      </div>
    </div>
  );
}
```

## Step 7.7: TranscriptViewer

**File**: `src/components/call-intelligence/TranscriptViewer.tsx`

```tsx
'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { TranscriptCommentRow, TranscriptUtterance } from '@/types/call-intelligence';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';
import { UtteranceCommentCard } from './UtteranceCommentCard';
import { UtteranceCommentComposer } from './UtteranceCommentComposer';

export interface TranscriptViewerHandle {
  scrollToUtterance: (idx: number) => void;
}

interface Props {
  transcript: unknown;   // JSONB — defensively read
  evaluationId: string;
  comments: TranscriptCommentRow[];
  currentUserId: string;
  isAdmin: boolean;
  onCommentChanged: () => void;   // parent triggers refetch
}

export const TranscriptViewer = forwardRef<TranscriptViewerHandle, Props>(
  ({ transcript, evaluationId, comments, currentUserId, isAdmin, onCommentChanged }, ref) => {
    const utterances = readUtterances(transcript);
    const utteranceRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const [pendingComment, setPendingComment] = useState<{ utteranceIndex: number } | null>(null);
    const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);

    useImperativeHandle(ref, () => ({
      scrollToUtterance: (idx: number) => {
        const el = utteranceRefs.current[idx];
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedIdx(idx);
        setTimeout(() => setHighlightedIdx(null), 1500);
      },
    }));

    const handleSelection = (utteranceIndex: number) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      setPendingComment({ utteranceIndex });
    };

    const commentsByIdx = groupCommentsByIndex(comments);

    return (
      <div className="space-y-2 max-h-[80vh] overflow-y-auto pr-2">
        {utterances.map((u) => (
          <div
            key={u.utterance_index}
            ref={(el) => {
              utteranceRefs.current[u.utterance_index] = el;
            }}
            className={`border rounded p-3 transition-colors ${
              highlightedIdx === u.utterance_index
                ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
                : 'border-gray-200 dark:border-gray-700'
            }`}
            onMouseUp={() => handleSelection(u.utterance_index)}
          >
            <div className="flex items-baseline justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                {u.speaker} #{u.utterance_index}
              </span>
              <span title={u.timestamp ?? ''}>
                {u.timestamp ? formatRelativeTimestamp(u.timestamp) : ''}
              </span>
            </div>
            <p className="text-sm dark:text-gray-200 whitespace-pre-wrap select-text">
              {u.text}
            </p>
            {commentsByIdx[u.utterance_index]?.map((c) => (
              <UtteranceCommentCard
                key={c.id}
                comment={c}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onDelete={async (id) => {
                  const res = await fetch(
                    `/api/call-intelligence/transcript-comments/${encodeURIComponent(id)}`,
                    { method: 'DELETE' },
                  );
                  if (res.ok) onCommentChanged();
                }}
              />
            ))}
            {pendingComment?.utteranceIndex === u.utterance_index && (
              <UtteranceCommentComposer
                evaluationId={evaluationId}
                utteranceIndex={u.utterance_index}
                onSubmitted={() => {
                  setPendingComment(null);
                  onCommentChanged();
                }}
                onCancel={() => setPendingComment(null)}
              />
            )}
          </div>
        ))}
      </div>
    );
  },
);
TranscriptViewer.displayName = 'TranscriptViewer';

function readUtterances(raw: unknown): TranscriptUtterance[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i): TranscriptUtterance | null => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text : '';
      if (!text) return null;
      const idx = typeof o.utterance_index === 'number' ? o.utterance_index : i;
      const speakerRaw = typeof o.speaker === 'string' ? o.speaker.toLowerCase() : '';
      const speaker: 'rep' | 'advisor' | 'unknown' =
        speakerRaw === 'rep' ? 'rep' : speakerRaw === 'advisor' ? 'advisor' : 'unknown';
      const timestamp = typeof o.timestamp === 'string' ? o.timestamp : undefined;
      return { utterance_index: idx, speaker, text, timestamp };
    })
    .filter((u): u is TranscriptUtterance => u !== null);
}

function groupCommentsByIndex(
  comments: TranscriptCommentRow[],
): Record<number, TranscriptCommentRow[]> {
  return comments.reduce<Record<number, TranscriptCommentRow[]>>((acc, c) => {
    (acc[c.utterance_index] ||= []).push(c);
    return acc;
  }, {});
}
```

## Step 7.8: MyRefinementsTable + my-refinements page

**File**: `src/components/call-intelligence/MyRefinementsTable.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@tremor/react';
import { ExternalLink } from 'lucide-react';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';

interface Refinement {
  id: string;
  evaluation_id: string;
  doc_id: string;
  drive_url: string;
  current_chunk_excerpt: string;
  suggested_change: string;
  status: 'open' | 'addressed' | 'declined';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export function MyRefinementsTable() {
  const [rows, setRows] = useState<Refinement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/call-intelligence/my-content-refinements', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setRows(json.requests ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <h2 className="text-lg font-semibold dark:text-white mb-4">My refinement requests</h2>
      {loading && <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>}
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          You haven't filed any refinement requests yet.
        </div>
      )}
      {!loading && rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Submitted</TableHeaderCell>
              <TableHeaderCell>Doc</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Resolution notes</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell title={r.created_at}>{formatRelativeTimestamp(r.created_at)}</TableCell>
                <TableCell>
                  <a
                    href={r.drive_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {r.doc_id} <ExternalLink className="w-3 h-3" />
                  </a>
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-sm text-gray-700 dark:text-gray-300 max-w-md whitespace-pre-wrap">
                  {r.resolution_notes ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: Refinement['status'] }) {
  const cls = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    addressed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    declined: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  }[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
```

**File**: `src/app/dashboard/call-intelligence/my-refinements/page.tsx`

Mirror the auth pattern from `evaluations/[id]/page.tsx` (RSC shell, session check, page-20 RBAC, recruiter/capital_partner redirects), then render `<MyRefinementsTable />` inside the existing dashboard layout.

```tsx
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/lib/permissions';
import { MyRefinementsTable } from '@/components/call-intelligence/MyRefinementsTable';

export default async function MyRefinementsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/sign-in');
  const perms = await getSessionPermissions(session);
  if (!perms.allowedPages.has(20)) redirect('/dashboard');
  if (perms.role === 'recruiter') redirect('/dashboard/recruiter-hub');
  if (perms.role === 'capital_partner') redirect('/dashboard/gc-hub');

  return (
    <div className="px-4 py-6 space-y-4">
      <MyRefinementsTable />
    </div>
  );
}
```

Add a small "← Back to Call Intelligence" link via `<Link>` if 5a-UI's pattern J calls for it.

## Step 7.9: Settings tab link

**File**: `src/app/dashboard/call-intelligence/tabs/SettingsTab.tsx`

Add a small link in its OWN top-level section, separated from the form's submit row by a `border-t`. Don't modify the existing form code — append a NEW sibling section after the form's closing tag (council fix B1.17 — keep outside the submit row to avoid being mistaken for form action UI).

```tsx
import Link from 'next/link';
// ... existing imports

// As a NEW top-level section (sibling of, not inside, the existing form):
<div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
  <h3 className="text-sm font-semibold dark:text-white mb-2">Refinement requests</h3>
  <Link
    href="/dashboard/call-intelligence/my-refinements"
    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
  >
    My refinement requests →
  </Link>
</div>
```

## Step 7.10: Rewire EvalDetailClient

**File**: `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx`

This is the biggest single edit. Read the file top to bottom before changes — preserve the existing summary card, reviewer-actions card, conflict banner pattern, and back link.

Changes:

1. **Imports** — merge new component imports into the existing import block:

```ts
import { TranscriptViewer, type TranscriptViewerHandle } from '@/components/call-intelligence/TranscriptViewer';
import { CitationPill } from '@/components/call-intelligence/CitationPill';
import { KBSidePanel } from '@/components/call-intelligence/KBSidePanel';
import { RefinementModal } from '@/components/call-intelligence/RefinementModal';
import { InlineEditDimensionScore } from '@/components/call-intelligence/InlineEditDimensionScore';
import { InlineEditTextField } from '@/components/call-intelligence/InlineEditTextField';
import { InlineEditListField } from '@/components/call-intelligence/InlineEditListField';
import { AuditToggle } from '@/components/call-intelligence/AuditToggle';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
```

2. **State** — add to the existing state block:

```ts
const router = useRouter();
const [auditEnabled, setAuditEnabled] = useState(false);
const [activeKb, setActiveKb] = useState<{ chunk_id: string; doc_id: string; drive_url: string; doc_title: string; owner: string; chunk_text: string } | null>(null);
const [refinementOpen, setRefinementOpen] = useState(false);
const [banner, setBanner] = useState<{ kind: 'success' | 'info' | 'error'; text: string; cta?: { label: string; onClick: () => void } } | null>(null);
const transcriptRef = useRef<TranscriptViewerHandle>(null);

/**
 * Shared mutation lock (council fix B1.13 — addresses C4 + C5):
 * - 'idle' — normal operation, all inline editors and reveal actions enabled.
 * - 'pending' — a save is in flight; block all other mutations.
 * - 'conflict-pending-reload' — got 409 stale-version; block edits until user clicks Reload.
 * - 'authority-lost' — got 409 authority-lost; block all edits until user navigates away.
 *
 * Replace the existing `actionPending` boolean with this richer state and thread
 * `disabled = mutationLock.kind !== 'idle'` into every InlineEdit* and reveal-action button.
 */
type MutationLock =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'conflict-pending-reload' }
  | { kind: 'authority-lost' };
const [mutationLock, setMutationLock] = useState<MutationLock>({ kind: 'idle' });
const isLocked = mutationLock.kind !== 'idle';
```

(Replace the existing `actionPending` state at `EvalDetailClient.tsx:~22` with `mutationLock` and thread `disabled={isLocked}` into the existing reveal-action buttons that previously used `actionPending` — covers Codex C5's stale-version race for free.)

3. **Layout** — wrap the existing content in a Pattern E two-pane grid. The existing summary + AI evaluation + narrative + … cards go in the LEFT column. The transcript viewer is the RIGHT column.

```tsx
<div className="px-4 py-6 space-y-4">
  {/* Existing back link */}
  {/* Existing summary card */}

  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
    <div className="space-y-4">
      {/* Audit toggle + "Last edited" line */}
      <div className="flex items-center justify-between">
        <AuditToggle
          evaluation={detail}
          enabled={auditEnabled}
          onToggle={() => setAuditEnabled((v) => !v)}
        />
        {detail.manager_edited_at && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Last edited {formatRelativeTimestamp(detail.manager_edited_at)}
            {detail.manager_edited_by_name ? ` by ${detail.manager_edited_by_name}` : ''}
            {detail.manager_edited_by_active === false && (
              <span className="italic"> (inactive)</span>   /* council fix B1.7 */
            )}
          </div>
        )}
      </div>

      {/* AI evaluation card with InlineEditDimensionScore on each dimension */}
      {/* Narrative card with InlineEditTextField */}
      {/* Strengths / Weaknesses / Knowledge gaps / Compliance flags / Additional observations / Coaching nudge — each wrapped in InlineEditListField (or InlineEditTextField for coaching_nudge) */}
      {/* Existing reviewer-actions card */}
    </div>

    <div className="lg:sticky lg:top-4 space-y-4">
      <TranscriptViewer
        ref={transcriptRef}
        transcript={detail.transcript}
        evaluationId={id}
        comments={detail.transcript_comments}
        currentUserId={/* from session via prop */}
        isAdmin={role === 'admin' || role === 'revops_admin'}
        onCommentChanged={() => void load()}
      />
      {activeKb && (
        <KBSidePanel
          kbSource={activeKb}
          onClose={() => setActiveKb(null)}
          onOpenRefinement={() => setRefinementOpen(true)}
        />
      )}
    </div>
  </div>

  {refinementOpen && activeKb && (
    <RefinementModal
      isOpen
      evaluationId={id}
      docId={activeKb.doc_id}
      driveUrl={activeKb.drive_url}
      docTitle={activeKb.doc_title}
      currentChunkExcerpt={activeKb.chunk_text}
      onClose={() => setRefinementOpen(false)}
      onSuccess={() => {
        setRefinementOpen(false);
        setBanner({ kind: 'success', text: "Refinement request sent to RevOps. They'll review and update the source doc." });
      }}
      onDuplicate={() => {
        setRefinementOpen(false);
        // Council fix B1.16 — give the user a "View / Edit Existing" path, not a dead-end toast.
        setBanner({
          kind: 'info',
          text: 'You already have an open refinement for this text.',
          cta: {
            label: 'View existing',
            onClick: () => router.push(`/dashboard/call-intelligence/my-refinements?highlight=${id}`),
          },
        });
      }}
      onEvaluationGone={() => {
        setRefinementOpen(false);
        router.push(`/dashboard/call-intelligence?tab=${returnTab}`);
      }}
    />
  )}

  {banner && (
    <div
      className={`px-4 py-3 text-sm rounded flex items-center justify-between gap-4 ${
        banner.kind === 'success'
          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
          : banner.kind === 'info'
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
      }`}
    >
      <span>{banner.text}</span>
      <span className="flex items-center gap-3">
        {banner.kind === 'success' && (
          <Link href="/dashboard/call-intelligence/my-refinements" className="underline">
            Track your refinement requests →
          </Link>
        )}
        {banner.cta && (
          <button
            onClick={banner.cta.onClick}
            className="underline whitespace-nowrap"
          >
            {banner.cta.label} →
          </button>
        )}
      </span>
    </div>
  )}
</div>
```

4. **Citation rendering** — for each cited claim/strength/weakness/etc., render the text followed by `<CitationPill>`s for each citation in `citations[]`. Use `chunkLookup={detail.chunk_lookup}`, `onScrollToUtterance={(idx) => transcriptRef.current?.scrollToUtterance(idx)}`, `onOpenKB={(kb) => setActiveKb(kb)}`.

5. **Inline edit save handler** — single shared function `handleEdit(patch)` that POSTs to `/api/call-intelligence/evaluations/${id}/edit` with `{ expected_edit_version: detail.edit_version, ...patch }`. The handler manages the `mutationLock` lifecycle and disambiguates 409 by `json.message`:

```ts
async function handleEdit(patch: Record<string, unknown>) {
  if (isLocked) return { ok: false, reason: 'locked' as const };
  setMutationLock({ kind: 'pending' });
  try {
    const res = await fetch(`/api/call-intelligence/evaluations/${id}/edit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_edit_version: detail.edit_version, ...patch }),
    });
    if (res.ok) {
      await load();             // reload pulls fresh edit_version into detail state
      setMutationLock({ kind: 'idle' });
      return { ok: true };
    }
    const json = await res.json().catch(() => ({}));

    if (res.status === 404 && json.error === 'evaluation_not_found') {
      // Council fix B1.14 (Bucket 2 Q3 default A): user-controlled redirect, no auto-timeout.
      setBanner({
        kind: 'error',
        text: 'This evaluation is no longer available.',
        cta: { label: 'Return to queue', onClick: () => router.push(`/dashboard/call-intelligence?tab=${returnTab}`) },
      });
      setMutationLock({ kind: 'authority-lost' });   // freeze all edits
      return { ok: false };
    }

    if (res.status === 409 && json.error === 'evaluation_conflict') {
      const msg = typeof json.message === 'string' ? json.message : '';
      if (msg.includes('Authority lost')) {
        setBanner({
          kind: 'error',
          text: 'This evaluation was reassigned to another manager.',
          cta: { label: 'Return to queue', onClick: () => router.push(`/dashboard/call-intelligence?tab=${returnTab}`) },
        });
        setMutationLock({ kind: 'authority-lost' });
        return { ok: false };
      }
      // Stale-version: log a defensive warning if the message text is empty/unfamiliar
      // so upstream copy drift is observable in dev console (council fix B1.14 partial).
      if (msg && !/edit[_ ]version|stale|conflict/i.test(msg)) {
        console.warn('[EvalDetailClient] Unexpected 409 message text — may indicate sales-coaching copy drift:', msg);
      }
      setConflict({
        expectedVersion: json.edit_version_expected ?? detail.edit_version,
        message: 'Another manager just edited this evaluation — click to reload with their changes',
      });
      setMutationLock({ kind: 'conflict-pending-reload' });
      return { ok: false };
    }

    if (res.status === 400 && json.error === 'invalid_request' && Array.isArray(json.issues)) {
      setMutationLock({ kind: 'idle' });
      return { ok: false, issues: json.issues };
    }

    setBanner({ kind: 'error', text: 'Something went wrong. Please try again.' });
    setMutationLock({ kind: 'idle' });
    return { ok: false };
  } catch (err) {
    setBanner({ kind: 'error', text: 'Something went wrong. Please try again.' });
    setMutationLock({ kind: 'idle' });
    return { ok: false };
  }
}

// On Reload click (from the conflict banner):
async function handleReload() {
  await load();
  setConflict(null);
  setMutationLock({ kind: 'idle' });
}
```

The mutation lock lifecycle:
- `idle` → `pending` on save start
- `pending` → `idle` on success (after `await load()`)
- `pending` → `conflict-pending-reload` on stale-version 409
- `conflict-pending-reload` → `idle` on user "Reload" click
- `pending` → `authority-lost` on authority-lost 409 or 404
- `authority-lost` → terminal (only escape is the "Return to queue" button)

6. **Audit-toggle two-column rendering** — when `auditEnabled === true`, wrap each editable section in a `grid-cols-1 md:grid-cols-2` with the canonical (manager-edited) value on the left and `ai_original.*` on the right, using the defensive readers from `EvalDetailClient.tsx:44-101` for both sides. Inline edit controls hide when `auditEnabled` is on.

## PHASE 7 — VALIDATION GATE

```bash
# 1. All 11 components exist
ls src/components/call-intelligence/*.tsx

# 2. The new page exists
ls src/app/dashboard/call-intelligence/my-refinements/page.tsx

# 3. EvalDetailClient imports the new components
grep -E "from '@/components/call-intelligence" src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx

# 4. Settings tab link present
grep -E "my-refinements" src/app/dashboard/call-intelligence/tabs/SettingsTab.tsx

# 5. Build green — zero TS errors
npm run build 2>&1 | grep -c "error TS" || echo "0 errors"

# 6. Lint clean
npx eslint src/components/call-intelligence src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx 2>&1 | tail -10
```

**Expected:**
- 11 component files
- 1 page file
- ≥6 imports from `@/components/call-intelligence` in EvalDetailClient
- Settings tab link match
- **Build: 0 errors**
- ESLint clean

**STOP AND REPORT:**
- "Phase 7 done — UI fully wired. Build green."
- "Component count: 11 in `src/components/call-intelligence/`. EvalDetailClient rewired to two-pane layout."
- "Ready for Phase 7.5 (Doc sync)?"

---

# PHASE 7.5: DOCUMENTATION SYNC

## Context

Five new API routes + one new page route + one new component directory means generated inventories must refresh.

## Step 7.5.1: Regenerate inventories

```bash
npm run gen:api-routes
npm run gen:env       # no env changes expected; runs as a no-op safety
npm run gen:models    # no Prisma changes; no-op
```

## Step 7.5.2: Sync narrative docs

```bash
npx agent-guard sync
```

Review the output. The agent-guard tool may propose updates to `docs/ARCHITECTURE.md` (API Routes section + possibly Page Routes section). Review them carefully before staging.

## Step 7.5.3: Stage doc changes

```bash
git add docs/_generated/api-routes.md
# Stage ARCHITECTURE.md only if agent-guard updated it
git diff --stat docs/ARCHITECTURE.md
git add docs/ARCHITECTURE.md   # only if needed
```

## PHASE 7.5 — VALIDATION GATE

```bash
# 1. New routes show up in the inventory
grep -E "(evaluations/.id./edit|transcript-comments|content-refinements|my-content-refinements|my-refinements)" \
  docs/_generated/api-routes.md | wc -l   # >=5 (5 API routes; my-refinements page is a page route)

# 2. ARCHITECTURE.md not stale
git diff --stat docs/ARCHITECTURE.md
```

**Expected:**
- ≥5 matches
- ARCHITECTURE.md either updated by agent-guard or already in sync

**STOP AND REPORT:**
- "Phase 7.5 done — API route inventory regenerated. ARCHITECTURE.md [synced/in-sync]."
- "Ready for Phase 8 (UI/UX validation in browser)?"

---

# PHASE 8: UI/UX VALIDATION (REQUIRES USER)

## Context

The 13 acceptance tests (a-m) from the spec. These must be run in a real browser by the user — no Claude-side substitute. The spec is the source of truth for pass/fail.

Run dev server:

```bash
npm run dev
```

User opens `http://localhost:3000/dashboard/call-intelligence` and navigates to a Pending Review eval.

### Test groups

#### Group 1 — Citations (a, b, c)
- (a) Click a transcript pill → right pane scrolls to the cited utterance with a 1.5s yellow highlight.
- (b) Click a KB pill → KB side panel renders with doc title, owner badge, monospace chunk_text. Close button restores transcript view.
- (c) Click a combined pill → both fire on the single click.

#### Group 2 — Refinement modal (d)
Set up: open KB side panel → click "Refine this content".
- Submit with placeholder unchanged → inline error "Please describe the suggested change instead of leaving the placeholder."
- Submit with `<20` chars → inline error "Suggested change must be at least 20 characters."
- Submit with ≥20 char meaningful text → success banner + modal closes + "Track your refinement requests →" link appears.
- Submit a duplicate (same chunk, status open) → 409 banner "You already have an open suggestion on this chunk."

#### Group 3 — Inline edit happy path + 409 (e, f, f2, g)
- (e) Edit narrative → save → see new text + new edit_version + "Last edited just now by {actor}".
- (f) Simulate concurrent edit (open 2 browser tabs as different managers) → second save returns 409 stale-version → conflict banner "Another manager just edited this evaluation — click to reload with their changes". Click Reload → state refreshes.
- (f2) Bulk-reassign the eval to another manager (Step 5a-API admin tool) while you have it open → save → 409 authority-lost → "This evaluation was reassigned to another manager" banner + auto-redirect to queue after 1.5s.
- (g) Edit narrative away from a cited claim → reload → toggle Audit ON → confirm `ai_original` still shows the original cited claim.

#### Group 4 — Audit toggle (h, i)
- (h) Default OFF → single canonical view. Toggle ON → two-column comparison. Toggle OFF → single column restored.
- (i) Load an eval with `ai_original_schema_version=2` (5 known v2 rows in dev) → renderer renders OR shows "Schema v{n} not supported in renderer" — never crash.

#### Group 5 — Utterance comments (j)
- Select a sentence in the transcript → "+ Add comment" composer appears → save → comment renders pinned to utterance.
- Author deletes own comment → row removed.
- Log in as a different rep → × button is hidden on others' comments. Log in as admin → × visible on all.

#### Group 6 — Mobile responsive (k)
- Resize browser to <1024px → eval panel stacks above transcript.
- Citation pills, KB side panel, refinement modal all functional.

#### Group 7 — Dark mode (l)
- Toggle dark mode → every styled element renders correctly: cards, banners, pills, modals, table, inputs.

#### Group 8 — Schema mirror byte-equality (m)
```bash
SALES_COACHING_SCHEMAS_PATH=C:/Users/russe/Documents/sales-coaching/src/lib/dashboard-api/schemas.ts \
  npm run check:schema-mirror
```
Should print: `Schema mirror byte-equal with sales-coaching/dashboard-api/schemas.ts ✓`

### After all 13 pass

```bash
npm run build           # final clean build
git status
```

**STOP AND REPORT:**
- "Phase 8 user-validation complete: all 13 acceptance tests pass."
- "Final build clean."
- "Ready for commit + PR? (Reminder: write `.ai-session-context.md` before `git commit` per project protocol.)"

---

# Troubleshooting Appendix

| Symptom | Likely cause | Fix |
|---|---|---|
| "Cannot find name 'Citation'" build error after Phase 2 | Phase 3 hasn't run yet | Continue to Phase 3 — expected |
| 5xx on PATCH `/edit` with no error code in body | `salesCoachingClient.editEvaluation` threw an unmapped error class | Ensure `BridgeAuthError`/`BridgeTransportError`/`BridgeValidationError` are caught at the route handler |
| 409 on POST `/content-refinements` with no special handling in modal | `ContentRefinementDuplicateError` not exported from `errors.ts` or not dispatched in `bridgeRequest` | Re-do Step 1.3 + Step 1.5 |
| Citation pill click does nothing | `chunk_lookup` empty (no `owner`/`chunk_text` augmentation) | Verify Step 4.3 + Step 6.1 ran; check `getKbChunksByIds` returns rows |
| Audit toggle crashes on v2 eval | Defensive readers not handling missing `coachingNudge` etc. | Audit `readCitedItems` for optional chaining; fall back to "Schema v{n} not supported" when version < 2 |
| utterance_index orphan comment | Transcript reprocessed and shortened after comment write | TranscriptViewer skips rendering when `utterance_index >= transcript.length`; verify `groupCommentsByIndex` doesn't crash on missing key |
| Author name shows as "Manager" / "Rep" / "Admin" | `author_full_name` is null (system user or deleted rep) | Expected fallback; see Open Question 5 in exploration-results.md |
| Conflict banner "Authority lost" but redirect doesn't fire | `setTimeout` racing with state update | Use `useEffect([banner])` to fire `router.push` instead of inline `setTimeout` |
| Two open refinement modals at once | Multiple KB pills clicked rapidly | RefinementModal only renders when `refinementOpen && activeKb`; verify `setActiveKb` resets on close |
| Schema mirror CI fails locally without sibling repo | `SALES_COACHING_SCHEMAS_PATH` unset and sibling missing | Set `SKIP_SCHEMA_MIRROR_CHECK=1` for local runs; CI sets the path explicitly |

---

# Known Limitations

- **No toast library installed.** All success/error/info feedback uses inline banners. The spec calls for "Tremor toasts" but Tremor has no toast component and `package.json` carries no `sonner` / `react-hot-toast`. Banners cover the same UX needs without a new dependency. Revisit if council disagrees.
- **`ai_original` is immutable** — manager edits go to mirror columns only. Audit toggle compares the immutable AI baseline against the editable canonical view.
- **`author_full_name` is best-effort.** When the rep is system or deleted, the role label is shown.
- **utterance_index orphans** are silently skipped if the transcript is shorter than the comment's index.
- **CSS-driven KB side panel slide-in.** No `@radix-ui/react-dialog` drawer. The panel renders append-in-place inside the sticky right pane (Pattern N).
- **`f2` authority-lost test requires a fixture.** Bulk-reassign API (Step 5a-API) must be available to simulate the snapshot manager change. If unavailable in dev, document the test as "verified in staging".
- **`m` byte-equality CI check requires the sibling sales-coaching repo path.** CI sets `SALES_COACHING_SCHEMAS_PATH`; local runs may skip via `SKIP_SCHEMA_MIRROR_CHECK=1`.

---

*End of Step 5b-1-UI Implementation Guide.*

---

# Refinement Log

> Generated by /auto-feature Phase 4 self-triage. Each entry records a council finding,
> the bucket it was triaged into, and what changed in the guide.

## Bucket 1 — Applied autonomously

| ID | Section | Change | Reviewer |
|---|---|---|---|
| B1.1 | Phase 1.5 | Scoped 404 dispatch to `/evaluations/:id` paths only (avoid misclassifying transcript-comment DELETE 404s); added a fallback by `errCode === 'evaluation_not_found'` so content-refinements with tombstoned parents still route correctly | Codex (S1) |
| B1.2 | Phase 2 / Phase 3 | Moved `citation-helpers.ts` creation from Phase 2 to Phase 3 so the Phase 2 gate doesn't fail on a missing `Citation` import | Codex (C2) |
| B1.3 | Phase 3 | Kept `ai_original_schema_version: number \| null` (don't widen) | self cross-check (S10) |
| B1.4 | Phase 3 | List of fields to add narrowed to truly new ones; existing fields (`evaluation_id`, `edit_version`, `transcript`, `ai_original`, `overall_score`, `assigned_manager_*`, snapshot reveal fields, `call_summary_markdown`) preserved; added `coaching_nudge_effective` and `manager_edited_by_active` | Codex (C1), self cross-check |
| B1.5 | Phase 4.1 | Replaced "Rewrite" with "Extend" — preserve all existing aliases (`e.id AS evaluation_id`, snapshot reveal fields, `mgr.full_name AS assigned_manager_full_name`, `cn.summary_markdown AS call_summary_markdown`, etc.); add only new columns + the editor JOIN | Codex (C1) |
| B1.6 | Phase 4.1, 4.2 | Use `editor.full_name` and `r.full_name` directly (the schema has `full_name`, not `first_name`/`last_name` — the prior CONCAT pattern was wrong) | Codex (S4), self cross-check |
| B1.7 | Phase 4.1 | Added `editor.is_active AS manager_edited_by_active` to surface "(inactive)" suffix | Gemini (S8) |
| B1.8 | Phase 4.1 | `RawDetailRow` Omit list widened to include `transcript_comments`, `chunk_lookup`, `coaching_nudge_effective` (none returned by SELECT) | self cross-check (S11) |
| B1.9 | Phase 6.1 | API route computes `coaching_nudge_effective = canonical ?? ai_original.coachingNudge` for pre-024 evals | Gemini (S6) |
| B1.10 | Phase 5 | Removed stale "if bridgeRequest does NOT currently merge context" wording — the bridge already does this at `index.ts:123` | Codex (S2) |
| B1.11 | Phase 6.1 | Replaced unsafe `collectChunkIds` walker with `walkForKbSources` — validates full kb_source shape, dedupes via `Set` | Codex + Gemini (C3) |
| B1.12 | Architecture Rules | Added explicit Construction Site Inventory listing two sites (DB merge + API route merge) plus the inherited client-side cast | Codex (C2) |
| B1.13 | Phase 7.10 | Added shared `mutationLock` discriminated union to `EvalDetailClient`; replaced existing `actionPending` boolean; threaded `disabled={isLocked}` to all InlineEdit\* components AND existing reveal-action buttons (closes both C4 freeze gap and C5 stale-version race) | Codex (C4 + C5) |
| B1.14 | Phase 7.10 banner + handler | Replaced 1.5s `setTimeout`-driven redirect on authority-lost / 404 with a banner + "Return to queue" button (user-controlled). Added `console.warn` when 409 message text doesn't match expected patterns (drift early-warning) | Codex (S3), Gemini (C9) |
| B1.15 | Phase 3 / 7 | Added `isFieldSupportedByAiOriginalVersion` helper to `citation-helpers.ts`; sections render only when supported by the eval's schema version (no empty boxes for v2 evals) | Gemini (S7) |
| B1.16 | Phase 7 banner | `RefinementModal` 409 duplicate handler now sets a banner with "View existing →" CTA linking to `/dashboard/call-intelligence/my-refinements?highlight={evaluation_id}` | Gemini (S9) |
| B1.17 | Phase 7.9 | Settings tab link placed in its own top-level `<div>` with `border-t`, OUTSIDE the form's submit row | Codex (S5) |
| B1.18 | Outside-guide infra | Created `scripts/check-schema-mirror.cjs` (GH raw fetch via `gh`/`GH_TOKEN`, with `SALES_COACHING_SCHEMAS_PATH` override for sibling-repo dev), `.claude/skills/sync-bridge-schema/SKILL.md`, sections in Dashboard CLAUDE.md and sales-coaching CLAUDE.md. Phase 1.6 of the guide confirms presence and wires CI step | user decision (Bucket 2 Q4 → Option 3) |

## Bucket 2 — User decisions applied

| Question | User chose | Where it landed |
|---|---|---|
| Q1 — Citation persistence on canonical edits | A: Accept loss; audit toggle is the historical lens | Already the guide default; no schema change. Acceptance test (g) passes via the audit-toggle path. |
| Q2 — Comment visibility for reps | A: Managers + admins only — reps blocked entirely | Added an explicit role check in GET `/transcript-comments` (Phase 6.3) that returns an empty `comments: []` array for non-manager/non-admin roles. |
| Q3 — Authority-Lost UX | A: Banner with "Return to queue" button (user-controlled) | Already wired by B1.14 — banner has a CTA button instead of `setTimeout` redirect. |
| Q4 — CI schema mirror source | C: Fetch from sales-coaching's GitHub raw URL via token (Option 3) | Implemented outside the guide (B1.18). Guide Phase 1.6 just confirms presence + wires the CI workflow step. |

## Bucket 2 — Defaulted to spec-faithful options (not surfaced to user)

| Question | Default chosen | Why it wasn't surfaced |
|---|---|---|
| Toast library | A: Inline banners only | Lower-impact UX choice; spec mentions "Tremor toast" but Tremor has no toast component. The 6 spec strings render as inline banners using the existing Pattern C — already wired throughout the guide. User can override at execution time if desired. |
| Audit toggle layout | A: Global side-by-side two-column | Spec-faithful default. Per-field popover is in Bucket 3 as a future enhancement. |
| Citation pill display | A: Render every citation as a separate pill | Spec-faithful. Grouping is in Bucket 3 (clamp/dedup) as a follow-up if pills become noise in production. |
| Refinement modal SLA copy | A: No expectation copy | Defer until user feedback shows confusion. Bucket 3. |
| My Refinements scope | A: Self only | Matches spec. Team scope is Bucket 3 (Step 5c+). |
| Mobile KB panel placement | B: Append-in-place inside top eval panel | Current plan; Gemini flagged as off-screen risk. Listed in Known Limitations. Bottom-sheet drawer is Bucket 3. |

## Bucket 2 — Surfaced to user (Human Input Gate)

5 questions to resolve before guide is final. See `triage-results.md` Bucket 2 section for full options + trade-offs.

## Bucket 3 — Noted but deferred

| ID | Item | Why deferred |
|---|---|---|
| B3.1 | localStorage draft preservation across reloads | Out of scope for 5b-1; Bucket 2 Q3 Option A handles the immediate UX |
| B3.2 | Comment-trail panel + deep-linking from a comments dashboard | Future enhancement; not in spec |
| B3.3 | Coordinate sales-coaching for `conflict_reason: 'stale_version' \| 'authority_lost'` discriminator | Removes message-text dependency; needs sales-coaching change. Open follow-up ticket |
| B3.4 | Audit toggle diff-highlight sub-mode | Out of scope; defensive readers + global toggle is sufficient for 5b-1 |
| B3.5 | Sub-field audit popover (alt to global toggle) | Bundled into Bucket 2 Q5 |
| B3.6 | KB owner co-ownership migration (`TEXT` → `TEXT[]`) | Schema is `TEXT NOT NULL` today; migration out of scope |
| B3.7 | Refinement modal SLA copy ("RevOps reviews weekly") | Bucket 2 Q7 — defer if not needed |
| B3.8 | My Refinements scope expansion (team) | Bucket 2 Q8 — defer to Step 5c+ |
| B3.9 | Runtime Zod parsing of API response in `EvalDetailClient.tsx:~175` | Inherited risk from 5a-UI; deferred — no observed defects, parsing adds bundle size |
