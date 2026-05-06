// GET /api/admin/coaching-usage
//
// Single-query payload for the Coaching Usage tab. Returns the full annotated
// list of advisor-facing calls in the selected range, plus the active-coaching-
// users census. The client computes every KPI and applies every filter (rep
// name, advisor name, SQL'd, SQO'd, Closed Lost, Pushed to SFDC, rep role,
// stage) locally — so KPIs are reactive to filter changes with no per-keystroke
// round-trip, and the response cache stratifies only by `range`.
//
// Auth: revops_admin only.
// Cache: 5-min TTL, COACHING_USAGE tag (busted by /api/admin/refresh-cache).
//
// Volume note: total advisor-facing calls all-time is in the low hundreds
// (~213 today), so returning the unfiltered set per range is well within
// budget for both the network payload and the BigQuery resolver round-trip.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getCoachingPool,
  ALLOWED_RANGES,
  type AllowedRange,
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

interface DetailRow {
  call_note_id: string;
  call_date: Date;
  /** call_notes.rep_id — opaque key the client uses to count distinct
   *  active-users-in-range from the filtered set. Not surfaced as PII. */
  rep_id: string | null;
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
  /** Kixie-only: the SFDC Task.Id that owns this call's recording. Used as a
   *  self-healing fallback when sfdc_who_id is NULL — Salesforce often
   *  associates Task.WhoId minutes-to-hours after the Task is created (and
   *  BQ sync adds more lag), so the call-transcriber's bake-in of
   *  sfdc_who_id can land NULL even though the WhoId exists in SFDC now.
   *  We re-resolve via Task.WhoId at request time. Stripped from response. */
  kixie_task_id: string | null;
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

const _getCoachingUsageData = async (args: { range: AllowedRange }) => {
  const { range } = args;
  const rangeWhere = RANGE_WHERE[range];
  const pool = getCoachingPool();

  // Advisor-facing rule (must match KPIs, drill-down, and modal):
  //   - Kixie: always counts (outbound dialer is by definition prospect-facing;
  //     likely_call_type isn't run on Kixie yet so it's NULL there).
  //   - Granola: count only when the AI classifier says `likely_call_type =
  //     'advisor_call'` (excludes 'internal_collaboration', 'vendor_call',
  //     'unknown', and unclassified rows).
  // Sort is `call_started_at DESC` server-side as a stable default; the client
  // re-sorts based on the user's UI selection.
  const DETAIL_SQL = `
    WITH advisor_calls AS (
      SELECT cn.id
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        ${rangeWhere}
        AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
    )
    SELECT
      cn.id AS call_note_id,
      cn.call_started_at AS call_date,
      cn.rep_id AS rep_id,
      sga.full_name AS sga_name,
      sga.role AS rep_role,
      sgm.full_name AS sgm_name,
      cn.source AS source,
      cn.sfdc_who_id AS sfdc_who_id,
      cn.sfdc_record_type AS sfdc_record_type,
      cn.invitee_emails AS invitee_emails,
      cn.kixie_task_id AS kixie_task_id,
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
    LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
    LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
    ORDER BY cn.call_started_at DESC NULLS LAST
  `;

  // Census of provisioned coaching users — independent of the date range.
  // Tiny and cheap to fire alongside DETAIL_SQL.
  const CENSUS_SQL = `
    SELECT count(*)::text AS active_coaching_users
    FROM reps
    WHERE is_active = true AND is_system = false
  `;

  const [detailResult, censusResult] = await Promise.all([
    pool.query<DetailRow>(DETAIL_SQL),
    pool.query<{ active_coaching_users: string }>(CENSUS_SQL),
  ]);

  const drillDown = await annotateDrillDownWithAdvisor(detailResult.rows);
  const activeCoachingUsers = Number(censusResult.rows[0]?.active_coaching_users) || 0;

  return {
    activeCoachingUsers,
    drillDown,
    range,
    generated_at: new Date().toISOString(),
  };
};

// ─── Advisor-name annotation (post-pg, pre-cache wrap) ────────────────────────
//
// Cascade per row:
//   1. sfdc_who_id is set → BigQuery resolves Lead/Contact name → use it.
//   2. (Kixie self-healing) sfdc_who_id is null AND source='kixie' AND
//      kixie_task_id is set → look up Task.WhoId in BQ → resolve Lead/Contact
//      name. This recovers calls where the WhoId was associated to the SFDC
//      Task after the call-transcriber baked sfdc_who_id=NULL into Postgres
//      (Salesforce association lag + BQ sync lag stack on top of each other,
//      and Kixie calls have no calendar invitees to fall back on).
//   3. sfdc_who_id is null AND row has at least one external invitee_email:
//      a. If exactly ONE of those emails resolves to a unique person in
//         Lead/Contact → use that name.
//      b. Otherwise → display the FIRST external email; remaining externals
//         go in advisorEmailExtras for the client tooltip.
//   4. None of the above → 'Unknown'.
//
// `sfdc_who_id`, `sfdc_record_type`, `invitee_emails`, and `kixie_task_id`
// are stripped from the response shape — the resolved
// `advisorName`/`advisorEmail`/`advisorEmailExtras` is the only public surface.
async function annotateDrillDownWithAdvisor(rows: DetailRow[]) {
  // Collect every possible lookup input from EVERY row — not just rows where
  // sfdc_who_id is null. Reason: the primary who_id arm can miss even when
  // sfdc_who_id is set if the referenced Lead/Contact hasn't sync'd to BQ
  // yet (Fivetran lag on brand-new SFDC records is the common case). We need
  // the kixie self-heal and email arms primed so the cascade can fall through
  // to them; otherwise a same-day call on a fresh Lead/Contact silently
  // shows the email or 'Unknown' even though either fallback would resolve.
  const whoIds = new Set<string>();
  const externalEmails = new Set<string>();
  const kixieTaskIds = new Set<string>();
  for (const r of rows) {
    if (r.sfdc_who_id) whoIds.add(r.sfdc_who_id);
    if (r.source === 'kixie' && r.kixie_task_id) {
      kixieTaskIds.add(r.kixie_task_id);
    }
    if (Array.isArray(r.invitee_emails)) {
      for (const e of r.invitee_emails) {
        if (typeof e !== 'string') continue;
        const trimmed = e.trim();
        if (!trimmed) continue;
        if (isSavvyInternal(trimmed)) continue;
        externalEmails.add(trimmed.toLowerCase());
      }
    }
  }

  // One BigQuery round-trip (skipped entirely when all sets are empty).
  const { whoIdToInfo, emailToUniqueInfo, kixieTaskIdToInfo } = await resolveAdvisorNames({
    whoIds: [...whoIds],
    emails: [...externalEmails],
    kixieTaskIds: [...kixieTaskIds],
  });

  return rows.map((r) => {
    let advisorName: string | null = null;
    let advisorEmail: string | null = null;
    const advisorEmailExtras: string[] = [];
    let info: AdvisorInfo | null = null;

    if (r.sfdc_who_id && whoIdToInfo[r.sfdc_who_id]) {
      info = whoIdToInfo[r.sfdc_who_id]!;
      advisorName = info.name;
    } else if (r.source === 'kixie' && r.kixie_task_id && kixieTaskIdToInfo[r.kixie_task_id]) {
      // Self-healing kixie path — Postgres' baked-in sfdc_who_id is NULL but
      // BQ now sees Task.WhoId.
      info = kixieTaskIdToInfo[r.kixie_task_id]!;
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

    // SFDC deep-links for the modal footer. Only built when the resolver
    // returned an Id — unlinked rows (no who_id + no unique-email match)
    // get null URLs and the modal hides the buttons.
    const leadId = info?.leadId ?? null;
    const opportunityId = info?.opportunityId ?? null;
    const leadUrl = leadId
      ? `https://savvywealth.lightning.force.com/lightning/r/Lead/${leadId}/view`
      : null;
    const opportunityUrl = opportunityId
      ? `https://savvywealth.lightning.force.com/lightning/r/Opportunity/${opportunityId}/view`
      : null;

    return {
      callNoteId: r.call_note_id,
      callDate: r.call_date instanceof Date ? r.call_date.toISOString() : String(r.call_date),
      advisorName,
      advisorEmail,
      advisorEmailExtras,
      // True iff we definitively linked this row to a SFDC Lead/Contact. The
      // client uses this to decide whether to drop the row when a funnel-status
      // filter is active (unverified rows have no verified status to filter on).
      linkedToSfdc: info !== null,
      leadUrl,
      opportunityUrl,
      // Funnel status — derived from vw_funnel_master via the resolver. Defaults
      // to false / null when the advisor couldn't be linked to a Lead/Contact.
      didSql: info?.didSql ?? false,
      didSqo: info?.didSqo ?? false,
      currentStage: info?.currentStage ?? null,
      closedLost: info?.closedLost ?? false,
      repId: r.rep_id,
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

    const data = await getCoachingUsageData({ range });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error fetching coaching usage:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch coaching usage' },
      { status: 500 }
    );
  }
}
