import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { salesCoachingClient } from '@/lib/sales-coaching-client';
import { NoteReviewClient } from './NoteReviewClient';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NoteReviewPage({ params }: { params: Promise<{ callNoteId: string }> }) {
  const { callNoteId } = await params;
  if (!UUID_RE.test(callNoteId)) redirect('/dashboard/call-intelligence');

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  const permissions = getSessionPermissions(session);
  if (!permissions) redirect('/login');
  if (permissions.role === 'recruiter') redirect('/dashboard/recruiter-hub');
  if (permissions.role === 'capital_partner') redirect('/dashboard/gc-hub');
  if (!permissions.allowedPages.includes(20)) redirect('/dashboard');

  let initial;
  try {
    initial = await salesCoachingClient.getCallNoteReview(session.user.email, callNoteId);
  } catch {
    // Note may have been already approved/rejected, deleted, or the rep doesn't have access.
    redirect('/dashboard/call-intelligence?tab=queue&note=unavailable');
  }

  return <NoteReviewClient initial={initial.call_note} suggestion={initial.sfdc_suggestion ?? null} />;
}
