import { getCoachingPool } from '@/lib/coachingDb';
import type { OpportunityTimelineRow, LinkageStatus } from '@/types/call-intelligence-opportunities';

interface TimelineRaw {
  id: string;
  call_started_at: Date | string;
  title: string | null;
  summary_markdown: string | null;
  summary_markdown_edited: string | null;
  source: string;
  rep_id: string;
  rep_name: string | null;
  manager_name: string | null;
  sfdc_what_id: string | null;
  sfdc_who_id: string | null;
  sfdc_record_type: string | null;
  sfdc_record_id: string | null;
  linkage_status: string;
  sfdc_suggestion: unknown | null;
}

export async function getThreadedTimeline(
  oppId: string,
  leadId: string | null,
  contactId: string | null,
  repIds: string[],
): Promise<OpportunityTimelineRow[]> {
  if (!oppId || repIds.length === 0) return [];

  const pool = getCoachingPool();

  const { rows } = await pool.query<TimelineRaw>(
    `WITH linked_calls AS (
      SELECT cn.id, cn.call_started_at, cn.title,
             cn.summary_markdown, cn.summary_markdown_edited,
             cn.source, cn.rep_id,
             cn.sfdc_what_id, cn.sfdc_who_id, cn.sfdc_record_type, cn.sfdc_record_id,
             'linked' AS linkage_status,
             NULL::jsonb AS sfdc_suggestion
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        AND cn.rep_id = ANY($4::uuid[])
        AND (
          cn.sfdc_what_id = $1
          OR (cn.sfdc_record_id = $2 AND $2 IS NOT NULL
              AND (cn.sfdc_what_id IS NULL OR cn.sfdc_what_id = $1))
          OR (cn.sfdc_record_id = $3 AND $3 IS NOT NULL
              AND (cn.sfdc_what_id IS NULL OR cn.sfdc_what_id = $1))
          OR (cn.sfdc_who_id = $2 AND cn.sfdc_what_id IS NULL AND $2 IS NOT NULL)
          OR (cn.sfdc_who_id = $3 AND cn.sfdc_what_id IS NULL AND $3 IS NOT NULL)
        )
    ),
    likely_unlinked AS (
      SELECT DISTINCT ON (cn.id)
             cn.id, cn.call_started_at, cn.title,
             cn.summary_markdown, cn.summary_markdown_edited,
             cn.source, cn.rep_id,
             cn.sfdc_what_id, cn.sfdc_who_id, cn.sfdc_record_type, cn.sfdc_record_id,
             'likely_match' AS linkage_status,
             srm.sfdc_suggestion
      FROM call_notes cn
      JOIN slack_review_messages srm ON srm.call_note_id = cn.id AND srm.surface = 'dm'
      CROSS JOIN LATERAL jsonb_array_elements(srm.sfdc_suggestion->'candidates') AS cand
      WHERE cn.source_deleted_at IS NULL
        AND cn.rep_id = ANY($4::uuid[])
        AND cn.sfdc_what_id IS NULL
        AND cn.sfdc_record_id IS NULL
        AND srm.sfdc_suggestion IS NOT NULL
        AND jsonb_typeof(srm.sfdc_suggestion->'candidates') = 'array'
        AND (cand->>'confidence_tier') = 'likely'
        AND (
          ((cand->>'what_id') = $1 AND (cand->>'what_record_type') = 'Opportunity')
          OR ((cand->>'who_id') = $2 AND (cand->>'primary_record_type') = 'Lead' AND $2 IS NOT NULL)
          OR ((cand->>'who_id') = $3 AND (cand->>'primary_record_type') = 'Contact' AND $3 IS NOT NULL)
        )
        AND cn.id NOT IN (SELECT id FROM linked_calls)
      ORDER BY cn.id, cn.call_started_at
    )
    SELECT lc.id, lc.call_started_at, lc.title,
           lc.summary_markdown, lc.summary_markdown_edited,
           lc.source, lc.rep_id,
           sga.full_name AS rep_name,
           sgm.full_name AS manager_name,
           lc.sfdc_what_id, lc.sfdc_who_id, lc.sfdc_record_type, lc.sfdc_record_id,
           lc.linkage_status, lc.sfdc_suggestion
    FROM (
      SELECT * FROM linked_calls
      UNION ALL
      SELECT * FROM likely_unlinked
    ) lc
    LEFT JOIN reps sga ON sga.id = lc.rep_id AND sga.is_system = false
    LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
    ORDER BY lc.call_started_at DESC`,
    [oppId, leadId, contactId, repIds],
  );

  return rows.map((r) => {
    let linkageStatus: LinkageStatus;
    if (r.linkage_status === 'likely_match') {
      linkageStatus = 'likely_match';
    } else if (r.sfdc_what_id === oppId) {
      linkageStatus = 'linked_opp';
    } else if (r.sfdc_record_id === contactId || r.sfdc_who_id === contactId) {
      linkageStatus = 'linked_contact';
    } else if (r.sfdc_record_id === leadId || r.sfdc_who_id === leadId) {
      linkageStatus = 'linked_lead';
    } else {
      linkageStatus = 'linked_opp';
    }

    const summary = (r.summary_markdown_edited || r.summary_markdown || '');
    const preview = summary.length > 120 ? summary.slice(0, 120) + '…' : summary || null;

    return {
      callNoteId: r.id,
      callDate: r.call_started_at instanceof Date
        ? r.call_started_at.toISOString()
        : String(r.call_started_at),
      title: r.title ?? 'Untitled Call',
      summaryPreview: preview,
      source: (r.source === 'kixie' ? 'kixie' : 'granola') as 'granola' | 'kixie',
      repId: r.rep_id,
      repName: r.rep_name ?? null,
      managerName: r.manager_name ?? null,
      linkageStatus,
      sfdcRecordType: r.sfdc_record_type ?? null,
      sfdcSuggestion: r.sfdc_suggestion ?? null,
      stageAtTimeOfCall: null,
    };
  });
}
