import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserById, updateUser, deleteUser } from '@/lib/users';
import { getUserPermissions } from '@/lib/permissions';
import { SafeUser } from '@/types/user';
import prisma from '@/lib/prisma';

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
    
    const permissions = await getUserPermissions(session.user.email);
    
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
    
    const permissions = await getUserPermissions(session.user.email);
    
    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    const user = await updateUser(params.id, body);
    
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
    
    const permissions = await getUserPermissions(session.user.email);
    
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
