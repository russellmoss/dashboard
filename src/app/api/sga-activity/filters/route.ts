import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSGAActivityFilterOptions } from '@/lib/queries/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

    if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const filterOptions = await getSGAActivityFilterOptions();

    // If SGA role, only return their own name in the list
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      filterOptions.sgas = filterOptions.sgas.filter(
        s => s.value === permissions.sgaFilter
      );
    }

    return NextResponse.json(filterOptions);
  } catch (error: any) {
    logger.error('SGA Activity filters error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
