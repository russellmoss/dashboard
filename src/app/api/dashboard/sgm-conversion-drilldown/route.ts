import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSgmConversionDrilldownRecords } from '@/lib/queries/open-pipeline';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
import type { SgmConversionDrilldownMetric } from '@/lib/queries/open-pipeline';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { sgm, metric, sgms, dateRange } = body as {
      sgm: string;
      metric: SgmConversionDrilldownMetric;
      sgms?: string[];
      dateRange?: { startDate: string; endDate: string } | null;
    };

    if (!sgm || typeof sgm !== 'string') {
      return NextResponse.json(
        { error: 'sgm is required' },
        { status: 400 }
      );
    }

    if (!metric || !['sql', 'sqo', 'joined'].includes(metric)) {
      return NextResponse.json(
        { error: 'metric must be one of: sql, sqo, joined' },
        { status: 400 }
      );
    }

    const records = await getSgmConversionDrilldownRecords(sgm, metric, {
      sgms,
      dateRange,
    });

    return NextResponse.json({ records });
  } catch (error) {
    console.error('Error fetching SGM conversion drill-down:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversion drill-down records' },
      { status: 500 }
    );
  }
}
