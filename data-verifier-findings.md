# Data Verifier Findings -- Step 5b-1-UI Call Intelligence

**Date**: 2026-05-09
**Feature**: eval-detail sub-route /dashboard/call-intelligence/evaluations/[id] + /dashboard/call-intelligence/my-refinements

---

## 1. Verification Method

Sources consulted in priority order:

1. **Sibling sales-coaching repo** -- confirmed present at C:/Users/russe/Documents/sales-coaching/
   Migration files read: 001_initial_schema.sql, 004_rekey_call_transcripts.sql, 011_evaluations_additional_observations.sql, 018_ai_feedback_and_eval_audit.sql, 024_evaluations_coaching_nudge.sql, 028_rep_deferral_capture.sql, 036_step5a_api.sql, 037_step5b1_admin_author_role.sql.
   Also read: src/evaluation/schema.ts, src/lib/db/types.ts, src/server.ts (lines 488-542), src/lib/errors.ts, src/lib/db/evaluations.ts, src/lib/db/transcript-comments.ts, src/lib/db/content-refinements.ts.
2. **Dashboard Zod mirror**: src/lib/sales-coaching-client/schemas.ts (byte-for-byte contract).
3. **Dashboard query layer**: src/lib/queries/call-intelligence-evaluations.ts, call-intelligence-refinements.ts, src/app/api/call-intelligence/evaluations/[id]/route.ts.
4. **Dashboard types**: src/types/call-intelligence.ts, src/lib/sales-coaching-client/errors.ts.
5. **Live Postgres queries**: NOT run -- Neon connection string not available in this session. All schema claims are grounded in migration SQL and DAL code, which are authoritative.

---

## 2. Table/Column Verification -- getEvaluationWithTranscript Read Path

### 2.1 evaluations table (source of truth: migration 001, extended through 028)

| Column | Type | Nullable | Added In |
|--------|------|----------|----------|
| id | UUID PK | NO | 001 |
| call_note_id | VARCHAR(255) | YES | 001 |
| rep_id | UUID FK->reps | YES | 001 |
| manager_id | UUID FK->reps | YES | 001 |
| rubric_id | UUID FK->evaluation_rubrics | NO | 001 |
| ai_original | JSONB | YES | 001 |
| ai_original_schema_version | INTEGER | NO DEFAULT 2 | 001 |
| manager_notes | TEXT | YES | 001 |
| score | NUMERIC(5,2) | YES | 001 |
| edit_version | INTEGER NOT NULL DEFAULT 0 | NO | 001 |
| edit_source | TEXT CHECK IN (ai,manager,dashboard_api) | YES | 001/036 |
| manager_edited_at | TIMESTAMPTZ | YES | 001 |
| manager_edited_by | UUID | YES | 001 |
| dimension_scores | JSONB | YES | 001 |
| narrative | TEXT | YES | 001 |
| strengths | JSONB DEFAULT [] | YES | 001 |
| weaknesses | JSONB DEFAULT [] | YES | 001 |
| knowledge_gaps | JSONB DEFAULT [] | YES | 001 |
| compliance_flags | JSONB DEFAULT [] | YES | 001 |
| coaching_nudge | JSONB | YES | 024 |
| additional_observations | JSONB NOT NULL DEFAULT [] | NO | 011 |
| rep_deferrals | JSONB NOT NULL DEFAULT [] | NO | 028 |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | NO | 001 |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | NO | 001 |
| source_deleted_at | TIMESTAMPTZ | YES | 018 |

**Immutability enforcement**: Trigger trg_prevent_ai_original_update on evaluations BEFORE UPDATE blocks any change to ai_original after it is set. No app-layer guard can bypass this.

### 2.2 call_transcripts table (source of truth: migration 001 as evaluation_transcripts, renamed in 004)

| Column | Type | Notes |
|--------|------|-------|
| call_note_id | VARCHAR(255) PK | Re-keyed in migration 004 (was evaluation_id UUID) |
| transcript | JSONB | Array of TranscriptUtterance objects |
| created_at | TIMESTAMPTZ | |

**Join key**: call_transcripts.call_note_id = evaluations.call_note_id
Dashboard query LEFT JOIN call_transcripts ct ON ct.call_note_id = e.call_note_id is correct.
Old name evaluation_transcripts is GONE -- any code referencing it will 42P01.

### 2.3 transcript_comments table (source of truth: migration 001, extended in 037)

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK DEFAULT gen_random_uuid() | |
| evaluation_id | UUID FK->evaluations ON DELETE CASCADE | |
| utterance_index | INTEGER NOT NULL | 0-based index into transcript array |
| author_id | UUID NOT NULL | FK->reps.id or dashboard_user_id |
| author_role | TEXT CHECK IN (manager,rep,admin) | admin added in migration 037 |
| text | TEXT NOT NULL | No length cap in schema |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**No author_name column**: Display name is NOT stored. See Blocker B6.
**Hard-delete pattern**: deleteTranscriptCommentWithAuthority() uses atomic DELETE WHERE id=$1 AND ($2::boolean OR author_id=$3::uuid) -- authority embedded in SQL predicate, no soft delete.
**No utterance_index FK**: utterance_index is an integer with no referential constraint to transcript array bounds -- app must validate range.

### 2.4 content_refinement_requests table (source of truth: migration 001)

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK DEFAULT gen_random_uuid() | |
| evaluation_id | UUID FK->evaluations ON DELETE CASCADE | |
| requested_by | UUID NOT NULL | FK->reps.id or dashboard_user_id |
| doc_id | UUID NOT NULL FK->knowledge_base_chunks.doc_id | |
| current_chunk_excerpt | TEXT NOT NULL | Excerpt triggering the request |
| suggested_correction | TEXT NOT NULL | Rep proposed correction |
| status | TEXT CHECK IN (open,resolved,rejected) DEFAULT open | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| resolved_at | TIMESTAMPTZ | NULL until resolved/rejected |
| resolved_by | UUID | |

**Partial-UNIQUE index**: idx_content_refinement_open_unique ON (requested_by, evaluation_id, doc_id, MD5(current_chunk_excerpt)) WHERE status=open
This enforces exactly one open request per (user, eval, doc, excerpt-hash). Duplicate insert triggers SQLSTATE 23505, caught as ContentRefinementDuplicateError in errors.ts, surfaced as 409 content_refinement_duplicate.

---

## 3. ai_original JSONB Shape and Schema Versions

### 3.1 Version History

| Version | Introduced In | New Fields |
|---------|--------------|------------|
| v2 | migration 001 | dimensionScores, narrative, strengths, weaknesses, knowledgeGaps, complianceFlags |
| v3 | Step 3 (no migration number) | coachingNudge |
| v4 | migration 011 | additionalObservations |
| v5 | migration 028 | repDeferrals |

**Production exposure**: 5 known v2 rows exist in production. UI must handle all versions gracefully via optional chaining.

### 3.2 Current (v5) ai_original Shape (source: src/evaluation/schema.ts)

Fields at top level of ai_original JSONB:

| Field | Type | Notes |
|-------|------|-------|
| dimensionScores | Record<string, {score: number, rationale: string}> | Built dynamically from rubric via buildClaudeEvaluationSchema() |
| narrative | string | Overall call narrative |
| strengths | string[] | Array of strength strings |
| weaknesses | string[] | Array of weakness strings |
| knowledgeGaps | KbSource[] | Citations: {chunk_id, doc_id, drive_url, doc_title} -- NO owner field |
| complianceFlags | string[] | Compliance issues |
| coachingNudge | object | Manager-editable mirror also in evaluations.coaching_nudge |
| additionalObservations | object[] | Extended observations array (v4+) |
| repDeferrals | object[] | Rep deferral capture (v5+) |

### 3.3 KbSource Citation Shape -- CRITICAL GAP

KbSource in ai_original is: { chunk_id: string, doc_id: string, drive_url: string, doc_title: string }
The owner field is on knowledge_base_chunks.owner (TEXT NOT NULL) in the database.
owner is NOT propagated into KbSource at evaluation time.
To display doc_owner in the KB side panel, the Dashboard must JOIN knowledge_base_chunks ON chunk_id at query time.
See Blocker B3.

### 3.4 Audit Toggle (Show AI Original)

The audit toggle reveals ai_original content alongside manager-edited fields.
ai_original is immutable after first write (DB trigger enforced).
The editable mirrors are: evaluations.coaching_nudge, evaluations.dimension_scores, evaluations.narrative, evaluations.strengths, evaluations.weaknesses, evaluations.knowledge_gaps, evaluations.compliance_flags, evaluations.additional_observations.
manager_edited_at and manager_edited_by (UUID) track who last edited.
manager_edited_by is a UUID -- display name requires JOIN to reps. See Blocker B2.
edit_version (INTEGER) supports OCC -- must be included in any PATCH payload.

---

## 4. Bridge Contract -- Error Response Shapes

Source: src/server.ts lines 488-542 (sales-coaching repo) + src/lib/errors.ts.

### 4.1 Confirmed Error Response Payloads

**400 Invalid Request**
HTTP 400, body: { ok: false, error: "invalid_request", issues: ZodIssue[] }
Thrown by: RequestValidationError (carries issues: ZodIssue[] from Zod parse)
Dashboard mirror: BridgeValidationError -- catches issues as unknown[]

**403 Role Forbidden**
HTTP 403, body: { ok: false, error: "role_forbidden", actual_role: string, allowed_roles: string[] }
Thrown by: RoleForbiddenError
Dashboard mirror: BridgeAuthError -- does NOT capture actual_role/allowed_roles fields

**404 Evaluation Not Found**
HTTP 404, body: { ok: false, error: "evaluation_not_found" }
Thrown by: EvaluationNotFoundError -- also thrown when source_deleted_at IS NOT NULL (tombstoned parent)
Dashboard mirror: BridgeError with status 404

**409 Evaluation Conflict (OCC)**
HTTP 409, body: { ok: false, error: "evaluation_conflict", message: string }
Thrown by: EvaluationConflictError (edit_version mismatch)
Dashboard mirror: EvaluationConflictError class in src/lib/sales-coaching-client/errors.ts -- CORRECTLY dispatched

**409 Content Refinement Duplicate**
HTTP 409, body: { ok: false, error: "content_refinement_duplicate" }
Thrown by: ContentRefinementDuplicateError (SQLSTATE 23505 on partial-UNIQUE index)
Dashboard mirror: NO typed class exists. Falls through to generic BridgeTransportError. See Blocker B4.

### 4.2 Zod ErrorResponseSchema Alignment

Dashboard schemas.ts ErrorResponseSchema: { ok: z.literal(false), error: z.string(), issues: z.array(z.unknown()).optional() }
Gap: issues typed as z.array(z.unknown()) not ZodIssue[] -- safe for display but loses type narrowing.
Gap: role_forbidden extra fields (actual_role, allowed_roles) not captured in ErrorResponseSchema.
Gap: evaluation_conflict message field not captured in ErrorResponseSchema.
These gaps are UI-display only -- error codes are still correctly dispatched by status + error field.

---

## 5. Dashboard Query and Type Gaps -- Build Blockers

### Blocker B1 -- Missing Query: getEvaluationWithTranscript

File: src/lib/queries/call-intelligence-evaluations.ts
Current function: getEvaluationDetail(id) -- returns incomplete data

Missing columns from current SELECT:
- dimension_scores (JSONB)
- narrative (TEXT)
- strengths (JSONB)
- weaknesses (JSONB)
- knowledge_gaps (JSONB)
- compliance_flags (JSONB)
- additional_observations (JSONB)
- coaching_nudge (JSONB)
- manager_edited_at (TIMESTAMPTZ)
- manager_edited_by (UUID)
- ai_original (JSONB)
- ai_original_schema_version (INTEGER)
- edit_version (INTEGER) -- required for OCC PATCH payloads

Missing: transcript_comments are NOT fetched by getEvaluationDetail(). Must be fetched separately (as in coaching DAL) or via a second query.

Fix: Replace getEvaluationDetail() with a comprehensive function that SELECTs all EVAL_COLUMNS from evaluations, LEFT JOINs call_transcripts on call_note_id, and fetches transcript_comments in a second query or subquery.

### Blocker B2 -- manager_edited_by Display Name Not Resolved

Neither getEvaluationWithTranscript() in the coaching DAL nor the Dashboard query resolves manager_edited_by UUID to a display name.
The reps table has: id UUID, first_name TEXT, last_name TEXT, email TEXT, is_system BOOLEAN.
Fix: Add LEFT JOIN reps editor ON editor.id = e.manager_edited_by AND editor.is_system = false in the Dashboard query. Expose as manager_edited_by_name TEXT in the response.

### Blocker B3 -- doc_owner Not in KbSource Citation

KbSource shape in ai_original: { chunk_id, doc_id, drive_url, doc_title }
The owner field is on knowledge_base_chunks table: owner TEXT NOT NULL.
owner is not propagated into KbSource at evaluation write time.
Fix: Dashboard must JOIN knowledge_base_chunks kbc ON kbc.chunk_id = source.chunk_id for each citation, or store owner at evaluation time (migration required). JOIN is the safer path.

### Blocker B4 -- ContentRefinementDuplicateError Missing from Dashboard Client

File: src/lib/sales-coaching-client/errors.ts
Missing: ContentRefinementDuplicateError class

File: src/lib/sales-coaching-client/index.ts
bridgeRequest() 409 dispatch block handles:
  - evaluation_conflict -> EvaluationConflictError (correct)
  - deactivate_blocked -> DeactivateBlockedError (correct)
  - content_refinement_already_resolved -> ContentRefinementAlreadyResolvedError (correct)
  - content_refinement_duplicate -> falls through to generic BridgeTransportError (BUG)

Fix: Add ContentRefinementDuplicateError to errors.ts. Add dispatch case in bridgeRequest() for error === content_refinement_duplicate.

### Blocker B5 -- EvaluationDetail TypeScript Interface Incomplete

File: src/types/call-intelligence.ts
Current EvaluationDetail interface omits: dimension_scores, narrative, strengths, weaknesses, knowledge_gaps, compliance_flags, additional_observations, coaching_nudge, manager_edited_at, manager_edited_by, ai_original, ai_original_schema_version, edit_version, transcript_comments.
transcript field is typed as unknown.
Fix: Expand EvaluationDetail to include all EVAL_COLUMNS fields and transcript_comments: TranscriptComment[].

### Blocker B6 -- author_name Absent from TranscriptCommentResponse

TranscriptCommentResponse schema (schemas.ts): { id, evaluation_id, utterance_index, author_id, author_role, text, created_at }
author_name is NOT in the schema and NOT in the transcript_comments table.
The coaching bridge returns only author_id (UUID) and author_role.
Fix options:
  Option A: Dashboard resolves author_name by querying reps WHERE id = author_id after fetching comments (N+1 or IN clause).
  Option B: Add author_name to transcript_comments table (requires migration) -- rejected, denormalized.
  Option C: Display author_role label (Manager / Rep / Admin) instead of display name -- minimal fix.
Recommended: Option A with IN clause lookup, or Option C as interim.

---

## 6. Special Considerations

### 6.1 doc_title Truncation

knowledge_base_chunks.doc_title has no VARCHAR cap in migration 001 (TEXT type).
KbSource.doc_title in ai_original is a plain string with no truncation applied at write time.
UI must truncate at render (CSS ellipsis or JS slice) -- do not rely on data being short.
Max observed length: not measured (no DB access). Assume unbounded.

### 6.2 XSS in Transcript Utterance Text

call_transcripts.transcript is JSONB containing TranscriptUtterance objects with a text field.
text is raw speech-to-text output -- may contain angle brackets or other HTML-significant characters.
React renders transcript text as children (not dangerouslySetInnerHTML), so JSX escapes automatically.
RISK: If any component renders utterance text via innerHTML or dangerouslySetInnerHTML, XSS is possible.
transcript_comments.text is user-entered free text -- same concern applies.
Recommendation: Audit all transcript text render sites for innerHTML usage before shipping.

### 6.3 utterance_index Bounds

transcript_comments.utterance_index is an INTEGER with no FK constraint to transcript array.
If a comment was created for utterance index 42 but the transcript has only 30 utterances, the comment will orphan visually.
This can happen if transcripts are re-processed and truncated after comments are written.
UI must handle utterance_index >= transcript.length gracefully (skip or show as orphaned comment).

### 6.4 coaching_nudge vs ai_original.coachingNudge

Two sources of coaching nudge data exist:
  1. evaluations.coaching_nudge (JSONB NULL, editable) -- manager can update this
  2. ai_original.coachingNudge (immutable, embedded in JSONB) -- original AI output
The audit toggle should show ai_original.coachingNudge as the baseline.
The current display should show evaluations.coaching_nudge (if non-null) or fall back to ai_original.coachingNudge.
coaching_nudge added in migration 024 -- evaluations before 024 have NULL coaching_nudge. Fall back to ai_original always.

### 6.5 my-refinements Sub-Route

File: src/lib/queries/call-intelligence-refinements.ts (Dashboard query layer)
Endpoint: GET /api/call-intelligence/refinements/my
Returns: MyContentRefinementsResponse (paginated list of content_refinement_requests for current user)
Filter: requested_by = current user UUID, status optionally filtered
No novel schema issues beyond those documented in Section 2.4.
Partial-UNIQUE index only applies to INSERT -- the GET path has no dedup concerns.

---

## 7. Migration 037 Scope Correction

The feature spec stated that migration 037 added new tables/columns for 5 new endpoints.
This is INCORRECT. Migration 037 contains only:
  ALTER TABLE transcript_comments DROP CONSTRAINT transcript_comments_author_role_check;
  ALTER TABLE transcript_comments ADD CONSTRAINT transcript_comments_author_role_check
    CHECK (author_role IN (manager, rep, admin));

All tables referenced by Step 5b-1-UI were created in migration 001:
  - transcript_comments: created in 001
  - content_refinement_requests: created in 001
  - knowledge_base_chunks: created in 001

The new admin value in the author_role CHECK is the only change in 037.
This is already applied to dev + test branches as of 2026-05-09 (per user confirmation).

---

## 8. Blocker Summary

| ID | Severity | File | Issue | Fix |
|----|----------|------|-------|-----|
| B1 | BLOCKER | src/lib/queries/call-intelligence-evaluations.ts | getEvaluationDetail() missing 12 columns + transcript_comments | Rewrite query to fetch all EVAL_COLUMNS + comments |
| B2 | BLOCKER | Same + src/types/call-intelligence.ts | manager_edited_by UUID not resolved to display name | LEFT JOIN reps on manager_edited_by, expose manager_edited_by_name |
| B3 | BLOCKER | Dashboard query layer | doc_owner not in KbSource -- requires JOIN to knowledge_base_chunks | Add JOIN on chunk_id at query time |
| B4 | BLOCKER | src/lib/sales-coaching-client/errors.ts + index.ts | ContentRefinementDuplicateError missing; 409 content_refinement_duplicate falls through to BridgeTransportError | Add class + dispatch case |
| B5 | BLOCKER | src/types/call-intelligence.ts | EvaluationDetail interface omits all scoring/narrative fields, edit_version, transcript_comments | Expand interface |
| B6 | ADVISORY | TranscriptCommentResponse | author_name not in schema or DB -- only UUID+role available | Use role label or N+1 reps lookup |

---

*Verification complete. No BigQuery queries were needed for this feature.*