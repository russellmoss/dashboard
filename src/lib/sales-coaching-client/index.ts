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
  // Response schema VALUES:
  CreateUserResponse, UpdateUserResponse,
  DeactivateUserResponseOk,
  BulkReassignResponse, RevealSchedulingResponse,
  ManualRevealResponse, UpdateRevealPolicyResponse,
  ContentRefinementResolveResponse,
  // Catch-all error envelope (used to parse ALL non-2xx bodies):
  ErrorResponseSchema,
  // Inferred types (always with `T` suffix):
  type CreateUserRequestT, type UpdateUserRequestT,
  type BulkReassignRequestT, type RevealSchedulingRequestT,
  type ManualRevealRequestT, type UpdateRevealPolicyRequestT,
  type ContentRefinementResolveRequestT,
  type CreateUserResponseT, type UpdateUserResponseT,
  type DeactivateUserResponseOkT,
  type BulkReassignResponseT, type RevealSchedulingResponseT,
  type ManualRevealResponseT, type UpdateRevealPolicyResponseT,
  type ContentRefinementResolveResponseT,
} from './schemas';
import { signDashboardToken } from './token';
import {
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
  EvaluationConflictError, DeactivateBlockedError,
  ContentRefinementAlreadyResolvedError,
} from './errors';

/**
 * Per-call context the caller may attach for typed-error construction. The OCC
 * conflict envelope sales-coaching returns is `{ ok: false, error: 'evaluation_conflict', message }` —
 * it does NOT include evaluation_id or expected_edit_version. So the bridge takes
 * those from the request context and stamps them onto the typed error.
 */
interface BridgeContext {
  evaluationId?: string;
  expectedEditVersion?: number;
}

interface PostOptions<TReq> {
  method?: 'POST' | 'PATCH';
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

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Request-ID': requestId,
        'Content-Type': 'application/json',
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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
};

export {
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
  EvaluationConflictError, DeactivateBlockedError,
  ContentRefinementAlreadyResolvedError,
} from './errors';
