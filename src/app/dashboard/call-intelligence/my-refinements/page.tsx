import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import MyRefinementsClient from './MyRefinementsClient';

export const dynamic = 'force-dynamic';

export default async function MyRefinementsPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const { highlight } = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  const permissions = getSessionPermissions(session);
  if (!permissions) redirect('/login');
  if (permissions.role === 'recruiter') redirect('/dashboard/recruiter-hub');
  if (permissions.role === 'capital_partner') redirect('/dashboard/gc-hub');
  if (!permissions.allowedPages.includes(20)) redirect('/dashboard');

  return (
    <div className="px-4 py-6 space-y-4">
      <Link
        href="/dashboard/call-intelligence?tab=settings"
        className="inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← Back to Call Intelligence
      </Link>
      <MyRefinementsClient highlight={highlight ?? null} />
    </div>
  );
}
