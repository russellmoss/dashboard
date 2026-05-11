/**
 * Canonical Zod schemas for the Dashboard ↔ sales-coaching bridge contract.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. The Dashboard repo
 * (C:\Users\russe\Documents\Dashboard) maintains a byte-for-byte mirror at
 * src/lib/sales-coaching-client/schemas.ts. Dashboard's CI fails on drift
 * — see the Step 5a-UI implementation guide for the mirror enforcement
 * pattern.
 *
 * When changing this file: update Dashboard's mirror in the same PR cycle
 * and bump any consumer's expected schema version. Schemas use `.strict()`
 * so unknown keys are rejected at parse time — explicit allowlist
 * everywhere keeps the contract surface small and auditable.
 *
 * Step 5a-API endpoints + their request/response schemas:
 *
 *   POST   /api/dashboard/users                              CreateUserRequest                 → CreateUserResponse
 *   PATCH  /api/dashboard/users/:id                          UpdateUserRequest                 → UpdateUserResponse
 *   POST   /api/dashboard/users/:id/deactivate               (no body)                         → DeactivateUserResponseOk | (409) DeactivateUserResponseBlocked
 *   POST   /api/dashboard/users/:id/bulk-reassign-pending-evals
 *                                                            BulkReassignRequest               → BulkReassignResponse
 *   PATCH  /api/dashboard/evaluations/:id/reveal-scheduling  RevealSchedulingRequest           → RevealSchedulingResponse
 *   POST   /api/dashboard/evaluations/:id/reveal             ManualRevealRequest               → ManualRevealResponse
 *   PATCH  /api/dashboard/users/me/reveal-policy             UpdateRevealPolicyRequest         → UpdateRevealPolicyResponse
 *   POST   /api/dashboard/content-refinements/:id/resolve    ContentRefinementResolveRequest   → ContentRefinementResolveResponse
 *
 * Step 5b-1-API endpoints (added 2026-05-08):
 *
 *   PATCH  /api/dashboard/evaluations/:id/edit                     EditEvaluationRequest             → EditEvaluationResponse
 *   POST   /api/dashboard/evaluations/:id/transcript-comments      TranscriptCommentCreateRequest    → TranscriptCommentResponse
 *   DELETE /api/dashboard/transcript-comments/:id                  (no body)                         → { ok: true }  (or 403/404)
 *   POST   /api/dashboard/content-refinements                      ContentRefinementCreateRequest    → ContentRefinementResponse
 *   GET    /api/dashboard/my-content-refinements                   (no body)                         → MyContentRefinementsResponse
 *
 * Author: Step 5a-API Phase 3 (2026-05-08); extended in Step 5b-1-API Phase 3 (2026-05-08).
 */

import { z } from 'zod';

// ─── Shared primitives ───────────────────────────────────────────────────

// Mirrors RepRole in src/lib/db/types.ts. Migration 036 added 'om'; Thread 2
// will drop 'csa' separately (so for now both coexist on this list).
export const RoleSchema = z.enum(['SGA', 'SGM', 'manager', 'admin', 'csa', 'om']);

// Mirrors RevealPolicy in src/lib/db/types.ts. CHECK on reps.reveal_policy
// allows exactly these three values.
export const RevealPolicySchema = z.enum(['manual', 'auto_delay', 'auto_immediate']);

// PATCH /evaluations/:id/reveal-scheduling vocab. Note: 'reveal_now' and
// 'use_default' are TRANSIENT API VERBS, not persisted into
// evaluations.reveal_override_action (CHECK on the column allows only
// 'hold' | 'custom_delay' | NULL). The route handler intercepts these
// verbs and translates them into either a manualReveal call or a clear-
// override-and-recompute-scheduled_reveal_at action. Council fix S5/DQ4
// adds a structured audit_verb column on evaluation_edit_audit_log so
// the audit trail captures which verb fired.
export const RevealOverrideActionSchema = z.enum([
  'hold',
  'custom_delay',
  'reveal_now',
  'use_default',
]);

export const ContentRefinementResolutionSchema = z.enum(['addressed', 'declined']);

const UuidSchema = z.string().uuid();
const EmailSchema = z
  .string()
  .email()
  .transform((s) => s.toLowerCase().trim());

// ─── POST /api/dashboard/users ───────────────────────────────────────────

export const CreateUserRequest = z
  .object({
    email: EmailSchema,
    full_name: z.string().trim().min(1).max(200),
    role: RoleSchema,
    manager_id: UuidSchema.nullable().optional(),
    slack_user_id: z.string().trim().min(1).max(40).nullable().optional(),
    sfdc_user_id: z.string().trim().min(15).max(18).nullable().optional(),
  })
  .strict();

export const CreateUserResponse = z
  .object({
    rep: z
      .object({
        id: UuidSchema,
        email: z.string(),
        full_name: z.string(),
        role: RoleSchema,
        manager_id: UuidSchema.nullable(),
        is_active: z.boolean(),
        created_at: z.string(),
      })
      .strict(),
  })
  .strict();

// ─── PATCH /api/dashboard/users/:id ──────────────────────────────────────

export const UpdateUserRequest = z
  .object({
    email: EmailSchema.optional(),
    full_name: z.string().trim().min(1).max(200).optional(),
    role: RoleSchema.optional(),
    manager_id: UuidSchema.nullable().optional(),
    slack_user_id: z.string().trim().min(1).max(40).nullable().optional(),
    sfdc_user_id: z.string().trim().min(15).max(18).nullable().optional(),
    reveal_policy: RevealPolicySchema.optional(),
    reveal_delay_minutes: z
      .number()
      .int()
      .min(1)
      .max(10080) // 1 week
      .nullable()
      .optional(),
    reveal_reminder_minutes: z.number().int().min(1).nullable().optional(),
  })
  .strict();

export const UpdateUserResponse = CreateUserResponse;

// ─── POST /api/dashboard/users/:id/deactivate ────────────────────────────
//
// Two response shapes — handler returns 200 with Ok, or 409 with Blocked.

export const DeactivateUserResponseOk = z
  .object({
    rep: z
      .object({
        id: UuidSchema,
        is_active: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const DeactivateUserResponseBlocked = z
  .object({
    blocked_reason: z.enum(['active_direct_reports', 'pending_evaluations']),
    blocking_count: z.number().int().min(1),
    blocking_eval_ids: z.array(UuidSchema).optional(),
    blocking_rep_ids: z.array(UuidSchema).optional(),
  })
  .strict();

// ─── POST /api/dashboard/users/:id/bulk-reassign-pending-evals ───────────

export const BulkReassignRequest = z
  .object({
    new_manager_id: UuidSchema,
  })
  .strict();

export const BulkReassignResponse = z
  .object({
    reassigned_count: z.number().int().min(0),
    reassigned_eval_ids: z.array(UuidSchema),
  })
  .strict();

// ─── PATCH /api/dashboard/evaluations/:id/reveal-scheduling ──────────────
//
// override_action='reveal_now' is intercepted by the route handler and
// routed to manualReveal (POST /reveal's path); the schema accepts it for
// API ergonomics. override_action='use_default' clears the override and
// recomputes scheduled_reveal_at from the evaluation's snapshot policy.

export const RevealSchedulingRequest = z
  .object({
    override_action: RevealOverrideActionSchema,
    override_delay_minutes: z.number().int().min(1).max(10080).optional(),
    expected_edit_version: z.number().int().min(1),
  })
  .strict()
  .refine(
    (v) => v.override_action !== 'custom_delay' || v.override_delay_minutes !== undefined,
    { message: 'override_delay_minutes is required when override_action=custom_delay' },
  );

export const RevealSchedulingResponse = z
  .object({
    evaluation: z
      .object({
        id: UuidSchema,
        edit_version: z.number().int(),
        // Persisted column accepts only 'hold' | 'custom_delay' | NULL —
        // 'reveal_now' / 'use_default' never land here (transient verbs).
        reveal_override_action: z.enum(['hold', 'custom_delay']).nullable(),
        reveal_override_delay_minutes: z.number().int().nullable(),
        scheduled_reveal_at: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

// ─── POST /api/dashboard/evaluations/:id/reveal ──────────────────────────

export const ManualRevealRequest = z
  .object({
    expected_edit_version: z.number().int().min(1),
  })
  .strict();

export const ManualRevealResponse = z
  .object({
    evaluation: z
      .object({
        id: UuidSchema,
        edit_version: z.number().int(),
        status: z.literal('revealed'),
        revealed_at: z.string(),
      })
      .strict(),
  })
  .strict();

// ─── PATCH /api/dashboard/users/me/reveal-policy ─────────────────────────

export const UpdateRevealPolicyRequest = z
  .object({
    policy: RevealPolicySchema,
    delay_minutes: z.number().int().min(1).max(10080).nullable().optional(),
    reminder_minutes: z.number().int().min(1).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.policy === 'auto_delay' &&
      (v.delay_minutes === null || v.delay_minutes === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['delay_minutes'],
        message: 'delay_minutes required when policy=auto_delay',
      });
    }
    if (
      v.reminder_minutes != null &&
      v.delay_minutes != null &&
      v.reminder_minutes >= v.delay_minutes
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reminder_minutes'],
        message: 'reminder_minutes must be less than delay_minutes',
      });
    }
  });

export const UpdateRevealPolicyResponse = z
  .object({
    rep: z
      .object({
        id: UuidSchema,
        reveal_policy: RevealPolicySchema,
        reveal_delay_minutes: z.number().int().nullable(),
        reveal_reminder_minutes: z.number().int().nullable(),
      })
      .strict(),
  })
  .strict();

// ─── POST /api/dashboard/content-refinements/:id/resolve ─────────────────

export const ContentRefinementResolveRequest = z
  .object({
    resolution: ContentRefinementResolutionSchema,
    resolution_notes: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.resolution === 'declined' && !v.resolution_notes) {
      ctx.addIssue({
        code: 'custom',
        path: ['resolution_notes'],
        message: 'resolution_notes required when resolution=declined',
      });
    }
  });

export const ContentRefinementResolveResponse = z
  .object({
    request: z
      .object({
        id: UuidSchema,
        status: ContentRefinementResolutionSchema,
        resolved_by: UuidSchema,
        resolved_at: z.string(),
        resolution_notes: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

// ─── Step 5b-1 — eval edit + transcript comments + content-refinements ───
//
// Shapes mirror src/evaluation/schema.ts (the evaluator's internal Sonnet
// output schema) but loosen citationArray to allow length 0. The
// evaluator must always cite (Sonnet output gate); manager edits can
// PATCH a narrative or claim without re-providing every citation, and
// the DB doesn't enforce min(1).

const KbSourceDashSchema = z
  .object({
    chunk_id: UuidSchema,
    doc_id: z.string().min(1),
    drive_url: z.string().url(),
    doc_title: z.string().min(1),
  })
  .strict();

// Citation — same "≥1 of utterance_index or kb_source" rule as evaluator.
const CitationSchema = z
  .object({
    utterance_index: z.number().int().min(0).optional(),
    kb_source: KbSourceDashSchema.optional(),
  })
  .strict()
  .refine((c) => c.utterance_index !== undefined || c.kb_source !== undefined, {
    message: 'Citation must have at least one of utterance_index or kb_source',
  });

// citationArray — allows empty (manager edits don't have to re-cite).
const citationArrayDash = z.array(CitationSchema);

const CitedTextDashSchema = z
  .object({ text: z.string().trim().min(1), citations: citationArrayDash })
  .strict();

const CitedClaimDashSchema = z
  .object({ text: z.string().trim().min(1), citations: citationArrayDash })
  .strict();

// knowledge_gaps — extends CitedClaim with optional expected_source so
// round-trip PATCHes don't strip the field (council fix C3).
const KnowledgeGapDashSchema = z
  .object({
    text: z.string().trim().min(1),
    citations: citationArrayDash,
    expected_source: z.string().min(1).optional(),
  })
  .strict();

// DimensionScore — mirrors src/lib/db/types.ts:163. Score is 1-4.
const DimensionScoreDashSchema = z
  .object({
    score: z.number().min(1).max(4),
    citations: citationArrayDash,
  })
  .strict();

// ─── PATCH /api/dashboard/evaluations/:id/edit ───────────────────────────

export const EditEvaluationRequest = z
  .object({
    expected_edit_version: z.number().int().min(1),
    overall_score: z.number().min(1).max(4).optional(),
    dimension_scores: z.record(z.string(), DimensionScoreDashSchema).optional(),
    // narrative is NOT NULL in the DB — only optional, not nullable.
    narrative: CitedTextDashSchema.optional(),
    strengths: z.array(CitedClaimDashSchema).optional(),
    weaknesses: z.array(CitedClaimDashSchema).optional(),
    knowledge_gaps: z.array(KnowledgeGapDashSchema).optional(),
    compliance_flags: z.array(CitedClaimDashSchema).optional(),
    additional_observations: z.array(CitedClaimDashSchema).optional(),
    coaching_nudge: CitedTextDashSchema.nullable().optional(),
  })
  .strict();

export const EditEvaluationResponse = z
  .object({
    evaluation: z.unknown(),
  })
  .strict();

// ─── POST /api/dashboard/evaluations/:id/transcript-comments ─────────────

export const TranscriptCommentCreateRequest = z
  .object({
    utterance_index: z.number().int().min(0),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();

export const TranscriptCommentResponse = z
  .object({
    comment: z
      .object({
        id: UuidSchema,
        evaluation_id: UuidSchema,
        utterance_index: z.number().int().min(0),
        author_id: UuidSchema,
        author_role: z.enum(['manager', 'rep', 'admin']),
        text: z.string(),
        created_at: z.string(),
      })
      .strict(),
  })
  .strict();

// ─── POST /api/dashboard/content-refinements ─────────────────────────────
//
// Council fix D3: placeholder check dropped; rely on 20-char minimum after
// trim. UI is responsible for clearing the placeholder before submit.

export const ContentRefinementCreateRequest = z
  .object({
    evaluation_id: UuidSchema,
    doc_id: z.string().min(1),
    drive_url: z.string().url(),
    current_chunk_excerpt: z.string().min(1),
    suggested_change: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(20, 'Suggested change must be at least 20 characters')),
  })
  .strict();

export const ContentRefinementResponse = z
  .object({
    request: z
      .object({
        id: UuidSchema,
        evaluation_id: UuidSchema,
        doc_id: z.string(),
        drive_url: z.string(),
        current_chunk_excerpt: z.string(),
        suggested_change: z.string(),
        requested_by: UuidSchema,
        status: z.enum(['open', 'addressed', 'declined']),
        created_at: z.string(),
      })
      .strict(),
  })
  .strict();

// ─── GET /api/dashboard/my-content-refinements ───────────────────────────

export const MyContentRefinementsResponse = z
  .object({
    requests: z.array(
      z
        .object({
          id: UuidSchema,
          evaluation_id: UuidSchema,
          doc_id: z.string(),
          drive_url: z.string(),
          current_chunk_excerpt: z.string(),
          suggested_change: z.string(),
          status: z.enum(['open', 'addressed', 'declined']),
          resolved_by: UuidSchema.nullable(),
          resolved_at: z.string().nullable(),
          resolution_notes: z.string().nullable(),
          created_at: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

// ─── DELETE /api/dashboard/transcript-comments/:id ───────────────────────
//
// The DELETE handler returns the literal { ok: true } on success; this schema
// gives Dashboard a typed response to parse and keeps the bridge symmetric.

export const DeleteTranscriptCommentResponse = z.object({ ok: z.literal(true) }).strict();

// ─── Step 5b-2 — rubric-management endpoints ─────────────────────────────────
//
// All five endpoints live under /api/dashboard/rubrics/*. Manager + admin only.
// Pure DB mutations; STEP5_SAFE_MODE has nothing to suppress here.
//
//   GET    /api/dashboard/rubrics                  RubricListQuerySchema     → RubricListResponse
//   GET    /api/dashboard/rubrics/:id              (no body)                 → RubricResponse | (404)
//   POST   /api/dashboard/rubrics                  CreateRubricRequest       → RubricResponse
//   PATCH  /api/dashboard/rubrics/:id/activate     ActivateRubricRequest     → RubricResponse | (409)
//   PATCH  /api/dashboard/rubrics/:id              UpdateDraftRubricRequest  → RubricResponse | (409)
//   DELETE /api/dashboard/rubrics/:id              (no body) — drafts or       → DeleteRubricResponse | (404|409)
//                                                  safe archived (no eval refs)

// Narrow enum — the rubrics.role CHECK constraint allows only 'SGA'|'SGM'.
// Distinct from the cross-cutting RoleSchema (which also covers manager/admin/etc.).
export const RubricRoleSchema = z.enum(['SGA', 'SGM']);

export const RubricStatusSchema = z.enum(['draft', 'active', 'archived']);

// Controlled-vocabulary regex for dimension `name` (council fix D2).
// Lowercase + digits + underscores; no leading digit; 3-50 chars.
// Server-side enforcement at the Zod boundary AND in the DAL
// (registerRubricDimensions) for defense-in-depth.
const DimensionNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,49}$/, {
    message:
      'Dimension name must match /^[a-z][a-z0-9_]{2,49}$/ (lowercase, digits, underscores; no leading digit; 3-50 chars).',
  });

// Mirrors RubricDimensionDef in src/lib/db/types.ts:129. `levels` keys are
// stringified ints '1'..'4' on the wire (JSON.stringify of numeric keys).
export const RubricDimensionDefSchema = z
  .object({
    name: DimensionNameSchema,
    order: z.number().int().min(0).max(99),
    levels: z
      .object({
        1: z.string().trim().min(1).max(2000),
        2: z.string().trim().min(1).max(2000),
        3: z.string().trim().min(1).max(2000),
        4: z.string().trim().min(1).max(2000),
      })
      .strict(),
  })
  .strict();

export const RubricSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    role: RubricRoleSchema,
    version: z.number().int().min(1),
    edit_version: z.number().int().min(1), // migration 038 — OCC counter
    status: RubricStatusSchema,
    dimensions: z.array(RubricDimensionDefSchema),
    created_by: UuidSchema,
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

// ─── POST /api/dashboard/rubrics ─────────────────────────────────────────────

export const CreateRubricRequest = z
  .object({
    name: z.string().trim().min(1).max(200),
    role: RubricRoleSchema,
    dimensions: z.array(RubricDimensionDefSchema).min(1),
    status: z.enum(['draft', 'active']).optional(), // archived is not a creation target
  })
  .strict();

// ─── PATCH /api/dashboard/rubrics/:id ────────────────────────────────────────
//
// Edits a draft rubric in place. `name` and/or `dimensions` may change. Active
// and archived rubrics are immutable — server returns 409 with reason='not_in_draft'.
// Empty payload is rejected (must include at least one editable field).

export const UpdateDraftRubricRequest = z
  .object({
    expected_edit_version: z.number().int().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    dimensions: z.array(RubricDimensionDefSchema).min(1).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.dimensions !== undefined, {
    message: 'At least one of name or dimensions must be provided.',
  });

// ─── PATCH /api/dashboard/rubrics/:id/activate ───────────────────────────────

export const ActivateRubricRequest = z
  .object({
    expected_edit_version: z.number().int().min(1),
  })
  .strict();

// ─── GET /api/dashboard/rubrics ──────────────────────────────────────────────

export const RubricListQuerySchema = z
  .object({
    role: RubricRoleSchema.optional(),
    status: RubricStatusSchema.optional(),
  })
  .strict();

// ─── Response envelopes ──────────────────────────────────────────────────────

export const RubricResponse = z.object({ rubric: RubricSchema }).strict();

export const RubricListResponse = z
  .object({ rubrics: z.array(RubricSchema) })
  .strict();

// DELETE /api/dashboard/rubrics/:id — drafts only.
// Returns { ok: true, deleted: { id, version, role } } so the Dashboard UI
// can surface a confirmation banner without re-fetching.
export const DeleteRubricResponse = z
  .object({
    ok: z.literal(true),
    deleted: z
      .object({
        id: UuidSchema,
        version: z.number().int().min(1),
        role: RubricRoleSchema,
      })
      .strict(),
  })
  .strict();

// ─── Generic error envelope ──────────────────────────────────────────────
//
// Mirrors the existing { ok: false, error } shape the server.ts errorHandler
// emits. Dashboard parses this for ALL non-2xx responses.

export const ErrorResponseSchema = z
  .object({
    ok: z.literal(false).optional(),
    error: z.string(),
    message: z.string().optional(),
    // Auth-failure detail (DashboardRoleError → 403)
    actual_role: z.string().optional(),
    allowed_roles: z.array(z.string()).optional(),
    // OCC conflict detail (EvaluationConflictError → 409)
    // (no extra fields beyond `message`)
    // Deactivate-blocked detail (409)
    blocked_reason: z.string().optional(),
    blocking_count: z.number().optional(),
    blocking_eval_ids: z.array(UuidSchema).optional(),
    blocking_rep_ids: z.array(UuidSchema).optional(),
    // Step 5b-1-API: RequestValidationError → 400 carries Zod issues.
    issues: z.array(z.unknown()).optional(),
    // Step 5b-2-API: RubricConflictError → 409 carries a discriminator the
    // Dashboard UI uses to pick the right banner copy
    // ('version_mismatch' | 'not_in_draft' | 'concurrent_activation').
    // Optional + opaque z.string() so future error classes can reuse it
    // without schema churn.
    reason: z.string().optional(),
  })
  .strict();

// ─── Inferred TypeScript types — exported for handler convenience ────────

export type CreateUserRequestT = z.infer<typeof CreateUserRequest>;
export type CreateUserResponseT = z.infer<typeof CreateUserResponse>;
export type UpdateUserRequestT = z.infer<typeof UpdateUserRequest>;
export type UpdateUserResponseT = z.infer<typeof UpdateUserResponse>;
export type DeactivateUserResponseOkT = z.infer<typeof DeactivateUserResponseOk>;
export type DeactivateUserResponseBlockedT = z.infer<typeof DeactivateUserResponseBlocked>;
export type BulkReassignRequestT = z.infer<typeof BulkReassignRequest>;
export type BulkReassignResponseT = z.infer<typeof BulkReassignResponse>;
export type RevealSchedulingRequestT = z.infer<typeof RevealSchedulingRequest>;
export type RevealSchedulingResponseT = z.infer<typeof RevealSchedulingResponse>;
export type ManualRevealRequestT = z.infer<typeof ManualRevealRequest>;
export type ManualRevealResponseT = z.infer<typeof ManualRevealResponse>;
export type UpdateRevealPolicyRequestT = z.infer<typeof UpdateRevealPolicyRequest>;
export type UpdateRevealPolicyResponseT = z.infer<typeof UpdateRevealPolicyResponse>;
export type ContentRefinementResolveRequestT = z.infer<typeof ContentRefinementResolveRequest>;
export type ContentRefinementResolveResponseT = z.infer<typeof ContentRefinementResolveResponse>;
export type ErrorResponseT = z.infer<typeof ErrorResponseSchema>;
export type RoleT = z.infer<typeof RoleSchema>;
export type RevealPolicyT = z.infer<typeof RevealPolicySchema>;

// Step 5b-1-API inferred types.
export type EditEvaluationRequestT = z.infer<typeof EditEvaluationRequest>;
export type EditEvaluationResponseT = z.infer<typeof EditEvaluationResponse>;
export type TranscriptCommentCreateRequestT = z.infer<typeof TranscriptCommentCreateRequest>;
export type TranscriptCommentResponseT = z.infer<typeof TranscriptCommentResponse>;
export type ContentRefinementCreateRequestT = z.infer<typeof ContentRefinementCreateRequest>;
export type ContentRefinementResponseT = z.infer<typeof ContentRefinementResponse>;
export type MyContentRefinementsResponseT = z.infer<typeof MyContentRefinementsResponse>;
export type DeleteTranscriptCommentResponseT = z.infer<typeof DeleteTranscriptCommentResponse>;

// Step 5b-2-API inferred types — rubric management.
export type RubricRoleT = z.infer<typeof RubricRoleSchema>;
export type RubricStatusT = z.infer<typeof RubricStatusSchema>;
export type RubricDimensionDefT = z.infer<typeof RubricDimensionDefSchema>;
export type RubricT = z.infer<typeof RubricSchema>;
export type CreateRubricRequestT = z.infer<typeof CreateRubricRequest>;
export type UpdateDraftRubricRequestT = z.infer<typeof UpdateDraftRubricRequest>;
export type ActivateRubricRequestT = z.infer<typeof ActivateRubricRequest>;
export type RubricListQueryT = z.infer<typeof RubricListQuerySchema>;
export type RubricResponseT = z.infer<typeof RubricResponse>;
export type RubricListResponseT = z.infer<typeof RubricListResponse>;
export type DeleteRubricResponseT = z.infer<typeof DeleteRubricResponse>;

// ════════════════════════════════════════════════════════════════════════════
// Step 5b-3-API — Rep note review bridge endpoints (added 2026-05-09)
//
// Six endpoints under /api/dashboard/note-review/* for the Dashboard long-note
// review UI (notes >2,800 chars that don't fit in Slack's 3,000-char modal).
// Reuses Step 5a-API bridge auth, Step 4 SFDC waterfall, and the same
// enqueueSfdcWrite() orchestrator the Slack approve-path uses.
//
// OCC: every PATCH/POST request carries `expected_edit_version: number` —
// migration 039 added the column. Council 2026-05-09 explicitly chose this
// over `updated_at`-OCC because Postgres microsecond precision truncates to
// millisecond in JSON serialization, guaranteeing OCC false-positives.
// ════════════════════════════════════════════════════════════════════════════

// Mirrors CallNoteSource in src/lib/db/types.ts.
export const CallNoteSourceSchema = z.enum(['granola', 'kixie']);

// Mirrors CallNoteStatus in src/lib/db/types.ts.
export const CallNoteStatusSchema = z.enum(['pending', 'approved', 'rejected', 'sent_to_sfdc']);

// Mirrors SfdcRecordType in src/lib/db/types.ts (CHECK on
// call_notes.sfdc_record_type allows exactly these four).
export const SfdcRecordTypeSchema = z.enum(['Lead', 'Contact', 'Opportunity', 'Account']);

// STRICT SUBSET of LinkageStrategy in src/lib/db/types.ts:418-426 — bridge
// rejects 'kixie_task_link' (that value is reserved for Kixie ingest only).
// Compile-time guard below asserts the subset relationship.
export const BridgeLinkageStrategySchema = z.enum([
  'manual_entry',
  'crd_prefix',
  'attendee_email',
  'calendar_title',
]);

// NOTE: the compile-time DAL-subset guard for BridgeLinkageStrategySchema
// lives in src/lib/dashboard-api/schemas-dal-guard.ts (sales-coaching only,
// NOT mirrored to Dashboard) so this file stays portable. The Dashboard
// repo holds a byte-for-byte mirror at
// src/lib/sales-coaching-client/schemas.ts and has no `../db/types`.

// Attendee shape mirrors CallNoteAttendee in src/lib/db/types.ts.
export const CallNoteAttendeeSchema = z
  .object({
    name: z.string(),
    email: z.string(),
  })
  .strict();

// List-row shape — preview without a second fetch.
export const CallNoteSummarySchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    call_started_at: z.string(),  // ISO; mirror of timestamp with time zone
    summary_text: z.string().nullable(),
    summary_markdown: z.string().nullable(),
    summary_markdown_edited: z.string().nullable(),
    note_char_count: z.number().int(),
    attendees: z.array(CallNoteAttendeeSchema),
    granola_web_url: z.string().nullable(),
    source: CallNoteSourceSchema,
    status: CallNoteStatusSchema,
    edit_version: z.number().int(),
    updated_at: z.string(),
  })
  .strict();

// Single-row shape — extends Summary with transcript JSONB + SFDC linkage.
// Caller composes from getCallNoteForReview (joins call_transcripts 1:1 on
// call_note_id, never on evaluation_id).
export const CallNoteDetailSchema = CallNoteSummarySchema.extend({
  rep_id: UuidSchema,
  transcript: z.unknown().nullable(),  // TranscriptUtterance[]; opaque on the wire
  sfdc_who_id: z.string().nullable(),
  sfdc_what_id: z.string().nullable(),
  sfdc_record_id: z.string().nullable(),
  sfdc_record_type: SfdcRecordTypeSchema.nullable(),
  // DAL value (full LinkageStrategy enum); the bridge will never WRITE
  // 'kixie_task_link' but it can READ rows where that's the value (Kixie
  // ingest set it) — so the response uses the FULL enum, not the bridge subset.
  linkage_strategy: z.enum([
    'manual_entry',
    'crd_prefix',
    'attendee_email',
    'calendar_title',
    'kixie_task_link',
  ]),
  evaluation_id: UuidSchema.nullable(),
}).strict();

// ─── GET /api/dashboard/note-review/me ───────────────────────────────────────

export const MyNoteReviewListResponse = z
  .object({
    items: z.array(CallNoteSummarySchema),
  })
  .strict();

// ─── SFDC suggestion subset (mirror of slack_review_messages.sfdc_suggestion) ─
//
// 2026-05-10 — exposed to the Dashboard so the rep sees the same waterfall
// candidate dropdown the Slack DM rendered, instead of having to do a fresh
// SOQL search. Fields use string types for `*_record_type` rather than the
// concrete SfdcRecordType enum because the upstream SfdcCandidate carries
// `who_record_type: SfdcWhoRecordType | null` and `what_record_type:
// SfdcWhatRecordType | null` (subsets of the public enum that include null
// for orphan-Opp candidates). Keeping them as `string().nullable()` here
// matches that reality without coupling the bridge to the internal SFDC
// type narrowing — Dashboard only consumes them for display.

// 2026-05-10 — `.passthrough()` (not `.strict()`) so future SfdcCandidate /
// SfdcSuggestion field additions on the producer side don't break Dashboard
// parsing. Schema drift between bridge schema mirrors is still caught by
// `npm run check:schema-mirror` in CI; passthrough only relaxes the runtime
// parser, not the cross-repo byte-equal check.
export const BridgeSfdcCandidateSchema = z
  .object({
    who_id: z.string().nullable(),
    what_id: z.string().nullable(),
    who_record_type: z.string().nullable(),
    what_record_type: z.string().nullable(),
    primary_label: z.string(),
    primary_record_type: SfdcRecordTypeSchema,
    display_subtitle: z.string(),
    last_activity_date: z.string().nullable(),
    // 2026-05-10 — these fields are produced by current waterfall code but are
    // absent in legacy slack_review_messages.sfdc_suggestion JSONB written
    // before owner-aware ranking (2026-05-07) + confidence_tier + account_name
    // (2026-05-10) shipped. Made optional so the bridge GET response parses
    // for legacy 'dm' rows too. SuggestedRecordsPanel tolerates undefined.
    owner_id: z.string().nullable().optional(),
    owner_name: z.string().nullable().optional(),
    owner_match: z.boolean().optional(),
    confidence_tier: z.enum(['likely', 'possible', 'unlikely']).optional(),
    account_name: z.string().nullable().optional(),
  })
  .passthrough();

export const BridgeSfdcSuggestionAmbiguitySchema = z
  .object({
    source: z.string(),
    match_count: z.number(),
    enriched_name: z.string(),
  })
  .passthrough();

export const BridgeSfdcSuggestionSchema = z
  .object({
    linkage_strategy: z.string(),
    candidate_who_id: z.string().nullable(),
    candidate_what_id: z.string().nullable(),
    candidate_record_type: z.string().nullable(),
    candidate_display: z.string().nullable(),
    detected_crd: z.string().nullable(),
    matched_email: z.string().nullable(),
    source_signal: z.string(),
    candidates: z.array(BridgeSfdcCandidateSchema),
    ambiguity: BridgeSfdcSuggestionAmbiguitySchema.optional(),
  })
  .passthrough();

// ─── GET /api/dashboard/note-review/:callNoteId ─────────────────────────────

export const GetCallNoteReviewResponse = z
  .object({
    call_note: CallNoteDetailSchema,
    // Optional + nullable for forward/backward compat across deploys: old
    // Cloud Run revisions return without this field, new Dashboard parses
    // it as undefined and falls back to its existing search-only UI.
    // Sourced from slack_review_messages.sfdc_suggestion JSONB on the
    // canonical (surface='dm') row. Null when the call_note has no DM yet
    // or when the suggestion column is null (manual-entry waterfall path).
    sfdc_suggestion: BridgeSfdcSuggestionSchema.nullable().optional(),
  })
  .strict();

// ─── PATCH /api/dashboard/note-review/:callNoteId ───────────────────────────

export const EditCallNoteRequest = z
  .object({
    summary_markdown_edited: z.string().min(0).max(100_000),
    expected_edit_version: z.number().int().nonnegative(),
  })
  .strict();

export const EditCallNoteResponse = z
  .object({
    call_note: CallNoteDetailSchema,
  })
  .strict();

// ─── POST /api/dashboard/note-review/:callNoteId/sfdc-search ────────────────

export const SfdcSearchQueryTypeSchema = z.enum(['crd', 'email', 'name', 'manual_id']);

export const SfdcSearchRequest = z
  .object({
    query: z.string().trim().min(1).max(200),
    query_type: SfdcSearchQueryTypeSchema,
  })
  .strict();

export const SfdcSearchMatchSchema = z
  .object({
    id: z.string(),  // 15- or 18-char SFDC ID
    name: z.string(),
    type: SfdcRecordTypeSchema,
    crd: z.string().optional(),
    owner_email: z.string().optional(),
    score: z.number(),
  })
  .strict();

export const SfdcSearchResponse = z
  .object({
    matches: z.array(SfdcSearchMatchSchema),
  })
  .strict();

// ─── PATCH /api/dashboard/note-review/:callNoteId/sfdc-link ─────────────────

export const SetSfdcLinkRequest = z
  .object({
    sfdc_who_id: z.string().nullable().optional(),
    sfdc_what_id: z.string().nullable().optional(),
    sfdc_record_id: z.string().min(15).max(18),  // 15- or 18-char SFDC ID
    sfdc_record_type: SfdcRecordTypeSchema,
    linkage_strategy: BridgeLinkageStrategySchema,
    expected_edit_version: z.number().int().nonnegative(),
  })
  .strict();

export const SetSfdcLinkResponse = z
  .object({
    call_note: CallNoteDetailSchema,
  })
  .strict();

// ─── POST /api/dashboard/note-review/:callNoteId/submit ─────────────────────

export const SubmitNoteReviewRequest = z
  .object({
    confirm: z.literal(true),
    expected_edit_version: z.number().int().nonnegative(),
  })
  .strict();

export const SubmitNoteReviewResponse = z
  .object({
    call_note: CallNoteDetailSchema,
    sfdc_write_log_id: z.string().nullable(),  // null when STEP5_SAFE_MODE on
  })
  .strict();

// ─── POST /api/dashboard/note-review/:callNoteId/reject ─────────────────────

export const RejectNoteReviewRequest = z
  .object({
    reason: z.string().trim().min(1).max(2000),
    expected_edit_version: z.number().int().nonnegative(),
  })
  .strict();

export const RejectNoteReviewResponse = z
  .object({
    call_note: CallNoteDetailSchema,
  })
  .strict();

// ════════════════════════════════════════════════════════════════════════════
// AI Cost Analysis bridge — GET /api/dashboard/cost-analysis
//
// Powers the Dashboard "Cost Analysis" tab. Total Anthropic spend across all
// 13 AI call sites (Migration 042 ai_usage_log), denominator = distinct
// advisor calls processed in the window (source='kixie' OR (source='granola'
// AND likely_call_type='advisor_call')). Date filter applies to ai_usage_log
// .created_at for the spend numerator and call_notes.created_at for the
// advisor-call denominator — chosen by Russell 2026-05-11 over the
// alternative "filter both by call_notes.created_at" because monthly bill
// reconciliation needs the actual API-spend timestamp.
// ════════════════════════════════════════════════════════════════════════════

// ISO date string (YYYY-MM-DD). End is INCLUSIVE of the day (server expands
// to next-day-00:00 UTC for the half-open SQL range).
const IsoDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required');

export const CostAnalysisRequest = z
  .object({
    start_date: IsoDateStringSchema,
    end_date: IsoDateStringSchema,
  })
  .strict()
  .refine((v) => v.start_date <= v.end_date, { message: 'start_date must be on or before end_date' });

const CostAnalysisByDayRow = z
  .object({
    day: IsoDateStringSchema,
    spend_micro_usd: z.number().int().nonnegative(),
    api_call_count: z.number().int().nonnegative(),
  })
  .strict();

const CostAnalysisByFeatureRow = z
  .object({
    feature: z.string(),
    spend_micro_usd: z.number().int().nonnegative(),
    api_call_count: z.number().int().nonnegative(),
  })
  .strict();

const CostAnalysisByModelRow = z
  .object({
    model: z.string(),
    spend_micro_usd: z.number().int().nonnegative(),
    api_call_count: z.number().int().nonnegative(),
  })
  .strict();

export const CostAnalysisResponse = z
  .object({
    date_range: z
      .object({
        start: IsoDateStringSchema,
        end: IsoDateStringSchema,
        days_in_range: z.number().int().positive(),
      })
      .strict(),

    // Headline KPIs
    total_spend_micro_usd: z.number().int().nonnegative(),
    total_api_calls: z.number().int().nonnegative(),
    advisor_call_count: z.number().int().nonnegative(),
    spend_per_advisor_call_micro_usd: z.number().int().nonnegative(),
    avg_daily_spend_micro_usd: z.number().int().nonnegative(),
    avg_monthly_spend_micro_usd: z.number().int().nonnegative(),

    // Time series + rollups for charts/tables
    by_day: z.array(CostAnalysisByDayRow),
    by_feature: z.array(CostAnalysisByFeatureRow),
    by_model: z.array(CostAnalysisByModelRow),
  })
  .strict();

export type CostAnalysisRequestT = z.infer<typeof CostAnalysisRequest>;
export type CostAnalysisResponseT = z.infer<typeof CostAnalysisResponse>;

// Step 5b-3-API inferred types — rep note review bridge.
export type CallNoteSourceT = z.infer<typeof CallNoteSourceSchema>;
export type CallNoteStatusT = z.infer<typeof CallNoteStatusSchema>;
export type SfdcRecordTypeT = z.infer<typeof SfdcRecordTypeSchema>;
export type BridgeLinkageStrategyT = z.infer<typeof BridgeLinkageStrategySchema>;
export type CallNoteAttendeeT = z.infer<typeof CallNoteAttendeeSchema>;
export type CallNoteSummaryT = z.infer<typeof CallNoteSummarySchema>;
export type CallNoteDetailT = z.infer<typeof CallNoteDetailSchema>;
export type BridgeSfdcCandidateT = z.infer<typeof BridgeSfdcCandidateSchema>;
export type BridgeSfdcSuggestionT = z.infer<typeof BridgeSfdcSuggestionSchema>;
export type MyNoteReviewListResponseT = z.infer<typeof MyNoteReviewListResponse>;
export type GetCallNoteReviewResponseT = z.infer<typeof GetCallNoteReviewResponse>;
export type EditCallNoteRequestT = z.infer<typeof EditCallNoteRequest>;
export type EditCallNoteResponseT = z.infer<typeof EditCallNoteResponse>;
export type SfdcSearchQueryTypeT = z.infer<typeof SfdcSearchQueryTypeSchema>;
export type SfdcSearchRequestT = z.infer<typeof SfdcSearchRequest>;
export type SfdcSearchMatchT = z.infer<typeof SfdcSearchMatchSchema>;
export type SfdcSearchResponseT = z.infer<typeof SfdcSearchResponse>;
export type SetSfdcLinkRequestT = z.infer<typeof SetSfdcLinkRequest>;
export type SetSfdcLinkResponseT = z.infer<typeof SetSfdcLinkResponse>;
export type SubmitNoteReviewRequestT = z.infer<typeof SubmitNoteReviewRequest>;
export type SubmitNoteReviewResponseT = z.infer<typeof SubmitNoteReviewResponse>;
export type RejectNoteReviewRequestT = z.infer<typeof RejectNoteReviewRequest>;
export type RejectNoteReviewResponseT = z.infer<typeof RejectNoteReviewResponse>;
