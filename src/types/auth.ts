import { Session } from 'next-auth';
import { UserPermissions } from './user';

// Extended session with permissions attached
export interface ExtendedSession extends Session {
  permissions?: UserPermissions;
}

// Type guard to check if session has permissions
export function hasPermissions(
  session: Session | ExtendedSession | null | undefined
): session is ExtendedSession & { permissions: UserPermissions } {
  return (
    session !== null &&
    session !== undefined &&
    'permissions' in session &&
    session.permissions !== undefined &&
    session.permissions !== null
  );
}

// Helper to safely get permissions from session
export function getSessionPermissions(
  session: Session | ExtendedSession | null | undefined
): UserPermissions | null {
  if (hasPermissions(session)) {
    return session.permissions;
  }
  return null;
}
