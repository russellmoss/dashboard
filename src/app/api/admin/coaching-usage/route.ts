import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getCoachingPool,
  ALLOWED_RANGES,
  ALLOWED_SORT_FIELDS,
  ALLOWED_SORT_DIRS,
  type AllowedRange,
  type AllowedSortField,
  type AllowedSortDir,
} from '@/lib/coachingDb';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { resolveAdvisorNames } from '@/lib/queries/resolve-advisor-names';
import type { AdvisorInfo } from '@/lib/queries/resolve-advisor-names';

export const dynamic = 'force-dynamic';
const COACHING_TTL = 300; // 5 minutes per spec

const SAVVY_INTERNAL_DOMAINS = ['@savvywealth.com', '@savvyadvisors.com'];
function isSavvyInternal(email: string): boolean {
  const lc = email.toLowerCase();
  return SAVVY_INTERNAL_DOMAINS.some((d) => lc.endsWith(d));
}

// Tri-state filter: 'any' (no filter), 'yes' (must be true), 'no' (must be false).
export type TriState = 'any' | 'yes' | 'no';
const ALLOWED_TRISTATE: readonly TriState[] = ['any', 'yes', 'no'];
function parseTriState(raw: string | null): TriState {
  if (raw && (ALLOWED_TRISTATE as readonly string[]).includes(raw)) return raw as TriState;
  return 'any';
}
function triMatches(value: boolean, filter: TriState): boolean {
  if (filter === 'any') return true;
  return filter === 'yes' ? value : !value;
}
// Comma-separated stage list. Empty/missing → no stage filter.
function parseStages(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface KpiRow {
  active_coaching_users: string;     // census: is_active=true AND is_system=false (independent of range)
  active_users_in_range: string;     // distinct reps with >= 1 advisor-facing call in range
  total_advisor_facing_calls: string;
  pushed_to_sfdc: string;
  with_ai_feedback: string;
  with_manager_edit_eval: string;
  raw_granola: string;
  raw_kixie: string;
}
interface TrendRow {
  month: Date;
  advisor_facing_calls: string;
  pushed_to_sfdc: string;
  with_ai_feedback: string;
  with_manager_edit_eval: string;
  raw_note_volume: string;
}
interface DetailRow {
  call_note_id: string;
  call_date: Date;
  sga_name: string | null;
  /** reps.role for the call's rep — 'SGA' | 'SGM' | 'manager' | 'admin' | null. */
  rep_role: string | null;
  sgm_name: string | null;
  source: 'granola' | 'kixie';
  pushed_to_sfdc: boolean;
  has_ai_feedback: boolean;
  has_manager_edit_eval: boolean;
  // Server-side only — used to resolve the Advisor name via SFDC, then stripped
  // from the API response (never sent to the client).
  sfdc_who_id: string | null;
  sfdc_record_type: string | null;
  invitee_emails: string[] | null;
}

// Subset of reps.role values we expose as a server-side filter. Other values
// ('manager' / 'admin') exist but are out-of-scope for the SGA/SGM toggle —
// they get filtered out automatically when the user selects either.
type RepRoleFilter = 'any' | 'SGA' | 'SGM';
const ALLOWED_REP_ROLES: readonly RepRoleFilter[] = ['any', 'SGA', 'SGM'];
function parseRepRole(raw: string | null): RepRoleFilter {
  if (raw && (ALLOWED_REP_ROLES as readonly string[]).includes(raw)) return raw as RepRoleFilter;
  return 'any';
}

function getInsiderDomains(): string[] {
  return (process.env.COACHING_INSIDER_DOMAINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// Day-truncated cutoffs avoid the "calls disappearing mid-shift" effect of a
// millisecond-rolling now(). 'all' emits no lower-bound predicate at all
// (cleaner than '-infinity'::timestamptz).
const RANGE_WHERE: Record<AllowedRange, string> = {
  '7d':  "AND cn.call_started_at >= date_trunc('day', now()) - interval '7 days'",
  '30d': "AND cn.call_started_at >= date_trunc('day', now()) - interval '30 days'",
  '90d': "AND cn.call_started_at >= date_trunc('day', now()) - interval '90 days'",
  'all': '',
};
const SORT_COL: Record<AllowedSortField, string> = {
  call_date: 'cn.call_started_at',
  sga_name:  'sga.full_name',
  sgm_name:  'sgm.full_name',
};
const SORT_DIR: Record<AllowedSortDir, string> = {
  asc:  'ASC NULLS LAST',
  desc: 'DESC NULLS LAST',
};

const _getCoachingUsageData = async (args: {
  range: AllowedRange;
  sortBy: AllowedSortField;
  sortDir: AllowedSortDir;
  // Status filters — applied to the drill-down only. KPIs + trend stay
  // unfiltered so the headline numbers reflect the full advisor-facing universe.
  filterSql: TriState;
  filterSqo: TriState;
  filterClosedLost: TriState;
  filterStages: string[];
  filterPushed: TriState;
  filterRepRole: RepRoleFilter;
}) => {
  const { range, sortBy, sortDir, filterSql, filterSqo, filterClosedLost, filterStages, filterPushed, filterRepRole } = args;
  const rangeWhere = RANGE_WHERE[range];
  const orderBy = `${SORT_COL[sortBy]} ${SORT_DIR[sortDir]}`;
  // COACHING_INSIDER_DOMAINS entries are stored as bare domains (e.g. 'acme.com');
  // matched against `LIKE '%@' || d` to anchor on the @ boundary and prevent
  // false positives like 'foo@notacme.com' against an entry of 'acme.com'.
  const insiderDomains = getInsiderDomains();
  const pool = getCoachingPool();

  const ADVISOR_FACING_CTE = `
    advisor_calls AS (
      SELECT cn.id, cn.source, cn.call_started_at, cn.rep_id
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        ${rangeWhere}
        AND (
          cn.source = 'kixie'
          OR (
            cn.source = 'granola'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(cn.attendees, '[]'::jsonb)) AS att
              WHERE att->>'email' IS NOT NULL
                AND att->>'email' <> ''
                AND LOWER(att->>'email') NOT LIKE '%@savvywealth.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.co'
                AND LOWER(att->>'email') NOT LIKE '%.calendar.google.com'
                AND NOT EXISTS (
                  SELECT 1 FROM unnest($1::text[]) AS d
                  WHERE LOWER(att->>'email') LIKE '%@' || d
                )
            )
          )
        )
    )
  `;

  const KPI_SQL = `
    WITH
    ${ADVISOR_FACING_CTE},
    sfdc_pushed AS (
      SELECT DISTINCT swl.call_note_id
      FROM sfdc_write_log swl
      JOIN advisor_calls ac ON ac.id = swl.call_note_id
      WHERE swl.status = 'success'
    ),
    ai_flagged AS (
      SELECT DISTINCT e.call_note_id
      FROM ai_feedback af
      JOIN evaluations e ON e.id = af.evaluation_id
      JOIN advisor_calls ac ON ac.id = e.call_note_id
      WHERE af.status = 'approved'
        AND af.is_synthetic_test_data = false
    ),
    mgr_edited AS (
      -- Counts BOTH the direct-text-editor flow (slack_dm_edit_eval_text) AND the
      -- multi-claim modal flow (slack_dm_edit_eval). Excludes slack_dm_single_claim
      -- (which is the AI-Feedback flag flow — covered by metric #4 instead).
      SELECT DISTINCT e.call_note_id
      FROM evaluation_edit_audit_log eal
      JOIN evaluations e ON e.id = eal.evaluation_id
      JOIN advisor_calls ac ON ac.id = e.call_note_id
      WHERE eal.edit_source IN ('slack_dm_edit_eval_text', 'slack_dm_edit_eval')
    ),
    raw_volume AS (
      SELECT
        COALESCE(SUM(CASE WHEN cn.source = 'granola' THEN 1 ELSE 0 END), 0) AS raw_granola,
        COALESCE(SUM(CASE WHEN cn.source = 'kixie'   THEN 1 ELSE 0 END), 0) AS raw_kixie
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        ${rangeWhere}
    )
    SELECT
      (SELECT count(*) FROM reps WHERE is_active = true AND is_system = false)::text AS active_coaching_users,
      (SELECT count(DISTINCT rep_id) FROM advisor_calls)::text                       AS active_users_in_range,
      (SELECT count(*) FROM advisor_calls)::text                                     AS total_advisor_facing_calls,
      (SELECT count(*) FROM sfdc_pushed)::text                                       AS pushed_to_sfdc,
      (SELECT count(*) FROM ai_flagged)::text                                        AS with_ai_feedback,
      (SELECT count(*) FROM mgr_edited)::text                                        AS with_manager_edit_eval,
      (SELECT raw_granola FROM raw_volume)::text                                     AS raw_granola,
      (SELECT raw_kixie FROM raw_volume)::text                                       AS raw_kixie
  `;

  const TREND_SQL = `
    WITH
    months AS (
      SELECT generate_series(
        date_trunc('month', now()) - interval '5 months',
        date_trunc('month', now()),
        interval '1 month'
      ) AS month
    ),
    advisor_calls_all AS (
      SELECT cn.id, cn.source, cn.call_started_at
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        AND cn.call_started_at >= date_trunc('month', now()) - interval '5 months'
        AND (
          cn.source = 'kixie'
          OR (
            cn.source = 'granola'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(cn.attendees, '[]'::jsonb)) AS att
              WHERE att->>'email' IS NOT NULL
                AND att->>'email' <> ''
                AND LOWER(att->>'email') NOT LIKE '%@savvywealth.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.com'
                AND LOWER(att->>'email') NOT LIKE '%@savvyadvisors.co'
                AND LOWER(att->>'email') NOT LIKE '%.calendar.google.com'
                AND NOT EXISTS (
                  SELECT 1 FROM unnest($1::text[]) AS d
                  WHERE LOWER(att->>'email') LIKE '%@' || d
                )
            )
          )
        )
    ),
    raw_volume_monthly AS (
      SELECT date_trunc('month', cn.call_started_at) AS m, count(*) AS n
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        AND cn.call_started_at >= date_trunc('month', now()) - interval '5 months'
      GROUP BY 1
    )
    SELECT
      m.month,
      (SELECT count(*) FROM advisor_calls_all ac
        WHERE date_trunc('month', ac.call_started_at) = m.month)::text AS advisor_facing_calls,
      (SELECT count(DISTINCT swl.call_note_id) FROM sfdc_write_log swl
        JOIN advisor_calls_all ac ON ac.id = swl.call_note_id
        WHERE swl.status = 'success' AND date_trunc('month', ac.call_started_at) = m.month)::text AS pushed_to_sfdc,
      (SELECT count(DISTINCT e.call_note_id) FROM ai_feedback af
        JOIN evaluations e ON e.id = af.evaluation_id
        JOIN advisor_calls_all ac ON ac.id = e.call_note_id
        WHERE af.status = 'approved' AND af.is_synthetic_test_data = false
          AND date_trunc('month', ac.call_started_at) = m.month)::text AS with_ai_feedback,
      (SELECT count(DISTINCT e.call_note_id) FROM evaluation_edit_audit_log eal
        JOIN evaluations e ON e.id = eal.evaluation_id
        JOIN advisor_calls_all ac ON ac.id = e.call_note_id
        WHERE eal.edit_source IN ('slack_dm_edit_eval_text', 'slack_dm_edit_eval')
          AND date_trunc('month', ac.call_started_at) = m.month)::text AS with_manager_edit_eval,
      COALESCE((SELECT n FROM raw_volume_monthly rv WHERE rv.m = m.month), 0)::text AS raw_note_volume
    FROM months m
    ORDER BY m.month ASC
  `;

  const DETAIL_SQL = `
    WITH ${ADVISOR_FACING_CTE}
    SELECT
      cn.id AS call_note_id,
      cn.call_started_at AS call_date,
      sga.full_name AS sga_name,
      sga.role AS rep_role,
      sgm.full_name AS sgm_name,
      cn.source AS source,
      cn.sfdc_who_id AS sfdc_who_id,
      cn.sfdc_record_type AS sfdc_record_type,
      cn.invitee_emails AS invitee_emails,
      EXISTS (SELECT 1 FROM sfdc_write_log swl WHERE swl.call_note_id = cn.id AND swl.status = 'success') AS pushed_to_sfdc,
      EXISTS (
        SELECT 1 FROM ai_feedback af
        JOIN evaluations e ON e.id = af.evaluation_id
        WHERE e.call_note_id = cn.id AND af.status = 'approved' AND af.is_synthetic_test_data = false
      ) AS has_ai_feedback,
      EXISTS (
        SELECT 1 FROM evaluation_edit_audit_log eal
        JOIN evaluations e ON e.id = eal.evaluation_id
        WHERE e.call_note_id = cn.id
          AND eal.edit_source IN ('slack_dm_edit_eval_text', 'slack_dm_edit_eval')
      ) AS has_manager_edit_eval
    FROM call_notes cn
    JOIN advisor_calls ac ON ac.id = cn.id
    -- LEFT JOIN deliberately omits is_active filter: per Russell's Q2 answer,
    -- we always show SGA/SGM names in the drill-down even if the rep has left
    -- the company. Only the System Admin placeholder is suppressed.
    -- SGM may be NULL when the SGA's manager isn't an SGM (e.g., role='manager'
    -- or 'admin') or when the SGA has no manager_id set — render as "—".
    LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
    LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
    -- Drill-down-only filter:
    --   - Kixie calls always show (they're outbound phone calls to prospects;
    --     there's no calendar invitee_emails to check, but the call is
    --     definitionally external).
    --   - Granola calls require at least one external invitee_emails entry
    --     (an email NOT ending in @savvywealth.com or @savvyadvisors.com).
    --     Granola calls where every invitee is internal are excluded as
    --     internal-only meetings.
    WHERE (
      cn.source = 'kixie'
      OR (
        cn.source = 'granola'
        AND EXISTS (
          SELECT 1 FROM unnest(cn.invitee_emails) AS ie
          WHERE ie IS NOT NULL
            AND ie <> ''
            AND LOWER(ie) NOT LIKE '%@savvywealth.com'
            AND LOWER(ie) NOT LIKE '%@savvyadvisors.com'
        )
      )
    )
    ORDER BY ${orderBy}
    LIMIT 500
  `;

  const params = [insiderDomains];
  const [kpiResult, trendResult, detailResult] = await Promise.all([
    pool.query<KpiRow>(KPI_SQL, params),
    pool.query<TrendRow>(TREND_SQL, params),
    pool.query<DetailRow>(DETAIL_SQL, params),
  ]);

  const k = kpiResult.rows[0] ?? {} as KpiRow;
  const totalAdvisorFacingCalls = Number(k.total_advisor_facing_calls) || 0;
  const safeRatio = (n: number) =>
    totalAdvisorFacingCalls === 0 ? 0 : n / totalAdvisorFacingCalls;

  return {
    kpis: {
      activeCoachingUsers:    Number(k.active_coaching_users) || 0,
      activeUsersInRange:     Number(k.active_users_in_range) || 0,
      totalAdvisorFacingCalls,
      pctPushedToSfdc:        safeRatio(Number(k.pushed_to_sfdc) || 0),
      pctWithAiFeedback:      safeRatio(Number(k.with_ai_feedback) || 0),
      pctWithManagerEditEval: safeRatio(Number(k.with_manager_edit_eval) || 0),
      rawNoteVolume: {
        granola: Number(k.raw_granola) || 0,
        kixie:   Number(k.raw_kixie)   || 0,
        total:  (Number(k.raw_granola) || 0) + (Number(k.raw_kixie) || 0),
      },
    },
    trend: trendResult.rows.map(r => {
      const calls = Number(r.advisor_facing_calls) || 0;
      const ratio = (n: number) => calls === 0 ? 0 : n / calls;
      return {
        month: r.month.toISOString().slice(0, 10),
        advisorFacingCalls:     calls,
        pctPushedToSfdc:        ratio(Number(r.pushed_to_sfdc) || 0),
        pctWithAiFeedback:      ratio(Number(r.with_ai_feedback) || 0),
        pctWithManagerEditEval: ratio(Number(r.with_manager_edit_eval) || 0),
        rawNoteVolume:          Number(r.raw_note_volume) || 0,
      };
    }),
    drillDown: applyDrillDownFilters(
      await annotateDrillDownWithAdvisor(detailResult.rows),
      { filterSql, filterSqo, filterClosedLost, filterStages, filterPushed, filterRepRole },
    ),
    range,
    sortBy,
    sortDir,
    filters: {
      sql: filterSql,
      sqo: filterSqo,
      closedLost: filterClosedLost,
      stages: filterStages,
      pushed: filterPushed,
      repRole: filterRepRole,
    },
    generated_at: new Date().toISOString(),
  };
};

// Server-side filter pass over the annotated drill-down rows. Filters are
// independent — empty filterStages means "any stage", tri-states default to
// 'any'. A row must satisfy every active filter to survive.
//
// Linkage rule (per-spec): when any FUNNEL-STATUS filter is active (sql/sqo/
// closedLost/stages), unlinked rows are dropped. We can only definitively
// know an advisor's status when we resolved them to SFDC; saying "didn't SQL"
// for an unverified person would be a false claim.
//
// `filterPushed` is per-call (sfdc_write_log on the call_note itself), NOT
// per-advisor, so it does NOT require SFDC linkage to be meaningful.
function applyDrillDownFilters<T extends {
  linkedToSfdc: boolean;
  didSql: boolean;
  didSqo: boolean;
  closedLost: boolean;
  currentStage: string | null;
  pushedToSfdc: boolean;
  repRole: string | null;
}>(
  rows: T[],
  args: {
    filterSql: TriState;
    filterSqo: TriState;
    filterClosedLost: TriState;
    filterStages: string[];
    filterPushed: TriState;
    filterRepRole: RepRoleFilter;
  },
): T[] {
  const stageSet = new Set(args.filterStages.map((s) => s.toLowerCase()));
  const anyFunnelFilterActive =
    args.filterSql !== 'any'
    || args.filterSqo !== 'any'
    || args.filterClosedLost !== 'any'
    || stageSet.size > 0;
  return rows.filter((r) => {
    if (anyFunnelFilterActive && !r.linkedToSfdc) return false;
    if (!triMatches(r.didSql, args.filterSql)) return false;
    if (!triMatches(r.didSqo, args.filterSqo)) return false;
    if (!triMatches(r.closedLost, args.filterClosedLost)) return false;
    if (stageSet.size > 0) {
      const stage = (r.currentStage ?? '').toLowerCase();
      if (!stageSet.has(stage)) return false;
    }
    if (!triMatches(r.pushedToSfdc, args.filterPushed)) return false;
    if (args.filterRepRole !== 'any' && r.repRole !== args.filterRepRole) return false;
    return true;
  });
}

// ─── Advisor-name annotation (post-pg, pre-cache wrap) ────────────────────────
//
// Cascade per row:
//   1. sfdc_who_id is set → BigQuery resolves Lead/Contact name → use it.
//   2. sfdc_who_id is null AND row has at least one external invitee_email:
//      a. If exactly ONE of those emails resolves to a unique person in
//         Lead/Contact → use that name.
//      b. Otherwise → display the FIRST external email; remaining externals
//         go in advisorEmailExtras for the client tooltip.
//   3. None of the above → 'Unknown'.
//
// `sfdc_who_id`, `sfdc_record_type`, and `invitee_emails` are stripped from
// the response shape — the resolved `advisorName`/`advisorEmail`/`advisorEmailExtras`
// is the only public surface.
async function annotateDrillDownWithAdvisor(rows: DetailRow[]) {
  // Collect the lookup inputs.
  const whoIds = new Set<string>();
  const externalEmails = new Set<string>();
  for (const r of rows) {
    if (r.sfdc_who_id) whoIds.add(r.sfdc_who_id);
    if (!r.sfdc_who_id && Array.isArray(r.invitee_emails)) {
      for (const e of r.invitee_emails) {
        if (typeof e !== 'string') continue;
        const trimmed = e.trim();
        if (!trimmed) continue;
        if (isSavvyInternal(trimmed)) continue;
        externalEmails.add(trimmed.toLowerCase());
      }
    }
  }

  // One BigQuery round-trip (skipped entirely when both sets are empty).
  const { whoIdToInfo, emailToUniqueInfo } = await resolveAdvisorNames({
    whoIds: [...whoIds],
    emails: [...externalEmails],
  });

  return rows.map((r) => {
    let advisorName: string | null = null;
    let advisorEmail: string | null = null;
    const advisorEmailExtras: string[] = [];
    let info: AdvisorInfo | null = null;

    if (r.sfdc_who_id && whoIdToInfo[r.sfdc_who_id]) {
      info = whoIdToInfo[r.sfdc_who_id]!;
      advisorName = info.name;
    } else {
      const externals = (Array.isArray(r.invitee_emails) ? r.invitee_emails : [])
        .filter((e): e is string => typeof e === 'string')
        .map((e) => e.trim())
        .filter((e) => e !== '' && !isSavvyInternal(e));

      if (externals.length > 0) {
        // First check whether any external email resolves to a unique person.
        for (const e of externals) {
          const uniqueInfo = emailToUniqueInfo[e.toLowerCase()];
          if (uniqueInfo) {
            info = uniqueInfo;
            advisorName = uniqueInfo.name;
            break;
          }
        }
        // No unique-name match — display the first email and stash the rest
        // for the client's hover tooltip.
        if (!advisorName) {
          advisorEmail = externals[0]!;
          for (let i = 1; i < externals.length; i++) {
            advisorEmailExtras.push(externals[i]!);
          }
        }
      }
    }

    return {
      callNoteId: r.call_note_id,
      callDate: r.call_date instanceof Date ? r.call_date.toISOString() : String(r.call_date),
      advisorName,
      advisorEmail,
      advisorEmailExtras,
      // True iff we definitively linked this row to a SFDC Lead/Contact. Used
      // by the filter pass: when any status filter is active, only linked
      // rows survive (unlinked rows have no verified status to filter on).
      linkedToSfdc: info !== null,
      // Funnel status — derived from vw_funnel_master via the resolver. Defaults
      // to false / null when the advisor couldn't be linked to a Lead/Contact
      // (e.g. no who_id and no unique-email match).
      didSql: info?.didSql ?? false,
      didSqo: info?.didSqo ?? false,
      currentStage: info?.currentStage ?? null,
      closedLost: info?.closedLost ?? false,
      sgaName: r.sga_name,
      repRole: r.rep_role,
      sgmName: r.sgm_name,
      source: r.source,
      pushedToSfdc: r.pushed_to_sfdc,
      hasAiFeedback: r.has_ai_feedback,
      hasManagerEditEval: r.has_manager_edit_eval,
    };
  });
}

const getCoachingUsageData = cachedQuery(
  _getCoachingUsageData,
  'getCoachingUsageData',
  CACHE_TAGS.COACHING_USAGE,
  COACHING_TTL,
);

export async function GET(request: NextRequest) {
  try {
    // Auth gate (verbatim copy from /api/admin/bot-usage/route.ts lines 265-279)
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawRange = searchParams.get('range') ?? '30d';
    const range: AllowedRange = (ALLOWED_RANGES as readonly string[]).includes(rawRange)
      ? (rawRange as AllowedRange) : '30d';

    const rawSort = searchParams.get('sortBy') ?? 'call_date';
    const sortBy: AllowedSortField = (ALLOWED_SORT_FIELDS as readonly string[]).includes(rawSort)
      ? (rawSort as AllowedSortField) : 'call_date';

    const rawDir = searchParams.get('sortDir') ?? 'desc';
    const sortDir: AllowedSortDir = (ALLOWED_SORT_DIRS as readonly string[]).includes(rawDir)
      ? (rawDir as AllowedSortDir) : 'desc';

    const filterSql = parseTriState(searchParams.get('sql'));
    const filterSqo = parseTriState(searchParams.get('sqo'));
    const filterClosedLost = parseTriState(searchParams.get('closedLost'));
    const filterStages = parseStages(searchParams.get('stages'));
    const filterPushed = parseTriState(searchParams.get('pushed'));
    const filterRepRole = parseRepRole(searchParams.get('repRole'));

    const data = await getCoachingUsageData({
      range, sortBy, sortDir,
      filterSql, filterSqo, filterClosedLost, filterStages, filterPushed, filterRepRole,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error fetching coaching usage:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch coaching usage' },
      { status: 500 }
    );
  }
}
