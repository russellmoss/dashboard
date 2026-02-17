import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Roles that have access to Dashboard Requests (page 13)
const TAGGABLE_ROLES = ['revops_admin', 'admin', 'manager', 'sgm', 'sga', 'viewer'];

/**
 * GET /api/users/taggable
 * Returns lightweight user list for @mention autocomplete.
 * Only returns active users with Dashboard Requests access.
 * Does NOT require canManageUsers — any authenticated user with Dashboard Requests access can call this.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session); // from @/types/auth — no DB query
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Only users who can access Dashboard Requests can use mentions
    if (permissions.role === 'recruiter' || permissions.role === 'capital_partner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: TAGGABLE_ROLES },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('[API] Error fetching taggable users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
