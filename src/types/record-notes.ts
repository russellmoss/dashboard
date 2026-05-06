// Response shape for GET /api/dashboard/record-detail/[id]/notes — the
// per-record Notes tab in RecordDetailModal. One entry per call_note row
// confidently linked to the record's Lead/Contact.

export type LinkConfidence =
  /** Notes were pushed back to SFDC and the call_note carries that record id. Strongest signal. */
  | 'pushed'
  /** sfdc_who_id was populated to this Lead/Contact at write-time, but no SFDC writeback was logged. */
  | 'direct'
  /** sfdc_who_id was NULL at write-time but a unique invitee email maps to this Lead/Contact in BQ. */
  | 'email';

export interface NoteRecord {
  /** call_notes.id (uuid) */
  id: string;
  /** ISO-8601 timestamp of when the call started. */
  callDate: string;
  /** Originating system. UI treats both identically — surfaced for transparency only. */
  source: 'granola' | 'kixie';
  /** Savvy-side rep who placed/received the call. Resolved from reps.full_name. Null if rep deleted. */
  repName: string | null;
  /** SGA / SGM / manager / admin — the rep's role in Neon at lookup time. */
  repRole: string | null;
  /** The rep's manager (typically an SGM). Pulled via reps.manager_id chain. */
  managerName: string | null;
  /** Other Savvy people who appear in invitee_emails (Granola only). Resolved to full names where possible. */
  otherSavvyAttendees: string[];
  /** Human-facing notes — summary_markdown for Granola, the non-coaching half of summary_markdown for Kixie. */
  notesMarkdown: string;
  /** Coaching-analysis markdown — empty string when none exists for this row. */
  coachingMarkdown: string;
  /** True iff a sfdc_write_log row exists with status='success' for this call_note. */
  pushedToSfdc: boolean;
  /** Why this note appears under THIS record. UI may render a small badge. */
  linkConfidence: LinkConfidence;
}

export interface RecordNotesResponse {
  notes: NoteRecord[];
  /** True iff the user is permitted to see notes for this record (per RBAC). False payload always has notes=[]. */
  authorized: boolean;
  /** The Lead Id this response is keyed on (resolved from the route param if it was an Opp Id). */
  leadId: string | null;
  generated_at: string;
}
