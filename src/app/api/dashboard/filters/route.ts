import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE } from '@/config/constants';
import { FilterOptions } from '@/types/filters';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get distinct filter options from BigQuery
    // Use new_mapping table for latest channel mappings
    const channelsQuery = `
      SELECT DISTINCT COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.new_mapping\` nm
        ON v.Original_source = nm.original_source
      WHERE COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') IS NOT NULL
      ORDER BY channel
    `;
    
    const sourcesQuery = `
      SELECT DISTINCT Original_source as source
      FROM \`${FULL_TABLE}\`
      WHERE Original_source IS NOT NULL
      ORDER BY Original_source
    `;
    
    const sgasQuery = `
      SELECT DISTINCT SGA_Owner_Name__c as sga
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
      ORDER BY SGA_Owner_Name__c
    `;
    
    const sgmsQuery = `
      SELECT DISTINCT SGM_Owner_Name__c as sgm
      FROM \`${FULL_TABLE}\`
      WHERE SGM_Owner_Name__c IS NOT NULL
      ORDER BY SGM_Owner_Name__c
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
      runQuery<{ channel: string | null }>(channelsQuery),
      runQuery<{ source: string | null }>(sourcesQuery),
      runQuery<{ sga: string | null }>(sgasQuery),
      runQuery<{ sgm: string | null }>(sgmsQuery),
      runQuery<{ stage: string | null }>(stagesQuery),
      runQuery<{ year: number | null }>(yearsQuery),
    ]);
    
    const filterOptions: FilterOptions = {
      channels: channels.map(r => r.channel || '').filter(Boolean),
      sources: sources.map(r => r.source || '').filter(Boolean),
      sgas: sgas.map(r => r.sga || '').filter(Boolean),
      sgms: sgms.map(r => r.sgm || '').filter(Boolean),
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
