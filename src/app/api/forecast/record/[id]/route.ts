import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { canAccessPage } from '@/lib/permissions';
import { runQuery } from '@/lib/bigquery';
import { toString, toNumber } from '@/types/bigquery-raw';

function extractDateValue(
  field: { value: string } | string | null | undefined
): string | null {
  if (!field) return null;
  if (typeof field === 'object' && field !== null && 'value' in field) {
    return typeof field.value === 'string' ? field.value : null;
  }
  if (typeof field === 'string') return field;
  return null;
}

export const revalidate = 21600; // 6 hours

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !canAccessPage(permissions, 19)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const oppId = params.id;

    const conditions: string[] = ['f.Full_Opportunity_ID__c = @oppId'];
    const queryParams: Record<string, any> = { oppId };

    if (permissions.sgmFilter) {
      conditions.push('f.SGM_Owner_Name__c = @sgmFilter');
      queryParams.sgmFilter = permissions.sgmFilter;
    }
    if (permissions.sgaFilter) {
      conditions.push('f.SGA_Owner_Name__c = @sgaFilter');
      queryParams.sgaFilter = permissions.sgaFilter;
    }

    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT
        f.*,
        a.Date_Became_SQO__c,
        a.Stage_Entered_Sales_Process__c,
        a.Stage_Entered_Negotiating__c,
        a.Stage_Entered_Signed__c,
        a.Stage_Entered_Joined__c,
        a.Stage_Entered_On_Hold__c,
        a.Stage_Entered_Closed__c,
        a.advisor_join_date__c,
        a.eff_sp_ts,
        a.eff_neg_ts,
        a.eff_signed_ts,
        a.eff_joined_ts,
        a.days_in_sp,
        a.days_in_negotiating,
        a.days_in_signed,
        a.days_total_sqo_to_joined,
        a.Conversion_Status,
        a.Closed_Lost_Reason__c,
        a.Closed_Lost_Details__c,
        a.stages_skipped,
        a.Original_source,
        a.Finance_View__c,
        a.lead_record_source
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_forecast_p2\` f
      LEFT JOIN \`savvy-gtm-analytics.Tableau_Views.vw_funnel_audit\` a
        ON f.Full_Opportunity_ID__c = a.Full_Opportunity_ID__c
      WHERE ${whereClause}
      LIMIT 1
    `;

    const results = await runQuery<any>(query, queryParams);

    if (results.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    const r = results[0];

    const record = {
      // Forecast fields
      Full_Opportunity_ID__c: toString(r.Full_Opportunity_ID__c),
      advisor_name: toString(r.advisor_name),
      salesforce_url: toString(r.salesforce_url),
      SGM_Owner_Name__c: r.SGM_Owner_Name__c ? toString(r.SGM_Owner_Name__c) : null,
      SGA_Owner_Name__c: r.SGA_Owner_Name__c ? toString(r.SGA_Owner_Name__c) : null,
      StageName: toString(r.StageName),
      days_in_current_stage: toNumber(r.days_in_current_stage),
      Opportunity_AUM_M: toNumber(r.Opportunity_AUM_M),
      aum_tier: toString(r.aum_tier),
      is_zero_aum: toNumber(r.is_zero_aum) === 1,
      p_join: toNumber(r.p_join),
      expected_days_remaining: toNumber(r.expected_days_remaining),
      model_projected_join_date: extractDateValue(r.model_projected_join_date),
      Earliest_Anticipated_Start_Date__c: extractDateValue(r.Earliest_Anticipated_Start_Date__c),
      final_projected_join_date: extractDateValue(r.final_projected_join_date),
      date_source: toString(r.date_source),
      is_q2_2026: toNumber(r.is_q2_2026) === 1,
      is_q3_2026: toNumber(r.is_q3_2026) === 1,
      expected_aum_q2: toNumber(r.expected_aum_q2),
      expected_aum_q3: toNumber(r.expected_aum_q3),
      rate_sqo_to_sp: r.rate_sqo_to_sp != null ? toNumber(r.rate_sqo_to_sp) : null,
      rate_sp_to_neg: r.rate_sp_to_neg != null ? toNumber(r.rate_sp_to_neg) : null,
      rate_neg_to_signed: r.rate_neg_to_signed != null ? toNumber(r.rate_neg_to_signed) : null,
      rate_signed_to_joined: r.rate_signed_to_joined != null ? toNumber(r.rate_signed_to_joined) : null,
      // Audit fields
      Date_Became_SQO__c: extractDateValue(r.Date_Became_SQO__c),
      Stage_Entered_Sales_Process__c: extractDateValue(r.Stage_Entered_Sales_Process__c),
      Stage_Entered_Negotiating__c: extractDateValue(r.Stage_Entered_Negotiating__c),
      Stage_Entered_Signed__c: extractDateValue(r.Stage_Entered_Signed__c),
      Stage_Entered_Joined__c: extractDateValue(r.Stage_Entered_Joined__c),
      Stage_Entered_On_Hold__c: extractDateValue(r.Stage_Entered_On_Hold__c),
      Stage_Entered_Closed__c: extractDateValue(r.Stage_Entered_Closed__c),
      advisor_join_date__c: extractDateValue(r.advisor_join_date__c),
      eff_sp_ts: extractDateValue(r.eff_sp_ts),
      eff_neg_ts: extractDateValue(r.eff_neg_ts),
      eff_signed_ts: extractDateValue(r.eff_signed_ts),
      eff_joined_ts: extractDateValue(r.eff_joined_ts),
      days_in_sp: r.days_in_sp != null ? toNumber(r.days_in_sp) : null,
      days_in_negotiating: r.days_in_negotiating != null ? toNumber(r.days_in_negotiating) : null,
      days_in_signed: r.days_in_signed != null ? toNumber(r.days_in_signed) : null,
      days_total_sqo_to_joined: r.days_total_sqo_to_joined != null ? toNumber(r.days_total_sqo_to_joined) : null,
      Conversion_Status: r.Conversion_Status ? toString(r.Conversion_Status) : null,
      Closed_Lost_Reason__c: r.Closed_Lost_Reason__c ? toString(r.Closed_Lost_Reason__c) : null,
      Closed_Lost_Details__c: r.Closed_Lost_Details__c ? toString(r.Closed_Lost_Details__c) : null,
      stages_skipped: r.stages_skipped != null ? toNumber(r.stages_skipped) : 0,
      Original_source: r.Original_source ? toString(r.Original_source) : null,
      Finance_View__c: r.Finance_View__c ? toString(r.Finance_View__c) : null,
      lead_record_source: r.lead_record_source ? toString(r.lead_record_source) : null,
    };

    return NextResponse.json({ record });
  } catch (error) {
    console.error('Forecast record error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecast record' },
      { status: 500 }
    );
  }
}
