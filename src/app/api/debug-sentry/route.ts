import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  throw new Error('Sentry test error from /api/debug-sentry');
  return NextResponse.json({ ok: true });
}
