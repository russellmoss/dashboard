import { getCoachingPool } from '@/lib/coachingDb';
import type { NeedsLinkingRow } from '@/types/call-intelligence';

interface NeedsLinkingQueryRow {
  call_note_id: string;
  call_started_at: Date;
  source: string;
  linkage_strategy: string;
  advisor_hint: string | null;
  rep_name: string;
  manager_name: string | null;
  top_confidence_tier: string | null;
  days_since_call: number;
}

export async function getNeedsLinkingRows(
  repIds: string[],
  showAll: boolean
): Promise<NeedsLinkingRow[]> {
  if (repIds.length === 0) return [];

  const pool = getCoachingPool();

  const { rows } = await pool.query<NeedsLinkingQueryRow>(
    `SELECT
      cn.id AS call_note_id,
      cn.call_started_at,
      cn.source,
      cn.linkage_strategy,
      COALESCE(
        (SELECT a->>'name'
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(cn.attendees) = 'array' THEN cn.attendees ELSE '[]'::jsonb END
           ) AS a
          WHERE NULLIF(TRIM(a->>'name'), '') IS NOT NULL
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE '%@savvywealth.com'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE '%@savvyadvisors.com'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE '%resource.calendar.google.com'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE 'noreply@%'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE 'reply@%'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE 'invites@%'
          LIMIT 1),
        (SELECT eml FROM unnest(cn.invitee_emails) AS eml
          WHERE LOWER(eml) NOT LIKE '%@savvywealth.com'
            AND LOWER(eml) NOT LIKE '%@savvyadvisors.com'
            AND LOWER(eml) NOT LIKE '%resource.calendar.google.com'
            AND LOWER(eml) NOT LIKE 'noreply@%'
            AND LOWER(eml) NOT LIKE 'reply@%'
          LIMIT 1),
        cn.title
      ) AS advisor_hint,
      sga.full_name AS rep_name,
      sgm.full_name AS manager_name,
      lat_srm.top_confidence_tier,
      FLOOR(EXTRACT(EPOCH FROM (now() - cn.call_started_at)) / 86400)::int AS days_since_call
    FROM call_notes cn
    LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
    LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
    LEFT JOIN LATERAL (
      SELECT srm.sfdc_suggestion->'candidates'->0->>'confidence_tier' AS top_confidence_tier
      FROM slack_review_messages srm
      WHERE srm.call_note_id = cn.id AND srm.surface = 'dm'
      ORDER BY srm.created_at DESC
      LIMIT 1
    ) lat_srm ON true
    WHERE cn.source_deleted_at IS NULL
      AND cn.status = 'pending'
      AND cn.source != 'kixie'
      AND cn.likely_call_type = 'advisor_call'
      AND cn.rep_id = ANY($1::uuid[])
      AND ($2::boolean OR cn.call_started_at >= date_trunc('day', now()) - interval '14 days')
    ORDER BY cn.call_started_at DESC NULLS LAST`,
    [repIds, showAll]
  );

  return rows.map((r) => ({
    callNoteId: r.call_note_id,
    callDate: r.call_started_at instanceof Date ? r.call_started_at.toISOString() : String(r.call_started_at),
    source: r.source,
    advisorHint: r.advisor_hint ?? r.source,
    repName: r.rep_name,
    managerName: r.manager_name,
    linkageStrategy: r.linkage_strategy,
    confidenceTier: r.top_confidence_tier,
    daysSinceCall: r.days_since_call,
  }));
}
