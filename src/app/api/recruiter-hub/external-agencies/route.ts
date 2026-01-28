import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDistinctExternalAgencies } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
