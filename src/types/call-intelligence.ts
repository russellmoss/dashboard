import type {
  RoleT,
  RevealPolicyT,
} from '@/lib/sales-coaching-client/schemas';

/** Queue tab row. Source: getEvaluationsForManager. */
export interface EvaluationQueueRow {
  evaluation_id: string;
  call_note_id: string;
  call_started_at: string | null;
  call_title: string | null;
  /** First non-Savvy attendee name; falls back to first non-Savvy attendee email,
   * then first non-Savvy invitee email. Null when all attendees are internal. */
  advisor_name: string | null;
  rep_id: string;
  rep_full_name: string | null;
  assigned_manager_id_snapshot: string;
  assigned_manager_full_name: string | null;
  status: 'pending_review' | 'revealed' | 'auto_revealed';
  edit_version: number;
  scheduled_reveal_at: string | null;
  revealed_at: string | null;
  reveal_override_action: 'hold' | 'custom_delay' | null;
  created_at: string;
}

/** Eval detail. Source: getEvaluationDetail. */
export interface EvaluationDetail {
  evaluation_id: string;
  call_note_id: string;
  call_started_at: string | null;
  rep_id: string;
  rep_full_name: string | null;
  assigned_manager_id_snapshot: string;
  assigned_manager_full_name: string | null;
  status: 'pending_review' | 'revealed' | 'auto_revealed';
  edit_version: number;
  scheduled_reveal_at: string | null;
  revealed_at: string | null;
  reveal_override_action: 'hold' | 'custom_delay' | null;
  reveal_override_delay_minutes: number | null;
  reveal_policy_snapshot: RevealPolicyT;
  reveal_delay_minutes_snapshot: number | null;
  reveal_reminder_minutes_snapshot: number | null;
  /** Numeric overall score 1.0–4.0 (or null on legacy rows). Mirrors
   * `evaluations.overall_score` — pg-node returns numeric as string, the query
   * helper coerces to number. */
  overall_score: number | null;
  /** AI-original JSONB. v5 shape (latest): `{ dimensionScores, narrative,
   * strengths, weaknesses, knowledgeGaps, complianceFlags, coachingNudge,
   * additionalObservations, repDeferrals }`. Older rows may be missing fields.
   * Renderer is defensive across schema versions. */
  ai_original: unknown;
  ai_original_schema_version: number | null;
  call_summary_markdown: string | null;
  transcript: unknown | null;
  created_at: string;
  updated_at: string;
}

/** Admin: Users row. Aligns with CreateUserResponse['rep']. */
export interface CoachingRep {
  id: string;
  email: string;
  full_name: string;
  role: RoleT;
  manager_id: string | null;
  manager_full_name: string | null;
  is_active: boolean;
  reveal_policy: RevealPolicyT;
  reveal_delay_minutes: number | null;
  reveal_reminder_minutes: number | null;
  created_at: string;
}

/** Admin: Content Refinements row. Source: content_refinement_requests table, status='open'. */
export interface ContentRefinementRow {
  id: string;
  requested_by: string;
  requested_by_full_name: string | null;
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

/** My settings — current user's reveal policy. */
export interface RevealSettings {
  rep_id: string;
  policy: RevealPolicyT;
  delay_minutes: number | null;
  reminder_minutes: number | null;
}

export type CallIntelligenceTab =
  | 'queue'
  | 'settings'
  | 'admin-users'
  | 'admin-refinements';
