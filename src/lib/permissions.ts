import { UserPermissions, UserRole } from '@/types/user';
import { getUserByEmail } from './users';

// Token data structure (what we store in JWT)
export interface TokenUserData {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  externalAgency?: string | null;
}

export const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter' | 'recruiterFilter' | 'capitalPartnerFilter' | 'userId'>> = {
  revops_admin: {
    role: 'revops_admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],  // All pages + 14 = Chart Builder, 15 = Advisor Map, 16 = GC Hub
    canExport: true,
    canManageUsers: true,
    canManageRequests: true,  // Only role that can manage requests
  },
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16],  // 15 = Advisor Map, 16 = GC Hub (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: true,
    canManageRequests: false,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15],  // 15 = Advisor Map (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 7, 10, 13, 15],  // 15 = Advisor Map (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 7, 8, 10, 11, 13, 15],  // 15 = Advisor Map (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 7, 10, 13, 15],  // 13 = Dashboard Requests, 15 = Advisor Map
    canExport: false,
    canManageUsers: false,
    canManageRequests: false,
  },
  recruiter: {
    role: 'recruiter',
    allowedPages: [7, 12],  // Settings (7) + Recruiter Hub (12) only - NO Dashboard Requests, NO Advisor Map
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  capital_partner: {
    role: 'capital_partner',
    allowedPages: [7, 16],  // Settings (7) + GC Hub (16) only
    canExport: true,         // Can export anonymized CSV
    canManageUsers: false,
    canManageRequests: false,
  },
};

/**
 * Get permissions from token data WITHOUT a database query.
 * Use this in session callbacks and API routes where token data is available.
 * This is the preferred method for performance.
 */
export function getPermissionsFromToken(tokenData: TokenUserData): UserPermissions {
  const basePermissions = ROLE_PERMISSIONS[tokenData.role] || ROLE_PERMISSIONS.viewer;

  return {
    ...basePermissions,
    sgaFilter: tokenData.role === 'sga' ? tokenData.name : null,
    sgmFilter: tokenData.role === 'sgm' ? tokenData.name : null,
    recruiterFilter: tokenData.role === 'recruiter' ? (tokenData.externalAgency ?? null) : null,
    capitalPartnerFilter: tokenData.role === 'capital_partner' ? (tokenData.externalAgency ?? null) : null,
    userId: tokenData.id,
  };
}

/**
 * Get permissions by querying the database for fresh user data.
 * Use this only when you need to ensure data is up-to-date (e.g., after role changes).
 * For most API routes, prefer using session.permissions (derived from token).
 */
export async function getUserPermissions(email: string): Promise<UserPermissions> {
  const user = await getUserByEmail(email);

  if (!user) {
    return {
      role: 'viewer',
      allowedPages: [1, 3, 7, 10],
      sgaFilter: null,
      sgmFilter: null,
      recruiterFilter: null,
      capitalPartnerFilter: null,
      canExport: false,
      canManageUsers: false,
      canManageRequests: false,
      userId: null,
    };
  }

  const basePermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.viewer;

  return {
    ...basePermissions,
    sgaFilter: user.role === 'sga' ? user.name : null,
    sgmFilter: user.role === 'sgm' ? user.name : null,
    recruiterFilter: user.role === 'recruiter' ? (user.externalAgency ?? null) : null,
    capitalPartnerFilter: user.role === 'capital_partner' ? (user.externalAgency ?? null) : null,
    userId: user.id,
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
