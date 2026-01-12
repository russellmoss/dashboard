import bcrypt from 'bcryptjs';
import prisma from './prisma';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
}

export async function validateUser(
  email: string,
  password: string
): Promise<User | null> {
  // Only allow @savvywealth.com emails
  if (!email.endsWith('@savvywealth.com')) {
    console.error('[validateUser] Email does not end with @savvywealth.com:', email);
    return null;
  }

  const normalizedEmail = email.toLowerCase();
  console.log('[validateUser] Looking up user with email (Prisma):', normalizedEmail);

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.error('[validateUser] User not found in database:', normalizedEmail);
      return null;
    }

    // Check if user is active
    if (user.isActive === false) {
      console.error('[validateUser] User is inactive:', normalizedEmail);
      return null;
    }

    console.log('[validateUser] User found, comparing password...');
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      console.error('[validateUser] Password comparison failed for:', normalizedEmail);
      return null;
    }

    console.log('[validateUser] Password valid, returning user:', user.email);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as User['role'],
      isActive: user.isActive ?? true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  } catch (error) {
    console.error('[validateUser] Database error:', error);
    throw error;
  }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
  };
}

export async function getUserById(id: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
  };
}

export async function getAllUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
  }));
}

export async function createUser(
  data: { email: string; name: string; password?: string; role: string; isActive?: boolean },
  createdBy: string
): Promise<User> {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const passwordHash = await bcrypt.hash(data.password || 'Savvy1234!', 10);

  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash,
      role: data.role,
      isActive: data.isActive ?? true,
      createdBy,
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    isActive: user.isActive ?? true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function updateUser(
  id: string,
  data: { name?: string; role?: string; password?: string; isActive?: boolean }
): Promise<User> {
  const updateData: any = {};
  
  if (data.name) updateData.name = data.name;
  if (data.role) updateData.role = data.role;
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);
  if (typeof data.isActive === 'boolean') updateData.isActive = data.isActive;

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
  };
}

export async function deleteUser(id: string): Promise<void> {
  await prisma.user.delete({
    where: { id },
  });
}

export async function resetPassword(id: string, newPassword?: string): Promise<string> {
  const password = newPassword || 'Savvy1234!';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });

  return password;
}
