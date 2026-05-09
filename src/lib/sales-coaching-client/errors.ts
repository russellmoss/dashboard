export class BridgeError extends Error {
  constructor(message: string, public readonly status: number, public readonly requestId?: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

export class BridgeAuthError extends BridgeError {
  constructor(message: string, status: number, requestId?: string) {
    super(message, status, requestId);
    this.name = 'BridgeAuthError';
  }
}

export class BridgeTransportError extends BridgeError {
  constructor(message: string, status: number, requestId?: string) {
    super(message, status, requestId);
    this.name = 'BridgeTransportError';
  }
}

export class BridgeValidationError extends BridgeError {
  constructor(message: string, status: number, public readonly issues: unknown, requestId?: string) {
    super(message, status, requestId);
    this.name = 'BridgeValidationError';
  }
}

export class EvaluationConflictError extends BridgeError {
  constructor(
    message: string,
    public readonly evaluationId: string,
    public readonly expectedVersion: number,
    // Sales-coaching's 409 envelope does NOT include the actual version
    // (only `{ ok: false, error: 'evaluation_conflict', message }`).
    // The Dashboard reloads the eval detail to discover the new version.
    public readonly actualVersion: number | null,
    requestId?: string,
  ) {
    super(message, 409, requestId);
    this.name = 'EvaluationConflictError';
  }
}

export class DeactivateBlockedError extends BridgeError {
  constructor(
    message: string,
    public readonly blocked_reason: 'active_direct_reports' | 'pending_evaluations',
    public readonly blocking_count: number,
    public readonly blocking_eval_ids?: string[],
    public readonly blocking_rep_ids?: string[],
    requestId?: string,
  ) {
    super(message, 409, requestId);
    this.name = 'DeactivateBlockedError';
  }
}

/**
 * 409 Conflict surfaced when admin attempts to resolve a content_refinement
 * that another admin already addressed/declined.
 * Server returns: `{ ok: false, error: 'content_refinement_already_resolved', current_status: '...' }`.
 */
export class ContentRefinementAlreadyResolvedError extends BridgeError {
  constructor(
    message: string,
    public readonly currentStatus: 'addressed' | 'declined',
    requestId?: string,
  ) {
    super(message, 409, requestId);
    this.name = 'ContentRefinementAlreadyResolvedError';
  }
}
