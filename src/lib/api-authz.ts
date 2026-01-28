import { NextResponse } from 'next/server';
import type { UserPermissions } from '@/types/user';

/**
 * Defense-in-depth helper for API routes.
 * Use after `getUserPermissions()`:
 *
 *   const forbidden = forbidRecruiter(permissions);
 *   if (forbidden) return forbidden;
 */
export function forbidRecruiter(permissions: UserPermissions) {
  if (permissions.role !== 'recruiter') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

