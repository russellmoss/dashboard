import { getCoachingPool } from '@/lib/coachingDb';
import type { InsightsDateRange } from '@/types/call-intelligence';

export interface InsightsEvalsListArgs {
  dateRange: InsightsDateRange;
  role: string | null;            // 'SGA' | 'SGM' | null = both
  rubricVersion: number | null;
  podId: string | null;           // null = no pod filter
  dimension: string | null;       // null = any dimension
  focusedRepId: string | null;    // null = no rep filter (use visibleRepIds)
  visibleRepIds: string[];        // authority gate
}

export interface InsightsEvalListRow {
  evaluation_id: string;
  rep_id: string;
  rep_full_name: string | null;
  call_started_at: string | null;
  call_title: string | null;
  dimension_name: string | null;
  dimension_score: number | null;
}

function dateBounds(range: InsightsDateRange): { start: string; end: string } {
  if (range.kind === 'custom') return { start: range.start, end: range.end };
  const days = range.kind === '7d' ? 7 : range.kind === '30d' ? 30 : 90;
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function getInsightsEvalsList(args: InsightsEvalsListArgs): Promise<InsightsEvalListRow[]> {
  const { dateRange, role, rubricVersion, podId, dimension, focusedRepId, visibleRepIds } = args;
  if (visibleRepIds.length === 0) return [];

  const effectiveRepIds = focusedRepId
    ? (visibleRepIds.includes(focusedRepId) ? [focusedRepId] : [])
    : visibleRepIds;
  if (effectiveRepIds.length === 0) return [];

  const { start, end } = dateBounds(dateRange);
  const pool = getCoachingPool();

  // params:
  //  $1 reps (uuid[])
  //  $2 start, $3 end
  //  $4 role ('SGA'|'SGM'|null)
  //  $5 rubric_version (int|null)
  //  $6 pod_id (uuid|null)
  //  $7 dimension key (text|null)
  const params: unknown[] = [
    effectiveRepIds, start, end, role, rubricVersion, podId, dimension,
  ];

  // When $7 (dimension) is set: filter to evals that have that dimension and
  // surface its score. When $7 is null: one row per eval, no dimension column.
  const sql = `
    SELECT DISTINCT
      e.id AS evaluation_id,
      e.rep_id,
      r.full_name AS rep_full_name,
      cn.call_started_at,
      COALESCE(cn.title, cn.calendar_title) AS call_title,
      $7::text AS dimension_name,
      CASE
        WHEN $7::text IS NULL THEN NULL
        ELSE (e.dimension_scores -> $7::text ->> 'score')::numeric
      END AS dimension_score
    FROM evaluations e
    JOIN reps r ON r.id = e.rep_id AND r.is_system = false AND r.is_active = true
    JOIN call_notes cn ON cn.id = e.call_note_id
    LEFT JOIN coaching_team_members tm ON tm.rep_id = e.rep_id
    LEFT JOIN coaching_teams t ON t.id = tm.team_id AND t.is_active = true
    WHERE (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
      AND e.rep_id = ANY($1::uuid[])
      AND e.created_at >= $2::date
      AND e.created_at <  $3::date
      AND e.dimension_scores <> '{}'::jsonb
      AND ($4::text IS NULL OR e.role = $4)
      AND ($5::int  IS NULL OR e.rubric_version = $5)
      AND ($6::uuid IS NULL OR t.id = $6)
      AND ($7::text IS NULL OR e.dimension_scores ? $7::text)
    ORDER BY cn.call_started_at DESC NULLS LAST, e.id DESC
    LIMIT 500
  `;

  const { rows } = await pool.query<{
    evaluation_id: string;
    rep_id: string;
    rep_full_name: string | null;
    call_started_at: string | null;
    call_title: string | null;
    dimension_name: string | null;
    dimension_score: string | null;
  }>(sql, params);

  return rows.map(r => ({
    evaluation_id: r.evaluation_id,
    rep_id: r.rep_id,
    rep_full_name: r.rep_full_name,
    call_started_at: r.call_started_at,
    call_title: r.call_title,
    dimension_name: r.dimension_name,
    dimension_score: r.dimension_score === null ? null : Number(r.dimension_score),
  }));
}
