import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import {
  getRepIdByEmail,
  getEvaluationsForManager,
  type QueueScope,
  type HistoryFilter,
} from '@/lib/queries/call-intelligence-evaluations';

export const dynamic = 'force-dynamic';

const QUEUE_TTL = 60;
const ALLOWED_HISTORY: readonly HistoryFilter[] = ['pending', 'revealed', 'all'] as const;

const _getQueue = async (args: { scope: QueueScope; historyFilter: HistoryFilter }) =>
  getEvaluationsForManager(args.scope, { historyFilter: args.historyFilter });
// Cache key includes historyFilter via the wrapper's positional-args hash; safe with cachedQuery's keyName + args serialization.
const getQueueCached = cachedQuery(_getQueue, 'getCallIntelligenceQueue', CACHE_TAGS.CALL_INTELLIGENCE_QUEUE, QUEUE_TTL);

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions) return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    if (!permissions.allowedPages.includes(20)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // History filter: ?status=pending (default) | revealed | all. Allowlist-validated.
    const rawStatus = request.nextUrl.searchParams.get('status') ?? 'pending';
    const historyFilter: HistoryFilter =
      (ALLOWED_HISTORY as readonly string[]).includes(rawStatus) ? (rawStatus as HistoryFilter) : 'pending';

    let scope: QueueScope;
    if (permissions.role === 'revops_admin' || permissions.role === 'admin') {
      scope = { kind: 'admin' };
    } else {
      const rep = await getRepIdByEmail(session.user.email);
      if (!rep) return NextResponse.json({ rows: [], generated_at: new Date().toISOString() });
      // Manager scope = direct reviewer. SGM/SGA scope = own evals (coachee view).
      if (permissions.role === 'manager') {
        scope = { kind: 'manager', managerRepId: rep.id };
      } else if (permissions.role === 'sgm') {
        scope = { kind: 'sgm', repId: rep.id };
      } else {
        scope = { kind: 'sga', repId: rep.id };
      }
    }

    const rows = await getQueueCached({ scope, historyFilter });
    return NextResponse.json({ rows, generated_at: new Date().toISOString(), historyFilter });
  } catch (err) {
    console.error('[/api/call-intelligence/queue] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch queue' },
      { status: 500 },
    );
  }
}
