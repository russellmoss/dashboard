import type {
  RoleT,
  RevealPolicyT,
  RubricRoleT,
  RubricStatusT,
  RubricDimensionDefT,
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
  /** reps.role for the call's rep — 'SGA' | 'SGM' | 'manager' | 'admin' | null.
   * Drives the queue's role filter (matches CoachingUsage's repRole semantics). */
  rep_role: string | null;
  assigned_manager_id_snapshot: string;
  assigned_manager_full_name: string | null;
  status: 'pending_review' | 'revealed' | 'auto_revealed';
  edit_version: number;
  scheduled_reveal_at: string | null;
  revealed_at: string | null;
  reveal_override_action: 'hold' | 'custom_delay' | null;
  /** Rubric version snapshot at evaluation time (mirrors evaluations.rubric_version).
   * Null on legacy rows scored before rubric versioning was introduced. */
  rubric_version: number | null;
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
  /** Rubric version snapshot at evaluation time (from evaluations.rubric_version). */
  rubric_version: number | null;
  /** Joined rubric.name (from evaluations.rubric_id × rubrics.id). Null if rubric_id is null. */
  rubric_name: string | null;
  /** Count of dimensions in the snapshotted rubric — surfaces in the version-badge tooltip
   * to make cross-version score comparisons explicit. */
  rubric_dimension_count: number | null;
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
  /** call_notes.sfdc_record_id — null pre-approval / manual_entry. Used by
   *  the eval-detail route's authority check to allow SGA/SGM cross-rep
   *  access when both reps share the same SFDC record (2026-05-10). */
  call_sfdc_record_id: string | null;
  transcript: unknown | null;
  created_at: string;
  updated_at: string;

  // Step 5b-1: canonical (manager-edited) mirrors of ai_original fields.
  // dimension_scores: Record<dimension_name, { score: number 1-4, citations: Citation[] }>
  // narrative: { text: string, citations: Citation[] } — JSONB NOT NULL on the column,
  //   but the response type is nullable so older transitional fixtures don't crash.
  dimension_scores: Record<string, { score: number; citations?: Citation[] }> | null;
  narrative: { text: string; citations?: Citation[] } | null;
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

/** A single utterance/KB citation block embedded inside ai_original or canonical fields. */
export interface Citation {
  utterance_index?: number;
  kb_source?: {
    chunk_id: string;
    doc_id: string;
    drive_url: string;
    doc_title: string;
  };
}

/** A pinned utterance-level comment (manager+admin authored). */
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

/** Augmentation joined onto a KB citation for the side panel. */
export interface KbChunkAugmentation {
  owner: string;
  chunk_text: string;
}

/** Defensive shape for a transcript utterance — actual JSONB carries `speaker_role`
 * with values 'rep' | 'other_party' (per sales-coaching/src/granola/transcript.ts).
 * Time fields are seconds, not ISO timestamps. */
export interface TranscriptUtterance {
  utterance_index: number;
  /** Internal label after mapping `speaker_role` → ui-side bucket. */
  speaker: 'rep' | 'advisor' | 'unknown';
  text: string;
  start_seconds?: number;
  end_seconds?: number;
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
  | 'admin-refinements'
  | 'rubrics'
  | 'coaching-usage';

/** Rubrics tab listing row. Source: getRubricsForList (LEFT JOIN reps for creator name). */
export interface RubricListRow {
  id: string;
  name: string;
  role: RubricRoleT;
  version: number;
  edit_version: number;
  status: RubricStatusT;
  dimensions: RubricDimensionDefT[];
  created_by: string;
  /** COALESCE(reps.full_name, 'System') — seeds with no rep row read 'System'. */
  created_by_name: string;
  /** COALESCE(reps.is_system, true) — drives Edit→View lock in the listing. */
  created_by_is_system: boolean;
  created_at: string;
  updated_at: string;
}
