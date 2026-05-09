import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getContentRefinements } from '@/lib/queries/call-intelligence-refinements';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || (permissions.role !== 'admin' && permissions.role !== 'revops_admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const status = request.nextUrl.searchParams.get('status') === 'all' ? 'all' : 'open';
    const rows = await getContentRefinements({ status });
    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[/api/call-intelligence/refinements GET] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
