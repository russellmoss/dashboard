import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserById, updateUser, deleteUser } from '@/lib/users';
import { getSessionPermissions } from '@/types/auth';
import { SafeUser } from '@/types/user';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

// GET /api/users/[id] - Get single user
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const user = await getUserById(params.id);
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Get full user with createdBy from database
    const fullUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { createdBy: true },
    });
    
    // Convert to SafeUser (exclude passwordHash)
    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive ?? true,
      createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
      createdBy: fullUser?.createdBy || '',
      externalAgency: user.externalAgency ?? null,
    };

    return NextResponse.json({ user: safeUser });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

// PUT /api/users/[id] - Update user
export async function PUT(request: NextRequest, { params }: RouteParams) {
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

    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const existingUser = await getUserById(params.id);
    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();

    // Validate externalAgency for recruiter role
    if (body.role === 'recruiter') {
      if (!body.externalAgency || String(body.externalAgency).trim() === '') {
        return NextResponse.json(
          { error: 'External Agency is required for Recruiter role' },
          { status: 400 }
        );
      }
      body.externalAgency = String(body.externalAgency).trim();
    }

    // Validate externalAgency for capital_partner role
    if (body.role === 'capital_partner') {
      if (!body.externalAgency || String(body.externalAgency).trim() === '') {
        return NextResponse.json(
          { error: 'Capital Partner Company is required for Capital Partner role' },
          { status: 400 }
        );
      }
      body.externalAgency = String(body.externalAgency).trim();
    }

    // Clear externalAgency when role changes FROM recruiter/capital_partner to something else
    if (body.role && body.role !== 'recruiter' && body.role !== 'capital_partner' &&
        (existingUser.role === 'recruiter' || existingUser.role === 'capital_partner')) {
      body.externalAgency = null;
    }

    const user = await updateUser(params.id, body);

    // Convert to SafeUser (exclude passwordHash)
    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive ?? true,
      createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
      createdBy: existingUser.createdBy || '',
      externalAgency: user.externalAgency ?? null,
    };

    return NextResponse.json({ user: safeUser });
  } catch (error: any) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update user' },
      { status: 400 }
    );
  }
}

// DELETE /api/users/[id] - Delete user
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Prevent self-deletion
    const user = await getUserById(params.id);
    if (user?.email === session.user.email) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      );
    }
    
    await deleteUser(params.id);
    
    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete user' },
      { status: 400 }
    );
  }
}
