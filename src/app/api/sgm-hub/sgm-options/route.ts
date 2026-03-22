import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { runQuery } from '@/lib/bigquery';
import { toString } from '@/types/bigquery-raw';

export const dynamic = 'force-dynamic';

interface RawSGMOption {
  sgm_name: string | null;
  is_active: boolean | number | null;
}

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
    if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const query = `
      SELECT DISTINCT
        u.Name as sgm_name,
        u.IsActive as is_active
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.Is_SGM__c = TRUE
      ORDER BY u.Name
    `;

    const results = await runQuery<RawSGMOption>(query);

    const sgmOptions = results
      .filter(r => r.sgm_name !== null)
      .map(r => ({
        value: toString(r.sgm_name),
        label: toString(r.sgm_name),
        isActive: r.is_active === true || r.is_active === 1,
      }));

    return NextResponse.json({ sgmOptions });

  } catch (error) {
    console.error('[API] Error fetching SGM options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM options' },
      { status: 500 }
    );
  }
}
