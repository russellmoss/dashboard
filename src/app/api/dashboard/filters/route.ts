import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { FilterOptions, FilterOption } from '@/types/filters';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';
import { getRawFilterOptions } from '@/lib/queries/filter-options';

export const dynamic = 'force-dynamic';

// SGAs that should always appear as inactive (regardless of User table status)
// These are former employees or system accounts
const ALWAYS_INACTIVE_SGAS = new Set([
  'Russell Moss',
  'Anett Diaz',
  'Bre McDaniel',
  'Bryan Belville',
  'GinaRose Galli',
  'Jed Entin',
  'Savvy Marketing',
  'Savvy Operations',
  'Ariana Butler',
]);

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Block recruiters from main dashboard endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    // Get cached raw filter options (BigQuery queries)
    const rawOptions = await getRawFilterOptions();

    // Process SGAs with inactive override and permission filtering
    let processedSgas: FilterOption[] = rawOptions.sgas.map(sga => ({
      value: sga.value,
      label: sga.value,
      // Override isActive if in always-inactive list
      isActive: ALWAYS_INACTIVE_SGAS.has(sga.value) ? false : sga.isActive,
      count: sga.record_count,
    }));

    // Process SGMs
    let processedSgms: FilterOption[] = rawOptions.sgms.map(sgm => ({
      value: sgm.value,
      label: sgm.value,
      isActive: sgm.isActive,
      count: sgm.record_count,
    }));

    // Apply permission-based filtering (not cached - user-specific)
    // SGA users should only see their own name in the dropdown
    if (permissions.sgaFilter) {
      processedSgas = processedSgas.filter(sga => sga.value === permissions.sgaFilter);
    }
    // SGM users should only see their own name in the dropdown
    if (permissions.sgmFilter) {
      processedSgms = processedSgms.filter(sgm => sgm.value === permissions.sgmFilter);
    }

    const filterOptions: FilterOptions = {
      channels: rawOptions.channels,
      sources: rawOptions.sources,
      sgas: processedSgas,
      sgms: processedSgms,
      stages: rawOptions.stages,
      years: rawOptions.years,
      experimentationTags: rawOptions.experimentationTags,
      campaigns: (rawOptions.campaigns ?? []).map(c => ({
        value: c.value,
        label: c.label ?? c.value,
        isActive: true,
      })),
      leadScoreTiers: (rawOptions.leadScoreTiers || []).map(t => ({
        value: t.value,
        label: t.value,
        isActive: true,
        count: t.record_count,
      })),
    };

    return NextResponse.json(filterOptions);
  } catch (error: any) {
    console.error('Filters error:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
      code: error?.code,
    });
    return NextResponse.json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    }, { status: 500 });
  }
}
