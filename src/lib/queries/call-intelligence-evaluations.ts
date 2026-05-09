import { getCoachingPool } from '@/lib/coachingDb';
import { resolveAdvisorNames } from '@/lib/queries/resolve-advisor-names';
import type {
  EvaluationQueueRow,
  EvaluationDetail,
  TranscriptCommentRow,
} from '@/types/call-intelligence';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Internal pseudo-domains that should never surface as the "advisor".
// Matches the existing Coaching Usage cascade (`isSavvyInternal` + resource calendar filter).
const SAVVY_INTERNAL_DOMAINS = ['@savvywealth.com', '@savvyadvisors.com'];
const CALENDAR_RESOURCE_DOMAIN = '@resource.calendar.google.com';

function isInternalOrResource(email: string): boolean {
  const lc = email.toLowerCase().trim();
  if (!lc) return true;
  if (lc.endsWith(CALENDAR_RESOURCE_DOMAIN)) return true;
  return SAVVY_INTERNAL_DOMAINS.some((d) => lc.endsWith(d));
}

function looksLikeEmail(s: string): boolean {
  return /@/.test(s);
}

/**
 * Resolve session.user.email to active sales-coaching reps.id.
 * Fail-closed: returns null if no active rep matches (Queue handler should return empty).
 */
export async function getRepIdByEmail(email: string): Promise<{ id: string; role: string } | null> {
  if (!email) return null;
  const pool = getCoachingPool();
  const { rows } = await pool.query<{ id: string; role: string }>(
    `SELECT id, role
       FROM reps
      WHERE LOWER(email) = LOWER($1)
        AND is_active = true
        AND is_system = false
      LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

/**
 * SGM clarification (Bucket 2 Q5 resolution): SGMs are COACHEES, not reviewers.
 * Their evaluations are reviewed by managers/admins (e.g., Hipperson/Weiner with role='manager').
 * Therefore SGM Queue scope is identical to SGA scope — own rep_id only.
 * `reps.manager_id` IS populated for both SGA and SGM rows (each has an upstream manager).
 */
export type QueueScope =
  | { kind: 'admin' }
  | { kind: 'manager'; managerRepId: string }
  | { kind: 'sgm'; repId: string }
  | { kind: 'sga'; repId: string };

/** History filter for queue UI toggle. Default: 'pending'. */
export type HistoryFilter = 'pending' | 'revealed' | 'all';

function statusWhere(filter: HistoryFilter): string {
  switch (filter) {
    case 'pending':  return `e.status = 'pending_review'`;
    case 'revealed': return `e.status IN ('revealed', 'auto_revealed')`;
    case 'all':      return `TRUE`;
  }
}

export async function getEvaluationsForManager(
  scope: QueueScope,
  opts: { limit?: number; historyFilter?: HistoryFilter } = {},
): Promise<EvaluationQueueRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const historyFilter = opts.historyFilter ?? 'pending';
  const pool = getCoachingPool();

  let scopeWhere: string;
  let scopeParams: unknown[];
  if (scope.kind === 'admin') {
    scopeWhere = `TRUE`;
    scopeParams = [];
  } else if (scope.kind === 'manager') {
    scopeWhere = `e.assigned_manager_id_snapshot = $1`;
    scopeParams = [scope.managerRepId];
  } else {
    // sgm AND sga: both are coachees — scope by own rep_id (eval.rep_id == cn.rep_id == self).
    scopeWhere = `e.rep_id = $1`;
    scopeParams = [scope.repId];
  }

  const params: unknown[] = [...scopeParams, limit];
  const limitParamIdx = params.length;
  // SQL pulls the raw signals (sfdc_who_id, attendees JSONB, invitee_emails) AND a
  // cheap fallback advisor_name (first attendee name → first attendee email → first
  // invitee email, all internal/resource-domain filtered). The returned rows then go
  // through resolveAdvisorNames() to upgrade the fallback with BQ-resolved Lead/Contact
  // names whenever sfdc_who_id matches OR a non-Savvy email uniquely resolves.
  const sql = `
    SELECT
      e.id                            AS evaluation_id,
      e.call_note_id,
      cn.call_started_at,
      cn.title                        AS call_title,
      cn.sfdc_who_id                  AS sfdc_who_id,
      cn.invitee_emails               AS invitee_emails,
      COALESCE(
        (SELECT a->>'name'
           FROM jsonb_array_elements(cn.attendees) AS a
          WHERE NULLIF(TRIM(a->>'name'), '') IS NOT NULL
            AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@savvywealth.com'
            AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@savvyadvisors.com'
            AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@resource.calendar.google.com'
            AND TRIM(a->>'name') NOT LIKE '%@resource.calendar.google.com'
          LIMIT 1),
        (SELECT a->>'email'
           FROM jsonb_array_elements(cn.attendees) AS a
          WHERE LOWER(COALESCE(a->>'email','')) NOT LIKE '%@savvywealth.com'
            AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@savvyadvisors.com'
            AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@resource.calendar.google.com'
            AND COALESCE(a->>'email','') <> ''
          LIMIT 1),
        (SELECT eml
           FROM unnest(cn.invitee_emails) AS eml
          WHERE LOWER(eml) NOT LIKE '%@savvywealth.com'
            AND LOWER(eml) NOT LIKE '%@savvyadvisors.com'
            AND LOWER(eml) NOT LIKE '%@resource.calendar.google.com'
          LIMIT 1)
      )                               AS advisor_name_fallback,
      e.rep_id,
      sga.full_name                   AS rep_full_name,
      e.assigned_manager_id_snapshot,
      mgr.full_name                   AS assigned_manager_full_name,
      e.status,
      e.edit_version,
      e.scheduled_reveal_at,
      e.revealed_at,
      e.reveal_override_action,
      e.created_at
    FROM evaluations e
    JOIN call_notes cn         ON cn.id = e.call_note_id
    LEFT JOIN reps  sga        ON sga.id = e.rep_id                     AND sga.is_system = false
    LEFT JOIN reps  mgr        ON mgr.id = e.assigned_manager_id_snapshot AND mgr.is_system = false
    WHERE (${scopeWhere}) AND (${statusWhere(historyFilter)})
    ORDER BY e.created_at DESC NULLS LAST
    LIMIT $${limitParamIdx}
  `;

  interface RawRow extends Omit<EvaluationQueueRow, 'advisor_name'> {
    sfdc_who_id: string | null;
    invitee_emails: string[] | null;
    advisor_name_fallback: string | null;
  }
  const { rows: rawRows } = await pool.query<RawRow>(sql, params);

  // Collect signals for the BQ resolver: real SFDC who_ids, plus all external
  // (non-Savvy, non-resource) invitee emails. Empty inputs short-circuit BQ.
  const whoIds = new Set<string>();
  const emails = new Set<string>();
  for (const r of rawRows) {
    if (r.sfdc_who_id) whoIds.add(r.sfdc_who_id);
    if (Array.isArray(r.invitee_emails)) {
      for (const e of r.invitee_emails) {
        if (typeof e !== 'string') continue;
        const t = e.trim();
        if (!t || isInternalOrResource(t)) continue;
        emails.add(t.toLowerCase());
      }
    }
    // Also feed the fallback (if it's an email shape) into the unique-resolver. This
    // covers the case where attendees has only an email — fallback already holds it
    // and we want the name lookup if it uniquely resolves.
    if (r.advisor_name_fallback && looksLikeEmail(r.advisor_name_fallback)) {
      const lc = r.advisor_name_fallback.toLowerCase().trim();
      if (lc && !isInternalOrResource(lc)) emails.add(lc);
    }
  }

  // BQ round-trip (skipped entirely when both sets are empty — first render of an
  // empty queue, or admin-only fully-internal calls).
  let bq: Awaited<ReturnType<typeof resolveAdvisorNames>> = {
    whoIdToInfo: {}, emailToUniqueInfo: {}, kixieTaskIdToInfo: {},
  };
  try {
    if (whoIds.size > 0 || emails.size > 0) {
      bq = await resolveAdvisorNames({ whoIds: [...whoIds], emails: [...emails] });
    }
  } catch (err) {
    // BQ failure is not fatal — the fallback advisor_name from SQL is still useful.
    console.warn('[call-intelligence-evaluations] resolveAdvisorNames failed; using SQL fallback only', err);
  }

  return rawRows.map((r): EvaluationQueueRow => {
    let advisor_name: string | null = null;

    // 1. SFDC who_id direct match.
    if (r.sfdc_who_id && bq.whoIdToInfo[r.sfdc_who_id]) {
      advisor_name = bq.whoIdToInfo[r.sfdc_who_id]!.name;
    }
    // 2. Unique-email match across non-Savvy invitees.
    if (!advisor_name && Array.isArray(r.invitee_emails)) {
      for (const e of r.invitee_emails) {
        if (typeof e !== 'string') continue;
        const lc = e.toLowerCase().trim();
        if (!lc || isInternalOrResource(lc)) continue;
        const hit = bq.emailToUniqueInfo[lc];
        if (hit) { advisor_name = hit.name; break; }
      }
    }
    // 3. If the SQL fallback is an email and it uniquely resolves, use the name.
    if (!advisor_name && r.advisor_name_fallback && looksLikeEmail(r.advisor_name_fallback)) {
      const lc = r.advisor_name_fallback.toLowerCase().trim();
      const hit = lc && !isInternalOrResource(lc) ? bq.emailToUniqueInfo[lc] : null;
      if (hit) advisor_name = hit.name;
    }
    // 4. Final fallback: whatever the SQL cascade picked (attendee name / email /
    //    invitee email — already filtered for Savvy + calendar-resource).
    if (!advisor_name) {
      advisor_name = r.advisor_name_fallback ?? null;
    }

    return {
      evaluation_id: r.evaluation_id,
      call_note_id: r.call_note_id,
      call_started_at: r.call_started_at,
      call_title: r.call_title,
      advisor_name,
      rep_id: r.rep_id,
      rep_full_name: r.rep_full_name,
      assigned_manager_id_snapshot: r.assigned_manager_id_snapshot,
      assigned_manager_full_name: r.assigned_manager_full_name,
      status: r.status,
      edit_version: r.edit_version,
      scheduled_reveal_at: r.scheduled_reveal_at,
      revealed_at: r.revealed_at,
      reveal_override_action: r.reveal_override_action,
      created_at: r.created_at,
    };
  });
}

export async function getEvaluationDetail(evaluationId: string): Promise<EvaluationDetail | null> {
  if (!UUID_RE.test(evaluationId)) return null;
  const pool = getCoachingPool();
  const sql = `
    SELECT
      e.id                              AS evaluation_id,
      e.call_note_id,
      cn.call_started_at,
      e.rep_id,
      sga.full_name                     AS rep_full_name,
      e.assigned_manager_id_snapshot,
      mgr.full_name                     AS assigned_manager_full_name,
      e.status,
      e.edit_version,
      e.scheduled_reveal_at,
      e.revealed_at,
      e.reveal_override_action,
      e.reveal_override_delay_minutes,
      e.reveal_policy_snapshot,
      e.reveal_delay_minutes_snapshot,
      e.reveal_reminder_minutes_snapshot,
      e.overall_score,
      e.ai_original,
      e.ai_original_schema_version,
      e.dimension_scores,
      e.narrative,
      e.strengths,
      e.weaknesses,
      e.knowledge_gaps,
      e.compliance_flags,
      e.additional_observations,
      e.coaching_nudge,
      e.manager_edited_at,
      e.manager_edited_by,
      editor.full_name                  AS manager_edited_by_name,
      editor.is_active                  AS manager_edited_by_active,
      cn.summary_markdown               AS call_summary_markdown,
      ct.transcript,
      e.created_at,
      e.updated_at
    FROM evaluations e
    JOIN call_notes cn               ON cn.id = e.call_note_id
    LEFT JOIN reps sga               ON sga.id = e.rep_id                     AND sga.is_system = false
    LEFT JOIN reps mgr               ON mgr.id = e.assigned_manager_id_snapshot AND mgr.is_system = false
    LEFT JOIN reps editor            ON editor.id = e.manager_edited_by         AND editor.is_system = false
    LEFT JOIN call_transcripts ct    ON ct.call_note_id = e.call_note_id
    WHERE e.id = $1
    LIMIT 1
  `;
  // pg-node returns `numeric` columns as strings; coerce overall_score per the
  // sales-coaching DAL convention (context-ledger d_1777156126_5823).
  // Omit list grows because none of these are returned by SELECT (post-spread merges):
  //   transcript_comments, chunk_lookup, coaching_nudge_effective.
  interface RawDetailRow extends Omit<
    EvaluationDetail,
    'overall_score' | 'transcript_comments' | 'chunk_lookup' | 'coaching_nudge_effective'
  > {
    overall_score: number | string | null;
  }
  const { rows } = await pool.query<RawDetailRow>(sql, [evaluationId]);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    overall_score: row.overall_score === null || row.overall_score === undefined
      ? null
      : Number(row.overall_score),
    transcript_comments: [],            // populated by API route
    chunk_lookup: {},                    // populated by API route
    coaching_nudge_effective: row.coaching_nudge,  // overwritten by API route via COALESCE
  };
}

/**
 * Pinned utterance-level comments for an evaluation. Ordered by utterance index
 * then creation time. Used by the eval-detail GET route to merge into EvaluationDetail.
 */
export async function getTranscriptComments(
  evaluationId: string,
): Promise<TranscriptCommentRow[]> {
  if (!UUID_RE.test(evaluationId)) return [];
  const pool = getCoachingPool();
  const sql = `
    SELECT
      tc.id,
      tc.evaluation_id,
      tc.utterance_index,
      tc.author_id,
      r.full_name        AS author_full_name,
      tc.author_role,
      tc.text,
      tc.created_at
    FROM transcript_comments tc
    LEFT JOIN reps r ON r.id = tc.author_id AND r.is_system = false
    WHERE tc.evaluation_id = $1
    ORDER BY tc.utterance_index ASC, tc.created_at ASC
  `;
  const { rows } = await pool.query<TranscriptCommentRow>(sql, [evaluationId]);
  return rows;
}

/**
 * Hydrate a list of KB chunk_ids (the citation contract calls them chunk_id; the
 * underlying table column is `knowledge_base_chunks.id`) with owner + chunk text.
 * Returns a lookup keyed by chunk_id. Used by the eval-detail GET route to augment
 * the chunk_lookup map for inline citation pills.
 */
export async function getKbChunksByIds(
  chunkIds: string[],
): Promise<Record<string, { owner: string; chunk_text: string }>> {
  if (chunkIds.length === 0) return {};
  const validIds = chunkIds.filter((id) => UUID_RE.test(id));
  if (validIds.length === 0) return {};

  const pool = getCoachingPool();
  const sql = `
    SELECT id AS chunk_id, owner, body_text AS chunk_text
    FROM knowledge_base_chunks
    WHERE id = ANY($1::uuid[])
  `;
  const { rows } = await pool.query<{ chunk_id: string; owner: string; chunk_text: string }>(
    sql,
    [validIds],
  );

  return rows.reduce<Record<string, { owner: string; chunk_text: string }>>((acc, r) => {
    acc[r.chunk_id] = { owner: r.owner, chunk_text: r.chunk_text };
    return acc;
  }, {});
}
