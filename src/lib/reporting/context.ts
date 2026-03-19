import type { ReportType } from '@/types/reporting';
import { CONSTANTS } from '@/lib/semantic-layer/definitions';

const COMMON_CONTEXT = `
## Trusted Reporting Context

Use the codebase's semantic layer and existing query modules as source-of-truth. Do not rediscover the warehouse from scratch unless a gap remains after using the curated context.

### Canonical Data Sources
- Primary funnel view: \`${CONSTANTS.FULL_TABLE}\`
- Mapping table: \`${CONSTANTS.MAPPING_TABLE}\`
- Daily forecast view: \`${CONSTANTS.DAILY_FORECAST_VIEW}\`

### Cross-Cutting Rules
- \`vw_funnel_master\` is the canonical recruiting funnel source unless a report explicitly requires a specialty view.
- All \`is_*\` flags are INT64. Compare with \`= 1\`, not boolean syntax.
- Favor \`_unique\` flags for opp-level and joined counts to avoid duplicate inflation.
- \`Date_Became_SQO__c\` is TIMESTAMP. Use \`DATE(Date_Became_SQO__c)\` for date bucketing and filtering.
- \`converted_date_raw\` and \`advisor_join_date__c\` are DATE fields.
- \`Opportunity_AUM_M\` is already in millions.
- Source labels come from \`Original_source\` and \`Channel_Grouping_Name\`.
- Open pipeline stages are: Qualifying, Discovery, Sales Process, Negotiating.
- Close rate for SQO cohorts is: joined_unique / (joined_unique + closed_lost_sqo).

### Operating Guidance
- Prefer deterministic tools and curated schema/context tools before freeform SQL.
- When a name is user-provided, first resolve the exact warehouse name, then reuse that exact value in downstream queries.
- Reuse known dashboard-style query patterns instead of inventing new business logic.
`.trim();

const REPORT_CONTEXT: Record<ReportType, string> = {
  'sgm-analysis': `
### SGM Analysis Context
- Primary person fields: \`SGM_Owner_Name__c\`, \`SGA_Owner_Name__c\`
- Important opp fields: \`opportunity_id\`, \`StageName\`, \`is_primary_opp_record\`, \`is_sqo\`, \`is_sqo_unique\`, \`is_joined_unique\`, \`Opportunity_AUM_M\`
- Date fields commonly used here: \`Date_Became_SQO__c\`, \`advisor_join_date__c\`, \`Opp_CreatedDate\`
- Best path: use \`describeReportingSchema\` first, then use \`runSgmAnalysisSection\` for the core report sections. Use \`runBigQuery\` only for genuinely missing follow-up analysis.
  `.trim(),
  'analyze-wins': `
### Won Deal Context
- Specialty views: \`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2\`, \`savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition\`
- Favor \`is_joined_unique = 1\` cohorts for winner analysis.
- Use \`runAnalyzeWinsSection\` for the core quantitative sections instead of freeform SQL.
- \`vw_funnel_master\` uses \`Full_Opportunity_ID__c\` as the recruiting opportunity key; do NOT invent \`OpportunityId\`.
- For SGA leaderboard analysis, only treat someone as an SGA if \`SavvyGTMData.User.IsSGA__c = TRUE\`, and apply the same excluded-name logic used by the dashboard so SGMs/system users like Bre McDaniel are not treated as SGAs.
- In \`vw_sga_sms_timing_analysis_v2\`, use deployed fields like \`days_to_first_sms\`, \`days_to_first_double_tap\`, \`total_outbound_sms\`, \`total_inbound_sms\`, \`got_reply\`, and \`first_sms_same_day\`.
- Do NOT invent \`first_outbound_delay_hrs\` or \`reply_rate\` in the SMS view; compute rates from \`got_reply\` when needed.
- In \`vw_lost_to_competition\`, the firm field is \`moved_to_firm\`; do NOT invent \`Firm_Lost_To\`.
- Do NOT issue INFORMATION_SCHEMA discovery queries for this report type during normal generation.
  `.trim(),
  'sga-performance': `
### SGA Performance Context
- Specialty views: \`savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance\`, \`savvy-gtm-analytics.savvy_analytics.sms_weekly_metrics_daily\`, \`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2\`
- Compare SGAs on consistent funnel definitions from \`vw_funnel_master\`, then layer activity/SMS views on top.
- Use the same SGA definition as the SGA Hub leaderboard:
  - start from \`SavvyGTMData.User\`
  - require \`IsSGA__c = TRUE\`
  - require \`IsActive = TRUE\` for active leaderboard comparisons
  - exclude the dashboard exclusion list: Anett Diaz, Ariana Butler, Bre McDaniel, Bryan Belville, GinaRose Galli, Jacqueline Tully, Jed Entin, Russell Moss, Savvy Marketing, Savvy Operations
- Lead-level metrics belong to \`SGA_Owner_Name__c\`
- Opportunity-level metrics must use the same resolved ownership logic as the dashboard leaderboard:
  - \`COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)\`
- Do NOT invent \`SGA_Name\`; the warehouse fields are \`SGA_Owner_Name__c\`, \`Opp_SGA_Name__c\`, and resolved names via the User table.
- SGAs are primarily judged on their ability to generate quality SQOs for the downstream team.
- In the narrative, weight these metrics most heavily:
  - total SQO volume
  - contacted-to-MQL rate
  - MQL-to-SQL rate
  - SQL-to-SQO rate
  - contacted-to-SQO throughput
  - SQO-to-Joined rate on the SQOs they sourced
  - total Joined AUM delivered
  - average opportunity AUM of the SQOs they generate
- Do not over-index on pure activity volume if SQO production and downstream outcomes are weak.
- Best path: use \`describeReportingSchema\` first, then use \`runSgaPerformanceSection\` for core sections. Do not use freeform schema discovery for this report.
  `.trim(),
  'competitive-intel': `
### Competitive Intel Context
- Specialty view: \`savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition\`
- \`vw_lost_to_competition\` is the canonical source for competitor movement facts: \`moved_to_firm\`, \`months_to_move\`, \`closed_lost_date\`, \`closed_lost_reason\`, \`closed_lost_details\`, \`opportunity_id\`
- The current deployed \`vw_lost_to_competition\` view does NOT expose \`Opportunity_AUM_M\`
- \`vw_funnel_master\` uses \`Full_Opportunity_ID__c\` as the recruiting opportunity key
- Valid outcome/status fields in \`vw_funnel_master\` are \`StageName\`, \`is_joined\`, \`is_joined_unique\`, \`advisor_join_date__c\`, and \`Conversion_Status\`
- Treat closed-lost records as \`StageName = 'Closed Lost'\`; do NOT invent \`is_closed_lost\` or \`StageName__c\`
- For AUM on lost-to-competition deals, join \`vw_lost_to_competition.opportunity_id\` to \`vw_funnel_master.Full_Opportunity_ID__c\`
- Competitor counts must be \`COUNT(DISTINCT opportunity_id)\`, not raw row counts
- Canonical competitor grouping for reporting:
  - any firm name containing \`mariner\` => \`Mariner\`
  - any firm name containing \`lpl\` => \`LPL\`
- Do NOT try to source \`Opportunity_AUM_M\` from \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` in this report flow
- Market context heuristics to consider in the narrative:
  - LPL often offers roughly 90% revenue share, versus Savvy Wealth typically offering roughly 70-80%
  - Farther may be perceived as further along toward IPO / equity realization, which can matter in competitive positioning
- Treat those items as strategic context for interpretation and counter-positioning, not as warehouse facts derived from BigQuery
- Cross-reference with \`vw_funnel_master\` for recruiting economics and with web search for external market context.
  `.trim(),
};

export function getReportingContext(reportType: ReportType): string {
  return [COMMON_CONTEXT, REPORT_CONTEXT[reportType]].join('\n\n');
}

export function getReportingContextPayload(reportType: ReportType) {
  return {
    reportType,
    canonicalSources: {
      fullTable: CONSTANTS.FULL_TABLE,
      mappingTable: CONSTANTS.MAPPING_TABLE,
      dailyForecastView: CONSTANTS.DAILY_FORECAST_VIEW,
    },
    guidance: getReportingContext(reportType),
  };
}
