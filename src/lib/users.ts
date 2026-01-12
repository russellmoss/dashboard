import bcrypt from 'bcryptjs';
import prisma from './prisma';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  createdAt?: Date;
  updatedAt?: Date;
}

export async function validateUser(
  email: string,
  password: string
): Promise<User | null> {
  // Only allow @savvywealth.com emails
  if (!email.endsWith('@savvywealth.com')) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);

  if (!isValid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
  };
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
  };
}

export async function getAllUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return users.map((user: { id: string; email: string; name: string; role: string }) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
  }));
}

export async function createUser(
  data: { email: string; name: string; password?: string; role: string },
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
      createdBy,
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
  };
}

export async function updateUser(
  id: string,
  data: { name?: string; role?: string; password?: string }
): Promise<User> {
  const updateData: any = {};
  
  if (data.name) updateData.name = data.name;
  if (data.role) updateData.role = data.role;
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
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
