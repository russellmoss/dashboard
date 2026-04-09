import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getUserById } from '@/lib/users';
import { createMcpApiKey, revokeMcpApiKeys } from '@/lib/mcp-key-utils';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

// POST /api/users/[id]/mcp-key - Generate a new MCP API key
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

    const plaintext = await createMcpApiKey(params.id, label);

    return NextResponse.json({ key: plaintext });
  } catch (error: any) {
    console.error('Error generating MCP key:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate MCP key' },
      { status: 400 }
    );
  }
}

// DELETE /api/users/[id]/mcp-key - Revoke active MCP key
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    await revokeMcpApiKeys(params.id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error revoking MCP key:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to revoke MCP key' },
      { status: 400 }
    );
  }
}
