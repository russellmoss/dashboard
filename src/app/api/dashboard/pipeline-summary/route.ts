import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineSummary } from '@/lib/queries/open-pipeline';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';

// Force dynamic rendering (uses headers for authentication)
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    // Block recruiters from dashboard pipeline endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
    
    const body = await request.json();
    const { stages, sgms } = body;
    
    const summary = await getOpenPipelineSummary({ stages, sgms });
    
    // Format response
    const response = {
      totalAum: summary.totalAum,
      totalAumFormatted: formatCurrency(summary.totalAum),
      advisorCount: summary.recordCount,
      byStage: summary.byStage.map(s => ({
        stage: s.stage,
        advisorCount: s.count,
        totalAum: s.aum,
        aumFormatted: formatCurrency(s.aum),
        aumInBillions: Math.round(s.aum / 1000000000 * 100) / 100,
      })),
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching pipeline summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline summary' },
      { status: 500 }
    );
  }
}
