import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getDistinctExternalAgencies } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Check if user can access Recruiter Hub
    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // For recruiters, only return their own agency
    // For admins/managers, return all agencies
    if (permissions.role === 'recruiter' && permissions.recruiterFilter) {
      return NextResponse.json({ agencies: [permissions.recruiterFilter] });
    }

    // Non-recruiters get the full list
    const agencies = await getDistinctExternalAgencies();

    return NextResponse.json({ agencies });
  } catch (error) {
    console.error('Error fetching external agencies:', error);
    return NextResponse.json(
      { error: 'Failed to fetch external agencies' },
      { status: 500 }
    );
  }
}
