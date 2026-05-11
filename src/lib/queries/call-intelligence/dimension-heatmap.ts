import { getCoachingPool } from '@/lib/coachingDb';
import type {
  DimensionHeatmapResult,
  DimensionHeatmapRowBlock,
  InsightsDateRange,
  InsightsRoleFilter,
  InsightsTrendMode,
  RepFocusTrendComparison,
} from '@/types/call-intelligence';

interface HeatmapArgs {
  dateRange: InsightsDateRange;
  role: InsightsRoleFilter;
  podIds: string[];
  repIds: string[];           // explicit rep filter; pass visibleRepIds when no filter
  rubricVersion: number | null;
  visibleRepIds: string[];    // authority gate
  /** Period-over-period window for the rep-focus trend section. Default '30d'. */
  trendMode?: InsightsTrendMode;
}

function dateBoundsParam(range: InsightsDateRange): { start: string; end: string } {
  if (range.kind === 'custom') return { start: range.start, end: range.end };
  const days = range.kind === '7d' ? 7 : range.kind === '30d' ? 30 : 90;
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Bounds for the rep-focus period-over-period trend.
 *  trendMode '30d' → current=[today-30, today+1), prior=[today-60, today-30).
 *  trendMode '90d' → current=[today-90, today+1), prior=[today-180, today-90). */
function trendBoundsParam(trendMode: InsightsTrendMode): {
  currentStart: string; currentEnd: string; priorStart: string; priorEnd: string;
} {
  const days = trendMode === '30d' ? 30 : 90;
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  const offset = (d: number) => {
    const x = new Date(end); x.setUTCDate(x.getUTCDate() - d);
    return x.toISOString().slice(0, 10);
  };
  return {
    currentEnd:   end.toISOString().slice(0, 10),
    currentStart: offset(days),
    priorEnd:     offset(days),
    priorStart:   offset(days * 2),
  };
}

export async function getDimensionHeatmap(args: HeatmapArgs): Promise<DimensionHeatmapResult> {
  const { dateRange, role, podIds, repIds, rubricVersion, visibleRepIds, trendMode = '30d' } = args;

  if (visibleRepIds.length === 0) {
    return { rowBlocks: [], sparklines: null };
  }

  const effectiveRepIds = repIds.length > 0
    ? repIds.filter(id => visibleRepIds.includes(id))
    : visibleRepIds;

  if (effectiveRepIds.length === 0) {
    return { rowBlocks: [], sparklines: null };
  }

  const { start, end } = dateBoundsParam(dateRange);
  const pool = getCoachingPool();

  // params:
  //  $1 = effectiveRepIds (uuid[])
  //  $2 = start (date string)
  //  $3 = end (date string)
  //  $4 = role filter ('SGA' | 'SGM' | NULL when 'both')
  //  $5 = rubricVersion (int | NULL)
  //  $6 = podIds (uuid[] | NULL)
  const roleParam = role === 'both' ? null : role;
  const podIdsParam = podIds.length > 0 ? podIds : null;
  const params: unknown[] = [effectiveRepIds, start, end, roleParam, rubricVersion, podIdsParam];

  // Eligibility: advisor calls only (Kixie all + Granola advisor_call), regardless
  // of reveal status — manager-edited values already live in dimension_scores.
  const gridSql = `
    WITH scoped_evals AS (
      SELECT e.id, e.rep_id, e.role, e.rubric_version, e.dimension_scores, e.created_at
        FROM evaluations e
        JOIN reps r ON r.id = e.rep_id AND r.is_system = false AND r.is_active = true
        JOIN call_notes cn ON cn.id = e.call_note_id
       WHERE (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
         AND e.rep_id = ANY($1::uuid[])
         AND e.created_at >= $2::date
         AND e.created_at <  $3::date
         AND e.dimension_scores <> '{}'::jsonb
         AND ($4::text IS NULL OR e.role = $4)
         AND ($5::int  IS NULL OR e.rubric_version = $5)
    ),
    pod_assignment AS (
      -- Resolve labels here so the outer aggregation can GROUP BY them directly.
      SELECT
        se.dimension_scores,
        se.role,
        se.rubric_version,
        CASE
          WHEN se.role = 'SGA' THEN '__SGA__'
          WHEN t.id IS NULL THEN 'Unassigned (no pod)'
          ELSE t.name
        END AS pod_label,
        CASE WHEN se.role = 'SGA' THEN NULL ELSE t.id END AS pod_id_out,
        CASE WHEN se.role = 'SGA' THEN NULL ELSE lead.full_name END AS lead_full_name
        FROM scoped_evals se
        LEFT JOIN coaching_team_members tm ON tm.rep_id = se.rep_id
        LEFT JOIN coaching_teams t          ON t.id = tm.team_id AND t.is_active = true
        LEFT JOIN reps lead                 ON lead.id = t.lead_rep_id AND lead.is_system = false
       -- Pod filter semantics: "show pods I selected + any unassigned reps".
       -- Bre McDaniel (SGM unassigned) survives via the IS NULL clause.
       WHERE ($6::uuid[] IS NULL OR t.id = ANY($6::uuid[]) OR t.id IS NULL)
    )
    SELECT
      role,
      rubric_version,
      pod_label,
      pod_id_out AS pod_id,
      lead_full_name,
      ds.key AS dimension_name,
      AVG((ds.value->>'score')::numeric) AS avg_score,
      COUNT(*) AS n
    FROM pod_assignment
    CROSS JOIN jsonb_each(dimension_scores) AS ds(key, value)
    GROUP BY role, rubric_version, pod_label, pod_id_out, lead_full_name, ds.key
    ORDER BY role, rubric_version,
      CASE WHEN pod_label = 'Unassigned (no pod)' THEN 1 ELSE 0 END,
      pod_label, ds.key
  `;

  const { rows: gridRows } = await pool.query<{
    role: string;
    rubric_version: number;
    pod_label: string;
    pod_id: string | null;
    lead_full_name: string | null;
    dimension_name: string;
    avg_score: string;
    n: string;
  }>(gridSql, params);

  // Group into row blocks
  const blockMap = new Map<string, DimensionHeatmapRowBlock>();
  for (const r of gridRows) {
    const key = `${r.role}|${r.rubric_version}|${r.pod_label}`;
    if (!blockMap.has(key)) {
      blockMap.set(key, {
        role: r.role,
        rubricVersion: r.rubric_version,
        podLabel: r.pod_label,
        podId: r.pod_id,
        leadFullName: r.lead_full_name,
        cells: [],
      });
    }
    blockMap.get(key)!.cells.push({
      dimensionName: r.dimension_name,
      avgScore: Number(r.avg_score),
      n: Number(r.n),
    });
  }

  const rowBlocks = Array.from(blockMap.values());

  // Rep-focus trend — only when a single rep is focused. Two windows of equal
  // length compared via FILTER aggregates so we run a single query.
  let sparklines: RepFocusTrendComparison[] | null = null;
  if (effectiveRepIds.length === 1) {
    const { currentStart, currentEnd, priorStart, priorEnd } = trendBoundsParam(trendMode);

    // Params:
    //  $1 rep_id, $2 currentStart, $3 currentEnd, $4 priorStart, $5 priorEnd, $6 rubricVersion
    const trendSql = `
      SELECT
        ds.key AS dimension_name,
        AVG((ds.value->>'score')::numeric) FILTER (WHERE e.created_at >= $2::date AND e.created_at < $3::date) AS current_avg,
        AVG((ds.value->>'score')::numeric) FILTER (WHERE e.created_at >= $4::date AND e.created_at < $5::date) AS prior_avg,
        COUNT(*) FILTER (WHERE e.created_at >= $2::date AND e.created_at < $3::date) AS current_n,
        COUNT(*) FILTER (WHERE e.created_at >= $4::date AND e.created_at < $5::date) AS prior_n
      FROM evaluations e
      JOIN reps r ON r.id = e.rep_id AND r.is_system = false
      JOIN call_notes cn ON cn.id = e.call_note_id
      CROSS JOIN jsonb_each(e.dimension_scores) AS ds(key, value)
      WHERE (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
        AND e.rep_id = $1
        AND e.dimension_scores <> '{}'::jsonb
        AND ($6::int IS NULL OR e.rubric_version = $6)
        AND e.created_at >= $4::date AND e.created_at < $3::date
      GROUP BY ds.key
      HAVING (
        COUNT(*) FILTER (WHERE e.created_at >= $2::date AND e.created_at < $3::date) +
        COUNT(*) FILTER (WHERE e.created_at >= $4::date AND e.created_at < $5::date)
      ) > 0
      ORDER BY ds.key
    `;
    const { rows: trendRows } = await pool.query<{
      dimension_name: string;
      current_avg: string | null;
      prior_avg: string | null;
      current_n: string;
      prior_n: string;
    }>(trendSql, [
      effectiveRepIds[0], currentStart, currentEnd, priorStart, priorEnd, rubricVersion,
    ]);

    sparklines = trendRows.map(r => {
      const currentAvg = r.current_avg !== null ? Number(r.current_avg) : null;
      const priorAvg = r.prior_avg !== null ? Number(r.prior_avg) : null;
      return {
        dimensionName: r.dimension_name,
        currentAvg,
        currentN: Number(r.current_n),
        priorAvg,
        priorN: Number(r.prior_n),
        delta: currentAvg !== null && priorAvg !== null ? currentAvg - priorAvg : null,
      };
    });
  }

  return { rowBlocks, sparklines };
}
