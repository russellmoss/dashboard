// src/app/api/dashboard/record-detail/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRecordDetail } from '@/lib/queries/record-detail';

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

    // Fetch record
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
