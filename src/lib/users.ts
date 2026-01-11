import bcrypt from 'bcryptjs';
import { promises as fs } from 'fs';
import path from 'path';
import { User, SafeUser, UserInput } from '@/types/user';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory and file exist
async function ensureDataFile(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(USERS_FILE);
    } catch {
      // File doesn't exist, create with default admin
      const defaultUsers: User[] = [
        {
          id: 'user_1',
          email: 'russell.moss@savvywealth.com',
          name: 'Russell Moss',
          passwordHash: bcrypt.hashSync('Savvy1234!', 10),
          role: 'admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'system',
          isActive: true,
        },
      ];
      await fs.writeFile(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    }
  } catch (error) {
    console.error('Error ensuring data file:', error);
  }
}

// Read all users from file
async function readUsers(): Promise<User[]> {
  await ensureDataFile();
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users:', error);
    return [];
  }
}

// Write users to file
async function writeUsers(users: User[]): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Generate unique ID
function generateId(): string {
  return 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Remove sensitive data for API responses
function toSafeUser(user: User): SafeUser {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

// ============ PUBLIC API ============

export async function getAllUsers(): Promise<SafeUser[]> {
  const users = await readUsers();
  return users.map(toSafeUser);
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  const users = await readUsers();
  const user = users.find(u => u.id === id);
  return user ? toSafeUser(user) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await readUsers();
  return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

export async function createUser(input: UserInput, createdBy: string): Promise<SafeUser> {
  const users = await readUsers();
  
  // Check if email already exists
  if (users.some(u => u.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error('A user with this email already exists');
  }
  
  // Validate email domain
  if (!input.email.endsWith('@savvywealth.com')) {
    throw new Error('Only @savvywealth.com emails are allowed');
  }
  
  const newUser: User = {
    id: generateId(),
    email: input.email.toLowerCase(),
    name: input.name,
    passwordHash: bcrypt.hashSync(input.password || 'Savvy1234!', 10),
    role: input.role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy,
    isActive: input.isActive ?? true,
  };
  
  users.push(newUser);
  await writeUsers(users);
  
  return toSafeUser(newUser);
}

export async function updateUser(id: string, input: Partial<UserInput>): Promise<SafeUser> {
  const users = await readUsers();
  const index = users.findIndex(u => u.id === id);
  
  if (index === -1) {
    throw new Error('User not found');
  }
  
  // If changing email, check it doesn't already exist
  if (input.email && input.email.toLowerCase() !== users[index].email.toLowerCase()) {
    if (users.some(u => u.email.toLowerCase() === input.email!.toLowerCase())) {
      throw new Error('A user with this email already exists');
    }
    if (!input.email.endsWith('@savvywealth.com')) {
      throw new Error('Only @savvywealth.com emails are allowed');
    }
  }
  
  const updatedUser: User = {
    ...users[index],
    email: input.email?.toLowerCase() || users[index].email,
    name: input.name || users[index].name,
    role: input.role || users[index].role,
    isActive: input.isActive ?? users[index].isActive,
    updatedAt: new Date().toISOString(),
  };
  
  // Update password if provided
  if (input.password) {
    updatedUser.passwordHash = bcrypt.hashSync(input.password, 10);
  }
  
  users[index] = updatedUser;
  await writeUsers(users);
  
  return toSafeUser(updatedUser);
}

export async function deleteUser(id: string): Promise<void> {
  const users = await readUsers();
  const index = users.findIndex(u => u.id === id);
  
  if (index === -1) {
    throw new Error('User not found');
  }
  
  // Prevent deleting the last admin
  const user = users[index];
  if (user.role === 'admin') {
    const adminCount = users.filter(u => u.role === 'admin' && u.isActive).length;
    if (adminCount <= 1) {
      throw new Error('Cannot delete the last admin user');
    }
  }
  
  users.splice(index, 1);
  await writeUsers(users);
}

export async function validateUser(
  email: string,
  password: string
): Promise<{ id: string; email: string; name: string; role: string } | null> {
  if (!email.endsWith('@savvywealth.com')) {
    return null;
  }
  
  const user = await getUserByEmail(email);
  
  if (!user || !user.isActive) {
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
    role: user.role,
  };
}

export async function resetPassword(id: string, newPassword: string): Promise<void> {
  const users = await readUsers();
  const index = users.findIndex(u => u.id === id);
  
  if (index === -1) {
    throw new Error('User not found');
  }
  
  users[index].passwordHash = bcrypt.hashSync(newPassword, 10);
  users[index].updatedAt = new Date().toISOString();
  
  await writeUsers(users);
}
