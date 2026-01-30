import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers, createUser } from '@/lib/users';
import { getSessionPermissions } from '@/types/auth';
import { SafeUser } from '@/types/user';

export const dynamic = 'force-dynamic';

// GET /api/users - List all users
export async function GET() {
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
    
    const users = await getAllUsers();
    // Convert to SafeUser (exclude passwordHash)
    const safeUsers: SafeUser[] = users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive ?? true,
      createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
      createdBy: user.createdBy || '',
      externalAgency: user.externalAgency ?? null,
    }));
    return NextResponse.json({ users: safeUsers });
    
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST /api/users - Create new user
export async function POST(request: NextRequest) {
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
    
    const body = await request.json();
    const { email, name, password, role, isActive, externalAgency } = body;

    if (!email || !name || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate externalAgency for recruiter role
    if (role === 'recruiter') {
      if (!externalAgency || String(externalAgency).trim() === '') {
        return NextResponse.json(
          { error: 'External Agency is required for Recruiter role' },
          { status: 400 }
        );
      }
    }

    const user = await createUser(
      {
        email,
        name,
        password,
        role,
        isActive,
        externalAgency: role === 'recruiter' ? String(externalAgency).trim() : null,
      },
      session.user.email
    );

    // Convert to SafeUser (exclude passwordHash)
    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive ?? true,
      createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
      createdBy: session.user.email,
      externalAgency: user.externalAgency ?? null,
    };
    
    return NextResponse.json({ user: safeUser }, { status: 201 });
    
  } catch (error: any) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 400 }
    );
  }
}
