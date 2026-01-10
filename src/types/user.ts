export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
}

export interface UserPermissions {
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  allowedPages: number[];
  sgaFilter: string | null;  // If SGA, filter to their records
  sgmFilter: string | null;  // If SGM, filter to their team
  canExport: boolean;
  canManageUsers: boolean;
}

// For API responses (excludes passwordHash)
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
}

// For creating/updating users
export interface UserInput {
  email: string;
  name: string;
  password?: string;  // Optional for updates
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  isActive?: boolean;
}
