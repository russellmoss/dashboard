# Code Inspector Findings: Per-Dimension AI Narrative body field

Investigation scope: Adding body to dimension_scores[dim] JSONB
Date: 2026-05-11
Status: Read-only investigation complete

---

## 1. TypeScript Type and Construction Sites

### 1a. Shared type definition

- File: src/types/call-intelligence.ts, line 91
- Current: dimension_scores: Record<string, { score: number; citations?: Citation[] }> | null
- ACTION REQUIRED: Add body?: string to the value shape.

### 1b. Bridge Zod schema (CRITICAL - blocks PATCH requests)

- File: src/lib/sales-coaching-client/schemas.ts, lines 348-354
- DimensionScoreDashSchema uses .strict() which rejects unknown keys.
- Sending body in a PATCH /edit request fails Zod validation (400) before DB is touched.
- body does NOT currently exist in this schema.
- EditEvaluationResponse (line 374) uses evaluation: z.unknown() so GET path is safe.
- Line 362: dimension_scores: z.record(z.string(), DimensionScoreDashSchema).optional()
  inside EditEvaluationRequest.
- ACTION REQUIRED: Add body: z.string().optional() to DimensionScoreDashSchema
  AND mirror the change to russellmoss/sales-coaching src/lib/db/types.ts.

### 1c. Local DimensionScoreEntry interface (not exported)

- File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, lines 95-99
- Current shape: { name: string; score: number; citations?: Citation[] }
- Used by readDimensionScores() (lines 101-117) and canonicalDimensionScores (lines 450-455).
- ACTION REQUIRED: Add body?: string here.

### 1d. readDimensionScores function (reads ai_original)

- File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, lines 101-117
- Reads ai_original.dimensionScores, builds DimensionScoreEntry from score + citations only.
- Does NOT read body. body from ai_original is silently dropped here.
- ACTION REQUIRED: Read val.body and pass through to DimensionScoreEntry.

### 1e. canonicalDimensionScores construction (reads canonical DB column)

- File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, lines 450-455
- Maps detail.dimension_scores to { name, score, citations } only. Drops body.
- ACTION REQUIRED: Add body: v.body to the map output.

### 1f. InlineEditDimensionScore onSave reconstruction loop (MOST CRITICAL)

- File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, lines 641-661
- Runs on EVERY manager score edit for ANY dimension.
- Rebuilds the entire dimension_scores map from scratch.
- body is NOT included in the reconstruction - silently dropped for ALL dimensions on every save.
- base is typed as Record<string, { score: number; citations: Citation[] }> with no body.
- ACTION REQUIRED (data loss fix): Spread body in the loop:
    base[name] = { score: v.score, citations: (v.citations ?? []) as Citation[],
      ...(v.body !== undefined && { body: v.body }) };
  Also widen the base type annotation to include body once shared type gains body.
---

## 2. Rendering and Serialization Consumers

### 2a. InsightsEvalDetailModal.tsx - dimension drill panel (PRIMARY UI TARGET)

- File: src/components/call-intelligence/InsightsEvalDetailModal.tsx, lines 178-184
- Currently destructures: const { score, citations } = detail.dimension_scores[payload.dimension]
- No body access.
- PRIMARY INSERTION POINT: lines 274-309, between score badge and citation chip row.
- Pattern to reuse: CitedText local component at lines 106-139 (text + trailing chip row).

### 2b. InsightsEvalDetailModal.tsx - topic drill panel

- File: src/components/call-intelligence/InsightsEvalDetailModal.tsx, lines 313-349
- Filters rep_deferrals by topic. Fully independent of dimension_scores. LEAVE UNCHANGED.

### 2c. EvalDetailClient.tsx - score display

- Renders canonicalDimensionScores (name, score, citations).
- Once body is threaded through DimensionScoreEntry, a render site must be added here too.

### 2d. coaching-notes-markdown.ts

- File: src/lib/coaching-notes-markdown.ts, lines 17 and 57-65
- AiOriginalSnapshot.dimensionScores typed as Record<string, { score?: unknown }>.
- Renders only score to markdown. Needs updating to include body in exported notes.

### 2e. GET API route - safe, no action needed

- File: src/app/api/call-intelligence/evaluations/[id]/route.ts
- Line 137: ...detail spread passes dimension_scores through as-is.
- Line 68: walkForKbSources(detail.dimension_scores, chunkIds) already traverses JSONB.
  KB citations inside a body citations array would be automatically hydrated.
- No Zod validation on GET path. Safe once body is in the DB.

### 2f. PATCH API route - blocked until schema is updated

- File: src/app/api/call-intelligence/evaluations/[id]/edit/route.ts
- Line 29: EditEvaluationRequest.safeParse(json) - .strict() blocks body here.
- Calls salesCoachingClient.editEvaluation() which calls PATCH on the bridge service.
- No fix needed in this file once DimensionScoreDashSchema is updated.
---

## 3. SQL Consumers - All Unaffected

- src/lib/queries/call-intelligence-evaluations.ts, line 325:
  SELECT e.dimension_scores - full JSONB passthrough. Unaffected.
- src/lib/queries/call-intelligence/dimension-heatmap.ts:
  CROSS JOIN jsonb_each then AVG score. Only touches score key. Unaffected.
- src/lib/queries/call-intelligence/insights-evals-list.ts:
  dimension_scores -> dim ->> score. Only touches score key. Unaffected.

---

## 4. InsightsEvalDetailModal Structure Map

File: src/components/call-intelligence/InsightsEvalDetailModal.tsx

- Lines 15-25: Props interface. Fields: chunkLookup, onScrollToUtterance, onOpenKB, detail, payload.
  No isAdmin or role prop. Admin-gated UI not available without adding a prop.
- Lines 106-139: CitedText local component. Renders text paragraph + trailing chip row.
  Reuse this pattern for body paragraph + body citations.
- Line 162: Guard: if (!payload.dimension && !payload.topic) return null.
  Both can be set simultaneously (dimension + topic are independent drill paths).
- Lines 178-184: Dimension drill entry. INSERTION POINT for body destructure.
- Lines 274-309: Dimension drill banner. PRIMARY INSERTION POINT for body paragraph.
- Lines 313-349: Topic drill (rep_deferrals). Fully independent. Leave unchanged.

---

## 5. CitationPill Component Contract

File: src/components/call-intelligence/CitationPill.tsx

Props:
  - citation: Citation
  - chunkLookup: Record<string, { owner: string; chunk_text: string }>
  - onScrollToUtterance?: (idx: number) => void
  - onOpenKB?: callback for KB pill clicks
  - utteranceTextForTooltip?: string
  - disabled?: boolean

Three render modes: gray pill (transcript cite), blue pill (KB chunk found), violet pill (KB no-lookup).
Renders as inline-flex rounded-full button - embeddable in flowing prose text.

InsightsEvalDetailModal only passes onScrollToUtterance. KB pill clicks silently no-op.
If body citations include kb_source entries, caller must pass onOpenKB to activate them.
---

## 6. Bridge Schema Mirror Status

File: src/lib/sales-coaching-client/schemas.ts

body does NOT exist in DimensionScoreDashSchema (lines 348-354).
.strict() will reject body with a 400 until schema is updated.

Mirror contract: byte-for-byte sync with
russellmoss/sales-coaching@main:src/lib/dashboard-api/schemas.ts.
CI enforces via scripts/check-schema-mirror.cjs.

Required work order (both repos atomically):
  1. Add body: z.string().optional() to DimensionScoreDashSchema in bridge mirror
  2. Match change in russellmoss/sales-coaching src/lib/dashboard-api/schemas.ts
  3. Also update src/lib/db/types.ts in sales-coaching (comment on line 348 points there)
  4. Run npm run check:schema-mirror to verify byte-equality

---

## 7. Re-Evaluate Endpoint Status

File: src/lib/sales-coaching-client/index.ts, lines 267-503

No triggerReEvaluation or re-eval method exists anywhere in the client.
Complete salesCoachingClient contains only:
  getEvaluations, getEvaluation, editEvaluation, getTranscript, getTranscriptComments,
  createTranscriptComment, getRecordNotes, getRecordNote, saveRecordNote,
  getKnowledgeBase, getKnowledgeBaseChunk

To add re-evaluation support, all of the following must be built from scratch:
  - POST endpoint in sales-coaching: /api/dashboard/evaluations/:id/re-evaluate
  - Zod schemas in both repos: ReEvaluateRequest, ReEvaluateResponse
  - salesCoachingClient.triggerReEvaluation() method
  - API route: src/app/api/call-intelligence/evaluations/[id]/re-evaluate/route.ts
  - UI trigger (button + permission gate)

---

## 8. Admin Permission Pattern

Canonical definition:
  File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, lines 251-252
  const isAdmin = role === admin || role === revops_admin;
  const isManager = isAdmin || role === manager;

Also at:
  File: src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx, lines 24-26
  const isAdmin = role === admin || role === revops_admin;
  const isRevopsAdmin = role === revops_admin;
  const isManagerOrAdmin = canEditRubrics(role);

InsightsEvalDetailModal has NO isAdmin or role prop.
Adding body-editing UI in the modal requires adding a role or isManager prop.

InsightsTab.tsx lines 711-712 hardcodes isAdmin={false} and canComposeComments={false}
for TranscriptModal in the Insights stack. Would need updating if admin body editing is added.
---

## 9. Risk Register

RISK-1 (DATA LOSS, CRITICAL):
  File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, lines 641-661
  Inline-edit reconstruction loop drops body on every manager score save.
  Fix BEFORE any body data is written to the DB, or data will be lost on first edit.

RISK-2 (400 ON PATCH):
  File: src/lib/sales-coaching-client/schemas.ts, lines 348-354
  .strict() on DimensionScoreDashSchema rejects body. Must update both repos atomically.

RISK-3 (TYPE MISMATCH):
  File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, line 641
  base type annotation Record<string, { score, citations }> lacks body.
  TypeScript will reject body spread once shared type gains body.
  Widen the annotation alongside DimensionScoreEntry.

RISK-4 (SILENT DROP in ai_original path):
  File: src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx, lines 101-117
  readDimensionScores() only extracts score + citations from ai_original JSONB.
  body from ai_original invisible in EvalDetail page until fixed.

RISK-5 (BRIDGE MIRROR DRIFT):
  CI check (scripts/check-schema-mirror.cjs) fails if repos go out of sync.
  Local-only change to DimensionScoreDashSchema breaks CI until upstream updated.

RISK-6 (coaching-notes-markdown.ts):
  File: src/lib/coaching-notes-markdown.ts
  dimensionScores typed as Record<string, { score?: unknown }>.
  body silently omitted from exported coaching note markdown unless updated.

RISK-7 (walkForKbSources - neutral/good):
  File: src/app/api/call-intelligence/evaluations/[id]/route.ts, line 68
  walkForKbSources already traverses dimension_scores recursively.
  KB citations in body.citations will be hydrated automatically.
  Verify walker handles the nested path correctly.

RISK-8 (onOpenKB not passed):
  File: src/components/call-intelligence/InsightsEvalDetailModal.tsx
  Only onScrollToUtterance passed to CitationPill, not onOpenKB.
  KB citations in body render as violet no-lookup pills until onOpenKB is wired.

RISK-9 (no role prop in modal):
  File: src/components/call-intelligence/InsightsEvalDetailModal.tsx, lines 15-25
  No isAdmin or role prop. Cannot gate body-editing UI without adding one.

RISK-10 (ai_original_schema_version gate):
  File: src/components/call-intelligence/citation-helpers.ts, lines 36-45
  Field union: coachingNudge | additionalObservations | repDeferrals.
  If body display is gated on schema version, a new version constant is needed
  and the union + auditToggle version array must be updated.

---

## 10. Recommended Change Order

1. sales-coaching repo: Add body to DimensionScore in src/lib/db/types.ts and
   src/lib/dashboard-api/schemas.ts
2. Bridge mirror: Update DimensionScoreDashSchema in src/lib/sales-coaching-client/schemas.ts
3. Run npm run check:schema-mirror - must pass before any commits
4. src/types/call-intelligence.ts line 91: Add body?: string
5. EvalDetailClient.tsx: Update DimensionScoreEntry interface, readDimensionScores(),
   canonicalDimensionScores map, AND the inline-edit reconstruction loop (RISK-1)
6. InsightsEvalDetailModal.tsx: Destructure body, add paragraph in lines 274-309
   using the CitedText component pattern
7. coaching-notes-markdown.ts: Include body in markdown export if desired
8. Run full TypeScript build - must be clean before any UI testing
