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

/**
 * Returns a 403 Forbidden response if the user is a capital partner.
 * Use inside API route handlers as a defense-in-depth check.
 * Capital partners should only access /api/gc-hub/* routes.
 */
export function forbidCapitalPartner(permissions: UserPermissions) {
  if (permissions.role !== 'capital_partner') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

