// Server-only. Importing from a 'use client' file leaks the secret.
import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { randomUUID } from 'node:crypto';
import { ZodError, type ZodTypeAny } from 'zod';
import {
  // Request schema VALUES (no `Schema` suffix on request/response):
  CreateUserRequest, UpdateUserRequest,
  BulkReassignRequest, RevealSchedulingRequest,
  ManualRevealRequest, UpdateRevealPolicyRequest,
  ContentRefinementResolveRequest,
  EditEvaluationRequest, TranscriptCommentCreateRequest,
  ContentRefinementCreateRequest,
  CreateRubricRequest, UpdateDraftRubricRequest, ActivateRubricRequest,
  EditCallNoteRequest, SfdcSearchRequest, SetSfdcLinkRequest,
  SubmitNoteReviewRequest, RejectNoteReviewRequest,
  CostAnalysisResponse,
  // Response schema VALUES:
  CreateUserResponse, UpdateUserResponse,
  DeactivateUserResponseOk,
  BulkReassignResponse, RevealSchedulingResponse,
  ManualRevealResponse, UpdateRevealPolicyResponse,
  ContentRefinementResolveResponse,
  EditEvaluationResponse, TranscriptCommentResponse,
  ContentRefinementResponse, MyContentRefinementsResponse,
  DeleteTranscriptCommentResponse,
  RubricResponse, RubricListResponse, DeleteRubricResponse,
  MyNoteReviewListResponse, GetCallNoteReviewResponse,
  EditCallNoteResponse, SfdcSearchResponse, SetSfdcLinkResponse,
  SubmitNoteReviewResponse, RejectNoteReviewResponse,
  // Catch-all error envelope (used to parse ALL non-2xx bodies):
  ErrorResponseSchema,
  // Inferred types (always with `T` suffix):
  type CreateUserRequestT, type UpdateUserRequestT,
  type BulkReassignRequestT, type RevealSchedulingRequestT,
  type ManualRevealRequestT, type UpdateRevealPolicyRequestT,
  type ContentRefinementResolveRequestT,
  type EditEvaluationRequestT, type TranscriptCommentCreateRequestT,
  type ContentRefinementCreateRequestT,
  type CreateUserResponseT, type UpdateUserResponseT,
  type DeactivateUserResponseOkT,
  type BulkReassignResponseT, type RevealSchedulingResponseT,
  type ManualRevealResponseT, type UpdateRevealPolicyResponseT,
  type ContentRefinementResolveResponseT,
  type EditEvaluationResponseT, type TranscriptCommentResponseT,
  type ContentRefinementResponseT, type MyContentRefinementsResponseT,
  type DeleteTranscriptCommentResponseT,
  type RubricRoleT, type RubricStatusT,
  type CreateRubricRequestT, type UpdateDraftRubricRequestT, type ActivateRubricRequestT,
  type RubricResponseT, type RubricListResponseT,
  type DeleteRubricResponseT,
  type MyNoteReviewListResponseT, type GetCallNoteReviewResponseT,
  type EditCallNoteRequestT, type EditCallNoteResponseT,
  type SfdcSearchRequestT, type SfdcSearchResponseT,
  type SetSfdcLinkRequestT, type SetSfdcLinkResponseT,
  type SubmitNoteReviewRequestT, type SubmitNoteReviewResponseT,
  type RejectNoteReviewRequestT, type RejectNoteReviewResponseT,
  type CostAnalysisResponseT,
} from './schemas';
import { signDashboardToken } from './token';
import {
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
  EvaluationConflictError, DeactivateBlockedError,
  ContentRefinementAlreadyResolvedError,
  EvaluationNotFoundError, ContentRefinementDuplicateError,
  RubricConflictError, CallNoteConflictError,
} from './errors';

/**
 * Per-call context the caller may attach for typed-error construction. The OCC
 * conflict envelope sales-coaching returns is `{ ok: false, error: 'evaluation_conflict', message }` —
 * it does NOT include evaluation_id or expected_edit_version. So the bridge takes
 * those from the request context and stamps them onto the typed error.
 */
interface BridgeContext {
  evaluationId?: string;
  callNoteId?: string;
  expectedEditVersion?: number;
}

interface PostOptions<TReq> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  email: string;
  requestSchema?: ZodTypeAny;
  body?: TReq;
  responseSchema: ZodTypeAny;
  context?: BridgeContext;
}

async function bridgeRequest<TReq, TRes>(opts: PostOptions<TReq>): Promise<TRes> {
  const baseUrl = process.env.SALES_COACHING_API_URL;
  if (!baseUrl) throw new BridgeTransportError('SALES_COACHING_API_URL not configured', 0);

  if (opts.body !== undefined && opts.requestSchema) {
    try { opts.requestSchema.parse(opts.body); }
    catch (err) {
      if (err instanceof ZodError) throw new BridgeValidationError('Outgoing body failed local Zod validation', 0, err.issues);
      throw err;
    }
  }

  const token = signDashboardToken(opts.email, { ttlSeconds: 30 });
  const requestId = randomUUID();
  const url = `${baseUrl.replace(/\/$/, '')}${opts.path}`;
  const method = opts.method ?? 'POST';
  const isBodyMethod = method === 'POST' || method === 'PATCH';

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'X-Request-ID': requestId,
  };
  if (isBodyMethod) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: isBodyMethod && opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { request_id: requestId, bridge_path: opts.path, bridge_status: '0' },
    });
    throw new BridgeTransportError(err instanceof Error ? err.message : 'Network failure', 0, requestId);
  }

  const bodyText = await response.text();

  if (!response.ok) {
    Sentry.captureMessage(`Bridge ${method} ${opts.path} → ${response.status}`, {
      level: 'warning',
      tags: { request_id: requestId, bridge_path: opts.path, bridge_status: String(response.status) },
      extra: { responseBodyHead: bodyText.slice(0, 1024) },
    });

    let errorJson: unknown = null;
    try { errorJson = JSON.parse(bodyText); } catch { /* non-JSON */ }
    const status = response.status;

    // ALL non-2xx bodies follow `{ ok: false, error: '<code>', ... }` per
    // sales-coaching/src/server.ts errorHandler. Parse with the canonical superset.
    const errParsed = ErrorResponseSchema.safeParse(errorJson);
    const errEnvelope = errParsed.success ? errParsed.data : null;
    const errCode = errEnvelope?.error ?? null;
    const errMsg = errEnvelope?.message ?? errEnvelope?.error ?? bodyText.slice(0, 200);

    if (status === 401) {
      throw new BridgeAuthError(`Bridge auth failed: ${errCode ?? 'unauthorized'}`, 401, requestId);
    }
    if (status === 403) {
      throw new BridgeAuthError(`Bridge forbidden: ${errCode ?? 'forbidden'}`, 403, requestId);
    }
    if (status === 404) {
      // Path-scoped: only treat 404s on /evaluations/:id paths as evaluation-not-found, so a
      // DELETE /transcript-comments/:id 404 falls through to BridgeTransportError correctly.
      // Plus a code-based fallback for /content-refinements where the parent eval may be
      // tombstoned (sales-coaching surfaces `error: 'evaluation_not_found'` from a non-eval URL).
      if (/\/evaluations\/[^/]+/.test(opts.path) || errCode === 'evaluation_not_found') {
        throw new EvaluationNotFoundError(errMsg ?? 'Evaluation not found', 404, requestId);
      }
    }
    if (status === 409) {
      // Dispatch on `error` code (the actual envelope shape).
      if (errCode === 'evaluation_conflict') {
        // Server doesn't return eval_id or actual version — pull from request context.
        throw new EvaluationConflictError(
          errMsg,
          opts.context?.evaluationId ?? '',
          opts.context?.expectedEditVersion ?? -1,
          null, // unknown — caller should re-fetch eval detail to learn the new version
          requestId,
        );
      }
      // Deactivate-blocked: detected by presence of blocked_reason + blocking_count fields.
      if (
        errEnvelope &&
        (errEnvelope.blocked_reason === 'active_direct_reports' || errEnvelope.blocked_reason === 'pending_evaluations') &&
        typeof errEnvelope.blocking_count === 'number'
      ) {
        throw new DeactivateBlockedError(
          'Cannot deactivate rep with blocking dependencies',
          errEnvelope.blocked_reason,
          errEnvelope.blocking_count,
          errEnvelope.blocking_eval_ids,
          errEnvelope.blocking_rep_ids,
          requestId,
        );
      }
      if (errCode === 'content_refinement_already_resolved') {
        // Server response also includes `current_status: 'addressed' | 'declined'` (not in ErrorResponseSchema —
        // pull directly from raw json since ErrorResponseSchema would strip it).
        const raw = errorJson as { current_status?: unknown };
        const currentStatus = (raw?.current_status === 'addressed' || raw?.current_status === 'declined')
          ? raw.current_status
          : 'addressed';
        throw new ContentRefinementAlreadyResolvedError(
          'Content refinement was already resolved',
          currentStatus, requestId,
        );
      }
      if (errCode === 'content_refinement_duplicate') {
        throw new ContentRefinementDuplicateError(
          errMsg ?? 'You already have an open suggestion on this chunk.',
          409,
          requestId,
        );
      }
      if (errCode === 'rubric_conflict') {
        const reason = errEnvelope?.reason;
        if (
          reason === 'version_mismatch' ||
          reason === 'not_in_draft' ||
          reason === 'concurrent_activation' ||
          reason === 'has_evaluation_references'
        ) {
          throw new RubricConflictError(errMsg, reason, requestId);
        }
        // Unknown reason — fall through to generic 409 handling
      }
      if (errCode === 'call_note_conflict') {
        // Server doesn't return actual version — caller should reload to discover it.
        throw new CallNoteConflictError(
          errMsg,
          opts.context?.callNoteId ?? '',
          opts.context?.expectedEditVersion ?? -1,
          null,
          requestId,
        );
      }
      throw new BridgeTransportError(`Conflict: ${errCode ?? '409'}`, 409, requestId);
    }
    if (status === 400) {
      throw new BridgeValidationError(
        errMsg,
        400,
        // ErrorResponseSchema doesn't define `issues`; surface the raw body instead.
        errorJson,
        requestId,
      );
    }
    throw new BridgeTransportError(`Bridge ${method} ${opts.path} returned ${status}: ${errCode ?? 'unknown'}`, status, requestId);
  }

  let json: unknown;
  try { json = JSON.parse(bodyText); }
  catch (err) {
    Sentry.captureException(err, {
      tags: { request_id: requestId, bridge_path: opts.path, bridge_status: String(response.status) },
      extra: { responseBodyHead: bodyText.slice(0, 1024) },
    });
    throw new BridgeTransportError('Non-JSON response', response.status, requestId);
  }

  try { return opts.responseSchema.parse(json) as TRes; }
  catch (err) {
    Sentry.captureException(err, {
      tags: { request_id: requestId, bridge_path: opts.path, bridge_status: String(response.status) },
    });
    if (err instanceof ZodError) throw new BridgeValidationError('Response failed mirrored Zod validation', response.status, err.issues, requestId);
    throw err;
  }
}

// ----- Public methods. -----

export const salesCoachingClient = {
  createUser: (email: string, body: CreateUserRequestT) =>
    bridgeRequest<CreateUserRequestT, CreateUserResponseT>({
      method: 'POST', path: '/api/dashboard/users', email,
      requestSchema: CreateUserRequest, responseSchema: CreateUserResponse, body,
    }),
  updateUser: (email: string, repId: string, body: UpdateUserRequestT) =>
    bridgeRequest<UpdateUserRequestT, UpdateUserResponseT>({
      method: 'PATCH', path: `/api/dashboard/users/${encodeURIComponent(repId)}`, email,
      requestSchema: UpdateUserRequest, responseSchema: UpdateUserResponse, body,
    }),
  deactivateUser: (email: string, repId: string) =>
    bridgeRequest<undefined, DeactivateUserResponseOkT>({
      method: 'POST', path: `/api/dashboard/users/${encodeURIComponent(repId)}/deactivate`, email,
      responseSchema: DeactivateUserResponseOk,
    }),
  bulkReassignPendingEvals: (email: string, repId: string, body: BulkReassignRequestT) =>
    bridgeRequest<BulkReassignRequestT, BulkReassignResponseT>({
      method: 'POST', path: `/api/dashboard/users/${encodeURIComponent(repId)}/bulk-reassign-pending-evals`, email,
      requestSchema: BulkReassignRequest, responseSchema: BulkReassignResponse, body,
    }),
  setRevealScheduling: (email: string, evaluationId: string, body: RevealSchedulingRequestT) =>
    bridgeRequest<RevealSchedulingRequestT, RevealSchedulingResponseT>({
      method: 'PATCH', path: `/api/dashboard/evaluations/${encodeURIComponent(evaluationId)}/reveal-scheduling`, email,
      requestSchema: RevealSchedulingRequest, responseSchema: RevealSchedulingResponse, body,
      // Pass eval_id + expected version so EvaluationConflictError carries them on 409.
      // body.expected_edit_version is on the schema (verified in sales-coaching/src/lib/dashboard-api/schemas.ts).
      context: { evaluationId, expectedEditVersion: (body as { expected_edit_version: number }).expected_edit_version },
    }),
  manualReveal: (email: string, evaluationId: string, body: ManualRevealRequestT) =>
    bridgeRequest<ManualRevealRequestT, ManualRevealResponseT>({
      method: 'POST', path: `/api/dashboard/evaluations/${encodeURIComponent(evaluationId)}/reveal`, email,
      requestSchema: ManualRevealRequest, responseSchema: ManualRevealResponse, body,
      context: { evaluationId, expectedEditVersion: (body as { expected_edit_version: number }).expected_edit_version },
    }),
  updateRevealPolicy: (email: string, body: UpdateRevealPolicyRequestT) =>
    bridgeRequest<UpdateRevealPolicyRequestT, UpdateRevealPolicyResponseT>({
      method: 'PATCH', path: `/api/dashboard/users/me/reveal-policy`, email,
      requestSchema: UpdateRevealPolicyRequest, responseSchema: UpdateRevealPolicyResponse, body,
    }),
  resolveContentRefinement: (email: string, refinementId: string, body: ContentRefinementResolveRequestT) =>
    bridgeRequest<ContentRefinementResolveRequestT, ContentRefinementResolveResponseT>({
      method: 'POST', path: `/api/dashboard/content-refinements/${encodeURIComponent(refinementId)}/resolve`, email,
      requestSchema: ContentRefinementResolveRequest, responseSchema: ContentRefinementResolveResponse, body,
    }),

  editEvaluation: (email: string, evaluationId: string, body: EditEvaluationRequestT) =>
    bridgeRequest<EditEvaluationRequestT, EditEvaluationResponseT>({
      method: 'PATCH',
      path: `/api/dashboard/evaluations/${encodeURIComponent(evaluationId)}/edit`,
      email,
      requestSchema: EditEvaluationRequest,
      responseSchema: EditEvaluationResponse,
      body,
      context: {
        evaluationId,
        expectedEditVersion: (body as { expected_edit_version: number }).expected_edit_version,
      },
    }),

  createTranscriptComment: (
    email: string,
    evaluationId: string,
    body: TranscriptCommentCreateRequestT,
  ) =>
    bridgeRequest<TranscriptCommentCreateRequestT, TranscriptCommentResponseT>({
      method: 'POST',
      path: `/api/dashboard/evaluations/${encodeURIComponent(evaluationId)}/transcript-comments`,
      email,
      requestSchema: TranscriptCommentCreateRequest,
      responseSchema: TranscriptCommentResponse,
      body,
      context: { evaluationId },
    }),

  deleteTranscriptComment: (email: string, commentId: string) =>
    bridgeRequest<undefined, DeleteTranscriptCommentResponseT>({
      method: 'DELETE',
      path: `/api/dashboard/transcript-comments/${encodeURIComponent(commentId)}`,
      email,
      responseSchema: DeleteTranscriptCommentResponse,
    }),

  submitContentRefinement: (email: string, body: ContentRefinementCreateRequestT) =>
    bridgeRequest<ContentRefinementCreateRequestT, ContentRefinementResponseT>({
      method: 'POST',
      path: `/api/dashboard/content-refinements`,
      email,
      requestSchema: ContentRefinementCreateRequest,
      responseSchema: ContentRefinementResponse,
      body,
    }),

  listMyContentRefinements: (email: string) =>
    bridgeRequest<undefined, MyContentRefinementsResponseT>({
      method: 'GET',
      path: `/api/dashboard/my-content-refinements`,
      email,
      responseSchema: MyContentRefinementsResponse,
    }),

  // ----- Step 5b-2-API: Rubric management. -----
  listRubrics: (
    email: string,
    query?: { role?: RubricRoleT; status?: RubricStatusT },
  ) => {
    const qs = new URLSearchParams();
    if (query?.role) qs.set('role', query.role);
    if (query?.status) qs.set('status', query.status);
    const path = qs.toString()
      ? `/api/dashboard/rubrics?${qs.toString()}`
      : '/api/dashboard/rubrics';
    return bridgeRequest<undefined, RubricListResponseT>({
      method: 'GET',
      path,
      email,
      responseSchema: RubricListResponse,
    });
  },

  getRubric: (email: string, id: string) =>
    bridgeRequest<undefined, RubricResponseT>({
      method: 'GET',
      path: `/api/dashboard/rubrics/${encodeURIComponent(id)}`,
      email,
      responseSchema: RubricResponse,
    }),

  createRubric: (email: string, body: CreateRubricRequestT) =>
    bridgeRequest<CreateRubricRequestT, RubricResponseT>({
      method: 'POST',
      path: '/api/dashboard/rubrics',
      email,
      requestSchema: CreateRubricRequest,
      responseSchema: RubricResponse,
      body,
    }),

  updateDraftRubric: (email: string, id: string, body: UpdateDraftRubricRequestT) =>
    bridgeRequest<UpdateDraftRubricRequestT, RubricResponseT>({
      method: 'PATCH',
      path: `/api/dashboard/rubrics/${encodeURIComponent(id)}`,
      email,
      requestSchema: UpdateDraftRubricRequest,
      responseSchema: RubricResponse,
      body,
    }),

  activateRubric: (email: string, id: string, body: ActivateRubricRequestT) =>
    bridgeRequest<ActivateRubricRequestT, RubricResponseT>({
      method: 'PATCH',
      path: `/api/dashboard/rubrics/${encodeURIComponent(id)}/activate`,
      email,
      requestSchema: ActivateRubricRequest,
      responseSchema: RubricResponse,
      body,
    }),

  deleteRubric: (email: string, id: string) =>
    bridgeRequest<undefined, DeleteRubricResponseT>({
      method: 'DELETE',
      path: `/api/dashboard/rubrics/${encodeURIComponent(id)}`,
      email,
      responseSchema: DeleteRubricResponse,
    }),

  // ----- Step 5b-3-API: Rep note-review bridge. -----
  listMyNoteReviews: (email: string) =>
    bridgeRequest<undefined, MyNoteReviewListResponseT>({
      method: 'GET',
      path: '/api/dashboard/note-review/me',
      email,
      responseSchema: MyNoteReviewListResponse,
    }),

  getCallNoteReview: (email: string, callNoteId: string) =>
    bridgeRequest<undefined, GetCallNoteReviewResponseT>({
      method: 'GET',
      path: `/api/dashboard/note-review/${encodeURIComponent(callNoteId)}`,
      email,
      responseSchema: GetCallNoteReviewResponse,
    }),

  editCallNote: (email: string, callNoteId: string, body: EditCallNoteRequestT) =>
    bridgeRequest<EditCallNoteRequestT, EditCallNoteResponseT>({
      method: 'PATCH',
      path: `/api/dashboard/note-review/${encodeURIComponent(callNoteId)}`,
      email,
      requestSchema: EditCallNoteRequest,
      responseSchema: EditCallNoteResponse,
      body,
      context: { callNoteId, expectedEditVersion: (body as { expected_edit_version: number }).expected_edit_version },
    }),

  searchSfdcForNote: (email: string, callNoteId: string, body: SfdcSearchRequestT) =>
    bridgeRequest<SfdcSearchRequestT, SfdcSearchResponseT>({
      method: 'POST',
      path: `/api/dashboard/note-review/${encodeURIComponent(callNoteId)}/sfdc-search`,
      email,
      requestSchema: SfdcSearchRequest,
      responseSchema: SfdcSearchResponse,
      body,
    }),

  setSfdcLink: (email: string, callNoteId: string, body: SetSfdcLinkRequestT) =>
    bridgeRequest<SetSfdcLinkRequestT, SetSfdcLinkResponseT>({
      method: 'PATCH',
      path: `/api/dashboard/note-review/${encodeURIComponent(callNoteId)}/sfdc-link`,
      email,
      requestSchema: SetSfdcLinkRequest,
      responseSchema: SetSfdcLinkResponse,
      body,
      context: { callNoteId, expectedEditVersion: (body as { expected_edit_version: number }).expected_edit_version },
    }),

  submitNoteReview: (email: string, callNoteId: string, body: SubmitNoteReviewRequestT) =>
    bridgeRequest<SubmitNoteReviewRequestT, SubmitNoteReviewResponseT>({
      method: 'POST',
      path: `/api/dashboard/note-review/${encodeURIComponent(callNoteId)}/submit`,
      email,
      requestSchema: SubmitNoteReviewRequest,
      responseSchema: SubmitNoteReviewResponse,
      body,
      context: { callNoteId, expectedEditVersion: (body as { expected_edit_version: number }).expected_edit_version },
    }),

  rejectNoteReview: (email: string, callNoteId: string, body: RejectNoteReviewRequestT) =>
    bridgeRequest<RejectNoteReviewRequestT, RejectNoteReviewResponseT>({
      method: 'POST',
      path: `/api/dashboard/note-review/${encodeURIComponent(callNoteId)}/reject`,
      email,
      requestSchema: RejectNoteReviewRequest,
      responseSchema: RejectNoteReviewResponse,
      body,
      context: { callNoteId, expectedEditVersion: (body as { expected_edit_version: number }).expected_edit_version },
    }),

  // ----- Cost Analysis tab — AI spend rollups. -----
  getCostAnalysis: (email: string, params: { start_date: string; end_date: string }) => {
    const qs = new URLSearchParams({
      start_date: params.start_date,
      end_date: params.end_date,
    });
    return bridgeRequest<undefined, CostAnalysisResponseT>({
      method: 'GET',
      path: `/api/dashboard/cost-analysis?${qs.toString()}`,
      email,
      responseSchema: CostAnalysisResponse,
    });
  },
};

export {
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
  EvaluationConflictError, DeactivateBlockedError,
  ContentRefinementAlreadyResolvedError,
  EvaluationNotFoundError, ContentRefinementDuplicateError,
  RubricConflictError, CallNoteConflictError,
} from './errors';
