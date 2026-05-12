import { getCoachingPool } from '@/lib/coachingDb';
import type {
  KnowledgeGapClusterRow,
  InsightsDateRange,
  InsightsRoleFilter,
  InsightsSourceFilter,
} from '@/types/call-intelligence';

interface ClusterArgs {
  dateRange: InsightsDateRange;
  role: InsightsRoleFilter;
  podIds: string[];
  repIds: string[];
  sourceFilter: InsightsSourceFilter;
  visibleRepIds: string[];
  mode?: 'team' | 'rep_focus';
}

function dateBoundsParam(range: InsightsDateRange): { start: string; end: string } {
  if (range.kind === 'custom') return { start: range.start, end: range.end };
  const days = range.kind === '7d' ? 7 : range.kind === '30d' ? 30 : 90;
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function getKnowledgeGapClusters(args: ClusterArgs): Promise<KnowledgeGapClusterRow[]> {
  const { dateRange, role, podIds, repIds, sourceFilter, visibleRepIds, mode = 'team' } = args;

  if (visibleRepIds.length === 0) return [];

  const effectiveRepIds = repIds.length > 0
    ? repIds.filter(id => visibleRepIds.includes(id))
    : visibleRepIds;

  if (effectiveRepIds.length === 0) return [];

  const { start, end } = dateBoundsParam(dateRange);
  const pool = getCoachingPool();

  const includeGaps = sourceFilter === 'all' || sourceFilter === 'gaps_only';
  const includeDeferrals = sourceFilter !== 'gaps_only';
  const coverageFilter: 'missing' | 'covered' | null =
    sourceFilter === 'deferrals_kb_missing' ? 'missing'
    : sourceFilter === 'deferrals_kb_covered' ? 'covered'
    : null;

  const roleParam = role === 'both' ? null : role;
  const podIdsParam = podIds.length > 0 ? podIds : null;

  const sliceCap = mode === 'rep_focus' ? 200 : 5;

  const params: unknown[] = [
    effectiveRepIds, start, end, roleParam, podIdsParam,
    includeGaps, includeDeferrals, coverageFilter,
  ];

  const sql = `
    WITH scoped_reps AS (
      SELECT DISTINCT r.id
        FROM reps r
        LEFT JOIN coaching_team_members tm ON tm.rep_id = r.id
        LEFT JOIN coaching_teams t          ON t.id = tm.team_id AND t.is_active = true
       WHERE r.is_active = true
         AND r.is_system = false
         AND r.id = ANY($1::uuid[])
         AND ($4::text IS NULL OR r.role = $4)
         AND ($5::uuid[] IS NULL OR t.id = ANY($5::uuid[]) OR t.id IS NULL)
    ),
    gap_hits AS (
      SELECT
        CASE
          WHEN kg.item->>'expected_source' IS NULL
            OR kg.item->>'expected_source' = ''
            OR position('/' IN kg.item->>'expected_source') = 0
            THEN 'Uncategorized'
          ELSE
            split_part(kg.item->>'expected_source','/',1) || '/' ||
            split_part(kg.item->>'expected_source','/',2)
        END AS bucket,
        CASE
          WHEN kg.item->>'expected_source' IS NULL
            OR kg.item->>'expected_source' = ''
            OR position('/' IN kg.item->>'expected_source') = 0
            THEN 'uncategorized'
          ELSE 'kb_path'
        END AS bucket_kind,
        e.rep_id,
        r.full_name AS rep_name,
        e.id AS evaluation_id,
        cn.call_started_at AS call_started_at,
        kg.item->>'text'             AS evidence_text,
        kg.item->'citations'         AS citations,
        kg.item->>'expected_source'  AS expected_source_full,
        'gap'::text AS kind,
        1 AS gap_count,
        0 AS deferral_count,
        NULL::text AS kb_coverage
      FROM evaluations e
      JOIN scoped_reps sr ON sr.id = e.rep_id
      JOIN reps r ON r.id = e.rep_id
      JOIN call_notes cn ON cn.id = e.call_note_id
      CROSS JOIN jsonb_array_elements(e.knowledge_gaps) AS kg(item)
      WHERE $6::bool = true
        AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
        AND e.created_at >= $2::date
        AND e.created_at <  $3::date
    ),
    deferral_hits AS (
      -- Single-bucket-per-deferral assignment via ORDER BY chunk_index, id LIMIT 1.
      -- Deterministic; no count inflation. Alternative (fan-out across topics) would
      -- inflate totals and break acceptance criterion (a).
      SELECT
        COALESCE(
          (SELECT t FROM unnest(kbc.topics) AS t LIMIT 1),
          'Uncategorized: ' || d.topic
        ) AS bucket,
        CASE
          WHEN kbc.topics IS NULL OR array_length(kbc.topics, 1) IS NULL
            THEN 'uncategorized'
          ELSE 'kb_topic'
        END AS bucket_kind,
        d.rep_id,
        r.full_name AS rep_name,
        d.evaluation_id,
        cn.call_started_at AS call_started_at,
        d.deferral_text AS evidence_text,
        jsonb_build_array(
          jsonb_build_object('utterance_index', d.utterance_index)
        ) AS citations,
        NULL::text AS expected_source_full,
        'deferral'::text AS kind,
        0 AS gap_count,
        1 AS deferral_count,
        d.kb_coverage
      FROM rep_deferrals d
      JOIN scoped_reps sr ON sr.id = d.rep_id
      JOIN reps r ON r.id = d.rep_id
      JOIN evaluations e ON e.id = d.evaluation_id
      JOIN call_notes cn ON cn.id = e.call_note_id
      LEFT JOIN LATERAL (
        SELECT topics FROM knowledge_base_chunks
         WHERE id = ANY(d.kb_chunk_ids)
           AND is_active = true
           AND topics IS NOT NULL
           AND array_length(topics, 1) > 0
         ORDER BY chunk_index, id
         LIMIT 1
      ) kbc ON TRUE
      WHERE $7::bool = true
        AND d.is_synthetic_test_data = false
        AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
        AND d.created_at >= $2::date
        AND d.created_at <  $3::date
        AND ($8::text IS NULL OR d.kb_coverage = $8)
    ),
    all_hits AS (
      SELECT * FROM gap_hits
      UNION ALL
      SELECT * FROM deferral_hits
    ),
    -- ROW_NUMBER() ranks rows within each bucket, then a single FILTER-gated
    -- jsonb_agg produces the capped evidence sample. Slice cap literal is
    -- constrained at the TS layer to 5 | 200 (no injection surface).
    ranked AS (
      SELECT
        ah.*,
        ROW_NUMBER() OVER (
          PARTITION BY bucket
          ORDER BY call_started_at DESC NULLS LAST, evaluation_id, kind
        ) AS rn
      FROM all_hits ah
    )
    SELECT
      bucket,
      (array_agg(bucket_kind ORDER BY
        CASE bucket_kind
          WHEN 'kb_path' THEN 1
          WHEN 'kb_topic' THEN 2
          ELSE 3
        END
      ))[1] AS bucket_kind,
      SUM(gap_count + deferral_count) AS total_occurrences,
      SUM(gap_count) AS gap_count,
      SUM(deferral_count) AS deferral_count,
      COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'covered'), 0) AS deferral_covered,
      COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'partial'), 0) AS deferral_partial,
      COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'missing'), 0) AS deferral_missing,
      json_agg(DISTINCT jsonb_build_object('repId', rep_id, 'repName', rep_name)
               ORDER BY jsonb_build_object('repId', rep_id, 'repName', rep_name)) AS reps_arr,
      (array_agg(DISTINCT evaluation_id ORDER BY evaluation_id) FILTER (WHERE rn <= ${sliceCap})) AS sample_eval_ids,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'evaluationId',   evaluation_id,
            'repId',          rep_id,
            'repName',        rep_name,
            'kind',           kind,
            'text',           evidence_text,
            'callStartedAt',  call_started_at,
            'citations',      citations,
            'expectedSource', expected_source_full,
            'kbCoverage',     kb_coverage
          ) ORDER BY rn
        ) FILTER (WHERE rn <= ${sliceCap}),
        '[]'::jsonb
      ) AS sample_evidence,
      json_object_agg(rep_id || '|gap', gap_count ORDER BY rep_id || '|gap') FILTER (WHERE gap_count > 0) AS rep_gap_map,
      json_object_agg(rep_id || '|def', deferral_count ORDER BY rep_id || '|def') FILTER (WHERE deferral_count > 0) AS rep_def_map
    FROM ranked
    GROUP BY bucket
    HAVING SUM(gap_count + deferral_count) > 0
    ORDER BY total_occurrences DESC, bucket ASC
  `;

  type RawRow = {
    bucket: string;
    bucket_kind: 'kb_path' | 'kb_topic' | 'uncategorized';
    total_occurrences: string;
    gap_count: string;
    deferral_count: string;
    deferral_covered: string;
    deferral_partial: string;
    deferral_missing: string;
    reps_arr: Array<{ repId: string; repName: string | null }> | null;
    sample_eval_ids: string[] | null;
    sample_evidence: Array<{
      evaluationId: string;
      repId: string;
      repName: string | null;
      kind: 'gap' | 'deferral';
      text: string | null;
      callStartedAt: string | null;
      citations: Array<{
        utterance_index?: number | null;
        kb_source?: { doc_id?: string; chunk_id?: string; doc_title?: string; drive_url?: string };
      }> | null;
      expectedSource: string | null;
      kbCoverage: 'covered' | 'partial' | 'missing' | null;
    }> | null;
    rep_gap_map: Record<string, number> | null;
    rep_def_map: Record<string, number> | null;
  };

  const { rows } = await pool.query<RawRow>(sql, params);

  return rows.map(r => {
    const reps = r.reps_arr ?? [];
    const breakdown = reps.map(rep => ({
      repId: rep.repId,
      repName: rep.repName ?? '(unknown)',
      gapCount: Number(r.rep_gap_map?.[`${rep.repId}|gap`] ?? 0),
      deferralCount: Number(r.rep_def_map?.[`${rep.repId}|def`] ?? 0),
    }));
    const sampleEvidence = (r.sample_evidence ?? []).map(e => {
      const cit = Array.isArray(e.citations) ? e.citations : [];
      return {
        evaluationId: e.evaluationId,
        repId: e.repId,
        repName: e.repName ?? '(unknown)',
        kind: e.kind,
        text: e.text ?? '',
        callStartedAt: e.callStartedAt,
        citations: cit
          .map(c => {
            const hasUtterance = typeof c.utterance_index === 'number';
            const hasKbSource = !!(c.kb_source && c.kb_source.chunk_id && c.kb_source.doc_id);
            if (!hasUtterance && !hasKbSource) return null;
            return {
              ...(hasUtterance ? { utterance_index: c.utterance_index as number } : {}),
              ...(hasKbSource
                ? {
                    kb_source: {
                      doc_id: c.kb_source!.doc_id!,
                      chunk_id: c.kb_source!.chunk_id!,
                      doc_title: c.kb_source!.doc_title ?? '',
                      drive_url: c.kb_source!.drive_url ?? '',
                    },
                  }
                : {}),
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null),
        ...(e.expectedSource ? { expectedSource: e.expectedSource } : {}),
        ...(e.kbCoverage ? { kbCoverage: e.kbCoverage } : {}),
      };
    });
    return {
      bucket: r.bucket,
      bucketKind: r.bucket_kind,
      totalOccurrences: Number(r.total_occurrences),
      gapCount: Number(r.gap_count),
      deferralCount: Number(r.deferral_count),
      deferralByCoverage: {
        covered: Number(r.deferral_covered),
        partial: Number(r.deferral_partial),
        missing: Number(r.deferral_missing),
      },
      repBreakdown: breakdown,
      sampleEvalIds: r.sample_eval_ids ?? [],
      sampleEvidence,
    };
  });
}
