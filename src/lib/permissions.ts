import { UserPermissions, UserRole } from '@/types/user';
import { getUserByEmail } from './users';

// Token data structure (what we store in JWT)
export interface TokenUserData {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  externalAgency?: string | null;
  // Canonical SGA name resolved from SavvyGTMData.User via email.
  // Set at JWT sign-in for users with role 'sga'. Protects the SGA-role
  // data-scope filter from dashboard-side User.name drift vs. Salesforce.
  sgaCanonicalName?: string | null;
}

export const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter' | 'recruiterFilter' | 'capitalPartnerFilter' | 'userId'>> = {
  revops_admin: {
    role: 'revops_admin',
    allowedPages: [1, 3, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    canExport: true,
    canManageUsers: true,
    canManageRequests: true,
    canRunScenarios: true,
  },
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20],
    canExport: true,
    canManageUsers: true,
    canManageRequests: false,
    canRunScenarios: true,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 18, 20],
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
    canRunScenarios: false,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 7, 10, 13, 15, 18, 20],
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
    canRunScenarios: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 7, 8, 10, 11, 13, 15, 20],
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
    canRunScenarios: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 7, 10, 13, 15],
    canExport: false,
    canManageUsers: false,
    canManageRequests: false,
    canRunScenarios: false,
  },
  recruiter: {
    role: 'recruiter',
    allowedPages: [7, 12],
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
    canRunScenarios: false,
  },
  capital_partner: {
    role: 'capital_partner',
    allowedPages: [7, 16],
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
    canRunScenarios: false,
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
    sgaFilter: tokenData.role === 'sga' ? (tokenData.sgaCanonicalName ?? tokenData.name) : null,
    sgmFilter: null,
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
      canRunScenarios: false,
      userId: null,
    };
  }

  const basePermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.viewer;

  return {
    ...basePermissions,
    sgaFilter: user.role === 'sga' ? user.name : null,
    sgmFilter: null,
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

export const RUBRIC_EDITOR_ROLES = ['admin', 'revops_admin', 'manager'] as const;
export type RubricEditorRole = typeof RUBRIC_EDITOR_ROLES[number];

export function canEditRubrics(role: string | undefined | null): role is RubricEditorRole {
  return typeof role === 'string' && (RUBRIC_EDITOR_ROLES as readonly string[]).includes(role);
}
