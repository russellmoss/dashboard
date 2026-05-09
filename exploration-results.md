# Exploration Results — Step 5b-1-UI: Eval Detail Audit + Calibration Surface

> Generated: 2026-05-09. Synthesized from `code-inspector-findings.md`,
> `data-verifier-findings.md`, `pattern-finder-findings.md`.

---

## 1. Pre-Flight Summary

Step 5b-1-UI extends the existing `/dashboard/call-intelligence/evaluations/[id]` page
(Step 5a-UI, commit 832e3dc) with citation pills, a KB side panel, manager inline editing,
utterance-level comments, an "Audit: show original AI output" toggle, and a new
`/my-refinements` sub-route. The Zod-schema mirror has already been byte-for-byte
copied from sales-coaching (uncommitted in `git status`) and contains every Step 5b-1
schema except a tiny `DeleteTranscriptCommentResponse`.

**Three contradictions vs the user's brief — trust the code.** (a) Migration 037 does
NOT create new tables; it only extends the `transcript_comments.author_role` CHECK to
include `admin`. The four tables we need (`evaluations`, `call_transcripts`,
`transcript_comments`, `content_refinement_requests`) all exist since migration 001.
(b) `src/lib/queries/call-intelligence/` is NOT a subdirectory; the call-intelligence
query files live flat in `src/lib/queries/`. (c) `src/components/call-intelligence/`
does NOT exist today — it will be planted by this step.

**Eight read-path gaps that block the UI.** (1) `getEvaluationDetail()` is missing 12
columns the new UI needs (`dimension_scores`, `narrative`, `strengths`, `weaknesses`,
`knowledge_gaps`, `compliance_flags`, `additional_observations`, `coaching_nudge`,
`manager_edited_at`, `manager_edited_by`, `ai_original`, `ai_original_schema_version`,
`edit_version`). (2) `EvaluationDetail` TypeScript type is similarly incomplete.
(3) `manager_edited_by` is a UUID with no display-name resolution — needs a `LEFT JOIN reps`.
(4) `KbSource` citations in `ai_original` carry only `{chunk_id, doc_id, drive_url, doc_title}` —
the spec's KB side panel needs both `doc_owner` (lives on `knowledge_base_chunks.owner`)
AND `chunk_text` (lives on `knowledge_base_chunks.chunk_text`), so a JOIN to
`knowledge_base_chunks ON chunk_id` is required at query time. (5) `transcript_comments`
list is not fetched anywhere yet — needs a new coachingDb read. (6) `bridgeRequest`
helper supports only `POST | PATCH` methods — needs `GET` and `DELETE` for the new client
methods. (7) Two error classes are missing: `EvaluationNotFoundError` (404) and
`ContentRefinementDuplicateError` (409 `content_refinement_duplicate` falls through to
`BridgeTransportError` today). (8) Author display name for transcript comments is not
in the bridge response — only `author_id` (UUID) and `author_role`.

**Spec/code conflict — toast library is absent.** The brief says "Tremor toast" but
Tremor has no toast component, and `package.json` carries no `sonner` /
`react-hot-toast` / `react-toastify`. Existing call-intelligence error feedback uses
inline colored `<div>` banners (Pattern C). The 6 toast strings in the spec become
either inline banners or motivate adding `sonner`. **This is a Bucket 2 question.**

---

## 2. Coaching DB Status

| Table | Verified | Notes |
|---|---|---|
| `evaluations` | ✅ all 22 columns documented | All editable mirror columns present since migration 001 |
| `call_transcripts` | ✅ keyed on `call_note_id` | Renamed from `evaluation_transcripts` in migration 004; transcript JSONB |
| `transcript_comments` | ✅ exists since migration 001 | Migration 037 added `admin` to `author_role` CHECK; hard-delete via SQL predicate |
| `content_refinement_requests` | ✅ exists since migration 001 | Partial-UNIQUE `(requested_by, evaluation_id, doc_id, MD5(current_chunk_excerpt)) WHERE status='open'` enforces 409 |
| `knowledge_base_chunks` | ✅ has `owner` + `chunk_text` | Required JOIN target for KB side panel data |
| `reps` | ✅ has `first_name`, `last_name`, `is_system` | Required JOIN target for `manager_edited_by_name` |

**`ai_original` JSONB schema versions in production: v2, v3, v4, v5.** v2 has the smallest
field set (`dimensionScores`, `narrative`, `strengths`, `weaknesses`, `knowledgeGaps`,
`complianceFlags`); v3 adds `coachingNudge`; v4 adds `additionalObservations`; v5 adds
`repDeferrals`. **5 known v2 rows in production** — the audit toggle MUST handle missing
fields gracefully (defensive optional chaining, NOT crash). Existing `EvalDetailClient.tsx:44-101`
already uses defensive readers; the audit-toggle two-column view should reuse the same
pattern, with a single fallback message ("Schema v{n} not supported in renderer") when
the version is older than what the readers handle. Per data-verifier, the version
constant lives in `src/evaluation/schema.ts` (sales-coaching).

**Immutability:** `ai_original` is enforced immutable by trigger
`trg_prevent_ai_original_update` on `evaluations BEFORE UPDATE`. Manager edits
write to the editable mirror columns only.

**No live BigQuery verification was performed** — this feature touches only Neon
coaching Postgres. Schema claims are grounded in sales-coaching migration SQL +
Zod contract, both authoritative.

---

## 3. Files to Modify

### 3.1 EXISTING — modify

| File | Why |
|---|---|
| `src/lib/sales-coaching-client/index.ts` | Extend `PostOptions.method` to `"GET"\|"POST"\|"PATCH"\|"DELETE"`, skip body+content-type for GET/DELETE, add 404 dispatch (→ `EvaluationNotFoundError`), add 409 `content_refinement_duplicate` dispatch (→ `ContentRefinementDuplicateError`), add 5 new methods on `salesCoachingClient`. |
| `src/lib/sales-coaching-client/errors.ts` | Add `EvaluationNotFoundError extends BridgeError`, `ContentRefinementDuplicateError extends BridgeError`. |
| `src/lib/sales-coaching-client/schemas.ts` | Add `DeleteTranscriptCommentResponse = z.object({ ok: z.literal(true) }).strict()` + inferred `T` alias. (All other 5b-1 schemas already present from byte-for-byte mirror — to be committed in this step.) |
| `src/lib/queries/call-intelligence-evaluations.ts` | Rewrite `getEvaluationDetail()` to SELECT the 12 missing columns + `LEFT JOIN reps editor ON editor.id = e.manager_edited_by AND editor.is_system = false` exposing `manager_edited_by_name`. Add `getTranscriptComments(evaluationId)` (LEFT JOIN reps for `author_full_name`). Add `getKbChunksByIds(chunkIds)` returning `{chunk_id, owner, chunk_text}` for the JOIN-on-demand from the API route. |
| `src/types/call-intelligence.ts` | Expand `EvaluationDetail` with: `dimension_scores`, `narrative`, `strengths`, `weaknesses`, `knowledge_gaps`, `compliance_flags`, `additional_observations`, `coaching_nudge`, `manager_edited_at`, `manager_edited_by`, `manager_edited_by_name`, `ai_original`, `ai_original_schema_version`, `edit_version`, `transcript_comments: TranscriptCommentRow[]`. Add `TranscriptCommentRow`, `KbChunkLookup`, `Citation`, `KbSourceFull` (chunk_id+doc_id+drive_url+doc_title+owner+chunk_text — augmented from KbSource at API time). |
| `src/app/api/call-intelligence/evaluations/[id]/route.ts` | Augment GET to (a) call new `getTranscriptComments(id)` and embed in response, (b) collect citation `chunk_id`s from `ai_original`, call new `getKbChunksByIds(...)` once, build a `chunkLookup: Record<chunkId, {owner, chunk_text}>` and embed in response so the UI can render KB pills + side panel without per-citation round trips. |
| `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` | Replace single-column layout with Pattern E two-pane (left: eval panel, right: transcript). Wire all new components: `<TranscriptViewer>`, `<CitationPill>` rendering, `<KBSidePanel>`, `<RefinementModal>`, `<InlineEdit*>`, `<AuditToggle>`, `<UtteranceCommentComposer>`, `<UtteranceCommentCard>`. Keep existing summary card, reviewer-actions card. Add "Track your refinement requests" link after successful refinement submit. |
| `src/app/dashboard/call-intelligence/tabs/SettingsTab.tsx` | Add small "My refinement requests →" link to `/dashboard/call-intelligence/my-refinements`. |
| `src/lib/utils/freshness-helpers.ts` | Add thin wrapper `formatRelativeTimestamp(isoTs: string): string` so transcript timestamps + comment timestamps + "Last edited 2 min ago" can share one helper. |

### 3.2 NEW — create

| File | Why |
|---|---|
| `src/components/call-intelligence/TranscriptViewer.tsx` | Scrollable utterance list (right pane); selectable text; scroll-to-index ref; renders comments; emits "+ Add comment" on selection. |
| `src/components/call-intelligence/CitationPill.tsx` | Three flavors (transcript / KB / combined); click handlers in props; tooltip on hover. |
| `src/components/call-intelligence/KBSidePanel.tsx` | Slides in over transcript (append-in-place inside Pattern E sticky right pane per Pattern N); `Open in Drive` + `Refine this content`. |
| `src/components/call-intelligence/RefinementModal.tsx` | Pattern F variant 2 (extracted, isOpen prop); textarea with placeholder; client validation (≥20 chars + UI-only placeholder check); error mapping for 400/404/409/5xx. |
| `src/components/call-intelligence/InlineEditDimensionScore.tsx` | Popover with rubric levels + 4 radio buttons; OCC. |
| `src/components/call-intelligence/InlineEditTextField.tsx` | Pattern H toggle for `narrative` and `coaching_nudge`. |
| `src/components/call-intelligence/InlineEditListField.tsx` | List add/remove for `strengths`/`weaknesses`/`knowledge_gaps`/`compliance_flags`/`additional_observations`. |
| `src/components/call-intelligence/AuditToggle.tsx` | Single→two-column dispatch; version-aware fallback. |
| `src/components/call-intelligence/UtteranceCommentComposer.tsx` | Pinned to selected utterance; submit/cancel. |
| `src/components/call-intelligence/UtteranceCommentCard.tsx` | Rendered per comment; author + role badge + relative time; delete `×` (own or admin). |
| `src/components/call-intelligence/MyRefinementsTable.tsx` | Tremor table (self-fetching client component). |
| `src/components/call-intelligence/citation-helpers.ts` | Pure helpers: `inlineCitationsIntoText(text, citations[]) → ReactNode[]`, version-aware `extractCitationsFromAiOriginal(aiObj, version)`. |
| `src/app/api/call-intelligence/evaluations/[id]/edit/route.ts` | PATCH → `salesCoachingClient.editEvaluation`. |
| `src/app/api/call-intelligence/evaluations/[id]/transcript-comments/route.ts` | POST → `salesCoachingClient.createTranscriptComment`. (GET also lives here for the comment list — read via coachingDb pool.) |
| `src/app/api/call-intelligence/transcript-comments/[id]/route.ts` | DELETE → `salesCoachingClient.deleteTranscriptComment`. |
| `src/app/api/call-intelligence/content-refinements/route.ts` | POST → `salesCoachingClient.submitContentRefinement`. |
| `src/app/api/call-intelligence/my-content-refinements/route.ts` | GET → `salesCoachingClient.listMyContentRefinements`. |
| `src/app/dashboard/call-intelligence/my-refinements/page.tsx` | RSC shell: session + page-20 RBAC + redirects, mounts `<MyRefinementsTable>`. |

**No changes needed to:** `src/components/layout/Sidebar.tsx` (page id 20 already
covers the prefix), `prisma/schema.prisma` (coaching DB is outside Prisma —
`coachingDb.ts` direct pool), middleware, NextAuth config.

---

## 4. Type Changes

### 4.1 `src/types/call-intelligence.ts` — `EvaluationDetail`

Add (all optional/nullable to match DB nullability):

```ts
dimension_scores: Record<string, { score: number; rationale?: string }> | null;
narrative: string | null;
strengths: Array<{ text: string; citations?: Citation[] }>;
weaknesses: Array<{ text: string; citations?: Citation[] }>;
knowledge_gaps: Array<{ text: string; citations?: Citation[]; expected_source?: string }>;
compliance_flags: Array<{ text: string; citations?: Citation[] }>;
additional_observations: Array<{ text: string; citations?: Citation[] }>;
coaching_nudge: { text: string; citations?: Citation[] } | null;
manager_edited_at: string | null;        // ISO from TIMESTAMPTZ
manager_edited_by: string | null;        // UUID
manager_edited_by_name: string | null;   // resolved via JOIN reps
ai_original: unknown;
ai_original_schema_version: number;
edit_version: number;
transcript_comments: TranscriptCommentRow[];
chunk_lookup: Record<string, { owner: string; chunk_text: string }>;  // chunk_id → augmentation
```

### 4.2 New types

```ts
export interface TranscriptCommentRow {
  id: string;
  evaluation_id: string;
  utterance_index: number;
  author_id: string;
  author_full_name: string | null;  // null if author is system or rep is deleted
  author_role: 'manager' | 'rep' | 'admin';
  text: string;
  created_at: string;
}

export interface Citation {
  utterance_index?: number;
  kb_source?: { chunk_id: string; doc_id: string; drive_url: string; doc_title: string };
}

export interface KbChunkLookup {
  chunk_id: string;
  owner: string;       // doc_owner badge ("Hipperson" / "Weiner" / "RevOps")
  chunk_text: string;  // KB side panel monospace excerpt
}
```

### 4.3 `src/lib/sales-coaching-client/errors.ts`

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

### 4.4 `src/lib/sales-coaching-client/schemas.ts`

```ts
export const DeleteTranscriptCommentResponse = z.object({ ok: z.literal(true) }).strict();
export type DeleteTranscriptCommentResponseT = z.infer<typeof DeleteTranscriptCommentResponse>;
```

---

## 5. Construction Site Inventory

**Zero `DrillDownRecord` / `DetailRecord` / `ExploreResult` sites.** Coaching data is
entirely outside the BigQuery funnel-master world. Confirmed across all three agents.

**`EvaluationDetail` construction site — single, spread-based (safe to extend).**

`src/lib/queries/call-intelligence-evaluations.ts:275-287`:

```ts
interface RawDetailRow extends Omit<EvaluationDetail, 'overall_score'> { ... }
return {
  ...row,
  overall_score: row.overall_score === null ? null : Number(row.overall_score),
};
```

The spread of `RawDetailRow` carries every column the SQL SELECTs, so adding optional
fields to `EvaluationDetail` is safe **as long as the SQL SELECT is updated to include them**.
However, the new fields `transcript_comments` and `chunk_lookup` are NOT in the row
spread — they must be assembled separately and merged into the return. Recommended:
keep `getEvaluationDetail()` simple and assemble `transcript_comments` and `chunk_lookup`
in the API route handler at `src/app/api/call-intelligence/evaluations/[id]/route.ts`.
That's one merge site composing three independent queries.

**`EvaluationQueueRow`** — explicit return literal (line 218-233). Step 5b-1-UI does NOT
modify the queue row shape. Listed for completeness only.

**`CoachingRep`, `ContentRefinementRow`** — `pool.query<Type>(sql)` populates from SQL
column names. Safe to extend interfaces with new optional fields.

**No funnel-master construction sites** — no changes to `src/lib/queries/funnel/*`,
no changes to BigQuery views, no changes to forecast or AUM calculations.

---

## 6. Recommended Phase Order

1. **Pre-Flight** — `npm run build` baseline, confirm uncommitted `schemas.ts` from byte-for-byte sync compiles.
2. **Phase 1 — Blocking prerequisites:**
   - 2a. Stage + commit the existing uncommitted `src/lib/sales-coaching-client/schemas.ts` byte-for-byte mirror.
   - 2b. Add `DeleteTranscriptCommentResponse` schema + type to `schemas.ts`.
   - 2c. Add `EvaluationNotFoundError` + `ContentRefinementDuplicateError` to `errors.ts`.
   - 2d. Extend `bridgeRequest` to support `GET`/`DELETE` (skip body + content-type).
   - 2e. Add 404 + 409 `content_refinement_duplicate` dispatch arms to `bridgeRequest`.
   - 2f. Add CI check: byte-equality of Dashboard's `schemas.ts` vs sales-coaching's `dashboard-api/schemas.ts` (acceptance test m).
3. **Phase 2 — Utilities:** add `formatRelativeTimestamp` to `freshness-helpers.ts`; add `inlineCitationsIntoText` + `extractCitationsFromAiOriginal` helpers in `src/components/call-intelligence/citation-helpers.ts`.
4. **Phase 3 — Types** *(intentionally breaks build):* expand `EvaluationDetail`; add `TranscriptCommentRow`, `Citation`, `KbChunkLookup`. Build errors surface every spot the new fields are referenced — that becomes the construction site checklist.
5. **Phase 4 — Query layer:** rewrite `getEvaluationDetail()` with the 12-column SELECT + `LEFT JOIN reps`. Add `getTranscriptComments(id)` and `getKbChunksByIds(chunkIds)`.
6. **Phase 5 — Bridge client methods:** add the 5 new methods on `salesCoachingClient`.
7. **Phase 6 — Dashboard API routes:** create the 5 new route files (PATCH edit, POST/GET transcript-comments, DELETE transcript-comment, POST content-refinement, GET my-content-refinements). Augment GET `/api/call-intelligence/evaluations/[id]/route.ts` to merge `transcript_comments` + `chunk_lookup` into the response.
8. **Phase 7 — Components + page:** create the 11 new components in `src/components/call-intelligence/`. Create `MyRefinementsTable` + the `/my-refinements` page. Rewire `EvalDetailClient.tsx` to two-pane layout with all new components. Add Settings link.
9. **Phase 7.5 — Doc sync:** `npm run gen:api-routes` (5 new routes), `npx agent-guard sync`.
10. **Phase 8 — UI/UX validation in browser:** all 13 acceptance tests (a–m), with explicit attention to `(f2)` authority-lost (requires snapshot reassignment fixture), `(i)` v2 audit fallback (5 known v2 rows in production), `(k)` mobile responsive, `(l)` dark mode pass.

Phase 3 is the build-break checklist. Phase 7 is the longest. Phases 4–6 are independent
of each other and can interleave once Phase 3 lands.

---

## 7. Risks and Blockers

### 7.1 BLOCKERS (resolve before Phase 7)

| # | Issue | Source | Fix |
|---|---|---|---|
| B1 | `getEvaluationDetail` missing 12 columns | data-verifier | Phase 4: full rewrite |
| B2 | `manager_edited_by_name` not resolved | data-verifier | Phase 4: `LEFT JOIN reps` |
| B3 | `KbSource` lacks `owner` + `chunk_text` | data-verifier | Phase 4: `getKbChunksByIds` + merge in API route |
| B4 | `ContentRefinementDuplicateError` not dispatched | data-verifier | Phase 1: add class + dispatch arm |
| B5 | `EvaluationDetail` interface incomplete | data-verifier | Phase 3 |
| B6 | `author_full_name` not in bridge response | data-verifier | Resolved on Dashboard side via `LEFT JOIN reps` in `getTranscriptComments` (advisory, not blocker) |
| B7 | `bridgeRequest` only POST/PATCH | code-inspector | Phase 1 |
| B8 | `EvaluationNotFoundError` missing | code-inspector | Phase 1 |
| B9 | `DeleteTranscriptCommentResponse` schema missing | code-inspector | Phase 1 |

### 7.2 SPEC CORRECTIONS (do NOT propagate spec text verbatim into the guide)

| Spec claim | Truth |
|---|---|
| "Migration 037 added new tables" | 037 only adds `admin` to the `transcript_comments.author_role` CHECK; the four tables exist since migration 001 |
| "Tremor toast" | Tremor has no toast component |
| "`src/lib/queries/call-intelligence/`" | Files are flat in `src/lib/queries/` — no subdirectory |
| "`src/components/call-intelligence/`" | Directory does not exist — this step plants it |
| "new helper `getEvaluationWithTranscript(id)`" | The existing `getEvaluationDetail()` already JOINs `call_transcripts`. Don't add a new function — extend the existing one. |
| "calls Dashboard's existing `coachingDb.ts` pool" | Correct, pool exists (max=5, unpooled URL). Confirmed working. |

### 7.3 RISKS (mitigate during implementation)

| Risk | Mitigation |
|---|---|
| **Toast library decision is open** (no library installed; spec calls for toasts) | Bucket 2 question — see Open Questions §1 |
| **Audit toggle on v2 rows** (5 known in production) | Defensive readers throughout `AuditToggle`; explicit fallback message "Schema v{n} not supported" if a future version pre-dates v2 readers |
| **utterance_index orphaning** if transcripts are reprocessed and shortened | Skip rendering comments whose `utterance_index >= transcript.length` (don't crash) |
| **XSS in transcript text + comment text** | All renders via JSX children (auto-escaped). Audit confirms no `dangerouslySetInnerHTML` in 5a-UI; new components must NOT introduce it. |
| **Citation pill click during inline edit** | Disable pill clicks when an inline-edit composer is open (avoid losing in-flight edit text) — call this out in Phase 7 wiring |
| **doc_title length is unbounded** (TEXT, no observed truncation) | UI must `truncate` via CSS (`max-w-[24ch] truncate`); never rely on data being short |
| **KB side panel "Refine this content" must pass current chunk excerpt** | The `chunk_text` from `chunk_lookup` is the `current_chunk_excerpt` payload field — wire directly, don't reuse the truncated tooltip text |
| **Settings tab link to /my-refinements** | Avoid sidebar churn; small inline link only |
| **OCC race with active inline edit** | If a 409 fires mid-edit, freeze further mutation until user clicks Reload (Pattern I says no auto-reload) |
| **Authority-lost vs stale-version disambiguation** | Inspect `error.message.includes('Authority lost')` per spec D2; both shapes confirmed in sales-coaching `src/server.ts:488-542` |

---

## 8. Open Questions (Bucket 2 candidates)

1. **Toast library decision.** The spec describes Tremor toasts; reality is no toast
   library is installed and `package.json` would need `sonner` (recommended) plus
   `<Toaster />` in `src/app/layout.tsx`. **Or** use the existing inline-banner
   pattern (Pattern C) — works but UX differs from spec. The spec's 6 toast strings
   include success notifications + duplicate-suggestion 409 + 404 + 5xx + OCC reload
   prompts + reassignment messages. Banners can render every one of these in-place
   (the 409 stale-version one already lives as a banner today at `EvalDetailClient.tsx:388-401`).

2. **Transcript comment list READ path.** Bridge has no `GET /transcript-comments`.
   Recommended: Dashboard reads directly via `coachingDb.ts` (mirrors the
   `getContentRefinements` pattern). Alternative: add a bridge GET endpoint, which
   needs a sales-coaching change and is out of scope for 5b-1-UI.

3. **404 navigation behavior.** When `EvaluationNotFoundError` fires during inline
   edit, do we (a) auto-route to `?tab=queue`, (b) show toast/banner + keep the user
   on a frozen page with a back link, or (c) do both? Spec text implies (a).

4. **Chunk-lookup augmentation strategy.** Two viable shapes for joining
   `knowledge_base_chunks`: (a) one-shot `getKbChunksByIds(chunkIds)` in the eval
   GET response (recommended — no extra round-trips), or (b) a separate
   `/api/call-intelligence/kb-chunks/[chunk_id]` route called when a KB pill is
   clicked (cheaper if pills are rarely clicked, but adds latency to first click).

5. **Author display name fallback.** When `author_id` resolves to `is_system=true`
   or to a deleted rep, `author_full_name` is `null`. Show "Manager", "Rep", or
   "Admin" (the role label) as fallback?

---

*End of Exploration Synthesis. Proceeding to Phase 2 — Build Guide.*
