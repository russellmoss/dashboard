import { UserPermissions } from '@/types/user';
import { getUserByEmail } from './users';

const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter'>> = {
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11],
    canExport: true,
    canManageUsers: true,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10, 11],
    canExport: true,
    canManageUsers: false,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 7, 10],
    canExport: true,
    canManageUsers: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 7, 8, 10, 11],
    canExport: true,
    canManageUsers: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 7, 10],
    canExport: false,
    canManageUsers: false,
  },
};

export async function getUserPermissions(email: string): Promise<UserPermissions> {
  const user = await getUserByEmail(email);
  
  if (!user) {
    return {
      role: 'viewer',
      allowedPages: [1, 3, 7, 10],
      sgaFilter: null,
      sgmFilter: null,
      canExport: false,
      canManageUsers: false,
    };
  }
  
  const basePermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.viewer;
  
  return {
    ...basePermissions,
    sgaFilter: user.role === 'sga' ? user.name : null,
    sgmFilter: user.role === 'sgm' ? user.name : null,
  };
}

export function canAccessPage(permissions: UserPermissions, pageNumber: number): boolean {
  return permissions.allowedPages.includes(pageNumber);
}

export function getDataFilters(permissions: UserPermissions): {
  sgaFilter: string | null;
  sgmFilter: string | null;
} {
  return {
    sgaFilter: permissions.sgaFilter,
    sgmFilter: permissions.sgmFilter,
  };
}
