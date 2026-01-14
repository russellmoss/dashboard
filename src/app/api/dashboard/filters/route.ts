import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE, MAPPING_TABLE } from '@/config/constants';
import { FilterOptions } from '@/types/filters';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get distinct filter options from BigQuery with counts
    // Use new_mapping table for latest channel mappings
    const channelsQuery = `
      SELECT 
        COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
        COUNT(*) AS record_count
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm
        ON v.Original_source = nm.original_source
      WHERE COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') IS NOT NULL
        AND stage_entered_contacting__c >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
      GROUP BY COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')
      ORDER BY record_count DESC
    `;
    
    const sourcesQuery = `
      SELECT 
        Original_source as source,
        COUNT(*) AS record_count
      FROM \`${FULL_TABLE}\`
      WHERE Original_source IS NOT NULL
        AND stage_entered_contacting__c >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
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
        AND v.stage_entered_contacting__c >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
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
    
    const [channels, sources, sgas, sgms, stages, years] = await Promise.all([
      runQuery<{ channel: string | null; record_count: number | string }>(channelsQuery),
      runQuery<{ source: string | null; record_count: number | string }>(sourcesQuery),
      runQuery<{ value: string | null; record_count: number | string }>(sgasQuery),
      runQuery<{ value: string | null; record_count: number | string }>(sgmsQuery),
      runQuery<{ stage: string | null }>(stagesQuery),
      runQuery<{ year: number | null }>(yearsQuery),
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
