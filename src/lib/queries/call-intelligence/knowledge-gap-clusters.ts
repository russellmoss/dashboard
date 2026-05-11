import { getCoachingPool } from '@/lib/coachingDb';
import { KB_VOCAB_SYNONYMS } from './kb-vocab-synonyms';
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
}

function dateBoundsParam(range: InsightsDateRange): { start: string; end: string } {
  if (range.kind === 'custom') return { start: range.start, end: range.end };
  const days = range.kind === '7d' ? 7 : range.kind === '30d' ? 30 : 90;
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function getKnowledgeGapClusters(args: ClusterArgs): Promise<KnowledgeGapClusterRow[]> {
  const { dateRange, role, podIds, repIds, sourceFilter, visibleRepIds } = args;

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

  // params (ALL parameterized — no SQL injection surface):
  //  $1 = effectiveRepIds (uuid[])
  //  $2 = start (date), $3 = end (date)
  //  $4 = role ('SGA'|'SGM'|null)
  //  $5 = podIds (uuid[]|null)
  //  $6 = includeGaps (bool)
  //  $7 = includeDeferrals (bool)
  //  $8 = coverageFilter ('missing'|'covered'|null)
  //  $9 = synonyms map (jsonb)
  const synonymsJson = JSON.stringify(KB_VOCAB_SYNONYMS);
  const params: unknown[] = [
    effectiveRepIds, start, end, roleParam, podIdsParam,
    includeGaps, includeDeferrals, coverageFilter,
    synonymsJson,
  ];

  const sql = `
    WITH topics AS (
      SELECT
        v.value AS topic,
        COALESCE(
          NULLIF(ARRAY(SELECT jsonb_array_elements_text($9::jsonb -> v.value)), ARRAY[]::text[]),
          ARRAY[LOWER(REPLACE(v.value, '_', ' '))]
        ) AS synonyms
        FROM kb_vocab_topics v
       WHERE v.deprecated = false
    ),
    scoped_reps AS (
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
        topics.topic,
        e.rep_id,
        r.full_name AS rep_name,
        e.id AS evaluation_id,
        1 AS gap_count,
        0 AS deferral_count,
        NULL::text AS kb_coverage
      FROM evaluations e
      JOIN scoped_reps sr ON sr.id = e.rep_id
      JOIN reps r ON r.id = e.rep_id
      JOIN call_notes cn ON cn.id = e.call_note_id
      CROSS JOIN jsonb_array_elements(e.knowledge_gaps) AS kg(item)
      CROSS JOIN topics
      WHERE $6::bool = true
        AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
        AND e.created_at >= $2::date
        AND e.created_at <  $3::date
        AND EXISTS (
          SELECT 1 FROM unnest(topics.synonyms) AS syn
           WHERE LOWER(kg.item->>'text') LIKE ('%' || syn || '%')
        )
    ),
    deferral_hits AS (
      SELECT
        topics.topic,
        d.rep_id,
        r.full_name AS rep_name,
        d.evaluation_id,
        0 AS gap_count,
        1 AS deferral_count,
        d.kb_coverage
      FROM rep_deferrals d
      JOIN scoped_reps sr ON sr.id = d.rep_id
      JOIN reps r ON r.id = d.rep_id
      JOIN evaluations e ON e.id = d.evaluation_id
      JOIN call_notes cn ON cn.id = e.call_note_id
      CROSS JOIN topics
      WHERE $7::bool = true
        AND d.is_synthetic_test_data = false
        AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
        AND d.created_at >= $2::date
        AND d.created_at <  $3::date
        AND EXISTS (
          SELECT 1 FROM unnest(topics.synonyms) AS syn
           WHERE LOWER(d.topic) LIKE ('%' || syn || '%')
        )
        AND ($8::text IS NULL OR d.kb_coverage = $8)
    ),
    all_hits AS (
      SELECT * FROM gap_hits
      UNION ALL
      SELECT * FROM deferral_hits
    )
    SELECT
      topic,
      SUM(gap_count + deferral_count) AS total_occurrences,
      SUM(gap_count) AS gap_count,
      SUM(deferral_count) AS deferral_count,
      COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'covered'), 0) AS deferral_covered,
      COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'partial'), 0) AS deferral_partial,
      COALESCE(SUM(deferral_count) FILTER (WHERE kb_coverage = 'missing'), 0) AS deferral_missing,
      json_agg(DISTINCT jsonb_build_object('repId', rep_id, 'repName', rep_name)
               ORDER BY jsonb_build_object('repId', rep_id, 'repName', rep_name)) AS reps_arr,
      (array_agg(DISTINCT evaluation_id ORDER BY evaluation_id))[1:5] AS sample_eval_ids,
      json_object_agg(rep_id || '|gap', gap_count ORDER BY rep_id || '|gap') FILTER (WHERE gap_count > 0) AS rep_gap_map,
      json_object_agg(rep_id || '|def', deferral_count ORDER BY rep_id || '|def') FILTER (WHERE deferral_count > 0) AS rep_def_map
    FROM all_hits
    GROUP BY topic
    HAVING SUM(gap_count + deferral_count) > 0
    ORDER BY total_occurrences DESC, topic ASC
  `;

  type RawRow = {
    topic: string;
    total_occurrences: string;
    gap_count: string;
    deferral_count: string;
    deferral_covered: string;
    deferral_partial: string;
    deferral_missing: string;
    reps_arr: Array<{ repId: string; repName: string | null }> | null;
    sample_eval_ids: string[] | null;
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
    return {
      topic: r.topic,
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
    };
  });
}
