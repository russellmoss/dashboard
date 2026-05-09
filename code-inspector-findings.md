# Code Inspector Findings -- Step 5b-1-UI

> Generated: 2026-05-09. Read-only investigation.

---

## 1. Doc Reconciliation

**LLD.md discrepancies (trust the code):**

- LLD lists 36 files under `src/lib/queries/`. Actual count is 41 (includes `call-intelligence-users.ts`, `call-intelligence-refinements.ts`, `call-intelligence-evaluations.ts`, `resolve-advisor-names.ts`, `record-notes.ts`, `record-activity.ts`, `sqo-lag-export.ts`).
- LLD states `src/components/call-intelligence/` is the component home. **This directory does NOT exist.** Step 5a-UI placed all call-intelligence UI as page-colocated files: tabs in `src/app/dashboard/call-intelligence/tabs/`, detail client in `src/app/dashboard/call-intelligence/evaluations/[id]/`. Trust the code.
- LLD mentions `src/lib/queries/call-intelligence/` as a subdirectory. **This subdirectory does NOT exist.** The three call-intelligence query files live flat in `src/lib/queries/`. Trust the code.

**CONSTRAINTS.md:**

- The "all Postgres goes through Prisma" constraint is explicitly carved out by `src/lib/coachingDb.ts:9` for the secondary Neon coaching DB. By design, consistent with the code.
- Migration 037 (`transcript_comments` table) is NOT in `prisma/migrations/` -- lives only in the sales-coaching repo. Consistent with the read-only coaching pool pattern.

**bq-views.md:** No discrepancies. Call-intelligence does not consume any BigQuery views. All reads go through `coachingDb.ts`.

---

## 2. Bridge Client Today

**File:** `src/lib/sales-coaching-client/index.ts`

### Existing methods on `salesCoachingClient` (lines 196-241):

| Method | HTTP | Path | Request Schema | Response Schema |
|---|---|---|---|---|
| `createUser` | POST | `/api/dashboard/users` | `CreateUserRequest` | `CreateUserResponse` |
| `updateUser` | PATCH | `/api/dashboard/users/:id` | `UpdateUserRequest` | `UpdateUserResponse` |
| `deactivateUser` | POST | `/api/dashboard/users/:id/deactivate` | none | `DeactivateUserResponseOk` |
| `bulkReassignPendingEvals` | POST | `/api/dashboard/users/:id/bulk-reassign-pending-evals` | `BulkReassignRequest` | `BulkReassignResponse` |
| `setRevealScheduling` | PATCH | `/api/dashboard/evaluations/:id/reveal-scheduling` | `RevealSchedulingRequest` | `RevealSchedulingResponse` |
| `manualReveal` | POST | `/api/dashboard/evaluations/:id/reveal` | `ManualRevealRequest` | `ManualRevealResponse` |
| `updateRevealPolicy` | PATCH | `/api/dashboard/users/me/reveal-policy` | `UpdateRevealPolicyRequest` | `UpdateRevealPolicyResponse` |
| `resolveContentRefinement` | POST | `/api/dashboard/content-refinements/:id/resolve` | `ContentRefinementResolveRequest` | `ContentRefinementResolveResponse` |

### HMAC token signing:
**File:** `src/lib/sales-coaching-client/token.ts`

- `signDashboardToken(email, { ttlSeconds: 30 })` called at `index.ts:71`
- Algorithm: HMAC-SHA256, key = `DASHBOARD_BRIDGE_SECRET` (min 32 chars), format: `v1.<base64url-payload>.<sig>`
- Payload: `{ email (lowercased), iat, exp }`, 30s TTL (max 60s cap)

### Zod parsing pattern (`index.ts:59-192`):
1. Outgoing body validated against `requestSchema` -- `BridgeValidationError` on mismatch (lines 63-68)
2. Non-2xx: `ErrorResponseSchema.safeParse(json)` extracts `error` code + `message` (lines 110-113)
3. Status dispatch: 401/403 -> `BridgeAuthError`; 409 (by `errCode`) -> `EvaluationConflictError` / `DeactivateBlockedError` / `ContentRefinementAlreadyResolvedError`; 400 -> `BridgeValidationError`; other -> `BridgeTransportError`
4. 2xx: `responseSchema.parse(json)` -- throws `BridgeValidationError` on shape mismatch (line 184)

### Typed error classes (`errors.ts`):

| Class | Extra fields | HTTP |
|---|---|---|
| `BridgeError` (base) | `message`, `status: number`, `requestId?: string` | varies |
| `BridgeAuthError` | none beyond base | 401/403 |
| `BridgeTransportError` | none beyond base | network/5xx |
| `BridgeValidationError` | `issues: unknown` | 400/local Zod |
| `EvaluationConflictError` | `evaluationId: string`, `expectedVersion: number`, `actualVersion: number|null` | 409 |
| `DeactivateBlockedError` | `blocked_reason`, `blocking_count`, `blocking_eval_ids?`, `blocking_rep_ids?` | 409 |
| `ContentRefinementAlreadyResolvedError` | `currentStatus: "addressed"|"declined"` | 409 |

All classes expose `.message` (inherited from `Error`). No `DashboardRoleError` or `DashboardAuthError` class exists in Dashboard code -- these are server-side concepts in sales-coaching, surfaced to Dashboard as `BridgeAuthError` (403).

### Missing error classes for Step 5b-1:

**`EvaluationNotFoundError` (404):** Does NOT exist. Bridge maps 404 to generic `BridgeTransportError` today. For `/evaluations/:id/edit`, a 404 means the eval was deleted or reassigned. Plan: add `EvaluationNotFoundError extends BridgeError` to `errors.ts` (no extra fields). Handle in `bridgeRequest` after the 403 block: `if (status === 404) throw new EvaluationNotFoundError(errMsg, 404, requestId)`.

**`ContentRefinementDuplicateError` (409 `content_refinement_duplicate`):** Does NOT exist. Plan: add `ContentRefinementDuplicateError extends BridgeError` to `errors.ts`. Handle in 409 dispatch block: `if (errCode === "content_refinement_duplicate") throw new ContentRefinementDuplicateError(...)`.

**`RequestValidationError`:** NOT needed as a separate class. `BridgeValidationError` already carries `issues: unknown` and covers 400. `ErrorResponseSchema` (schemas.ts:485) already has `issues: z.array(z.unknown()).optional()`. Client at `index.ts:162-169` already passes raw `errorJson` for 400. No new class needed.

### 5 new methods to add to `salesCoachingClient`:

1. **`editEvaluation(email, evalId, body)`** -- `PATCH /api/dashboard/evaluations/:id/edit`, `EditEvaluationRequest`, `EditEvaluationResponse`, context: `{ evaluationId: evalId, expectedEditVersion: body.expected_edit_version }`

2. **`createTranscriptComment(email, evalId, body)`** -- `POST /api/dashboard/evaluations/:id/transcript-comments`, `TranscriptCommentCreateRequest`, `TranscriptCommentResponse`

3. **`deleteTranscriptComment(email, commentId)`** -- `DELETE /api/dashboard/transcript-comments/:id`, no body, response: new `DeleteTranscriptCommentResponse` schema (`{ ok: true }`). **IMPORTANT:** `PostOptions.method` at `index.ts:49` is typed as `"POST" | "PATCH"` only. Must extend to `"GET" | "POST" | "PATCH" | "DELETE"` and skip body serialization + `Content-Type` header for GET/DELETE.

4. **`submitContentRefinement(email, body)`** -- `POST /api/dashboard/content-refinements`, `ContentRefinementCreateRequest`, `ContentRefinementResponse`. Must dispatch `ContentRefinementDuplicateError` on 409 `errCode === "content_refinement_duplicate"`.

5. **`listMyContentRefinements(email)`** -- `GET /api/dashboard/my-content-refinements`, no body, `MyContentRefinementsResponse`. Requires GET method support in `bridgeRequest` (same fix as method 3).

---

## 3. Schemas Today (After Byte-for-Byte Sync)

**File:** `src/lib/sales-coaching-client/schemas.ts`
Status: M (uncommitted working tree). All Step 5b-1-API schemas are already present.

### Step 5a schemas (lines 75-297):
`CreateUserRequest`, `CreateUserResponse`, `UpdateUserRequest`, `UpdateUserResponse`, `DeactivateUserResponseOk`, `DeactivateUserResponseBlocked`, `BulkReassignRequest`, `BulkReassignResponse`, `RevealSchedulingRequest`, `RevealSchedulingResponse`, `ManualRevealRequest`, `ManualRevealResponse`, `UpdateRevealPolicyRequest`, `UpdateRevealPolicyResponse`, `ContentRefinementResolveRequest`, `ContentRefinementResolveResponse`, `ErrorResponseSchema` (includes `issues: z.array(z.unknown()).optional()` at line 485 -- covers Step 5b-1-API 400 shape).

### Step 5b-1 schemas -- ALL PRESENT in working tree (lines 299-519):

- `KbSourceDashSchema` (line 308): `{ chunk_id: uuid, doc_id: string, drive_url: url, doc_title: string }` -- file-scoped, not exported
- `CitationSchema` (line 317): `{ utterance_index?: int>=0, kb_source?: KbSourceDash }` with `.refine(at least one required)` -- file-scoped
- `citationArrayDash` (line 328): `z.array(CitationSchema)` -- allows empty (manager edits need not re-cite)
- `CitedTextDashSchema`, `CitedClaimDashSchema`, `KnowledgeGapDashSchema`, `DimensionScoreDashSchema` -- file-scoped helpers
- **`EditEvaluationRequest`** (line 358): exported. Fields: `expected_edit_version` (int min 1), `overall_score` (1-4 optional), `dimension_scores` (record optional), `narrative` (optional), `strengths`/`weaknesses`/`knowledge_gaps`/`compliance_flags`/`additional_observations` (arrays optional), `coaching_nudge` (nullable optional). Uses `.strict()`.
- **`EditEvaluationResponse`** (line 374): exported. `{ evaluation: z.unknown() }` -- server returns full eval; Dashboard does not parse inner shape.
- **`TranscriptCommentCreateRequest`** (line 382): exported. `{ utterance_index: int>=0, text: string trim min1 max4000 }`
- **`TranscriptCommentResponse`** (line 389): exported. `{ comment: { id, evaluation_id, utterance_index, author_id, author_role: "manager"|"rep"|"admin", text, created_at } }`
- **`ContentRefinementCreateRequest`** (line 410): exported. `{ evaluation_id: uuid, doc_id: string, drive_url: url, current_chunk_excerpt: string, suggested_change: string trim min20 }`
- **`ContentRefinementResponse`** (line 423): exported. `{ request: { id, evaluation_id, doc_id, drive_url, current_chunk_excerpt, suggested_change, requested_by, status: "open"|"addressed"|"declined", created_at } }`
- **`MyContentRefinementsResponse`** (line 443): exported. `{ requests: array<{ id, evaluation_id, doc_id, drive_url, current_chunk_excerpt, suggested_change, status, resolved_by|null, resolved_at|null, resolution_notes|null, created_at }> }`

### Missing schemas (must add to schemas.ts):
- `DeleteTranscriptCommentResponse`: `z.object({ ok: z.literal(true) }).strict()` -- add, export, add `DeleteTranscriptCommentResponseT` type alias

### Inferred types already exported (lines 492-519):
`EditEvaluationRequestT`, `EditEvaluationResponseT`, `TranscriptCommentCreateRequestT`, `TranscriptCommentResponseT`, `ContentRefinementCreateRequestT`, `ContentRefinementResponseT`, `MyContentRefinementsResponseT` -- all present.

---

## 4. Eval Detail Page + Components Today (Step 5a-UI)

### RSC page (thin shell):
**File:** `src/app/dashboard/call-intelligence/evaluations/[id]/page.tsx` (28 lines)

Pure RSC. Auth checks at lines 18-24: session, permissions, page-20 RBAC, recruiter -> `/dashboard/recruiter-hub`, capital_partner -> `/dashboard/gc-hub`. Passes `id`, `role`, and `returnTab` (`?returnTab=` search param, defaults to `"queue"`) to `EvalDetailClient`.

No `layout.tsx` at `src/app/dashboard/call-intelligence/layout.tsx` -- **confirmed absent**. Tab nav lives entirely in `CallIntelligenceClient.tsx`, not in a layout file.

### Client component:
**File:** `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` (478 lines)

`"use client"` at line 1. State: `detail (EvaluationDetail|null)`, `loading`, `error`, `actionPending`, `actionError`, `conflict (ConflictState)`, `customDelay`. Data fetching: client-side `fetch()` at line 169 inside `load()` useCallback. NOT RSC with Server Actions.

`ConflictState` (line 22): `{ expectedVersion: number, message: string }`.

### Layout rendered today:
1. Back link (`<ArrowLeft>`) to `?tab=${returnTab}` (line 269)
2. Summary card -- `grid-cols-2 md:grid-cols-4` with 8 `<Field>`: Rep, Reviewer, Call date, Created, Status, Edit version, Reveal policy, Scheduled reveal (lines 275-286)
3. "AI Evaluation" card -- `OverallScoreBadge` + `DimensionBar` rows (lines 288-300)
4. "Narrative" card -- `<p className="whitespace-pre-wrap">` (lines 302-307)
5. "Coaching nudge" card -- italic paragraph (lines 309-315)
6. Strengths / "Areas for improvement" -- `grid-cols-1 md:grid-cols-2` with `BulletList` (lines 316-331)
7. Knowledge gaps -- `<ul>` with `expected_source` badge (lines 333-350)
8. Rep deferrals -- border-left `<li>` with `topic` + `deferral_text` (lines 352-365)
9. Compliance flags -- `BulletList` (lines 366-370)
10. Additional observations -- `BulletList` (lines 372-377)
11. Call summary -- `<pre className="whitespace-pre-wrap">` (lines 379-385)
12. Reviewer actions card -- hold / custom_delay / use_default / reveal_now buttons; only shown when `isManagerView && status === "pending_review"` (lines 387-465)

### Dark mode pattern (confirmed consistent):
Every Tremor `<Card>` uses `dark:bg-gray-800 dark:border-gray-700`. Text uses `dark:text-gray-*` variants. Representative examples: `EvalDetailClient.tsx:127`, `:148`, `:275`, `:289`, `:303`, `:310`. Pattern is uniform -- every new card in Step 5b-1 must follow `dark:bg-gray-800 dark:border-gray-700`.

### `ai_original` and `ai_original_schema_version`:
- Fetched at `call-intelligence-evaluations.ts:259-260`; typed `ai_original: unknown`, `ai_original_schema_version: number|null` at `types/call-intelligence.ts:53-54`
- `EvalDetailClient.tsx:252` reads `aiObj = isObj(detail.ai_original) ? detail.ai_original : {}` then calls version-agnostic helper readers (lines 44-101)
- `ai_original_schema_version` is fetched but **NOT YET READ** in the UI -- `AuditToggle` needs to dispatch on it
- Both fields already available in `detail` from the existing `/api/call-intelligence/evaluations/:id` endpoint -- no new fetch required

### Transcript field:
- `EvaluationDetail.transcript: unknown | null` at `types/call-intelligence.ts:56`
- `getEvaluationDetail()` at `call-intelligence-evaluations.ts:262` SELECTs `ct.transcript`; line 269 LEFT JOINs `call_transcripts ct ON ct.call_note_id = e.call_note_id`
- Transcript table: `call_transcripts`. Column: `transcript` (JSONB, typed `unknown` in Dashboard)
- `EvalDetailClient.tsx` fetches `detail.transcript` but **renders nothing with it** -- `TranscriptViewer` can consume it directly from the existing API response without any new query

### `CallIntelligenceClient.tsx` (tab host):
**File:** `src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx` (81 lines)

Tab enum: `"queue" | "settings" | "admin-users" | "admin-refinements"` (line 16). In-page `<nav>` buttons -- NOT sidebar entries. `my-refinements` is not a tab and not in the sidebar (confirmed).

---

## 5. New Components Needed

**Convention:** Step 5a-UI placed tab components in `src/app/dashboard/call-intelligence/tabs/` (page-colocated). For Step 5b-1, components shared across the eval-detail page AND the my-refinements page should live in a NEW shared directory: `src/components/call-intelligence/` (per CONSTRAINTS.md naming conventions). Page-specific one-off components can remain colocated.

### A. `TranscriptViewer`
**Path:** `src/components/call-intelligence/TranscriptViewer.tsx`

Scrollable container (fixed max-height, `overflow-y-auto`) for the right pane (~50% width at >=1024px, full-width below). Maps `detail.transcript` (unknown JSONB) defensively -- needs a local `TranscriptUtterance` interface. Per-utterance: speaker badge (role-colored), relative timestamp (absolute on hover), `utterance_index` marker, selectable text trigger. Renders `UtteranceCommentComposer` after selection; renders `UtteranceCommentCard` list per utterance. Exposes scroll-to-index ref for citation-pill navigation.

Props: `transcript: unknown`, `comments: TranscriptCommentT[]`, `onAddComment: (utteranceIndex: number, text: string) => void`, `onDeleteComment: (commentId: string) => void`, `role: string`, `currentRepId: string`

### B. `CitationPill`
**Path:** `src/components/call-intelligence/CitationPill.tsx`

Three flavors: `type: "transcript" | "kb" | "combined"`. Transcript pill: shows `utterance_index`, click scrolls `TranscriptViewer`. KB pill: shows `doc_title` abbreviation, click opens `KBSidePanel`. Combined: both icons.

Props: `citation` (local `CitationT` type mirroring `CitationSchema`), `onScrollToUtterance?: (idx: number) => void`, `onOpenKB?: (kbSource: KbSourceT) => void`

### C. `KBSidePanel`
**Path:** `src/components/call-intelligence/KBSidePanel.tsx`

Slides over transcript pane (fixed or absolute, right-side). Shows: `doc_title`, `drive_url` folder path (parsed from URL), `chunk_text` in `<pre>` monospace (see open question 4), "Open in Drive" link, "Refine this content" button.

Props: `kbSource: KbSourceT | null`, `onClose: () => void`, `onOpenRefinement: (kbSource: KbSourceT) => void`

### D. `RefinementModal`
**Path:** `src/components/call-intelligence/RefinementModal.tsx`

Fixed overlay (mirrors `AdminRefinementsTab.tsx:176`: `fixed inset-0 bg-black/40 flex items-center justify-center z-50`). `<textarea>` with placeholder; client validation: min 20 chars after trim (mirrors `ContentRefinementCreateRequest:419`). Calls `POST /api/call-intelligence/content-refinements` (new Dashboard API route). Error mapping: 400 -> field issues inline; 409 `content_refinement_duplicate` -> toast string 2; 404 -> toast string 3; 5xx -> toast string 4. Success -> close + toast string 1.

Props: `open: boolean`, `kbSource: KbSourceT`, `evaluationId: string`, `onClose: () => void`, `onSuccess: () => void`

### E. `InlineEditDimensionScore`
**Path:** `src/components/call-intelligence/InlineEditDimensionScore.tsx`

Popover anchored to a dimension row in the eval panel (left pane). 4 radio buttons (1-4) with rubric level labels. Save calls `PATCH /api/call-intelligence/evaluations/:id/edit` with `{ expected_edit_version, dimension_scores: { [dimName]: { score, citations: [] } } }`. OCC conflict banner on `EvaluationConflictError` (409).

Props: `dimensionName: string`, `currentScore: number`, `editVersion: number`, `evaluationId: string`, `onSaved: (newScore: number, newEditVersion: number) => void`, `role: string`

### F. `InlineEditTextField`
**Path:** `src/components/call-intelligence/InlineEditTextField.tsx`

Plain text `<textarea>` (NOT rich text -- `CitedTextDashSchema.text` is a plain string). Save/Cancel. Save calls PATCH edit endpoint for `narrative` or `coaching_nudge`.

Props: `fieldName: "narrative" | "coaching_nudge"`, `currentText: string | null`, `editVersion: number`, `evaluationId: string`, `onSaved: (newVersion: number) => void`

### G. `InlineEditListField`
**Path:** `src/components/call-intelligence/InlineEditListField.tsx`

For `strengths`, `weaknesses`, `knowledge_gaps`, `compliance_flags`, `additional_observations`. Add-item `<input>` + existing items as chips with delete. Save calls PATCH edit endpoint with the full updated array (not a diff).

Props: `fieldName: string`, `currentItems: Array<{ text: string }>`, `editVersion: number`, `evaluationId: string`, `onSaved: (newVersion: number) => void`

### H. `AuditToggle`
**Path:** `src/components/call-intelligence/AuditToggle.tsx`

Toggle: "Canonical view" (OFF default) vs "AI original + edited comparison" (ON). Two-column when ON: left = `ai_original` content, right = current evaluation content. Dispatches on `ai_original_schema_version` for version-aware field availability. `detail.ai_original` and `detail.ai_original_schema_version` are already fetched and available in `EvaluationDetail` -- no new fetch needed.

Props: `evaluation: EvaluationDetail`, `enabled: boolean`, `onToggle: () => void`

### I. `UtteranceCommentComposer`
**Path:** `src/components/call-intelligence/UtteranceCommentComposer.tsx`

Appears below a selected utterance after text selection. Single `<textarea>` + Submit + Cancel. Calls `POST /api/call-intelligence/evaluations/:id/transcript-comments` (new route).

Props: `evaluationId: string`, `utteranceIndex: number`, `onSubmitted: (comment: TranscriptCommentResponseT["comment"]) => void`, `onCancel: () => void`

### J. `UtteranceCommentCard`
**Path:** `src/components/call-intelligence/UtteranceCommentCard.tsx`

Rendered below utterance card per comment. Shows: author name (resolved -- see open question 5), `author_role` badge, relative time, delete x (own or admin). Delete calls `DELETE /api/call-intelligence/transcript-comments/:id` (new route).

Props: `comment: TranscriptCommentResponseT["comment"]`, `authorFullName: string | null`, `currentRepId: string`, `isAdmin: boolean`, `onDeleted: (id: string) => void`

### K. `MyRefinementsTable`
**Path:** `src/components/call-intelligence/MyRefinementsTable.tsx`

Tremor table (mirrors `AdminRefinementsTab.tsx` dark-mode style). Columns: Created, Doc (`drive_url` link), Suggested change excerpt, Status badge, Resolution notes (when resolved). Row links to `/dashboard/call-intelligence/evaluations/:evaluation_id?returnTab=queue`. Self-fetching from `GET /api/call-intelligence/my-content-refinements`.

Props: none (self-fetching client component)

---

## 6. New Query -- `getEvaluationWithTranscript`

### Pool confirmed:
**File:** `src/lib/coachingDb.ts`
`getCoachingPool()` returns `pg.Pool` (max 5 connections, `SALES_COACHING_DATABASE_URL_UNPOOLED`). Available for new read-only queries.

### Key finding: `getEvaluationDetail()` ALREADY fetches the transcript. No new query function is needed.
**File:** `src/lib/queries/call-intelligence-evaluations.ts:237-287`

- Line 262: `ct.transcript` already in SELECT
- Line 269: `LEFT JOIN call_transcripts ct ON ct.call_note_id = e.call_note_id` already in query
- `EvaluationDetail.transcript: unknown | null` at `types/call-intelligence.ts:56` already in type
- `TranscriptViewer` can consume `detail.transcript` from the existing `/api/call-intelligence/evaluations/:id` response
- **No new `getEvaluationWithTranscript` function needed.** Existing query covers it.

### Transcript schema (coachingDb side):
- Table: `call_transcripts`; join key: `call_transcripts.call_note_id = evaluations.call_note_id` (`call-intelligence-evaluations.ts:269`)
- Column: `transcript` (JSONB, typed `unknown` in Dashboard)
- Utterance shape NOT defined in Dashboard types. Step 5b-1 must add a local `TranscriptUtterance` interface with a defensive reader, following the same pattern as `EvalDetailClient.tsx:44-101` (`readText`, `readDimensionScores`, etc.)

### `transcript_comments` table:
- NOT in `prisma/migrations/` -- lives only in the sales-coaching Neon DB (migration 037)
- Dashboard does not write to `transcript_comments` -- all writes go through the bridge client
- For READS, two options (see open question 1):
  - **Option A (recommended):** Add `getTranscriptComments(evalId)` to `src/lib/queries/call-intelligence-evaluations.ts` using `getCoachingPool()`, mirroring `getContentRefinements` in `call-intelligence-refinements.ts`. Query: `SELECT tc.id, tc.evaluation_id, tc.utterance_index, tc.author_id, r.full_name AS author_full_name, tc.author_role, tc.text, tc.created_at FROM transcript_comments tc LEFT JOIN reps r ON r.id = tc.author_id WHERE tc.evaluation_id = $1 ORDER BY tc.utterance_index ASC, tc.created_at ASC`
  - Option B (bridge GET): Not in current `schemas.ts` -- would require a new bridge method on the sales-coaching side

### Write traffic routing (consistent with Step 5a-UI):
- All WRITES (eval-edit, comment-create, comment-delete, refinement-create): `EvalDetailClient` -> Dashboard API route -> `salesCoachingClient` -> sales-coaching
- All READS for eval+transcript: `EvalDetailClient` -> `/api/call-intelligence/evaluations/:id` -> `getEvaluationDetail()` -> `coachingDb` pool
- This pattern matches how `getContentRefinements` (read) and `resolveContentRefinement` (write) are split today

---

## 7. New Sub-Route -- `/my-refinements`

### Confirmed absent today:
- `src/app/dashboard/call-intelligence/my-refinements/` directory does NOT exist
- `/api/call-intelligence/my-content-refinements` route does NOT exist

### Sidebar: no changes needed.
**File:** `src/components/layout/Sidebar.tsx:53`
`{ id: 20, name: "Call Intelligence", href: "/dashboard/call-intelligence", icon: PhoneCall }`. The `/dashboard/call-intelligence/my-refinements` route falls under page id 20 by RBAC prefix. Spec confirms: not a tab, reachable from eval-detail link + Settings tab link. No new PAGES entry needed.

### Middleware: no changes needed.
`/dashboard/call-intelligence/*` is covered by existing page-20 `allowedPages` check in RSC pages and middleware prefix matching.

### Files to create:

**Page (RSC shell):** `src/app/dashboard/call-intelligence/my-refinements/page.tsx`
Same pattern as `evaluations/[id]/page.tsx`: session check, permissions, page-20 RBAC, recruiter/capital_partner redirects. Passes `role` to a thin client shell or renders `MyRefinementsTable` directly.

**API route (new):** `src/app/api/call-intelligence/my-content-refinements/route.ts`
GET handler. Session + page-20 RBAC. Calls `salesCoachingClient.listMyContentRefinements(email)`. Returns `{ rows: MyContentRefinementsResponse.requests }`. Error handling: same `BridgeAuthError`, `BridgeTransportError`, `BridgeValidationError` dispatch as `reveal-scheduling/route.ts`.

---

## 8. Toast Infrastructure

### Status: NO toast library installed.
- `package.json`: no `sonner`, `react-hot-toast`, `react-toastify`, or equivalent
- `src/app/layout.tsx`: no `<Toaster />` -- only `SessionProviderWrapper`, `ThemeProvider`, Vercel `<Analytics />`
- Only toast-related code in source: COMMENTS in `src/app/dashboard/page.tsx:336,804`: `// You can add toast notification here: toast.error(errorMessage);`
- Tremor `@3.18.7` does NOT include a toast component

### Current success/error feedback pattern in call-intelligence:
Inline colored `<div>` banners within the active card:
- `SettingsTab.tsx:222-228`: `saveError` (red div) and `saveSuccess` (green div) inside form card
- `EvalDetailClient.tsx:388-401`: `ConflictState` -> amber banner with Reload button
- `EvalDetailClient.tsx:461-463`: `actionError` -> red div below buttons
- `AdminRefinementsTab.tsx:74-79`: per-row `rowError` inline below action buttons
- `AdminRefinementsTab.tsx:176-216`: decline modal with inline error state

### Required toast strings for Step 5b-1 (6 strings from spec):
1. "Refinement request sent to RevOps. They'll review and update the source doc." -- success after `submitContentRefinement`
2. "You already have an open suggestion on this chunk -- track it on My Refinements." -- 409 `content_refinement_duplicate`
3. "This evaluation is no longer available." -- 404 on eval edit or comment submit
4. "Something went wrong. Please try again." -- 5xx generic
5. "Another manager just edited this evaluation -- click to reload with their changes" -- `EvaluationConflictError` on inline edit
6. "This evaluation was reassigned to another manager" -- reassignment 409 (if bridge surfaces it)

### Decision required:
Without a toast library, all 6 strings must fall back to inline div banners -- inconsistent with spec UX intent. Recommendation: add `sonner` to `package.json` and place `<Toaster />` in `src/app/layout.tsx` (global) or `src/app/dashboard/layout.tsx` (dashboard-scoped). This would be the only file outside `src/app/dashboard/call-intelligence/` that changes in Step 5b-1 (if toast is added here).

---

## 9. Construction Sites

### DrillDownRecord / DetailRecord / ExploreResult:
Confirmed: **ZERO** such construction sites exist in `src/app/dashboard/call-intelligence/` or `src/lib/queries/call-intelligence-*.ts`. Coaching data is entirely outside the BigQuery funnel-master world. No funnel-type construction sites need updating for Step 5b-1.

### `EvaluationDetail` construction site -- **SINGLE site**:
**File:** `src/lib/queries/call-intelligence-evaluations.ts:275-287`

```typescript
interface RawDetailRow extends Omit<EvaluationDetail, "overall_score"> { ... }  // line 275
return {
  ...row,  // spread of RawDetailRow -- includes all fields from SQL
  overall_score: row.overall_score === null ? null : Number(row.overall_score),
};
```

Uses spread of `RawDetailRow`. Adding optional fields to `EvaluationDetail` is safe -- the spread includes them automatically from the SQL result, as long as the field is added to the SQL SELECT. No manual enumeration required.

If `transcript_comments` were added as a field on `EvaluationDetail` (embedded read), this construction site at line 281 would need a new field. Per Section 6, comments will use a separate coachingDb read -- so `EvaluationDetail` stays unchanged for Step 5b-1.

### `EvaluationQueueRow` construction site -- explicit return literal:
**File:** `src/lib/queries/call-intelligence-evaluations.ts:188-233`

Uses explicit `return { ... }` object literal (lines 218-233). Adding a field to `EvaluationQueueRow` requires updating BOTH the SQL SELECT AND this literal. Step 5b-1 does NOT modify the queue row shape -- informational only.

### `CoachingRep` and `ContentRefinementRow`:
Both use `pool.query<Type>(sql)` -- pg-node populates fields from SQL column names; no manual construction. Safe to extend interfaces with new optional fields if SQL is updated.

---

## 10. Open Questions

**1. Transcript comment READ path:**
The 5 Step 5b-1 bridge endpoints in `schemas.ts` do NOT include a `GET /transcript-comments` list method. Two options: (A -- recommended) add `getTranscriptComments(evalId)` to `src/lib/queries/call-intelligence-evaluations.ts` using `coachingDb`, mirroring `getContentRefinements` in `call-intelligence-refinements.ts`; (B) embed comments in the eval-detail response. If Option A, add a new `TranscriptCommentRow` interface to `src/types/call-intelligence.ts` and a new Dashboard API GET route `src/app/api/call-intelligence/evaluations/[id]/transcript-comments/route.ts`.

**2. Toast library install:**
Confirm whether to add `sonner` (or equivalent) in Step 5b-1. If yes: add to `package.json` dependencies and add `<Toaster />` to `src/app/layout.tsx` or `src/app/dashboard/layout.tsx`. If no: spec toast strings become inline div banners -- update implementation guide accordingly.

**3. `bridgeRequest` GET/DELETE support:**
`PostOptions.method` at `index.ts:49` is typed as `"POST" | "PATCH"` only. Must extend to `"GET" | "POST" | "PATCH" | "DELETE"` and skip body serialization + `Content-Type` header for GET/DELETE. Small change to the `bridgeRequest` helper, required by methods 3 (`deleteTranscriptComment`) and 5 (`listMyContentRefinements`).

**4. KB `chunk_text` source:**
`KbSourceDashSchema` (schemas.ts:308) contains `chunk_id`, `doc_id`, `drive_url`, `doc_title` but NOT `chunk_text`. `KBSidePanel` needs `chunk_text` to display the source passage. Options: (A) `chunk_text` is embedded in citation objects inside `ai_original` by the evaluator; (B) a new Dashboard API endpoint fetches the chunk by `chunk_id` from the coaching DB `kb_chunks` table; (C) `KBSidePanel` omits `chunk_text` and shows only metadata. Requires clarification from spec or sales-coaching DB schema.

**5. Author name resolution for `UtteranceCommentCard`:**
`TranscriptCommentResponse.comment.author_id` is a UUID. The card needs a human-readable name. If Option A from question 1 is used (coachingDb JOIN on `reps`), the read query can return `author_full_name` directly alongside the comment. If the bridge path is used, the bridge must return `full_name` in the comment object. This decision determines the `UtteranceCommentCard` props signature.

**6. `AuditToggle` version dispatch granularity:**
`EvalDetailClient.tsx` already uses version-agnostic defensive readers that skip missing fields. The `AuditToggle` two-column view can reuse these for both the AI-original and current columns without strict per-version rendering. Confirm whether per-version strict rendering is needed or whether the defensive readers are sufficient for the spec's version-aware requirement.

**7. `EvaluationNotFoundError` navigation behavior:**
When 404 fires during inline edit (eval deleted/reassigned), toast string 3 fires: "This evaluation is no longer available." Should the UI auto-navigate to the queue, or show the toast and let the user click the existing Back link? Spec string is clear; navigation behavior is unspecified.

**8. New Dashboard API routes needed (5 new files):**

| File | HTTP | Bridge method |
|---|---|---|
| `src/app/api/call-intelligence/evaluations/[id]/edit/route.ts` | PATCH | `editEvaluation` |
| `src/app/api/call-intelligence/evaluations/[id]/transcript-comments/route.ts` | POST | `createTranscriptComment` |
| `src/app/api/call-intelligence/transcript-comments/[id]/route.ts` | DELETE | `deleteTranscriptComment` |
| `src/app/api/call-intelligence/content-refinements/route.ts` | POST | `submitContentRefinement` |
| `src/app/api/call-intelligence/my-content-refinements/route.ts` | GET | `listMyContentRefinements` |

All 5 follow the same auth + error-dispatch pattern as `src/app/api/call-intelligence/evaluations/[id]/reveal-scheduling/route.ts`. DELETE is a novel HTTP method not used by any existing call-intelligence route -- confirm Next.js App Router export is `export async function DELETE(request, ctx) { ... }`.

---

*End of Code Inspector Findings for Step 5b-1-UI*
