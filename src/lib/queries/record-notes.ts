// Resolve all sales-coaching call_notes confidently linked to a single
// SFDC record (Lead or Opportunity), and gather the SGA/SGM/Opp-SGA
// owner names needed for the RBAC gate in the route layer.
//
// Two databases participate:
//   - BigQuery (vw_funnel_master + Lead + Contact + Task) — to identify
//     the Lead/Contact ids, owner names, and any kixie Task.Ids that
//     point at them, and to verify uniquely-resolving emails.
//   - Neon (sales-coaching call_notes + evaluations + sfdc_write_log
//     + reps) — to fetch the actual notes content with rep attribution.
//
// One BQ round-trip + one Pg round-trip per request. Cached upstream
// at the route layer.

import { runQuery } from '@/lib/bigquery';
import { getCoachingPool } from '@/lib/coachingDb';
import { renderCallNoteMarkdown } from '@/lib/coaching-notes-markdown';
import type { NoteRecord, LinkConfidence } from '@/types/record-notes';

/**
 * What the BQ resolution step returns. Owner names are surfaced here so
 * the route can apply RBAC without re-querying — the same query that
 * collects matching ids also has the owner fields available cheaply.
 */
export interface RecordContext {
  /** The Lead Id this record resolves to. Null when neither the URL param
   *  nor any vw_funnel_master row maps cleanly. */
  leadId: string | null;
  /** Lead.ConvertedContactId, when the Lead has been converted. */
  contactId: string | null;
  /** SFDC Task.Ids whose WhoId points at leadId or contactId — these are
   *  the kixie tasks that "belong" to this record. Used for the kixie
   *  self-heal arm (sfdc_who_id was NULL at write-time but Task.WhoId
   *  identifies the person). */
  matchingKixieTaskIds: string[];
  /** Emails (lowercased) that uniquely resolve to a single person across
   *  BQ Lead+Contact AND that single person is THIS record's Lead.
   *  These are safe to use as the email-matching arm. */
  uniqueEmails: string[];
  /** Lead-level SGA owner — used for RBAC. */
  sgaOwnerName: string | null;
  /** Opportunity-level SGA owner — used for RBAC (OR-with sga_owner_name). */
  oppSgaName: string | null;
  /** Lead/Opp SGM owner — single field in vw_funnel_master. Used for RBAC. */
  sgmOwnerName: string | null;
}

interface RecordContextRow {
  lead_id: string | null;
  contact_id: string | null;
  matching_task_ids: string[] | null;
  unique_emails: string[] | null;
  sga_owner_name: string | null;
  opp_sga_name: string | null;
  sgm_owner_name: string | null;
}

/**
 * Resolve a record id (Lead or Opportunity) into the full set of join
 * keys + owner names needed downstream. Single BQ query.
 *
 * The query is structured so a `recordId` matching either Lead.Id or
 * Full_Opportunity_ID__c lands on the same Lead row. Email-uniqueness
 * is computed by GROUP BY across both BQ tables and filtering to
 * emails with exactly one distinct Lead.Id in the result.
 */
export async function resolveRecordContext(recordId: string): Promise<RecordContext> {
  const sql = `
    WITH
    -- (1) Resolve the URL param to its canonical Lead Id. The param may
    -- itself be a Lead Id (00Q…) or an Opportunity Id (006…) that a Lead
    -- is the source of. vw_funnel_master joins both sides, so we can
    -- resolve in one pass.
    resolved AS (
      SELECT DISTINCT
        v.Full_prospect_id__c AS lead_id,
        v.SGA_Owner_Name__c   AS sga_owner_name,
        v.Opp_SGA_Name__c     AS opp_sga_name,
        v.SGM_Owner_Name__c   AS sgm_owner_name
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
      WHERE v.Full_prospect_id__c = @recordId
         OR v.Full_Opportunity_ID__c = @recordId
    ),
    -- Pick a single resolved row (multiple opportunities → same lead);
    -- prefer the row that names the SGA owner, then arbitrary.
    resolved_one AS (
      SELECT lead_id, sga_owner_name, opp_sga_name, sgm_owner_name
      FROM resolved
      ORDER BY (sga_owner_name IS NULL), (opp_sga_name IS NULL), lead_id
      LIMIT 1
    ),
    -- (2) The Lead and its converted Contact (if any).
    lead_row AS (
      SELECT l.Id AS lead_id, l.ConvertedContactId AS contact_id, LOWER(l.Email) AS lead_email
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
      JOIN resolved_one r ON r.lead_id = l.Id
      WHERE l.IsDeleted = FALSE
    ),
    contact_row AS (
      SELECT c.Id AS contact_id, LOWER(c.Email) AS contact_email
      FROM \`savvy-gtm-analytics.SavvyGTMData.Contact\` c
      JOIN lead_row lr ON lr.contact_id = c.Id
      WHERE c.IsDeleted = FALSE
    ),
    -- (3) Kixie self-heal: SFDC Tasks whose WhoId points at the Lead or Contact.
    matching_tasks AS (
      SELECT t.Id AS task_id
      FROM \`savvy-gtm-analytics.SavvyGTMData.Task\` t
      WHERE t.IsDeleted = FALSE
        AND t.WhoId IS NOT NULL
        AND (
          t.WhoId IN (SELECT lead_id    FROM lead_row)
          OR t.WhoId IN (SELECT contact_id FROM contact_row)
        )
    ),
    -- (4) Email-uniqueness: only include lead.Email / contact.Email if NO
    -- other Lead/Contact (any record) shares that email. Mirrors the
    -- email_unique CTE in resolve-advisor-names.ts.
    candidate_emails AS (
      SELECT lead_email AS lc_email FROM lead_row WHERE lead_email IS NOT NULL AND lead_email != ''
      UNION DISTINCT
      SELECT contact_email FROM contact_row WHERE contact_email IS NOT NULL AND contact_email != ''
    ),
    email_match_universe AS (
      SELECT LOWER(Email) AS lc_email, Id AS lead_id
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\`
      WHERE LOWER(Email) IN (SELECT lc_email FROM candidate_emails)
        AND IsDeleted = FALSE AND Email IS NOT NULL AND Email != ''
      UNION ALL
      SELECT LOWER(c.Email), l.Id
      FROM \`savvy-gtm-analytics.SavvyGTMData.Contact\` c
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l ON l.ConvertedContactId = c.Id
      WHERE LOWER(c.Email) IN (SELECT lc_email FROM candidate_emails)
        AND c.IsDeleted = FALSE AND l.IsDeleted = FALSE
        AND c.Email IS NOT NULL AND c.Email != ''
    ),
    email_uniqueness AS (
      SELECT lc_email, COUNT(DISTINCT lead_id) AS distinct_leads, ANY_VALUE(lead_id) AS only_lead_id
      FROM email_match_universe
      GROUP BY lc_email
    ),
    unique_self_emails AS (
      SELECT eu.lc_email
      FROM email_uniqueness eu
      JOIN lead_row lr ON lr.lead_id = eu.only_lead_id
      WHERE eu.distinct_leads = 1
    )
    SELECT
      (SELECT lead_id FROM resolved_one) AS lead_id,
      (SELECT contact_id FROM lead_row) AS contact_id,
      ARRAY(SELECT task_id FROM matching_tasks) AS matching_task_ids,
      ARRAY(SELECT lc_email FROM unique_self_emails) AS unique_emails,
      (SELECT sga_owner_name FROM resolved_one) AS sga_owner_name,
      (SELECT opp_sga_name FROM resolved_one) AS opp_sga_name,
      (SELECT sgm_owner_name FROM resolved_one) AS sgm_owner_name
  `;

  const rows = await runQuery<RecordContextRow>(sql, { recordId });
  const r = rows[0];
  if (!r) {
    return {
      leadId: null,
      contactId: null,
      matchingKixieTaskIds: [],
      uniqueEmails: [],
      sgaOwnerName: null,
      oppSgaName: null,
      sgmOwnerName: null,
    };
  }
  return {
    leadId: r.lead_id ?? null,
    contactId: r.contact_id ?? null,
    matchingKixieTaskIds: Array.isArray(r.matching_task_ids) ? r.matching_task_ids : [],
    uniqueEmails: Array.isArray(r.unique_emails) ? r.unique_emails : [],
    sgaOwnerName: r.sga_owner_name ?? null,
    oppSgaName: r.opp_sga_name ?? null,
    sgmOwnerName: r.sgm_owner_name ?? null,
  };
}

interface NoteRow {
  id: string;
  call_started_at: Date;
  source: string;
  rep_name: string | null;
  rep_role: string | null;
  manager_name: string | null;
  invitee_emails: string[] | null;
  summary_markdown: string | null;
  ai_original: unknown;
  pushed_to_sfdc: boolean;
  /** Why this row matched. Computed in SQL via CASE — one of the LinkConfidence values. */
  link_confidence: LinkConfidence;
  sfdc_who_id: string | null;
}

const SAVVY_INTERNAL_DOMAINS = ['@savvywealth.com', '@savvyadvisors.com'];
function isSavvyInternal(email: string): boolean {
  const lc = email.toLowerCase();
  return SAVVY_INTERNAL_DOMAINS.some((d) => lc.endsWith(d));
}

/**
 * Fetch all confidently-linked notes for a record. Returns [] when the
 * record has no contextual ids (resolveRecordContext returned blank).
 *
 * Match arms (mirrors the coaching-usage drill-down cascade in reverse):
 *   - direct:    cn.sfdc_who_id IN (leadId, contactId)
 *   - kixie:     cn.sfdc_who_id IS NULL AND cn.kixie_task_id = ANY(@taskIds)
 *   - email:     cn.sfdc_who_id IS NULL AND cn.kixie_task_id IS NULL
 *                AND cn.invitee_emails && @uniqueEmails
 *
 * `link_confidence` is `'pushed'` when sfdc_write_log shows a successful
 * push; otherwise it is the matching arm's name ('direct' covers both
 * direct and kixie matches — they're equivalently authoritative).
 */
export async function fetchNotesForContext(ctx: RecordContext): Promise<NoteRecord[]> {
  const matchingWhoIds = [ctx.leadId, ctx.contactId].filter((s): s is string => !!s);
  if (
    matchingWhoIds.length === 0 &&
    ctx.matchingKixieTaskIds.length === 0 &&
    ctx.uniqueEmails.length === 0
  ) {
    return [];
  }

  const pool = getCoachingPool();
  // Note: invitee_emails is a TEXT[] column. The `&&` overlap operator
  // returns true if any element appears in both arrays.
  const sql = `
    SELECT
      cn.id,
      cn.call_started_at,
      cn.source,
      cn.sfdc_who_id,
      cn.invitee_emails,
      cn.summary_markdown,
      sga.full_name AS rep_name,
      sga.role     AS rep_role,
      sgm.full_name AS manager_name,
      e.ai_original,
      EXISTS (
        SELECT 1 FROM sfdc_write_log swl
        WHERE swl.call_note_id = cn.id AND swl.status = 'success'
      ) AS pushed_to_sfdc,
      CASE
        WHEN cn.sfdc_who_id = ANY($1::text[])         THEN 'direct'
        WHEN cn.sfdc_who_id IS NULL
             AND cn.kixie_task_id = ANY($2::text[])   THEN 'direct'
        ELSE 'email'
      END AS link_confidence
    FROM call_notes cn
    LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
    LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
    LEFT JOIN LATERAL (
      SELECT ai_original
      FROM evaluations ev
      WHERE ev.call_note_id = cn.id
      ORDER BY ev.created_at DESC
      LIMIT 1
    ) e ON TRUE
    WHERE cn.source_deleted_at IS NULL
      AND (
        cn.sfdc_who_id = ANY($1::text[])
        OR (cn.sfdc_who_id IS NULL AND cn.kixie_task_id = ANY($2::text[]))
        OR (cn.sfdc_who_id IS NULL AND cn.kixie_task_id IS NULL
            AND cn.invitee_emails && $3::text[])
      )
    ORDER BY cn.call_started_at DESC NULLS LAST
  `;

  const { rows } = await pool.query<NoteRow>(sql, [
    matchingWhoIds,
    ctx.matchingKixieTaskIds,
    ctx.uniqueEmails,
  ]);

  return rows.map((r) => {
    const { notesMarkdown, coachingMarkdown } = renderCallNoteMarkdown({
      source: r.source,
      summaryMarkdown: r.summary_markdown,
      aiOriginal: r.ai_original,
    });
    const otherSavvyAttendees = (Array.isArray(r.invitee_emails) ? r.invitee_emails : [])
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim())
      .filter((e) => e !== '' && isSavvyInternal(e));
    return {
      id: r.id,
      callDate: r.call_started_at instanceof Date ? r.call_started_at.toISOString() : String(r.call_started_at),
      source: r.source as 'granola' | 'kixie',
      repName: r.rep_name,
      repRole: r.rep_role,
      managerName: r.manager_name,
      otherSavvyAttendees,
      notesMarkdown,
      coachingMarkdown,
      pushedToSfdc: r.pushed_to_sfdc === true,
      linkConfidence: r.pushed_to_sfdc ? 'pushed' : r.link_confidence,
    };
  });
}

/**
 * Look up the requesting user's rep identity (Neon `reps.full_name`),
 * needed for the SGA/SGM ownership RBAC check. Returns null when:
 *   - the user has no row in reps (not a SGA/SGM/manager)
 *   - the user's row is the system rep or inactive
 */
export async function getUserRepIdentity(email: string): Promise<{ fullName: string; role: string | null } | null> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{ full_name: string; role: string | null }>(
    `SELECT full_name, role
     FROM reps
     WHERE LOWER(email) = LOWER($1)
       AND is_system = false
       AND is_active = true
     LIMIT 1`,
    [email],
  );
  const r = rows[0];
  return r ? { fullName: r.full_name, role: r.role } : null;
}
