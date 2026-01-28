import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getRecruiterOpportunities, getRecruiterHubSGMs } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Check if user can access Recruiter Hub (page 12)
    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { stages, sgms, openOnly, closedOnly, externalAgencies } = body;

    // CRITICAL: For recruiters, always use their recruiterFilter
    const records = await getRecruiterOpportunities(
      permissions.recruiterFilter,
      {
        stages,
        sgms,
        openOnly: openOnly ?? true,
        closedOnly: closedOnly ?? false,
        externalAgencies: permissions.recruiterFilter ? undefined : externalAgencies,
      }
    );

    return NextResponse.json({
      records,
      count: records.length,
      recruiterFilter: permissions.recruiterFilter,
    });
  } catch (error) {
    console.error('Error fetching recruiter opportunities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch opportunities' },
      { status: 500 }
    );
  }
}

// GET endpoint for filter options (SGMs)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sgms = await getRecruiterHubSGMs(permissions.recruiterFilter);

    return NextResponse.json({ sgms });
  } catch (error) {
    console.error('Error fetching SGMs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGMs' },
      { status: 500 }
    );
  }
}
