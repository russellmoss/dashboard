import { getCoachingPool } from '@/lib/coachingDb';

export interface ThreadedCallCounts {
  total: number;
  likelyUnlinked: number;
  lastCallDate: string | null;
  granolaCount: number;
  kixieCount: number;
}

interface CountsRaw {
  opp_id: string;
  total_count: string;
  likely_unlinked_count: string;
  last_call: Date | string | null;
  granola_count: string;
  kixie_count: string;
}

export async function getThreadedCallCounts(
  identityTuples: Array<{ oppId: string; leadId: string | null; contactId: string | null }>,
  repIds: string[],
): Promise<Map<string, ThreadedCallCounts>> {
  const result = new Map<string, ThreadedCallCounts>();
  if (identityTuples.length === 0 || repIds.length === 0) return result;

  const oppIds = identityTuples.map((t) => t.oppId);
  const leadIds = identityTuples.map((t) => t.leadId ?? '');
  const contactIds = identityTuples.map((t) => t.contactId ?? '');

  const pool = getCoachingPool();

  const { rows } = await pool.query<CountsRaw>(
    `WITH identity_map AS (
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
        AS t(opp_id, lead_id, contact_id)
    ),
    linked_counts AS (
      SELECT im.opp_id,
        count(DISTINCT cn.id) AS linked_count,
        max(cn.call_started_at) AS last_call,
        count(DISTINCT cn.id) FILTER (WHERE cn.source = 'granola') AS granola_count,
        count(DISTINCT cn.id) FILTER (WHERE cn.source = 'kixie') AS kixie_count
      FROM identity_map im
      JOIN call_notes cn ON cn.source_deleted_at IS NULL
        AND cn.rep_id = ANY($4::uuid[])
        AND (
          cn.sfdc_what_id = im.opp_id
          OR (cn.sfdc_record_id = im.lead_id AND im.lead_id != ''
              AND (cn.sfdc_what_id IS NULL OR cn.sfdc_what_id = im.opp_id))
          OR (cn.sfdc_record_id = im.contact_id AND im.contact_id != ''
              AND (cn.sfdc_what_id IS NULL OR cn.sfdc_what_id = im.opp_id))
          OR (cn.sfdc_who_id = im.lead_id AND cn.sfdc_what_id IS NULL AND im.lead_id != '')
          OR (cn.sfdc_who_id = im.contact_id AND cn.sfdc_what_id IS NULL AND im.contact_id != '')
        )
      GROUP BY im.opp_id
    ),
    likely_counts AS (
      SELECT im.opp_id, count(DISTINCT cn.id) AS likely_count
      FROM identity_map im
      JOIN call_notes cn ON cn.source_deleted_at IS NULL
        AND cn.rep_id = ANY($4::uuid[])
        AND cn.sfdc_what_id IS NULL AND cn.sfdc_record_id IS NULL
      JOIN slack_review_messages srm ON srm.call_note_id = cn.id AND srm.surface = 'dm'
      CROSS JOIN LATERAL jsonb_array_elements(srm.sfdc_suggestion->'candidates') AS cand
      WHERE srm.sfdc_suggestion IS NOT NULL
        AND jsonb_typeof(srm.sfdc_suggestion->'candidates') = 'array'
        AND (cand->>'confidence_tier') = 'likely'
        AND (
          ((cand->>'what_id') = im.opp_id AND (cand->>'what_record_type') = 'Opportunity')
          OR ((cand->>'who_id') = im.lead_id AND (cand->>'primary_record_type') = 'Lead' AND im.lead_id != '')
          OR ((cand->>'who_id') = im.contact_id AND (cand->>'primary_record_type') = 'Contact' AND im.contact_id != '')
        )
      GROUP BY im.opp_id
    )
    SELECT
      COALESCE(l.opp_id, u.opp_id) AS opp_id,
      COALESCE(l.linked_count, 0) + COALESCE(u.likely_count, 0) AS total_count,
      COALESCE(u.likely_count, 0) AS likely_unlinked_count,
      l.last_call,
      COALESCE(l.granola_count, 0) AS granola_count,
      COALESCE(l.kixie_count, 0) AS kixie_count
    FROM linked_counts l
    FULL OUTER JOIN likely_counts u ON l.opp_id = u.opp_id`,
    [oppIds, leadIds, contactIds, repIds],
  );

  for (const r of rows) {
    if (!r.opp_id) continue;
    result.set(r.opp_id, {
      total: parseInt(String(r.total_count), 10) || 0,
      likelyUnlinked: parseInt(String(r.likely_unlinked_count), 10) || 0,
      lastCallDate: r.last_call instanceof Date
        ? r.last_call.toISOString()
        : r.last_call ? String(r.last_call) : null,
      granolaCount: parseInt(String(r.granola_count), 10) || 0,
      kixieCount: parseInt(String(r.kixie_count), 10) || 0,
    });
  }

  return result;
}
