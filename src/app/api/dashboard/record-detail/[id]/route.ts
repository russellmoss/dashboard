// src/app/api/dashboard/record-detail/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRecordDetail } from '@/lib/queries/record-detail';
import { getSessionPermissions } from '@/types/auth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Validate id parameter
    const { id } = params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'Invalid record ID' },
        { status: 400 }
      );
    }

    // Validate ID format (should start with 00Q for Lead or 006 for Opportunity)
    if (!id.startsWith('00Q') && !id.startsWith('006')) {
      return NextResponse.json(
        { error: 'Invalid record ID format' },
        { status: 400 }
      );
    }

    // Recruiters may only view record details for records in their agency
    if (permissions.role === 'recruiter') {
      if (!permissions.allowedPages.includes(12) || !permissions.recruiterFilter) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const record = await getRecordDetail(id, permissions.recruiterFilter);
      if (!record) {
        // Avoid leaking existence of records outside their filter
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
      return NextResponse.json({ record });
    }

    // Fetch record (non-recruiters)
    const record = await getRecordDetail(id);

    if (!record) {
      return NextResponse.json(
        { error: 'Record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ record });

  } catch (error) {
    console.error('Error fetching record detail:', error);
    return NextResponse.json(
      { error: 'Failed to fetch record detail' },
      { status: 500 }
    );
  }
}
