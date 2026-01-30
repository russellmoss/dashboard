import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRecruiterProspects } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

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

    // Check if user can access Recruiter Hub (page 12)
    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { stages, openOnly, closedOnly, externalAgencies } = body;

    // CRITICAL: For recruiters, always use their recruiterFilter
    const records = await getRecruiterProspects(
      permissions.recruiterFilter,
      {
        stages,
        openOnly: openOnly ?? true,
        closedOnly: closedOnly ?? false,
        externalAgencies: permissions.recruiterFilter ? undefined : externalAgencies,
      }
    );

    return NextResponse.json({
      records,
      count: records.length,
      recruiterFilter: permissions.recruiterFilter,  // Let client know if filtered
    });
  } catch (error) {
    console.error('Error fetching recruiter prospects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prospects' },
      { status: 500 }
    );
  }
}
