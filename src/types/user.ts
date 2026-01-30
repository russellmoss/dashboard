// Role type used across all user interfaces
export type UserRole = 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
  externalAgency?: string | null;
}

export interface UserPermissions {
  role: UserRole;
  allowedPages: number[];
  sgaFilter: string | null;  // If SGA, filter to their records
  sgmFilter: string | null;  // If SGM, filter to their team
  recruiterFilter: string | null;  // If recruiter, filter to their agency
  canExport: boolean;
  canManageUsers: boolean;
  canManageRequests: boolean;  // RevOps Admin only - manage Dashboard Requests
  userId?: string | null;  // User ID for API routes that need it
}

// For API responses (excludes passwordHash)
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
  externalAgency?: string | null;
}

// For creating/updating users
export interface UserInput {
  email: string;
  name: string;
  password?: string;  // Optional for updates
  role: UserRole;
  isActive?: boolean;
  externalAgency?: string | null;
}
