import { UserPermissions } from '@/types/user';
import { getUserByEmail } from './users';

const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter' | 'recruiterFilter'>> = {
  revops_admin: {
    role: 'revops_admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13],  // All pages + 13 = Dashboard Requests
    canExport: true,
    canManageUsers: true,
    canManageRequests: true,  // Only role that can manage requests
  },
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13],  // 12 = Recruiter Hub, 13 = Dashboard Requests
    canExport: true,
    canManageUsers: true,
    canManageRequests: false,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13],  // 12 = Recruiter Hub, 13 = Dashboard Requests
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 7, 10, 13],  // Added 13 = Dashboard Requests
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 7, 8, 10, 11, 13],  // Added 13 = Dashboard Requests
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 7, 10, 13],  // Added 13 = Dashboard Requests
    canExport: false,
    canManageUsers: false,
    canManageRequests: false,
  },
  recruiter: {
    role: 'recruiter',
    allowedPages: [7, 12],  // Settings (7) + Recruiter Hub (12) only - NO Dashboard Requests
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
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
      recruiterFilter: null,
      canExport: false,
      canManageUsers: false,
      canManageRequests: false,
    };
  }

  const basePermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.viewer;

  return {
    ...basePermissions,
    sgaFilter: user.role === 'sga' ? user.name : null,
    sgmFilter: user.role === 'sgm' ? user.name : null,
    recruiterFilter: user.role === 'recruiter' ? (user.externalAgency ?? null) : null,
  };
}

export function canAccessPage(permissions: UserPermissions, pageNumber: number): boolean {
  return permissions.allowedPages.includes(pageNumber);
}

export function getDataFilters(permissions: UserPermissions): {
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;
} {
  return {
    sgaFilter: permissions.sgaFilter,
    sgmFilter: permissions.sgmFilter,
    recruiterFilter: permissions.recruiterFilter,
  };
}
