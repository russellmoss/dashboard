// GET /api/dashboard/record-detail/[id]/notes
//
// Returns the per-record Notes tab payload for RecordDetailModal: every
// sales-coaching call_note confidently linked to the Lead/Contact behind
// `[id]`, ordered most-recent first.
//
// `[id]` can be a Lead Id (00Q…), Opportunity Id (006…), or Contact Id
// (003…). All three resolve to a single Lead via vw_funnel_master /
// Lead.ConvertedContactId before notes are pulled.
//
// RBAC:
//   - revops_admin / admin / manager  → see all matching notes
//   - sga                             → only when their reps.full_name
//                                       matches sga_owner_name OR opp_sga_name
//   - sgm                             → only when reps.full_name matches sgm_owner_name
//   - other (viewer / recruiter / capital_partner) → 200 with notes:[]
//
// Cache: 5-minute TTL on DASHBOARD tag (cleared by the global Refresh
// button). Note that the response is keyed by recordId AND requesting
// session role+email so per-user RBAC results aren't cross-served.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import {
  resolveRecordContext,
  fetchNotesForContext,
  getUserRepIdentity,
} from '@/lib/queries/record-notes';
import type { RecordNotesResponse } from '@/types/record-notes';

export const dynamic = 'force-dynamic';
const NOTES_TTL = 300;

const SFDC_ID_RE = /^00[36Q][a-zA-Z0-9]{12,15}$/;

const ROLES_SEE_ALL = new Set(['revops_admin', 'admin', 'manager']);

function nameMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const _getNotesForRecord = async (args: {
  recordId: string;
  role: string;
  email: string;
}): Promise<RecordNotesResponse> => {
  const { recordId, role, email } = args;

  const ctx = await resolveRecordContext(recordId);

  // RBAC.
  let authorized = false;
  if (ROLES_SEE_ALL.has(role)) {
    authorized = true;
  } else if (role === 'sga' || role === 'sgm') {
    const me = await getUserRepIdentity(email);
    if (me) {
      if (role === 'sga') {
        authorized = nameMatch(me.fullName, ctx.sgaOwnerName)
                  || nameMatch(me.fullName, ctx.oppSgaName);
      } else {
        authorized = nameMatch(me.fullName, ctx.sgmOwnerName);
      }
    }
  }

  if (!authorized) {
    return {
      notes: [],
      authorized: false,
      leadId: ctx.leadId,
      generated_at: new Date().toISOString(),
    };
  }

  const notes = await fetchNotesForContext(ctx);
  return {
    notes,
    authorized: true,
    leadId: ctx.leadId,
    generated_at: new Date().toISOString(),
  };
};

const getNotesForRecord = cachedQuery(
  _getNotesForRecord,
  'getNotesForRecord',
  CACHE_TAGS.DASHBOARD,
  NOTES_TTL,
);

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const { id } = await ctx.params;
    if (!id || typeof id !== 'string' || !SFDC_ID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
    }

    const data = await getNotesForRecord({
      recordId: id,
      role: permissions.role,
      email: session.user.email,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error fetching record notes:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch notes' },
      { status: 500 },
    );
  }
}
