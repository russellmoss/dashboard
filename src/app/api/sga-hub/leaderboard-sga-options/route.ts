// src/app/api/sga-hub/leaderboard-sga-options/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { runQuery } from '@/lib/bigquery';
import { toString } from '@/types/bigquery-raw';

export const dynamic = 'force-dynamic';

/**
 * Raw BigQuery result for SGA option
 */
interface RawSGAOption {
  sga_name: string | null;
  is_active: boolean | number | null;
}

/**
 * Always-excluded SGAs (never show in picklist)
 */
const EXCLUDED_SGAS = [
  'Anett Diaz',
  'Jacqueline Tully',
  'Savvy Operations',
  'Savvy Marketing',
  'Russell Moss',
  'Jed Entin',
];

/**
 * GET /api/sga-hub/leaderboard-sga-options
 * Get list of SGAs for leaderboard filter picklist
 * Returns all SGAs (active and inactive) except excluded ones
 * 
 * Response:
 * {
 *   sgaOptions: Array<{ value: string; label: string; isActive: boolean }>;
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorization check - SGA Hub is accessible to admin, manager, and sga roles
    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Query all SGAs from User table (excluding the always-excluded ones)
    const query = `
      SELECT DISTINCT
        u.Name as sga_name,
        u.IsActive as is_active
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.IsSGA__c = TRUE
        AND u.Name NOT IN UNNEST(@excludedSGAs)
      ORDER BY u.Name
    `;

    const params: Record<string, any> = {
      excludedSGAs: EXCLUDED_SGAS,
    };

    const results = await runQuery<RawSGAOption>(query, params);

    // Transform to SGA options
    const sgaOptions = results
      .filter(r => r.sga_name !== null)
      .map(r => ({
        value: toString(r.sga_name),
        label: toString(r.sga_name),
        isActive: r.is_active === true || r.is_active === 1,
      }));

    return NextResponse.json({ sgaOptions });

  } catch (error) {
    console.error('[API] Error fetching SGA options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGA options' },
      { status: 500 }
    );
  }
}
