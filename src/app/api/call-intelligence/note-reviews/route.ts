import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
  CallNoteConflictError,
} from '@/lib/sales-coaching-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const result = await salesCoachingClient.listMyNoteReviews(session.user.email);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CallNoteConflictError) return NextResponse.json({ error: 'note_conflict', message: err.message, requestId: err.requestId }, { status: 409 });
    if (err instanceof BridgeValidationError) return NextResponse.json({ error: err.message, issues: err.issues, requestId: err.requestId }, { status: 400 });
    if (err instanceof BridgeAuthError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status });
    if (err instanceof BridgeTransportError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status || 500 });
    console.error('[note-reviews list] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
