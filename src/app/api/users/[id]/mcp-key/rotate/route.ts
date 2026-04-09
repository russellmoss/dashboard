import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getUserById } from '@/lib/users';
import { rotateMcpApiKey } from '@/lib/mcp-key-utils';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

// POST /api/users/[id]/mcp-key/rotate - Rotate MCP API key (atomic revoke + generate)
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const user = await getUserById(params.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (!user.bqAccess) {
      return NextResponse.json({ error: 'User does not have BigQuery access enabled' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const label = body.label || null;

    const plaintext = await rotateMcpApiKey(params.id, label);

    return NextResponse.json({ key: plaintext });
  } catch (error: any) {
    console.error('Error rotating MCP key:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to rotate MCP key' },
      { status: 400 }
    );
  }
}
