import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineBySgm } from '@/lib/queries/open-pipeline';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
import { SgmPipelineChartData } from '@/types/dashboard';

// Force dynamic rendering (uses headers for authentication)
export const dynamic = 'force-dynamic';

function stageToKey(stage: string): string {
  const map: Record<string, string> = {
    'Planned Nurture': 'plannedNurture',
    'Qualifying': 'qualifying',
    'Discovery': 'discovery',
    'Sales Process': 'salesProcess',
    'Negotiating': 'negotiating',
    'Signed': 'signed',
    'On Hold': 'onHold',
  };
  return map[stage] || stage.toLowerCase().replace(/\s+/g, '');
}

function pivotBySgm(
  rows: { sgm: string; stage: string; count: number; aum: number }[]
): SgmPipelineChartData[] {
  const sgmMap = new Map<string, SgmPipelineChartData>();

  for (const row of rows) {
    if (!sgmMap.has(row.sgm)) {
      sgmMap.set(row.sgm, {
        sgm: row.sgm,
        totalAum: 0,
        totalCount: 0,
        plannedNurture: 0, qualifying: 0, discovery: 0,
        salesProcess: 0, negotiating: 0, signed: 0, onHold: 0,
        plannedNurtureCount: 0, qualifyingCount: 0, discoveryCount: 0,
        salesProcessCount: 0, negotiatingCount: 0, signedCount: 0, onHoldCount: 0,
      });
    }
    const entry = sgmMap.get(row.sgm)!;
    const key = stageToKey(row.stage);

    // Set AUM for this stage
    (entry as any)[key] = row.aum;
    // Set count for this stage
    (entry as any)[`${key}Count`] = row.count;
    // Accumulate totals
    entry.totalAum += row.aum;
    entry.totalCount += row.count;
  }

  // Sort by totalAum descending (highest pipeline first)
  return [...sgmMap.values()].sort((a, b) => b.totalAum - a.totalAum);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    // Block recruiters from dashboard pipeline endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    // Additional check: revops_admin only
    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { stages, sgms, dateRange } = body;

    const rows = await getOpenPipelineBySgm({ stages, sgms, dateRange });
    const pivotedData = pivotBySgm(rows);

    return NextResponse.json({ data: pivotedData });
  } catch (error) {
    console.error('Error fetching pipeline by SGM:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline by SGM' },
      { status: 500 }
    );
  }
}
