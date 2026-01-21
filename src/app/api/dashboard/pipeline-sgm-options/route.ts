import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, OPEN_PIPELINE_STAGES } from '@/config/constants';
import { SgmOption } from '@/types/dashboard';

interface RawSgmResult {
  sgm: string | null;
  isActive: boolean | number | null;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Note: Permission check removed - all authenticated users can access pipeline data
    
    // Build stage parameters
    const stageParams = OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`);
    const params: Record<string, any> = {
      recruitingRecordType: RECRUITING_RECORD_TYPE,
    };
    OPEN_PIPELINE_STAGES.forEach((stage, i) => {
      params[`stage${i}`] = stage;
    });
    
    // Query distinct SGMs from open pipeline opportunities
    // Join with User table to get isActive status
    // Note: We check IsActive for any matching user by name, not just those with Is_SGM__c = TRUE
    // This ensures SGMs who appear in the data but aren't marked as SGM in User table still get correct status
    const query = `
      SELECT DISTINCT 
        v.SGM_Owner_Name__c as sgm,
        COALESCE(u.IsActive, TRUE) as isActive
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u 
        ON v.SGM_Owner_Name__c = u.Name
      WHERE v.SGM_Owner_Name__c IS NOT NULL
        AND v.recordtypeid = @recruitingRecordType
        AND v.StageName IN (${stageParams.join(', ')})
        AND v.is_sqo_unique = 1
      ORDER BY v.SGM_Owner_Name__c
    `;
    
    const results = await runQuery<RawSgmResult>(query, params);
    
    const sgmOptions: SgmOption[] = results
      .filter(r => r.sgm !== null)
      .map(r => ({
        value: r.sgm as string,
        label: r.sgm as string,
        isActive: r.isActive === true || r.isActive === 1,
      }));
    
    return NextResponse.json({ sgmOptions });
  } catch (error) {
    console.error('Error fetching SGM options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM options' },
      { status: 500 }
    );
  }
}
