import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE } from '@/config/constants';
import { FilterOptions } from '@/types/filters';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    // Block recruiters from main dashboard endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
    
    // Get distinct filter options from BigQuery with counts
    // Channel_Grouping_Name now comes directly from Finance_View__c in the view
    const channelsQuery = `
      SELECT 
        v.Channel_Grouping_Name as channel,
        COUNT(*) AS record_count
      FROM \`${FULL_TABLE}\` v
      WHERE v.Channel_Grouping_Name IS NOT NULL
        AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
      GROUP BY v.Channel_Grouping_Name
      ORDER BY record_count DESC
    `;
    
    const sourcesQuery = `
      SELECT 
        Original_source as source,
        COUNT(*) AS record_count
      FROM \`${FULL_TABLE}\`
      WHERE Original_source IS NOT NULL
        AND FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
      GROUP BY Original_source
      ORDER BY record_count DESC
    `;
    
    // Get SGAs who appear in the data AND are marked as SGAs in User table
    // Only include users where IsSGA__c = TRUE
    const sgasQuery = `
      SELECT 
        v.SGA_Owner_Name__c AS value,
        COUNT(*) AS record_count,
        MAX(COALESCE(u.IsActive, FALSE)) as isActive
      FROM \`${FULL_TABLE}\` v
      INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
        ON v.SGA_Owner_Name__c = u.Name
        AND u.IsSGA__c = TRUE  -- Only include users marked as SGAs
      WHERE v.SGA_Owner_Name__c IS NOT NULL
        AND v.SGA_Owner_Name__c != 'Savvy Operations'
        AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
      GROUP BY v.SGA_Owner_Name__c
      ORDER BY record_count DESC
    `;
    
    // Get SGMs who appear in the data AND are marked as SGMs in User table
    // Only include users where Is_SGM__c = TRUE
    const sgmsQuery = `
      SELECT 
        v.SGM_Owner_Name__c AS value,
        COUNT(DISTINCT v.Full_Opportunity_ID__c) AS record_count,
        MAX(COALESCE(u.IsActive, FALSE)) as isActive
      FROM \`${FULL_TABLE}\` v
      INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
        ON v.SGM_Owner_Name__c = u.Name
        AND u.Is_SGM__c = TRUE  -- Only include users marked as SGMs
      WHERE v.SGM_Owner_Name__c IS NOT NULL
        AND v.Full_Opportunity_ID__c IS NOT NULL
        AND v.Opp_CreatedDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
      GROUP BY v.SGM_Owner_Name__c
      ORDER BY record_count DESC
    `;
    
    const stagesQuery = `
      SELECT DISTINCT StageName as stage
      FROM \`${FULL_TABLE}\`
      WHERE StageName IS NOT NULL
      ORDER BY StageName
    `;
    
    const yearsQuery = `
      SELECT DISTINCT EXTRACT(YEAR FROM FilterDate) as year
      FROM \`${FULL_TABLE}\`
      WHERE FilterDate IS NOT NULL
      ORDER BY year DESC
    `;
    
    // Get distinct experimentation tags from the Experimentation_Tag_List array field
    const experimentationTagsQuery = `
      SELECT DISTINCT tag as experimentation_tag
      FROM \`${FULL_TABLE}\` v,
      UNNEST(v.Experimentation_Tag_List) as tag
      WHERE tag IS NOT NULL
        AND TRIM(tag) != ''
        AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
      ORDER BY experimentation_tag
    `;
    
    const [channels, sources, sgas, sgms, stages, years, experimentationTags] = await Promise.all([
      runQuery<{ channel: string | null; record_count: number | string }>(channelsQuery),
      runQuery<{ source: string | null; record_count: number | string }>(sourcesQuery),
      runQuery<{ value: string | null; record_count: number | string }>(sgasQuery),
      runQuery<{ value: string | null; record_count: number | string }>(sgmsQuery),
      runQuery<{ stage: string | null }>(stagesQuery),
      runQuery<{ year: number | null }>(yearsQuery),
      runQuery<{ experimentation_tag: string | null }>(experimentationTagsQuery),
    ]);
    
    // SGAs that should always appear as inactive (regardless of User table status)
    const alwaysInactiveSGAs = new Set([
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

    const filterOptions: FilterOptions = {
      channels: channels.map(r => r.channel || '').filter(Boolean),
      sources: sources.map(r => r.source || '').filter(Boolean),
      sgas: sgas
        .filter(r => r.value)
        .map(r => {
          const sgaName = r.value!;
          const userTableIsActive = (r as any).isActive === true || (r as any).isActive === 1;
          // Override isActive to false if in the always-inactive list
          const isActive = alwaysInactiveSGAs.has(sgaName) ? false : userTableIsActive;
          
          return {
            value: sgaName,
            label: sgaName,
            isActive,
            count: parseInt((r.record_count?.toString() || '0'), 10),
          };
        }),
      sgms: sgms
        .filter(r => r.value)
        .map(r => ({
          value: r.value!,
          label: r.value!,
          isActive: (r as any).isActive === true || (r as any).isActive === 1,  // Use actual isActive from User table
          count: parseInt((r.record_count?.toString() || '0'), 10),
        })),
      stages: stages.map(r => r.stage || '').filter(Boolean),
      years: years.map(r => r.year || 0).filter(y => y > 0),
      experimentationTags: experimentationTags.map(r => r.experimentation_tag || '').filter(Boolean),
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
